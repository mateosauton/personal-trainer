import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  ReduceMotion,
  SlideInRight,
  SlideOutLeft,
} from 'react-native-reanimated';

import { ExerciseMedia } from '@/components/ExerciseMedia';
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
  type ProgressRow,
} from '@/lib/db/queries';
import {
  flushOutbox,
  bootstrapSetBaselines,
  pendingSyncCount,
  queueCompletion,
  queueSet,
} from '@/lib/session/sync';
import { buildQueue, partnerOf, type QueueEntry } from '@/lib/session/queue';
import { colors, radius, space, type } from '@/lib/theme';
import { motion } from '@/lib/motion';
import { displayToKg, formatWeight, kgToDisplay } from '@/lib/units';
import { workouts } from '@/lib/session/workout';
import type { SavedWorkout } from '@/lib/session/workout-store';
import type { SetLog } from '@/lib/types';

const sameDraft = (a: SetDraft | null, b: SetDraft | null) =>
  a != null &&
  b != null &&
  a.reps === b.reps &&
  a.weight === b.weight &&
  a.asBodyweight === b.asBodyweight;

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
  const identity = useRef({ userId, sessionId });
  identity.current = { userId, sessionId };
  const isCurrent = () =>
    identity.current.userId === userId &&
    identity.current.sessionId === sessionId;
  const baselineRetry = useRef<{ userId: string; sessionId: string; observed: SetLog[] } | null>(null);
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
  const finished =
    !loading && active != null && queue.length > 0 && cursor >= queue.length;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setBusy(false);
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
          set_index: restingEntry.set, reps: value.reps,
          weight_kg: value.asBodyweight ? null : kg, is_bodyweight: value.asBodyweight,
          added_load_kg: value.asBodyweight ? kg : 0, rpe: null,
        }];
        try { await bootstrapSetBaselines(userId, sessionId, observed, saved); }
        catch (error) {
          const message = (error as { message?: string })?.message ?? '';
          if ((error as { code?: string })?.code !== 'PT409'
            && !/network request failed|failed to fetch|offline|baseline read timed out/i.test(message)) throw error;
          if (cancelled || !isCurrent()) return;
          baselineRetry.current = { userId, sessionId, observed };
        }
      }
      if (!cancelled) { persistedWorkout.current = saved; setWorkout(saved); }
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
    if (!finished || !active || completionStarted.current) return;
    completionStarted.current = true;
    let cancelled = false;
    setFinishError(null);
    const elapsed = Math.max(
      1,
      Math.round(
        ((active.endedAtMs ?? Date.now()) - active.startedAtMs) / 1000,
      ),
    );
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
  const commit = async (patch: Parameters<typeof workouts.update>[3]) => {
    if (!active) throw new Error('Workout unavailable.');
    await draftWrites.current;
    const expected = persistedWorkout.current;
    if (!expected || expected.ownerId !== userId || expected.sessionId !== sessionId) throw new Error('Workout unavailable.');
    const saved = await workouts.update(
      userId,
      sessionId,
      { cursor, phase, snapshot: expected },
      patch,
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
    const set: SetLog = {
      plan_item_id: target.item.id,
      exercise_id: target.item.exercise_id,
      set_index: target.set,
      reps: value.reps,
      weight_kg: value.asBodyweight ? null : kg,
      is_bodyweight: value.asBodyweight,
      added_load_kg: value.asBodyweight ? kg : 0,
      rpe: null,
    };
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
      last_reps: value.reps,
      best_weight_kg: previous?.best_weight_kg ?? null,
      best_e1rm: previous?.best_e1rm ?? null,
      miss_streak: previous?.miss_streak ?? 0,
    });
    return [...next.values()];
  };
  const completeSet = async () => {
    if (!entry || !active || busy) return;
    const seed: SetDraft = {
      reps: known?.last_reps ?? entry.item.reps_high ?? 10,
      weight:
        known?.last_weight_kg != null
          ? Math.round(kgToDisplay(known.last_weight_kg, units) * 10) / 10
          : 0,
      asBodyweight: exercise?.is_bodyweight ?? false,
    };
    setBusy(true);
    try {
      const rows = await logDraft(entry, seed);
      await commit({
        progress: rows,
        phase: 'resting',
        draft: seed,
        savedDraft: seed,
        restUntilMs: Date.now() + entry.block.rest_seconds * 1000,
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
  const nextPatch = () => ({
    cursor: cursor + 1,
    phase: 'work' as const,
    draft: null,
    savedDraft: null,
    restUntilMs: null,
    endedAtMs:
      cursor + 1 >= queue.length
        ? Math.max(active?.startedAtMs ?? 0, Date.now())
        : null,
  });
  const leaveRest = async () => {
    if (!active || !entry || !draft || busy) return;
    setBusy(true);
    try {
      const rows = sameDraft(draft, active.savedDraft)
        ? active.progress
        : await logDraft(entry, draft);
      await commit({ ...nextPatch(), progress: rows });
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
    if (busy) return;
    setBusy(true);
    try {
      await commit(nextPatch());
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
    if (!active || busy) return;
    const attempt = ++draftAttempt.current;
    setWorkout({ ...active, draft: value });
    draftWrites.current = draftWrites.current.then(async () => {
      if (!isCurrent()) return;
      const expected = persistedWorkout.current;
      if (!expected || expected.ownerId !== userId || expected.sessionId !== sessionId
        || expected.cursor !== cursor || expected.phase !== phase)
        throw new Error('Your workout changed. Reopen it from Home.');
      const saved = await workouts.update(userId, sessionId,
        { cursor, phase, snapshot: expected }, { draft: value });
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
      </Screen>
    );
  if (!entry)
    return (
      <Screen scroll={false} style={styles.center}>
        <ActivityIndicator color={colors.accent} />
      </Screen>
    );

  const partner = partnerOf(entry);
  const partnerExercise = partner ? getExercise(partner.exercise_id) : null;
  const isWarmup = entry.block.kind === 'warmup';

  const targetReps = entry.item.seconds
    ? `${entry.item.seconds}s`
    : `${entry.item.reps_low}–${entry.item.reps_high} reps`;

  const nextEntry = queue[cursor + 1];
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

  const quit = async () => {
    const leaving = await confirm({
      title: 'Pause this workout?',
      message: 'You can resume it from Home.',
      confirmLabel: 'Pause',
      cancelLabel: 'Stay',
    });
    if (!leaving || !active) return;
    try {
      if (active.phase === 'resting' && active.draft)
        await commit({ draft: active.draft });
      if (isCurrent()) router.replace('/(tabs)');
    } catch (error) {
      notify(
        'Could not pause workout',
        error instanceof Error ? error.message : 'Try again.',
      );
    }
  };

  const resting = phase === 'resting' && draft != null;

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
          accessibilityLabel="Leave session"
        >
          <Icon name="close" size={22} color={colors.muted} />
        </Pressable>
      </View>

      {snapshotError ? <Muted>{snapshotError}</Muted> : null}
      {resting ? (
        <Animated.View
          key={`rest:${entry.key}`}
          entering={SlideInRight.duration(motion.base)
            .springify()
            .damping(motion.settle.damping)
            .reduceMotion(ReduceMotion.System)}
          style={styles.flex}
        >
          <RestPage
            exercise={exercise ?? null}
            setLabel={`Set ${entry.set} of ${entry.setsTotal}`}
            targetReps={targetReps}
            units={units}
            bodyweightCaptured={workout?.bodyweightKg !== undefined}
            bodyweightKg={workout?.bodyweightKg !== undefined ? workout.bodyweightKg : profile?.bodyweight_kg ?? null}
            restSeconds={entry.block.rest_seconds}
            restUntilMs={active?.restUntilMs}
            draft={draft}
            onChange={changeDraft}
            next={upNext}
            onAdvance={leaveRest}
            advancing={busy}
          />
        </Animated.View>
      ) : (
        <>
          <Animated.View
            key={entry.key}
            entering={SlideInRight.duration(motion.base)
              .springify()
              .damping(motion.settle.damping)
              .reduceMotion(ReduceMotion.System)}
            exiting={SlideOutLeft.duration(motion.fast).reduceMotion(
              ReduceMotion.System,
            )}
            style={styles.body}
          >
            {exercise ? (
              <ExerciseMedia exercise={exercise} style={styles.media} />
            ) : null}

            <View style={{ gap: space.xs, marginTop: space.lg }}>
              <Heading numberOfLines={2}>
                {exercise?.name ?? entry.item.exercise_id}
              </Heading>
              <Body style={styles.target}>{targetReps}</Body>
              {entry.item.notes ? <Muted>{entry.item.notes}</Muted> : null}
              {known?.last_weight_kg != null ? (
                <Muted>
                  Last time · {formatWeight(known.last_weight_kg, units)}
                </Muted>
              ) : null}
            </View>

            {partnerExercise ? (
              <View style={styles.partner}>
                <Overline>Then straight into</Overline>
                <Body style={styles.partnerName} numberOfLines={1}>
                  {partnerExercise.name}
                </Body>
              </View>
            ) : null}
          </Animated.View>

          <View style={styles.footer}>
            <Overline style={{ textAlign: 'center' }}>
              {isWarmup
                ? 'Move through it'
                : `Set ${entry.set} of ${entry.setsTotal}`}
            </Overline>
            <Button
              title={isWarmup ? 'Done' : 'Complete set'}
              loading={busy}
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
  body: { flex: 1, justifyContent: 'center' },
  media: { width: '100%' },
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
