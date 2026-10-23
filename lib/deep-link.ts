import * as Linking from 'expo-linking';

import { supabase } from './db/supabase';

/** The same root callback serves email confirmation and social sign-in. */
export const authRedirectTo = () => {
  const url = Linking.createURL('/');
  return url ? new URL(url).toString() : url;
};

export const authRecoveryRedirectTo = () => Linking.createURL('/reset-password');

function callbackUrl(value: string): URL {
  const url = new URL(value);
  const authority = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)/i.exec(value)?.[1];
  if (authority === undefined || url.username || url.password || authority.includes('@')) {
    throw new Error('Invalid sign-in callback. Request a new email link on this device.');
  }
  return url;
}

function matchesCallback(url: URL, target: string): boolean {
  const expected = new URL(target);
  return url.protocol === expected.protocol && url.host === expected.host
    && url.pathname.replace(/\/$/, '') === expected.pathname.replace(/\/$/, '')
    && [...expected.searchParams].every(([key, value]) =>
      url.searchParams.getAll(key).length === 1 && url.searchParams.get(key) === value);
}

export function isRecoveryLink(value: string): boolean {
  try { return matchesCallback(callbackUrl(value), authRecoveryRedirectTo()); }
  catch { return false; }
}

/**
 * Turns a verification deep link into a session.
 *
 * Only a PKCE code issued for a flow started on this device may establish a
 * session. The SDK checks the locally stored verifier during code exchange.
 * Raw token pairs cannot prove that the user initiated a login here.
 *
 * Returns true when a session was established.
 */
async function exchangeAuthFromUrl(value: string): Promise<boolean> {
  const url = callbackUrl(value);
  const params = new URLSearchParams(url.hash.slice(1));
  const query = url.searchParams;
  const authParameters = ['code', 'access_token', 'refresh_token', 'error', 'error_description', 'error_code'];
  if (!authParameters.some((key) => query.has(key) || params.has(key))) return false;

  if (!matchesCallback(url, authRedirectTo()) && !matchesCallback(url, authRecoveryRedirectTo())) {
    throw new Error('Invalid sign-in callback. Request a new email link on this device.');
  }
  if (['access_token', 'refresh_token'].some((key) => query.has(key) || params.has(key))) {
    throw new Error('This sign-in link is no longer supported. Request a new email link on this device.');
  }
  const callbackError = params.get('error_description') || query.get('error_description')
    || params.get('error') || query.get('error');
  if (callbackError) throw new Error(String(callbackError));

  const code = query.get('code');
  if (!code || query.getAll('code').length !== 1 || params.has('code')) {
    throw new Error('Invalid sign-in callback. Request a new email link on this device.');
  }
  const { data, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;
  // Check before exchange: exchanging first would already replace this account.
  if (data.session) throw new Error('Sign out, then request a new email link on this device.');
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) throw error;
  return true;
}

const callbackKeys = ['code', 'access_token', 'refresh_token', 'provider_token', 'provider_refresh_token',
  'expires_in', 'expires_at', 'token_type', 'error', 'error_code', 'error_description'];

/** Remove only auth fields. Ordinary fragments and route state survive reload. */
export function cleanAuthCallbackUrl(url: string): string {
  const clean = new URL(url);
  const fragment = new URLSearchParams(clean.hash.slice(1));
  if (!callbackKeys.some(key => clean.searchParams.has(key) || fragment.has(key))) return url;
  const keys = [...callbackKeys, 'type'];
  for (const key of keys) clean.searchParams.delete(key);
  // A plain #help anchor is not a URLSearchParams object to serialize.
  if (keys.some(key => fragment.has(key))) {
    for (const key of keys) fragment.delete(key);
    clean.hash = fragment.toString();
  }
  return clean.toString();
}

function clearBrowserCallback(url: string) {
  if (typeof window === 'undefined' || window.location?.href !== url) return;
  const clean = cleanAuthCallbackUrl(url);
  if (clean !== url) window.history.replaceState(window.history.state, '', clean);
}


const pending = new Map<string, Promise<boolean>>();

/** Coalesce concurrent browser/Linking delivery without bypassing account checks. */
export async function completeAuthFromUrl(value: string): Promise<boolean> {
  const existing = pending.get(value);
  if (existing) return existing;
  const operation = exchangeAuthFromUrl(value);
  pending.set(value, operation);
  try {
    return await operation;
  } finally {
    pending.delete(value);
    clearBrowserCallback(value);
  }
}
