import { differenceInCalendarDays, format } from 'date-fns';

import { effectiveLoadKg } from './units';

/** A logged set as it comes back from `set_logs`. */
export interface LoggedSet {
  reps: number | null;
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
export const dayKey = (date: Date | string): string =>
  format(typeof date === 'string' ? new Date(date) : date, 'yyyy-MM-dd');

export function trainedDayKeys(sessions: { started_at: string }[]): Set<string> {
  return new Set(sessions.map((s) => dayKey(s.started_at)));
}

/**
 * Consecutive days trained, counting back from today.
 *
 * Today not being trained *yet* does not break the streak — the day is still
 * running, and a streak that resets at midnight would punish a morning check
 * of the app. It breaks once a whole day has passed with nothing logged.
 */
export function streakDays(days: Set<string>, today: Date = new Date()): number {
  if (days.size === 0) return 0;

  const cursor = new Date(today);
  // Start on today if it was trained, otherwise on yesterday; anything older
  // than that means the chain is already broken.
  if (!days.has(dayKey(cursor))) {
    cursor.setDate(cursor.getDate() - 1);
    if (!days.has(dayKey(cursor))) return 0;
  }

  let streak = 0;
  while (days.has(dayKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

/** Days since the last session, or null if there has never been one. */
export function daysSinceLast(days: Set<string>, today: Date = new Date()): number | null {
  if (days.size === 0) return null;
  const latest = [...days].sort().at(-1)!;
  return differenceInCalendarDays(today, new Date(`${latest}T00:00:00`));
}

/**
 * Reps and tonnage for a set of logs. Bodyweight movements count the user's
 * mass, the same way the summary screen and the progression rule do; with no
 * bodyweight on file they contribute reps but no volume.
 */
export function sessionTotals(logs: LoggedSet[], bodyweightKg: number | null): Totals {
  let reps = 0;
  let volumeKg = 0;
  for (const log of logs) {
    const setReps = log.reps ?? 0;
    reps += setReps;
    const load = effectiveLoadKg(log, bodyweightKg);
    if (load != null) volumeKg += load * setReps;
  }
  return { sets: logs.length, reps, volumeKg };
}

/** The last `count` calendar days, oldest first — the dot strip on Home. */
export function recentDays(count: number, today: Date = new Date()): string[] {
  const out: string[] = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    out.push(dayKey(d));
  }
  return out;
}
