import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { ReduceMotion, SlideInRight, SlideOutLeft } from 'react-native-reanimated';

import { ExerciseMedia } from '@/components/ExerciseMedia';
import { ExerciseWeightProgressCard, WeightSuggestionCard } from '@/components/ExerciseWeight';
import { Icon } from '@/components/Icon';
import { RestPage, type SetDraft, type UpNext } from '@/components/RestPage';
import {
  Body, Button, Display, Heading, Muted, Overline, ProgressBar, Screen,
} from '@/components/ui';
import { confirm, notify } from '@/lib/alerts';
import { useAuth, useUserId } from '@/lib/auth';
import { getExercise } from '@/lib/catalog';
import { getActivePlan, getProgress, getWeightHistory, type ProgressRow } from '@/lib/db/queries';
import { formatClock, getBlockDurationSeconds } from '@/lib/plan/timing';
import { flushOutbox, pendingSyncCount, queueCompletion, queueSet } from '@/lib/session/sync';
import { buildQueue, type QueueEntry } from '@/lib/session/queue';
import { pauseDeadline, remainingSeconds, resumeDeadline, startDeadline, type Deadline } from '@/lib/session/timing';
import { colors, radius, space, type } from '@/lib/theme';
import { motion } from '@/lib/motion';
import { displayToKg, kgToDisplay } from '@/lib/units';
import { exerciseWeightProgress, getWeightHistoryIds, getWeightSuggestion, type ExerciseWeightHistory } from '@/lib/weights';
import type { PlanDay, SetLog, Units } from '@/lib/types';

type Phase = 'work' | 'resting' | 'recovering';

const sameDraft = (a: SetDraft | null, b: SetDraft | null) =>
  a != null && b != null
  && a.reps === b.reps && a.weight === b.weight && a.asBodyweight === b.asBodyweight;

const setLogFromDraft = (target: QueueEntry, value: SetDraft, units: Units): SetLog => {
  const kg = displayToKg(value.weight, units);
  return {
    plan_item_id: target.item.id,
    exercise_id: target.item.exercise_id,
    set_index: target.set,
    reps: target.item.seconds != null ? null : value.reps,
    weight_kg: value.asBodyweight ? null : kg,
    is_bodyweight: value.asBodyweight,
    added_load_kg: value.asBodyweight ? kg : 0,
    rpe: null,
  };
};

export default function SessionRun() {
  const { dayId, sessionId } = useLocalSearchParams<{ dayId: string; sessionId: string }>();
  const userId = useUserId();
  const { profile } = useAuth();
  const router = useRouter();

  const [day, setDay] = useState<PlanDay | null>(null);
  const [progress, setProgress] = useState<Map<string, ProgressRow>>(new Map());
  const [history, setHistory] = useState<Map<string, ExerciseWeightHistory>>(new Map());
  const [historyAvailable, setHistoryAvailable] = useState(true);
  const [recordedSets, setRecordedSets] = useState<Map<string, SetLog>>(new Map());
  const [workWeight, setWorkWeight] = useState<string | null>(null);
  const [cursor, setCursor] = useState(0);
  const [phase, setPhase] = useState<Phase>('work');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<SetDraft | null>(null);
  const [pendingSync, setPendingSync] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [paused, setPaused] = useState(false);
  const [sessionClock, setSessionClock] = useState<Deadline | null>(null);
  const [blockClock, setBlockClock] = useState<Deadline | null>(null);
  const [restSeconds, setRestSeconds] = useState(0);
  /** What is actually in set_logs for the set being rested on. */
  const savedRef = useRef<SetDraft | null>(null);
  const startedAt = useRef(Date.now());
  const completionStarted = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setHistoryAvailable(true);
    setDay(null);
    setProgress(new Map());
    setHistory(new Map());
    setRecordedSets(new Map());
    setWorkWeight(null);
    setCursor(0);
    setDraft(null);
    setPhase('work');
    completionStarted.current = false;
    void (async () => {
      const [plan, rows] = await Promise.all([getActivePlan(userId), getProgress(userId)]);
      const selected = plan?.days.find((d) => d.id === dayId) ?? null;
      const ids = [...new Set((selected?.blocks ?? [])
        .filter((block) => block.kind !== 'warmup')
        .flatMap((block) => block.items.flatMap((item) => getWeightHistoryIds(item.exercise_id))))];
      let previous = new Map<string, ExerciseWeightHistory>();
      let available = true;
      try {
        previous = await getWeightHistory(userId, ids, sessionId);
      } catch {
        available = false;
      }
      if (cancelled) return;
      setDay(selected);
      setProgress(rows);
      setHistory(previous);
      setHistoryAvailable(available);
    })()
      .catch((error: unknown) => {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : 'Could not load the session.');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [userId, dayId, sessionId]);

  const queue = useMemo(() => (day ? buildQueue(day) : []), [day]);
  const entry: QueueEntry | undefined = queue[cursor];
  const finished = !loading && queue.length > 0 && cursor >= queue.length;
  const plannedSeconds = day?.blocks.reduce((sum, block) => sum + (getBlockDurationSeconds(block) ?? 0), 0) ?? 0;

  useEffect(() => {
    if (!day) return;
    const timestamp = Date.now();
    startedAt.current = timestamp;
    setSessionClock(startDeadline(plannedSeconds, timestamp));
    setNow(timestamp);
  }, [day, plannedSeconds]);

  useEffect(() => {
    if (!entry) return;
    const duration = getBlockDurationSeconds(entry.block);
    const timestamp = Date.now();
    const clock = duration == null ? null : startDeadline(duration, timestamp);
    setBlockClock(clock && paused ? pauseDeadline(clock, timestamp) : clock);
    setNow(timestamp);
  }, [entry?.block.id]);

  useEffect(() => {
    if (loading || paused || finished) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [loading, paused, finished]);

  const activeElapsed = (timestamp: number) => sessionClock
    ? Math.max(0, Math.floor(plannedSeconds + ((sessionClock.pausedAt ?? timestamp) - sessionClock.endAt) / 1000))
    : Math.max(0, Math.floor((timestamp - startedAt.current) / 1000));

  // Running off the end means everything is logged. Navigating is a side
  // effect, so it belongs here and not in the render pass.
  useEffect(() => {
    if (!finished || completionStarted.current) return;
    completionStarted.current = true;
    const elapsed = Math.max(1, activeElapsed(Date.now()));
    void queueCompletion(sessionId, elapsed)
      .then(() => flushOutbox())
      .then(() => {
        router.replace({ pathname: '/session/[dayId]/summary', params: { dayId, sessionId, elapsed: String(elapsed) } });
      })
      .catch((error: unknown) => {
        completionStarted.current = false;
        notify('Could not finish session', error instanceof Error ? error.message : 'Try again.');
      });
  }, [finished, dayId, sessionId, router]);

  const units = profile?.units ?? 'kg';
  const exercise = entry ? getExercise(entry.item.exercise_id) : null;
  const suggestion = exercise ? getWeightSuggestion(exercise, progress, history) : {
    weightKg: null, source: 'new' as const, sourceExerciseId: null, previousWeightKg: null,
  };
  const exerciseSets = entry ? [...recordedSets.values()]
    .filter((set) => set.exercise_id === entry.item.exercise_id) : [];
  const matchingSets = exerciseSets.filter((set) => set.is_bodyweight === (exercise?.is_bodyweight ?? false));
  const latestSet = matchingSets[matchingSets.length - 1];
  const latestWeightKg = latestSet
    ? latestSet.is_bodyweight ? latestSet.added_load_kg : latestSet.weight_kg
    : null;
  const defaultWeightKg = latestWeightKg ?? suggestion.weightKg;
  const displayedSuggestion = latestWeightKg == null ? suggestion : {
    ...suggestion, weightKg: latestWeightKg, source: 'session' as const,
    sourceExerciseId: entry?.item.exercise_id ?? null,
  };
  const weightText = workWeight ?? (defaultWeightKg == null
    ? '' : String(Math.round(kgToDisplay(defaultWeightKg, units) * 10) / 10));
  const enteredWeight = Number(weightText.trim().replace(',', '.'));
  const validWeight = weightText.trim() !== '' && Number.isFinite(enteredWeight) && enteredWeight >= 0;

  /**
   * Writes the set. Upserting on (session, item, set index) means the first
   * write on entering rest and any later correction land on the same row.
   */
  const save = useCallback(
    async (target: QueueEntry, value: SetDraft): Promise<boolean> => {
      const set = setLogFromDraft(target, value, units);
      try {
        await queueSet(sessionId, set);
        setPendingSync(await pendingSyncCount());
      } catch (e) {
        notify('Could not save that set', e instanceof Error ? e.message : 'Try again.');
        return false;
      }
      // Corrections replace a set; historical targets and comparison baselines
      // stay unchanged throughout this workout.
      setRecordedSets((prev) => {
        const map = new Map(prev);
        map.set(target.key, set);
        return map;
      });
      return true;
    },
    [sessionId, units],
  );

  if (loading) {
    return (
      <Screen scroll={false} style={styles.center}>
        <ActivityIndicator color={colors.accent} />
      </Screen>
    );
  }

  if (!day || queue.length === 0) {
    return (
      <Screen>
        <Display>Session unavailable.</Display>
        {loadError ? <Muted style={{ marginTop: space.md }}>{loadError}</Muted> : null}
        <Button title="Back" variant="surface" onPress={() => router.back()} style={{ marginTop: space.xl }} />
      </Screen>
    );
  }

  if (!entry) {
    // The effect above is on its way to the summary.
    return (
      <Screen scroll={false} style={styles.center}>
        <ActivityIndicator color={colors.accent} />
      </Screen>
    );
  }

  const isWarmup = entry.block.kind === 'warmup';
  const blockDuration = getBlockDurationSeconds(entry.block);
  const blockRemaining = blockClock ? remainingSeconds(blockClock, now) : 0;
  const blockOvertime = blockClock
    ? Math.max(0, Math.floor(((blockClock.pausedAt ?? now) - blockClock.endAt) / 1000))
    : 0;

  const targetReps = entry.item.seconds
    ? `${entry.item.seconds}s`
    : `${entry.item.reps_low === entry.item.reps_high ? entry.item.reps_low : `${entry.item.reps_low}–${entry.item.reps_high}`} reps`;

  const advance = () => {
    setWorkWeight(null);
    setDraft(null);
    savedRef.current = null;
    setPhase('work');
    setCursor((c) => c + 1);
  };

  const nextEntry = queue[cursor + 1];
  const endsBlock = !nextEntry || nextEntry.block.id !== entry.block.id;
  const partnerExercise = !endsBlock && (entry.block.kind === 'circuit' || entry.block.kind === 'superset')
    ? getExercise(nextEntry.item.exercise_id)
    : null;
  const upNext: UpNext | null = nextEntry
    ? {
        exercise: getExercise(nextEntry.item.exercise_id) ?? null,
        name: getExercise(nextEntry.item.exercise_id)?.name ?? nextEntry.item.exercise_id,
        set: nextEntry.set,
        setsTotal: nextEntry.setsTotal,
      }
    : null;

  /** Complete set: log what we already know, then hand over to the rest page. */
  const completeSet = async () => {
    if (!validWeight || busy) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const seed: SetDraft = {
      reps: entry.item.seconds != null ? 0 : latestSet?.reps ?? entry.item.reps_high ?? 10,
      weight: enteredWeight,
      asBodyweight: exercise?.is_bodyweight ?? false,
    };
    setBusy(true);
    const ok = await save(entry, seed);
    setBusy(false);
    if (!ok) return;
    setDraft(seed);
    savedRef.current = seed;
    // The final recovery belongs to this block's time budget. Moving through
    // the sets quickly does not silently remove its planned recovery.
    setRestSeconds(blockClock && endsBlock
      ? remainingSeconds(blockClock, Date.now())
      : entry.restSeconds ?? entry.block.rest_seconds);
    setPhase('resting');
  };

  const completeWarmup = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (blockClock && endsBlock && blockRemaining > 0) {
      setPhase('recovering');
      return;
    }
    advance();
  };

  const togglePause = () => {
    const timestamp = Date.now();
    const update = paused ? resumeDeadline : pauseDeadline;
    setSessionClock((clock) => clock ? update(clock, timestamp) : null);
    setBlockClock((clock) => clock ? update(clock, timestamp) : null);
    setNow(timestamp);
    setPaused(!paused);
  };

  /** Leaving rest: flush any correction the user made before moving on. */
  const leaveRest = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (draft && !sameDraft(draft, savedRef.current)) {
      setBusy(true);
      const ok = await save(entry, draft);
      setBusy(false);
      if (!ok) return;
      savedRef.current = draft;
    }
    advance();
  };

  const quit = async () => {
    const leaving = await confirm({
      title: 'Leave this session?',
      message: 'Sets you already logged are saved.',
      confirmLabel: 'Leave',
      cancelLabel: 'Stay',
      destructive: true,
    });
    if (leaving) router.replace('/(tabs)');
  };

  const resting = phase === 'resting' && draft != null;
  const exerciseComplete = resting && !queue.slice(cursor + 1).some((next) =>
    next.block.kind !== 'warmup' && next.item.exercise_id === entry.item.exercise_id);
  const feedbackSets = draft
    ? [...exerciseSets.filter((set) => !(set.plan_item_id === entry.item.id && set.set_index === entry.set)),
      setLogFromDraft(entry, draft, units)]
    : exerciseSets;
  const matchingFeedbackSets = feedbackSets.filter((set) => set.is_bodyweight === draft?.asBodyweight);
  const comparableHistory = historyAvailable && draft?.asBodyweight === (exercise?.is_bodyweight ?? false);

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
        <Pressable onPress={quit} hitSlop={12} accessibilityRole="button" accessibilityLabel="Leave session">
          <Icon name="close" size={22} color={colors.muted} />
        </Pressable>
      </View>

      <View style={styles.timers}>
        <View style={{ flex: 1, gap: 2 }}>
          <Overline>{blockDuration == null ? 'Session' : `${entry.block.title} · ${formatClock(blockDuration)}`}</Overline>
          {blockDuration != null ? (
            <Body style={[styles.blockClock, blockOvertime > 0 && { color: colors.warn }]}>
              {blockOvertime > 0 ? `${formatClock(blockOvertime)} overtime` : `${formatClock(blockRemaining)} remaining`}
            </Body>
          ) : null}
          <Muted>{formatClock(activeElapsed(now))} elapsed</Muted>
          {plannedSeconds > 0 ? <Muted>{formatClock(plannedSeconds)} target</Muted> : null}
        </View>
        <Button
          title={paused ? 'Resume' : 'Pause'}
          variant="surface"
          accessibilityLabel={paused ? 'Resume timers' : 'Pause timers'}
          onPress={togglePause}
          disabled={busy}
          style={styles.pause}
        />
      </View>

      {blockOvertime > 0 && phase === 'work' ? (
        <Muted style={{ marginTop: space.sm }}>Finish your planned sets at a controlled pace.</Muted>
      ) : null}

      {phase === 'recovering' ? (
        <View style={styles.recovery}>
          <Heading>Block complete · recover</Heading>
          <Muted>Rest and prepare your equipment for {nextEntry?.block.title ?? 'the end of your session'}.</Muted>
          {upNext ? <Body>Up next · {upNext.name}</Body> : null}
          <Button
            title={blockRemaining > 0 ? 'Skip rest' : nextEntry ? 'Next block' : 'Finish session'}
            variant={blockRemaining > 0 ? 'surface' : 'accent'}
            disabled={paused}
            onPress={advance}
          />
          {blockRemaining > 0 ? <Muted>Skipping recovery shortens the session target.</Muted> : null}
        </View>
      ) : resting ? (
        <Animated.View
          key={`rest:${entry.key}`}
          entering={SlideInRight.duration(motion.base).springify().damping(motion.settle.damping).reduceMotion(ReduceMotion.System)}
          style={styles.flex}
        >
          <RestPage
            exercise={exercise ?? null}
            setLabel={`Set ${entry.set} of ${entry.setsTotal}`}
            targetReps={targetReps}
            units={units}
            bodyweightKg={profile?.bodyweight_kg ?? null}
            restSeconds={restSeconds}
            draft={draft}
            onChange={setDraft}
            next={upNext}
            onAdvance={leaveRest}
            advancing={busy}
            paused={paused}
            restLabel={blockDuration != null && endsBlock ? 'Block complete · recover' : undefined}
            readyLabel={blockDuration != null && endsBlock ? nextEntry ? 'Next block' : 'Finish session' : undefined}
            timedSeconds={entry.item.seconds}
            feedback={exerciseComplete ? (
              <ExerciseWeightProgressCard
                progress={exerciseWeightProgress(matchingFeedbackSets, comparableHistory ? suggestion.previousWeightKg : null)}
                units={units}
                isBodyweight={draft.asBodyweight}
                setsCompleted={matchingFeedbackSets.length}
                historyAvailable={comparableHistory}
              />
            ) : undefined}
          />
        </Animated.View>
      ) : (
        <>
          <ScrollView style={styles.flex} contentContainerStyle={styles.workContent} showsVerticalScrollIndicator={false}>
          <Animated.View
            key={entry.key}
            entering={SlideInRight.duration(motion.base).springify().damping(motion.settle.damping).reduceMotion(ReduceMotion.System)}
            exiting={SlideOutLeft.duration(motion.fast).reduceMotion(ReduceMotion.System)}
            style={styles.body}
          >
            {exercise?.media_refs.start ? <ExerciseMedia exercise={exercise} style={styles.media} paused={paused} /> : null}

            <View style={{ gap: space.xs, marginTop: space.lg }}>
              <Heading>{exercise?.name ?? entry.item.exercise_id}</Heading>
              <Body style={styles.target}>{targetReps}</Body>
              {entry.item.notes ? <Muted>{entry.item.notes}</Muted> : null}
              {entry.slotSeconds != null ? <Muted>Set window {formatClock(entry.slotSeconds)} · includes work and recovery</Muted> : null}
              {exercise?.instructions?.length && !exercise.media_refs.start ? (
                <Muted>{exercise.instructions.join(' ')}</Muted>
              ) : null}
            </View>

            {!isWarmup ? (
              <WeightSuggestionCard
                suggestion={displayedSuggestion}
                units={units}
                value={weightText}
                onChangeText={setWorkWeight}
                isBodyweight={exercise?.is_bodyweight ?? false}
                sourceName={displayedSuggestion.sourceExerciseId && displayedSuggestion.sourceExerciseId !== exercise?.id
                  ? getExercise(displayedSuggestion.sourceExerciseId)?.name : undefined}
                disabled={paused || busy}
              />
            ) : null}
            {!historyAvailable && !isWarmup ? (
              <Muted style={{ marginTop: space.sm }}>Earlier workout weights are unavailable. You can enter today's weight.</Muted>
            ) : null}

            {partnerExercise ? (
              <View style={styles.partner}>
                <Overline>{blockDuration != null ? 'Next in rotation' : 'Then straight into'}</Overline>
                <Body style={styles.partnerName} numberOfLines={1}>
                  {partnerExercise.name}
                </Body>
              </View>
            ) : null}
          </Animated.View>
          </ScrollView>

          <View style={styles.footer}>
            <Overline style={{ textAlign: 'center' }}>
              {isWarmup ? 'Move through it' : `Set ${entry.set} of ${entry.setsTotal}`}
            </Overline>
            <Button
              title={isWarmup ? 'Done' : 'Complete set'}
              loading={busy}
              disabled={paused || (!isWarmup && !validWeight)}
              onPress={() => {
                if (isWarmup) {
                  completeWarmup();
                  return;
                }
                completeSet();
              }}
              style={{ marginTop: space.md }}
            />
            {pendingSync > 0 ? <Muted style={{ textAlign: 'center', marginTop: space.sm }}>{pendingSync} set{pendingSync === 1 ? '' : 's'} syncing</Muted> : null}
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
  timers: {
    flexDirection: 'row', alignItems: 'center', gap: space.md,
    padding: space.md, marginTop: space.md, borderRadius: radius.md,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
  },
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
