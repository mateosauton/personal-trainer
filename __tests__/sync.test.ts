import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/lib/db/supabase';
import {
  flushOutbox,
  pendingSyncCount,
  queueCompletion,
  queueSet,
  setSyncAccount,
} from '@/lib/session/sync';

const mockLogSet = jest.fn();
const mockLegacy = jest.fn();
jest.mock(
  'expo-crypto',
  () => ({ randomUUID: () => '99999999-1111-4111-8111-999999999999' }),
  { virtual: true },
);
const mockFinishSession = jest.fn();
const mockGetSession = jest.fn();
const mockBoundClient = jest.fn((token: string) => ({ token }));
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
}));
jest.mock('@react-native-community/netinfo', () => ({
  addEventListener: jest.fn(() => jest.fn()),
}));
jest.mock('@/lib/db/supabase', () => ({
  supabase: {
    auth: { getSession: (...args: unknown[]) => mockGetSession(...args) },
  },
  clientForAccessToken: (token: string) => mockBoundClient(token),
}));
jest.mock('@/lib/db/queries', () => ({
  logSetVersioned: (...args: unknown[]) => mockLogSet(...args),
  checkLegacySet: (...args: unknown[]) => mockLegacy(...args),
  finishSession: (...args: unknown[]) => mockFinishSession(...args),
  upsertProgress: jest.fn(),
}));
const set = {
  plan_item_id: '00000015-1111-4111-8111-000000000015',
  exercise_id: 'press',
  set_index: 1,
  reps: 8,
  weight_kg: 60,
  is_bodyweight: false,
  added_load_kg: 0,
  rpe: null,
};
const values = new Map<string, string>();
const signedIn = (userId: string) =>
  mockGetSession.mockResolvedValue({
    data: {
      session: { user: { id: userId }, access_token: `token-${userId}` },
    },
    error: null,
  });

beforeEach(async () => {
  setSyncAccount(null);
  await flushOutbox();
  values.clear();
  jest.clearAllMocks();
  jest.mocked(AsyncStorage.getItem).mockReset();
  jest.mocked(AsyncStorage.setItem).mockReset();
  mockLogSet.mockReset();
  mockLegacy.mockReset();
  mockGetSession.mockReset();
  jest
    .mocked(AsyncStorage.getItem)
    .mockImplementation(async (key) => values.get(key) ?? null);
  jest.mocked(AsyncStorage.setItem).mockImplementation(async (key, value) => {
    values.set(key, value);
  });
  mockLogSet.mockResolvedValue({ status: 'applied', serverVersion: 1 });
  mockLegacy.mockResolvedValue({ status: 'duplicate', serverVersion: 1 });
  mockFinishSession.mockResolvedValue(undefined);
});

it('preserves A pending writes across sign-out and never replays them as B', async () => {
  signedIn('00000001-1111-4111-8111-000000000001');
  setSyncAccount('00000001-1111-4111-8111-000000000001');
  mockLogSet.mockRejectedValue(new Error('offline'));
  await queueSet(
    '00000001-1111-4111-8111-000000000001',
    '00000008-1111-4111-8111-000000000008',
    set,
  );
  await flushOutbox();
  expect(await pendingSyncCount()).toBe(1);
  setSyncAccount(null);
  signedIn('00000002-1111-4111-8111-000000000002');
  setSyncAccount('00000002-1111-4111-8111-000000000002');
  await queueCompletion(
    '00000002-1111-4111-8111-000000000002',
    '00000009-1111-4111-8111-000000000009',
    120,
  );
  await flushOutbox();
  expect(await pendingSyncCount()).toBe(0);
  expect(mockFinishSession).toHaveBeenCalledWith(
    '00000009-1111-4111-8111-000000000009',
    { duration_s: 120, rpe: null },
    { token: 'token-00000002-1111-4111-8111-000000000002' },
    expect.any(AbortSignal),
  );
  expect(
    mockLogSet.mock.calls.every(
      (call) => call[1].token === 'token-00000001-1111-4111-8111-000000000001',
    ),
  ).toBe(true);
  signedIn('00000001-1111-4111-8111-000000000001');
  setSyncAccount('00000001-1111-4111-8111-000000000001');
  mockLogSet.mockResolvedValue({ status: 'applied', serverVersion: 1 });
  mockLegacy.mockResolvedValue({ status: 'duplicate', serverVersion: 1 });
  await flushOutbox();
  expect(await pendingSyncCount()).toBe(0);
  expect(mockLogSet).toHaveBeenLastCalledWith(
    expect.objectContaining({
      sessionId: '00000008-1111-4111-8111-000000000008',
      set,
      revision: 1,
    }),
    { token: 'token-00000001-1111-4111-8111-000000000001' },
    expect.any(AbortSignal),
  );
});

it('rejects a stale A screen enqueue after account B takes over', async () => {
  signedIn('00000002-1111-4111-8111-000000000002');
  setSyncAccount('00000002-1111-4111-8111-000000000002');
  await expect(
    queueSet(
      '00000001-1111-4111-8111-000000000001',
      '00000008-1111-4111-8111-000000000008',
      set,
    ),
  ).rejects.toThrow(/account/i);
  expect(mockLogSet).not.toHaveBeenCalled();
});

it('leaves legacy writes untouched and never assigns them to the next account', async () => {
  const legacy = JSON.stringify([
    {
      id: 'old',
      kind: 'complete',
      payload: { sessionId: 'old-session', durationS: 90 },
    },
  ]);
  values.set('office-gym.session-outbox.v1', legacy);
  signedIn('00000002-1111-4111-8111-000000000002');
  setSyncAccount('00000002-1111-4111-8111-000000000002');
  await flushOutbox();
  expect(values.get('office-gym.session-outbox.v1')).toBe(legacy);
  expect(mockFinishSession).not.toHaveBeenCalled();
});

it('does not send if the account switches while the auth lookup is pending', async () => {
  let release!: (value: unknown) => void;
  mockGetSession.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  setSyncAccount('00000001-1111-4111-8111-000000000001');
  await queueSet(
    '00000001-1111-4111-8111-000000000001',
    '00000008-1111-4111-8111-000000000008',
    set,
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  setSyncAccount(null);
  signedIn('00000002-1111-4111-8111-000000000002');
  setSyncAccount('00000002-1111-4111-8111-000000000002');
  release({
    data: {
      session: {
        user: { id: '00000001-1111-4111-8111-000000000001' },
        access_token: 'token-00000001-1111-4111-8111-000000000001',
      },
    },
    error: null,
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(mockLogSet).not.toHaveBeenCalled();
  expect(
    values.get(
      'office-gym.session-outbox.v2.00000001-1111-4111-8111-000000000001',
    ),
  ).toContain('00000008-1111-4111-8111-000000000008');
});

it('does not start a write after its auth lookup times out', async () => {
  jest.useFakeTimers();
  try {
    let release!: (value: unknown) => void;
    mockGetSession.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    setSyncAccount('00000003-1111-4111-8111-000000000003');
    await queueSet(
      '00000003-1111-4111-8111-000000000003',
      '00000010-1111-4111-8111-000000000010',
      set,
    );
    const flushing = flushOutbox();
    while (mockGetSession.mock.calls.length === 0) await Promise.resolve();
    await jest.advanceTimersByTimeAsync(15000);
    await flushing;
    expect(await pendingSyncCount()).toBe(1);
    release({
      data: {
        session: {
          user: { id: '00000003-1111-4111-8111-000000000003' },
          access_token: 'token-00000003-1111-4111-8111-000000000003',
        },
      },
      error: null,
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(mockLogSet).not.toHaveBeenCalled();
    signedIn('00000003-1111-4111-8111-000000000003');
    await flushOutbox();
    expect(mockLogSet).toHaveBeenCalledTimes(1);
    expect(await pendingSyncCount()).toBe(0);
  } finally {
    jest.useRealTimers();
  }
});

it('archives legacy progress without replay and continues with completion', async () => {
  const progress = {
    id: 'progress-D',
    kind: 'progress',
    payload: {
      userId: '00000004-1111-4111-8111-000000000004',
      rows: [{ exercise_id: 'press', miss_streak: 2 }],
    },
  };
  values.set(
    'office-gym.session-outbox.v2.00000004-1111-4111-8111-000000000004',
    JSON.stringify([
      progress,
      {
        id: 'complete-D',
        kind: 'complete',
        payload: {
          sessionId: '00000011-1111-4111-8111-000000000011',
          durationS: 60,
        },
      },
    ]),
  );
  signedIn('00000004-1111-4111-8111-000000000004');
  setSyncAccount('00000004-1111-4111-8111-000000000004');
  await flushOutbox();
  expect(
    JSON.parse(
      values.get(
        'office-gym.legacy-progress.v1.00000004-1111-4111-8111-000000000004',
      )!,
    ),
  ).toEqual([progress]);
  expect(mockFinishSession).toHaveBeenCalledTimes(1);
  expect(await pendingSyncCount()).toBe(0);
});

it('retains legacy progress if its archive cannot be saved', async () => {
  values.set(
    'office-gym.session-outbox.v2.00000005-1111-4111-8111-000000000005',
    JSON.stringify([
      {
        id: 'progress-E',
        kind: 'progress',
        payload: { userId: '00000005-1111-4111-8111-000000000005', rows: [] },
      },
    ]),
  );
  values.set(
    'office-gym.legacy-progress.v1.00000005-1111-4111-8111-000000000005',
    '{broken',
  );
  signedIn('00000005-1111-4111-8111-000000000005');
  setSyncAccount('00000005-1111-4111-8111-000000000005');
  await flushOutbox();
  expect(await pendingSyncCount()).toBe(1);
  expect(
    values.get(
      'office-gym.legacy-progress.v1.00000005-1111-4111-8111-000000000005',
    ),
  ).toBe('{broken');
  expect(mockFinishSession).not.toHaveBeenCalled();
});

it('quarantines validation failures by account without blocking other workouts', async () => {
  const {
    getSyncStatus,
    failedSyncCount,
    retrySync,
  } = require('@/lib/session/sync');
  signedIn('00000006-1111-4111-8111-000000000006');
  setSyncAccount('00000006-1111-4111-8111-000000000006');
  mockLogSet.mockRejectedValueOnce({ code: '23503' });
  await queueSet(
    '00000006-1111-4111-8111-000000000006',
    '00000013-1111-4111-8111-000000000013',
    set,
  );
  await flushOutbox();
  await queueCompletion(
    '00000006-1111-4111-8111-000000000006',
    '00000014-1111-4111-8111-000000000014',
    90,
  );
  await flushOutbox();
  expect(await getSyncStatus('00000006-1111-4111-8111-000000000006')).toEqual({
    ownerId: '00000006-1111-4111-8111-000000000006',
    pending: 0,
    rejected: 1,
  });
  expect(await failedSyncCount('00000013-1111-4111-8111-000000000013')).toBe(1);
  expect(await failedSyncCount('00000014-1111-4111-8111-000000000014')).toBe(0);
  expect(mockFinishSession).toHaveBeenCalledWith(
    '00000014-1111-4111-8111-000000000014',
    expect.anything(),
    expect.anything(),
    expect.anything(),
  );
  signedIn('00000007-1111-4111-8111-000000000007');
  setSyncAccount('00000007-1111-4111-8111-000000000007');
  expect(await getSyncStatus('00000007-1111-4111-8111-000000000007')).toEqual({
    ownerId: '00000007-1111-4111-8111-000000000007',
    pending: 0,
    rejected: 0,
  });
  await expect(
    retrySync('00000006-1111-4111-8111-000000000006'),
  ).rejects.toThrow(/account/i);
  signedIn('00000006-1111-4111-8111-000000000006');
  setSyncAccount('00000006-1111-4111-8111-000000000006');
  await retrySync('00000006-1111-4111-8111-000000000006');
  expect(await failedSyncCount('00000013-1111-4111-8111-000000000013')).toBe(0);
});

it('sends a stable persisted revision and reconstructs a failed queue enqueue', async () => {
  const owner = '77777777-1111-4111-8111-777777777777',
    session = '88888888-1111-4111-8111-888888888888';
  signedIn(owner);
  setSyncAccount(owner);
  jest
    .mocked(AsyncStorage.setItem)
    .mockImplementationOnce(async (key, value) => {
      values.set(key, value);
    });
  jest.mocked(AsyncStorage.setItem).mockImplementationOnce(async () => {
    throw new Error('queue full');
  });
  await expect(queueSet(owner, session, set)).rejects.toThrow('queue full');
  expect(mockLogSet).not.toHaveBeenCalled();
  await flushOutbox();
  expect(mockLogSet).toHaveBeenCalledWith(
    expect.objectContaining({
      sessionId: session,
      set,
      revision: 1,
      expectedVersion: 0,
      eventAt: expect.any(String),
    }),
    expect.anything(),
    expect.any(AbortSignal),
  );
  expect(await pendingSyncCount()).toBe(0);
});
it('keeps conflicting writes recoverable and does not silently retry them', async () => {
  const owner = '66666666-1111-4111-8111-666666666666',
    session = '55555555-1111-4111-8111-555555555555';
  signedIn(owner);
  setSyncAccount(owner);
  mockLogSet.mockRejectedValue({ code: 'PT409' });
  await queueSet(owner, session, set);
  await flushOutbox();
  const { failedSyncCount, retrySync } = require('@/lib/session/sync');
  expect(await failedSyncCount(session)).toBe(1);
  mockLogSet.mockClear();
  await retrySync(owner);
  expect(mockLogSet).not.toHaveBeenCalled();
  expect(await failedSyncCount(session)).toBe(1);
});
it('compares legacy sets without fabricating a new write revision', async () => {
  const owner = '44444444-1111-4111-8111-444444444444',
    session = '33333333-1111-4111-8111-333333333333';
  values.set(
    `office-gym.session-outbox.v2.${owner}`,
    JSON.stringify([
      {
        id: `set:${session}:${set.plan_item_id}:1`,
        kind: 'set',
        payload: { sessionId: session, set },
      },
    ]),
  );
  signedIn(owner);
  setSyncAccount(owner);
  await flushOutbox();
  expect(mockLegacy).toHaveBeenCalledWith(
    session,
    set,
    expect.anything(),
    expect.any(AbortSignal),
  );
  expect(mockLogSet).not.toHaveBeenCalled();
  expect(await pendingSyncCount()).toBe(0);
});
it('preserves a conflicting legacy set and continues to another workout', async () => {
  const owner = '12121212-1111-4111-8111-121212121212',
    session = '13131313-1111-4111-8111-131313131313';
  values.set(
    `office-gym.session-outbox.v2.${owner}`,
    JSON.stringify([
      {
        id: `set:${session}:${set.plan_item_id}:1`,
        kind: 'set',
        payload: { sessionId: session, set },
      },
      {
        id: 'complete-other',
        kind: 'complete',
        payload: { sessionId: 'other-session', durationS: 60 },
      },
    ]),
  );
  signedIn(owner);
  setSyncAccount(owner);
  mockLegacy.mockResolvedValue({ status: 'conflict', serverVersion: 2 });
  await flushOutbox();
  const { failedSyncCount } = require('@/lib/session/sync');
  expect(await failedSyncCount(session)).toBe(1);
  expect(mockFinishSession).toHaveBeenCalledTimes(1);
  expect(mockLogSet).not.toHaveBeenCalled();
});
it('retries the exact version after an ambiguous network failure', async () => {
  const owner = '14141414-1111-4111-8111-141414141414',
    session = '15151515-1111-4111-8111-151515151515';
  signedIn(owner);
  setSyncAccount(owner);
  mockLogSet.mockRejectedValue(new Error('offline'));
  await queueSet(owner, session, set);
  await flushOutbox();
  const original = mockLogSet.mock.calls[0][0];
  mockLogSet.mockResolvedValue({ status: 'duplicate', serverVersion: 1 });
  await flushOutbox();
  expect(
    mockLogSet.mock.calls.every(
      ([write]) => JSON.stringify(write) === JSON.stringify(original),
    ),
  ).toBe(true);
  expect(await pendingSyncCount()).toBe(0);
});
