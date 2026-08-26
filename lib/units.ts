import type { Units } from './types';

const LB_PER_KG = 2.2046226218;

/** Everything is stored in kg; display converts at the edge. */
export const kgToDisplay = (kg: number, units: Units) =>
  units === 'kg' ? kg : kg * LB_PER_KG;

export const displayToKg = (value: number, units: Units) =>
  units === 'kg' ? value : value / LB_PER_KG;

/** Plate maths: kg gyms step in 2.5, lb gyms in 5. */
export const step = (units: Units) => (units === 'kg' ? 2.5 : 5);

export function formatWeight(kg: number | null, units: Units): string {
  if (kg == null) return '—';
  const value = kgToDisplay(kg, units);
  const rounded = Math.round(value * 10) / 10;
  return `${rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(1)} ${units}`;
}

/**
 * Effective load for a set. Bodyweight movements carry the user's mass plus
 * whatever they hung off a belt, which is what makes a weighted pull-up
 * comparable to a lat pulldown.
 */
export function effectiveLoadKg(
  set: { is_bodyweight: boolean; weight_kg: number | null; added_load_kg: number },
  bodyweightKg: number | null,
): number | null {
  if (!set.is_bodyweight) return set.weight_kg;
  if (bodyweightKg == null) return null;
  return bodyweightKg + (set.added_load_kg ?? 0);
}

/** Epley. Only meaningful in the 1-12 rep range, which is where the app lives. */
export function estimateOneRepMax(loadKg: number, reps: number): number {
  if (reps <= 1) return loadKg;
  return loadKg * (1 + reps / 30);
}
