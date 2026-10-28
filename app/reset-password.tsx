import { useState } from 'react';
import { useRouter } from 'expo-router';
import { Keyboard, KeyboardAvoidingView, Platform, StyleSheet, TextInput, View } from 'react-native';

import { Body, Button, Display, Muted, Overline, Screen } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/db/supabase';
import { authRecoveryRedirectTo } from '@/lib/deep-link';
import { colors, radius, space, type, webFocusRing } from '@/lib/theme';

export default function ResetPassword() {
  const { recoveringPassword } = useAuth();
  if (recoveringPassword) return <ChoosePassword />;
  return <RequestResetLink />;
}

function RequestResetLink() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const canSubmit = email.trim().length > 0 && !busy;

  const send = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    Keyboard.dismiss();
    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: authRecoveryRedirectTo(),
      });
      if (resetError) throw resetError;
      setNotice('If an account exists for this email, you’ll receive a reset link. Open it on this phone.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not send a reset link.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.shell}>
      <Screen keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Overline>Password reset</Overline>
          <Display style={styles.display}>Reset password</Display>
        </View>
        <View style={styles.form}>
          <TextInput
            style={styles.input}
            placeholder="Email"
            accessibilityLabel="Email"
            placeholderTextColor={colors.faint}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            returnKeyType="go"
            value={email}
            editable={!busy}
            onChangeText={setEmail}
            onSubmitEditing={() => { void send(); }}
          />
          {error ? <Body accessibilityRole="alert" style={styles.error}>{error}</Body> : null}
          {notice ? <Body style={styles.notice}>{notice}</Body> : null}
          <Button variant="auth" title="Send reset link" onPress={() => { void send(); }} loading={busy} disabled={!canSubmit} />
          <Button
            variant="ghost"
            title="Back to sign in"
            onPress={() => router.replace('/sign-in')}
            disabled={busy}
          />
        </View>
      </Screen>
    </KeyboardAvoidingView>
  );
}

function ChoosePassword() {
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
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      await signOut();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save your password. Please retry.');
    } finally { setBusy(false); }
  };
  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.shell}>
      <Screen keyboardShouldPersistTaps="handled">
        <Display>Choose a new password.</Display>
        <Muted style={{ marginTop: space.md }}>After saving, sign in with your new password.</Muted>
        <View style={styles.form}>
          <TextInput placeholder="New password" accessibilityLabel="New password" secureTextEntry autoCapitalize="none" autoComplete="new-password" value={password} onChangeText={setPassword} style={styles.input} placeholderTextColor={colors.faint} editable={!busy} />
          <TextInput placeholder="Confirm password" accessibilityLabel="Confirm password" secureTextEntry autoCapitalize="none" autoComplete="new-password" value={confirm} onChangeText={setConfirm} style={styles.input} placeholderTextColor={colors.faint} editable={!busy} returnKeyType="go" onSubmitEditing={() => { void save(); }} />
          {error ? <Body accessibilityRole="alert" style={styles.error}>{error}</Body> : null}
          <Button title="Save password" onPress={() => { void save(); }} loading={busy} />
          <Button title="Cancel and sign out" variant="ghost" disabled={busy} onPress={() => { void signOut().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Could not sign out.')); }} />
        </View>
      </Screen>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: colors.bg },
  content: { flexGrow: 1, justifyContent: 'space-between' },
  header: { marginTop: space.xxxl },
  display: { marginTop: space.md },
  form: { gap: space.md, marginTop: space.xxl },
  input: {
    ...type.body,
    color: colors.text,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.lg,
    ...webFocusRing,
  },
  error: { color: colors.danger, ...type.small },
  notice: { color: colors.accent, ...type.small },
});
