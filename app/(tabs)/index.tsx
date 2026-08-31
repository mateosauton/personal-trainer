import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { ExerciseStrip } from '@/components/ExerciseStrip';
import { Header } from '@/components/Header';
import { Streak } from '@/components/Streak';
import { Body, Button, Card, Heading, Muted, Overline, Screen } from '@/components/ui';
import { useAuth, useUserId } from '@/lib/auth';
import { getExercise } from '@/lib/catalog';
import { bodyPartLabel, estimateDay, estimateVolumeKg } from '@/lib/plan/estimate';
import { colors, space, type } from '@/lib/theme';
import { formatHeight, formatWeight } from '@/lib/units';
import { useDashboard } from '@/lib/useDashboard';

/**
 * Home answers three questions in order: who am I, how am I doing, and what am
 * I about to do. The detail of the plan lives one tab across; this screen ends
 * in the one button that matters.
 */
export default function Home() {
  const userId = useUserId();
  const { profile } = useAuth();
  const router = useRouter();
  const bodyweightKg = profile?.bodyweight_kg ?? null;
  const {
    plan, nextDay, completedCount, trainedDays, streak,
    todaySessions, todayTotals, lastLoadKg, loading, error, reload,
  } = useDashboard(userId, bodyweightKg);

  // Coming back from a finished session must move the rotation on.
  useFocusEffect(useCallback(() => reload(), [reload]));

  const units = profile?.units ?? 'kg';
  const name = profile?.display_name ?? null;

  // Who you are, not what you are training: height and weight are the two
  // numbers the rest of the app does its maths with. Either can be missing,
  // so the line is built from whichever exist.
  const measurements = [
    profile?.height_cm != null ? formatHeight(profile.height_cm, units) : null,
    bodyweightKg != null ? formatWeight(bodyweightKg, units) : null,
  ].filter(Boolean).join(' · ');
  const subtitle = measurements || undefined;

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
        <Header name={name} avatarUrl={profile?.avatar_url ?? null} subtitle={subtitle} />
        <Card style={{ marginTop: space.xl, gap: space.md }}>
          <Overline>No plan yet</Overline>
          <Body>{error ?? 'Build one from your profile to get started.'}</Body>
          <Button title="Go to profile" onPress={() => router.push('/profile')} />
        </Card>
      </Screen>
    );
  }

  const estimate = estimateDay(nextDay);
  const trainedToday = todayTotals != null && todaySessions.length > 0;

  // Before the session these are projections; once today is logged the same
  // three slots show what actually happened.
  const minutes = trainedToday
    ? Math.max(
        1,
        Math.round(todaySessions.reduce((sum, s) => sum + (s.duration_s ?? 0), 0) / 60),
      )
    : estimate.minutes;
  const reps = trainedToday ? todayTotals.reps : estimate.reps;
  const volumeKg = trainedToday
    ? todayTotals.volumeKg
    : estimateVolumeKg(nextDay, lastLoadKg, bodyweightKg);

  const workBlocks = nextDay.blocks.filter((b) => b.kind !== 'warmup');

  // One thumbnail per movement, in the order it comes up. Deduped: a circuit
  // that revisits an exercise should not put the same picture up twice.
  const seen = new Set<string>();
  const todayExercises = workBlocks
    .flatMap((b) => b.items)
    .filter((item) => !seen.has(item.exercise_id) && seen.add(item.exercise_id))
    .map((item) => getExercise(item.exercise_id))
    .filter((e): e is NonNullable<typeof e> => e != null);

  return (
    <Screen>
      <Header name={name} avatarUrl={profile?.avatar_url ?? null} subtitle={subtitle} />

      <View style={{ marginTop: space.xl }}>
        <Streak streak={streak} total={completedCount} trainedDays={trainedDays} />
      </View>

      <Card style={styles.today}>
        <View style={styles.todayHead}>
          <View style={{ gap: 2, flex: 1 }}>
            <Overline>{trainedToday ? "Today's session" : 'Up next today'}</Overline>
            <Body style={styles.dayName} numberOfLines={1}>
              {trainedToday ? (todaySessions[0]?.plan_days?.name ?? nextDay.name) : nextDay.name}
            </Body>
            <Muted numberOfLines={1}>{bodyPartLabel(estimate.bodyParts)}</Muted>
          </View>
        </View>

        <ExerciseStrip exercises={todayExercises} />

        <View style={styles.stats}>
          <Stat label={trainedToday ? 'Minutes' : 'Est. min'} value={`${minutes}`} />
          <Stat label={trainedToday ? 'Reps' : 'Est. reps'} value={`${reps}`} />
          <Stat
            label={trainedToday ? 'Volume' : 'Est. volume'}
            value={volumeKg > 0 ? formatWeight(volumeKg, units) : '—'}
          />
        </View>
      </Card>

      <View style={styles.list}>
        {workBlocks.map((block) => (
          <View key={block.id} style={styles.row}>
            <Body style={styles.rowTitle}>{block.title.replace(/^Block \d+ · /, '')}</Body>
            <Muted numberOfLines={2}>
              {block.items.map((i) => getExercise(i.exercise_id)?.name ?? i.exercise_id).join(' · ')}
            </Muted>
          </View>
        ))}
      </View>

      <Button
        title={trainedToday ? 'Start another session' : 'Start session'}
        onPress={() => router.push(`/session/${nextDay.id}`)}
        style={{ marginTop: space.xl }}
      />
    </Screen>
  );
}

const Stat = ({ label, value }: { label: string; value: string }) => (
  <View style={{ gap: 2, flex: 1 }}>
    <Heading numberOfLines={1} adjustsFontSizeToFit>
      {value}
    </Heading>
    <Overline>{label}</Overline>
  </View>
);

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  today: { marginTop: space.lg, gap: space.lg },
  todayHead: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  dayName: { ...type.heading },
  stats: { flexDirection: 'row', gap: space.md },
  list: { marginTop: space.xl, gap: space.md },
  row: { borderLeftWidth: 2, borderLeftColor: colors.accent, paddingLeft: space.md, gap: 2 },
  rowTitle: { ...type.body, fontWeight: '700' },
});
