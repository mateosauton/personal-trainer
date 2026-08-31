import { StyleSheet, Text, View } from 'react-native';

import { Card, Heading, Muted, Overline } from '@/components/ui';
import { recentDays } from '@/lib/stats';
import { colors, radius, space, type } from '@/lib/theme';

/**
 * Days trained. The number that matters is the streak, so it is the only thing
 * set in display type; the strip underneath is the last fortnight at a glance,
 * green for a day that got done.
 */
export function Streak({
  streak,
  total,
  trainedDays,
}: {
  streak: number;
  total: number;
  trainedDays: Set<string>;
}) {
  const days = recentDays(14);

  return (
    <Card style={styles.card}>
      <View style={styles.head}>
        <View style={{ gap: 2 }}>
          <Overline>Days trained</Overline>
          <View style={styles.streakRow}>
            <Text style={styles.fire} accessibilityLabel="Streak">
              🔥
            </Text>
            <Heading style={styles.count}>
              {streak} day{streak === 1 ? '' : 's'}
            </Heading>
          </View>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 2 }}>
          <Overline>Sessions</Overline>
          <Heading>{total}</Heading>
        </View>
      </View>

      <View style={styles.strip} accessibilityLabel={`${streak} day streak`}>
        {days.map((day) => (
          <View
            key={day}
            testID={trainedDays.has(day) ? `day-on-${day}` : `day-off-${day}`}
            style={[styles.pip, trainedDays.has(day) && styles.pipOn]}
          />
        ))}
      </View>
      <Muted>
        {streak === 0
          ? 'Train today and the streak starts.'
          : 'Keep it alive — one session a day counts.'}
      </Muted>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.md },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  streakRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  fire: { fontSize: 22, lineHeight: 26 },
  count: { ...type.title, fontSize: 24, lineHeight: 28 },
  strip: { flexDirection: 'row', gap: 4 },
  pip: {
    flex: 1,
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.elevated,
  },
  pipOn: { backgroundColor: colors.success },
});
