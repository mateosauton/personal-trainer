import { LifecycleStore, type LocalSessionReceipt } from '@/lib/session/lifecycle-store';
import type { SavedWorkout } from '@/lib/session/workout-store';

const workout = (sessionId = 'session-A', ownerId = 'owner-A'): SavedWorkout => ({
  version: 1, ownerId, sessionId, units: 'kg', bodyweightKg: 80,
  day: { id: 'day', day_index: 0, name: 'Push', focus: 'Strength', blocks: [] },
  progress: [], cursor: 0, phase: 'work', draft: null, savedDraft: null,
  restUntilMs: null, startedAtMs: 1000, endedAtMs: 2000,
  start: { localDay: '2026-10-22', tz: 'America/Los_Angeles' },
});
const receipt = (): LocalSessionReceipt => ({ units: 'kg', durationS: 120, lines: [{
  exerciseId: 'press', name: 'Press', sets: 2, volumeKg: 600, topLoadKg: 60,
  verdict: 'progress', isPr: true,
}] });
const memory = () => {
  const values = new Map<string, string>();
  return { values,
    getItem: jest.fn(async (key: string) => values.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => { values.set(key, value); }),
  };
};

it('acknowledges the exact captured start identity across restart', async () => {
  const disk = memory();
  const saved = workout();
  const store = new LifecycleStore(disk);
  expect(await store.hasStarted(saved)).toBe(false);
  await store.acknowledgeStart(saved);
  expect(await new LifecycleStore(disk).hasStarted(saved)).toBe(true);
  for (const changed of [{ ...saved, startedAtMs: 1001 }, { ...saved, day: { ...saved.day, id: 'different-day' } },
    { ...saved, start: { ...saved.start!, tz: 'UTC' } }, workout('different-session')])
    expect(await store.hasStarted(changed)).toBe(false);
  const legacy = { ...saved };
  delete legacy.start;
  expect(await store.hasStarted(legacy)).toBe(true);
});

it('keeps the latest completed receipt when a different workout starts', async () => {
  const disk = memory();
  const store = new LifecycleStore(disk);
  const first = workout();
  const next = workout('session-B');
  await store.acknowledgeStart(first);
  await store.saveReceipt(first, receipt());
  await store.acknowledgeStart(next);
  const restarted = new LifecycleStore(disk);
  expect(await restarted.hasStarted(next)).toBe(true);
  expect(await restarted.hasStarted(first)).toBe(false);
  expect(await restarted.getReceipt(first.ownerId, first.sessionId)).toEqual(receipt());
  expect(await restarted.getReceipt(next.ownerId, next.sessionId)).toBeNull();
  expect(disk.values.size).toBe(1);
});

it('saving an older session receipt preserves the current start acknowledgement', async () => {
  const store = new LifecycleStore(memory());
  const next = workout('session-B');
  await store.acknowledgeStart(next);
  await store.saveReceipt(workout(), receipt());
  expect(await store.hasStarted(next)).toBe(true);
  expect(await store.getReceipt('owner-A', 'session-A')).toEqual(receipt());
});

it('serializes shared-account receipt and start updates across store instances', async () => {
  const disk = memory();
  const first = new LifecycleStore(disk), second = new LifecycleStore(disk);
  const saved = workout(), next = workout('session-B');
  await first.acknowledgeStart(saved);
  await Promise.all([first.saveReceipt(saved, receipt()), second.acknowledgeStart(next)]);
  expect(await first.hasStarted(next)).toBe(true);
  expect(await first.getReceipt(saved.ownerId, saved.sessionId)).toEqual(receipt());
});

it('keeps account keys independent', async () => {
  const disk = memory();
  const store = new LifecycleStore(disk);
  await store.saveReceipt(workout(), receipt());
  expect(await store.getReceipt('owner-B', 'session-A')).toBeNull();
  await store.acknowledgeStart(workout('session-B', 'owner-B'));
  expect(await store.getReceipt('owner-A', 'session-A')).toEqual(receipt());
  expect(disk.values.size).toBe(2);
});

it('reads older receipt records and retains their original session when a new session starts', async () => {
  const disk = memory();
  const store = new LifecycleStore(disk);
  const saved = workout();
  await store.saveReceipt(saved, receipt());
  const [key, raw] = [...disk.values][0];
  const state = JSON.parse(raw);
  delete state.receipt.sessionId;
  disk.values.set(key, JSON.stringify(state));
  expect(await store.getReceipt(saved.ownerId, saved.sessionId)).toEqual(receipt());
  await store.acknowledgeStart(workout('session-B'));
  expect(await new LifecycleStore(disk).getReceipt(saved.ownerId, saved.sessionId)).toEqual(receipt());
});

it('preserves foreign-account and unreadable data instead of overwriting it', async () => {
  const disk = memory();
  const store = new LifecycleStore(disk);
  const saved = workout();
  await store.saveReceipt(saved, receipt());
  const [key, raw] = [...disk.values][0];
  const state = JSON.parse(raw);
  for (const bad of ['{broken', 'null', '[]', JSON.stringify({ ...state, ownerId: 'owner-B' })]) {
    disk.values.set(key, bad);
    disk.setItem.mockClear();
    await expect(store.getReceipt(saved.ownerId, saved.sessionId)).rejects.toThrow('preserved');
    await expect(store.acknowledgeStart(saved)).rejects.toThrow('preserved');
    await expect(store.saveReceipt(saved, receipt())).rejects.toThrow('preserved');
    expect(disk.values.get(key)).toBe(bad);
    expect(disk.setItem).not.toHaveBeenCalled();
  }
});

it.each([
  { units: 'stone' }, { durationS: 0 }, { durationS: -1 }, { durationS: '120' }, { durationS: null },
  { lines: null }, { lines: [null] }, { lines: [{}] },
  ...[{ exerciseId: '' }, { name: '' }, { sets: -1 }, { sets: 1.5 }, { volumeKg: -1 },
    { volumeKg: '600' }, { volumeKg: null }, { topLoadKg: -1 }, { topLoadKg: '60' },
    { seconds: -1 }, { seconds: '30' }, { isPr: 'true' }, { verdict: 'increase' }]
    .map(line => ({ lines: [{ ...receipt().lines[0], ...line }] })),
])('rejects malformed persisted receipt data without replacing it: %p', async invalid => {
  const disk = memory();
  const store = new LifecycleStore(disk);
  const saved = workout();
  await store.saveReceipt(saved, receipt());
  const [key, raw] = [...disk.values][0];
  const state = JSON.parse(raw);
  const bad = JSON.stringify({ ...state, receipt: { ...state.receipt, ...invalid } });
  disk.values.set(key, bad);
  disk.setItem.mockClear();
  await expect(store.getReceipt(saved.ownerId, saved.sessionId)).rejects.toThrow('preserved');
  await expect(store.saveReceipt(saved, receipt())).rejects.toThrow('preserved');
  expect(disk.values.get(key)).toBe(bad);
  expect(disk.setItem).not.toHaveBeenCalled();
});

it('validates a receipt before replacing confirmed data', async () => {
  const disk = memory();
  const store = new LifecycleStore(disk);
  const saved = workout();
  await store.saveReceipt(saved, receipt());
  const before = new Map(disk.values);
  for (const bad of [{ ...receipt(), durationS: NaN }, { ...receipt(), durationS: Infinity },
    { ...receipt(), lines: [{ ...receipt().lines[0], volumeKg: NaN }] },
    { ...receipt(), lines: [{ ...receipt().lines[0], topLoadKg: Infinity }] }]) {
    await expect(store.saveReceipt(saved, bad)).rejects.toThrow('preserved');
    expect(disk.values).toEqual(before);
  }
  expect(await store.getReceipt(saved.ownerId, saved.sessionId)).toEqual(receipt());
});

it('keeps confirmed state after receipt or acknowledgement persistence fails', async () => {
  const disk = memory();
  const store = new LifecycleStore(disk);
  const saved = workout();
  await store.acknowledgeStart(saved);
  await store.saveReceipt(saved, receipt());
  const before = new Map(disk.values);
  disk.setItem.mockRejectedValueOnce(new Error('Disk unavailable'));
  await expect(store.acknowledgeStart(workout('session-B'))).rejects.toThrow('Disk unavailable');
  disk.setItem.mockRejectedValueOnce(new Error('Disk unavailable'));
  await expect(store.saveReceipt(saved, { ...receipt(), durationS: 300 })).rejects.toThrow('Disk unavailable');
  expect(disk.values).toEqual(before);
  const restarted = new LifecycleStore(disk);
  expect(await restarted.hasStarted(saved)).toBe(true);
  expect(await restarted.getReceipt(saved.ownerId, saved.sessionId)).toEqual(receipt());
});

it('retains explicitly unknown calculation context in a receipt after restart', async () => {
  const disk = memory();
  const saved = workout();
  const confirmed = { ...receipt(), calculationContextKnown: false };
  await new LifecycleStore(disk).saveReceipt(saved, confirmed);
  expect(await new LifecycleStore(disk).getReceipt(saved.ownerId, saved.sessionId)).toEqual(confirmed);
});
