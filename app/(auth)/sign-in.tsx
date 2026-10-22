import { useRef, useState } from 'react';
import { Keyboard, KeyboardAvoidingView, Platform, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Body, Button, Display, Muted, Overline, Screen } from '@/components/ui';
import { SocialSignInButtons } from '@/components/SocialSignInButtons';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/db/supabase';
import { authRedirectTo } from '@/lib/deep-link';
import { devLoginEmail, devLoginEnabled, devSignIn } from '@/lib/dev-auth';
import { signInWithSocialProvider, type SocialProvider } from '@/lib/social-auth';
import { colors, radius, space, type, webFocusRing } from '@/lib/theme';

export default function SignIn() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'signIn' | 'signUp'>('signIn');
  const [busy, setBusy] = useState<'email' | 'dev' | SocialProvider | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const insets = useSafeAreaInsets();
  const passwordRef = useRef<TextInput>(null);
  const pendingAction = useRef(false);
  const { authError, clearAuthError } = useAuth();

  const isSignUp = mode === 'signUp';
  const isBusy = busy != null;
  const errorMessage = error ?? authError;
  // The keyboard's return key and the button are the same action, so they read
  // the same condition rather than each deciding for themselves.
  const canSubmit = email.length > 0 && password.length >= 6 && !isBusy;

  const begin = (action: NonNullable<typeof busy>) => {
    if (pendingAction.current) return false;
    pendingAction.current = true;
    setBusy(action);
    setError(null);
    setNotice(null);
    clearAuthError();
    Keyboard.dismiss();
    return true;
  };

  const end = () => {
    pendingAction.current = false;
    setBusy(null);
  };

  /** Both routes back to sign-in run through here so they behave identically. */
  const goTo = (next: 'signIn' | 'signUp') => {
    if (pendingAction.current) return;
    Keyboard.dismiss();
    setMode(next);
    setError(null);
    setNotice(null);
    clearAuthError();
  };

  const devSubmit = async () => {
    if (!begin('dev')) return;
    try {
      await devSignIn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Dev sign-in failed');
    } finally {
      end();
    }
  };

  const socialSubmit = async (provider: SocialProvider) => {
    if (!begin(provider)) return;
    try {
      await signInWithSocialProvider(provider);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not sign in. Please try again.');
    } finally {
      end();
    }
  };

  const submit = async () => {
    if (!canSubmit || !begin('email')) return;
    try {
      if (mode === 'signUp') {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email,
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
        const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
        if (signInError) throw signInError;
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      end();
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
      {isSignUp ? (
        <View style={[styles.topBar, { paddingTop: insets.top + space.sm }]}>
          <Button
            variant="ghost"
            icon="back"
            title="Back to sign in"
            accessibilityLabel="Back to sign in"
            onPress={() => goTo('signIn')}
            disabled={isBusy}
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
            {isSignUp ? 'Let’s get\nyou set up.' : 'Welcome\nback.'}
          </Display>
          <Muted style={{ marginTop: space.md }}>
            Your plan, your logs, your progress — on your phone.
          </Muted>
        </View>

        <View style={styles.form}>
          <SocialSignInButtons
            disabled={isBusy}
            loading={busy === 'google' || busy === 'apple' ? busy : null}
            onPress={(provider) => { void socialSubmit(provider); }}
          />
          <View style={styles.divider}>
            <View style={styles.dividerLine} />
            <Muted>or use email</Muted>
            <View style={styles.dividerLine} />
          </View>
          <TextInput
            style={styles.input}
            placeholder="Email"
            placeholderTextColor={colors.faint}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            returnKeyType="next"
            submitBehavior="submit"
            onSubmitEditing={() => passwordRef.current?.focus()}
            value={email}
            editable={!isBusy}
            onChangeText={setEmail}
          />
          <TextInput
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
            editable={!isBusy}
            onChangeText={setPassword}
          />

          {errorMessage ? <Body accessibilityRole="alert" style={styles.error}>{errorMessage}</Body> : null}
          {notice ? <Body style={styles.notice}>{notice}</Body> : null}

          <Button
            title={isSignUp ? 'Create account' : 'Sign in'}
            onPress={submit}
            loading={busy === 'email'}
            disabled={!canSubmit}
          />
          {/* In sign-up this is the second, deliberately button-shaped way back
              — the ghost text on its own read as a caption, not a control. */}
          <Button
            variant={isSignUp ? 'surface' : 'ghost'}
            title={
              isSignUp
                ? notice
                  ? 'Go to sign in'
                  : 'Already have an account? Sign in'
                : 'No account? Sign up'
            }
            accessibilityLabel={isSignUp ? 'Back to sign in' : 'Create an account'}
            onPress={() => goTo(isSignUp ? 'signIn' : 'signUp')}
            disabled={isBusy}
          />

          {/* Testing shortcut. Present only in a dev build (or with the opt-in
              flag set) and only for the whitelisted address. */}
          {devLoginEnabled && !isSignUp ? (
            <Button
              variant="surface"
              title={`Dev sign-in · ${devLoginEmail}`}
              accessibilityLabel="Sign in with the test account"
              onPress={devSubmit}
              loading={busy === 'dev'}
              disabled={isBusy}
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
  divider: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginVertical: space.xs },
  dividerLine: { flex: 1, height: 1, backgroundColor: colors.border },
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
