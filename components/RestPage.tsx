import * as Haptics from 'expo-haptics';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ExerciseMedia } from '@/components/ExerciseMedia';
import { Body, Button, Chip, Heading, Muted, Overline, ProgressBar } from '@/components/ui';
import { colors, radius, space, type } from '@/lib/theme';
import { displayToKg, formatWeight, step } from '@/lib/units';
import type { Exercise, Units } from '@/lib/types';

/** What the user says they just did. Weight is in display units, not kg. */
export interface SetDraft {
  reps: number;
  weight: number;
  asBodyweight: boolean;
}

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
  units: Units;
  bodyweightKg: number | null;
  restSeconds: number;
  draft: SetDraft;
  onChange: (next: SetDraft) => void;
  /** Null when the set just finished was the last one of the session. */
  next: UpNext | null;
  onAdvance: () => void;
  advancing?: boolean;
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
  units,
  bodyweightKg,
  restSeconds,
  draft,
  onChange,
  next,
  onAdvance,
  advancing,
}: Props) {
  const [remaining, setRemaining] = useState(restSeconds);
  const firedRef = useRef(false);

  useEffect(() => {
    setRemaining(restSeconds);
    firedRef.current = false;
    if (restSeconds <= 0) return;
    const id = setInterval(() => {
      setRemaining((value) => (value <= 0 ? 0 : value - 1));
    }, 1000);
    return () => clearInterval(id);
  }, [restSeconds]);

  // Buzz once at zero and then wait: auto-advancing would yank the screen away
  // from someone still walking back to the rack.
  useEffect(() => {
    if (remaining > 0 || firedRef.current) return;
    firedRef.current = true;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [remaining]);

  const minutes = Math.floor(remaining / 60);
  const secs = remaining % 60;
  const done = remaining <= 0;

  const nudgeWeight = (delta: number) => {
    Haptics.selectionAsync();
    onChange({ ...draft, weight: Math.max(0, Math.round((draft.weight + delta) * 10) / 10) });
  };

  const nudgeReps = (delta: number) => {
    Haptics.selectionAsync();
    onChange({ ...draft, reps: Math.max(1, draft.reps + delta) });
  };

  const effectiveKg = draft.asBodyweight
    ? bodyweightKg != null
      ? bodyweightKg + displayToKg(draft.weight, units)
      : null
    : displayToKg(draft.weight, units);

  const advanceLabel = next ? (done ? 'Next set' : 'Skip rest') : 'Finish session';

  return (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.clockBlock}>
        <Overline>{done ? 'Rest complete' : 'Resting'}</Overline>
        <Text style={styles.clock}>
          {minutes}:{String(secs).padStart(2, '0')}
        </Text>
        <ProgressBar value={restSeconds <= 0 ? 1 : 1 - remaining / restSeconds} />
      </View>

      <View style={styles.card}>
        <Overline>{setLabel}</Overline>
        <Heading style={{ marginTop: 2 }} numberOfLines={2}>
          {exercise?.name ?? 'That set'}
        </Heading>
        <Muted style={{ marginTop: space.xs }}>Target {targetReps}</Muted>

        <View style={styles.field}>
          <Overline>Reps</Overline>
          <View style={styles.stepperRow}>
            <Stepper label="−" onPress={() => nudgeReps(-1)} />
            <Text style={styles.numeral}>{draft.reps}</Text>
            <Stepper label="+" onPress={() => nudgeReps(1)} />
          </View>
        </View>

        <View style={styles.field}>
          <View style={styles.labelRow}>
            <Overline>{draft.asBodyweight ? 'Added load' : 'Weight'}</Overline>
            {exercise?.is_bodyweight || draft.asBodyweight ? (
              <Chip
                label="Bodyweight"
                selected={draft.asBodyweight}
                onPress={() => {
                  Haptics.selectionAsync();
                  onChange({ ...draft, asBodyweight: !draft.asBodyweight });
                }}
              />
            ) : null}
          </View>
          <View style={styles.stepperRow}>
            <Stepper label="−" onPress={() => nudgeWeight(-step(units))} />
            <Text style={styles.numeral}>
              {draft.weight % 1 === 0 ? draft.weight.toFixed(0) : draft.weight.toFixed(1)}
              <Text style={styles.unit}> {units}</Text>
            </Text>
            <Stepper label="+" onPress={() => nudgeWeight(step(units))} />
          </View>
          {draft.asBodyweight ? (
            <Muted style={{ marginTop: space.xs }}>
              {bodyweightKg != null
                ? `Effective load ${formatWeight(effectiveKg, units)} (bodyweight + added)`
                : 'Add your bodyweight in Profile to track effective load.'}
            </Muted>
          ) : null}
        </View>
      </View>

      <View style={styles.upNext}>
        <Overline>Up next</Overline>
        {next ? (
          <View style={styles.upNextRow}>
            {next.exercise ? (
              <ExerciseMedia exercise={next.exercise} paused style={styles.thumb} />
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
          <View style={{ gap: 2, marginTop: space.sm }}>
            <Body style={styles.upNextName}>Last set of the session.</Body>
            <Muted>Finish up and we&rsquo;ll add it all together.</Muted>
          </View>
        )}
      </View>

      <Button
        title={advanceLabel}
        variant={done || !next ? 'accent' : 'surface'}
        loading={advancing}
        onPress={onAdvance}
        style={{ marginTop: space.xl }}
      />
    </ScrollView>
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
  flex: { flex: 1 },
  content: { paddingTop: space.lg, paddingBottom: space.xl },
  clockBlock: { gap: space.xs },
  clock: { ...type.display, fontSize: 56, lineHeight: 60, color: colors.accent },
  card: {
    marginTop: space.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.lg,
  },
  field: { marginTop: space.lg, gap: space.sm },
  labelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  stepperRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
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
  numeral: { ...type.numeral, color: colors.text },
  unit: { ...type.body, color: colors.muted },
  upNext: {
    marginTop: space.lg,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.elevated,
    borderWidth: 1,
    borderColor: colors.border,
  },
  upNextRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.sm },
  thumb: { width: 64, height: 64, borderRadius: radius.sm },
  thumbEmpty: { backgroundColor: colors.surface },
  upNextName: { ...type.body, fontWeight: '700' },
});
