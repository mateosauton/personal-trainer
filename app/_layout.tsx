import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthProvider, useAuth } from '@/lib/auth';
import { colors } from '@/lib/theme';

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
  const { session, profile, loading } = useAuth();
  if (loading) return <Splash />;

  const signedIn = session != null;
  const onboarded = signedIn && profile?.onboarded_at != null;

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
        <Stack.Screen name="session" options={{ animation: 'slide_from_bottom' }} />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
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
