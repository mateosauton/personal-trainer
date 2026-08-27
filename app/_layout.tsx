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
 * and ready. Redirects run in an effect so the navigator has mounted first.
 */
function Gate({ children }: { children: React.ReactNode }) {
  const { session, profile, loading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  const group = segments[0];
  const inAuth = group === '(auth)';
  const inOnboarding = group === '(onboarding)';

  const needsAuth = !session;
  const needsOnboarding = Boolean(session) && !profile?.onboarded_at;

  // True while the current route does not match where this user belongs, i.e.
  // a redirect is pending. Children must not render in that window: screens
  // behind the gate call useUserId(), which throws without a session, and the
  // redirect only takes effect on the next tick.
  const misplaced =
    (needsAuth && !inAuth) ||
    (needsOnboarding && !inOnboarding) ||
    (!needsAuth && !needsOnboarding && (inAuth || inOnboarding));

  useEffect(() => {
    if (loading) return;
    if (needsAuth) {
      if (!inAuth) router.replace('/(auth)/sign-in');
      return;
    }
    if (needsOnboarding) {
      if (!inOnboarding) router.replace('/(onboarding)');
      return;
    }
    if (inAuth || inOnboarding) router.replace('/(tabs)');
  }, [loading, needsAuth, needsOnboarding, inAuth, inOnboarding, router]);

  if (loading || misplaced) {
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
              <Stack.Screen name="(onboarding)" />
              <Stack.Screen name="(tabs)" />
              <Stack.Screen name="session" options={{ animation: 'slide_from_bottom' }} />
            </Stack>
          </Gate>
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
