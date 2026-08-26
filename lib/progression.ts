import type { Pattern } from './types';

/**
 * Lower-body lifts add weight in bigger jumps than upper-body ones: the same
 * absolute increment is a much smaller relative step on a squat than a curl.
 */
const LOWER_PATTERNS: Pattern[] = ['squat', 'hinge', 'lunge'];

export const incrementKg = (pattern: Pattern) =>
  LOWER_PATTERNS.includes(pattern) ? 5 : 2.5;

export interface SetOutcome {
  reps: number | null;
  rpe: number | null;
}

export interface ProgressState {
  last_weight_kg: number | null;
  miss_streak: number;
}

export interface ProgressUpdate {
  last_weight_kg: number | null;
  miss_streak: number;
  /** What the UI tells the user happened, or null when nothing changed. */
  verdict: 'progress' | 'hold' | 'deload' | null;
}

/**
 * Double progression: work up the rep range at a fixed load, and only add
 * weight once every set hits the top of the range at a manageable effort.
 * Two sessions in a row spent stuck at the bottom of the range means the load
 * is wrong, not the effort, so it backs off 10%.
 */
export function nextLoad(
  sets: SetOutcome[],
  repsHigh: number,
  repsLow: number,
  pattern: Pattern,
  workingLoadKg: number | null,
  state: ProgressState,
): ProgressUpdate {
  const logged = sets.filter((s) => s.reps != null);
  if (logged.length === 0 || workingLoadKg == null) {
    return { last_weight_kg: workingLoadKg, miss_streak: state.miss_streak, verdict: null };
  }

  const allTopped = logged.every((s) => (s.reps as number) >= repsHigh);
  // An unreported RPE is treated as manageable; nagging for it every set would
  // cost more than the occasional early jump.
  const manageable = logged.every((s) => s.rpe == null || s.rpe <= 8);

  if (allTopped && manageable) {
    return {
      last_weight_kg: workingLoadKg + incrementKg(pattern),
      miss_streak: 0,
      verdict: 'progress',
    };
  }

  const missed = logged.some((s) => (s.reps as number) < repsLow);
  if (missed) {
    const streak = state.miss_streak + 1;
    if (streak >= 2) {
      return {
        last_weight_kg: Math.round((workingLoadKg * 0.9) / 2.5) * 2.5,
        miss_streak: 0,
        verdict: 'deload',
      };
    }
    return { last_weight_kg: workingLoadKg, miss_streak: streak, verdict: 'hold' };
  }

  return { last_weight_kg: workingLoadKg, miss_streak: 0, verdict: 'hold' };
}
