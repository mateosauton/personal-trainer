import { useEffect, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { ReduceMotion, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';

import { Card, Heading, Muted, Overline } from '@/components/ui';
import { motion } from '@/lib/motion';
import { claimCompletionMotion } from '@/lib/session/completion-motion';
import { recentDays } from '@/lib/stats';
import { colors, radius, space, type } from '@/lib/theme';

export interface StreakCompletion {
  ownerId: string;
  sessionId: string;
  day: string;
}

/**
 * Days trained. The number that matters is the streak, so it is the only thing
 * set in display type; the strip underneath is the last fortnight at a glance,
 * green for a day that got done.
 */
export function Streak({
  streak,
  total,
  trainedDays,
  completion,
}: {
  streak: number;
  total: number;
  trainedDays: Set<string>;
  completion?: StreakCompletion | null;
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
          <DayPip
            key={day}
            day={day}
            trained={trainedDays.has(day)}
            completion={completion?.day === day ? completion : null}
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

function DayPip({ day, trained, completion }: {
  day: string;
  trained: boolean;
  completion: StreakCompletion | null;
}) {
  const reduceMotion = useReducedMotion();
  const fill = useSharedValue(trained ? 1 : 0);
  const played = useRef<string | null>(null);

  useEffect(() => {
    if (!trained) {
      fill.value = 0;
      return;
    }
    if (!completion) {
      fill.value = 1;
      return;
    }
    if (played.current === completion.sessionId) return;
    played.current = completion.sessionId;
    const fresh = claimCompletionMotion(completion.ownerId, completion.sessionId, 'streak');
    if (!fresh || reduceMotion) {
      fill.value = 1;
      return;
    }
    fill.value = 0;
    fill.value = withTiming(1, { duration: motion.base, reduceMotion: ReduceMotion.System });
  }, [completion, fill, reduceMotion, trained]);

  const fillStyle = useAnimatedStyle(() => ({ transform: [{ scaleX: fill.value }] }));

  return (
    <View testID={trained ? `day-on-${day}` : `day-off-${day}`} style={styles.pip}>
      <Animated.View style={[styles.pipFill, fillStyle]} />
    </View>
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
    overflow: 'hidden',
  },
  pipFill: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.success,
    transformOrigin: 'left',
  },
});
