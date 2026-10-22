import { format } from 'date-fns';
import { calendarDayDifference, calendarDayKey, shiftDayKey } from './calendar-days';

import { effectiveLoadKg } from './units';
import { getExercise } from './catalog';

/** A logged set as it comes back from `set_logs`. */
export interface LoggedSet {
  exercise_id?: string;
  reps: number | null;
  seconds?: number | null;
  weight_kg: number | null;
  is_bodyweight: boolean;
  added_load_kg: number;
}

export interface SessionRow {
  id: string;
  started_at: string;
  duration_s: number | null;
}

export interface Totals {
  sets: number;
  reps: number;
  volumeKg: number;
}

/** Local calendar day, the unit the calendar and the streak both count in. */
export const dayKey = (date: Date | string, timeZone?: string): string =>
  timeZone ? calendarDayKey(date, timeZone) : format(typeof date === 'string' ? new Date(date) : date, 'yyyy-MM-dd');

export function trainedDayKeys(sessions: { started_at: string }[], timeZone: string): Set<string> {
  return new Set(sessions.map((s) => calendarDayKey(s.started_at, timeZone)));
}

/**
 * Consecutive days trained, counting back from today.
 *
 * Today not being trained *yet* does not break the streak — the day is still
 * running, and a streak that resets at midnight would punish a morning check
 * of the app. It breaks once a whole day has passed with nothing logged.
 */
export function streakDays(days: Set<string>, today: Date | string): number {
  if (days.size === 0) return 0;
  let cursor = typeof today === 'string' ? today : dayKey(today);
  if (!days.has(cursor)) {
    cursor = shiftDayKey(cursor, -1);
    if (!days.has(cursor)) return 0;
  }
  let streak = 0;
  while (days.has(cursor)) {
    streak += 1;
    cursor = shiftDayKey(cursor, -1);
  }
  return streak;
}

/** Future dates never become negative inactivity counts. */
export function daysSinceLast(days: Set<string>, today: Date | string): number | null {
  if (days.size === 0) return null;
  const latest = [...days].sort().at(-1)!;
  return Math.max(0, calendarDayDifference(typeof today === 'string' ? today : dayKey(today), latest));
}

/**
 * Reps and tonnage for a set of logs. Bodyweight movements count the user's
 * mass, the same way the summary screen and the progression rule do; with no
 * bodyweight on file they contribute reps but no volume. Unilateral logs keep
 * reps per side for progression; display totals count both sides.
 */
export function sessionTotals(logs: LoggedSet[], bodyweightKg: number | null): Totals {
  let reps = 0;
  let volumeKg = 0;
  for (const log of logs) {
    const sides = log.exercise_id && getExercise(log.exercise_id)?.is_unilateral ? 2 : 1;
    const setReps = log.seconds != null ? 0 : (log.reps ?? 0) * sides;
    reps += setReps;
    const load = effectiveLoadKg(log, bodyweightKg);
    if (load != null) volumeKg += load * setReps;
  }
  return { sets: logs.length, reps, volumeKg };
}

/** The last `count` calendar days, oldest first — the dot strip on Home. */
export function recentDays(count: number, today: Date | string): string[] {
  const key = typeof today === 'string' ? today : dayKey(today);
  return Array.from({ length: count }, (_, index) => shiftDayKey(key, index - count + 1));
}
