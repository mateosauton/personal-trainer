import * as Haptics from 'expo-haptics';
import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Card, Chip, Muted, Overline } from '@/components/ui';
import { confirm, notify } from '@/lib/alerts';
import { useAuth, useUserId } from '@/lib/auth';
import { saveTrainingPlan } from '@/lib/db/plan-preferences';
import { generateOfficeGymPlan } from '@/lib/plan/office-gym';
import {
  OFFICE_EQUIPMENT, TRAINING_GOALS, TRAINING_LEVELS, TRAINING_LIMITATIONS,
  trainingPreferences,
} from '@/lib/plan/preferences';
import { workouts } from '@/lib/session/workout';
import { space } from '@/lib/theme';

export function TrainingPreferences() {
  const userId = useUserId();
  const { profile, refreshProfile } = useAuth();
  const [preferences, setPreferences] = useState(() => trainingPreferences(profile));
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);
  const toggle = (field: 'equipment' | 'limitations', value: string) => setPreferences((current) => ({
    ...current,
    [field]: current[field].includes(value as never)
      ? current[field].filter((item) => item !== value) : [...current[field], value],
  }));

  const rebuild = async () => {
    if (inFlight.current) return;
    const approved = await confirm({
      title: 'Save preferences and rebuild?',
      message: `${preferences.days_per_week} days a week, ${preferences.session_minutes} minute sessions. Your logged sessions and weights stay. The current plan is replaced.`,
      confirmLabel: 'Save and rebuild',
    });
    if (!approved) return;
    inFlight.current = true;
    setSaving(true);
    try {
      if (await workouts.read(userId)) throw new Error('Finish your saved workout before rebuilding your plan.');
      const generated = generateOfficeGymPlan({
        userId, goal: preferences.goal, experience: preferences.experience,
        daysPerWeek: preferences.days_per_week, sessionMinutes: preferences.session_minutes,
        equipment: preferences.equipment, limitations: preferences.limitations,
      });
      await saveTrainingPlan(userId, preferences, generated);
      await refreshProfile();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      notify('Plan rebuilt', 'Your new preferences and plan are saved. Your workout history is preserved.');
    } catch (error) {
      notify('Could not rebuild', error instanceof Error ? error.message : 'Please retry.');
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  };

  return (
    <Card pointerEvents={saving ? 'none' : 'auto'} style={{ marginTop: space.lg, gap: space.md }}>
      <Overline>Training preferences</Overline>
      <Muted>Changes apply when you save and rebuild. Only equipment confirmed at this gym is offered. Bodyweight is always available.</Muted>
      <Overline>Goal</Overline>
      <View style={styles.wrap}>{TRAINING_GOALS.map((option) => <Chip key={option.value}
        label={option.label} selected={preferences.goal === option.value}
        onPress={() => setPreferences((current) => ({ ...current, goal: option.value }))} />)}</View>
      <Overline>Experience</Overline>
      <View style={styles.wrap}>{TRAINING_LEVELS.map((option) => <Chip key={option.value}
        label={option.label} selected={preferences.experience === option.value}
        onPress={() => setPreferences((current) => ({ ...current, experience: option.value }))} />)}</View>
      <Overline>Days a week</Overline>
      <View style={styles.wrap}>{[2, 3, 4, 5, 6].map((days) => <Chip key={days} label={`${days}`}
        selected={preferences.days_per_week === days}
        onPress={() => setPreferences((current) => ({ ...current, days_per_week: days }))} />)}</View>
      <Overline>Session length</Overline>
      <View style={styles.wrap}>{[30, 45, 60].map((minutes) => <Chip key={minutes} label={`${minutes} min`}
        selected={preferences.session_minutes === minutes}
        onPress={() => setPreferences((current) => ({ ...current, session_minutes: minutes }))} />)}</View>
      <Overline>Available equipment</Overline>
      <View style={styles.wrap}>{OFFICE_EQUIPMENT.map((option) => <Chip key={option.value}
        label={option.label} selected={preferences.equipment.includes(option.value)}
        onPress={() => toggle('equipment', option.value)} />)}</View>
      <Overline>Limitations</Overline>
      <View style={styles.wrap}>{TRAINING_LIMITATIONS.map((option) => <Chip key={option.value}
        label={option.label} selected={preferences.limitations.includes(option.value)}
        onPress={() => toggle('limitations', option.value)} />)}</View>
      <Muted>Home calendar timezone: {profile?.home_timezone ?? 'UTC'}. Travel keeps your calendar and streak on this timezone.</Muted>
      <Button title="Save preferences and rebuild" onPress={rebuild} loading={saving} />
    </Card>
  );
}
const styles = StyleSheet.create({ wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm } });
