import * as Haptics from 'expo-haptics';
import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, SlideInDown, SlideOutDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Body, Button, Chip, Heading, Muted, Overline } from '@/components/ui';
import { colors, radius, space, type } from '@/lib/theme';
import { displayToKg, formatWeight, kgToDisplay, step } from '@/lib/units';
import type { Exercise, Units } from '@/lib/types';

export interface LoggedSet {
  reps: number;
  weight_kg: number | null;
  is_bodyweight: boolean;
  added_load_kg: number;
  rpe: number | null;
}

interface Props {
  visible: boolean;
  exercise: Exercise;
  units: Units;
  bodyweightKg: number | null;
  targetReps: string;
  /** Prefill from the last time this exercise was logged. */
  suggestedKg: number | null;
  suggestedReps: number | null;
  setLabel: string;
  onCancel: () => void;
  onSubmit: (set: LoggedSet) => void;
}

const RPE_OPTIONS = [6, 7, 8, 9, 10];

/**
 * Fires after every set. The fast path is one tap on "Log set": reps and weight
 * arrive prefilled from last time, so the user only touches the controls when
 * something changed.
 */
export function WeightSheet({
  visible,
  exercise,
  units,
  bodyweightKg,
  targetReps,
  suggestedKg,
  suggestedReps,
  setLabel,
  onCancel,
  onSubmit,
}: Props) {
  const insets = useSafeAreaInsets();
  const [reps, setReps] = useState(suggestedReps ?? 10);
  const [weight, setWeight] = useState(0);
  const [rpe, setRpe] = useState<number | null>(null);
  const [asBodyweight, setAsBodyweight] = useState(exercise.is_bodyweight);

  // Reopening for a new set must not inherit the previous set's edits.
  useEffect(() => {
    if (!visible) return;
    setReps(suggestedReps ?? 10);
    setRpe(null);
    setAsBodyweight(exercise.is_bodyweight);
    setWeight(suggestedKg != null ? Math.round(kgToDisplay(suggestedKg, units) * 10) / 10 : 0);
  }, [visible, exercise.id, suggestedKg, suggestedReps, units, exercise.is_bodyweight]);

  const nudge = (delta: number) => {
    Haptics.selectionAsync();
    setWeight((w) => Math.max(0, Math.round((w + delta) * 10) / 10));
  };

  const submit = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const kg = displayToKg(weight, units);
    onSubmit({
      reps,
      weight_kg: asBodyweight ? null : kg,
      is_bodyweight: asBodyweight,
      added_load_kg: asBodyweight ? kg : 0,
      rpe,
    });
  };

  const effectiveKg = asBodyweight
    ? bodyweightKg != null
      ? bodyweightKg + displayToKg(weight, units)
      : null
    : displayToKg(weight, units);

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onCancel}>
      <Animated.View entering={FadeIn.duration(160)} style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onCancel} accessibilityLabel="Dismiss" />
        <Animated.View
          entering={SlideInDown.springify().damping(20)}
          exiting={SlideOutDown.duration(160)}
          style={[styles.sheet, { paddingBottom: insets.bottom + space.lg }]}
        >
          <View style={styles.grabber} />

          <Overline>{setLabel}</Overline>
          <Heading style={{ marginTop: 2 }} numberOfLines={2}>
            {exercise.name}
          </Heading>
          <Muted style={{ marginTop: space.xs }}>Target {targetReps}</Muted>

          <View style={styles.field}>
            <Overline>Reps</Overline>
            <View style={styles.stepperRow}>
              <Stepper label="−" onPress={() => setReps((r) => Math.max(1, r - 1))} />
              <Text style={styles.numeral}>{reps}</Text>
              <Stepper label="+" onPress={() => setReps((r) => r + 1)} />
            </View>
          </View>

          <View style={styles.field}>
            <View style={styles.labelRow}>
              <Overline>{asBodyweight ? 'Added load' : 'Weight'}</Overline>
              {exercise.is_bodyweight || asBodyweight ? (
                <Chip
                  label="Bodyweight"
                  selected={asBodyweight}
                  onPress={() => {
                    Haptics.selectionAsync();
                    setAsBodyweight((v) => !v);
                  }}
                />
              ) : null}
            </View>
            <View style={styles.stepperRow}>
              <Stepper label="−" onPress={() => nudge(-step(units))} />
              <Text style={styles.numeral}>
                {weight % 1 === 0 ? weight.toFixed(0) : weight.toFixed(1)}
                <Text style={styles.unit}> {units}</Text>
              </Text>
              <Stepper label="+" onPress={() => nudge(step(units))} />
            </View>
            {asBodyweight ? (
              <Muted style={{ marginTop: space.xs }}>
                {bodyweightKg != null
                  ? `Effective load ${formatWeight(effectiveKg, units)} (bodyweight + added)`
                  : 'Add your bodyweight in Profile to track effective load.'}
              </Muted>
            ) : null}
          </View>

          <View style={styles.field}>
            <Overline>How hard? (optional)</Overline>
            <View style={styles.rpeRow}>
              {RPE_OPTIONS.map((value) => (
                <Chip
                  key={value}
                  label={value === 10 ? 'Max' : `${value}`}
                  selected={rpe === value}
                  onPress={() => {
                    Haptics.selectionAsync();
                    setRpe(rpe === value ? null : value);
                  }}
                />
              ))}
            </View>
          </View>

          <Button title="Log set" onPress={submit} style={{ marginTop: space.lg }} />
          <Button variant="ghost" title="Cancel" onPress={onCancel} />
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const Stepper = ({ label, onPress }: { label: string; onPress: () => void }) => (
  <Pressable
    accessibilityRole="button"
    accessibilityLabel={label === '+' ? 'Increase' : 'Decrease'}
    onPress={onPress}
    style={({ pressed }) => [styles.stepper, pressed && { opacity: 0.6 }]}
  >
    <Body style={styles.stepperLabel}>{label}</Body>
  </Pressable>
);

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderTopWidth: 1,
    borderColor: colors.border,
    padding: space.lg,
  },
  grabber: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.borderStrong,
    marginBottom: space.lg,
  },
  field: { marginTop: space.xl, gap: space.sm },
  labelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  stepperRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  stepper: {
    width: 64,
    height: 64,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.elevated,
    borderWidth: 1,
    borderColor: colors.border,
  },
  stepperLabel: { ...type.title, color: colors.text },
  numeral: { ...type.numeral, color: colors.text },
  unit: { ...type.body, color: colors.muted },
  rpeRow: { flexDirection: 'row', gap: space.sm },
});
