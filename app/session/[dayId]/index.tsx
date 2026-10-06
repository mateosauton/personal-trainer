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
import { getActivePlan, getProgress, startSession } from '@/lib/db/queries';
import type { SavedWorkout } from '@/lib/session/workout-store';
import { workouts } from '@/lib/session/workout';
import { prefetchUrls } from '@/lib/media/provider';
import { colors, space, type } from '@/lib/theme';
import type { PlanDay } from '@/lib/types';

/** Pre-session overview: what you are about to do, then one button. */
export default function SessionOverview() {
  const { dayId } = useLocalSearchParams<{ dayId: string }>();
  const userId = useUserId();
  const { profile } = useAuth();
  const pendingStart = useRef<SavedWorkout | null>(null);
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
    getActivePlan(userId)
      .then((plan) => {
        if (cancelled) return;
        const found = plan?.days.find((d) => d.id === dayId) ?? null;
        setDay(found);
        if (found) {
          // Warm the remote stills now so the first set is never a grey box.
          const exercises = found.blocks
            .flatMap((b) => b.items)
            .map((i) => getExercise(i.exercise_id))
            .filter((e): e is NonNullable<typeof e> => e != null);
          Image.prefetch(prefetchUrls(exercises)).catch(() => {});
        }
      })
      .catch((e) => {
        if (!cancelled)
          setError(
            e instanceof Error ? e.message : 'Could not load the session',
          );
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
      const saved = await workouts.read(userId);
      if (!isCurrent()) return;
      if (saved) {
        router.replace({
          pathname: '/session/[dayId]/run',
          params: { dayId: saved.day.id, sessionId: saved.sessionId },
        });
        return;
      }
      let candidate = pendingStart.current;
      if (
        !candidate ||
        candidate.ownerId !== userId ||
        candidate.day.id !== day.id
      ) {
        const progress = await getProgress(userId);
        if (!isCurrent()) return;
        const startedAtMs = Date.now();
        const sessionId = await startSession(userId, day.id);
        candidate = {
          version: 1,
          ownerId: userId,
          sessionId,
          day,
          units: profile?.units ?? 'kg',
          progress: [...progress.values()],
          cursor: 0,
          phase: 'work',
          draft: null,
          savedDraft: null,
          restUntilMs: null,
          startedAtMs,
          endedAtMs: null,
        };
        pendingStart.current = candidate;
      }
      // Keep the created session recoverable even if its account changed while starting.
      const persisted = await workouts.create(candidate);
      if (!isCurrent()) return;
      pendingStart.current = null;
      router.replace({
        pathname: '/session/[dayId]/run',
        params: { dayId: persisted.day.id, sessionId: persisted.sessionId },
      });
    } catch (e) {
      if (!isCurrent()) return;
      setStartError(
        e instanceof Error ? e.message : 'Could not start the session',
      );
      setStarting(false);
    }
  };

  return (
    <Screen>
      <Overline>Up next</Overline>
      <Display style={{ marginTop: space.sm }}>{day.name}</Display>
      <Muted style={{ marginTop: space.sm }}>{day.focus}</Muted>

      <View style={{ gap: space.lg, marginTop: space.xl }}>
        {day.blocks.map((block) => (
          <Card key={block.id}>
            <Overline>{block.title}</Overline>
            <Muted style={{ marginTop: 2 }}>
              {block.kind === 'warmup'
                ? 'Move through once'
                : block.kind === 'straight'
                  ? `Rest ${block.rest_seconds}s between sets`
                  : `${block.rounds} rounds · rest ${block.rest_seconds}s`}
            </Muted>

            <View style={{ gap: space.md, marginTop: space.lg }}>
              {block.items.map((item) => {
                const exercise = getExercise(item.exercise_id);
                if (!exercise) return null;
                const dose = item.seconds
                  ? `${item.seconds}s`
                  : block.kind === 'straight'
                    ? `${item.sets} × ${item.reps_low}–${item.reps_high}`
                    : `${item.reps_low}–${item.reps_high}`;
                return (
                  <View key={item.id} style={styles.itemRow}>
                    <ExerciseMedia
                      exercise={exercise}
                      style={styles.thumb}
                      paused
                    />
                    <View style={{ flex: 1, gap: 2 }}>
                      <Body style={styles.itemName} numberOfLines={2}>
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
