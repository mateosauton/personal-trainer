import * as Haptics from 'expo-haptics';
import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  AppState,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, { cancelAnimation, FadeIn, ReduceMotion, useAnimatedStyle, useReducedMotion, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';

import { ExerciseMedia } from '@/components/ExerciseMedia';
import { Icon } from '@/components/Icon';
import { DoneAccessory, numericDoneProps } from '@/components/NumberField';
import {
  Body,
  Button,
  Chip,
  Heading,
  Muted,
  Overline,
  ProgressBar,
} from '@/components/ui';
import { colors, radius, space, type, webFocusRing } from '@/lib/theme';
import { SetEntry } from '@/lib/session/set-entry';
import { motion } from '@/lib/motion';
import { formatClock } from '@/lib/plan/timing';
import { pauseDeadline, remainingSeconds, resumeDeadline, startDeadline } from '@/lib/session/timing';
import { displayToKg, formatWeight } from '@/lib/units';
import type { Exercise, Units } from '@/lib/types';

/** What the user says they just did. Weight is in display units, not kg. */
export type { WorkoutDraft as SetDraft } from '@/lib/session/set-values';
import type { WorkoutDraft as SetDraft } from '@/lib/session/set-values';

export interface UpNext {
  exercise: Exercise | null;
  name: string;
  set: number;
  setsTotal: number;
}

interface Props {
  /** The exercise whose set was just finished. */
  exercise: Exercise | null;
  setLabel: string;
  targetReps: string;
  targetSeconds?: number | null;
  units: Units;
  bodyweightKg: number | null;
  bodyweightCaptured?: boolean;
  restSeconds: number;
  restUntilMs?: number | null;
  draft: SetDraft;
  onChange: (next: SetDraft) => void;
  /** Null when the set just finished was the last one of the session. */
  next: UpNext | null;
  onAdvance: () => void;
  advancing?: boolean;
  paused?: boolean;
  pausedAtMs?: number | null;
  restLabel?: string;
  readyLabel?: string;
  feedback?: ReactNode;
  justSaved?: boolean;
}

/**
 * The whole screen between two sets. It owns three jobs at once — count the
 * rest down, take the reps and weight for the set that just ended, and show
 * what is coming — so the user never has a drawer slide over their session.
 *
 * Reps and weight arrive prefilled and are already saved by the time this
 * mounts; touching them only matters when something differed from last time.
 */
export function RestPage({
  exercise,
  setLabel,
  targetReps,
  targetSeconds,
  units,
  bodyweightKg,
  bodyweightCaptured = false,
  restSeconds,
  restUntilMs,
  draft,
  onChange,
  next,
  onAdvance,
  advancing,
  paused = false,
  pausedAtMs,
  restLabel,
  readyLabel,
  feedback,
  justSaved = false,
}: Props) {
  const reduceMotion = useReducedMotion();
  const readyScale = useSharedValue(1);
  const readyStyle = useAnimatedStyle(() => ({ transform: [{ scale: readyScale.value }] }));
  const [clock, setClock] = useState(() => ({
    endAt: restUntilMs ?? Date.now() + restSeconds * 1000,
    pausedAt: paused ? pausedAtMs ?? Date.now() : null,
  }));
  const [now, setNow] = useState(Date.now());
  // Reopening an already completed rest should show Ready without replaying it.
  const firedRef = useRef(remainingSeconds(clock, now) <= 0);

  useEffect(() => {
    const timestamp = Date.now();
    setClock({ endAt: restUntilMs ?? startDeadline(restSeconds, timestamp).endAt,
      pausedAt: paused ? pausedAtMs ?? timestamp : null });
    setNow(timestamp);
    // This page is keyed by set. A shifted deadline on resume is the same rest,
    // so it must not replay its completed cue.
    cancelAnimation(readyScale);
    readyScale.value = 1;
  }, [restSeconds, restUntilMs, readyScale]);

  useEffect(() => () => cancelAnimation(readyScale), [readyScale]);

  useEffect(() => {
    const timestamp = Date.now();
    setClock(current => paused ? pauseDeadline(current, pausedAtMs ?? timestamp) : resumeDeadline(current, timestamp));
    setNow(timestamp);
    const tick = () => setNow(Date.now());
    if (paused) return;
    if (restSeconds <= 0) return;
    // Timers may stop while the app is backgrounded. The deadline remains
    // valid even when no interval callback ran during the rest.
    const id = setInterval(tick, 250);
    const app = AppState.addEventListener('change', (state) => {
      if (state === 'active') tick();
    });
    return () => {
      clearInterval(id);
      app.remove();
    };
  }, [paused, pausedAtMs, restSeconds]);

  const remaining = remainingSeconds(clock, now);

  // Buzz once at zero and then wait: auto-advancing would yank the screen away
  // from someone still walking back to the rack.
  useEffect(() => {
    if (remaining > 0 || firedRef.current || paused) return;
    firedRef.current = true;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    if (restSeconds > 0 && !reduceMotion) {
      readyScale.value = withSequence(
        withTiming(motion.focused.readyScale, { duration: motion.fast, reduceMotion: ReduceMotion.System }),
        withTiming(1, { duration: motion.fast, reduceMotion: ReduceMotion.System }),
      );
    }
  }, [paused, readyScale, reduceMotion, remaining, restSeconds]);

  const done = remaining <= 0;

  const locked = paused || advancing;
  const repsAccessory = `set-reps-${useId()}`;
  const weightAccessory = `set-weight-${useId()}`;
  const measurement = draft.seconds != null ? 'seconds' : 'reps';
  const measurementName = SetEntry.fieldName(measurement, units, false);
  const weightName = SetEntry.fieldName('weight', units, draft.asBodyweight);
  const [measurementText, setMeasurementText] = useState(() => String(draft.seconds ?? draft.reps));
  const [weightText, setWeightText] = useState(() => SetEntry.formatDecimal(draft.weight));
  const [measurementError, setMeasurementError] = useState<string | null>(null);
  const [weightError, setWeightError] = useState<string | null>(null);
  const measurementFocused = useRef(false);
  const weightFocused = useRef(false);
  const measurementMode = useRef(measurement);

  // Follow a stepper or a resumed draft. Leave a rejected string in place so
  // the explanation stays next to what the person typed.
  useEffect(() => {
    const modeChanged = measurementMode.current !== measurement;
    measurementMode.current = measurement;
    if (measurementFocused.current && !modeChanged) return;
    setMeasurementText(String(draft.seconds ?? draft.reps));
    setMeasurementError(null);
  }, [draft.reps, draft.seconds, measurement]);

  useEffect(() => {
    if (weightFocused.current) return;
    setWeightText(SetEntry.formatDecimal(draft.weight));
    setWeightError(null);
  }, [draft.weight]);

  const publish = (next: SetDraft | null) => {
    if (next == null) return;
    if (next.reps === draft.reps && (next.seconds ?? null) === (draft.seconds ?? null)
      && next.weight === draft.weight && next.asBodyweight === draft.asBodyweight) return;
    onChange(next);
  };

  const nudgeWeight = (direction: -1 | 1) => {
    if (locked) return;
    Haptics.selectionAsync();
    const next = SetEntry.nudgeWeight(draft, units, direction);
    setWeightText(SetEntry.formatDecimal(next.weight));
    setWeightError(null);
    publish(next);
  };

  const nudgeReps = (delta: number) => {
    if (locked) return;
    Haptics.selectionAsync();
    const next = SetEntry.nudgeMeasurement(draft, delta);
    setMeasurementText(String(next.seconds ?? next.reps));
    setMeasurementError(null);
    publish(next);
  };

  const editMeasurement = (text: string) => {
    setMeasurementText(text);
    const next = SetEntry.commitMeasurement(draft, text);
    if (next == null) {
      setMeasurementError(SetEntry.measurementError(draft));
      return;
    }
    setMeasurementError(null);
    publish(next);
  };

  const editWeight = (text: string) => {
    setWeightText(text);
    const next = SetEntry.commitWeight(draft, text);
    if (next == null) {
      setWeightError(SetEntry.weightError());
      return;
    }
    setWeightError(null);
    publish(next);
  };

  const effectiveKg = draft.asBodyweight
    ? bodyweightKg != null
      ? bodyweightKg + displayToKg(draft.weight, units)
      : null
    : displayToKg(draft.weight, units);

  const advanceLabel = readyLabel ? (done ? readyLabel : 'Skip rest') : next
    ? done
      ? 'Next set'
      : 'Skip rest'
    : 'Finish session';

  return (
    <View style={styles.flex}>
      <View style={styles.clockBlock}>
        <Overline accessibilityLiveRegion="polite">{paused ? 'Timers paused' : restLabel ?? (done ? 'Rest complete' : 'Resting')}</Overline>
        <Text style={styles.clock}>{formatClock(remaining)}</Text>
        <ProgressBar
          value={restSeconds <= 0 ? 1 : 1 - remaining / restSeconds}
        />
      </View>

      {justSaved ? (
        <Animated.View
          entering={FadeIn.duration(motion.fast).reduceMotion(ReduceMotion.System)}
          style={styles.saved}
        >
          <Icon name="check" size={18} color={colors.accent} />
          <Body style={styles.savedLabel}>Set saved on this device</Body>
        </Animated.View>
      ) : null}

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.card}>
          <Overline>{setLabel}</Overline>
          <Heading style={{ marginTop: 2 }} numberOfLines={2}>
            {exercise?.name ?? 'That set'}
          </Heading>
          <Muted style={{ marginTop: space.xs }}>Target {targetReps}</Muted>

          {targetSeconds != null && draft.seconds == null ? <View style={{ gap: space.sm, marginTop: space.md }}>
            <Muted>This older set was saved as repetitions. Record seconds to correct it.</Muted>
            <Button title="Record seconds" variant="surface" disabled={locked} onPress={() => publish({ ...draft, reps: 0, seconds: targetSeconds })} />
          </View> : null}
          <View style={styles.field}>
            <Overline>{measurementName}</Overline>
            <View style={styles.stepperRow}>
              <Stepper label="−" accessibilityLabel={SetEntry.adjustName('Decrease', measurementName)} disabled={locked} onPress={() => nudgeReps(-1)} />
              <ValueField
                value={measurementText}
                onChangeText={editMeasurement}
                accessibilityLabel={measurementName}
                decimal={false}
                accessoryId={repsAccessory}
                editable={!locked}
                onFocus={() => { measurementFocused.current = true; }}
                onBlur={() => { measurementFocused.current = false; }}
              />
              <Stepper label="+" accessibilityLabel={SetEntry.adjustName('Increase', measurementName)} disabled={locked} onPress={() => nudgeReps(1)} />
            </View>
            {measurementError ? <Text accessibilityLiveRegion="polite" style={styles.error}>{measurementError}</Text> : null}
          </View>

          <View style={styles.field}>
            <View style={styles.labelRow}>
              <Overline style={{ flex: 1 }}>{weightName}</Overline>
              {exercise?.is_bodyweight || draft.asBodyweight ? (
                <Chip
                  label="Bodyweight"
                  selected={draft.asBodyweight}
                  onPress={() => {
                    if (locked) return;
                    Haptics.selectionAsync();
                    onChange({ ...draft, asBodyweight: !draft.asBodyweight });
                  }}
                />
              ) : null}
            </View>
            <View style={styles.stepperRow}>
              <Stepper label="−" accessibilityLabel={SetEntry.adjustName('Decrease', weightName)} disabled={locked} onPress={() => nudgeWeight(-1)} />
              <ValueField
                value={weightText}
                onChangeText={editWeight}
                accessibilityLabel={weightName}
                decimal
                accessoryId={weightAccessory}
                unit={units}
                editable={!locked}
                onFocus={() => { weightFocused.current = true; }}
                onBlur={() => { weightFocused.current = false; }}
              />
              <Stepper label="+" accessibilityLabel={SetEntry.adjustName('Increase', weightName)} disabled={locked} onPress={() => nudgeWeight(1)} />
            </View>
            {weightError ? <Text accessibilityLiveRegion="polite" style={styles.error}>{weightError}</Text> : null}
            {draft.asBodyweight ? (
              <Muted style={{ marginTop: space.xs }}>
                {bodyweightKg != null
                  ? `Effective load ${formatWeight(effectiveKg, units)} (bodyweight + added)`
                  : bodyweightCaptured
                    ? 'No bodyweight saved for this workout. Add it in Profile for future workouts.'
                    : 'Add your bodyweight in Profile to track effective load.'}
              </Muted>
            ) : null}
          </View>
        </View>

        {feedback ? <View>{feedback}</View> : null}
      </ScrollView>

      <View style={styles.footer}>
        <View style={styles.upNext}>
          <Overline>Up next</Overline>
          {next ? (
            <View style={styles.upNextRow}>
              {next.exercise ? (
                <ExerciseMedia
                  exercise={next.exercise}
                  style={styles.thumb}
                />
              ) : (
                <View style={[styles.thumb, styles.thumbEmpty]} />
              )}
              <View style={{ flex: 1, gap: 2 }}>
                <Body style={styles.upNextName} numberOfLines={2}>
                  {next.name}
                </Body>
                <Muted>
                  Set {next.set} of {next.setsTotal}
                </Muted>
              </View>
            </View>
          ) : (
            <View style={{ gap: 2, marginTop: space.xs }}>
              <Body style={styles.upNextName}>Last set of the session.</Body>
              <Muted>Finish up and we&rsquo;ll add it all together.</Muted>
            </View>
          )}
        </View>
        <Animated.View style={readyStyle}>
          <Button
            title={advanceLabel}
            variant={done || !next ? 'accent' : 'surface'}
            loading={advancing}
            disabled={paused}
            onPress={() => {
              Keyboard.dismiss();
              onAdvance();
            }}
          />
        </Animated.View>
      </View>
    </View>
  );
}

const Stepper = ({
  label,
  accessibilityLabel,
  onPress,
  disabled,
}: {
  label: string;
  accessibilityLabel: string;
  onPress: () => void;
  disabled?: boolean;
}) => (
  <Pressable
    accessibilityRole="button"
    accessibilityLabel={accessibilityLabel}
    accessibilityState={{ disabled: !!disabled }}
    disabled={disabled}
    onPress={onPress}
    style={({ pressed }) => [styles.stepper, disabled && styles.locked, pressed && !disabled && { opacity: 0.6 }]}
  >
    <Body style={styles.stepperLabel}>{label}</Body>
  </Pressable>
);

function ValueField({
  value,
  onChangeText,
  accessibilityLabel,
  decimal,
  accessoryId,
  unit,
  editable,
  onFocus,
  onBlur,
}: {
  value: string;
  onChangeText: (text: string) => void;
  accessibilityLabel: string;
  decimal: boolean;
  accessoryId: string;
  unit?: string;
  editable: boolean;
  onFocus: () => void;
  onBlur: () => void;
}) {
  return (
    <View style={styles.valueSlot}>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        accessibilityLabel={accessibilityLabel}
        editable={editable}
        selectTextOnFocus
        underlineColorAndroid="transparent"
        placeholder="0"
        placeholderTextColor={colors.faint}
        onFocus={onFocus}
        onBlur={onBlur}
        {...numericDoneProps(accessoryId, decimal)}
        style={[styles.input, !editable && styles.locked]}
      />
      {unit ? <Text style={styles.unit}>{unit}</Text> : null}
      <DoneAccessory nativeID={accessoryId} />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minHeight: 0 },
  scroll: { flex: 1, minHeight: 0 },
  content: { paddingTop: space.md, paddingBottom: space.lg, gap: space.md },
  clockBlock: { flexShrink: 0, gap: space.xs },
  footer: {
    flexShrink: 0,
    gap: space.md,
    paddingTop: space.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  clock: {
    ...type.display,
    fontSize: 56,
    lineHeight: 60,
    color: colors.accent,
    fontVariant: ['tabular-nums'],
  },
  saved: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.lg },
  savedLabel: { ...type.small, color: colors.accent, flexShrink: 1 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.lg,
  },
  field: { marginTop: space.lg, gap: space.sm },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  stepper: {
    width: 56,
    height: 56,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.elevated,
    borderWidth: 1,
    borderColor: colors.border,
  },
  stepperLabel: { ...type.title, color: colors.text },
  valueSlot: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.xs },
  input: {
    ...type.numeral,
    color: colors.text,
    flexShrink: 1,
    minWidth: 48,
    textAlign: 'center',
    paddingVertical: 0,
    ...webFocusRing,
  },
  locked: { opacity: 0.4 },
  error: { ...type.small, color: colors.danger },
  unit: { ...type.body, color: colors.muted },
  upNext: {
    padding: space.sm,
    borderRadius: radius.md,
    backgroundColor: colors.elevated,
    borderWidth: 1,
    borderColor: colors.border,
  },
  upNextRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    marginTop: space.sm,
  },
  thumb: { width: 44, height: 44, borderRadius: radius.sm },
  thumbEmpty: { backgroundColor: colors.surface },
  upNextName: { ...type.body, fontWeight: '700' },
});
