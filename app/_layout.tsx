import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthProvider, useAuth } from '@/lib/auth';
import { profileGate } from '@/lib/auth-gate';
import { Button, Body, Screen } from '@/components/ui';
import { colors } from '@/lib/theme';
import { startOutboxSync } from '@/lib/session/sync';

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
  const { session, profileState, loading, refreshProfile, signOut } = useAuth();
  if (loading) return <Splash />;

  const signedIn = session != null;
  const gate = profileGate(signedIn, profileState);
  if (gate === 'loading') return <Splash />;
  if (gate === 'error') {
    return (
      <Screen scroll={false} style={{ justifyContent: 'center' }}>
        <Body>Couldn’t reach the server. Your plan has not been changed.</Body>
        <Button title="Retry" onPress={() => { void refreshProfile(); }} style={{ marginTop: 24 }} />
        <Button title="Sign out" variant="ghost" onPress={() => { void signOut(); }} />
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

      {/* Onboarding is not in a route group: a group index would claim "/" too,
          and the tab bar's Today screen already owns it. */}
      <Stack.Protected guard={signedIn && !onboarded}>
        <Stack.Screen name="onboarding" />
      </Stack.Protected>

      <Stack.Protected guard={onboarded}>
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

export default function RootLayout() {
  useEffect(() => startOutboxSync(), []);
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AuthProvider>
          <StatusBar style="light" />
          <Routes />
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
