import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import {
  Keyboard, KeyboardAvoidingView, Platform, Pressable, StyleSheet, TextInput, View,
} from 'react-native';
import Animated, { FadeIn, FadeOut, Layout } from 'react-native-reanimated';

import { NumberField } from '@/components/NumberField';
import {
  Body, Button, Chip, Display, Heading, Muted, Overline, ProgressBar, Screen,
} from '@/components/ui';
import { useAuth, useUserId } from '@/lib/auth';
import { savePlan, updateProfile, uploadAvatar } from '@/lib/db/queries';
import { ALL_EQUIPMENT, generatePlan } from '@/lib/plan/generate';
import { colors, radius, space, type, webFocusRing } from '@/lib/theme';
import { displayToCm, displayToKg, heightUnit } from '@/lib/units';
import type { Goal, Level, Units } from '@/lib/types';

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

const LIMITATIONS = [
  { value: 'shoulders', label: 'Shoulders' },
  { value: 'lower back', label: 'Lower back' },
  { value: 'knee', label: 'Knees' },
  { value: 'neck', label: 'Neck' },
  { value: 'wrist', label: 'Wrists' },
];

const STEPS = ['you', 'goal', 'level', 'days', 'length', 'body', 'limits'] as const;
type Step = (typeof STEPS)[number];

/** The three things the build screen reports, in the order they happen. */
const BUILD_STAGES = ['Saving your photo', 'Building your plan', 'Saving your profile'] as const;

export default function Onboarding() {
  const userId = useUserId();
  const { refreshProfile } = useAuth();

  const [index, setIndex] = useState(0);
  const [name, setName] = useState('');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [goal, setGoal] = useState<Goal>('hypertrophy');
  const [experience, setExperience] = useState<Level>('intermediate');
  const [days, setDays] = useState(4);
  const [minutes, setMinutes] = useState(45);
  const [units, setUnits] = useState<Units>('kg');
  const [bodyweight, setBodyweight] = useState('');
  const [height, setHeight] = useState('');
  const [limits, setLimits] = useState<string[]>([]);
  const [stage, setStage] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const step: Step = STEPS[index];
  const building = stage != null;

  const toggle = <T,>(list: T[], value: T, set: (next: T[]) => void) => {
    Haptics.selectionAsync();
    set(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  };

  const pickPhoto = async () => {
    Haptics.selectionAsync();
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError('Photo access is off — you can add one later in Profile.');
      return;
    }
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
    });
    if (!picked.canceled) {
      setError(null);
      setPhotoUri(picked.assets[0].uri);
    }
  };

  const parse = (value: string) => {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const finish = async () => {
    Keyboard.dismiss();
    setError(null);
    setStage(0);
    try {
      let avatarUrl: string | null = null;
      if (photoUri) {
        // A photo that will not upload is not worth losing an onboarding over.
        try {
          avatarUrl = await uploadAvatar(userId, photoUri);
        } catch {
          avatarUrl = null;
        }
      }

      setStage(1);
      const bw = parse(bodyweight);
      const h = parse(height);
      const plan = generatePlan({
        userId,
        goal,
        experience,
        daysPerWeek: days,
        sessionMinutes: minutes,
        equipment: ALL_EQUIPMENT,
        limitations: limits,
      });
      await savePlan(userId, plan);

      setStage(2);
      await updateProfile(userId, {
        display_name: name.trim() || null,
        avatar_url: avatarUrl,
        goal,
        experience,
        days_per_week: days,
        session_minutes: minutes,
        equipment: ALL_EQUIPMENT,
        limitations: limits,
        units,
        bodyweight_kg: bw == null ? null : displayToKg(bw, units),
        height_cm: h == null ? null : displayToCm(h, units),
        onboarded_at: new Date().toISOString(),
      });

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // No navigation here: refreshing the profile flips the routing gate, and
      // racing it with a replace() is what used to strand the app mid-move.
      await refreshProfile();
    } catch (e) {
      setStage(null);
      setError(e instanceof Error ? e.message : 'Could not build your plan');
    }
  };

  const next = () => {
    Keyboard.dismiss();
    Haptics.selectionAsync();
    if (index === STEPS.length - 1) return finish();
    setIndex(index + 1);
  };

  if (building) return <Building stage={stage} name={name.trim()} />;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.flex}
    >
      <Screen scroll={false} style={{ padding: space.lg }}>
        <View style={styles.top}>
          <ProgressBar value={(index + 1) / STEPS.length} />
          <Overline style={{ marginTop: space.md }}>
            Step {index + 1} of {STEPS.length}
          </Overline>
        </View>

        {/* Anywhere off a field puts the keyboard away, so the Continue button
            is never something the user has to fish for. */}
        <Pressable style={styles.flex} onPress={Keyboard.dismiss} accessible={false}>
          <Animated.View
            key={step}
            entering={FadeIn.duration(220)}
            exiting={FadeOut.duration(120)}
            layout={Layout}
            style={styles.body}
          >
            {step === 'you' && (
              <Question title={'First up —\nwho are you?'} hint="Both are optional.">
                <Pressable
                  onPress={pickPhoto}
                  accessibilityRole="button"
                  accessibilityLabel={photoUri ? 'Change your photo' : 'Add a photo'}
                  style={({ pressed }) => [styles.avatar, pressed && { opacity: 0.8 }]}
                >
                  {photoUri ? (
                    <Image source={{ uri: photoUri }} style={styles.avatarImage} contentFit="cover" />
                  ) : (
                    <Muted style={styles.avatarHint}>Add a{'\n'}photo</Muted>
                  )}
                </Pressable>
                <TextInput
                  style={styles.textInput}
                  placeholder="Your name"
                  placeholderTextColor={colors.faint}
                  value={name}
                  onChangeText={setName}
                  autoCapitalize="words"
                  autoComplete="name"
                  returnKeyType="done"
                  onSubmitEditing={Keyboard.dismiss}
                />
              </Question>
            )}

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

            {step === 'body' && (
              <Question
                title={'Your size?'}
                hint="Bodyweight is used for pull-ups, dips and push-ups."
              >
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
                <Overline>Bodyweight</Overline>
                <NumberField
                  value={bodyweight}
                  onChangeText={setBodyweight}
                  placeholder={units === 'kg' ? '78' : '172'}
                  unit={units}
                  accessibilityLabel="Bodyweight"
                />
                <Overline>Height</Overline>
                <NumberField
                  value={height}
                  onChangeText={setHeight}
                  placeholder={units === 'kg' ? '180' : '71'}
                  unit={heightUnit(units)}
                  accessibilityLabel="Height"
                />
                <Muted>Skip either if you&rsquo;d rather not — you can add them in Profile.</Muted>
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
        </Pressable>

        {error ? <Body style={styles.error}>{error}</Body> : null}

        <View style={styles.actions}>
          <Button
            title={index === STEPS.length - 1 ? 'Build my plan' : 'Continue'}
            onPress={next}
          />
          {index > 0 ? (
            <Button
              variant="ghost"
              title="Back"
              onPress={() => {
                Keyboard.dismiss();
                setIndex(index - 1);
              }}
            />
          ) : null}
        </View>
      </Screen>
    </KeyboardAvoidingView>
  );
}

/**
 * The wait after the last question. Saving a photo, generating a week of
 * training and writing the profile take a few seconds against a real database,
 * and a spinner inside a button does not explain any of it.
 */
function Building({ stage, name }: { stage: number; name: string }) {
  return (
    <Screen scroll={false} style={styles.building}>
      <Animated.View entering={FadeIn.duration(300)} style={{ gap: space.md }}>
        <Overline>Hang tight</Overline>
        <Display>{name ? `Right then,\n${name}.` : 'Right then.'}</Display>
        <Muted>Putting your week together. This takes a moment.</Muted>
      </Animated.View>

      <View style={styles.stages}>
        {BUILD_STAGES.map((label, i) => (
          <View key={label} style={styles.stageRow}>
            <View style={[styles.tick, i < stage && styles.tickDone, i === stage && styles.tickActive]}>
              {i < stage ? <Body style={styles.tickMark}>✓</Body> : null}
            </View>
            <Body style={[styles.stageLabel, i > stage && { color: colors.faint }]}>{label}</Body>
          </View>
        ))}
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
  flex: { flex: 1 },
  top: { gap: space.xs },
  body: { flex: 1, justifyContent: 'center' },
  row: { flexDirection: 'row', gap: space.sm },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  numberChip: { minWidth: 56, alignItems: 'center' },
  avatar: {
    alignSelf: 'center',
    width: 112,
    height: 112,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImage: { width: '100%', height: '100%' },
  avatarHint: { textAlign: 'center', color: colors.muted },
  textInput: {
    ...type.body,
    color: colors.text,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: space.lg,
    paddingVertical: space.lg,
    textAlign: 'center',
    ...webFocusRing,
  },
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
  actions: { gap: space.xs },
  error: { color: colors.danger, ...type.small, marginBottom: space.sm },
  building: { padding: space.lg, justifyContent: 'center', gap: space.xxxl },
  stages: { gap: space.lg },
  stageRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  tick: {
    width: 24,
    height: 24,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tickActive: { borderColor: colors.accent, backgroundColor: colors.surface },
  tickDone: { borderColor: colors.accent, backgroundColor: colors.accent },
  tickMark: { ...type.small, fontWeight: '800', color: colors.accentInk },
  stageLabel: { ...type.body, color: colors.text },
});
