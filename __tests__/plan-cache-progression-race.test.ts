import AsyncStorage from '@react-native-async-storage/async-storage';
import { workouts } from '@/lib/session/workout';
import { buildQueue } from '@/lib/session/queue';
import { planCache } from '@/lib/session/plan-cache';
import type { Plan, PlanDay } from '@/lib/types';
import * as sync from '@/lib/session/sync';

const owner = '00000001-1111-4111-8111-000000000001';
const day: PlanDay = { id: '00000002-1111-4111-8111-000000000002', day_index: 0, name: 'Push', focus: 'Push', blocks: [
  { id: '00000003-1111-4111-8111-000000000003', block_index: 0, kind: 'straight', title: 'Work', rounds: 1, rest_seconds: 60, items: [
    { id: '00000004-1111-4111-8111-000000000004', item_index: 0, exercise_id: 'press', sets: 1, reps_low: 6, reps_high: 8, seconds: null, tempo: null, notes: null },
  ] },
] };
const nextDay: PlanDay = { ...day, id: 'next-day', day_index: 1 };
const plan: Plan = { id: 'plan', name: 'Plan', split: 'Full', weeks: 4, days: [day, nextDay] };
const previous = { exercise_id: 'press', last_weight_kg: 60, last_reps: 8,
  best_weight_kg: 60, best_e1rm: 80, miss_streak: 0 };
const confirmed = { ...previous, last_weight_kg: 62.5 };
const newer = { ...previous, last_weight_kg: 65 };
const values = new Map<string, string>();
const mockProgress = jest.fn();
let mockSequence = 0;
jest.mock('expo-crypto', () => ({ randomUUID: () => `${String(++mockSequence).padStart(8, '0')}-1111-4111-8111-999999999999` }));
jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn() }));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('@/lib/db/supabase', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { user: { id: owner }, access_token: `token-${owner}` } }, error: null }) } },
  clientForAccessToken: (token: string) => ({ token }),
}));
jest.mock('@/lib/db/workout-lifecycle', () => ({ startSessionOnce: async (input: { sessionId: string }) => input.sessionId }));
jest.mock('@/lib/db/queries', () => ({
  finishSession: async () => undefined,
  getSessionProgressResult: async () => [],
  getProgress: (...args: unknown[]) => mockProgress(...args),
}));

beforeEach(() => {
  sync.setSyncAccount(null);
  values.clear(); jest.clearAllMocks();
  jest.mocked(AsyncStorage.getItem).mockImplementation(async key => values.get(key) ?? null);
  jest.mocked(AsyncStorage.setItem).mockImplementation(async (key, value) => { values.set(key, value); });
  sync.setSyncAccount(owner);
});
afterEach(() => sync.setSyncAccount(null));

it('keeps a newer refresh when an older post-finalization progression response arrives later', async () => {
  await planCache.write(owner, plan, [previous], day.id);
  const saved = await sync.startWorkout(owner, day, { units: 'kg', bodyweightKg: 80, progress: [previous] });
  await sync.flushOutbox();
  await workouts.update(owner, saved.sessionId, { cursor: 0, phase: 'work' }, {
    cursor: buildQueue(day).length, endedAtMs: saved.startedAtMs + 60_000,
  });
  let started!: () => void;
  const reading = new Promise<void>(resolve => { started = resolve; });
  let respond!: (rows: Map<string, typeof previous>) => void;
  mockProgress.mockImplementationOnce(() => {
    started();
    return new Promise<Map<string, typeof previous>>(resolve => { respond = resolve; });
  });
  const flushing = sync.flushOutbox();
  await reading;
  // A later dashboard request observes progression from another device and publishes it first.
  await planCache.write(owner, plan, [newer], day.id);
  respond(new Map([['press', confirmed]]));
  await flushing;
  const cached = await planCache.read(owner);
  expect(cached?.progress).toEqual([newer]);
  expect(cached?.nextDayId).toBe(nextDay.id);
});

it('publishes confirmed progression when a concurrent refresh changes only rotation and plan metadata', async () => {
  await planCache.write(owner, plan, [previous], day.id);
  const saved = await sync.startWorkout(owner, day, { units: 'kg', bodyweightKg: 80, progress: [previous] });
  await sync.flushOutbox();
  await workouts.update(owner, saved.sessionId, { cursor: 0, phase: 'work' }, {
    cursor: buildQueue(day).length, endedAtMs: saved.startedAtMs + 60_000,
  });
  let started!: () => void;
  const reading = new Promise<void>(resolve => { started = resolve; });
  let respond!: (rows: Map<string, typeof previous>) => void;
  mockProgress.mockImplementationOnce(() => {
    started();
    return new Promise<Map<string, typeof previous>>(resolve => { respond = resolve; });
  });
  const flushing = sync.flushOutbox();
  await reading;
  // This refresh read progress before finalization but learns the completed rotation later.
  await planCache.write(owner, { ...plan, name: 'Renamed plan' }, [previous], nextDay.id);
  respond(new Map([['press', confirmed]]));
  await flushing;
  const cached = await planCache.read(owner);
  expect(cached?.progress).toEqual([confirmed]);
  expect(cached?.nextDayId).toBe(nextDay.id);
  expect(cached?.plan.name).toBe('Renamed plan');
});
