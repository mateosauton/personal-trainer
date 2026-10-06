import { useRef, useState } from 'react';
import { Keyboard, KeyboardAvoidingView, Platform, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Body, Button, Display, Muted, Overline, Screen } from '@/components/ui';
import { supabase } from '@/lib/db/supabase';
import { authRecoveryRedirectTo, authRedirectTo } from '@/lib/deep-link';
import { devLoginEmail, devLoginEnabled, devSignIn } from '@/lib/dev-auth';
import { colors, radius, space, type, webFocusRing } from '@/lib/theme';

export default function SignIn() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'signIn' | 'signUp' | 'reset'>('signIn');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const insets = useSafeAreaInsets();
  const passwordRef = useRef<TextInput>(null);

  const isSignUp = mode === 'signUp';
  const isReset = mode === 'reset';
  // The keyboard's return key and the button are the same action, so they read
  // the same condition rather than each deciding for themselves.
  const canSubmit = email.trim().length > 0 && (isReset || password.length >= 6) && !busy;

  /** Both routes back to sign-in run through here so they behave identically. */
  const goTo = (next: 'signIn' | 'signUp' | 'reset') => {
    Keyboard.dismiss();
    setMode(next);
    setError(null);
    setNotice(null);
  };

  const devSubmit = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await devSignIn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Dev sign-in failed');
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (mode === 'reset') {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: authRecoveryRedirectTo() });
        if (error) throw error;
        setNotice('If an account exists for this email, you’ll receive a reset link. Open it on this phone.');
      } else if (mode === 'signUp') {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { emailRedirectTo: authRedirectTo() },
        });
        if (signUpError) throw signUpError;
        // With email confirmation on, there is no session yet -- say so rather
        // than leaving the user staring at an unchanged screen.
        if (!data.session) {
          setNotice('Check your email, then tap the link on this phone to come back here.');
        }
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (signInError) throw signInError;
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: colors.bg }}
    >
      {/* Outside the ScrollView on purpose: while creating an account the way
          back must stay put, even with the software keyboard covering the
          bottom of the screen and the form scrolled. */}
      {isSignUp || isReset ? (
        <View style={[styles.topBar, { paddingTop: insets.top + space.sm }]}>
          <Button
            variant="ghost"
            icon="back"
            title="Back to sign in"
            accessibilityLabel="Back to sign in"
            onPress={() => goTo('signIn')}
            style={styles.backButton}
          />
        </View>
      ) : null}

      <Screen
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.content, isSignUp && styles.contentUnderTopBar]}
      >
        <View style={[styles.header, isSignUp && styles.headerUnderTopBar]}>
          <Overline>Office Gym</Overline>
          <Display style={styles.display}>
            {isReset ? 'Reset your\npassword.' : isSignUp ? 'Let’s get\nyou set up.' : 'Welcome\nback.'}
          </Display>
          <Muted style={{ marginTop: space.md }}>
            Your plan, your logs, your progress — on your phone.
          </Muted>
        </View>

        <View style={styles.form}>
          <TextInput
            style={styles.input}
            placeholder="Email"
            placeholderTextColor={colors.faint}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            returnKeyType={isReset ? 'go' : 'next'}
            submitBehavior="submit"
            onSubmitEditing={() => { if (isReset) { if (canSubmit) void submit(); } else passwordRef.current?.focus(); }}
            value={email}
            onChangeText={setEmail}
          />
          {!isReset ? <TextInput
            ref={passwordRef}
            style={styles.input}
            placeholder="Password"
            placeholderTextColor={colors.faint}
            autoCapitalize="none"
            autoComplete={isSignUp ? 'new-password' : 'current-password'}
            secureTextEntry
            returnKeyType="go"
            onSubmitEditing={() => {
              if (canSubmit) submit();
            }}
            value={password}
            onChangeText={setPassword}
          /> : null}

          {error ? <Body style={styles.error}>{error}</Body> : null}
          {notice ? <Body style={styles.notice}>{notice}</Body> : null}

          <Button
            title={isReset ? 'Send reset link' : isSignUp ? 'Create account' : 'Sign in'}
            onPress={submit}
            loading={busy}
            disabled={!canSubmit}
          />
          {/* In sign-up this is the second, deliberately button-shaped way back
              — the ghost text on its own read as a caption, not a control. */}
          <Button
            variant={isSignUp || isReset ? 'surface' : 'ghost'}
            title={
              isReset ? 'Back to sign in' : isSignUp
                ? notice
                  ? 'Go to sign in'
                  : 'Already have an account? Sign in'
                : 'No account? Sign up'
            }
            accessibilityLabel={isSignUp || isReset ? 'Back to sign in' : 'Create an account'}
            onPress={() => goTo(isSignUp || isReset ? 'signIn' : 'signUp')}
          />

          {mode === 'signIn' ? <Button title="Forgot password?" variant="ghost" onPress={() => goTo('reset')} disabled={busy} /> : null}

          {/* Testing shortcut. Present only in a dev build (or with the opt-in
              flag set) and only for the whitelisted address. */}
          {devLoginEnabled && mode === 'signIn' ? (
            <Button
              variant="surface"
              title={`Dev sign-in · ${devLoginEmail}`}
              accessibilityLabel="Sign in with the test account"
              onPress={devSubmit}
              loading={busy}
            />
          ) : null}
        </View>
      </Screen>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, justifyContent: 'space-between' },
  /** The pinned back bar already covers the safe area, so don't pad twice. */
  contentUnderTopBar: { paddingTop: space.sm },
  topBar: {
    paddingHorizontal: space.lg,
    paddingBottom: space.xs,
    alignItems: 'flex-start',
    backgroundColor: colors.bg,
  },
  backButton: { minHeight: 44, paddingHorizontal: 0 },
  header: { marginTop: space.xxxl },
  headerUnderTopBar: { marginTop: space.xl },
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
