import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { ExerciseMedia } from '@/components/ExerciseMedia';
import { Body, Button, Card, Display, Heading, Muted, Overline, Screen } from '@/components/ui';
import { useAuth, useUserId } from '@/lib/auth';
import { getExercise } from '@/lib/catalog';
import { colors, space, type } from '@/lib/theme';
import { usePlan } from '@/lib/usePlan';

export default function Today() {
  const userId = useUserId();
  const { profile } = useAuth();
  const router = useRouter();
  const { plan, nextDay, completedCount, loading, error, reload } = usePlan(userId);

  // Coming back from a finished session must move the rotation on.
  useFocusEffect(useCallback(() => reload(), [reload]));

  if (loading) {
    return (
      <Screen scroll={false} style={styles.center}>
        <ActivityIndicator color={colors.accent} />
      </Screen>
    );
  }

  if (error || !plan || !nextDay) {
    return (
      <Screen>
        <Overline>Today</Overline>
        <Display style={{ marginTop: space.sm }}>No plan yet.</Display>
        <Muted style={{ marginTop: space.md }}>
          {error ?? 'Build one from your profile to get started.'}
        </Muted>
        <Button
          title="Go to profile"
          onPress={() => router.push('/(tabs)/profile')}
          style={{ marginTop: space.xl }}
        />
      </Screen>
    );
  }

  const workBlocks = nextDay.blocks.filter((b) => b.kind !== 'warmup');
  const warmup = nextDay.blocks.find((b) => b.kind === 'warmup');
  const totalSets = workBlocks.reduce(
    (sum, b) => sum + b.items.reduce((s, i) => s + i.sets, 0) * b.rounds,
    0,
  );
  // The first work exercise stands in as the session's cover image.
  const hero = getExercise(workBlocks[0]?.items[0]?.exercise_id ?? '');

  return (
    <Screen>
      <Overline>Session {completedCount + 1}</Overline>
      <Display style={{ marginTop: space.sm }}>{nextDay.name}</Display>
      <Muted style={{ marginTop: space.sm }}>
        {nextDay.focus} · {plan.split}
      </Muted>

      <Card style={styles.hero}>
        {hero ? <ExerciseMedia exercise={hero} style={styles.heroMedia} /> : null}
        <View style={styles.stats}>
          <Stat label="Blocks" value={`${workBlocks.length}`} />
          <Stat label="Sets" value={`${totalSets}`} />
          <Stat label="Minutes" value={`${profile?.session_minutes ?? 45}`} />
        </View>
      </Card>

      <View style={styles.list}>
        {warmup ? (
          <Row title="Warm-up" detail={`${warmup.items.length} drills`} muted />
        ) : null}
        {workBlocks.map((block) => (
          <Row
            key={block.id}
            title={block.title}
            detail={block.items
              .map((i) => getExercise(i.exercise_id)?.name ?? i.exercise_id)
              .join(' · ')}
          />
        ))}
      </View>

      <Button
        title="Start session"
        onPress={() => router.push(`/session/${nextDay.id}`)}
        style={{ marginTop: space.xl }}
      />
    </Screen>
  );
}

const Stat = ({ label, value }: { label: string; value: string }) => (
  <View style={{ gap: 2 }}>
    <Heading>{value}</Heading>
    <Overline>{label}</Overline>
  </View>
);

const Row = ({ title, detail, muted }: { title: string; detail: string; muted?: boolean }) => (
  <View style={styles.row}>
    <Body style={[styles.rowTitle, muted && { color: colors.muted }]}>{title}</Body>
    <Muted numberOfLines={2} style={styles.rowDetail}>
      {detail}
    </Muted>
  </View>
);

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  hero: { marginTop: space.xl, padding: space.md, gap: space.lg },
  heroMedia: { width: '100%' },
  stats: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: space.sm },
  list: { marginTop: space.xl, gap: space.md },
  row: {
    borderLeftWidth: 2,
    borderLeftColor: colors.accent,
    paddingLeft: space.md,
    gap: 2,
  },
  rowTitle: { ...type.body, fontWeight: '700' },
  rowDetail: { color: colors.muted },
});
