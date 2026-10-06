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
const mockServerState = jest.fn();
let mockUUIDSequence = 0;
jest.mock(
  'expo-crypto',
  () => ({ randomUUID: () => `${String(++mockUUIDSequence).padStart(8, '0')}-1111-4111-8111-999999999999` }),
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
  getSetWriteState: (...args: unknown[]) => mockServerState(...args),
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
  mockServerState.mockReset();
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

const conflictOwner = 'abababab-1111-4111-8111-abababababab';
const conflictSession = 'cdcdcdcd-1111-4111-8111-cdcdcdcdcdcd';
async function conflict(code = 'PT409') {
  signedIn(conflictOwner); setSyncAccount(conflictOwner);
  mockLogSet.mockRejectedValue({ code });
  await queueSet(conflictOwner, conflictSession, set); await flushOutbox();
  const api = require('@/lib/session/sync');
  const [blocked] = await api.getSetConflicts(conflictOwner);
  return { api, blocked };
}
const serverSet = () => ({ serverVersion: 4, set: { ...set, reps: 12 }, eventAt: '2026-10-06T11:00:00Z' });
it.each(['saved', 'server'])('fences the explicit %s choice and retains the rejected copy', async choice => {
  const { api, blocked } = await conflict();
  mockServerState.mockResolvedValue(serverSet());
  const review = await api.reviewSetConflict(conflictOwner, blocked.write);
  expect(mockServerState).toHaveBeenCalledWith(conflictSession, set.plan_item_id, 1,
    { token: `token-${conflictOwner}` }, expect.any(AbortSignal));
  mockLogSet.mockResolvedValue({ status: 'applied', serverVersion: 5 });
  await api.resolveSetConflict(conflictOwner, review, choice); await flushOutbox();
  const chosen = mockLogSet.mock.calls.at(-1)[0];
  expect(chosen).toMatchObject({ expectedVersion: 4, revision: 2,
    set: choice === 'saved' ? set : serverSet().set,
    eventAt: choice === 'saved' ? blocked.write.eventAt : serverSet().eventAt });
  expect(chosen.origin).not.toBe(blocked.write.origin);
  expect(await api.getSyncStatus(conflictOwner)).toMatchObject({ pending: 0, rejected: 0 });
  expect(JSON.parse(values.get(`office-gym.set-journal.v1.${conflictOwner}`)!).recovery).toContainEqual(blocked);
  expect(JSON.parse(values.get(`office-gym.set-journal.v1.${conflictOwner}`)!).comparisons).toContainEqual({
    saved: blocked.write, server: serverSet(), choice,
  });
});
it('rejects a reviewed choice after the local set changes', async () => {
  const { api, blocked } = await conflict(); mockServerState.mockResolvedValue(serverSet());
  const review = await api.reviewSetConflict(conflictOwner, blocked.write);
  await queueSet(conflictOwner, conflictSession, { ...set, reps: 10 }); await flushOutbox();
  await expect(api.resolveSetConflict(conflictOwner, review, 'saved')).rejects.toThrow(/changed/);
});
it('hides a conflict if the account switches during the read', async () => {
  const { api, blocked } = await conflict(); let release!: (value: unknown) => void;
  mockServerState.mockImplementation(() => new Promise(done => { release = done; }));
  const read = api.reviewSetConflict(conflictOwner, blocked.write);
  while (!release) await Promise.resolve(); setSyncAccount(null); release(serverSet());
  await expect(read).rejects.toThrow(/account/);
});
it('rejects stale local state when a server read finishes', async () => {
  const { api, blocked } = await conflict(); let release!: (value: unknown) => void;
  mockServerState.mockImplementation(() => new Promise(done => { release = done; }));
  const read = api.reviewSetConflict(conflictOwner, blocked.write);
  while (!release) await Promise.resolve();
  await queueSet(conflictOwner, conflictSession, { ...set, reps: 11 }); await flushOutbox();
  release(serverSet()); await expect(read).rejects.toThrow(/changed/);
});
it('keeps a changed remote baseline blocked without silently fetching a new one', async () => {
  const { api, blocked } = await conflict(); mockServerState.mockResolvedValue(serverSet());
  const review = await api.reviewSetConflict(conflictOwner, blocked.write);
  await api.resolveSetConflict(conflictOwner, review, 'saved'); await flushOutbox();
  expect(mockServerState).toHaveBeenCalledTimes(1);
  const [next] = await api.getSetConflicts(conflictOwner);
  expect(next.write).toMatchObject({ expectedVersion: 4, revision: 2 });
});
it('never offers a write choice for a finalized workout', async () => {
  const { api, blocked } = await conflict('PT410'); mockServerState.mockResolvedValue(serverSet());
  const review = await api.reviewSetConflict(conflictOwner, blocked.write); mockLogSet.mockClear();
  await expect(api.resolveSetConflict(conflictOwner, review, 'saved')).rejects.toThrow(/finalized/);
  expect(mockLogSet).not.toHaveBeenCalled();
});
it('expires a stalled conflict read and preserves its saved write', async () => {
  const { api, blocked } = await conflict(); jest.useFakeTimers();
  try {
    mockServerState.mockImplementation(() => new Promise(() => {}));
    const assertion = expect(api.reviewSetConflict(conflictOwner, blocked.write)).rejects.toThrow(/timed out/);
    await jest.advanceTimersByTimeAsync(15000); await assertion;
    expect(await api.getSetConflicts(conflictOwner)).toEqual([blocked]);
  } finally { jest.useRealTimers(); }
});

it('invalidates a review across sign-out and return to the same account', async () => {
  const { api, blocked } = await conflict(); mockServerState.mockResolvedValue(serverSet());
  const review = await api.reviewSetConflict(conflictOwner, blocked.write);
  setSyncAccount(null); setSyncAccount(conflictOwner); mockLogSet.mockClear();
  await expect(api.resolveSetConflict(conflictOwner, review, 'saved')).rejects.toThrow(/account/);
  expect(mockLogSet).not.toHaveBeenCalled();
});
it('checks the account again inside the journal lock before persisting a choice', async () => {
  const { api, blocked } = await conflict(); mockServerState.mockResolvedValue(serverSet());
  const review = await api.reviewSetConflict(conflictOwner, blocked.write);
  const key = `office-gym.set-journal.v1.${conflictOwner}`; const original = values.get(key); let reads = 0;
  jest.mocked(AsyncStorage.getItem).mockImplementation(async k => {
    if (k === key && ++reads === 2) setSyncAccount(null);
    return values.get(k) ?? null;
  });
  await expect(api.resolveSetConflict(conflictOwner, review, 'saved')).rejects.toThrow(/account/);
  expect(values.get(key)).toBe(original);
});

const pausedWorkout = () => ({ version: 1 as const, ownerId: conflictOwner, sessionId: conflictSession,
  units: 'kg' as const, cursor: 0, phase: 'resting' as const,
  draft: { reps: 10, weight: 60, asBodyweight: false }, savedDraft: { reps: 8, weight: 60, asBodyweight: false },
  startedAtMs: 1000, endedAtMs: null, restUntilMs: 100000, progress: [],
  day: { id: 'day', day_index: 0, name: 'Day', focus: 'Strength', blocks: [{ id: 'block', block_index: 0,
    kind: 'straight' as const, title: 'Work', rounds: 1, rest_seconds: 90, items: [{ id: set.plan_item_id,
      item_index: 0, exercise_id: 'press', sets: 2, reps_low: 6, reps_high: 8, seconds: null, tempo: null, notes: null }] }] } });
it('reconciles a paused rest draft and prevents its warm screen from reversing the server choice', async () => {
  const { workouts } = require('@/lib/session/workout'); await workouts.create(pausedWorkout());
  const warm = await workouts.read(conflictOwner);
  const { api, blocked } = await conflict(); mockServerState.mockResolvedValue(serverSet());
  const review = await api.reviewSetConflict(conflictOwner, blocked.write);
  mockLogSet.mockResolvedValue({ status: 'applied', serverVersion: 5 });
  await api.resolveSetConflict(conflictOwner, review, 'server'); await flushOutbox();
  const restored = await workouts.read(conflictOwner);
  expect(restored).toMatchObject({ draft: { reps: 12, weight: 60 }, savedDraft: { reps: 12, weight: 60 },
    progress: [expect.objectContaining({ exercise_id: 'press', last_reps: 12, last_weight_kg: 60 })] });
  expect(restored.recoveryCopies[0]).toMatchObject({ draft: warm.draft, savedDraft: warm.savedDraft });
  await expect(workouts.update(conflictOwner, conflictSession, { cursor: 0, phase: 'resting', snapshot: warm },
    { draft: warm.draft })).rejects.toThrow(/changed/);
});
it('invalidates a comparison if the paused draft changes before choosing', async () => {
  const { workouts } = require('@/lib/session/workout'); await workouts.create(pausedWorkout());
  const { api, blocked } = await conflict(); mockServerState.mockResolvedValue(serverSet());
  const review = await api.reviewSetConflict(conflictOwner, blocked.write);
  await workouts.update(conflictOwner, conflictSession, { cursor: 0, phase: 'resting' },
    { draft: { reps: 11, weight: 60, asBodyweight: false } });
  mockLogSet.mockClear();
  await expect(api.resolveSetConflict(conflictOwner, review, 'server')).rejects.toThrow(/changed/);
  expect(mockLogSet).not.toHaveBeenCalled();
});

it('does not mark a reviewed draft saved when a queued correction invalidates its journal capture', async () => {
  const { workouts } = require('@/lib/session/workout'); await workouts.create(pausedWorkout());
  const { api, blocked } = await conflict(); mockServerState.mockResolvedValue(serverSet());
  const review = await api.reviewSetConflict(conflictOwner, blocked.write);
  const key = `office-gym.active-workout.v1.${conflictOwner}`; const original = values.get(key);
  const journalKey = `office-gym.set-journal.v1.${conflictOwner}`;
  const journal = JSON.parse(values.get(journalKey)!); let changed = false;
  jest.mocked(AsyncStorage.getItem).mockImplementation(async k => {
    if (k === key && !changed) {
      changed = true; journal.entries[0].write.revision++; journal.entries[0].write.set.reps = 10;
      journal.entries[0].status = 'pending'; delete journal.entries[0].code;
      values.set(journalKey, JSON.stringify(journal));
    }
    return values.get(k) ?? null;
  });
  await expect(api.resolveSetConflict(conflictOwner, review, 'server')).rejects.toThrow(/changed/);
  expect(values.get(key)).toBe(original);
});

async function legacyConflict() {
  signedIn(conflictOwner); setSyncAccount(conflictOwner);
  const operation = { id: `set:${conflictSession}:${set.plan_item_id}:1`, kind: 'set', payload: { sessionId: conflictSession, set } };
  values.set(`office-gym.session-outbox.v2.${conflictOwner}`, JSON.stringify([operation]));
  mockLegacy.mockResolvedValue({ status: 'conflict', serverVersion: 4 });
  await flushOutbox();
  const api = require('@/lib/session/sync');
  const [capture] = await api.getLegacySetConflicts(conflictOwner);
  return { api, capture, operation };
}
it('converts the explicit legacy server choice with its displayed version and real server time', async () => {
  const { api, capture, operation } = await legacyConflict(); mockServerState.mockResolvedValue(serverSet());
  const review = await api.reviewLegacySetConflict(conflictOwner, capture);
  mockLogSet.mockResolvedValue({ status: 'applied', serverVersion: 5 });
  await api.resolveLegacySetConflict(conflictOwner, review, 'server'); await flushOutbox();
  expect(mockLogSet).toHaveBeenCalledWith(expect.objectContaining({ set: serverSet().set,
    expectedVersion: 4, eventAt: serverSet().eventAt, revision: 1 }), expect.anything(), expect.any(AbortSignal));
  expect(await api.getSyncStatus(conflictOwner)).toMatchObject({ pending: 0, rejected: 0 });
  const archive = JSON.parse(values.get(`office-gym.session-outbox.v2.${conflictOwner}.rejected`)!);
  expect(archive[0]).toEqual({ operation, code: 'PT409', resolved: true });
  const journal = JSON.parse(values.get(`office-gym.set-journal.v1.${conflictOwner}`)!);
  expect(journal.legacyComparisons[0].saved.set).toEqual(set);
  expect(journal.legacyComparisons[0].saved).not.toHaveProperty('eventAt');
});
it('does not invent a legacy completion time when choosing saved values', async () => {
  const { api, capture } = await legacyConflict(); mockServerState.mockResolvedValue(null);
  const review = await api.reviewLegacySetConflict(conflictOwner, capture);
  await expect(api.resolveLegacySetConflict(conflictOwner, review, 'saved')).rejects.toThrow(/completion time/);
  expect(values.has(`office-gym.set-journal.v1.${conflictOwner}`)).toBe(false);
  expect(mockLogSet).not.toHaveBeenCalled();
});
it('uses the explicitly confirmed legacy completion time instead of today', async () => {
  const { api, capture } = await legacyConflict(); mockServerState.mockResolvedValue(null);
  const review = await api.reviewLegacySetConflict(conflictOwner, capture);
  const originalTime = '2026-09-01T10:30:00.000Z';
  await api.resolveLegacySetConflict(conflictOwner, review, 'saved', originalTime); await flushOutbox();
  expect(mockLogSet).toHaveBeenCalledWith(expect.objectContaining({ set, expectedVersion: 0, eventAt: originalTime }), expect.anything(), expect.any(AbortSignal));
});
it.each(['2026', '2026-02-31T10:30:00Z', '2026-09-01T10:30:00', 'invalid'])('preserves a legacy edit if the confirmed time is invalid: %s', async time => {
  const { api, capture } = await legacyConflict(); mockServerState.mockResolvedValue(null);
  const review = await api.reviewLegacySetConflict(conflictOwner, capture);
  await expect(api.resolveLegacySetConflict(conflictOwner, review, 'saved', time)).rejects.toThrow(/completion time/);
  expect(mockLogSet).not.toHaveBeenCalled();
});
it('rejects a stale legacy comparison when a newer journal correction exists', async () => {
  const { api, capture } = await legacyConflict(); mockServerState.mockResolvedValue(serverSet());
  const review = await api.reviewLegacySetConflict(conflictOwner, capture);
  mockLogSet.mockRejectedValue({ code: 'PT409' });
  await queueSet(conflictOwner, conflictSession, { ...set, reps: 10 }); await flushOutbox();
  await expect(api.resolveLegacySetConflict(conflictOwner, review, 'server')).rejects.toThrow(/changed/);
});
it('keeps an interrupted legacy publication reconstructable with its exact time and comparison', async () => {
  const { api, capture } = await legacyConflict(); mockServerState.mockResolvedValue(serverSet());
  const review = await api.reviewLegacySetConflict(conflictOwner, capture);
  const queueKey = `office-gym.session-outbox.v2.${conflictOwner}`;
  jest.mocked(AsyncStorage.setItem).mockImplementation(async (key, value) => {
    if (key === queueKey) throw new Error('queue full'); values.set(key, value);
  });
  await expect(api.resolveLegacySetConflict(conflictOwner, review, 'server')).rejects.toThrow('queue full');
  expect(await api.getSyncStatus(conflictOwner)).toMatchObject({ pending: 1, rejected: 1 });
  jest.mocked(AsyncStorage.setItem).mockImplementation(async (key, value) => { values.set(key, value); });
  await flushOutbox();
  expect(mockLogSet).toHaveBeenCalledWith(expect.objectContaining({ eventAt: serverSet().eventAt, revision: 1, expectedVersion: 4 }), expect.anything(), expect.any(AbortSignal));
  expect(await api.getSyncStatus(conflictOwner)).toMatchObject({ pending: 0, rejected: 0 });
});
it('does not expose an older set review after the account switches during its server read', async () => {
  const { api, capture } = await legacyConflict(); let release!: (value: unknown) => void;
  mockServerState.mockImplementation(() => new Promise(done => { release = done; }));
  const pending = api.reviewLegacySetConflict(conflictOwner, capture);
  while (!release) await Promise.resolve(); setSyncAccount(null); release(serverSet());
  await expect(pending).rejects.toThrow(/account/);
});
it('expires an older set review without replacing its saved archive', async () => {
  const { api, capture } = await legacyConflict(); jest.useFakeTimers();
  try {
    mockServerState.mockImplementation(() => new Promise(() => {}));
    const assertion = expect(api.reviewLegacySetConflict(conflictOwner, capture)).rejects.toThrow(/timed out/);
    await jest.advanceTimersByTimeAsync(15000); await assertion;
    expect(await api.getLegacySetConflicts(conflictOwner)).toEqual([capture]);
  } finally { jest.useRealTimers(); }
});
it('invalidates an older set choice across sign-out and return to the same account', async () => {
  const { api, capture } = await legacyConflict(); mockServerState.mockResolvedValue(serverSet());
  const review = await api.reviewLegacySetConflict(conflictOwner, capture);
  setSyncAccount(null); setSyncAccount(conflictOwner);
  await expect(api.resolveLegacySetConflict(conflictOwner, review, 'server')).rejects.toThrow(/account/);
  expect(mockLogSet).not.toHaveBeenCalled();
});
