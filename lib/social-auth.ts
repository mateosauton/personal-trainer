import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';

import { supabase } from './db/supabase';
import { authRedirectTo, completeAuthFromUrl } from './deep-link';
import { canUseBrowserOAuth } from './social-auth-availability';

export type SocialProvider = 'google' | 'apple';

/** Both providers create an account on first use and sign in returning users. */
export async function signInWithSocialProvider(provider: SocialProvider): Promise<boolean> {
  if (provider === 'apple' && Platform.OS === 'ios') {
    const nonce = Crypto.randomUUID();
    const hashedNonce = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, nonce);
    let credential: AppleAuthentication.AppleAuthenticationCredential;
    try {
      credential = await AppleAuthentication.signInAsync({
        requestedScopes: [AppleAuthentication.AppleAuthenticationScope.EMAIL],
        nonce: hashedNonce,
      });
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ERR_REQUEST_CANCELED') return false;
      throw error;
    }
    if (!credential.identityToken) throw new Error('Apple did not return an identity token. Please try again.');
    const { data, error } = await supabase.auth.signInWithIdToken({
      provider: 'apple', token: credential.identityToken, nonce,
    });
    if (error) throw error;
    if (!data.session) throw new Error('Apple sign-in did not return a session. Please try again.');
    return true;
  }

  if (!canUseBrowserOAuth()) {
    const name = provider === 'google' ? 'Google' : 'Apple';
    throw new Error(`${name} sign-in is available in the installed app. In Expo Go, use email and password.`);
  }

  const redirectTo = authRedirectTo();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo, skipBrowserRedirect: Platform.OS !== 'web' },
  });
  if (error) throw error;
  if (!data.url) throw new Error('Could not start sign-in. Please try again.');
  // On web Supabase redirects the current tab; AuthProvider handles its return.
  if (Platform.OS === 'web') return false;

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (result.type === 'cancel' || result.type === 'dismiss') return false;
  if (result.type !== 'success' || !await completeAuthFromUrl(result.url)) {
    throw new Error('Could not complete sign-in. Please try again.');
  }
  return true;
}
