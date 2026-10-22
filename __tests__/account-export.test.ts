import { exportAccountData } from '@/lib/account-export';
import { supabase } from '@/lib/db/supabase';
jest.mock('@/lib/db/supabase', () => ({ supabase: { rpc: jest.fn(), auth: { getSession: jest.fn() } } }));
jest.mock('@/lib/export-file', () => ({ deliverExport: jest.fn() }));
jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn().mockResolvedValue(null) }));
jest.mock('@/lib/session/storage-lock', () => ({ storageLock: (_: string, work: () => unknown) => work() }));
import { deliverExport } from '@/lib/export-file';
import AsyncStorage from '@react-native-async-storage/async-storage';
const snapshot = { format_version: 1, account_id: 'owner', profile: null,
  exported_at: '2026-10-07T18:00:00Z', plans: [], plan_days: [], plan_blocks: [], plan_items: [],
  sessions: [], session_summaries: [], set_logs: [], exercise_progress: [] };
const session = (id: string | null) => ({ data: { session: id ? { user: { id } } : null }, error: null });
beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(supabase.auth.getSession).mockResolvedValue(session('owner') as never);
  jest.mocked(supabase.rpc).mockResolvedValue({ data: snapshot, error: null } as never);
  jest.mocked(AsyncStorage.getItem).mockResolvedValue(null);
});
it('includes raw malformed local data without exporting another account or the unowned legacy queue', async () => {
  jest.mocked(AsyncStorage.getItem).mockImplementation(async key => key.endsWith('.owner') ? '{broken-json' : null);
  await exportAccountData('owner', true);
  const payload = JSON.parse(jest.mocked(deliverExport).mock.calls[0][0]);
  expect(payload.local_recovery.account_id).toBe('owner');
  expect(payload.local_recovery.records['office-gym.recovery-backups.v1.owner']).toBe('{broken-json');
  expect(Object.keys(payload.local_recovery.records).every(key => key.includes('.owner'))).toBe(true);
});
it('delivers a complete versioned JSON snapshot without passing a caller-selected owner to the RPC', async () => {
  await exportAccountData('owner');
  expect(supabase.rpc).toHaveBeenCalledWith('export_account_data');
  expect(deliverExport).toHaveBeenCalledWith(JSON.stringify(snapshot, null, 2), 'office-gym-data.json', expect.any(Function));
});
it('rejects signed-out and stale-owner requests before fetching', async () => {
  jest.mocked(supabase.auth.getSession).mockResolvedValue(session(null) as never);
  await expect(exportAccountData('owner')).rejects.toThrow('Account changed');
  expect(supabase.rpc).not.toHaveBeenCalled();
});
it('does not deliver the previous account after a switch during the request', async () => {
  jest.mocked(supabase.auth.getSession).mockResolvedValueOnce(session('owner') as never)
    .mockResolvedValueOnce(session('other') as never);
  await expect(exportAccountData('owner')).rejects.toThrow('Account changed');
  expect(deliverExport).not.toHaveBeenCalled();
});
it('propagates backend failure without producing a partial file', async () => {
  jest.mocked(supabase.rpc).mockResolvedValue({ data: null, error: new Error('offline') } as never);
  await expect(exportAccountData('owner')).rejects.toThrow('offline');
  expect(deliverExport).not.toHaveBeenCalled();
});
it.each([null, { ...snapshot, account_id: 'other' }, { ...snapshot, set_logs: null }, { ...snapshot, format_version: 2 }])(
  'rejects malformed or foreign snapshots: %p', async data => {
    jest.mocked(supabase.rpc).mockResolvedValue({ data, error: null } as never);
    await expect(exportAccountData('owner')).rejects.toThrow('Invalid account export');
    expect(deliverExport).not.toHaveBeenCalled();
  });
