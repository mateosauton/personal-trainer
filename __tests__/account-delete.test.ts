jest.mock('@/lib/db/supabase', () => ({ supabase: {
  auth: { getSession: jest.fn(), signOut: jest.fn() }, functions: { invoke: jest.fn() },
} }));
jest.mock('@/lib/session/sync', () => ({ setSyncAccount: jest.fn() }));
jest.mock('@/lib/session/storage-lock', () => ({ storageLock: (_: string, work: () => unknown) => work() }));
jest.mock('@react-native-async-storage/async-storage', () => ({ removeItem: jest.fn() }));
import { deleteAccount } from '@/lib/account-delete';
import { supabase } from '@/lib/db/supabase';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { setSyncAccount } from '@/lib/session/sync';

const session = (id = 'owner') => ({ data: { session: { user: { id }, access_token: `${id}-token` } }, error: null });
beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(supabase.auth.getSession).mockResolvedValue(session() as never);
  jest.mocked(supabase.auth.signOut).mockResolvedValue({ error: null });
  jest.mocked(supabase.functions.invoke).mockResolvedValue({ data: { deleted_account_id: 'owner' }, error: null } as never);
});

it('freezes the owner token and removes only their local records after confirmed deletion', async () => {
  await deleteAccount('owner');
  expect(supabase.functions.invoke).toHaveBeenCalledWith('delete-account', {
    headers: { Authorization: 'Bearer owner-token' }, body: { confirmation: 'DELETE', account_id: 'owner' },
  });
  expect(supabase.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  expect(AsyncStorage.removeItem).toHaveBeenCalledWith('office-gym.recovery-backups.v1.owner');
  expect(jest.mocked(AsyncStorage.removeItem).mock.calls.every(([key]) => key.endsWith('.owner') || key.endsWith('.owner.rejected'))).toBe(true);
});

it('retains recoverable local data and resumes synchronization when the backend fails', async () => {
  jest.mocked(supabase.functions.invoke).mockResolvedValue({ data: null, error: new Error('offline') } as never);
  await expect(deleteAccount('owner')).rejects.toThrow('offline');
  expect(AsyncStorage.removeItem).not.toHaveBeenCalled();
  expect(setSyncAccount).toHaveBeenLastCalledWith('owner');
});

it('never signs out the new account when a switch occurs during deletion', async () => {
  jest.mocked(supabase.auth.getSession).mockResolvedValueOnce(session() as never).mockResolvedValue(session('other') as never);
  await deleteAccount('owner');
  expect(supabase.auth.signOut).not.toHaveBeenCalled();
  expect(setSyncAccount).toHaveBeenLastCalledWith('other');
});

it('rejects a stale owner before calling the function', async () => {
  await expect(deleteAccount('foreign')).rejects.toThrow('Account changed');
  expect(supabase.functions.invoke).not.toHaveBeenCalled();
});

it('cleans recovery data even when local sign-out fails after confirmed server deletion', async () => {
  jest.mocked(supabase.auth.signOut).mockResolvedValue({ error: new Error('storage denied') } as never);
  await expect(deleteAccount('owner')).rejects.toThrow('account was deleted');
  expect(AsyncStorage.removeItem).toHaveBeenCalledWith('office-gym.set-journal.v1.owner');
  expect(AsyncStorage.removeItem).toHaveBeenCalledWith('office-gym.recovery-backups.v1.owner');
  expect(setSyncAccount).toHaveBeenLastCalledWith(null);
});

it('still removes owner recovery data if auth storage becomes unreadable after server deletion', async () => {
  jest.mocked(supabase.auth.getSession).mockResolvedValueOnce(session() as never)
    .mockRejectedValue(new Error('storage denied'));
  await expect(deleteAccount('owner')).rejects.toThrow('account was deleted');
  expect(AsyncStorage.removeItem).toHaveBeenCalledWith('office-gym.set-journal.v1.owner');
  expect(setSyncAccount).toHaveBeenLastCalledWith(null);
});
