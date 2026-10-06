import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, ReduceMotion } from 'react-native-reanimated';

import { DoodlePop } from '@/components/Doodle';
import {
  Body,
  Button,
  Card,
  Chip,
  Display,
  Heading,
  Muted,
  Overline,
  Screen,
} from '@/components/ui';
import { notify } from '@/lib/alerts';
import { useAuth, useUserId } from '@/lib/auth';
import { getExercise } from '@/lib/catalog';
import {
  applySessionProgress,
  getSessionProgressResult,
  getSessionPlanDay,
  getProgress,
  getSessionSetSnapshot,
  type ProgressRow,
  type SessionSummaryLine,
} from '@/lib/db/queries';
import {
  failedSyncCount,
  flushOutbox,
  pendingSyncCount,
} from '@/lib/session/sync';
import { workouts } from '@/lib/session/workout';
import { nextLoad } from '@/lib/progression';
import { colors, space, type } from '@/lib/theme';
import { motion } from '@/lib/motion';
import { effectiveLoadKg, estimateOneRepMax, formatWeight } from '@/lib/units';
import type { Units } from '@/lib/types';

export default function SessionSummary() {
  const { dayId, sessionId, elapsed } = useLocalSearchParams<{
    dayId: string;
    sessionId: string;
    elapsed: string;
  }>();
  const userId = useUserId();
  const { profile } = useAuth();
  const router = useRouter();

  const [lines, setLines] = useState<SessionSummaryLine[]>([]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  const durationS = Number.parseInt(elapsed ?? '0', 10) || 0;
  const profileUnits = profile?.units ?? 'kg';
  const [units, setUnits] = useState<Units>(profileUnits);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      // A failed send leaves operations queued even though flush resolves.
      // Never derive future loads from a partial server view of this workout.
      await flushOutbox();
      if ((await failedSyncCount(sessionId)) > 0) {
        throw new Error(
          'Some sets could not sync. Retry workout sync from Home before saving this summary.',
        );
      }
      if ((await pendingSyncCount(sessionId)) > 0) {
        throw new Error(
          'Your workout is still syncing. Reconnect and retry to see all your sets.',
        );
      }
      if (cancelled) return;
      const previous = await getSessionProgressResult(sessionId);
      if (cancelled) return;
      if (previous !== null) {
        setUnits(profileUnits);
        await workouts.clear(userId, sessionId);
        if (cancelled) return;
        setLines(previous);
        setLoading(false);
        return;
      }
      const local = await workouts.read(userId);
      if (cancelled) return;
      const captured = local?.sessionId === sessionId ? local : null;
      const calculationUnits = captured?.units ?? profileUnits;
      const bodyweightKg =
        captured?.bodyweightKg !== undefined
          ? captured.bodyweightKg
          : (profile?.bodyweight_kg ?? null);
      setUnits(calculationUnits);
      const day = await getSessionPlanDay(sessionId, userId);
      if (!day)
        throw new Error(
          'Could not load the original workout day. Please retry.',
        );
      const itemById = new Map(
        (day?.blocks ?? []).flatMap((b) =>
          b.items.map((i) => [i.id, { item: i, block: b }]),
        ),
      );

      for (let attempt = 0; attempt < 3; attempt += 1) {
        // A stale snapshot retry must refresh sets as well as progression.
        const [snapshot, progress] = await Promise.all([
          getSessionSetSnapshot(sessionId),
          getProgress(userId),
        ]);
        if (cancelled) return;
        const logs = snapshot.logs;
        const grouped = new Map<string, typeof logs>();
        for (const log of logs) {
          const list = grouped.get(log.exercise_id) ?? [];
          list.push(log);
          grouped.set(log.exercise_id, list);
        }
        const built: SessionSummaryLine[] = [];
        const updates: ProgressRow[] = [];

        for (const [exerciseId, sets] of grouped) {
          const exercise = getExercise(exerciseId);
          const loads = sets.map((s) => effectiveLoadKg(s, bodyweightKg));
          const volumeKg = sets.reduce(
            (sum, s, i) => sum + (loads[i] ?? 0) * (s.reps ?? 0),
            0,
          );
          const topLoadKg = loads.reduce<number | null>(
            (best, l) => (l != null && (best == null || l > best) ? l : best),
            null,
          );

          const e1rm = sets.reduce((best, s, i) => {
            const load = loads[i];
            if (load == null || !s.reps) return best;
            return Math.max(best, estimateOneRepMax(load, s.reps));
          }, 0);

          const known = progress.get(exerciseId);
          const context = itemById.get(sets[0].plan_item_id ?? '');
          const workingLoad = sets[0].is_bodyweight
            ? sets[0].added_load_kg
            : sets[0].weight_kg;

          const verdict =
            context && exercise
              ? nextLoad(
                  sets.map((s) => ({ reps: s.reps, rpe: s.rpe })),
                  context.item.reps_high,
                  context.item.reps_low,
                  exercise.pattern,
                  workingLoad,
                  {
                    last_weight_kg: known?.last_weight_kg ?? null,
                    miss_streak: known?.miss_streak ?? 0,
                  },
                  calculationUnits,
                )
              : null;

          const isPr =
            topLoadKg != null &&
            (known?.best_weight_kg == null || topLoadKg > known.best_weight_kg);

          built.push({
            exerciseId,
            name: exercise?.name ?? exerciseId,
            sets: sets.length,
            volumeKg,
            topLoadKg,
            verdict: verdict?.verdict ?? null,
            isPr,
          });

          // Warm-ups carry no load and should never move a working weight.
          if (context && context.block.kind !== 'warmup') {
            updates.push({
              exercise_id: exerciseId,
              last_weight_kg: verdict?.last_weight_kg ?? workingLoad,
              last_reps: sets[sets.length - 1].reps,
              best_weight_kg: isPr
                ? topLoadKg
                : (known?.best_weight_kg ?? null),
              best_e1rm: Math.max(e1rm, known?.best_e1rm ?? 0) || null,
              miss_streak: verdict?.miss_streak ?? 0,
            });
          }
        }

        if (!cancelled) {
          let saved: SessionSummaryLine[];
          try {
            saved = await applySessionProgress(
              sessionId,
              updates.map((row) => ({
                exercise_id: row.exercise_id,
                state: progress.get(row.exercise_id) ?? null,
              })),
              updates,
              built,
              snapshot.versions,
            );
          } catch (error) {
            if ((error as { code?: string }).code === '40001' && attempt < 2)
              continue;
            throw error;
          }
          if (cancelled) return;
          await workouts.clear(userId, sessionId);
          if (cancelled) return;
          setLines(saved);
          setLoading(false);
          if (saved.some((l) => l.isPr)) {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          }
          return;
        }
      }
    })().catch((error: unknown) => {
      if (!cancelled) {
        setError(
          error instanceof Error
            ? error.message
            : 'Could not load your workout. Please retry.',
        );
        setLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [sessionId, userId, dayId, profile?.bodyweight_kg, profileUnits, retry]);

  const save = async () => {
    setSaving(true);
    try {
      // The effort scale is gone from the UI; the column stays nullable.
      router.replace('/(tabs)');
    } catch (e) {
      notify('Could not save', e instanceof Error ? e.message : 'Try again.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Screen scroll={false} style={styles.center}>
        <ActivityIndicator color={colors.accent} />
      </Screen>
    );
  }

  if (error) {
    return (
      <Screen scroll={false} style={styles.center}>
        <Heading>Summary unavailable</Heading>
        <Body style={{ marginTop: space.md }}>{error}</Body>
        <Button
          title="Retry"
          onPress={() => setRetry((value) => value + 1)}
          style={{ marginTop: space.lg }}
        />
        <Button
          title="Back to home"
          variant="ghost"
          onPress={() => router.replace('/(tabs)')}
        />
      </Screen>
    );
  }

  const totalVolume = lines.reduce((sum, l) => sum + l.volumeKg, 0);
  const totalSets = lines.reduce((sum, l) => sum + l.sets, 0);

  return (
    <Screen>
      <Overline>Session complete</Overline>
      <Display style={{ marginTop: space.sm }}>Nice work.</Display>

      <Animated.View
        entering={FadeIn.duration(motion.base).reduceMotion(
          ReduceMotion.System,
        )}
      >
        <Card style={{ marginTop: space.xl }}>
          <View style={styles.stats}>
            <Stat
              label="Minutes"
              value={`${Math.max(1, Math.round(durationS / 60))}`}
            />
            <Stat label="Sets" value={`${totalSets}`} />
            <Stat label="Volume" value={formatWeight(totalVolume, units)} />
          </View>
        </Card>
      </Animated.View>

      <View style={{ gap: space.md, marginTop: space.xl }}>
        {lines.map((line, index) => (
          <Animated.View
            key={line.exerciseId}
            entering={FadeIn.delay(index * 55)
              .duration(motion.base)
              .reduceMotion(ReduceMotion.System)}
            style={styles.line}
          >
            <View style={{ flex: 1, gap: 2 }}>
              <Body style={styles.lineName} numberOfLines={1}>
                {line.name}
              </Body>
              <Muted>
                {line.sets} sets · top {formatWeight(line.topLoadKg, units)}
              </Muted>
            </View>
            {line.isPr ? (
              <DoodlePop>
                {/* The badge carries the number that earned it: a bare "PR" makes
                    you go looking for the weight it is talking about. */}
                <Chip label={prLabel(line.topLoadKg, units)} selected />
              </DoodlePop>
            ) : null}
            {!line.isPr && line.verdict === 'progress' ? (
              <Chip label="↑ next" />
            ) : null}
            {!line.isPr && line.verdict === 'deload' ? (
              <Chip label="↓ next" />
            ) : null}
          </Animated.View>
        ))}
      </View>

      <Button
        title="Done"
        onPress={save}
        loading={saving}
        style={{ marginTop: space.xl }}
      />
    </Screen>
  );
}

/** Bodyweight work with nothing added has no weight worth printing. */
const prLabel = (topLoadKg: number | null, units: Units) =>
  topLoadKg ? `PR ${formatWeight(topLoadKg, units)}` : 'PR';

const Stat = ({ label, value }: { label: string; value: string }) => (
  <View style={{ gap: 2 }}>
    <Heading>{value}</Heading>
    <Overline>{label}</Overline>
  </View>
);

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  stats: { flexDirection: 'row', justifyContent: 'space-between' },
  line: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  lineName: { ...type.body, fontWeight: '600' },
});
