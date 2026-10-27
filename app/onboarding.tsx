import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo, Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, View,
} from 'react-native';
import Animated, { FadeIn, ReduceMotion, SlideInLeft, SlideInRight, SlideOutLeft, SlideOutRight, withDelay } from 'react-native-reanimated';

import { DoodlePop, MarkerStroke } from '@/components/Doodle';
import { Icon } from '@/components/Icon';
import { NumberField } from '@/components/NumberField';
import {
  Body, Button, Chip, Display, Heading, Muted, Overline, ProgressBar, Screen,
} from '@/components/ui';
import { useAuth, useUserId } from '@/lib/auth';
import { savePlan, updateProfile, uploadAvatar } from '@/lib/db/queries';
import { GYM_EQUIPMENT } from '@/lib/plan/gym-routine';
import { OFFICE_EQUIPMENT } from '@/lib/plan/preferences';
import { deviceTimeZone } from '@/lib/calendar-days';
import { generateOfficeGymPlan } from '@/lib/plan/office-gym';
import { colors, radius, space, type, webFocusRing } from '@/lib/theme';
import { MeasurementDrafts } from '@/lib/measurement-drafts';
import { heightUnit } from '@/lib/units';
import { getStepDirection, motion, type StepDirection } from '@/lib/motion';
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

const LIMITATIONS = [
  { value: 'shoulders', label: 'Shoulders' },
  { value: 'lower back', label: 'Lower back' },
  { value: 'knee', label: 'Knees' },
  { value: 'neck', label: 'Neck' },
  { value: 'wrist', label: 'Wrists' },
];

const STEPS = ['you', 'goal', 'level', 'days', 'length', 'equipment', 'body', 'limits'] as const;
type Step = (typeof STEPS)[number];

/** When the footer would leave less than this, scroll the whole shell instead of covering answers. */
const MIN_QUESTION_HEIGHT = 96;

/** The three things the build screen reports, in the order they happen. */
const BUILD_STAGES = ['Saving your photo', 'Building your plan', 'Saving your profile'] as const;

export default function Onboarding() {
  const userId = useUserId();
  const { refreshProfile } = useAuth();

  const [index, setIndex] = useState(0);
  const [direction, setDirection] = useState<StepDirection>('forward');
  const [name, setName] = useState('');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [goal, setGoal] = useState<Goal>('hypertrophy');
  const [experience, setExperience] = useState<Level>('intermediate');
  const [days, setDays] = useState(4);
  const [minutes, setMinutes] = useState(45);
  const [measurements, setMeasurements] = useState(() => MeasurementDrafts.fromCanonical('kg', null, null));
  const [limits, setLimits] = useState<string[]>([]);
  const [equipment, setEquipment] = useState<Equipment[]>([...GYM_EQUIPMENT]);
  const [stage, setStage] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shellHeight, setShellHeight] = useState(0);
  const [headerHeight, setHeaderHeight] = useState(0);
  const [footerHeight, setFooterHeight] = useState(0);
  const submitting = useRef(false);
  const announcedStep = useRef<number | null>(null);

  const step: Step = STEPS[index];
  const building = stage != null;
  const [scrollShell, setScrollShell] = useState(false);
  useEffect(() => {
    if (scrollShell || shellHeight === 0) return;
    if (shellHeight - headerHeight - footerHeight < MIN_QUESTION_HEIGHT) setScrollShell(true);
  }, [footerHeight, headerHeight, scrollShell, shellHeight]);

  useEffect(() => {
    if (announcedStep.current === index) return;
    const previous = announcedStep.current;
    announcedStep.current = index;
    if (previous == null) return;
    AccessibilityInfo.announceForAccessibility(`Step ${index + 1} of ${STEPS.length}`);
  }, [index]);

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

  const finish = async () => {
    if (submitting.current) return;
    const committed = MeasurementDrafts.commit(measurements);
    if (!committed.ok) {
      setError(committed.reason);
      const bodyIndex = STEPS.indexOf('body');
      if (index !== bodyIndex) {
        setDirection(getStepDirection(index, bodyIndex));
        setIndex(bodyIndex);
      }
      return;
    }
    submitting.current = true;
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
      const plan = generateOfficeGymPlan({
        userId,
        goal,
        experience,
        daysPerWeek: days,
        sessionMinutes: minutes,
        limitations: limits,
        equipment,
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
        equipment,
        home_timezone: deviceTimeZone(),
        limitations: limits,
        units: measurements.units,
        bodyweight_kg: committed.massKg,
        height_cm: committed.lengthCm,
        onboarded_at: new Date().toISOString(),
      });

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // No navigation here: refreshing the profile flips the routing gate, and
      // racing it with a replace() is what used to strand the app mid-move.
      await refreshProfile();
    } catch (e) {
      submitting.current = false;
      setStage(null);
      setError(e instanceof Error ? e.message : 'Could not build your plan');
    }
  };

  const next = () => {
    if (submitting.current) return;
    Keyboard.dismiss();
    Haptics.selectionAsync();
    if (index === STEPS.length - 1) return finish();
    setDirection(getStepDirection(index, index + 1));
    setIndex(index + 1);
  };

  const switchUnits = (nextUnits: Units) => {
    Haptics.selectionAsync();
    const switched = MeasurementDrafts.switchUnits(measurements, nextUnits);
    if (switched.blockedReason) {
      setError(switched.blockedReason);
      return;
    }
    setError(null);
    setMeasurements(switched.draft);
  };

  if (building) return <Building stage={stage} name={name.trim()} />;

  const question = (
          <Animated.View
            key={step}
            entering={(direction === 'forward' ? SlideInRight : SlideInLeft)
              .duration(motion.base)
              .springify()
              .damping(motion.settle.damping)
              .reduceMotion(ReduceMotion.System)}
            exiting={(direction === 'forward' ? SlideOutLeft : SlideOutRight)
              .duration(motion.fast)
              .reduceMotion(ReduceMotion.System)}
            style={styles.question}
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
                <View testID="onboarding-days" style={styles.wrap}>
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
                <View testID="onboarding-length" style={styles.wrap}>
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
              <Question title={'What equipment\nis available?'} hint="Choose from the confirmed office gym. Bodyweight is always available.">
                <View style={styles.wrap}>
                  {OFFICE_EQUIPMENT.map((option) => (
                    <Chip key={option.value} label={option.label} selected={equipment.includes(option.value)}
                      onPress={() => toggle(equipment, option.value, setEquipment)} />
                  ))}
                </View>
              </Question>
            )}

            {step === 'body' && (
              <Question
                title={'Your size?'}
                hint="Bodyweight is used for pull-ups, dips and push-ups."
              >
                <View style={styles.wrap}>
                  {(['kg', 'lb'] as Units[]).map((u) => (
                    <Chip
                      key={u}
                      label={u.toUpperCase()}
                      selected={measurements.units === u}
                      onPress={() => switchUnits(u)}
                    />
                  ))}
                </View>
                <Overline>Bodyweight</Overline>
                <NumberField
                  value={measurements.massText}
                  onChangeText={(text) => {
                    setError(null);
                    setMeasurements(MeasurementDrafts.editMass(measurements, text));
                  }}
                  placeholder={measurements.units === 'kg' ? '78' : '172'}
                  unit={measurements.units}
                  accessibilityLabel="Bodyweight"
                />
                <Overline>Height</Overline>
                <NumberField
                  value={measurements.lengthText}
                  onChangeText={(text) => {
                    setError(null);
                    setMeasurements(MeasurementDrafts.editLength(measurements, text));
                  }}
                  placeholder={measurements.units === 'kg' ? '180' : '71'}
                  unit={heightUnit(measurements.units)}
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
  );

  const header = (
    <View
      testID="onboarding-header"
      style={styles.top}
      onLayout={(event) => {
        const next = event.nativeEvent.layout.height;
        setHeaderHeight((current) => current === next ? current : next);
      }}
    >
      <ProgressBar value={(index + 1) / STEPS.length} />
      <Overline style={{ marginTop: space.md }} accessibilityLiveRegion="polite">
        Step {index + 1} of {STEPS.length}
      </Overline>
    </View>
  );

  const footer = (
    <View
      testID="onboarding-footer"
      onLayout={(event) => {
        const next = event.nativeEvent.layout.height;
        setFooterHeight((current) => current === next ? current : next);
      }}
    >
      {error ? <Body accessibilityRole="alert" style={styles.error}>{error}</Body> : null}
      <View testID="onboarding-actions" style={styles.actions}>
        <Button
          title={index === STEPS.length - 1 ? 'Build my plan' : 'Continue'}
          onPress={next}
        />
        {index > 0 ? (
          <Button
            variant="ghost"
            icon="back"
            title="Back"
            onPress={() => {
              Keyboard.dismiss();
              setDirection(getStepDirection(index, index - 1));
              setIndex(index - 1);
            }}
          />
        ) : null}
      </View>
    </View>
  );

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.flex}
    >
      <Screen scroll={false} style={styles.shell}>
        <View
          testID="onboarding-shell"
          style={styles.flex}
          onLayout={(event) => {
            const next = event.nativeEvent.layout.height;
            setShellHeight((current) => current === next ? current : next);
          }}
        >
          {!scrollShell ? (
            <>
              {header}
              {/* Dragging the question dismisses the keyboard so Continue stays in reach. */}
              <ScrollView
                testID="onboarding-question-scroll"
                style={styles.questionScroll}
                contentContainerStyle={styles.questionContent}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="on-drag"
              >
                <Pressable onPress={Keyboard.dismiss} accessible={false}>
                  {question}
                </Pressable>
              </ScrollView>
              {footer}
            </>
          ) : (
            <ScrollView
              testID="onboarding-shell-scroll"
              contentContainerStyle={styles.shellContent}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
            >
              {header}
              <Pressable onPress={Keyboard.dismiss} accessible={false}>
                {question}
              </Pressable>
              {footer}
            </ScrollView>
          )}
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
      <Animated.View entering={FadeIn.duration(300).reduceMotion(ReduceMotion.System)} style={{ gap: space.md }}>
        <Overline>Hang tight</Overline>
        <Display>{name ? `Right then,\n${name}.` : 'Right then.'}</Display>
        <Muted>Putting your week together. This takes a moment.</Muted>
      </Animated.View>

      <View style={styles.stages}>
        {BUILD_STAGES.map((label, i) => (
          <Animated.View
            key={label}
            entering={FadeIn.delay(i * 70).duration(motion.base).reduceMotion(ReduceMotion.System)}
            style={styles.stageRow}
          >
            <DoodlePop active={i <= stage}>
              <View style={[styles.tick, i < stage && styles.tickDone, i === stage && styles.tickActive]}>
                {i < stage ? <Icon name="check" size={14} color={colors.accentInk} /> : null}
              </View>
            </DoodlePop>
            <Body style={[styles.stageLabel, i > stage && { color: colors.faint }]}>{label}</Body>
            {i === stage ? <MarkerStroke style={styles.stageMarker} /> : null}
          </Animated.View>
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
      accessibilityLabel={label}
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
      {selected ? <MarkerStroke testID="selected-marker" style={styles.optionMarker} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  shell: { paddingHorizontal: space.lg },
  top: { gap: space.xs },
  questionScroll: { flex: 1, minHeight: 0, overflow: 'hidden' },
  questionContent: { paddingBottom: space.md },
  question: { overflow: 'hidden' },
  shellContent: { flexGrow: 1, paddingBottom: space.md },
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
    overflow: 'hidden',
  },
  optionSelected: { backgroundColor: colors.accent, borderColor: colors.accent },
  optionBlurb: { color: colors.muted, ...type.small },
  optionMarker: { position: 'absolute', left: space.lg, right: space.lg, bottom: 7, backgroundColor: colors.accentInk },
  actions: { gap: space.xs },
  error: { color: colors.danger, ...type.small, marginBottom: space.sm },
  building: { padding: space.lg, justifyContent: 'center', gap: space.xxxl },
  stages: { gap: space.lg },
  stageRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, position: 'relative' },
  stageMarker: { position: 'absolute', left: 36, right: 0, bottom: -5 },
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
  stageLabel: { ...type.body, color: colors.text },
});
