import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ExerciseMedia } from '@/components/ExerciseMedia';
import { ExerciseWeightProgressCard, WeightSuggestionCard } from '@/components/ExerciseWeight';
import { Icon } from '@/components/Icon';
import { RestPage, type SetDraft, type UpNext } from '@/components/RestPage';
import {
  Body,
  Button,
  Display,
  Heading,
  Muted,
  Overline,
  ProgressBar,
  Screen,
} from '@/components/ui';
import { confirm, notify } from '@/lib/alerts';
import { useAuth, useUserId } from '@/lib/auth';
import { getExercise } from '@/lib/catalog';
import {
  getSessionResumeDetails,
  getSessionPlanDay,
  getProgress,
  getWeightHistory,
  getSessionSetSnapshot,
  type ProgressRow,
} from '@/lib/db/queries';
import {
  flushOutbox,
  bootstrapSetBaselines,
  stageLegacyRestRecovery,
  pendingSyncCount,
  queueCompletion,
  queueSet,
} from '@/lib/session/sync';
import { buildQueue, restAfter, type QueueEntry } from '@/lib/session/queue';
import { formatClock, getBlockDurationSeconds } from '@/lib/plan/timing';
import { pauseDeadline, remainingSeconds, resumeDeadline, startDeadline } from '@/lib/session/timing';
import { colors, radius, space, type } from '@/lib/theme';
import { displayToKg, kgToDisplay } from '@/lib/units';
import { exerciseWeightProgress, getWeightHistoryIds, getWeightSuggestion, type ExerciseWeightHistory } from '@/lib/weights';
import { workouts } from '@/lib/session/workout';
import type { SavedWorkout, WorkoutTiming } from '@/lib/session/workout-store';
import type { SetLog, Units } from '@/lib/types';
import { draftMeasurement } from '@/lib/session/set-values';

const sameDraft = (a: SetDraft | null, b: SetDraft | null) =>
  a != null &&
  b != null &&
  a.reps === b.reps &&
  (a.seconds ?? null) === (b.seconds ?? null) &&
  a.weight === b.weight &&
  a.asBodyweight === b.asBodyweight;

const setLogFromDraft = (target: QueueEntry, value: SetDraft, units: Units): SetLog => {
  const kg = displayToKg(value.weight, units);
  return {
    plan_item_id: target.item.id, exercise_id: target.item.exercise_id,
    set_index: target.set, ...draftMeasurement(value),
    weight_kg: value.asBodyweight ? null : kg, is_bodyweight: value.asBodyweight,
    added_load_kg: value.asBodyweight ? kg : 0, rpe: null,
  };
};

const plannedDuration = (day: SavedWorkout['day']) => day.blocks.reduce(
  (sum, block) => sum + (getBlockDurationSeconds(block) ?? 0), 0);
const initialTiming = (saved: SavedWorkout, timestamp = Date.now()): WorkoutTiming => {
  const entry = buildQueue(saved.day)[saved.cursor];
  const duration = entry ? getBlockDurationSeconds(entry.block) : null;
  const plannedSeconds = plannedDuration(saved.day);
  return {
    session: startDeadline(plannedSeconds, saved.startedAtMs),
    block: duration == null ? null : startDeadline(duration, saved.cursor === 0 ? saved.startedAtMs : timestamp),
    blockId: entry?.block.id ?? 'finished', plannedSeconds,
  };
};

export default function SessionRun() {
  const { dayId, sessionId } = useLocalSearchParams<{
    dayId: string;
    sessionId: string;
  }>();
  const userId = useUserId();
  const { profile } = useAuth();
  const router = useRouter();
  const [workout, setWorkout] = useState<SavedWorkout | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [finishError, setFinishError] = useState<string | null>(null);
  const [finishAttempt, setFinishAttempt] = useState(0);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);
  const [pendingSync, setPendingSync] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [workWeight, setWorkWeight] = useState<string | null>(null);
  const [history, setHistory] = useState<Map<string, ExerciseWeightHistory>>(new Map());
  const [historyAvailable, setHistoryAvailable] = useState(false);
  const [serverSets, setServerSets] = useState<SetLog[]>([]);
  const timingFallback = useRef<WorkoutTiming | null>(null);
  const identity = useRef({ userId, sessionId });
  identity.current = { userId, sessionId };
  const isCurrent = () =>
    identity.current.userId === userId &&
    identity.current.sessionId === sessionId;
  const baselineRetry = useRef<{ userId: string; sessionId: string; observed: SetLog[]; needsReview: boolean } | null>(null);
  const completionStarted = useRef(false);
  const draftAttempt = useRef(0);
  const persistedWorkout = useRef<SavedWorkout | null>(null);
  const draftWrites = useRef<Promise<void>>(Promise.resolve());
  const active =
    workout?.ownerId === userId && workout.sessionId === sessionId
      ? workout
      : null;
  const day = active?.day ?? null;
  const cursor = active?.cursor ?? 0;
  const phase = active?.phase ?? 'work';
  const draft = active?.draft ?? null;
  const units = active?.units ?? profile?.units ?? 'kg';
  const progress = useMemo(
    () =>
      new Map((active?.progress ?? []).map((row) => [row.exercise_id, row])),
    [active?.progress],
  );
  const queue = useMemo(() => (day ? buildQueue(day) : []), [day]);
  const entry: QueueEntry | undefined = queue[cursor];
  const timing = active?.timing ?? timingFallback.current;
  const paused = timing?.session.pausedAt != null;
  const plannedSeconds = timing?.plannedSeconds ?? (day ? plannedDuration(day) : 0);
  const activeElapsed = (timestamp: number) => timing
    ? Math.max(0, Math.floor(plannedSeconds + ((timing.session.pausedAt ?? timestamp) - timing.session.endAt) / 1000))
    : Math.max(0, Math.floor((timestamp - (active?.startedAtMs ?? timestamp)) / 1000));
  const finished =
    !loading && active != null && queue.length > 0 && cursor >= queue.length;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setBusy(false);
    setWorkWeight(null);
    setHistory(new Map());
    setHistoryAvailable(false);
    setServerSets([]);
    timingFallback.current = null;
    completionStarted.current = false;
    baselineRetry.current = null;
    (async () => {
      let saved = await workouts.read(userId);
      if (saved && (saved.sessionId !== sessionId || saved.day.id !== dayId))
        throw new Error(
          'Resume your unfinished workout from Home before starting another.',
        );
      if (!saved) {
        const details = await getSessionResumeDetails(sessionId, userId);
        if (cancelled) return;
        if (details.completed_at != null) {
          router.replace({
            pathname: '/session/[dayId]/summary',
            params: {
              dayId,
              sessionId,
              elapsed: String(details.duration_s ?? 1),
            },
          });
          return;
        }
        const startTime = Date.parse(details.started_at);
        if (!Number.isFinite(startTime))
          throw new Error('Could not read workout start time.');
        const [originalDay, rows] = await Promise.all([
          getSessionPlanDay(sessionId, userId),
          getProgress(userId),
        ]);
        if (!originalDay || originalDay.id !== dayId)
          throw new Error('Could not load the original workout day.');
        if (cancelled) return;
        saved = await workouts.create({
          version: 1,
          ownerId: userId,
          sessionId,
          day: originalDay,
          units: profile?.units ?? 'kg',
          bodyweightKg: profile?.bodyweight_kg ?? null,
          progress: [...rows.values()],
          cursor: 0,
          phase: 'work',
          draft: null,
          savedDraft: null,
          restUntilMs: null,
          startedAtMs: startTime,
          endedAtMs: null,
        });
      }
      if (cancelled) return;
      const restingEntry = saved.phase === 'resting' ? buildQueue(saved.day)[saved.cursor] : null;
      if (restingEntry && saved.savedDraft) {
        const value = saved.savedDraft;
        const kg = displayToKg(value.weight, saved.units);
        const observed: SetLog[] = [{
          plan_item_id: restingEntry.item.id, exercise_id: restingEntry.item.exercise_id,
          set_index: restingEntry.set, ...draftMeasurement(value),
          weight_kg: value.asBodyweight ? null : kg, is_bodyweight: value.asBodyweight,
          added_load_kg: value.asBodyweight ? kg : 0, rpe: null,
        }];
        try { await bootstrapSetBaselines(userId, sessionId, observed, saved); }
        catch (error) {
          const message = (error as { message?: string })?.message ?? '';
          if ((error as { code?: string })?.code !== 'PT409'
            && !/network request failed|failed to fetch|offline|baseline read timed out/i.test(message)) throw error;
          if (cancelled || !isCurrent()) return;
          baselineRetry.current = { userId, sessionId, observed, needsReview: (error as { code?: string })?.code === 'PT409' };
        }
      }
      if (!cancelled) {
        timingFallback.current = saved.timing ?? initialTiming(saved);
        persistedWorkout.current = saved;
        setWorkout(saved);
        setNow(Date.now());
      }
    })()
      .catch((error) => {
        if (!cancelled)
          setLoadError(
            error instanceof Error
              ? error.message
              : 'Could not load your workout.',
          );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [userId, dayId, sessionId, loadAttempt]);

  useEffect(() => {
    if (!day) return;
    let cancelled = false;
    const ids = [...new Set(day.blocks.filter(block => block.kind !== 'warmup')
      .flatMap(block => block.items.flatMap(item => getWeightHistoryIds(item.exercise_id))))];
    setHistoryAvailable(false);
    void getWeightHistory(userId, ids, sessionId).then(rows => {
      if (!cancelled) { setHistory(rows); setHistoryAvailable(true); }
    }).catch(() => { if (!cancelled) setHistoryAvailable(false); });
    void getSessionSetSnapshot(sessionId).then(snapshot => {
      if (!cancelled) setServerSets(snapshot.logs.filter(
        (set): set is typeof set & { plan_item_id: string } => set.plan_item_id != null,
      ));
    }).catch(() => { /* Durable UI copies still supply feedback offline. */ });
    return () => { cancelled = true; };
  }, [userId, sessionId, day?.id]);

  useEffect(() => {
    if (loading || paused || finished) return;
    const tick = () => setNow(Date.now());
    const interval = setInterval(tick, 250);
    const app = AppState.addEventListener('change', state => { if (state === 'active') tick(); });
    return () => { clearInterval(interval); app.remove(); };
  }, [loading, paused, finished]);

  useEffect(() => {
    if (!finished || !active || completionStarted.current) return;
    completionStarted.current = true;
    let cancelled = false;
    setFinishError(null);
    const elapsed = Math.max(1, activeElapsed(active.endedAtMs ?? Date.now()));
    void queueCompletion(userId, sessionId, elapsed)
      .then(() => flushOutbox())
      .then(() => {
        if (!cancelled)
          router.replace({
            pathname: '/session/[dayId]/summary',
            params: { dayId, sessionId, elapsed: String(elapsed) },
          });
      })
      .catch((error) => {
        if (!cancelled) {
          completionStarted.current = false;
          setFinishError(
            error instanceof Error
              ? error.message
              : 'Could not finish your workout. Please retry.',
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [
    finished,
    userId,
    dayId,
    sessionId,
    active?.endedAtMs,
    router,
    finishAttempt,
  ]);

  const exercise = entry ? getExercise(entry.item.exercise_id) : null;
  const known = entry ? progress.get(entry.item.exercise_id) : undefined;
  const suggestion = exercise ? getWeightSuggestion(exercise, progress, history) : {
    weightKg: null, source: 'new' as const, sourceExerciseId: null, previousWeightKg: null,
  };
  const setKey = (set: SetLog) => `${set.plan_item_id}:${set.set_index}`;
  const recordedSets = new Map([...serverSets, ...(active?.recordedSets ?? []).map(([, set]) => set)]
    .map(set => [setKey(set), set]));
  const exerciseSets = entry ? [...recordedSets.values()].filter(set => set.exercise_id === entry.item.exercise_id) : [];
  const matchingSets = exerciseSets.filter(set => set.is_bodyweight === (exercise?.is_bodyweight ?? false));
  const latestSet = matchingSets[matchingSets.length - 1];
  const latestWeightKg = latestSet ? latestSet.is_bodyweight ? latestSet.added_load_kg : latestSet.weight_kg : null;
  const defaultWeightKg = latestWeightKg ?? suggestion.weightKg;
  const displayedSuggestion = latestWeightKg == null ? suggestion : {
    ...suggestion, weightKg: latestWeightKg, source: 'session' as const, sourceExerciseId: entry?.item.exercise_id ?? null,
  };
  const weightText = workWeight ?? (defaultWeightKg == null ? '' : String(Math.round(kgToDisplay(defaultWeightKg, units) * 10) / 10));
  const enteredWeight = Number(weightText.trim().replace(',', '.'));
  const validWeight = weightText.trim() !== '' && Number.isFinite(enteredWeight) && enteredWeight >= 0;
  const withRecordedSet = (target: QueueEntry, value: SetDraft) => {
    const next = new Map(recordedSets);
    const set = setLogFromDraft(target, value, units);
    next.set(setKey(set), set);
    return [...next.entries()];
  };
  const commit = async (patch: Parameters<typeof workouts.update>[3]) => {
    if (!active) throw new Error('Workout unavailable.');
    await draftWrites.current;
    const expected = persistedWorkout.current;
    if (!expected || expected.ownerId !== userId || expected.sessionId !== sessionId) throw new Error('Workout unavailable.');
    const saved = await workouts.update(
      userId,
      sessionId,
      { cursor, phase, snapshot: expected },
      { ...(timing ? { timing } : {}), ...patch },
    );
    if (isCurrent()) {
      persistedWorkout.current = saved;
      setWorkout(saved);
      setSnapshotError(null);
    }
    return saved;
  };
  const logDraft = async (
    target: QueueEntry,
    value: SetDraft,
  ): Promise<ProgressRow[]> => {
    const kg = displayToKg(value.weight, units);
    const set = setLogFromDraft(target, value, units);
    if (!active) throw new Error('Workout unavailable.');
    await draftWrites.current;
    const expected = persistedWorkout.current;
    if (!expected || expected.ownerId !== userId || expected.sessionId !== sessionId) throw new Error('Workout unavailable.');
    const retry = baselineRetry.current;
    if (retry?.userId === userId && retry.sessionId === sessionId
      && retry.observed.some(observed => observed.plan_item_id === set.plan_item_id && observed.set_index === set.set_index)) {
      await bootstrapSetBaselines(userId, sessionId, retry.observed, expected);
      if (isCurrent() && baselineRetry.current === retry) baselineRetry.current = null;
    }
    if (!isCurrent()) throw new Error('The workout changed. Reopen it from Home.');
    await workouts.withSnapshot(userId, expected, () => queueSet(userId, sessionId, set));
    if (isCurrent()) setPendingSync(await pendingSyncCount());
    const next = new Map(progress),
      previous = next.get(target.item.exercise_id);
    next.set(target.item.exercise_id, {
      exercise_id: target.item.exercise_id,
      last_weight_kg: kg,
      last_reps: draftMeasurement(value).reps,
      best_weight_kg: previous?.best_weight_kg ?? null,
      best_e1rm: previous?.best_e1rm ?? null,
      miss_streak: previous?.miss_streak ?? 0,
    });
    return [...next.values()];
  };
  const completeSet = async () => {
    if (!entry || !active || busy || paused || !validWeight) return;
    const seed: SetDraft = {
      reps: entry.item.seconds != null ? 0 : latestSet?.reps ?? known?.last_reps ?? entry.item.reps_high ?? 10,
      ...(entry.item.seconds != null ? { seconds: entry.item.seconds } : {}),
      weight: enteredWeight,
      asBodyweight: exercise?.is_bodyweight ?? false,
    };
    setBusy(true);
    try {
      const rows = await logDraft(entry, seed);
      const nextEntry = queue[cursor + 1];
      const endsBlock = !nextEntry || nextEntry.block.id !== entry.block.id;
      const restSeconds = timing?.block && endsBlock
        ? remainingSeconds(timing.block, Date.now()) : restAfter(entry);
      await commit({
        progress: rows,
        recordedSets: withRecordedSet(entry, seed),
        ...(timing ? { timing: { ...timing, restSeconds } } : {}),
        phase: 'resting',
        draft: seed,
        savedDraft: seed,
        restUntilMs: Date.now() + restSeconds * 1000,
      });
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch (error) {
      notify(
        'Could not save workout',
        error instanceof Error ? error.message : 'Try again.',
      );
    } finally {
      if (isCurrent()) setBusy(false);
    }
  };
  const nextPatch = () => {
    const next = queue[cursor + 1];
    const timestamp = Date.now();
    const nextTiming = timing ? { ...timing, restSeconds: undefined, recovering: false,
      ...(next && next.block.id !== timing.blockId ? {
        blockId: next.block.id,
        block: getBlockDurationSeconds(next.block) == null ? null : startDeadline(getBlockDurationSeconds(next.block)!, timestamp),
      } : {}),
    } : undefined;
    return ({
    cursor: cursor + 1,
    ...(nextTiming ? { timing: nextTiming } : {}),
    phase: 'work' as const,
    draft: null,
    savedDraft: null,
    restUntilMs: null,
    endedAtMs:
      cursor + 1 >= queue.length
        ? Math.max(active?.startedAtMs ?? 0, Date.now())
        : null,
  });
  };
  const leaveRest = async () => {
    if (!active || !entry || !draft || busy || paused) return;
    setBusy(true);
    try {
      const retry = baselineRetry.current;
      if (sameDraft(draft, active.savedDraft) && retry?.needsReview && retry.userId === userId
        && retry.sessionId === sessionId && retry.observed.some(set => set.plan_item_id === entry.item.id && set.set_index === entry.set)) {
        const expected = persistedWorkout.current;
        if (!expected) throw new Error('Workout unavailable.');
        await bootstrapSetBaselines(userId, sessionId, retry.observed, expected);
        if (isCurrent() && baselineRetry.current === retry) baselineRetry.current = null;
      }
      if (sameDraft(draft, active.savedDraft) && retry && !retry.needsReview && retry.userId === userId
        && retry.sessionId === sessionId && retry.observed.some(set => set.plan_item_id === entry.item.id && set.set_index === entry.set)) {
        await draftWrites.current;
        const expected = persistedWorkout.current;
        if (!expected) throw new Error('Workout unavailable.');
        await stageLegacyRestRecovery(userId, expected);
        if (isCurrent() && baselineRetry.current === retry) baselineRetry.current = null;
      }
      const rows = sameDraft(draft, active.savedDraft)
        ? active.progress
        : await logDraft(entry, draft);
      await commit({ ...nextPatch(), progress: rows, recordedSets: withRecordedSet(entry, draft) });
      setWorkWeight(null);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch (error) {
      notify(
        'Could not save workout',
        error instanceof Error ? error.message : 'Try again.',
      );
    } finally {
      if (isCurrent()) setBusy(false);
    }
  };
  const advanceWarmup = async () => {
    if (busy || paused) return;
    setBusy(true);
    try {
      const next = queue[cursor + 1];
      const endsBlock = !next || next.block.id !== entry?.block.id;
      if (timing?.block && endsBlock && !timing.recovering && remainingSeconds(timing.block, Date.now()) > 0) {
        await commit({ timing: { ...timing, recovering: true } });
      } else {
        await commit(nextPatch());
        setWorkWeight(null);
      }
    } catch (error) {
      notify(
        'Could not save workout',
        error instanceof Error ? error.message : 'Try again.',
      );
    } finally {
      if (isCurrent()) setBusy(false);
    }
  };
  const changeDraft = (value: SetDraft) => {
    if (!active || busy || paused) return;
    const attempt = ++draftAttempt.current;
    setWorkout({ ...active, draft: value });
    draftWrites.current = draftWrites.current.then(async () => {
      if (!isCurrent()) return;
      const expected = persistedWorkout.current;
      if (!expected || expected.ownerId !== userId || expected.sessionId !== sessionId
        || expected.cursor !== cursor || expected.phase !== phase)
        throw new Error('Your workout changed. Reopen it from Home.');
      const saved = await workouts.update(userId, sessionId,
        { cursor, phase, snapshot: expected }, { draft: value, ...(timing ? { timing } : {}) });
      if (isCurrent()) persistedWorkout.current = saved;
      if (isCurrent() && attempt === draftAttempt.current) setSnapshotError(null);
    }).catch(error => {
      if (isCurrent() && attempt === draftAttempt.current)
        setSnapshotError(error instanceof Error ? error.message : 'Could not save your changes. Retry before leaving.');
    });
  };

  if (loading)
    return (
      <Screen scroll={false} style={styles.center}>
        <ActivityIndicator color={colors.accent} />
      </Screen>
    );
  if (loadError)
    return (
      <Screen>
        <Display>Workout unavailable</Display>
        <Body style={{ marginTop: space.md }}>{loadError}</Body>
        <Button
          title="Retry"
          onPress={() => setLoadAttempt((n) => n + 1)}
          style={{ marginTop: space.lg }}
        />
        <Button
          title="Back to home"
          variant="ghost"
          onPress={() => router.replace('/(tabs)')}
        />
      </Screen>
    );
  if (!active || !day || queue.length === 0)
    return (
      <Screen>
        <Display>Session unavailable.</Display>
        <Button title="Back" variant="surface" onPress={() => router.back()} />
      </Screen>
    );
  if (finishError)
    return (
      <Screen>
        <Display>Finish your workout</Display>
        <Body style={{ marginTop: space.md }}>{finishError}</Body>
        <Muted style={{ marginTop: space.md }}>
          Your logged sets are saved on this device.
        </Muted>
        <Button
          title="Retry finish"
          onPress={() => setFinishAttempt((n) => n + 1)}
          style={{ marginTop: space.lg }}
        />
        <Button title="Review saved sets" variant="surface" onPress={() => router.replace('/(tabs)')}
          style={{ marginTop: space.md }} />
      </Screen>
    );
  if (!entry)
    return (
      <Screen scroll={false} style={styles.center}>
        <ActivityIndicator color={colors.accent} />
      </Screen>
    );

  const isWarmup = entry.block.kind === 'warmup';
  const restSeconds = timing?.restSeconds ?? restAfter(entry);
  const nextEntry = queue[cursor + 1];
  const endsBlock = !nextEntry || nextEntry.block.id !== entry.block.id;
  const partnerExercise = !endsBlock && (entry.block.kind === 'circuit' || entry.block.kind === 'superset')
    ? getExercise(nextEntry.item.exercise_id) : null;
  const blockDuration = getBlockDurationSeconds(entry.block);
  const blockRemaining = timing?.block ? remainingSeconds(timing.block, now) : 0;
  const blockOvertime = timing?.block ? Math.max(0, Math.floor(((timing.block.pausedAt ?? now) - timing.block.endAt) / 1000)) : 0;
  const targetReps = entry.item.seconds ? `${entry.item.seconds}s`
    : `${entry.item.reps_low === entry.item.reps_high ? entry.item.reps_low : `${entry.item.reps_low}–${entry.item.reps_high}`} reps`;

  const upNext: UpNext | null = nextEntry
    ? {
        exercise: getExercise(nextEntry.item.exercise_id) ?? null,
        name:
          getExercise(nextEntry.item.exercise_id)?.name ??
          nextEntry.item.exercise_id,
        set: nextEntry.set,
        setsTotal: nextEntry.setsTotal,
      }
    : null;

  const pausedTiming = (timestamp: number) => timing ? {
    ...timing, session: pauseDeadline(timing.session, timestamp),
    block: timing.block ? pauseDeadline(timing.block, timestamp) : null,
  } : undefined;
  const togglePause = async () => {
    if (!timing || busy) return;
    const timestamp = Date.now();
    const frozenAt = timing.session.pausedAt;
    const next = frozenAt == null ? pausedTiming(timestamp)! : {
      ...timing, session: resumeDeadline(timing.session, timestamp),
      block: timing.block ? resumeDeadline(timing.block, timestamp) : null,
    };
    setBusy(true);
    try {
      await commit({ timing: next,
        ...(frozenAt != null && active.restUntilMs != null ? { restUntilMs: active.restUntilMs + timestamp - frozenAt } : {}),
      });
      setNow(timestamp);
    } catch (error) {
      notify('Could not update timers', error instanceof Error ? error.message : 'Try again.');
    } finally { if (isCurrent()) setBusy(false); }
  };

  const quit = async () => {
    const leaving = await confirm({
      title: 'Pause this workout?',
      message: 'You can resume it from Home.',
      confirmLabel: 'Pause',
      cancelLabel: 'Stay',
    });
    if (!leaving || !active) return;
    try {
      await commit({ ...(active.phase === 'resting' && active.draft ? { draft: active.draft } : {}),
        ...(timing ? { timing: pausedTiming(Date.now()) } : {}),
      });
      if (isCurrent()) router.replace('/(tabs)');
    } catch (error) {
      notify(
        'Could not pause workout',
        error instanceof Error ? error.message : 'Try again.',
      );
    }
  };

  const reviewSavedSet = async () => {
    if (!active || !active.draft || busy) return;
    setBusy(true);
    try {
      const saved = await commit({ draft: active.draft });
      if (!isCurrent()) return;
      await stageLegacyRestRecovery(userId, saved);
      if (isCurrent()) router.replace('/(tabs)');
    } catch (error) {
      if (isCurrent()) notify('Could not open set recovery', error instanceof Error ? error.message : 'Your draft is preserved. Try again.');
    } finally { if (isCurrent()) setBusy(false); }
  };
  const resting = phase === 'resting' && draft != null;
  const exerciseComplete = resting && !queue.slice(cursor + 1).some(next =>
    next.block.kind !== 'warmup' && next.item.exercise_id === entry.item.exercise_id);
  const feedbackSets = draft ? [...exerciseSets.filter(set => !(set.plan_item_id === entry.item.id && set.set_index === entry.set)),
    setLogFromDraft(entry, draft, units)] : exerciseSets;
  const matchingFeedbackSets = feedbackSets.filter(set => set.is_bodyweight === draft?.asBodyweight);
  const comparableHistory = historyAvailable && draft?.asBodyweight === (exercise?.is_bodyweight ?? false);
  const deferred = baselineRetry.current;
  const needsLegacyRecovery = resting && deferred?.userId === userId && deferred.sessionId === sessionId
    && deferred.observed.some(set => set.plan_item_id === entry.item.id && set.set_index === entry.set);

  return (
    <Screen scroll={false} style={{ padding: space.lg }}>
      <View style={styles.header}>
        <View style={{ flex: 1, gap: 4 }}>
          <Overline>
            {resting
              ? 'Rest'
              : isWarmup
                ? 'Warm-up'
                : `Block ${entry.blockOrdinal} of ${entry.blockCount}`}
          </Overline>
          <ProgressBar value={(cursor + (resting ? 1 : 0)) / queue.length} />
        </View>
        <Pressable
          onPress={quit}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Leave session"
        >
          <Icon name="close" size={22} color={colors.muted} />
        </Pressable>
      </View>

      <View style={styles.timers}>
        <View style={{ flex: 1, gap: 2 }}>
          <Overline>{blockDuration == null ? 'Session' : `${entry.block.title} · ${formatClock(blockDuration)}`}</Overline>
          {blockDuration != null ? <Body style={[styles.blockClock, blockOvertime > 0 && { color: colors.warn }]}>
            {blockOvertime > 0 ? `${formatClock(blockOvertime)} overtime` : `${formatClock(blockRemaining)} remaining`}
          </Body> : null}
          <Muted>{formatClock(activeElapsed(now))} elapsed</Muted>
          {plannedSeconds > 0 ? <Muted>{formatClock(plannedSeconds)} target</Muted> : null}
        </View>
        <Button title={paused ? 'Resume' : 'Pause'} variant="surface"
          accessibilityLabel={paused ? 'Resume timers' : 'Pause timers'}
          onPress={() => { void togglePause(); }} disabled={busy} style={styles.pause} />
      </View>
      {blockOvertime > 0 && phase === 'work' ? <Muted style={{ marginTop: space.sm }}>Finish your planned sets at a controlled pace.</Muted> : null}
      {snapshotError ? <Muted>{snapshotError}</Muted> : null}
      {needsLegacyRecovery ? <>
        <Muted>This older set needs a comparison before correction. Your draft stays saved.</Muted>
        <Button title="Review saved set" variant="surface" loading={busy}
          onPress={() => { void reviewSavedSet(); }} />
      </> : null}
      {timing?.recovering ? (
        <View style={styles.recovery}>
          <Heading>Block complete · recover</Heading>
          <Muted>Rest and prepare your equipment for {nextEntry?.block.title ?? 'the end of your session'}.</Muted>
          {upNext ? <Body>Up next · {upNext.name}</Body> : null}
          <Button title={blockRemaining > 0 ? 'Skip rest' : nextEntry ? 'Next block' : 'Finish session'}
            variant={blockRemaining > 0 ? 'surface' : 'accent'} disabled={paused || busy}
            onPress={() => { void advanceWarmup(); }} />
          {blockRemaining > 0 ? <Muted>Skipping recovery shortens the session target.</Muted> : null}
        </View>
      ) : resting ? (
        <View key={`rest:${entry.key}`} style={styles.flex}>
          <RestPage
            exercise={exercise ?? null}
            setLabel={`Set ${entry.set} of ${entry.setsTotal}`}
            targetReps={targetReps}
            targetSeconds={entry.item.seconds}
            units={units}
            bodyweightCaptured={workout?.bodyweightKg !== undefined}
            bodyweightKg={workout?.bodyweightKg !== undefined ? workout.bodyweightKg : profile?.bodyweight_kg ?? null}
            restSeconds={restSeconds}
            restUntilMs={restSeconds > 0 ? active.restUntilMs : null}
            draft={draft}
            onChange={changeDraft}
            next={upNext}
            onAdvance={leaveRest}
            advancing={busy}
            paused={paused}
            pausedAtMs={timing?.session.pausedAt}
            restLabel={blockDuration != null && endsBlock ? 'Block complete · recover' : undefined}
            readyLabel={blockDuration != null && endsBlock ? nextEntry ? 'Next block' : 'Finish session' : undefined}
            feedback={exerciseComplete ? <ExerciseWeightProgressCard
              progress={exerciseWeightProgress(matchingFeedbackSets, comparableHistory ? suggestion.previousWeightKg : null)}
              units={units} isBodyweight={draft.asBodyweight} setsCompleted={matchingFeedbackSets.length}
              historyAvailable={comparableHistory} /> : undefined}
          />
        </View>
      ) : (
        <>
          <ScrollView style={styles.flex} contentContainerStyle={styles.workContent} showsVerticalScrollIndicator={false}>
          <View key={entry.key} style={styles.body}>
            {exercise?.media_refs.start ? (
              <ExerciseMedia exercise={exercise} style={styles.media} />
            ) : null}

            <View style={{ gap: space.xs, marginTop: space.lg }}>
              <Heading numberOfLines={2}>
                {exercise?.name ?? entry.item.exercise_id}
              </Heading>
              <Body style={styles.target}>{targetReps}</Body>
              {entry.item.notes ? <Muted>{entry.item.notes}</Muted> : null}
              {entry.slotSeconds != null ? <Muted>Set window {formatClock(entry.slotSeconds)} · includes work and recovery</Muted> : null}
              {exercise?.instructions?.length && !exercise.media_refs.start ? <Muted>{exercise.instructions.join(' ')}</Muted> : null}
            </View>
            {!isWarmup ? <WeightSuggestionCard suggestion={displayedSuggestion} units={units}
              value={weightText} onChangeText={setWorkWeight} isBodyweight={exercise?.is_bodyweight ?? false}
              sourceName={displayedSuggestion.sourceExerciseId && displayedSuggestion.sourceExerciseId !== exercise?.id
                ? getExercise(displayedSuggestion.sourceExerciseId)?.name : undefined} disabled={paused || busy} /> : null}
            {!historyAvailable && !isWarmup ? <Muted style={{ marginTop: space.sm }}>Earlier workout weights are unavailable. You can enter today's weight.</Muted> : null}

            {partnerExercise ? (
              <View style={styles.partner}>
                <Overline>{blockDuration != null ? 'Next in rotation' : 'Then straight into'}</Overline>
                <Body style={styles.partnerName} numberOfLines={1}>
                  {partnerExercise.name}
                </Body>
              </View>
            ) : null}
          </View>
          </ScrollView>

          <View style={styles.footer}>
            <Overline style={{ textAlign: 'center' }}>
              {isWarmup
                ? 'Move through it'
                : `Set ${entry.set} of ${entry.setsTotal}`}
            </Overline>
            <Button
              title={isWarmup ? 'Done' : 'Complete set'}
              loading={busy}
              disabled={paused || (!isWarmup && !validWeight)}
              onPress={() => {
                if (isWarmup) {
                  advanceWarmup();
                  return;
                }
                completeSet();
              }}
              style={{ marginTop: space.md }}
            />
            {pendingSync > 0 ? (
              <Muted style={{ textAlign: 'center', marginTop: space.sm }}>
                {pendingSync} set{pendingSync === 1 ? '' : 's'} syncing
              </Muted>
            ) : null}
          </View>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  body: { flex: 1, justifyContent: 'center', gap: space.md },
  workContent: { flexGrow: 1, paddingVertical: space.md },
  media: { width: '100%', aspectRatio: 1.4 },
  timers: { flexDirection: 'row', alignItems: 'center', gap: space.md,
    padding: space.md, marginTop: space.md, borderRadius: radius.md,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  blockClock: { ...type.heading, color: colors.accent, fontVariant: ['tabular-nums'] },
  pause: { minWidth: 86, paddingHorizontal: space.md },
  recovery: { flex: 1, justifyContent: 'center', gap: space.lg },
  target: { ...type.title, color: colors.accent },
  partner: {
    marginTop: space.lg,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 2,
  },
  partnerName: { ...type.body, fontWeight: '600' },
  footer: { paddingTop: space.lg },
});
