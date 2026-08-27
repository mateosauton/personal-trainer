import type { Pattern, Units } from './types';
import { displayToKg, kgToDisplay, step } from './units';

/**
 * Lower-body lifts add weight in bigger jumps than upper-body ones: the same
 * absolute increment is a much smaller relative step on a squat than a curl.
 */
const LOWER_PATTERNS: Pattern[] = ['squat', 'hinge', 'lunge'];

/**
 * Loads are stored in kg, but the jump has to land on plates the user's gym
 * actually racks. A kg-fixed 2.5 step walks an lb lifter onto 140.5, 146,
 * 151.5 -- numbers no plate set can make.
 */
export function incrementKg(pattern: Pattern, units: Units = 'kg'): number {
  const plates = step(units);
  return displayToKg(LOWER_PATTERNS.includes(pattern) ? plates * 2 : plates, units);
}

/** Snap a load to the nearest real plate increment for the user's units. */
function roundToPlates(kg: number, units: Units): number {
  const plates = step(units);
  return displayToKg(Math.round(kgToDisplay(kg, units) / plates) * plates, units);
}

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
  units: Units = 'kg',
): ProgressUpdate {
  const logged = sets.filter((s) => s.reps != null);
  // A zero or negative load carries no information to progress from -- an
  // unweighted bodyweight set logs added_load_kg of 0, and scaling that by 0.9
  // or rounding it up to one plate would both be nonsense.
  if (logged.length === 0 || workingLoadKg == null || workingLoadKg <= 0) {
    return { last_weight_kg: workingLoadKg, miss_streak: state.miss_streak, verdict: null };
  }

  const allTopped = logged.every((s) => (s.reps as number) >= repsHigh);
  // An unreported RPE is treated as manageable; nagging for it every set would
  // cost more than the occasional early jump.
  const manageable = logged.every((s) => s.rpe == null || s.rpe <= 8);

  if (allTopped && manageable) {
    return {
      last_weight_kg: workingLoadKg + incrementKg(pattern, units),
      miss_streak: 0,
      verdict: 'progress',
    };
  }

  const missed = logged.some((s) => (s.reps as number) < repsLow);
  if (missed) {
    const streak = state.miss_streak + 1;
    if (streak >= 2) {
      // Rounding alone could push a light load *up* (1.5 kg -> 2.5 kg), so the
      // result is clamped below the current load and floored at one increment.
      const target = roundToPlates(workingLoadKg * 0.9, units);
      const floor = incrementKg(pattern, units);
      const deloaded = Math.min(Math.max(target, floor), workingLoadKg);
      return { last_weight_kg: deloaded, miss_streak: 0, verdict: 'deload' };
    }
    return { last_weight_kg: workingLoadKg, miss_streak: streak, verdict: 'hold' };
  }

  return { last_weight_kg: workingLoadKg, miss_streak: 0, verdict: 'hold' };
}
