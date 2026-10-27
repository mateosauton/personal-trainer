import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useRef, useState } from 'react';
import { Keyboard, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Attribution } from '@/components/Attribution';
import { AccountPrivacy } from '@/components/AccountPrivacy';
import { useAvatar } from '@/lib/useAvatar';
import { NumberField } from '@/components/NumberField';
import { TrainingPreferences } from '@/components/TrainingPreferences';
import { Body, Button, Card, Chip, Display, Muted, Overline, Screen } from '@/components/ui';
import { notify } from '@/lib/alerts';
import { useAuth, useUserId } from '@/lib/auth';
import { updateProfile, uploadAvatar } from '@/lib/db/queries';
import { colors, radius, space, type, webFocusRing } from '@/lib/theme';
import { MeasurementDrafts } from '@/lib/measurement-drafts';
import { heightUnit } from '@/lib/units';
import type { Units } from '@/lib/types';

export default function ProfileTab() {
  const userId = useUserId();
  const router = useRouter();
  const { profile, refreshProfile, signOut } = useAuth();

  const [name, setName] = useState(profile?.display_name ?? '');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [measurements, setMeasurements] = useState(() => MeasurementDrafts.fromCanonical(
    profile?.units ?? 'kg',
    profile?.bodyweight_kg ?? null,
    profile?.height_cm ?? null,
  ));
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'saved' } | { kind: 'error'; message: string; retry: boolean } | null>(null);
  const savingRef = useRef(false);

  const pickPhoto = async () => {
    Haptics.selectionAsync();
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      notify('Photo access is off', 'Allow photo access to change your picture.');
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
    if (savingRef.current) return;
    const committed = MeasurementDrafts.commit(measurements);
    if (!committed.ok) {
      setNotice({ kind: 'error', message: committed.reason, retry: false });
      return;
    }
    Keyboard.dismiss();
    savingRef.current = true;
    setSaving(true);
    setNotice(null);
    try {
      const avatarUrl = photoUri ? await uploadAvatar(userId, photoUri) : undefined;
      await updateProfile(userId, {
        display_name: name.trim() || null,
        units: measurements.units,
        bodyweight_kg: committed.massKg,
        height_cm: committed.lengthCm,
        ...(avatarUrl ? { avatar_url: avatarUrl } : {}),
      });
      await refreshProfile();
      setPhotoUri(null);
      setNotice({ kind: 'saved' });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      setNotice({ kind: 'error', message: e instanceof Error ? e.message : 'Try again.', retry: true });
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const switchUnits = (next: Units) => {
    Haptics.selectionAsync();
    const switched = MeasurementDrafts.switchUnits(measurements, next);
    if (switched.blockedReason) {
      setNotice({ kind: 'error', message: switched.blockedReason, retry: false });
      return;
    }
    setMeasurements(switched.draft);
    setNotice(null);
  };

  const signedAvatar = useAvatar(profile?.avatar_url ?? null, userId);
  const avatar = photoUri ?? signedAvatar;

  return (
    <Screen>
      <View style={styles.topRow}>
        <Overline>You</Overline>
        {/* A modal needs its own way out; there is no tab to go back to. */}
        <Button
          variant="ghost"
          icon="close"
          accessibilityLabel="Close profile"
          onPress={() => router.back()}
          style={styles.close}
        />
      </View>
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
              <Chip key={u} label={u.toUpperCase()} selected={measurements.units === u} onPress={() => switchUnits(u)} />
            ))}
          </View>
        </View>
        <Overline>Bodyweight</Overline>
        <NumberField
          value={measurements.massText}
          onChangeText={(text) => {
            setNotice(null);
            setMeasurements(MeasurementDrafts.editMass(measurements, text));
          }}
          placeholder="—"
          unit={measurements.units}
          accessibilityLabel="Bodyweight"
        />
        <Overline>Height</Overline>
        <NumberField
          value={measurements.lengthText}
          onChangeText={(text) => {
            setNotice(null);
            setMeasurements(MeasurementDrafts.editLength(measurements, text));
          }}
          placeholder="—"
          unit={heightUnit(measurements.units)}
          accessibilityLabel="Height"
        />
        <Muted>Bodyweight works out effective load on pull-ups, dips and push-ups.</Muted>
        {notice?.kind === 'error' ? (
          <Body accessibilityRole="alert" style={styles.error}>{notice.message}</Body>
        ) : null}
      </Card>

      <Button
        title={notice?.kind === 'error' && notice.retry ? 'Retry' : 'Save'}
        onPress={save}
        loading={saving}
        style={{ marginTop: space.xl }}
      />
      {notice?.kind === 'saved' ? <Muted accessibilityLiveRegion="polite">Saved</Muted> : null}
      <TrainingPreferences key={userId} />
      <AccountPrivacy owner={userId} />
      <Button variant="ghost" title="Sign out" onPress={() => { void signOut().catch((error: unknown) => notify('Could not sign out', error instanceof Error ? error.message : 'Please retry.')); }} style={{ marginTop: space.sm }} />

      <Attribution />
    </Screen>
  );
}

const styles = StyleSheet.create({
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  close: { minHeight: 44, paddingHorizontal: 0 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, alignItems: 'center' },
  labelRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
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
  error: { color: colors.danger, ...type.small },
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
