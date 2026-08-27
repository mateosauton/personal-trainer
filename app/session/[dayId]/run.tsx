import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { ExerciseMedia } from '@/components/ExerciseMedia';
import { RestPage, type SetDraft, type UpNext } from '@/components/RestPage';
import {
  Body, Button, Display, Heading, Muted, Overline, ProgressBar, Screen,
} from '@/components/ui';
import { useAuth, useUserId } from '@/lib/auth';
import { getExercise } from '@/lib/catalog';
import { getActivePlan, getProgress, logSet, type ProgressRow } from '@/lib/db/queries';
import { buildQueue, partnerOf, type QueueEntry } from '@/lib/session/queue';
import { colors, radius, space, type } from '@/lib/theme';
import { displayToKg, formatWeight, kgToDisplay } from '@/lib/units';
import type { PlanDay, SetLog } from '@/lib/types';

type Phase = 'work' | 'resting';

const sameDraft = (a: SetDraft | null, b: SetDraft | null) =>
  a != null && b != null
  && a.reps === b.reps && a.weight === b.weight && a.asBodyweight === b.asBodyweight;

export default function SessionRun() {
  const { dayId, sessionId } = useLocalSearchParams<{ dayId: string; sessionId: string }>();
  const userId = useUserId();
  const { profile } = useAuth();
  const router = useRouter();

  const [day, setDay] = useState<PlanDay | null>(null);
  const [progress, setProgress] = useState<Map<string, ProgressRow>>(new Map());
  const [cursor, setCursor] = useState(0);
  const [phase, setPhase] = useState<Phase>('work');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<SetDraft | null>(null);
  /** What is actually in set_logs for the set being rested on. */
  const savedRef = useRef<SetDraft | null>(null);
  const startedAt = useRef(Date.now());

  useEffect(() => {
    Promise.all([getActivePlan(userId), getProgress(userId)])
      .then(([plan, rows]) => {
        setDay(plan?.days.find((d) => d.id === dayId) ?? null);
        setProgress(rows);
      })
      .finally(() => setLoading(false));
  }, [userId, dayId]);

  const queue = useMemo(() => (day ? buildQueue(day) : []), [day]);
  const entry: QueueEntry | undefined = queue[cursor];
  const finished = !loading && queue.length > 0 && cursor >= queue.length;

  // Running off the end means everything is logged. Navigating is a side
  // effect, so it belongs here and not in the render pass.
  useEffect(() => {
    if (!finished) return;
    router.replace({
      pathname: '/session/[dayId]/summary',
      params: {
        dayId,
        sessionId,
        elapsed: String(Math.round((Date.now() - startedAt.current) / 1000)),
      },
    });
  }, [finished, dayId, sessionId, router]);

  const units = profile?.units ?? 'kg';
  const exercise = entry ? getExercise(entry.item.exercise_id) : null;
  const known = entry ? progress.get(entry.item.exercise_id) : undefined;

  /**
   * Writes the set. Upserting on (session, item, set index) means the first
   * write on entering rest and any later correction land on the same row.
   */
  const save = useCallback(
    async (target: QueueEntry, value: SetDraft): Promise<boolean> => {
      const kg = displayToKg(value.weight, units);
      const set: SetLog = {
        plan_item_id: target.item.id,
        exercise_id: target.item.exercise_id,
        set_index: target.set,
        reps: value.reps,
        weight_kg: value.asBodyweight ? null : kg,
        is_bodyweight: value.asBodyweight,
        added_load_kg: value.asBodyweight ? kg : 0,
        // The effort scale is gone; progression treats a null as manageable.
        rpe: null,
      };
      try {
        await logSet(sessionId, set);
      } catch (e) {
        Alert.alert('Could not save that set', e instanceof Error ? e.message : 'Try again.');
        return false;
      }
      // Keep the prefill fresh so later sets of the same exercise suggest what
      // was actually just lifted, not what the previous session did.
      setProgress((prev) => {
        const map = new Map(prev);
        const existing = map.get(target.item.exercise_id);
        map.set(target.item.exercise_id, {
          exercise_id: target.item.exercise_id,
          last_weight_kg: kg,
          last_reps: value.reps,
          best_weight_kg: existing?.best_weight_kg ?? null,
          best_e1rm: existing?.best_e1rm ?? null,
          miss_streak: existing?.miss_streak ?? 0,
        });
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

  const partner = partnerOf(entry);
  const partnerExercise = partner ? getExercise(partner.exercise_id) : null;
  const isWarmup = entry.block.kind === 'warmup';

  const targetReps = entry.item.seconds
    ? `${entry.item.seconds}s`
    : `${entry.item.reps_low}–${entry.item.reps_high} reps`;

  const advance = () => {
    setDraft(null);
    savedRef.current = null;
    setPhase('work');
    setCursor((c) => c + 1);
  };

  const nextEntry = queue[cursor + 1];
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
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const seed: SetDraft = {
      reps: known?.last_reps ?? entry.item.reps_high ?? 10,
      weight: known?.last_weight_kg != null
        ? Math.round(kgToDisplay(known.last_weight_kg, units) * 10) / 10
        : 0,
      asBodyweight: exercise?.is_bodyweight ?? false,
    };
    setBusy(true);
    const ok = await save(entry, seed);
    setBusy(false);
    if (!ok) return;
    setDraft(seed);
    savedRef.current = seed;
    setPhase('resting');
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

  const quit = () => {
    Alert.alert('Leave this session?', 'Sets you already logged are saved.', [
      { text: 'Stay', style: 'cancel' },
      { text: 'Leave', style: 'destructive', onPress: () => router.replace('/(tabs)') },
    ]);
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
        <Pressable onPress={quit} hitSlop={12} accessibilityLabel="Leave session">
          <Muted style={styles.close}>Close</Muted>
        </Pressable>
      </View>

      {resting ? (
        <Animated.View key={`rest:${entry.key}`} entering={FadeIn.duration(220)} style={styles.flex}>
          <RestPage
            exercise={exercise ?? null}
            setLabel={`Set ${entry.set} of ${entry.setsTotal}`}
            targetReps={targetReps}
            units={units}
            bodyweightKg={profile?.bodyweight_kg ?? null}
            restSeconds={entry.block.rest_seconds}
            draft={draft}
            onChange={setDraft}
            next={upNext}
            onAdvance={leaveRest}
            advancing={busy}
          />
        </Animated.View>
      ) : (
        <>
          <Animated.View
            key={entry.key}
            entering={FadeIn.duration(220)}
            exiting={FadeOut.duration(120)}
            style={styles.body}
          >
            {exercise ? <ExerciseMedia exercise={exercise} style={styles.media} /> : null}

            <View style={{ gap: space.xs, marginTop: space.lg }}>
              <Heading numberOfLines={2}>{exercise?.name ?? entry.item.exercise_id}</Heading>
              <Body style={styles.target}>{targetReps}</Body>
              {entry.item.notes ? <Muted>{entry.item.notes}</Muted> : null}
              {known?.last_weight_kg != null ? (
                <Muted>Last time · {formatWeight(known.last_weight_kg, units)}</Muted>
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
              {isWarmup ? 'Move through it' : `Set ${entry.set} of ${entry.setsTotal}`}
            </Overline>
            <Button
              title={isWarmup ? 'Done' : 'Complete set'}
              loading={busy}
              onPress={() => {
                if (isWarmup) {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  advance();
                  return;
                }
                completeSet();
              }}
              style={{ marginTop: space.md }}
            />
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
  close: { ...type.overline, color: colors.muted },
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
