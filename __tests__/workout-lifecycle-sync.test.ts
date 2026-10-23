import AsyncStorage from '@react-native-async-storage/async-storage';
import { workouts } from '@/lib/session/workout';
import { buildQueue } from '@/lib/session/queue';
import { planCache } from '@/lib/session/plan-cache';
import type { PlanDay } from '@/lib/types';
import * as sync from '@/lib/session/sync';

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
