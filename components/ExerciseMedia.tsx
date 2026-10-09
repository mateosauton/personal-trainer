import { Image } from 'expo-image';
import { useMemo } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { colors, radius } from '@/lib/theme';
import { resolveMedia } from '@/lib/media/provider';
import type { Exercise } from '@/lib/types';

interface Props {
  exercise: Exercise;
  style?: ViewStyle;
  testID?: string;
}

/** Shows the exercise's start position without motion. */
export function ExerciseMedia({ exercise, style, testID }: Props) {
  const media = useMemo(() => resolveMedia(exercise), [exercise.id]);

  if (!media) {
    return <View testID={testID} style={[styles.frame, styles.empty, style]} />;
  }

  return (
    <View testID={testID} style={[styles.frame, style]}>
      <Image
        source={media.start}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        cachePolicy="memory-disk"
        transition={0}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    aspectRatio: 1,
    width: '100%',
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
  empty: { backgroundColor: colors.elevated },
});
