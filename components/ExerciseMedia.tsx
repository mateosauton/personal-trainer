import { Image } from 'expo-image';
import { useEffect } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { colors, duration, radius } from '@/lib/theme';
import { resolveMedia } from '@/lib/media/provider';
import type { Exercise } from '@/lib/types';

const AnimatedImage = Animated.createAnimatedComponent(Image);

interface Props {
  exercise: Exercise;
  style?: ViewStyle;
  /** Paused holds the start frame -- used behind the rest timer. */
  paused?: boolean;
}

/**
 * Shows an exercise demo by crossfading its start and end stills, which reads
 * as the two ends of the movement.
 */
export function ExerciseMedia({ exercise, style, paused = false }: Props) {
  const media = resolveMedia(exercise);
  const progress = useSharedValue(0);

  useEffect(() => {
    if (!media || paused) {
      cancelAnimation(progress);
      return;
    }
    // Hold at each end so the position is readable, rather than sweeping
    // continuously back and forth.
    const half = duration.crossfade / 2;
    progress.value = 0;
    progress.value = withRepeat(
      withSequence(
        withTiming(1, { duration: half, easing: Easing.inOut(Easing.quad) }),
        withTiming(0, { duration: half, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
      false,
    );
    return () => cancelAnimation(progress);
  }, [media, paused, exercise.id, progress]);

  const endStyle = useAnimatedStyle(() => ({ opacity: progress.value }));

  if (!media) {
    return <View style={[styles.frame, styles.empty, style]} />;
  }

  return (
    <View style={[styles.frame, style]}>
      <Image
        source={media.start}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        cachePolicy="memory-disk"
        transition={duration.base}
      />
      <AnimatedImage
        source={media.end}
        style={[StyleSheet.absoluteFill, endStyle]}
        contentFit="cover"
        cachePolicy="memory-disk"
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
