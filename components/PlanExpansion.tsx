import { useEffect, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { Easing, ReduceMotion, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';

import { Icon } from '@/components/Icon';
import { motion } from '@/lib/motion';
import { colors } from '@/lib/theme';

/** Keep the details measured so reversing a toggle never waits for a remount. */
export function PlanExpansion({ expanded, children }: { expanded: boolean; children: ReactNode }) {
  const reduceMotion = useReducedMotion();
  const height = useSharedValue(0);
  const progress = useSharedValue(expanded ? 1 : 0);

  useEffect(() => {
    progress.value = reduceMotion
      ? Number(expanded)
      : withTiming(Number(expanded), {
          duration: motion.base,
          easing: Easing.inOut(Easing.quad),
          reduceMotion: ReduceMotion.System,
        });
  }, [expanded, progress, reduceMotion]);

  const animatedStyle = useAnimatedStyle(() => ({
    height: height.value * progress.value,
    opacity: progress.value,
  }));

  return (
    <Animated.View
      style={[styles.clip, animatedStyle]}
      pointerEvents={expanded ? 'auto' : 'none'}
      accessibilityElementsHidden={!expanded}
      importantForAccessibility={expanded ? 'auto' : 'no-hide-descendants'}
      aria-hidden={!expanded}
    >
      <View
        style={styles.content}
        onLayout={(event) => {
          height.value = event.nativeEvent.layout.height;
        }}
      >
        {children}
      </View>
    </Animated.View>
  );
}

export function PlanExpansionChevron({ expanded }: { expanded: boolean }) {
  const reduceMotion = useReducedMotion();
  const rotation = useSharedValue(expanded ? 180 : 0);

  useEffect(() => {
    rotation.value = reduceMotion
      ? expanded ? 180 : 0
      : withTiming(expanded ? 180 : 0, {
          duration: motion.fast,
          easing: Easing.out(Easing.quad),
          reduceMotion: ReduceMotion.System,
        });
  }, [expanded, reduceMotion, rotation]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  return (
    <Animated.View style={animatedStyle} accessible={false} aria-hidden>
      <Icon name="expand" size={18} color={colors.muted} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  clip: { overflow: 'hidden' },
  content: { position: 'absolute', top: 0, left: 0, right: 0 },
});
