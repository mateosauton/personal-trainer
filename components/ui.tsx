import { forwardRef, useEffect } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type PressableProps,
  type ScrollViewProps,
  type TextProps,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { ReduceMotion, useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';

import { Icon, type IconName } from '@/components/Icon';
import { motion } from '@/lib/motion';
import { colors, radius, space, type } from '@/lib/theme';

/**
 * Ref-forwarding so a screen can scroll itself: tapping a session in Plan's
 * history has to bring the day it opened into view, and that lives further up
 * the page.
 */
export const Screen = forwardRef<ScrollView, { children: React.ReactNode; scroll?: boolean; style?: ViewStyle } & ScrollViewProps>(
  function Screen({ children, scroll = true, style, contentContainerStyle, ...rest }, ref) {
    const insets = useSafeAreaInsets();
    const pad = { paddingTop: insets.top + space.lg, paddingBottom: insets.bottom + space.xxxl };

    if (!scroll) {
      return <View style={[styles.screen, pad, style]}>{children}</View>;
    }
    return (
      <ScrollView
        ref={ref}
        style={[styles.screen, style]}
        contentContainerStyle={[{ padding: space.lg }, pad, contentContainerStyle]}
        showsVerticalScrollIndicator={false}
        {...rest}
      >
        {children}
      </ScrollView>
    );
  },
);

export const Overline = ({ style, ...rest }: TextProps) => (
  <Text style={[styles.overline, style]} {...rest} />
);
export const Display = ({ style, ...rest }: TextProps) => (
  <Text style={[styles.display, style]} {...rest} />
);
export const Title = ({ style, ...rest }: TextProps) => (
  <Text style={[styles.title, style]} {...rest} />
);
export const Heading = ({ style, ...rest }: TextProps) => (
  <Text style={[styles.heading, style]} {...rest} />
);
export const Body = ({ style, ...rest }: TextProps) => (
  <Text style={[styles.body, style]} {...rest} />
);
export const Muted = ({ style, ...rest }: TextProps) => (
  <Text style={[styles.muted, style]} {...rest} />
);

export const Card = ({ style, ...rest }: { style?: ViewStyle } & React.ComponentProps<typeof View>) => (
  <View style={[styles.card, style]} {...rest} />
);

interface ButtonProps extends PressableProps {
  /** Optional so an icon alone can be the whole button; give it an accessibilityLabel then. */
  title?: string;
  icon?: IconName;
  variant?: 'accent' | 'auth' | 'surface' | 'ghost';
  loading?: boolean;
  style?: ViewStyle;
}

export const Button = forwardRef<View, ButtonProps>(function Button(
  { title, icon, variant = 'accent', loading, style, disabled, ...rest },
  ref,
) {
  const isAuth = variant === 'auth';
  const ink = isAuth ? colors.text : colors.accentInk;
  const isFilled = variant === 'accent' || isAuth;
  return (
    <Pressable
      ref={ref}
      accessibilityRole="button"
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.button,
        variant === 'accent' && styles.buttonAccent,
        isAuth && styles.buttonAuth,
        variant === 'surface' && styles.buttonSurface,
        variant === 'ghost' && styles.buttonGhost,
        (disabled || loading) && !isAuth && styles.buttonDisabled,
        pressed && !isAuth && styles.buttonPressed,
        style,
      ]}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator color={isFilled ? ink : colors.text} />
      ) : (
        <View style={styles.buttonInner}>
          {icon ? <Icon name={icon} size={18} color={isFilled ? ink : colors.text} /> : null}
          {title ? (
            <Text style={[styles.buttonText, isFilled && { color: ink }]}>{title}</Text>
          ) : null}
        </View>
      )}
    </Pressable>
  );
});

export function Chip({
  label,
  selected,
  onPress,
  style,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  style?: ViewStyle;
}) {
  const reduceMotion = useReducedMotion();
  const scale = useSharedValue(1);
  const selectedScale = selected ? 1.025 : 1;

  useEffect(() => {
    scale.value = reduceMotion
      ? selectedScale
      : withSpring(selectedScale, { ...motion.settle, reduceMotion: ReduceMotion.System });
  }, [reduceMotion, scale, selectedScale]);

  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Animated.View style={animatedStyle}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ selected }}
        onPress={onPress}
        style={({ pressed }) => [
          styles.chip,
          selected && styles.chipSelected,
          pressed && styles.buttonPressed,
          style,
        ]}
      >
        <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
      </Pressable>
    </Animated.View>
  );
}

/** Thin progress rail; used for block and session completion. */
export function ProgressBar({ value }: { value: number }) {
  const clamped = Math.max(0, Math.min(1, value));
  const reduceMotion = useReducedMotion();
  const progress = useSharedValue(clamped);

  useEffect(() => {
    progress.value = reduceMotion
      ? clamped
      : withTiming(clamped, { duration: motion.base, reduceMotion: ReduceMotion.System });
  }, [clamped, progress, reduceMotion]);

  const fillStyle = useAnimatedStyle(() => ({ transform: [{ scaleX: progress.value }] }));

  return (
    <View
      testID="progress-bar"
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(clamped * 100) }}
      style={styles.rail}
    >
      <Animated.View style={[styles.railFill, fillStyle]} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  overline: { ...type.overline, color: colors.muted, textTransform: 'uppercase' },
  display: { ...type.display, color: colors.text },
  title: { ...type.title, color: colors.text },
  heading: { ...type.heading, color: colors.text },
  body: { ...type.body, color: colors.text },
  muted: { ...type.small, color: colors.muted },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.lg,
  },
  button: {
    minHeight: 56,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.xl,
  },
  buttonAccent: { backgroundColor: colors.accent },
  buttonAuth: { backgroundColor: colors.accentAuth, opacity: 1 },
  buttonSurface: { backgroundColor: colors.elevated, borderWidth: 1, borderColor: colors.border },
  buttonGhost: { backgroundColor: 'transparent' },
  buttonDisabled: { opacity: 0.4 },
  buttonPressed: { opacity: 0.75, transform: [{ scale: 0.98 }] },
  buttonInner: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  buttonText: { ...type.body, fontWeight: '700', color: colors.text },
  chip: {
    paddingVertical: space.md,
    paddingHorizontal: space.lg,
    borderRadius: radius.pill,
    backgroundColor: colors.elevated,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipSelected: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { ...type.small, fontWeight: '600', color: colors.text },
  chipTextSelected: { color: colors.accentInk },
  rail: {
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.elevated,
    overflow: 'hidden',
  },
  railFill: {
    height: '100%',
    width: '100%',
    backgroundColor: colors.accent,
    borderRadius: radius.pill,
    transformOrigin: 'left',
  },
});
