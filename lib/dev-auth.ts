import { supabase } from './db/supabase';

/**
 * A shortcut into the app for testing, not an auth bypass: it signs in a real
 * Supabase account with credentials from the environment, so the session, the
 * JWT and every RLS policy behave exactly as they do for anyone else. Faking a
 * session client-side would produce a user that no query can serve.
 *
 * Three things must line up for the button to exist: a dev build (or an
 * explicit opt-in flag), both credentials present, and the address on the
 * whitelist below. Leave EXPO_PUBLIC_ALLOW_DEV_LOGIN unset in production
 * builds — anything EXPO_PUBLIC_* is baked into the shipped bundle.
 */
const WHITELIST = ['sautonmateo@gmail.com'];

const email = (process.env.EXPO_PUBLIC_DEV_LOGIN_EMAIL ?? '').trim();
const password = process.env.EXPO_PUBLIC_DEV_LOGIN_PASSWORD ?? '';

const buildAllows =
  (typeof __DEV__ !== 'undefined' && __DEV__) ||
  process.env.EXPO_PUBLIC_ALLOW_DEV_LOGIN === '1';

export const devLoginEmail = email;

export const devLoginEnabled =
  buildAllows && email.length > 0 && password.length > 0 && WHITELIST.includes(email.toLowerCase());

export async function devSignIn(): Promise<void> {
  if (!devLoginEnabled) throw new Error('Dev sign-in is not available in this build.');
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
}
