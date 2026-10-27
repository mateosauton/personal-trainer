import * as AppleAuthentication from 'expo-apple-authentication';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import type { SocialProvider } from '@/lib/social-auth';
import { canUseBrowserOAuth } from '@/lib/social-auth-availability';
import { colors, radius, space, type } from '@/lib/theme';

interface Props {
  disabled: boolean;
  loading: SocialProvider | null;
  onPress: (provider: SocialProvider) => void;
}

function ProviderLogo({ provider }: { provider: SocialProvider }) {
  if (provider === 'apple') {
    return (
      <Svg width={22} height={22} viewBox="0 0 24 24" accessibilityElementsHidden>
        <Path fill="#000" d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.5 7.59 9.04 7.31c1.35.07 2.3.8 3.1.86 1.2-.24 2.35-.99 3.63-.9 1.54.12 2.7.74 3.47 1.85-3.18 1.91-2.42 6.1.49 7.27-.58 1.53-1.34 3.05-2.69 3.89ZM12.03 7.25c-.15-2.27 1.69-4.14 3.8-4.32.29 2.62-2.37 4.6-3.8 4.32Z" />
      </Svg>
    );
  }
  return (
    <Svg width={20} height={20} viewBox="0 0 48 48" accessibilityElementsHidden>
      <Path fill="#4285F4" d="M43.61 24.46c0-1.36-.12-2.66-.35-3.92H24v7.42h11a9.4 9.4 0 0 1-4.08 6.16v5h6.6c3.87-3.57 6.09-8.83 6.09-14.66Z" />
      <Path fill="#34A853" d="M24 44c5.4 0 9.93-1.79 13.24-4.88l-6.6-5c-1.83 1.23-4.17 1.97-6.64 1.97-5.2 0-9.61-3.51-11.19-8.24H6v5.16A20 20 0 0 0 24 44Z" />
      <Path fill="#FBBC05" d="M12.81 27.85a12 12 0 0 1 0-7.7V15H6a20 20 0 0 0 0 18l6.81-5.15Z" />
      <Path fill="#EA4335" d="M24 11.91c2.94 0 5.57 1.01 7.64 3L37.36 9C33.91 5.78 29.4 4 24 4A20 20 0 0 0 6 15l6.81 5.15C14.39 15.42 18.8 11.91 24 11.91Z" />
    </Svg>
  );
}

export function SocialSignInButtons({ disabled, loading, onPress }: Props) {
  const googleEnabled = process.env.EXPO_PUBLIC_GOOGLE_SIGN_IN_ENABLED === '1';
  const appleEnabled = process.env.EXPO_PUBLIC_APPLE_SIGN_IN_ENABLED === '1';
  const [nativeAppleAvailable, setNativeAppleAvailable] = useState(false);
  const browserOAuthAvailable = canUseBrowserOAuth();

  useEffect(() => {
    if (!appleEnabled || Platform.OS !== 'ios') return;
    let active = true;
    AppleAuthentication.isAvailableAsync()
      .then((available) => { if (active) setNativeAppleAvailable(available); })
      .catch(() => { if (active) setNativeAppleAvailable(false); });
    return () => { active = false; };
  }, [appleEnabled]);

  if (!googleEnabled && !appleEnabled) return null;

  const providerButton = (provider: SocialProvider) => {
    const buttonDisabled = disabled || !browserOAuthAvailable;
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Continue with ${provider === 'google' ? 'Google' : 'Apple'}`}
        accessibilityState={{ disabled: buttonDisabled, busy: loading === provider }}
        disabled={buttonDisabled}
        onPress={() => { if (!buttonDisabled) onPress(provider); }}
        style={({ pressed }) => [styles.button, buttonDisabled && styles.disabled, pressed && styles.pressed]}
      >
        {loading === provider ? <ActivityIndicator color="#1F1F1F" /> : <ProviderLogo provider={provider} />}
        <Text style={styles.label}>Continue with {provider === 'google' ? 'Google' : 'Apple'}</Text>
      </Pressable>
    );
  };

  return (
    <View style={styles.group}>
      {googleEnabled && providerButton('google')}
      {appleEnabled && (Platform.OS === 'ios' ? nativeAppleAvailable && (
        <View pointerEvents={disabled ? 'none' : 'auto'} style={disabled ? styles.disabled : undefined}>
          <AppleAuthentication.AppleAuthenticationButton
            buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
            buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE}
            cornerRadius={28}
            accessibilityLabel="Continue with Apple"
            accessibilityState={{ disabled, busy: loading === 'apple' }}
            onPress={() => { if (!disabled) onPress('apple'); }}
            style={styles.nativeApple}
          />
        </View>
      ) : providerButton('apple'))}
      {!browserOAuthAvailable && (googleEnabled || (appleEnabled && Platform.OS !== 'ios')) && (
        <Text style={styles.notice}>
          In Expo Go, use email and password. {googleEnabled ? 'Google' : 'Apple'} sign-in is available in the installed app.
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: space.md },
  notice: { ...type.small, color: colors.muted },
  button: {
    minHeight: 56,
    borderRadius: radius.pill,
    backgroundColor: '#FFF',
    paddingHorizontal: space.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.md,
  },
  label: { ...type.body, color: '#1F1F1F', fontWeight: '600' },
  nativeApple: { width: '100%', height: 56 },
  disabled: { opacity: 0.5 },
  pressed: { backgroundColor: '#F2F2F2' },
});
