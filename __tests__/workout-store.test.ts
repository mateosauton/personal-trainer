import { WorkoutStore, type SavedWorkout } from '@/lib/session/workout-store';

const fixture = (ownerId = 'A'): SavedWorkout => ({
  version: 1,
  ownerId,
  sessionId: 'session-' + ownerId,
  units: 'kg',
  cursor: 0,
  phase: 'work',
  draft: null,
  savedDraft: null,
  restUntilMs: null,
  startedAtMs: 1000,
  endedAtMs: null,
  progress: [],
  day: {
    id: 'day',
    day_index: 0,
    name: 'Day',
    focus: 'Strength',
    blocks: [
      {
        id: 'block',
        block_index: 0,
        kind: 'straight',
        title: 'Work',
        rounds: 1,
        rest_seconds: 90,
        items: [
          {
            id: 'item',
            item_index: 0,
            exercise_id: 'press',
            sets: 2,
            reps_low: 6,
            reps_high: 8,
            seconds: null,
            tempo: null,
            notes: null,
          },
        ],
      },
    ],
  },
});
const memory = () => {
  const values = new Map<string, string>();
  return {
    values,
    getItem: jest.fn(async (key: string) => values.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => {
      values.set(key, value);
    }),
  };
};

it('restores a workout in a new store without exposing it to another account', async () => {
  const disk = memory();
  const first = new WorkoutStore(disk);
  await first.create(fixture());
  const value = { reps: 7, weight: 60, asBodyweight: false };
  await first.update(
    'A',
    'session-A',
    { cursor: 0, phase: 'work' },
    { phase: 'resting', draft: value, savedDraft: value, restUntilMs: 91000 },
  );
  const restarted = new WorkoutStore(disk);
  expect((await restarted.read('A'))?.draft).toEqual(value);
  expect((await restarted.read('A'))?.restUntilMs).toBe(91000);
  expect(await restarted.read('B')).toBeNull();
  await restarted.clear('A', 'another-session');
  expect(await restarted.read('A')).not.toBeNull();
});

it('does not advance durable state when writing fails', async () => {
  const disk = memory();
  const store = new WorkoutStore(disk);
  await store.create(fixture());
  disk.setItem.mockRejectedValueOnce(new Error('disk full'));
  await expect(
    store.update('A', 'session-A', { cursor: 0, phase: 'work' }, { cursor: 1 }),
  ).rejects.toThrow('disk full');
  expect((await store.read('A'))?.cursor).toBe(0);
});

it('rejects stale cursor transitions and another active session', async () => {
  const store = new WorkoutStore(memory());
  await store.create(fixture());
  await store.update(
    'A',
    'session-A',
    { cursor: 0, phase: 'work' },
    { cursor: 1 },
  );
  await expect(
    store.update('A', 'session-A', { cursor: 0, phase: 'work' }, { cursor: 0 }),
  ).rejects.toThrow('changed');
  await expect(
    store.create({ ...fixture(), sessionId: 'other' }),
  ).rejects.toThrow('unfinished');
});

it('preserves corrupted or cross-account data without overwriting it', async () => {
  const disk = memory();
  const store = new WorkoutStore(disk);
  const key = 'office-gym.active-workout.v1.A';
  disk.values.set(key, '{broken');
  await expect(store.read('A')).rejects.toThrow('preserved');
  await expect(store.create(fixture())).rejects.toThrow('preserved');
  expect(disk.values.get(key)).toBe('{broken');
  disk.values.set(key, JSON.stringify(fixture('B')));
  await expect(store.read('A')).rejects.toThrow('preserved');
});
