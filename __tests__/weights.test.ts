import { getExercise } from '@/lib/catalog';
import { gymExerciseId } from '@/lib/data/gym-routine-exercises';
import type { ProgressRow } from '@/lib/db/queries';
import type { SetLog } from '@/lib/types';
import {
  exerciseWeightProgress, getWeightHistoryIds, getWeightSuggestion,
  type ExerciseWeightHistory,
} from '@/lib/weights';

const benchId = 'Barbell_Bench_Press_-_Medium_Grip';
const gymBenchId = gymExerciseId('Barbell bench press');
const bench = getExercise(gymBenchId)!;
const target = (exercise_id: string, last_weight_kg: number | null): ProgressRow => ({
  exercise_id, last_weight_kg, last_reps: 8, best_weight_kg: null,
  best_e1rm: null, miss_streak: 0,
});
const recorded = (
  exerciseId: string, weightKg: number,
  overrides: Partial<ExerciseWeightHistory> = {},
): ExerciseWeightHistory => ({
  exerciseId, sessionId: 'previous-session', weightKg, reps: 8,
  completedAt: '2026-10-20T12:00:00Z', isBodyweight: false, ...overrides,
});
const log = (weight_kg: number | null, overrides: Partial<SetLog> = {}): SetLog => ({
  plan_item_id: 'item', exercise_id: gymBenchId, set_index: 1,
  reps: 8, weight_kg, is_bodyweight: false, added_load_kg: 0, rpe: null, ...overrides,
});

describe('exercise load history identity', () => {
  it('uses stable exact aliases in either catalog direction', () => {
    expect(getWeightHistoryIds(gymBenchId)).toEqual([gymBenchId, benchId]);
    expect(getWeightHistoryIds(benchId)).toEqual([benchId, gymBenchId]);
    expect(getWeightHistoryIds('unknown-exercise')).toEqual(['unknown-exercise']);
  });

  it('keeps light work, equipment changes and combinations separate', () => {
    const light = gymExerciseId('Light chest-supported dumbbell row');
    expect(getWeightHistoryIds(light)).toEqual([light]);
    expect(getWeightHistoryIds('Dumbbell_Incline_Row')).not.toContain(light);
    const machine = gymExerciseId('Seated row machine');
    expect(getWeightHistoryIds(machine)).toEqual([machine]);
    const combination = gymExerciseId('Dumbbell thruster');
    expect(getWeightHistoryIds(combination)).toEqual([combination]);
  });
});

describe('personal weight suggestions', () => {
  it('uses the exact saved target while preserving the actual previous weight', () => {
    const result = getWeightSuggestion(bench,
      new Map([[gymBenchId, target(gymBenchId, 62.5)]]),
      new Map([[gymBenchId, recorded(gymBenchId, 60)]]));
    expect(result).toEqual({
      weightKg: 62.5, source: 'progress', sourceExerciseId: gymBenchId, previousWeightKg: 60,
    });
  });

  it('prefers exact recorded work over an equivalent saved target', () => {
    const result = getWeightSuggestion(bench,
      new Map([[benchId, target(benchId, 70)]]),
      new Map([[gymBenchId, recorded(gymBenchId, 60)]]));
    expect(result).toEqual({
      weightKg: 60, source: 'history', sourceExerciseId: gymBenchId, previousWeightKg: 60,
    });
  });

  it('reuses an equivalent original exercise target and actual history', () => {
    const result = getWeightSuggestion(bench,
      new Map([[benchId, target(benchId, 62.5)]]),
      new Map([[benchId, recorded(benchId, 60)]]));
    expect(result).toEqual({
      weightKg: 62.5, source: 'progress', sourceExerciseId: benchId, previousWeightKg: 60,
    });
  });

  it('reuses equivalent recorded work when no target exists', () => {
    expect(getWeightSuggestion(bench, new Map(),
      new Map([[benchId, recorded(benchId, 60)]]))).toEqual({
      weightKg: 60, source: 'history', sourceExerciseId: benchId, previousWeightKg: 60,
    });
  });

  it('does not invent a load or a previous result without history', () => {
    expect(getWeightSuggestion(bench, new Map(), new Map())).toEqual({
      weightKg: null, source: 'new', sourceExerciseId: null, previousWeightKg: null,
    });
    expect(getWeightSuggestion(bench,
      new Map([[gymBenchId, target(gymBenchId, 62.5)]]), new Map()).previousWeightKg).toBeNull();
  });

  it('starts an unrecorded bodyweight movement without added weight', () => {
    const pullup = getExercise(gymExerciseId('Pull-up'))!;
    expect(getWeightSuggestion(pullup, new Map(), new Map())).toEqual({
      weightKg: 0, source: 'bodyweight', sourceExerciseId: null, previousWeightKg: null,
    });
  });

  it('refuses history recorded using a different bodyweight convention', () => {
    expect(getWeightSuggestion(bench, new Map(),
      new Map([[gymBenchId, recorded(gymBenchId, 80, { isBodyweight: true })]]))).toEqual({
      weightKg: null, source: 'new', sourceExerciseId: null, previousWeightKg: null,
    });
  });

  it('refuses a saved target contradicted by the recorded loading convention', () => {
    const pullupId = gymExerciseId('Pull-up');
    const pullup = getExercise(pullupId)!;
    expect(getWeightSuggestion(pullup,
      new Map([[pullupId, target(pullupId, 80)]]),
      new Map([[pullupId, recorded(pullupId, 80, { isBodyweight: false })]]))).toEqual({
      weightKg: 0, source: 'bodyweight', sourceExerciseId: null, previousWeightKg: null,
    });
    expect(getWeightSuggestion(pullup,
      new Map([['Pullups', target('Pullups', 80)]]),
      new Map([['Pullups', recorded('Pullups', 80, { isBodyweight: false })]]))).toEqual({
      weightKg: 0, source: 'bodyweight', sourceExerciseId: null, previousWeightKg: null,
    });
  });

  it('ignores invalid loads and preserves valid zero loads', () => {
    for (const invalid of [NaN, Infinity, -1]) {
      expect(getWeightSuggestion(bench,
        new Map([[gymBenchId, target(gymBenchId, invalid)]]),
        new Map([[gymBenchId, recorded(gymBenchId, invalid)]]))).toEqual({
        weightKg: null, source: 'new', sourceExerciseId: null, previousWeightKg: null,
      });
    }
    expect(getWeightSuggestion(bench, new Map(),
      new Map([[gymBenchId, recorded(gymBenchId, 0)]]))).toEqual({
      weightKg: 0, source: 'history', sourceExerciseId: gymBenchId, previousWeightKg: 0,
    });
  });
});

describe('weight progress after an exercise', () => {
  it('compares the heaviest completed load against actual previous work', () => {
    expect(exerciseWeightProgress([log(60), log(62.5), log(55)], 60)).toEqual({
      topWeightKg: 62.5, previousWeightKg: 60, deltaKg: 2.5,
    });
    expect(exerciseWeightProgress([log(55)], 60).deltaKg).toBe(-5);
  });

  it('compares added bodyweight load and keeps timed work valid', () => {
    expect(exerciseWeightProgress([
      log(null, { is_bodyweight: true, added_load_kg: 10 }),
      log(null, { is_bodyweight: true, added_load_kg: 12.5, reps: null }),
    ], 10)).toEqual({ topWeightKg: 12.5, previousWeightKg: 10, deltaKg: 2.5 });
  });

  it('treats a first result as a baseline instead of a weight increase', () => {
    expect(exerciseWeightProgress([log(20)], null)).toEqual({
      topWeightKg: 20, previousWeightKg: null, deltaKg: null,
    });
    expect(exerciseWeightProgress([log(0)], 0).deltaKg).toBe(0);
  });

  it('ignores invalid entries and never reports an invalid comparison', () => {
    expect(exerciseWeightProgress([log(null), log(NaN), log(Infinity), log(-5)], 60)).toEqual({
      topWeightKg: null, previousWeightKg: 60, deltaKg: null,
    });
    expect(exerciseWeightProgress([log(20)], NaN)).toEqual({
      topWeightKg: 20, previousWeightKg: null, deltaKg: null,
    });
  });
});
