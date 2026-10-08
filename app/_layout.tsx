import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ObserveRoot, useObserve } from '@/lib/observe';
import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthProvider, useAuth } from '@/lib/auth';
import { profileGate } from '@/lib/auth-gate';
import { Button, Body, Screen } from '@/components/ui';
import { colors } from '@/lib/theme';
import { notify } from '@/lib/alerts';
import { cleanupExports } from '@/lib/export-file';

const Splash = () => (
  <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }}>
    <ActivityIndicator color={colors.accent} />
  </View>
);

/**
 * Routing gate. Three states matter: signed out, signed in but not onboarded,
 * and ready.
 *
 * `Stack.Protected` rather than a redirect in an effect: every screen behind
 * the gate asserts a session, so a screen the user does not belong on must
 * never mount in the first place. Guarding declaratively also means the
 * navigator is always there to handle the move — unmounting it and *then*
 * asking the router to go somewhere is what left the app on a dead spinner.
 */
function Routes() {
  useEffect(() => {
    // Cache cleanup must not prevent sign-in if the filesystem is unavailable.
    try { cleanupExports(); } catch { /* Retry at the next export/startup. */ }
  }, []);
  const { session, profileState, loading, refreshProfile, signOut, recoveringPassword, processingAuthLink, authError, retrySession } = useAuth();
  const reportError = (error: unknown) => notify('Could not complete the action', error instanceof Error ? error.message : 'Please retry.');
  if (processingAuthLink || (loading && !recoveringPassword)) return <Splash />;
  if (authError) return (
    <Screen scroll={false} style={{ justifyContent: 'center' }}>
      <Body>{authError.message}</Body>
      <Button title="Retry sign-in" onPress={() => { void retrySession(); }} style={{ marginTop: 24 }} />
      <Button title="Sign out" variant="ghost" onPress={() => { void signOut().catch(reportError); }} />
    </Screen>
  );

  const signedIn = session != null;
  const gate = signedIn && recoveringPassword ? 'recovery' : profileGate(signedIn, profileState);
  if (gate === 'loading') return <Splash />;
  if (gate === 'error') {
    return (
      <Screen scroll={false} style={{ justifyContent: 'center' }}>
        <Body>Couldn’t reach the server. Your plan has not been changed.</Body>
        <Button title="Retry" onPress={() => { void refreshProfile().catch(reportError); }} style={{ marginTop: 24 }} />
        <Button title="Sign out" variant="ghost" onPress={() => { void signOut().catch(reportError); }} />
      </Screen>
    );
  }
  const onboarded = gate === 'ready';

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.bg },
        animation: 'slide_from_right',
      }}
    >
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>

      <Stack.Protected guard={signedIn && recoveringPassword === true}>
        <Stack.Screen name="reset-password" />
      </Stack.Protected>

      {/* Onboarding is not in a route group: a group index would claim "/" too,
          and the tab bar's Today screen already owns it. */}
      <Stack.Protected guard={signedIn && !onboarded && !recoveringPassword}>
        <Stack.Screen name="onboarding" />
      </Stack.Protected>

      <Stack.Protected guard={signedIn && onboarded && !recoveringPassword}>
        <Stack.Screen name="(tabs)" />
        {/* Profile is a modal over the tabs, opened by the avatar on Home. */}
        <Stack.Screen name="profile" options={{ presentation: 'modal' }} />
        {/* A live session owns the screen: full-screen, no tab bar, and no
            swipe-back — dropping out mid-set by accident loses the logged work. */}
        <Stack.Screen
          name="session"
          options={{
            animation: 'slide_from_bottom',
            presentation: 'fullScreenModal',
            gestureEnabled: false,
          }}
        />
      </Stack.Protected>
    </Stack>
  );
}

function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AuthProvider>
          <AppContent />
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function AppContent() {
  const { session, profileState, loading, processingAuthLink, recoveringPassword } = useAuth();
  const { markInteractive } = useObserve();
  const profileLoading = session != null && !recoveringPassword && profileGate(true, profileState) === 'loading';
  const blocked = loading || profileLoading || processingAuthLink;
  useEffect(() => { if (!blocked) markInteractive(); }, [blocked, markInteractive]);
  return <><StatusBar style="light" /><Routes /></>;
}

export default ObserveRoot.wrap(RootLayout);
