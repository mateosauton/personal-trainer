import { useEffect } from 'react';
import { StyleSheet, type ViewStyle } from 'react-native';
import Animated, { ReduceMotion, useAnimatedStyle, useReducedMotion, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated';

import { motion } from '@/lib/motion';
import { colors, radius } from '@/lib/theme';

export function MarkerStroke({ style, testID }: { style?: ViewStyle; testID?: string }) {
  const reduceMotion = useReducedMotion();
  const drawn = useSharedValue(reduceMotion ? 1 : 0);

  useEffect(() => {
    drawn.value = reduceMotion
      ? 1
      : withTiming(1, { duration: motion.base, reduceMotion: ReduceMotion.System });
  }, [drawn, reduceMotion]);

  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scaleX: drawn.value }] }));

  return <Animated.View testID={testID} style={[styles.stroke, style, animatedStyle]} />;
}

export function DoodlePop({ children, active = true }: { children: React.ReactNode; active?: boolean }) {
  const reduceMotion = useReducedMotion();
  const scale = useSharedValue(1);

  useEffect(() => {
    if (!active || reduceMotion) {
      scale.value = 1;
      return;
    }
    scale.value = withSequence(
      withTiming(1.12, { duration: motion.fast, reduceMotion: ReduceMotion.System }),
      withSpring(1, { ...motion.pop, reduceMotion: ReduceMotion.System }),
    );
  }, [active, reduceMotion, scale]);

  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return <Animated.View style={animatedStyle}>{children}</Animated.View>;
}

const styles = StyleSheet.create({
  stroke: {
    height: 3,
    backgroundColor: colors.accent,
    borderRadius: radius.pill,
    transformOrigin: 'left',
  },
});
