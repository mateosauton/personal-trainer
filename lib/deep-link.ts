import * as Linking from 'expo-linking';

import { supabase } from './db/supabase';

/**
 * Where Supabase should send the browser after it verifies an email link.
 *
 * In Expo Go this resolves to the dev server's exp:// address; in a standalone
 * build it uses the `officegym` scheme from app.json. Either way it deep-links
 * back into the app rather than stranding the user on Supabase's default Site
 * URL (http://localhost:3000), which is nothing on a phone.
 */
export const authRedirectTo = () => Linking.createURL('/');

/**
 * Turns a verification deep link into a session.
 *
 * Supabase hands the tokens back one of two ways depending on the flow: the
 * implicit flow puts access_token/refresh_token in the URL fragment, PKCE puts
 * a single `code` in the query string. React Native has no URL bar for
 * supabase-js to read (detectSessionInUrl is off), so both are parsed here.
 *
 * Returns true when a session was established.
 */
export async function completeAuthFromUrl(url: string): Promise<boolean> {
  const parsed = Linking.parse(url);

  const code = parsed.queryParams?.code;
  if (typeof code === 'string' && code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    return !error;
  }

  // expo-linking does not surface the fragment, so read it off the raw string.
  const hash = url.includes('#') ? url.slice(url.indexOf('#') + 1) : '';
  if (!hash) return false;

  const params = new URLSearchParams(hash);
  const access_token = params.get('access_token');
  const refresh_token = params.get('refresh_token');
  if (!access_token || !refresh_token) return false;

  const { error } = await supabase.auth.setSession({ access_token, refresh_token });
  return !error;
}
