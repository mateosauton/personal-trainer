import { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, TextInput, View } from 'react-native';

import { Body, Button, Display, Muted, Overline, Screen } from '@/components/ui';
import { supabase } from '@/lib/db/supabase';
import { colors, radius, space, type } from '@/lib/theme';

export default function SignIn() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'signIn' | 'signUp'>('signIn');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (mode === 'signUp') {
        const { data, error: signUpError } = await supabase.auth.signUp({ email, password });
        if (signUpError) throw signUpError;
        // With email confirmation on, there is no session yet -- say so rather
        // than leaving the user staring at an unchanged screen.
        if (!data.session) setNotice('Check your email to confirm, then sign in.');
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
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
      <Screen contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Overline>Office Gym</Overline>
          <Display style={styles.display}>
            {mode === 'signIn' ? 'Welcome\nback.' : 'Let’s get\nyou set up.'}
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
            value={email}
            onChangeText={setEmail}
          />
          <TextInput
            style={styles.input}
            placeholder="Password"
            placeholderTextColor={colors.faint}
            autoCapitalize="none"
            autoComplete={mode === 'signUp' ? 'new-password' : 'current-password'}
            secureTextEntry
            value={password}
            onChangeText={setPassword}
          />

          {error ? <Body style={styles.error}>{error}</Body> : null}
          {notice ? <Body style={styles.notice}>{notice}</Body> : null}

          <Button
            title={mode === 'signIn' ? 'Sign in' : 'Create account'}
            onPress={submit}
            loading={busy}
            disabled={!email || password.length < 6}
          />
          <Button
            variant="ghost"
            title={mode === 'signIn' ? 'No account? Sign up' : 'Have an account? Sign in'}
            onPress={() => {
              setMode(mode === 'signIn' ? 'signUp' : 'signIn');
              setError(null);
              setNotice(null);
            }}
          />
        </View>
      </Screen>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, justifyContent: 'space-between' },
  header: { marginTop: space.xxxl },
  display: { marginTop: space.md },
  form: { gap: space.md, marginTop: space.xxxl },
  input: {
    ...type.body,
    color: colors.text,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.lg,
  },
  error: { color: colors.danger, ...type.small },
  notice: { color: colors.accent, ...type.small },
});
