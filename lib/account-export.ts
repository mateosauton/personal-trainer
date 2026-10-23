import { supabase } from '@/lib/db/supabase';
import { deliverExport } from '@/lib/export-file';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { readRecoveryData } from './session/recovery-data';
import { storageLock } from './session/storage-lock';

async function checkAccount(ownerId: string): Promise<void> {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (data.session?.user.id !== ownerId) throw new Error('Account changed. Please retry from your profile.');
}

export async function exportAccountData(ownerId: string, includeLocal = false): Promise<void> {
  await checkAccount(ownerId);
  const { data, error } = await supabase.rpc('export_account_data');
  if (error) throw error;
  await checkAccount(ownerId);
  const snapshot = data as Record<string, unknown> | null;
  const arrays = ['plans', 'plan_days', 'plan_blocks', 'plan_items', 'sessions', 'session_summaries', 'set_logs', 'exercise_progress'];
  if (!snapshot || snapshot.format_version !== 1 || snapshot.account_id !== ownerId ||
      typeof snapshot.exported_at !== 'string' || !Object.hasOwn(snapshot, 'profile') ||
      arrays.some(key => !Array.isArray(snapshot[key]))) {
    throw new Error('Invalid account export. Please retry.');
  }
  const result = includeLocal ? { ...snapshot,
    local_recovery: await readRecoveryData(AsyncStorage, ownerId, storageLock),
  } : snapshot;
  await checkAccount(ownerId);
  await deliverExport(JSON.stringify(result, null, 2), 'office-gym-data.json', () => checkAccount(ownerId));
}
