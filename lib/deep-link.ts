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
export async function completeAuthFromUrl(value: string): Promise<boolean> {
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
