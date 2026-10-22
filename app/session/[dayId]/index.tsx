import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { ExerciseMedia } from '@/components/ExerciseMedia';
import {
  Body,
  Button,
  Card,
  Display,
  Muted,
  Overline,
  Screen,
} from '@/components/ui';
import { useAuth, useUserId } from '@/lib/auth';
import { getExercise } from '@/lib/catalog';
import { getActivePlan, getProgress, type ProgressRow } from '@/lib/db/queries';
import { planCache } from '@/lib/session/plan-cache';
import { startWorkout } from '@/lib/session/sync';
import { prefetchUrls } from '@/lib/media/provider';
import { formatClock, getBlockDurationSeconds } from '@/lib/plan/timing';
import { colors, space, type } from '@/lib/theme';
import type { PlanDay } from '@/lib/types';

/** Pre-session overview: what you are about to do, then one button. */
export default function SessionOverview() {
  const { dayId } = useLocalSearchParams<{ dayId: string }>();
  const userId = useUserId();
  const { profile } = useAuth();
  const router = useRouter();
  const identity = `${userId}:${dayId}`;
  const currentIdentity = useRef(identity);
  currentIdentity.current = identity;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const [day, setDay] = useState<PlanDay | null>(null);
  const [progress, setProgress] = useState<ProgressRow[]>([]);
  const [usingCachedPlan, setUsingCachedPlan] = useState(false);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setStartError(null);
    setStarting(false);
    setDay(null);
    setProgress([]);
    setUsingCachedPlan(false);
    (async () => {
      const cached = await planCache.read(userId).catch(() => null);
      if (cancelled) return;
      const cachedDay = cached?.plan.days.find((candidate) => candidate.id === dayId);
      if (cached && cachedDay) {
        setDay(cachedDay);
        setProgress(cached.progress);
        setUsingCachedPlan(true);
        setLoading(false);
      }
      // A cached prescription can start while either refresh request is stalled.
      const [planResult, progressResult] = await Promise.allSettled([
        getActivePlan(userId), getProgress(userId),
      ]);
      if (cancelled) return;
      let plan = planResult.status === 'fulfilled' ? planResult.value : cached?.plan;
      if (planResult.status === 'rejected' && !plan) throw planResult.reason;
      let progressRows = progressResult.status === 'fulfilled'
        ? [...progressResult.value.values()] : cached?.progress ?? [];
      let showCachedPlan = planResult.status === 'rejected';
      let accepted: boolean | null = null;
      if (planResult.status === 'fulfilled') {
        if (!plan) accepted = await planCache.clear(userId, cached).catch(() => null);
        else if (progressResult.status === 'fulfilled')
          accepted = await planCache.write(userId, plan, progressRows, undefined, cached).catch(() => null);
      }
      if (cancelled) return;
      if (accepted === false) {
        const winner = await planCache.read(userId);
        if (cancelled) return;
        plan = winner?.plan ?? null;
        progressRows = winner?.progress ?? [];
        showCachedPlan = winner !== null;
      }
      const found = plan?.days.find((d) => d.id === dayId) ?? null;
      setDay(found);
      setProgress(progressRows);
      setUsingCachedPlan(showCachedPlan);
      if (found) {
        const exercises = found.blocks.flatMap((b) => b.items)
          .map((i) => getExercise(i.exercise_id))
          .filter((e): e is NonNullable<typeof e> => e != null);
        Image.prefetch(prefetchUrls(exercises)).catch(() => {});
      }
    })()
      .catch((e) => {
        if (!cancelled)
          setError(e instanceof Error ? e.message : 'Could not load the session');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [userId, dayId]);

  if (loading) {
    return (
      <Screen scroll={false} style={styles.center}>
        <ActivityIndicator color={colors.accent} />
      </Screen>
    );
  }

  if (error || !day) {
    return (
      <Screen>
        <Display>Not found.</Display>
        <Muted style={{ marginTop: space.md }}>
          {error ?? 'That session is no longer in your plan.'}
        </Muted>
        <Button
          title="Back"
          variant="surface"
          onPress={() => router.back()}
          style={{ marginTop: space.xl }}
        />
      </Screen>
    );
  }

  const begin = async () => {
    const isCurrent = () =>
      mounted.current && currentIdentity.current === identity;
    setStarting(true);
    setStartError(null);
    try {
      const saved = await startWorkout(userId, day, {
        units: profile?.units ?? 'kg',
        bodyweightKg: profile?.bodyweight_kg ?? null,
        progress,
      });
      if (!isCurrent()) return;
      router.replace({
        pathname: '/session/[dayId]/run',
        params: { dayId: saved.day.id, sessionId: saved.sessionId },
      });
    } catch (e) {
      if (!isCurrent()) return;
      setStartError(
        e instanceof Error ? e.message : 'Could not start the session',
      );
      setStarting(false);
    }
  };
  const targetSeconds = day.blocks.reduce((sum, block) => sum + (getBlockDurationSeconds(block) ?? 0), 0);

  return (
    <Screen>
      {usingCachedPlan && <Muted style={{ marginBottom: space.md }}>Using your saved plan. Your workout will sync when you reconnect.</Muted>}
      <Overline>Up next</Overline>
      <Display style={{ marginTop: space.sm }}>{day.name}</Display>
      <Muted style={{ marginTop: space.sm }}>{day.focus}</Muted>
      {targetSeconds > 0 ? (
        <View style={{ marginTop: space.lg, gap: space.sm }}>
          <Body>{Math.round(targetSeconds / 60)} min target · {day.blocks.filter((block) => block.kind !== 'warmup').length} timed blocks</Body>
          <Muted>Work, recovery and equipment changes share each block's time. Rest windows adapt to the exercises and reps. Complete every set manually.</Muted>
        </View>
      ) : null}

      <View style={{ gap: space.lg, marginTop: space.xl }}>
        {day.blocks.map((block) => (
          <Card key={block.id}>
            <Overline>{block.title}{getBlockDurationSeconds(block) != null ? ` · ${formatClock(getBlockDurationSeconds(block)!)}` : ''}</Overline>
            <Muted style={{ marginTop: 2 }}>
              {getBlockDurationSeconds(block) != null
                ? block.kind === 'warmup' ? 'Move through once · easy pace'
                  : block.kind === 'straight' ? 'Finish each exercise’s sets, then move on · timed recovery'
                    : `${block.rounds} round${block.rounds === 1 ? '' : 's'} · rotate exercises · timed recovery`
                : block.kind === 'warmup'
                ? 'Move through once'
                : block.kind === 'straight'
                  ? `Rest ${block.rest_seconds}s between sets`
                  : `${block.rounds} round${block.rounds === 1 ? '' : 's'} · rest ${block.rest_seconds}s`}
            </Muted>

            <View style={{ gap: space.md, marginTop: space.lg }}>
              {block.items.map((item) => {
                const exercise = getExercise(item.exercise_id);
                if (!exercise) return null;
                const sets = block.kind === 'straight' || block.kind === 'warmup' ? item.sets : block.rounds;
                const reps = item.reps_low === item.reps_high ? `${item.reps_low}` : `${item.reps_low}–${item.reps_high}`;
                const dose = item.seconds
                  ? `${sets} × ${item.seconds}s`
                  : `${sets} × ${reps}`;
                return (
                  <View key={item.id} style={styles.itemRow}>
                    <ExerciseMedia
                      exercise={exercise}
                      style={styles.thumb}
                    />
                    <View style={{ flex: 1, gap: 2 }}>
                      <Body style={styles.itemName}>
                        {exercise.name}
                      </Body>
                      <Muted>
                        {dose}
                        {item.notes ? ` · ${item.notes}` : ''}
                      </Muted>
                    </View>
                  </View>
                );
              })}
            </View>
          </Card>
        ))}
      </View>

      {startError && (
        <Muted style={{ marginTop: space.md }}>{startError}</Muted>
      )}
      <Button
        title={startError ? 'Retry start' : 'Begin'}
        onPress={begin}
        loading={starting}
        style={{ marginTop: space.xl }}
      />
      <Button variant="ghost" title="Not now" onPress={() => router.back()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  itemRow: { flexDirection: 'row', gap: space.md, alignItems: 'center' },
  thumb: { width: 56, height: 56 },
  itemName: { ...type.body, fontWeight: '600' },
});
