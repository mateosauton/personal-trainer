import * as Linking from 'expo-linking';

import { supabase } from './db/supabase';

/** The same root callback serves email confirmation and social sign-in. */
export const authRedirectTo = () => {
  const url = Linking.createURL('/');
  return url ? new URL(url).toString() : url;
};

export const authRecoveryRedirectTo = () => Linking.createURL('/reset-password');

let completedUrl: string | null = null;
const pending = new Map<string, Promise<boolean>>();

const callbackTarget = (url: URL) => `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, '')}`;

export function isRecoveryLink(url: string): boolean {
  try {
    const parsed = new URL(url);
    const target = callbackTarget(parsed);
    if (target === callbackTarget(new URL(authRecoveryRedirectTo()))) return true;
    if (target !== callbackTarget(new URL(authRedirectTo()))) return false;
    return parsed.searchParams.get('type') === 'recovery'
      || new URLSearchParams(parsed.hash.slice(1)).get('type') === 'recovery';
  } catch {
    return false;
  }
}

function clearBrowserCallback(url: string) {
  if (typeof window === 'undefined' || window.location?.href !== url) return;
  const clean = new URL(url);
  for (const key of ['code', 'error', 'error_code', 'error_description']) clean.searchParams.delete(key);
  clean.hash = '';
  window.history.replaceState(window.history.state, '', clean.toString());
}

/** Coalesces callbacks from the auth browser and Expo Linking. Errors reach the UI. */
export async function completeAuthFromUrl(url: string): Promise<boolean> {
  let parsed: URL;
  try {
    parsed = new URL(url);
    const target = callbackTarget(parsed);
    if (target !== callbackTarget(new URL(authRedirectTo()))
      && target !== callbackTarget(new URL(authRecoveryRedirectTo()))) return false;
  } catch {
    return false;
  }
  if (url === completedUrl) return true;
  const existing = pending.get(url);
  if (existing) return existing;

  const operation = (async () => {
    const params = new URLSearchParams(parsed.hash.slice(1));
    parsed.searchParams.forEach((value, key) => params.set(key, value));
    const providerError = params.get('error_description') || params.get('error');
    if (providerError) throw new Error(providerError);
    const code = params.get('code');
    if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) throw error;
    } else {
      // Browser flows now require a locally stored PKCE verifier. Never adopt
      // a session supplied by an arbitrary token fragment in an incoming link.
      if (params.has('access_token') || params.has('refresh_token')) {
        throw new Error('This sign-in link uses an older format. Sign in again to continue.');
      }
      return false;
    }
    completedUrl = url;
    return true;
  })();
  pending.set(url, operation);
  try {
    return await operation;
  } finally {
    pending.delete(url);
    clearBrowserCallback(url);
  }
}
