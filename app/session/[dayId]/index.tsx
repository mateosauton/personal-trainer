import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { ExerciseMedia } from '@/components/ExerciseMedia';
import { Body, Button, Card, Display, Muted, Overline, Screen } from '@/components/ui';
import { useUserId } from '@/lib/auth';
import { getExercise } from '@/lib/catalog';
import { getActivePlan, startSession } from '@/lib/db/queries';
import { prefetchUrls } from '@/lib/media/provider';
import { colors, space, type } from '@/lib/theme';
import type { PlanDay } from '@/lib/types';

/** Pre-session overview: what you are about to do, then one button. */
export default function SessionOverview() {
  const { dayId } = useLocalSearchParams<{ dayId: string }>();
  const userId = useUserId();
  const router = useRouter();

  const [day, setDay] = useState<PlanDay | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getActivePlan(userId)
      .then((plan) => {
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
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load the session'))
      .finally(() => setLoading(false));
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
        <Muted style={{ marginTop: space.md }}>{error ?? 'That session is no longer in your plan.'}</Muted>
        <Button title="Back" variant="surface" onPress={() => router.back()} style={{ marginTop: space.xl }} />
      </Screen>
    );
  }

  const begin = async () => {
    setStarting(true);
    try {
      const sessionId = await startSession(userId, day.id);
      router.replace({ pathname: '/session/[dayId]/run', params: { dayId: day.id, sessionId } });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start the session');
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
                    <ExerciseMedia exercise={exercise} style={styles.thumb} paused />
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

      <Button title="Begin" onPress={begin} loading={starting} style={{ marginTop: space.xl }} />
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
