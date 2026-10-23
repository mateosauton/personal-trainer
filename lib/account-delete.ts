import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './db/supabase';
import { recoveryKeys } from './session/recovery-data';
import { setSyncAccount } from './session/sync';
import { storageLock } from './session/storage-lock';

export async function deleteAccount(owner: string): Promise<void> {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  const session = data.session;
  if (session?.user.id !== owner) throw new Error('Account changed. Please retry from your profile.');
  setSyncAccount(null);
  let deleted = false;
  try {
    // Freeze the token; a concurrent sign-in cannot redirect deletion to another account.
    const result = await supabase.functions.invoke('delete-account', {
      headers: { Authorization: `Bearer ${session.access_token}` },
      body: { confirmation: 'DELETE', account_id: owner },
    });
    if (result.error) throw result.error;
    if (result.data?.deleted_account_id !== owner) throw new Error('Could not confirm deletion. Sign in again to check your account.');
    deleted = true;
    let cleanupError: unknown;
    let currentOwner: string | null = null;
    try {
      const current = await supabase.auth.getSession();
      if (current.error) throw current.error;
      currentOwner = current.data.session?.user.id ?? null;
    } catch (error) { cleanupError = error; }
    if (currentOwner === owner) {
      try {
        const result = await supabase.auth.signOut({ scope: 'local' });
        if (result.error) cleanupError = result.error;
      } catch (error) { cleanupError = error; }
    }
    for (const key of recoveryKeys(owner)) {
      try {
        await storageLock(key.endsWith('.rejected') ? key.slice(0, -'.rejected'.length) : key,
          () => AsyncStorage.removeItem(key));
      } catch (error) { cleanupError = error; }
    }
    if (cleanupError) throw new Error('Your account was deleted. This device could not finish local cleanup. Clear this app\'s local data before sharing the device.');
  } finally {
    try {
      const current = await supabase.auth.getSession();
      const currentOwner = current.error ? null : current.data.session?.user.id ?? null;
      setSyncAccount(deleted && currentOwner === owner ? null : currentOwner);
    } catch { setSyncAccount(null); }
  }
}
