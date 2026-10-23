import AsyncStorage from '@react-native-async-storage/async-storage';
import { workouts } from '@/lib/session/workout';
import { buildQueue } from '@/lib/session/queue';
import { planCache } from '@/lib/session/plan-cache';
import type { PlanDay } from '@/lib/types';
import * as sync from '@/lib/session/sync';
import { readRecoveryData } from '@/lib/session/recovery-data';
import { supabase } from '@/lib/db/supabase';

const owner = '00000001-1111-4111-8111-000000000001';
const day: PlanDay = { id: '00000002-1111-4111-8111-000000000002', day_index: 0, name: 'Push', focus: 'Push', blocks: [
  { id: '00000003-1111-4111-8111-000000000003', block_index: 0, kind: 'straight', title: 'Work', rounds: 1, rest_seconds: 60, items: [
    { id: '00000004-1111-4111-8111-000000000004', item_index: 0, exercise_id: 'Barbell_Bench_Press_-_Medium_Grip', sets: 1, reps_low: 6, reps_high: 8, seconds: null, tempo: null, notes: null },
  ] },
] };
const values = new Map<string, string>();
const mockStart = jest.fn();
const mockLog = jest.fn();
const mockFinish = jest.fn();
const mockApply = jest.fn();
const mockReceipt = jest.fn();
const mockSnapshot = jest.fn();
const mockProgress = jest.fn();
let mockOwner: string | null = owner;
let mockSequence = 0;
jest.mock('expo-crypto', () => ({ randomUUID: () => `${String(++mockSequence).padStart(8, '0')}-1111-4111-8111-999999999999` }));
jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn() }));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('@/lib/db/supabase', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: mockOwner ? { user: { id: mockOwner }, access_token: `token-${mockOwner}` } : null }, error: null }) } },
  clientForAccessToken: (token: string) => ({ token }),
}));
jest.mock('@/lib/db/workout-lifecycle', () => ({ startSessionOnce: (...args: unknown[]) => mockStart(...args) }));
jest.mock('@/lib/db/queries', () => ({
  logSetVersioned: (...args: unknown[]) => mockLog(...args),
  finishSession: (...args: unknown[]) => mockFinish(...args),
  getSessionProgressResult: (...args: unknown[]) => mockReceipt(...args),
  getSessionSetSnapshot: (...args: unknown[]) => mockSnapshot(...args),
  getProgress: (...args: unknown[]) => mockProgress(...args),
  applySessionProgress: (...args: unknown[]) => mockApply(...args),
}));

beforeEach(async () => {
  sync.setSyncAccount(null);
  values.clear(); jest.clearAllMocks(); mockOwner = owner;
  jest.mocked(AsyncStorage.getItem).mockImplementation(async key => values.get(key) ?? null);
  jest.mocked(AsyncStorage.setItem).mockImplementation(async (key, value) => { values.set(key, value); });
  mockStart.mockImplementation(async input => input.sessionId);
  mockLog.mockResolvedValue({ status: 'applied', serverVersion: 1 });
  mockFinish.mockResolvedValue(undefined);
  mockReceipt.mockResolvedValue(null);
  mockProgress.mockResolvedValue(new Map());
  mockSnapshot.mockResolvedValue({ logs: [], versions: [] });
  mockApply.mockImplementation(async (_id, _expected, _updates, lines) => lines);
  sync.setSyncAccount(owner);
});
afterEach(() => sync.setSyncAccount(null));

const begin = () => sync.startWorkout(owner, day, { units: 'kg', bodyweightKg: 80, progress: [] });

it('saves one workout identity before sending its start, even while offline', async () => {
  mockStart.mockImplementation(async () => { expect(await workouts.read(owner)).not.toBeNull(); throw new Error('offline'); });
  const first = await begin(); await sync.flushOutbox();
  const resumed = await begin();
  expect(resumed.sessionId).toBe(first.sessionId);
  expect((await workouts.read(owner))?.sessionId).toBe(first.sessionId);
  expect(await sync.pendingSyncCount(first.sessionId)).toBeGreaterThan(0);
});

it('does not contact the backend when local persistence fails', async () => {
  jest.mocked(AsyncStorage.setItem).mockRejectedValueOnce(new Error('disk full'));
  await expect(begin()).rejects.toThrow('disk full');
  expect(mockStart).not.toHaveBeenCalled();
});

it('reconstructs a lost start queue and delivers the parent before sets', async () => {
  mockStart.mockRejectedValue(new Error('offline'));
  const saved = await begin(); await sync.flushOutbox();
  values.delete(`office-gym.session-outbox.v2.${owner}`);
  const order: string[] = [];
  mockStart.mockImplementation(async input => { order.push('start'); return input.sessionId; });
  mockLog.mockImplementation(async () => { order.push('set'); return { status: 'applied', serverVersion: 1 }; });
  await sync.queueSet(owner, saved.sessionId, { plan_item_id: day.blocks[0].items[0].id, exercise_id: day.blocks[0].items[0].exercise_id,
    set_index: 1, reps: 8, weight_kg: 60, is_bodyweight: false, added_load_kg: 0, rpe: null });
  await sync.flushOutbox();
  expect(order).toEqual(['start', 'set']);
});

it('finalizes an ended workout after restart without opening a summary screen', async () => {
  const saved = await begin(); await sync.flushOutbox();
  await workouts.update(owner, saved.sessionId, { cursor: 0, phase: 'work' }, { cursor: buildQueue(day).length, endedAtMs: saved.startedAtMs + 60_000 });
  values.delete(`office-gym.session-outbox.v2.${owner}`);
  await sync.flushOutbox();
  expect(mockFinish).toHaveBeenCalled();
  expect(mockApply).toHaveBeenCalledTimes(1);
  expect(mockApply.mock.calls[0][5]).toEqual({ token: `token-${owner}` });
  expect(await workouts.read(owner)).toBeNull();
  expect(await sync.getLocalSessionReceipt(owner, saved.sessionId)).toMatchObject({ lines: [], units: 'kg' });
});

it('keeps the ended workout until a lost finalization response is recovered', async () => {
  const saved = await begin(); await sync.flushOutbox();
  await workouts.update(owner, saved.sessionId, { cursor: 0, phase: 'work' }, { cursor: buildQueue(day).length, endedAtMs: saved.startedAtMs + 60_000 });
  mockApply.mockRejectedValueOnce(new Error('response lost'));
  await sync.flushOutbox();
  expect(await workouts.read(owner)).not.toBeNull();
  mockReceipt.mockResolvedValue([]);
  await sync.flushOutbox();
  expect(await workouts.read(owner)).toBeNull();
  expect(mockApply).toHaveBeenCalledTimes(1);
});

it('does not finalize or clear A after switching to B during finalization', async () => {
  const saved = await begin(); await sync.flushOutbox();
  await workouts.update(owner, saved.sessionId, { cursor: 0, phase: 'work' }, { cursor: buildQueue(day).length, endedAtMs: saved.startedAtMs + 60_000 });
  mockReceipt.mockImplementationOnce(async () => { mockOwner = 'other'; sync.setSyncAccount('other'); return []; });
  await sync.flushOutbox();
  expect(await workouts.read(owner)).not.toBeNull();
  expect(mockApply).not.toHaveBeenCalled();
});

it('preserves the active duration when finalization is reconstructed after a pause', async () => {
  const saved = await begin(); await sync.flushOutbox();
  await workouts.update(owner, saved.sessionId, { cursor: 0, phase: 'work' }, {
    cursor: buildQueue(day).length, endedAtMs: saved.startedAtMs + 120_000,
    timing: { plannedSeconds: 60, session: { endAt: saved.startedAtMs + 120_000, pausedAt: null }, block: null, blockId: 'finished' },
  });
  await sync.flushOutbox();
  expect(mockFinish.mock.calls[0][1].duration_s).toBe(60);
});

it('does not discard a newer local snapshot after the finalization request completes', async () => {
  const saved = await begin(); await sync.flushOutbox();
  await workouts.update(owner, saved.sessionId, { cursor: 0, phase: 'work' }, { cursor: buildQueue(day).length, endedAtMs: saved.startedAtMs + 60_000 });
  mockApply.mockImplementationOnce(async (_id, _expected, _updates, lines) => {
    const latest = (await workouts.read(owner))!;
    await workouts.update(owner, saved.sessionId, { cursor: latest.cursor, phase: latest.phase }, { progress: [{ exercise_id: 'newer', last_weight_kg: null,
      last_reps: null, best_weight_kg: null, best_e1rm: null, miss_streak: 0 }] });
    return lines;
  });
  await sync.flushOutbox();
  expect((await workouts.read(owner))?.progress[0].exercise_id).toBe('newer');
});

it('uses newly confirmed progression for the next offline workout', async () => {
  const exerciseId = day.blocks[0].items[0].exercise_id;
  const previous = { exercise_id: exerciseId, last_weight_kg: 60, last_reps: 8,
    best_weight_kg: 60, best_e1rm: 80, miss_streak: 0 };
  const confirmed = { ...previous, last_weight_kg: 62.5 };
  await planCache.write(owner, { id: 'plan', name: 'Plan', split: 'Full', weeks: 4, days: [day] }, [previous], day.id);
  mockProgress.mockResolvedValue(new Map([[exerciseId, previous]]));
  const saved = await begin(); await sync.flushOutbox();
  await workouts.update(owner, saved.sessionId, { cursor: 0, phase: 'work' }, { cursor: buildQueue(day).length, endedAtMs: saved.startedAtMs + 60_000 });
  mockApply.mockImplementationOnce(async (_id, _expected, _updates, lines) => {
    mockProgress.mockResolvedValue(new Map([[exerciseId, confirmed]])); return lines;
  });
  await sync.flushOutbox();
  const cached = (await planCache.read(owner))!;
  expect(cached.progress).toEqual([confirmed]);
  mockStart.mockRejectedValue(new Error('offline'));
  const next = await sync.startWorkout(owner, cached.plan.days[0], { units: 'kg', bodyweightKg: 80, progress: cached.progress });
  expect(next.progress[0].last_weight_kg).toBe(62.5);
  await sync.flushOutbox();
});

it('captures the home timezone and original calculation context for restart replay', async () => {
  const saved = await sync.startWorkout(owner, day, {
    units: 'lb', bodyweightKg: 80, progress: [], homeTimezone: 'Pacific/Kiritimati',
  });
  await sync.flushOutbox();
  expect(saved.start?.tz).toBe('Pacific/Kiritimati');
  expect(saved.calculationContextKnown).toBe(true);
  expect(mockStart).toHaveBeenCalledWith(expect.objectContaining({
    tz: saved.start?.tz, localDay: saved.start?.localDay,
    context: { units: 'lb', bodyweightKg: 80 },
    expectedItems: [{ id: day.blocks[0].items[0].id, exercise_id: day.blocks[0].items[0].exercise_id }],
  }), expect.anything(), expect.any(AbortSignal));
});

it('stops replaying a rejected start until the user reviews its frozen snapshot', async () => {
  mockStart.mockRejectedValue({ code: 'PT409', message: 'This plan changed.' });
  await begin();
  await sync.flushOutbox();
  const attempts = mockStart.mock.calls.length;
  await sync.flushOutbox();
  expect(mockStart).toHaveBeenCalledTimes(attempts);
});

const savedSet = () => ({ plan_item_id: day.blocks[0].items[0].id,
  exercise_id: day.blocks[0].items[0].exercise_id, set_index: 1, reps: 8,
  weight_kg: 60, is_bodyweight: false, added_load_kg: 0, rpe: null });
const rejectedStart = async () => {
  mockStart.mockRejectedValue({ code: 'PT409', message: 'This plan changed.' });
  const saved = await begin(); await sync.flushOutbox();
  return saved;
};

it('archives the full rejected workout before freeing its slot and leaves all raw captures exportable', async () => {
  const saved = await rejectedStart();
  await sync.queueSet(owner, saved.sessionId, savedSet());
  await sync.flushOutbox();
  const withSets = await workouts.update(owner, saved.sessionId, { cursor: 0, phase: 'work' }, {
    draft: { reps: 8, weight: 60, asBodyweight: false }, recordedSets: [['saved', savedSet()]],
  });
  const [review] = await sync.getRejectedStarts(owner);
  const journalKey = `office-gym.set-journal.v1.${owner}`;
  const queueKey = `office-gym.session-outbox.v2.${owner}`;
  const originalJournal = values.get(journalKey), originalQueue = values.get(queueKey);
  await sync.archiveRejectedWorkout(owner, review);
  await sync.flushOutbox();
  expect(await workouts.read(owner)).toBeNull();
  const exported = await readRecoveryData(AsyncStorage, owner);
  const records = JSON.parse(exported.records[`office-gym.archived-workouts.v1.${owner}`]!);
  expect(records[0].workout).toEqual(withSets);
  expect(records[0].records[`office-gym.active-workout.v1.${owner}`]).toBe(JSON.stringify(withSets));
  expect(records[0].records[journalKey]).toBe(originalJournal);
  expect(values.get(journalKey)).toBe(originalJournal);
  expect(values.get(queueKey)).toBe(originalQueue);
  expect(await sync.getSyncStatus(owner)).toMatchObject({ pending: 0, rejected: 0, archived: 1 });
  await expect(sync.queueSet(owner, saved.sessionId, savedSet())).rejects.toThrow('archived');
  mockStart.mockImplementation(async input => input.sessionId);
  const next = await begin(); await sync.flushOutbox();
  expect(next.sessionId).not.toBe(saved.sessionId);
  expect(mockLog).not.toHaveBeenCalled();
});

it('keeps the active workout and review when its recovery archive cannot be persisted', async () => {
  const saved = await rejectedStart();
  const [review] = await sync.getRejectedStarts(owner);
  jest.mocked(AsyncStorage.setItem).mockImplementation(async (key, value) => {
    if (key === `office-gym.archived-workouts.v1.${owner}`) throw new Error('disk full');
    values.set(key, value);
  });
  await expect(sync.archiveRejectedWorkout(owner, review)).rejects.toThrow('disk full');
  expect(await workouts.read(owner)).toEqual(saved);
  expect(await sync.getRejectedStarts(owner)).toEqual([review]);
  expect((await begin()).sessionId).toBe(saved.sessionId);
  await sync.flushOutbox();
});

it('keeps a failed-clear archive review available and avoids nesting prior archives on retry', async () => {
  const saved = await rejectedStart();
  const [review] = await sync.getRejectedStarts(owner);
  let fail = true;
  jest.mocked(AsyncStorage.setItem).mockImplementation(async (key, value) => {
    if (key === `office-gym.active-workout.v1.${owner}` && value === 'null' && fail) throw new Error('clear failed');
    values.set(key, value);
  });
  await expect(sync.archiveRejectedWorkout(owner, review)).rejects.toThrow('clear failed');
  expect(await sync.getRejectedStarts(owner)).toEqual([review]);
  expect(await sync.getSyncStatus(owner)).toMatchObject({ rejected: 1, archived: 1 });
  expect(await sync.failedSyncCount('unrelated-session')).toBe(0);
  expect((await begin()).sessionId).toBe(saved.sessionId);
  await sync.flushOutbox();
  fail = false;
  await sync.archiveRejectedWorkout(owner, review); await sync.flushOutbox();
  expect(await workouts.read(owner)).toBeNull();
  const key = `office-gym.archived-workouts.v1.${owner}`;
  const archives = JSON.parse(values.get(key)!);
  expect(archives).toHaveLength(2);
  expect(archives.every((row: { records: Record<string, unknown> }) => !(key in row.records))).toBe(true);
});

it('requires a new review if the local workout changes after its archive is written', async () => {
  const saved = await rejectedStart();
  const [review] = await sync.getRejectedStarts(owner);
  const originalClear = workouts.clear.bind(workouts);
  const clearing = jest.spyOn(workouts, 'clear').mockImplementationOnce(async (user, session, expected) => {
    await workouts.update(user, session, { cursor: 0, phase: 'work' }, { draft: { reps: 9, weight: 65, asBodyweight: false } });
    return originalClear(user, session, expected);
  });
  try {
    await expect(sync.archiveRejectedWorkout(owner, review)).rejects.toThrow('changed');
    expect((await workouts.read(owner))?.draft?.weight).toBe(65);
    const [latest] = await sync.getRejectedStarts(owner);
    expect(latest.workout.draft?.weight).toBe(65);
    await expect(sync.archiveRejectedWorkout(owner, review)).rejects.toThrow('changed');
    expect((await begin()).sessionId).toBe(saved.sessionId);
    await sync.archiveRejectedWorkout(owner, latest); await sync.flushOutbox();
    expect(await workouts.read(owner)).toBeNull();
    const archives = JSON.parse(values.get(`office-gym.archived-workouts.v1.${owner}`)!);
    expect(archives[archives.length - 1].workout.draft.weight).toBe(65);
  } finally { clearing.mockRestore(); }
});

it('rejects an old account-generation archive choice without changing saved data', async () => {
  const saved = await rejectedStart();
  const [review] = await sync.getRejectedStarts(owner);
  sync.setSyncAccount('other-account'); sync.setSyncAccount(owner);
  await expect(sync.archiveRejectedWorkout(owner, review)).rejects.toThrow('account changed');
  expect(await workouts.read(owner)).toEqual(saved);
  expect(values.has(`office-gym.archived-workouts.v1.${owner}`)).toBe(false);
});

it('does not send a captured set after its parent is explicitly archived during auth lookup', async () => {
  const saved = await rejectedStart();
  let entered!: () => void;
  const reading = new Promise<void>(resolve => { entered = resolve; });
  let release!: (value: Awaited<ReturnType<typeof supabase.auth.getSession>>) => void;
  const auth = jest.spyOn(supabase.auth, 'getSession').mockImplementationOnce(() => {
    entered(); return new Promise(resolve => { release = resolve; });
  });
  try {
    await sync.queueSet(owner, saved.sessionId, savedSet());
    await reading;
    const [review] = await sync.getRejectedStarts(owner);
    await sync.archiveRejectedWorkout(owner, review);
    release({ data: { session: { user: { id: owner }, access_token: `token-${owner}` } }, error: null } as Awaited<ReturnType<typeof supabase.auth.getSession>>);
    await sync.flushOutbox();
    expect(mockLog).not.toHaveBeenCalled();
    expect(await sync.getSyncStatus(owner)).toMatchObject({ pending: 0, rejected: 0, archived: 1 });
  } finally { auth.mockRestore(); }
});
