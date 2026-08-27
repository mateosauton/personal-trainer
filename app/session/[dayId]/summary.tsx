import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, View } from 'react-native';

import { Body, Button, Card, Chip, Display, Heading, Muted, Overline, Screen } from '@/components/ui';
import { useAuth, useUserId } from '@/lib/auth';
import { getExercise } from '@/lib/catalog';
import {
  finishSession, getActivePlan, getProgress, getSetLogs, upsertProgress, type ProgressRow,
} from '@/lib/db/queries';
import { nextLoad } from '@/lib/progression';
import { colors, space, type } from '@/lib/theme';
import { effectiveLoadKg, estimateOneRepMax, formatWeight } from '@/lib/units';
import type { PlanDay } from '@/lib/types';

interface Line {
  exerciseId: string;
  name: string;
  sets: number;
  volumeKg: number;
  topLoadKg: number | null;
  verdict: 'progress' | 'hold' | 'deload' | null;
  isPr: boolean;
}

export default function SessionSummary() {
  const { dayId, sessionId, elapsed } = useLocalSearchParams<{
    dayId: string; sessionId: string; elapsed: string;
  }>();
  const userId = useUserId();
  const { profile } = useAuth();
  const router = useRouter();

  const [lines, setLines] = useState<Line[]>([]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const durationS = Number.parseInt(elapsed ?? '0', 10) || 0;
  const units = profile?.units ?? 'kg';

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const [logs, plan, progress] = await Promise.all([
        getSetLogs(sessionId),
        getActivePlan(userId),
        getProgress(userId),
      ]);
      const day: PlanDay | null = plan?.days.find((d) => d.id === dayId) ?? null;
      const itemById = new Map(
        (day?.blocks ?? []).flatMap((b) => b.items.map((i) => [i.id, { item: i, block: b }])),
      );

      // Group the flat set list back into one line per exercise.
      const grouped = new Map<string, typeof logs>();
      for (const log of logs) {
        const list = grouped.get(log.exercise_id) ?? [];
        list.push(log);
        grouped.set(log.exercise_id, list);
      }

      const built: Line[] = [];
      const updates: ProgressRow[] = [];

      for (const [exerciseId, sets] of grouped) {
        const exercise = getExercise(exerciseId);
        const loads = sets.map((s) => effectiveLoadKg(s, profile?.bodyweight_kg ?? null));
        const volumeKg = sets.reduce((sum, s, i) => sum + (loads[i] ?? 0) * (s.reps ?? 0), 0);
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
        const workingLoad = sets[0].is_bodyweight ? sets[0].added_load_kg : sets[0].weight_kg;

        const verdict = context && exercise
          ? nextLoad(
              sets.map((s) => ({ reps: s.reps, rpe: s.rpe })),
              context.item.reps_high,
              context.item.reps_low,
              exercise.pattern,
              workingLoad,
              { last_weight_kg: known?.last_weight_kg ?? null, miss_streak: known?.miss_streak ?? 0 },
            )
          : null;

        const isPr = topLoadKg != null && (known?.best_weight_kg == null || topLoadKg > known.best_weight_kg);

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
            best_weight_kg: isPr ? topLoadKg : (known?.best_weight_kg ?? null),
            best_e1rm: Math.max(e1rm, known?.best_e1rm ?? 0) || null,
            miss_streak: verdict?.miss_streak ?? 0,
          });
        }
      }

      if (!cancelled) {
        pendingProgress.current = updates;
        setLines(built);
        setLoading(false);
        if (built.some((l) => l.isPr)) {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }
      }
    })().catch(() => {
      if (!cancelled) setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [sessionId, userId, dayId, profile?.bodyweight_kg]);

  const save = async () => {
    setSaving(true);
    try {
      // The effort scale is gone from the UI; the column stays nullable.
      await finishSession(sessionId, { duration_s: durationS, rpe: null });
      router.replace('/(tabs)');
    } catch (e) {
      Alert.alert('Could not save', e instanceof Error ? e.message : 'Try again.');
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

  const totalVolume = lines.reduce((sum, l) => sum + l.volumeKg, 0);
  const totalSets = lines.reduce((sum, l) => sum + l.sets, 0);

  return (
    <Screen>
      <Overline>Session complete</Overline>
      <Display style={{ marginTop: space.sm }}>Nice work.</Display>

      <Card style={{ marginTop: space.xl }}>
        <View style={styles.stats}>
          <Stat label="Minutes" value={`${Math.max(1, Math.round(durationS / 60))}`} />
          <Stat label="Sets" value={`${totalSets}`} />
          <Stat label="Volume" value={formatWeight(totalVolume, units)} />
        </View>
      </Card>

      <View style={{ gap: space.md, marginTop: space.xl }}>
        {lines.map((line) => (
          <View key={line.exerciseId} style={styles.line}>
            <View style={{ flex: 1, gap: 2 }}>
              <Body style={styles.lineName} numberOfLines={1}>
                {line.name}
              </Body>
              <Muted>
                {line.sets} sets · top {formatWeight(line.topLoadKg, units)}
              </Muted>
            </View>
            {line.isPr ? <Chip label="PR" selected /> : null}
            {!line.isPr && line.verdict === 'progress' ? <Chip label="↑ next" /> : null}
            {!line.isPr && line.verdict === 'deload' ? <Chip label="↓ next" /> : null}
          </View>
        ))}
      </View>

      <Button title="Save & finish" onPress={save} loading={saving} style={{ marginTop: space.xl }} />
    </Screen>
  );
}

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
