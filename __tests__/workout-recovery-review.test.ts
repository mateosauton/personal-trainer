import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, type AppStateStatus } from 'react-native';
import type { PlanDay } from '@/lib/types';
import * as sync from '@/lib/session/sync';

const owner = '00000001-1111-4111-8111-000000000001';
const day: PlanDay = { id: '00000002-1111-4111-8111-000000000002', day_index: 0, name: 'Push', focus: 'Push', blocks: [
  { id: '00000003-1111-4111-8111-000000000003', block_index: 0, kind: 'straight', title: 'Work', rounds: 1, rest_seconds: 60, items: [
    { id: '00000004-1111-4111-8111-000000000004', item_index: 0, exercise_id: 'Barbell_Bench_Press_-_Medium_Grip',
      sets: 1, reps_low: 6, reps_high: 8, seconds: null, tempo: null, notes: null },
  ] },
] };
const values = new Map<string, string>();
const mockStart = jest.fn(), mockFinish = jest.fn();
let mockSequence = 0;
jest.mock('expo-crypto', () => ({ randomUUID: () => `${String(++mockSequence).padStart(8, '0')}-1111-4111-8111-999999999999` }));
jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn() }));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('@/lib/db/supabase', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { user: { id: owner }, access_token: `token-${owner}` } }, error: null }) } },
  clientForAccessToken: (token: string) => ({ token }),
}));
jest.mock('@/lib/db/workout-lifecycle', () => ({ startSessionOnce: (...args: unknown[]) => mockStart(...args) }));
jest.mock('@/lib/db/queries', () => ({
  finishSession: (...args: unknown[]) => mockFinish(...args),
}));
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
};
beforeEach(() => {
  sync.setSyncAccount(null);
  values.clear(); jest.clearAllMocks();
  jest.mocked(AsyncStorage.getItem).mockImplementation(async key => values.get(key) ?? null);
  jest.mocked(AsyncStorage.setItem).mockImplementation(async (key, value) => { values.set(key, value); });
  mockStart.mockImplementation(async input => input.sessionId);
  mockFinish.mockResolvedValue(undefined);
  sync.setSyncAccount(owner);
});
afterEach(() => sync.setSyncAccount(null));

it('schedules a newly saved start while an older empty flush is reconstructing', async () => {
  const entered = deferred<void>(), release = deferred<void>();
  let pause = true;
  jest.mocked(AsyncStorage.getItem).mockImplementation(async key => {
    if (key === `office-gym.set-journal.v1.${owner}` && pause) {
      pause = false; entered.resolve(); await release.promise;
    }
    return values.get(key) ?? null;
  });
  const flushing = sync.flushOutbox();
  await entered.promise;
  const saved = await sync.startWorkout(owner, day, { units: 'kg', bodyweightKg: 80, progress: [] });
  release.resolve();
  await flushing;
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(mockStart).toHaveBeenCalledWith(expect.objectContaining({ sessionId: saved.sessionId }),
    { token: `token-${owner}` }, expect.any(AbortSignal));
});

it('rejects a stale completion after an account leaves and returns during its snapshot read', async () => {
  const entered = deferred<void>(), release = deferred<void>();
  let pause = true;
  jest.mocked(AsyncStorage.getItem).mockImplementation(async key => {
    if (key === `office-gym.active-workout.v1.${owner}` && pause) {
      pause = false; entered.resolve(); await release.promise;
    }
    return values.get(key) ?? null;
  });
  const completing = sync.queueCompletion(owner, '00000008-1111-4111-8111-000000000008', 60);
  await entered.promise;
  sync.setSyncAccount('another-account');
  sync.setSyncAccount(owner);
  release.resolve();
  await expect(completing).rejects.toThrow(/account/i);
  expect(mockFinish).not.toHaveBeenCalled();
});

it('does not let a stale app listener replace the active account retry scheduler', async () => {
  const listeners: ((state: AppStateStatus) => void)[] = [];
  const subscription = jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
    listeners.push(listener); return { remove: jest.fn() };
  });
  const stopOld = sync.startOutboxSync(owner);
  await sync.flushOutbox();
  sync.setSyncAccount('another-account');
  sync.setSyncAccount(owner);
  const stopCurrent = sync.startOutboxSync(owner);
  try {
    await sync.flushOutbox();
    listeners[0]('active');
    const saved = await sync.startWorkout(owner, day, { units: 'kg', bodyweightKg: 80, progress: [] });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(mockStart).toHaveBeenCalledWith(expect.objectContaining({ sessionId: saved.sessionId }),
      { token: `token-${owner}` }, expect.any(AbortSignal));
  } finally {
    stopOld(); stopCurrent(); subscription.mockRestore();
  }
});
