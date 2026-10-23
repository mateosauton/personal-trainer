import { calculateSessionSummary, finalizeWorkout, type FinalizationDependencies } from '@/lib/session/finalize';
import { CATALOG } from '@/lib/catalog';
import type { ProgressRow, SessionSetSnapshot, SessionSummaryLine } from '@/lib/db/queries';
import type { SavedWorkout } from '@/lib/session/workout-store';
import { displayToKg } from '@/lib/units';

const exercise = CATALOG.find(row => row.pattern === 'h_push' && !row.is_bodyweight && !row.is_unilateral)!;
const owner = '11111111-1111-4111-8111-111111111111';
const session = '22222222-2222-4222-8222-222222222222';
const item = '33333333-3333-4333-8333-333333333333';
const logId = '44444444-4444-4444-8444-444444444444';
const workout = (): SavedWorkout => ({
  version: 1, ownerId: owner, sessionId: session, units: 'kg', bodyweightKg: 80,
  day: { id: 'day', day_index: 0, name: 'Push', focus: 'Strength', blocks: [{
    id: 'block', block_index: 0, kind: 'straight', title: 'Work', rounds: 1,
    rest_seconds: 60, items: [{ id: item, item_index: 0, exercise_id: exercise.id,
      sets: 1, reps_low: 6, reps_high: 10, seconds: null, tempo: null, notes: null }],
  }] },
  progress: [], cursor: 1, phase: 'work', draft: null, savedDraft: null,
  restUntilMs: null, startedAtMs: 1000, endedAtMs: 2000,
});
const snapshot = (reps = 10, weight = 60, version = 1): SessionSetSnapshot => ({
  logs: [{ id: logId, plan_item_id: item, exercise_id: exercise.id, set_index: 1,
    reps, weight_kg: weight, is_bodyweight: false, added_load_kg: 0,
    rpe: null, completed_at: '2026-10-22T10:00:00.000Z' }],
  versions: [{ logId, serverVersion: version }],
});
const progress = (overrides: Partial<ProgressRow> = {}): ProgressRow => ({
  exercise_id: exercise.id, last_weight_kg: 60, last_reps: 8,
  best_weight_kg: 65, best_e1rm: 70, miss_streak: 0, ...overrides,
});
const dependencies = (sets = snapshot()) => ({
  getReceipt: jest.fn(async (_sessionId: string, _signal?: AbortSignal): Promise<SessionSummaryLine[] | null> => null),
  getSnapshot: jest.fn(async (_sessionId: string, _signal?: AbortSignal) => sets),
  getProgress: jest.fn(async (_ownerId: string, _signal?: AbortSignal) => new Map([[exercise.id, progress()]])),
  applyProgress: jest.fn(async (_sessionId: string,
    _expected: { exercise_id: string; state: ProgressRow | null }[], _updates: ProgressRow[],
    result: SessionSummaryLine[], _versions: SessionSetSnapshot['versions'], _signal?: AbortSignal) => result),
  guard: jest.fn(() => {}),
} satisfies FinalizationDependencies);

it('reuses an existing receipt without reading or changing progression', async () => {
  const deps = dependencies();
  const receipt: SessionSummaryLine[] = [{ exerciseId: exercise.id, name: exercise.name,
    sets: 1, volumeKg: 600, topLoadKg: 60, verdict: 'progress', isPr: true }];
  deps.getReceipt.mockResolvedValue(receipt);
  await expect(finalizeWorkout(workout(), deps)).resolves.toBe(receipt);
  expect(deps.getReceipt).toHaveBeenCalledWith(session, undefined);
  expect(deps.getSnapshot).not.toHaveBeenCalled();
  expect(deps.applyProgress).not.toHaveBeenCalled();
});

it('uses the saved plan, units and bodyweight when finalizing off screen', async () => {
  const saved = workout();
  saved.units = 'lb';
  const sets = snapshot();
  sets.logs[0] = { ...sets.logs[0], weight_kg: null, is_bodyweight: true, added_load_kg: 20 };
  const deps = dependencies(sets);
  const result = await finalizeWorkout(saved, deps);
  expect(result).toEqual([{ exerciseId: exercise.id, name: exercise.name, sets: 1,
    volumeKg: 1000, topLoadKg: 100, verdict: 'progress', isPr: true }]);
  expect(deps.getProgress).toHaveBeenCalledWith(owner, undefined);
  const [sentSession, expected, updates, summary, versions] = deps.applyProgress.mock.calls[0];
  expect(sentSession).toBe(session);
  expect(expected).toEqual([{ exercise_id: exercise.id, state: progress() }]);
  expect(updates[0]).toEqual({ exercise_id: exercise.id,
    last_weight_kg: 20 + displayToKg(5, 'lb'), last_reps: 10,
    best_weight_kg: 100, best_e1rm: 100 * (1 + 10 / 30), miss_streak: 0 });
  expect(summary).toBe(result);
  expect(versions).toEqual(sets.versions);
});

it('refreshes both sets and progression before recalculating a stale receipt', async () => {
  const deps = dependencies();
  const corrected = snapshot(6, 70, 2);
  const newerProgress = progress({ best_weight_kg: 80, best_e1rm: 95 });
  deps.getSnapshot.mockResolvedValueOnce(snapshot()).mockResolvedValueOnce(corrected);
  deps.getProgress.mockResolvedValueOnce(new Map([[exercise.id, progress()]]))
    .mockResolvedValueOnce(new Map([[exercise.id, newerProgress]]));
  deps.applyProgress.mockRejectedValueOnce({ code: '40001' });
  await expect(finalizeWorkout(workout(), deps)).resolves.toEqual([{
    exerciseId: exercise.id, name: exercise.name, sets: 1, volumeKg: 420,
    topLoadKg: 70, verdict: 'hold', isPr: false,
  }]);
  expect(deps.getSnapshot).toHaveBeenCalledTimes(2);
  expect(deps.getProgress).toHaveBeenCalledTimes(2);
  const [, expected, updates, , versions] = deps.applyProgress.mock.calls[1];
  expect(expected).toEqual([{ exercise_id: exercise.id, state: newerProgress }]);
  expect(updates[0]).toMatchObject({ last_weight_kg: 70, last_reps: 6, best_weight_kg: 80, best_e1rm: 95 });
  expect(versions).toEqual(corrected.versions);
});

it('stops after three stale attempts and preserves the server error', async () => {
  const deps = dependencies();
  const stale = Object.assign(new Error('changed'), { code: '40001' });
  deps.applyProgress.mockRejectedValue(stale);
  await expect(finalizeWorkout(workout(), deps)).rejects.toBe(stale);
  expect(deps.applyProgress).toHaveBeenCalledTimes(3);
  expect(deps.getSnapshot).toHaveBeenCalledTimes(3);
  expect(deps.getProgress).toHaveBeenCalledTimes(3);
});

it('leaves a network failure for the outbox retry policy', async () => {
  const deps = dependencies();
  const offline = new Error('offline');
  deps.applyProgress.mockRejectedValue(offline);
  await expect(finalizeWorkout(workout(), deps)).rejects.toBe(offline);
  expect(deps.applyProgress).toHaveBeenCalledTimes(1);
});

it('records timed work without creating weight progression', async () => {
  const saved = workout();
  saved.day.blocks[0].items[0].seconds = 45;
  const timed = snapshot();
  timed.logs[0] = { ...timed.logs[0], reps: null, seconds: 45, weight_kg: null };
  timed.logs.push({ ...timed.logs[0], id: '55555555-5555-4555-8555-555555555555', set_index: 2 });
  timed.versions.push({ logId: timed.logs[1].id, serverVersion: 1 });
  const deps = dependencies(timed);
  await expect(finalizeWorkout(saved, deps)).resolves.toEqual([{
    exerciseId: exercise.id, name: exercise.name, sets: 2, seconds: 90,
    volumeKg: 0, topLoadKg: null, verdict: null, isPr: false,
  }]);
  expect(deps.applyProgress.mock.calls[0][1]).toEqual([]);
  expect(deps.applyProgress.mock.calls[0][2]).toEqual([]);
});

it('keeps warmup sets out of weight progression', async () => {
  const saved = workout();
  saved.day.blocks[0].kind = 'warmup';
  const deps = dependencies();
  await finalizeWorkout(saved, deps);
  expect(deps.applyProgress.mock.calls[0][1]).toEqual([]);
  expect(deps.applyProgress.mock.calls[0][2]).toEqual([]);
});

it('does not substitute current measurements for an older unknown bodyweight', async () => {
  const saved = workout();
  delete saved.bodyweightKg;
  const sets = snapshot();
  sets.logs[0] = { ...sets.logs[0], weight_kg: null, is_bodyweight: true, added_load_kg: 0 };
  const deps = dependencies(sets);
  const result = await finalizeWorkout(saved, deps);
  expect(result[0]).toMatchObject({ volumeKg: 0, topLoadKg: null, isPr: false });
});

it('does not begin an already cancelled finalization', async () => {
  const deps = dependencies();
  const controller = new AbortController();
  controller.abort();
  await expect(finalizeWorkout(workout(), deps, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  expect(deps.getReceipt).not.toHaveBeenCalled();
});

it('forwards cancellation and never applies a result after its read was cancelled', async () => {
  const deps = dependencies();
  const controller = new AbortController();
  deps.getSnapshot.mockImplementation(async () => { controller.abort(); return snapshot(); });
  await expect(finalizeWorkout(workout(), deps, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  expect(deps.getReceipt).toHaveBeenCalledWith(session, controller.signal);
  expect(deps.getSnapshot).toHaveBeenCalledWith(session, controller.signal);
  expect(deps.getProgress).toHaveBeenCalledWith(owner, controller.signal);
  expect(deps.applyProgress).not.toHaveBeenCalled();
});

it('checks account ownership again after an asynchronous read', async () => {
  const deps = dependencies();
  let switched = false;
  deps.guard.mockImplementation(() => { if (switched) throw new Error('account changed'); });
  deps.getReceipt.mockImplementation(async () => { switched = true; return null; });
  await expect(finalizeWorkout(workout(), deps)).rejects.toThrow('account changed');
  expect(deps.getSnapshot).not.toHaveBeenCalled();
  expect(deps.applyProgress).not.toHaveBeenCalled();
});

it('calculates observed offline metrics from local set copies without I/O', () => {
  const saved = workout();
  const { lines, updates } = calculateSessionSummary(saved.day, snapshot().logs,
    new Map([[exercise.id, progress()]]), saved.units, saved.bodyweightKg ?? null);
  expect(lines).toEqual([{ exerciseId: exercise.id, name: exercise.name, sets: 1,
    volumeKg: 600, topLoadKg: 60, verdict: 'progress', isPr: false }]);
  expect(updates[0]).toMatchObject({ last_weight_kg: 62.5, last_reps: 10 });
});

it('keeps empty local observations empty', () => {
  const saved = workout();
  expect(calculateSessionSummary(saved.day, [], new Map(), saved.units, null))
    .toEqual({ lines: [], updates: [] });
});

it('keeps historical calculation context unknown and never updates working loads', async () => {
  const saved = { ...workout(), calculationContextKnown: false };
  const deps = dependencies();
  const result = await finalizeWorkout(saved, deps);
  expect(result[0].verdict).toBeNull();
  expect(deps.applyProgress.mock.calls[0][1]).toEqual([]);
  expect(deps.applyProgress.mock.calls[0][2]).toEqual([]);
});
