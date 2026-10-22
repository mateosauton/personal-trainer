import { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, TextInput, View } from 'react-native';

import { Body, Button, Display, Muted, Screen } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/db/supabase';
import { colors, radius, space, type, webFocusRing } from '@/lib/theme';

export default function ResetPassword() {
  const { signOut } = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    if (busy) return;
    if (password.length < 6) { setError('Use at least 6 characters.'); return; }
    if (password !== confirm) { setError('Passwords do not match.'); return; }
    setBusy(true); setError(null);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      await signOut();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not save your password. Please retry.');
    } finally { setBusy(false); }
  };
  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <Screen keyboardShouldPersistTaps="handled">
        <Display>Choose a new password.</Display>
        <Muted style={{ marginTop: space.md }}>After saving, sign in with your new password.</Muted>
        <View style={{ gap: space.md, marginTop: space.xl }}>
          <TextInput placeholder="New password" accessibilityLabel="New password" secureTextEntry autoCapitalize="none" autoComplete="new-password" value={password} onChangeText={setPassword} style={styles.input} placeholderTextColor={colors.faint} editable={!busy} />
          <TextInput placeholder="Confirm password" accessibilityLabel="Confirm password" secureTextEntry autoCapitalize="none" autoComplete="new-password" value={confirm} onChangeText={setConfirm} style={styles.input} placeholderTextColor={colors.faint} editable={!busy} returnKeyType="go" onSubmitEditing={() => { void save(); }} />
          {error ? <Body style={{ color: colors.danger }}>{error}</Body> : null}
          <Button title="Save password" onPress={save} loading={busy} />
          <Button title="Cancel and sign out" variant="ghost" disabled={busy} onPress={() => { void signOut().catch((error: unknown) => setError(error instanceof Error ? error.message : 'Could not sign out.')); }} />
        </View>
      </Screen>
    </KeyboardAvoidingView>
  );
}
const styles = StyleSheet.create({ input: {
  ...type.body, color: colors.text, backgroundColor: colors.surface, borderWidth: 1,
  borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: space.lg,
  paddingVertical: space.lg, ...webFocusRing,
} });
