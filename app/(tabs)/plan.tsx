import { useRouter } from 'expo-router';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { ExerciseMedia } from '@/components/ExerciseMedia';
import { Body, Button, Card, Display, Muted, Overline, Screen } from '@/components/ui';
import { useUserId } from '@/lib/auth';
import { getExercise } from '@/lib/catalog';
import { colors, space, type } from '@/lib/theme';
import { usePlan } from '@/lib/usePlan';

export default function PlanTab() {
  const userId = useUserId();
  const router = useRouter();
  const { plan, nextDay, loading } = usePlan(userId);

  if (loading) {
    return (
      <Screen scroll={false} style={styles.center}>
        <ActivityIndicator color={colors.accent} />
      </Screen>
    );
  }

  if (!plan) {
    return (
      <Screen>
        <Display>No plan yet.</Display>
        <Muted style={{ marginTop: space.md }}>Build one from your profile.</Muted>
      </Screen>
    );
  }

  return (
    <Screen>
      <Overline>Your plan</Overline>
      <Display style={{ marginTop: space.sm }}>{plan.name}</Display>
      <Muted style={{ marginTop: space.sm }}>
        {plan.days.length} days a week · {plan.weeks} week block
      </Muted>

      <View style={{ gap: space.lg, marginTop: space.xl }}>
        {plan.days.map((day) => {
          const isNext = day.id === nextDay?.id;
          const work = day.blocks.filter((b) => b.kind !== 'warmup');
          const cover = getExercise(work[0]?.items[0]?.exercise_id ?? '');
          return (
            <Card key={day.id} style={isNext ? styles.nextCard : undefined}>
              <View style={styles.cardHead}>
                {cover ? <ExerciseMedia exercise={cover} style={styles.thumb} paused /> : null}
                <View style={{ flex: 1, gap: 2 }}>
                  <Overline style={isNext ? { color: colors.accent } : undefined}>
                    {isNext ? 'Up next' : `Day ${day.day_index + 1}`}
                  </Overline>
                  <Body style={styles.dayName}>{day.name}</Body>
                  <Muted>{day.focus}</Muted>
                </View>
              </View>

              <View style={{ gap: space.xs, marginTop: space.lg }}>
                {work.map((block) => (
                  <Muted key={block.id} numberOfLines={1}>
                    {block.title.replace(/^Block \d+ · /, '')} ·{' '}
                    {block.items.map((i) => getExercise(i.exercise_id)?.name ?? '').join(', ')}
                  </Muted>
                ))}
              </View>

              <Button
                title={isNext ? 'Start this session' : 'View session'}
                variant={isNext ? 'accent' : 'surface'}
                onPress={() => router.push(`/session/${day.id}`)}
                style={{ marginTop: space.lg }}
              />
            </Card>
          );
        })}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  nextCard: { borderColor: colors.accent },
  cardHead: { flexDirection: 'row', gap: space.md, alignItems: 'center' },
  thumb: { width: 64, height: 64 },
  dayName: { ...type.heading },
});
