import { buildOfflineSummary } from '@/lib/session/offline-summary';
import type { SavedWorkout } from '@/lib/session/workout-store';

const item = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const timed = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const fixture = (): SavedWorkout => ({ version: 1, ownerId: 'owner', sessionId: 'session',
  units: 'lb', bodyweightKg: 80, progress: [], cursor: 2, phase: 'work', draft: null,
  savedDraft: null, restUntilMs: null, startedAtMs: 1000, endedAtMs: 91000,
  day: { id: 'day', day_index: 0, name: 'Day', focus: 'Strength', blocks: [{ id: 'block', block_index: 0,
    kind: 'straight', title: 'Work', rounds: 1, rest_seconds: 60, items: [
      { id: item, exercise_id: 'test-reps', item_index: 0, sets: 1, reps_low: 8, reps_high: 10, seconds: null, tempo: null, notes: null },
      { id: timed, exercise_id: 'test-hold', item_index: 1, sets: 1, reps_low: 0, reps_high: 0, seconds: 40, tempo: null, notes: null },
    ] }] },
  recordedSets: [['rep', { plan_item_id: item, exercise_id: 'test-reps', set_index: 1, reps: 8,
    weight_kg: 60, is_bodyweight: false, added_load_kg: 0, rpe: null }],
  ['time', { plan_item_id: timed, exercise_id: 'test-hold', set_index: 1, reps: null, seconds: 40,
    weight_kg: null, is_bodyweight: true, added_load_kg: 0, rpe: null }]],
});

it('shows captured mixed-workout feedback without awarding progression or PRs', () => {
  const summary = buildOfflineSummary(fixture(), 'owner', 'session');
  expect(summary?.durationS).toBe(90);
  expect(summary?.units).toBe('lb');
  expect(summary?.lines).toEqual([
    { exerciseId: 'test-reps', name: 'test-reps', sets: 1, volumeKg: 480, topLoadKg: 60, verdict: null, isPr: false },
    { exerciseId: 'test-hold', name: 'test-hold', sets: 1, seconds: 40, volumeKg: 0, topLoadKg: null, verdict: null, isPr: false },
  ]);
});

it('uses unknown captured bodyweight rather than a newer profile or fabricated volume', () => {
  const workout = fixture();
  delete workout.bodyweightKg;
  workout.recordedSets![0][1] = { ...workout.recordedSets![0][1], weight_kg: null, is_bodyweight: true };
  expect(buildOfflineSummary(workout, 'owner', 'session')?.lines[0].volumeKg).toBe(0);
});
it('retains the completion duration after pauses rather than counting paused wall time', () => {
  const workout = fixture();
  workout.timing = { session: { endAt: 101000, pausedAt: null }, block: null, blockId: 'block', plannedSeconds: 60 };
  expect(buildOfflineSummary(workout, 'owner', 'session')?.durationS).toBe(50);
});

it('does not show another account/session or an unfinished/missing snapshot as complete', () => {
  expect(buildOfflineSummary(fixture(), 'other', 'session')).toBeNull();
  expect(buildOfflineSummary(fixture(), 'owner', 'other')).toBeNull();
  expect(buildOfflineSummary({ ...fixture(), cursor: 0, endedAtMs: null }, 'owner', 'session')).toBeNull();
  expect(buildOfflineSummary({ ...fixture(), recordedSets: undefined }, 'owner', 'session')).toBeNull();
});
