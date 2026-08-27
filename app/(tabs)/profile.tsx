import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { Alert, StyleSheet, TextInput, View } from 'react-native';

import { Attribution } from '@/components/Attribution';
import { Button, Card, Chip, Display, Muted, Overline, Screen } from '@/components/ui';
import { useAuth, useUserId } from '@/lib/auth';
import { savePlan, updateProfile } from '@/lib/db/queries';
import { generatePlan } from '@/lib/plan/generate';
import { colors, radius, space, type } from '@/lib/theme';
import { displayToKg, kgToDisplay } from '@/lib/units';
import type { Equipment, Units } from '@/lib/types';

const EQUIPMENT: { value: Equipment; label: string }[] = [
  { value: 'barbell', label: 'Barbell' },
  { value: 'dumbbell', label: 'Dumbbells' },
  { value: 'kettlebell', label: 'Kettlebells' },
  { value: 'cable', label: 'Cables' },
  { value: 'machine', label: 'Machines' },
  { value: 'bands', label: 'Bands' },
  { value: 'bodyweight', label: 'Bodyweight' },
  { value: 'other', label: 'Balls / foam roller' },
];

export default function ProfileTab() {
  const userId = useUserId();
  const { profile, refreshProfile, signOut } = useAuth();

  const units: Units = profile?.units ?? 'kg';
  const [bodyweight, setBodyweight] = useState(
    profile?.bodyweight_kg != null
      ? String(Math.round(kgToDisplay(profile.bodyweight_kg, units) * 10) / 10)
      : '',
  );
  const [equipment, setEquipment] = useState<Equipment[]>(profile?.equipment ?? []);
  const [saving, setSaving] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const parsed = Number.parseFloat(bodyweight);
      await updateProfile(userId, {
        bodyweight_kg: Number.isFinite(parsed) ? displayToKg(parsed, units) : null,
        equipment,
      });
      await refreshProfile();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      Alert.alert('Could not save', e instanceof Error ? e.message : 'Try again.');
    } finally {
      setSaving(false);
    }
  };

  const setUnits = async (next: Units) => {
    Haptics.selectionAsync();
    // Bodyweight is stored in kg, so only the displayed number changes.
    if (profile?.bodyweight_kg != null) {
      setBodyweight(String(Math.round(kgToDisplay(profile.bodyweight_kg, next) * 10) / 10));
    }
    await updateProfile(userId, { units: next });
    await refreshProfile();
  };

  const regenerate = () => {
    if (equipment.length === 0) {
      Alert.alert('Pick some equipment', 'A plan needs at least one thing to train with.');
      return;
    }
    Alert.alert(
      'Build a new plan?',
      'Your logged sessions and weights stay. The current plan is replaced.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Rebuild',
          onPress: async () => {
            if (!profile?.goal || !profile.experience) return;
            setRegenerating(true);
            try {
              // Rebuild uses the chips as they are on screen, so persist them
              // first rather than generating against edits that were never saved.
              await updateProfile(userId, { equipment });
              await savePlan(
                userId,
                generatePlan({
                  userId,
                  goal: profile.goal,
                  experience: profile.experience,
                  daysPerWeek: profile.days_per_week ?? 4,
                  sessionMinutes: profile.session_minutes ?? 45,
                  equipment,
                  limitations: profile.limitations,
                }),
              );
              await refreshProfile();
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            } catch (e) {
              Alert.alert('Could not rebuild', e instanceof Error ? e.message : 'Try again.');
            } finally {
              setRegenerating(false);
            }
          },
        },
      ],
    );
  };

  const toggle = (value: Equipment) => {
    Haptics.selectionAsync();
    setEquipment((list) =>
      list.includes(value) ? list.filter((v) => v !== value) : [...list, value],
    );
  };

  return (
    <Screen>
      <Overline>You</Overline>
      <Display style={{ marginTop: space.sm }}>Profile</Display>

      <Card style={{ marginTop: space.xl, gap: space.md }}>
        <Overline>Bodyweight</Overline>
        <View style={styles.row}>
          <TextInput
            style={styles.input}
            value={bodyweight}
            onChangeText={setBodyweight}
            keyboardType="decimal-pad"
            placeholder="—"
            placeholderTextColor={colors.faint}
          />
          <View style={{ gap: space.sm }}>
            {(['kg', 'lb'] as Units[]).map((u) => (
              <Chip key={u} label={u.toUpperCase()} selected={units === u} onPress={() => setUnits(u)} />
            ))}
          </View>
        </View>
        <Muted>Used to work out effective load on pull-ups, dips and push-ups.</Muted>
      </Card>

      <Card style={{ marginTop: space.lg, gap: space.md }}>
        <Overline>Equipment</Overline>
        <View style={styles.wrap}>
          {EQUIPMENT.map((e) => (
            <Chip
              key={e.value}
              label={e.label}
              selected={equipment.includes(e.value)}
              onPress={() => toggle(e.value)}
            />
          ))}
        </View>
        <Muted>Changes apply the next time you rebuild your plan.</Muted>
      </Card>

      <Button title="Save" onPress={save} loading={saving} style={{ marginTop: space.xl }} />
      <Button
        title="Rebuild my plan"
        variant="surface"
        onPress={regenerate}
        loading={regenerating}
        style={{ marginTop: space.md }}
      />
      <Button variant="ghost" title="Sign out" onPress={signOut} style={{ marginTop: space.sm }} />

      <Attribution />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space.md, alignItems: 'center' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  input: {
    ...type.numeral,
    flex: 1,
    color: colors.text,
    backgroundColor: colors.elevated,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    textAlign: 'center',
  },
});
