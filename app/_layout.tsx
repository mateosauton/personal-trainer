import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthProvider, useAuth } from '@/lib/auth';
import { colors } from '@/lib/theme';

/**
 * Routing gate. Three states matter: signed out, signed in but not onboarded,
 * and ready.
 *
 * Screens behind the gate assert a session (`useUserId`), so the gate must not
 * render one until it knows the user belongs there — hence `allowed`: while the
 * redirect is still in flight the app holds on the splash rather than mounting
 * a screen that would throw.
 */
function Gate({ children }: { children: React.ReactNode }) {
  const { session, profile, loading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  const group = segments[0];
  const inAuth = group === '(auth)';
  const inOnboarding = group === 'onboarding';

  // Signed in and onboarded is the permissive case: tabs, a running session and
  // anything else are all fine. The other two states pin you to one place.
  const allowed = loading
    ? false
    : !session
      ? inAuth
      : !profile?.onboarded_at
        ? inOnboarding
        : !inAuth && !inOnboarding;

  useEffect(() => {
    if (loading || allowed) return;
    if (!session) router.replace('/(auth)/sign-in');
    else if (!profile?.onboarded_at) router.replace('/onboarding');
    else router.replace('/(tabs)');
  }, [loading, allowed, session, profile, router]);

  if (!allowed) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }
  return <>{children}</>;
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AuthProvider>
          <StatusBar style="light" />
          <Gate>
            <Stack
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: colors.bg },
                animation: 'slide_from_right',
              }}
            >
              <Stack.Screen name="(auth)" />
              {/* Not in a route group: a group index would claim "/" as well,
                  and the tab bar's Today screen already owns it. */}
              <Stack.Screen name="onboarding" />
              <Stack.Screen name="(tabs)" />
              <Stack.Screen name="session" options={{ animation: 'slide_from_bottom' }} />
            </Stack>
          </Gate>
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
