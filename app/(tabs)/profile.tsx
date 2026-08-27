import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { Alert, Keyboard, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Attribution } from '@/components/Attribution';
import { NumberField } from '@/components/NumberField';
import { Button, Card, Chip, Display, Muted, Overline, Screen } from '@/components/ui';
import { useAuth, useUserId } from '@/lib/auth';
import { savePlan, updateProfile, uploadAvatar } from '@/lib/db/queries';
import { ALL_EQUIPMENT, generatePlan } from '@/lib/plan/generate';
import { colors, radius, space, type, webFocusRing } from '@/lib/theme';
import { cmToDisplay, displayToCm, displayToKg, heightUnit, kgToDisplay } from '@/lib/units';
import type { Units } from '@/lib/types';

export default function ProfileTab() {
  const userId = useUserId();
  const { profile, refreshProfile, signOut } = useAuth();

  const units: Units = profile?.units ?? 'kg';
  const [name, setName] = useState(profile?.display_name ?? '');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [bodyweight, setBodyweight] = useState(
    profile?.bodyweight_kg != null
      ? String(Math.round(kgToDisplay(profile.bodyweight_kg, units) * 10) / 10)
      : '',
  );
  const [height, setHeight] = useState(
    profile?.height_cm != null
      ? String(Math.round(cmToDisplay(profile.height_cm, units)))
      : '',
  );
  const [saving, setSaving] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  const number = (value: string) => {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const pickPhoto = async () => {
    Haptics.selectionAsync();
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Photo access is off', 'Allow photo access to change your picture.');
      return;
    }
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
    });
    if (!picked.canceled) setPhotoUri(picked.assets[0].uri);
  };

  const save = async () => {
    Keyboard.dismiss();
    setSaving(true);
    try {
      const bw = number(bodyweight);
      const h = number(height);
      const avatarUrl = photoUri ? await uploadAvatar(userId, photoUri) : undefined;
      await updateProfile(userId, {
        display_name: name.trim() || null,
        bodyweight_kg: bw == null ? null : displayToKg(bw, units),
        height_cm: h == null ? null : displayToCm(h, units),
        ...(avatarUrl ? { avatar_url: avatarUrl } : {}),
      });
      await refreshProfile();
      setPhotoUri(null);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      Alert.alert('Could not save', e instanceof Error ? e.message : 'Try again.');
    } finally {
      setSaving(false);
    }
  };

  const setUnits = async (next: Units) => {
    Haptics.selectionAsync();
    // Both measurements are stored metric, so only the displayed number changes.
    if (profile?.bodyweight_kg != null) {
      setBodyweight(String(Math.round(kgToDisplay(profile.bodyweight_kg, next) * 10) / 10));
    }
    if (profile?.height_cm != null) {
      setHeight(String(Math.round(cmToDisplay(profile.height_cm, next))));
    }
    await updateProfile(userId, { units: next });
    await refreshProfile();
  };

  const regenerate = () => {
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
              await savePlan(
                userId,
                generatePlan({
                  userId,
                  goal: profile.goal,
                  experience: profile.experience,
                  daysPerWeek: profile.days_per_week ?? 4,
                  sessionMinutes: profile.session_minutes ?? 45,
                  equipment: ALL_EQUIPMENT,
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

  const avatar = photoUri ?? profile?.avatar_url ?? null;

  return (
    <Screen>
      <Overline>You</Overline>
      <Display style={{ marginTop: space.sm }}>Profile</Display>

      <Card style={{ marginTop: space.xl, gap: space.md }}>
        <Overline>You</Overline>
        <Pressable
          onPress={pickPhoto}
          accessibilityRole="button"
          accessibilityLabel={avatar ? 'Change your photo' : 'Add a photo'}
          style={({ pressed }) => [styles.avatar, pressed && { opacity: 0.8 }]}
        >
          {avatar ? (
            <Image source={{ uri: avatar }} style={styles.avatarImage} contentFit="cover" />
          ) : (
            <Muted style={styles.avatarHint}>Add a{'\n'}photo</Muted>
          )}
        </Pressable>
        <TextInput
          style={styles.textInput}
          value={name}
          onChangeText={setName}
          placeholder="Your name"
          placeholderTextColor={colors.faint}
          autoCapitalize="words"
          returnKeyType="done"
          onSubmitEditing={Keyboard.dismiss}
        />
      </Card>

      <Card style={{ marginTop: space.lg, gap: space.md }}>
        <View style={styles.labelRow}>
          <Overline>Measurements</Overline>
          <View style={styles.row}>
            {(['kg', 'lb'] as Units[]).map((u) => (
              <Chip key={u} label={u.toUpperCase()} selected={units === u} onPress={() => setUnits(u)} />
            ))}
          </View>
        </View>
        <Overline>Bodyweight</Overline>
        <NumberField
          value={bodyweight}
          onChangeText={setBodyweight}
          placeholder="—"
          unit={units}
          accessibilityLabel="Bodyweight"
        />
        <Overline>Height</Overline>
        <NumberField
          value={height}
          onChangeText={setHeight}
          placeholder="—"
          unit={heightUnit(units)}
          accessibilityLabel="Height"
        />
        <Muted>Bodyweight works out effective load on pull-ups, dips and push-ups.</Muted>
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
  row: { flexDirection: 'row', gap: space.sm, alignItems: 'center' },
  labelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  avatar: {
    alignSelf: 'center',
    width: 96,
    height: 96,
    borderRadius: radius.pill,
    backgroundColor: colors.elevated,
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
    backgroundColor: colors.elevated,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: space.lg,
    paddingVertical: space.lg,
    textAlign: 'center',
    ...webFocusRing,
  },
});
