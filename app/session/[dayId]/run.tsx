import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { ExerciseMedia } from '@/components/ExerciseMedia';
import { RestTimer } from '@/components/RestTimer';
import { WeightSheet, type LoggedSet } from '@/components/WeightSheet';
import {
  Body, Button, Display, Heading, Muted, Overline, ProgressBar, Screen,
} from '@/components/ui';
import { useAuth, useUserId } from '@/lib/auth';
import { getExercise } from '@/lib/catalog';
import { getActivePlan, getProgress, logSet, type ProgressRow } from '@/lib/db/queries';
import { buildQueue, partnerOf, type QueueEntry } from '@/lib/session/queue';
import { colors, radius, space, type } from '@/lib/theme';
import { formatWeight } from '@/lib/units';
import type { PlanDay } from '@/lib/types';

type Phase = 'work' | 'logging' | 'resting';

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
    // Ran off the end: everything logged, go summarise.
    router.replace({
      pathname: '/session/[dayId]/summary',
      params: { dayId, sessionId, elapsed: String(Math.round((Date.now() - startedAt.current) / 1000)) },
    });
    return null;
  }

  const exercise = getExercise(entry.item.exercise_id);
  const partner = partnerOf(entry);
  const partnerExercise = partner ? getExercise(partner.exercise_id) : null;
  const isWarmup = entry.block.kind === 'warmup';
  const units = profile?.units ?? 'kg';
  const known = progress.get(entry.item.exercise_id);

  const targetReps = entry.item.seconds
    ? `${entry.item.seconds}s`
    : `${entry.item.reps_low}–${entry.item.reps_high} reps`;

  const advance = () => {
    setPhase('work');
    setCursor((c) => c + 1);
  };

  const nextLabel = (() => {
    const next = queue[cursor + 1];
    if (!next) return 'Session summary';
    const nextExercise = getExercise(next.item.exercise_id);
    return `${nextExercise?.name ?? 'Next'} · set ${next.set} of ${next.setsTotal}`;
  })();

  const onLogged = async (set: LoggedSet) => {
    try {
      await logSet(sessionId, {
        plan_item_id: entry.item.id,
        exercise_id: entry.item.exercise_id,
        set_index: entry.set,
        ...set,
      });
      // Keep the prefill fresh so later sets of the same exercise suggest what
      // was actually just lifted, not what the previous session did.
      setProgress((prev) => {
        const next = new Map(prev);
        const existing = next.get(entry.item.exercise_id);
        next.set(entry.item.exercise_id, {
          exercise_id: entry.item.exercise_id,
          last_weight_kg: set.is_bodyweight ? set.added_load_kg : set.weight_kg,
          last_reps: set.reps,
          best_weight_kg: existing?.best_weight_kg ?? null,
          best_e1rm: existing?.best_e1rm ?? null,
          miss_streak: existing?.miss_streak ?? 0,
        });
        return next;
      });
    } catch (e) {
      Alert.alert('Could not save that set', e instanceof Error ? e.message : 'Try again.');
      setPhase('work');
      return;
    }
    const rest = entry.block.rest_seconds;
    if (rest > 0 && cursor + 1 < queue.length) setPhase('resting');
    else advance();
  };

  const quit = () => {
    Alert.alert('Leave this session?', 'Sets you already logged are saved.', [
      { text: 'Stay', style: 'cancel' },
      { text: 'Leave', style: 'destructive', onPress: () => router.replace('/(tabs)') },
    ]);
  };

  return (
    <Screen scroll={false} style={{ padding: space.lg }}>
      <View style={styles.header}>
        <View style={{ flex: 1, gap: 4 }}>
          <Overline>
            {isWarmup ? 'Warm-up' : `Block ${entry.blockOrdinal} of ${entry.blockCount}`}
          </Overline>
          <ProgressBar value={cursor / queue.length} />
        </View>
        <Pressable onPress={quit} hitSlop={12} accessibilityLabel="Leave session">
          <Muted style={styles.close}>Close</Muted>
        </Pressable>
      </View>

      <Animated.View key={entry.key} entering={FadeIn.duration(220)} exiting={FadeOut.duration(120)} style={styles.body}>
        {exercise ? (
          <ExerciseMedia exercise={exercise} paused={phase !== 'work'} style={styles.media} />
        ) : null}

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
        {phase === 'resting' ? (
          <RestTimer seconds={entry.block.rest_seconds} nextLabel={nextLabel} onDone={advance} />
        ) : (
          <>
            <Overline style={{ textAlign: 'center' }}>
              {isWarmup ? 'Move through it' : `Set ${entry.set} of ${entry.setsTotal}`}
            </Overline>
            <Button
              title={isWarmup ? 'Done' : 'Complete set'}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                if (isWarmup) advance();
                else setPhase('logging');
              }}
              style={{ marginTop: space.md }}
            />
          </>
        )}
      </View>

      {exercise ? (
        <WeightSheet
          visible={phase === 'logging'}
          exercise={exercise}
          units={units}
          bodyweightKg={profile?.bodyweight_kg ?? null}
          targetReps={targetReps}
          suggestedKg={known?.last_weight_kg ?? null}
          suggestedReps={known?.last_reps ?? entry.item.reps_high}
          setLabel={`Set ${entry.set} of ${entry.setsTotal}`}
          onCancel={() => setPhase('work')}
          onSubmit={onLogged}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
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
