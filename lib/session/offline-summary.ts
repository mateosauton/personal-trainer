import type { SessionSummaryLine } from '@/lib/db/queries';
import { exerciseName } from '@/lib/catalog';
import { effectiveLoadKg } from '@/lib/units';
import { sessionTotals } from '@/lib/stats';
import { validateWorkout, type SavedWorkout } from './workout-store';

/** Local feedback only. Future loads and PRs are reserved for the server receipt. */
export function buildOfflineSummary(workout: SavedWorkout | null, owner: string, session: string) {
  if (!workout || workout.ownerId !== owner || workout.sessionId !== session
    || workout.endedAtMs === null || workout.recordedSets === undefined) return null;
  validateWorkout(workout, owner);
  const items = new Map(workout.day.blocks.flatMap(block => block.items.map(item => [item.id, item])));
  const sets = new Map((workout.recordedSets ?? []).map(([, set]) =>
    [`${set.plan_item_id}:${set.set_index}`, set]));
  const groups = new Map<string, typeof workout.recordedSets>();
  for (const [id, set] of sets) {
    const group = groups.get(set.exercise_id) ?? [];
    group.push([id, set]); groups.set(set.exercise_id, group);
  }
  const lines: SessionSummaryLine[] = [...groups].map(([exerciseId, group]) => {
    const all = group!.map(([, set]) => set);
    const measured = all.filter(set => set.seconds == null && items.get(set.plan_item_id)?.seconds == null);
    const timed = all.filter(set => set.seconds != null || items.get(set.plan_item_id)?.seconds != null);
    const bodyweight = workout.bodyweightKg ?? null;
    const topLoadKg = measured.map(set => effectiveLoadKg(set, bodyweight))
      .reduce<number | null>((best, load) => load != null && (best == null || load > best) ? load : best, null);
    return { exerciseId, name: exerciseName(exerciseId), sets: all.length,
      ...(timed.length ? { seconds: timed.reduce((sum, set) => sum + (set.seconds ?? 0), 0) } : {}),
      volumeKg: sessionTotals(measured, bodyweight).volumeKg, topLoadKg, verdict: null, isPr: false };
  });
  const durationS = workout.timing
    ? workout.timing.plannedSeconds + ((workout.timing.session.pausedAt ?? workout.endedAtMs) - workout.timing.session.endAt) / 1000
    : (workout.endedAtMs - workout.startedAtMs) / 1000;
  return { lines, units: workout.units, durationS: Math.max(0, Math.floor(durationS)) };
}
