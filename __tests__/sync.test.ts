import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/lib/db/supabase';
import { flushOutbox, pendingSyncCount, queueCompletion, queueSet, setSyncAccount } from '@/lib/session/sync';

const mockLogSet = jest.fn();
const mockFinishSession = jest.fn();
const mockGetSession = jest.fn();
const mockBoundClient = jest.fn((token: string) => ({ token }));
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(), setItem: jest.fn(),
}));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('@/lib/db/supabase', () => ({
  supabase: { auth: { getSession: (...args: unknown[]) => mockGetSession(...args) } },
  clientForAccessToken: (token: string) => mockBoundClient(token),
}));
jest.mock('@/lib/db/queries', () => ({
  logSet: (...args: unknown[]) => mockLogSet(...args),
  finishSession: (...args: unknown[]) => mockFinishSession(...args), upsertProgress: jest.fn(),
}));
const set = { plan_item_id: 'item-1', exercise_id: 'press', set_index: 1, reps: 8,
  weight_kg: 60, is_bodyweight: false, added_load_kg: 0, rpe: null };
const values = new Map<string, string>();
const signedIn = (userId: string) => mockGetSession.mockResolvedValue({ data: { session: { user: { id: userId }, access_token: `token-${userId}` } }, error: null });

beforeEach(async () => {
  setSyncAccount(null);
  await flushOutbox();
  values.clear(); jest.clearAllMocks();
  jest.mocked(AsyncStorage.getItem).mockImplementation(async (key) => values.get(key) ?? null);
  jest.mocked(AsyncStorage.setItem).mockImplementation(async (key, value) => { values.set(key, value); });
  mockLogSet.mockResolvedValue(undefined); mockFinishSession.mockResolvedValue(undefined);
});

it('preserves A pending writes across sign-out and never replays them as B', async () => {
  signedIn('A'); setSyncAccount('A'); mockLogSet.mockRejectedValue(new Error('offline'));
  await queueSet('A', 'session-A', set); await flushOutbox();
  expect(await pendingSyncCount()).toBe(1);
  setSyncAccount(null); signedIn('B'); setSyncAccount('B');
  await queueCompletion('B', 'session-B', 120); await flushOutbox();
  expect(await pendingSyncCount()).toBe(0);
  expect(mockFinishSession).toHaveBeenCalledWith('session-B', { duration_s: 120, rpe: null }, { token: 'token-B' }, expect.any(AbortSignal));
  expect(mockLogSet.mock.calls.every((call) => call[2].token === 'token-A')).toBe(true);
  signedIn('A'); setSyncAccount('A'); mockLogSet.mockResolvedValue(undefined);
  await flushOutbox(); expect(await pendingSyncCount()).toBe(0);
  expect(mockLogSet).toHaveBeenLastCalledWith('session-A', set, { token: 'token-A' }, expect.any(AbortSignal));
});

it('rejects a stale A screen enqueue after account B takes over', async () => {
  signedIn('B'); setSyncAccount('B');
  await expect(queueSet('A', 'session-A', set)).rejects.toThrow(/account/i);
  expect(mockLogSet).not.toHaveBeenCalled();
});

it('leaves legacy writes untouched and never assigns them to the next account', async () => {
  const legacy = JSON.stringify([{ id: 'old', kind: 'complete', payload: { sessionId: 'old-session', durationS: 90 } }]);
  values.set('office-gym.session-outbox.v1', legacy);
  signedIn('B'); setSyncAccount('B'); await flushOutbox();
  expect(values.get('office-gym.session-outbox.v1')).toBe(legacy);
  expect(mockFinishSession).not.toHaveBeenCalled();
});

it('does not send if the account switches while the auth lookup is pending', async () => {
  let release!: (value: unknown) => void;
  mockGetSession.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
  setSyncAccount('A');
  await queueSet('A', 'session-A', set);
  await new Promise((resolve) => setTimeout(resolve, 0));
  setSyncAccount(null); signedIn('B'); setSyncAccount('B');
  release({ data: { session: { user: { id: 'A' }, access_token: 'token-A' } }, error: null });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(mockLogSet).not.toHaveBeenCalled();
  expect(values.get('office-gym.session-outbox.v2.A')).toContain('session-A');
});


it('does not start a write after its auth lookup times out', async () => {
  jest.useFakeTimers();
  try {
    let release!: (value: unknown) => void;
    mockGetSession.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    setSyncAccount('C');
    await queueSet('C', 'session-C', set);
    const flushing = flushOutbox();
    while (mockGetSession.mock.calls.length === 0) await Promise.resolve();
    await jest.advanceTimersByTimeAsync(15000);
    await flushing;
    expect(await pendingSyncCount()).toBe(1);
    release({ data: { session: { user: { id: 'C' }, access_token: 'token-C' } }, error: null });
    await Promise.resolve(); await Promise.resolve();
    expect(mockLogSet).not.toHaveBeenCalled();
    signedIn('C');
    await flushOutbox();
    expect(mockLogSet).toHaveBeenCalledTimes(1);
    expect(await pendingSyncCount()).toBe(0);
  } finally { jest.useRealTimers(); }
});


it('archives legacy progress without replay and continues with completion', async () => {
  const progress = { id: 'progress-D', kind: 'progress', payload: { userId: 'D', rows: [{ exercise_id: 'press', miss_streak: 2 }] } };
  values.set('office-gym.session-outbox.v2.D', JSON.stringify([progress, {
    id: 'complete-D', kind: 'complete', payload: { sessionId: 'session-D', durationS: 60 },
  }]));
  signedIn('D'); setSyncAccount('D');
  await flushOutbox();
  expect(JSON.parse(values.get('office-gym.legacy-progress.v1.D')!)).toEqual([progress]);
  expect(mockFinishSession).toHaveBeenCalledTimes(1);
  expect(await pendingSyncCount()).toBe(0);
});

it('retains legacy progress if its archive cannot be saved', async () => {
  values.set('office-gym.session-outbox.v2.E', JSON.stringify([{
    id: 'progress-E', kind: 'progress', payload: { userId: 'E', rows: [] },
  }]));
  values.set('office-gym.legacy-progress.v1.E','{broken');
  signedIn('E'); setSyncAccount('E');
  await flushOutbox();
  expect(await pendingSyncCount()).toBe(1);
  expect(values.get('office-gym.legacy-progress.v1.E')).toBe('{broken');
  expect(mockFinishSession).not.toHaveBeenCalled();
});

it('quarantines validation failures by account without blocking other workouts', async () => {
  const { getSyncStatus, failedSyncCount, retrySync } = require('@/lib/session/sync');
  signedIn('F'); setSyncAccount('F');
  mockLogSet.mockRejectedValueOnce({ code: '23503' });
  await queueSet('F', 'rejected-session', set); await flushOutbox();
  await queueCompletion('F', 'healthy-session', 90); await flushOutbox();
  expect(await getSyncStatus('F')).toEqual({ ownerId: 'F', pending: 0, rejected: 1 });
  expect(await failedSyncCount('rejected-session')).toBe(1);
  expect(await failedSyncCount('healthy-session')).toBe(0);
  expect(mockFinishSession).toHaveBeenCalledWith('healthy-session', expect.anything(), expect.anything(), expect.anything());
  signedIn('G'); setSyncAccount('G');
  expect(await getSyncStatus('G')).toEqual({ ownerId: 'G', pending: 0, rejected: 0 });
  await expect(retrySync('F')).rejects.toThrow(/account/i);
  signedIn('F'); setSyncAccount('F'); await retrySync('F');
  expect(await failedSyncCount('rejected-session')).toBe(0);
});
