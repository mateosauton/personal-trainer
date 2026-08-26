import { forwardRef } from 'react';
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

import { colors, radius, space, type } from '@/lib/theme';

export function Screen({
  children,
  scroll = true,
  style,
  contentContainerStyle,
  ...rest
}: { children: React.ReactNode; scroll?: boolean; style?: ViewStyle } & ScrollViewProps) {
  const insets = useSafeAreaInsets();
  const pad = { paddingTop: insets.top + space.lg, paddingBottom: insets.bottom + space.xxxl };

  if (!scroll) {
    return <View style={[styles.screen, pad, style]}>{children}</View>;
  }
  return (
    <ScrollView
      style={[styles.screen, style]}
      contentContainerStyle={[{ padding: space.lg }, pad, contentContainerStyle]}
      showsVerticalScrollIndicator={false}
      {...rest}
    >
      {children}
    </ScrollView>
  );
}

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
  title: string;
  variant?: 'accent' | 'surface' | 'ghost';
  loading?: boolean;
  style?: ViewStyle;
}

export const Button = forwardRef<View, ButtonProps>(function Button(
  { title, variant = 'accent', loading, style, disabled, ...rest },
  ref,
) {
  const isAccent = variant === 'accent';
  return (
    <Pressable
      ref={ref}
      accessibilityRole="button"
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.button,
        isAccent && styles.buttonAccent,
        variant === 'surface' && styles.buttonSurface,
        variant === 'ghost' && styles.buttonGhost,
        (disabled || loading) && styles.buttonDisabled,
        pressed && styles.buttonPressed,
        style,
      ]}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator color={isAccent ? colors.accentInk : colors.text} />
      ) : (
        <Text style={[styles.buttonText, isAccent && styles.buttonTextAccent]}>{title}</Text>
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
  return (
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
  );
}

/** Thin progress rail; used for block and session completion. */
export function ProgressBar({ value }: { value: number }) {
  const clamped = Math.max(0, Math.min(1, value));
  return (
    <View style={styles.rail}>
      <View style={[styles.railFill, { width: `${clamped * 100}%` }]} />
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
  buttonSurface: { backgroundColor: colors.elevated, borderWidth: 1, borderColor: colors.border },
  buttonGhost: { backgroundColor: 'transparent' },
  buttonDisabled: { opacity: 0.4 },
  buttonPressed: { opacity: 0.75, transform: [{ scale: 0.985 }] },
  buttonText: { ...type.body, fontWeight: '700', color: colors.text },
  buttonTextAccent: { color: colors.accentInk },
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
  railFill: { height: '100%', backgroundColor: colors.accent, borderRadius: radius.pill },
});
