import { StyleSheet, View } from 'react-native';

import { ExerciseMedia } from '@/components/ExerciseMedia';
import { Muted } from '@/components/ui';
import { colors, radius, space, type } from '@/lib/theme';
import type { Exercise } from '@/lib/types';

/** Past this many the row stops being a glance and starts being a list. */
const MAX = 6;

/**
 * A row of thumbnails for the movements in a session: what you are about to do,
 * recognisable before the names are read. The stills are held on their start
 * frame -- a strip of six looping crossfades would pull the eye off the button
 * underneath.
 */
export function ExerciseStrip({
  exercises,
  max = MAX,
  size = 44,
}: {
  exercises: Exercise[];
  max?: number;
  size?: number;
}) {
  if (exercises.length === 0) return null;

  const shown = exercises.slice(0, max);
  const overflow = exercises.length - shown.length;
  const box = { width: size, height: size };

  return (
    <View
      testID="exercise-strip"
      style={styles.row}
      accessibilityLabel={`${exercises.length} exercise${exercises.length === 1 ? '' : 's'} in this session`}
    >
      {shown.map((exercise) => (
        <ExerciseMedia
          key={exercise.id}
          testID={`exercise-thumb-${exercise.id}`}
          exercise={exercise}
          paused
          style={{ ...styles.thumb, ...box }}
        />
      ))}
      {overflow > 0 ? (
        <View style={[styles.thumb, styles.more, box]}>
          <Muted style={styles.moreText}>+{overflow}</Muted>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  thumb: { borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border },
  more: { backgroundColor: colors.elevated, alignItems: 'center', justifyContent: 'center' },
  moreText: { ...type.overline, color: colors.muted },
});
