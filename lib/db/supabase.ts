import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import 'react-native-url-polyfill/auto';
import { ensureAuthCrypto } from './auth-crypto';

import { installAuthCrypto } from '../auth-crypto';
import { validateEnvironment } from '../../config/environment-policy.cjs';

installAuthCrypto();

// Use direct dotted EXPO_PUBLIC reads: Expo replaces these during bundling.
// The private APP_ENV marker is checked at build time in app.config.js.
const developmentRuntime = typeof __DEV__ !== 'undefined' && __DEV__;
const { url, key } = validateEnvironment({
  appEnvironment: process.env.EXPO_PUBLIC_APP_ENV,
  url: process.env.EXPO_PUBLIC_SUPABASE_URL,
  key: process.env.EXPO_PUBLIC_SUPABASE_KEY,
  purpose: 'runtime',
  allowLocal: developmentRuntime,
  allowMock: developmentRuntime,
  devLoginEmail: process.env.EXPO_PUBLIC_DEV_LOGIN_EMAIL,
  devLoginPassword: process.env.EXPO_PUBLIC_DEV_LOGIN_PASSWORD,
  allowDevLogin: process.env.EXPO_PUBLIC_ALLOW_DEV_LOGIN,
});

ensureAuthCrypto();

export const supabase = createClient(url, key, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    flowType: 'pkce',
    // React Native has no URL bar to parse a session out of.
    detectSessionInUrl: false,
  },
});

/** A write client with a fixed token, independent of shared auth state changes. */
export const clientForAccessToken = (accessToken: string) => createClient(url, key, {
  accessToken: async () => accessToken,
});
