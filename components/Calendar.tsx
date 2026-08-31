import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  format,
  getDay,
  isSameMonth,
  startOfMonth,
} from 'date-fns';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Body, Button, Card, Muted, Overline } from '@/components/ui';
import { dayKey } from '@/lib/stats';
import { colors, radius, space, type } from '@/lib/theme';

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

/** Monday-first column for a date, since the week starts on Monday here. */
const columnOf = (date: Date) => (getDay(date) + 6) % 7;

/**
 * A month at a time, trained days filled green. Tapping one is how the history
 * is reached now: the record and the plan are the same screen, so a session
 * always sits next to the day it happened on.
 */
export function Calendar({
  trainedDays,
  selected,
  onSelect,
}: {
  trainedDays: Set<string>;
  selected: string | null;
  onSelect: (day: string) => void;
}) {
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const today = dayKey(new Date());

  const days = eachDayOfInterval({ start: startOfMonth(month), end: endOfMonth(month) });
  const lead = Array.from({ length: columnOf(days[0]!) });
  const atCurrentMonth = isSameMonth(month, new Date());

  return (
    <Card style={{ gap: space.md }}>
      <View style={styles.head}>
        <Button
          variant="ghost"
          icon="prev"
          accessibilityLabel="Previous month"
          onPress={() => setMonth((m) => addMonths(m, -1))}
          style={styles.arrow}
        />
        <Overline>{format(month, 'MMMM yyyy')}</Overline>
        <Button
          variant="ghost"
          icon="next"
          accessibilityLabel="Next month"
          disabled={atCurrentMonth}
          onPress={() => setMonth((m) => addMonths(m, 1))}
          style={styles.arrow}
        />
      </View>

      <View style={styles.grid}>
        {WEEKDAYS.map((label, i) => (
          <View key={`${label}${i}`} style={styles.cell}>
            <Muted style={styles.weekday}>{label}</Muted>
          </View>
        ))}

        {lead.map((_, i) => (
          <View key={`lead-${i}`} style={styles.cell} />
        ))}

        {days.map((date) => {
          const key = dayKey(date);
          const trained = trainedDays.has(key);
          return (
            <View key={key} style={styles.cell}>
              <Pressable
                disabled={!trained}
                onPress={() => onSelect(key)}
                accessibilityRole={trained ? 'button' : undefined}
                accessibilityLabel={`${format(date, 'd MMMM')}${trained ? ', trained' : ''}`}
                testID={trained ? `calendar-trained-${key}` : `calendar-day-${key}`}
                style={({ pressed }) => [
                  styles.day,
                  trained && styles.dayTrained,
                  key === today && styles.dayToday,
                  key === selected && styles.daySelected,
                  pressed && { opacity: 0.7 },
                ]}
              >
                <Body style={[styles.dayText, trained && styles.dayTextTrained]}>
                  {format(date, 'd')}
                </Body>
              </Pressable>
            </View>
          );
        })}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  arrow: { minHeight: 36, paddingHorizontal: space.md },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  // Seven columns; a fraction rather than a fixed width so it fits any phone.
  cell: { width: `${100 / 7}%`, aspectRatio: 1, alignItems: 'center', justifyContent: 'center' },
  weekday: { ...type.overline, color: colors.faint },
  day: {
    width: '86%',
    aspectRatio: 1,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  dayTrained: { backgroundColor: colors.success },
  dayToday: { borderWidth: 1, borderColor: colors.borderStrong },
  daySelected: { borderWidth: 2, borderColor: colors.accent },
  dayText: { ...type.small, color: colors.muted },
  dayTextTrained: { color: colors.accentInk, fontWeight: '800' },
});
