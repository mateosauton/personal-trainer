import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import Animated, { FadeIn, FadeOut, Layout } from 'react-native-reanimated';

import {
  Body, Button, Chip, Display, Heading, Muted, Overline, ProgressBar, Screen,
} from '@/components/ui';
import { useAuth, useUserId } from '@/lib/auth';
import { savePlan, updateProfile } from '@/lib/db/queries';
import { generatePlan } from '@/lib/plan/generate';
import { colors, radius, space, type } from '@/lib/theme';
import type { Equipment, Goal, Level, Units } from '@/lib/types';

const GOALS: { value: Goal; label: string; blurb: string }[] = [
  { value: 'strength', label: 'Get stronger', blurb: 'Heavy, low reps, long rests' },
  { value: 'hypertrophy', label: 'Build muscle', blurb: 'Moderate loads, more volume' },
  { value: 'fat_loss', label: 'Lean out', blurb: 'Higher reps, short rests' },
  { value: 'general', label: 'Stay fit', blurb: 'Balanced, sustainable' },
];

const LEVELS: { value: Level; label: string; blurb: string }[] = [
  { value: 'beginner', label: 'New to it', blurb: 'Under a year of lifting' },
  { value: 'intermediate', label: 'Comfortable', blurb: 'Know the main lifts' },
  { value: 'advanced', label: 'Experienced', blurb: 'Years under the bar' },
];

const EQUIPMENT: { value: Equipment; label: string }[] = [
  { value: 'barbell', label: 'Barbell + rack' },
  { value: 'dumbbell', label: 'Dumbbells' },
  { value: 'kettlebell', label: 'Kettlebells' },
  { value: 'cable', label: 'Cables' },
  { value: 'machine', label: 'Machines' },
  { value: 'bands', label: 'Bands' },
  { value: 'bodyweight', label: 'Bodyweight' },
  { value: 'other', label: 'Balls / foam roller' },
];

const LIMITATIONS = [
  { value: 'shoulders', label: 'Shoulders' },
  { value: 'lower back', label: 'Lower back' },
  { value: 'knee', label: 'Knees' },
  { value: 'neck', label: 'Neck' },
  { value: 'wrist', label: 'Wrists' },
];

const STEPS = ['goal', 'level', 'days', 'length', 'equipment', 'body', 'limits'] as const;
type Step = (typeof STEPS)[number];

export default function Onboarding() {
  const userId = useUserId();
  const { refreshProfile } = useAuth();
  const router = useRouter();

  const [index, setIndex] = useState(0);
  const [goal, setGoal] = useState<Goal>('hypertrophy');
  const [experience, setExperience] = useState<Level>('intermediate');
  const [days, setDays] = useState(4);
  const [minutes, setMinutes] = useState(45);
  // Pre-ticked with a well-equipped gym; unticking is faster than ticking.
  const [equipment, setEquipment] = useState<Equipment[]>([
    'barbell', 'dumbbell', 'kettlebell', 'cable', 'machine', 'bands', 'bodyweight',
  ]);
  const [units, setUnits] = useState<Units>('kg');
  const [bodyweight, setBodyweight] = useState('');
  const [limits, setLimits] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const step: Step = STEPS[index];

  const toggle = <T,>(list: T[], value: T, set: (next: T[]) => void) => {
    Haptics.selectionAsync();
    set(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  };

  const canAdvance = step === 'equipment' ? equipment.length > 0 : true;

  const finish = async () => {
    setBusy(true);
    setError(null);
    try {
      const parsed = Number.parseFloat(bodyweight);
      const bodyweightKg = Number.isFinite(parsed)
        ? units === 'kg'
          ? parsed
          : parsed / 2.2046226218
        : null;

      const plan = generatePlan({
        userId,
        goal,
        experience,
        daysPerWeek: days,
        sessionMinutes: minutes,
        equipment,
        limitations: limits,
      });
      await savePlan(userId, plan);
      await updateProfile(userId, {
        goal,
        experience,
        days_per_week: days,
        session_minutes: minutes,
        equipment,
        limitations: limits,
        units,
        bodyweight_kg: bodyweightKg,
        onboarded_at: new Date().toISOString(),
      });
      await refreshProfile();
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace('/(tabs)');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not build your plan');
    } finally {
      setBusy(false);
    }
  };

  const next = () => {
    Haptics.selectionAsync();
    if (index === STEPS.length - 1) return finish();
    setIndex(index + 1);
  };

  return (
    <Screen scroll={false} style={{ padding: space.lg }}>
      <View style={styles.top}>
        <ProgressBar value={(index + 1) / STEPS.length} />
        <Overline style={{ marginTop: space.md }}>
          Step {index + 1} of {STEPS.length}
        </Overline>
      </View>

      <Animated.View
        key={step}
        entering={FadeIn.duration(220)}
        exiting={FadeOut.duration(120)}
        layout={Layout}
        style={styles.body}
      >
        {step === 'goal' && (
          <Question title={'What are you\ntraining for?'}>
            {GOALS.map((g) => (
              <Option
                key={g.value}
                label={g.label}
                blurb={g.blurb}
                selected={goal === g.value}
                onPress={() => {
                  Haptics.selectionAsync();
                  setGoal(g.value);
                }}
              />
            ))}
          </Question>
        )}

        {step === 'level' && (
          <Question title={'How much lifting\nhave you done?'}>
            {LEVELS.map((l) => (
              <Option
                key={l.value}
                label={l.label}
                blurb={l.blurb}
                selected={experience === l.value}
                onPress={() => {
                  Haptics.selectionAsync();
                  setExperience(l.value);
                }}
              />
            ))}
          </Question>
        )}

        {step === 'days' && (
          <Question title={'How many days\na week?'} hint="You can change this later.">
            <View style={styles.row}>
              {[2, 3, 4, 5, 6].map((d) => (
                <Chip
                  key={d}
                  label={`${d}`}
                  selected={days === d}
                  onPress={() => {
                    Haptics.selectionAsync();
                    setDays(d);
                  }}
                  style={styles.numberChip}
                />
              ))}
            </View>
          </Question>
        )}

        {step === 'length' && (
          <Question title={'How long is\na session?'} hint="Shorter sessions cut rest and the finisher.">
            <View style={styles.row}>
              {[30, 45, 60].map((m) => (
                <Chip
                  key={m}
                  label={`${m} min`}
                  selected={minutes === m}
                  onPress={() => {
                    Haptics.selectionAsync();
                    setMinutes(m);
                  }}
                />
              ))}
            </View>
          </Question>
        )}

        {step === 'equipment' && (
          <Question title={'What’s in\nyour gym?'} hint="Untick anything you don’t have.">
            <View style={styles.wrap}>
              {EQUIPMENT.map((e) => (
                <Chip
                  key={e.value}
                  label={e.label}
                  selected={equipment.includes(e.value)}
                  onPress={() => toggle(equipment, e.value, setEquipment)}
                />
              ))}
            </View>
          </Question>
        )}

        {step === 'body' && (
          <Question title={'Your bodyweight?'} hint="Used for pull-ups, dips and push-ups.">
            <View style={styles.row}>
              {(['kg', 'lb'] as Units[]).map((u) => (
                <Chip
                  key={u}
                  label={u.toUpperCase()}
                  selected={units === u}
                  onPress={() => {
                    Haptics.selectionAsync();
                    setUnits(u);
                  }}
                />
              ))}
            </View>
            <TextInput
              style={styles.input}
              placeholder={units === 'kg' ? '78' : '172'}
              placeholderTextColor={colors.faint}
              keyboardType="decimal-pad"
              value={bodyweight}
              onChangeText={setBodyweight}
            />
            <Muted>Skip it if you’d rather not — you can add it in Profile.</Muted>
          </Question>
        )}

        {step === 'limits' && (
          <Question title={'Anything to\nwork around?'} hint="We’ll avoid exercises that load these.">
            <View style={styles.wrap}>
              {LIMITATIONS.map((l) => (
                <Chip
                  key={l.value}
                  label={l.label}
                  selected={limits.includes(l.value)}
                  onPress={() => toggle(limits, l.value, setLimits)}
                />
              ))}
            </View>
          </Question>
        )}
      </Animated.View>

      {error ? <Body style={styles.error}>{error}</Body> : null}

      <View style={styles.actions}>
        <Button
          title={index === STEPS.length - 1 ? 'Build my plan' : 'Continue'}
          onPress={next}
          loading={busy}
          disabled={!canAdvance}
        />
        {index > 0 && !busy ? (
          <Button variant="ghost" title="Back" onPress={() => setIndex(index - 1)} />
        ) : null}
      </View>
    </Screen>
  );
}

function Question({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <View style={{ gap: space.lg }}>
      <Display>{title}</Display>
      {hint ? <Muted>{hint}</Muted> : null}
      <View style={{ gap: space.md, marginTop: space.sm }}>{children}</View>
    </View>
  );
}

/** A full-width choice card: headline answer plus the trade-off it implies. */
function Option({
  label,
  blurb,
  selected,
  onPress,
}: {
  label: string;
  blurb: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.option,
        selected && styles.optionSelected,
        pressed && { opacity: 0.8 },
      ]}
    >
      <Heading style={selected ? { color: colors.accentInk } : undefined}>{label}</Heading>
      <Body style={[styles.optionBlurb, selected && { color: colors.accentInk, opacity: 0.75 }]}>
        {blurb}
      </Body>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  top: { gap: space.xs },
  body: { flex: 1, justifyContent: 'center' },
  row: { flexDirection: 'row', gap: space.sm },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  numberChip: { minWidth: 56, alignItems: 'center' },
  option: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.lg,
    gap: space.xs,
  },
  optionSelected: { backgroundColor: colors.accent, borderColor: colors.accent },
  optionBlurb: { color: colors.muted, ...type.small },
  input: {
    ...type.numeral,
    color: colors.text,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    textAlign: 'center',
  },
  actions: { gap: space.xs },
  error: { color: colors.danger, ...type.small, marginBottom: space.sm },
});
