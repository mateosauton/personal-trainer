jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
import { PlanCache } from '@/lib/session/plan-cache';
import type { ProgressRow } from '@/lib/db/queries';
import type { Plan } from '@/lib/types';

const plan: Plan = {
  id: 'plan', name: 'Strength', split: 'Full body', weeks: 4,
  days: [{
    id: 'day', day_index: 0, name: 'Training', focus: 'Strength',
    blocks: [{
      id: 'block', block_index: 0, kind: 'straight', title: 'Press', rounds: 1,
      rest_seconds: 90, duration_seconds: 600,
      items: [{ id: 'item', item_index: 0, exercise_id: 'press', sets: 2,
        reps_low: 6, reps_high: 8, seconds: null, tempo: null, notes: null }],
    }],
  }],
};
const progress: ProgressRow[] = [{ exercise_id: 'press', last_weight_kg: 50,
  last_reps: 8, best_weight_kg: 50, best_e1rm: 63, miss_streak: 0 }];
const memory = () => {
  const values = new Map<string, string>();
  return { values,
    getItem: jest.fn(async (key: string) => values.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => { values.set(key, value); }),
  };
};

it('restores plan prescriptions and progress after restart with independent account keys', async () => {
  const disk = memory();
  await new PlanCache(disk).write('A', plan, progress);
  const restarted = new PlanCache(disk);
  expect(await restarted.read('A')).toEqual({ plan, progress });
  expect(await restarted.read('B')).toBeNull();
  await restarted.write('B', { ...plan, id: 'plan-B' }, []);
  expect((await restarted.read('A'))?.plan.id).toBe('plan');
  expect((await restarted.read('B'))?.plan.id).toBe('plan-B');
});

it('ignores corrupt, incompatible and cross-account snapshots without deleting them', async () => {
  const disk = memory();
  const cache = new PlanCache(disk);
  await cache.write('A', plan, progress);
  const [key, valid] = [...disk.values][0];
  const snapshot = JSON.parse(valid);
  for (const raw of ['{broken', 'null', JSON.stringify({ ...snapshot, version: 2 }),
    JSON.stringify({ ...snapshot, ownerId: 'B' }),
    JSON.stringify({ ...snapshot, plan: { ...plan, days: [{ ...plan.days[0], blocks: null }] } }),
    JSON.stringify({ ...snapshot, progress: [{ ...progress[0], miss_streak: -1 }] })]) {
    disk.values.set(key, raw);
    expect(await cache.read('A')).toBeNull();
    expect(disk.values.get(key)).toBe(raw);
  }
});

it('rejects malformed prescriptions and progress before replacing an offline snapshot', async () => {
  const disk = memory();
  const cache = new PlanCache(disk);
  await cache.write('A', plan, progress);
  const before = new Map(disk.values);
  const badPlan = JSON.parse(JSON.stringify(plan));
  badPlan.days[0].blocks[0].items[0].sets = 0;
  await expect(cache.write('A', badPlan, progress)).rejects.toThrow('plan');
  await expect(cache.write('A', plan, [{ ...progress[0], best_e1rm: NaN }])).rejects.toThrow('plan');
  expect(disk.values).toEqual(before);
});

it('invalidates a confirmed inactive plan without clearing another account', async () => {
  const disk = memory();
  const cache = new PlanCache(disk);
  await cache.write('A', plan, progress);
  await cache.write('B', plan, []);
  await cache.clear('A');
  expect(await new PlanCache(disk).read('A')).toBeNull();
  expect(await cache.read('B')).toEqual({ plan, progress: [] });
});

it('surfaces a storage failure without replacing the previous offline snapshot', async () => {
  const disk = memory();
  const cache = new PlanCache(disk);
  await cache.write('A', plan, progress);
  disk.setItem.mockRejectedValueOnce(new Error('Disk unavailable'));
  await expect(cache.write('A', { ...plan, id: 'new-plan' }, [])).rejects.toThrow('Disk unavailable');
  expect(await cache.read('A')).toEqual({ plan, progress });
});

it('preserves cached rotation when refreshing progress for the same plan', async () => {
  const cache = new PlanCache(memory());
  const rotated = { ...plan, days: [...plan.days, { ...plan.days[0], id: 'next-day', day_index: 1 }] };
  await cache.write('A', rotated, progress, 'next-day');
  await cache.write('A', rotated, []);
  expect((await cache.read('A'))?.nextDayId).toBe('next-day');
  await cache.write('A', { ...plan, id: 'replacement' }, []);
  expect((await cache.read('A'))?.nextDayId).toBeUndefined();
});

it('advances the cached next workout once after confirmed finalization', async () => {
  const disk = memory();
  const cache = new PlanCache(disk);
  const rotated = { ...plan, days: [...plan.days, { ...plan.days[0], id: 'next-day', day_index: 1 }] };
  await cache.write('A', rotated, progress, 'day');
  await cache.advanceAfterSession('A', 'day');
  await new PlanCache(disk).advanceAfterSession('A', 'day');
  expect((await cache.read('A'))?.nextDayId).toBe('next-day');
  expect((await cache.read('A'))?.progress).toEqual(progress);
});
it('preserves rotation when a different day or plan was confirmed remotely', async () => {
  const cache = new PlanCache(memory());
  const rotated = { ...plan, days: [...plan.days, { ...plan.days[0], id: 'next-day', day_index: 1 }] };
  await cache.write('A', rotated, progress, 'next-day');
  await cache.advanceAfterSession('A', 'day');
  await cache.advanceAfterSession('A', 'day-from-retired-plan');
  expect((await cache.read('A'))?.nextDayId).toBe('next-day');
  expect(await cache.read('B')).toBeNull();
});

it('refreshes confirmed progression atomically without changing an independently updated rotation', async () => {
  const cache = new PlanCache(memory());
  const rotated = { ...plan, days: [...plan.days, { ...plan.days[0], id: 'next-day', day_index: 1 }] };
  await cache.write('A', rotated, progress, 'next-day');
  const confirmed = [{ ...progress[0], last_weight_kg: 55, best_weight_kg: 55 }];
  await cache.advanceAfterSession('A', 'day', confirmed);
  expect(await cache.read('A')).toEqual({ plan: rotated, progress: confirmed, nextDayId: 'next-day' });
  await expect(cache.advanceAfterSession('A', 'next-day', [{ ...progress[0], last_weight_kg: NaN }]))
    .rejects.toThrow('plan');
  expect(await cache.read('A')).toEqual({ plan: rotated, progress: confirmed, nextDayId: 'next-day' });
});

it('rejects refresh writes and clears when their original cache snapshot has changed', async () => {
  const cache = new PlanCache(memory());
  await cache.write('A', plan, progress, 'day');
  const original = await cache.read('A');
  const confirmed = [{ ...progress[0], last_weight_kg: 55 }];
  await cache.advanceAfterSession('A', 'day', confirmed);
  expect(await cache.write('A', plan, progress, 'day', original)).toBe(false);
  expect(await cache.clear('A', original)).toBe(false);
  expect((await cache.read('A'))?.progress).toEqual(confirmed);
  const current = await cache.read('A');
  expect(await cache.write('A', plan, confirmed, 'day', current)).toBe(true);
  expect(await cache.clear('A', await cache.read('A'))).toBe(true);
  expect(await cache.read('A')).toBeNull();
});
