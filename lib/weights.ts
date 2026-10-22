import { GYM_ROUTINE_WEIGHT_ALIASES } from '@/lib/data/gym-routine-exercises';
import type { ProgressRow } from '@/lib/db/queries';
import type { Exercise, SetLog } from '@/lib/types';

/** Actual external load, or added load for a bodyweight exercise, from one prior session. */
export interface ExerciseWeightHistory {
  exerciseId: string;
  sessionId: string;
  weightKg: number;
  reps: number | null;
  completedAt: string;
  isBodyweight: boolean;
}

export interface WeightSuggestion {
  weightKg: number | null;
  source: 'progress' | 'history' | 'bodyweight' | 'session' | 'new';
  sourceExerciseId: string | null;
  previousWeightKg: number | null;
}

export interface ExerciseWeightProgress {
  topWeightKg: number | null;
  previousWeightKg: number | null;
  deltaKg: number | null;
}

const validLoad = (weight: number | null | undefined): weight is number =>
  typeof weight === 'number' && Number.isFinite(weight) && weight >= 0;

/** Exact ID first; renamed catalog movements share history in both directions. */
export function getWeightHistoryIds(exerciseId: string): string[] {
  const sourceId = GYM_ROUTINE_WEIGHT_ALIASES.get(exerciseId) ?? exerciseId;
  const ids = new Set([exerciseId]);
  if (sourceId !== exerciseId) ids.add(sourceId);
  for (const [aliasId, originalId] of GYM_ROUTINE_WEIGHT_ALIASES) {
    if (originalId === sourceId) ids.add(aliasId);
  }
  return [...ids];
}

/** Saved targets are suggestions; only actual set history supplies a comparison. */
export function getWeightSuggestion(
  exercise: Exercise,
  progress: ReadonlyMap<string, ProgressRow>,
  history: ReadonlyMap<string, ExerciseWeightHistory>,
): WeightSuggestion {
  const ids = getWeightHistoryIds(exercise.id);
  const recorded = (id: string) => {
    const row = history.get(id);
    return row && row.isBodyweight === exercise.is_bodyweight && validLoad(row.weightKg)
      ? row : undefined;
  };
  const previous = ids.map(recorded).find((row) => row != null);
  const previousWeightKg = previous?.weightKg ?? null;
  const saved = (id: string): WeightSuggestion | null => {
    const actualHistory = history.get(id);
    if (actualHistory && actualHistory.isBodyweight !== exercise.is_bodyweight) return null;
    const weightKg = progress.get(id)?.last_weight_kg;
    return validLoad(weightKg)
      ? { weightKg, source: 'progress', sourceExerciseId: id, previousWeightKg }
      : null;
  };
  const actual = (id: string): WeightSuggestion | null => {
    const row = recorded(id);
    return row
      ? { weightKg: row.weightKg, source: 'history', sourceExerciseId: id, previousWeightKg }
      : null;
  };

  const exact = saved(exercise.id) ?? actual(exercise.id);
  if (exact) return exact;
  for (const id of ids.slice(1)) {
    const equivalent = saved(id) ?? actual(id);
    if (equivalent) return equivalent;
  }
  return {
    weightKg: exercise.is_bodyweight ? 0 : null,
    source: exercise.is_bodyweight ? 'bodyweight' : 'new',
    sourceExerciseId: null,
    previousWeightKg,
  };
}

/** Compare external load; bodyweight changes must not create apparent lifting progress. */
export function exerciseWeightProgress(
  sets: SetLog[], previousWeightKg: number | null,
): ExerciseWeightProgress {
  const topWeightKg = sets.reduce<number | null>((best, set) => {
    const weight = set.is_bodyweight ? set.added_load_kg : set.weight_kg;
    return validLoad(weight) && (best == null || weight > best) ? weight : best;
  }, null);
  const previous = validLoad(previousWeightKg) ? previousWeightKg : null;
  return {
    topWeightKg,
    previousWeightKg: previous,
    deltaKg: topWeightKg != null && previous != null ? topWeightKg - previous : null,
  };
}
