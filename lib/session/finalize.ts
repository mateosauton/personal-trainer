import { getExercise } from '@/lib/catalog';
import type { ProgressRow, SessionSetSnapshot, SessionSummaryLine, SetSnapshotVersion } from '@/lib/db/queries';
import { nextLoad } from '@/lib/progression';
import { sessionTotals } from '@/lib/stats';
import type { PlanDay, SetLog, Units } from '@/lib/types';
import { effectiveLoadKg, estimateOneRepMax } from '@/lib/units';
import type { SavedWorkout } from './workout-store';

/** All I/O must be bound to the captured account and access token by the caller. */
export interface FinalizationDependencies {
  getReceipt(sessionId: string, signal?: AbortSignal): Promise<SessionSummaryLine[] | null>;
  getSnapshot(sessionId: string, signal?: AbortSignal): Promise<SessionSetSnapshot>;
  getProgress(ownerId: string, signal?: AbortSignal): Promise<Map<string, ProgressRow>>;
  applyProgress(sessionId: string, expected: { exercise_id: string; state: ProgressRow | null }[],
    updates: ProgressRow[], result: SessionSummaryLine[], versions: SetSnapshotVersion[],
    signal?: AbortSignal): Promise<SessionSummaryLine[]>;
  guard?(): void;
}

export type FinalizationWorkout = Pick<SavedWorkout, 'ownerId' | 'sessionId' | 'day' | 'units' | 'bodyweightKg'>;

export type SummarySet = Omit<SetLog, 'plan_item_id'> & { plan_item_id: string | null };

/** Calculation only. Local observations must never be persisted as a server receipt. */
export function calculateSessionSummary(day: PlanDay, logs: SummarySet[],
  progress: ReadonlyMap<string, ProgressRow>, units: Units, bodyweightKg: number | null,
): { lines: SessionSummaryLine[]; updates: ProgressRow[] } {
  const itemById = new Map(day.blocks.flatMap(block =>
    block.items.map(item => [item.id, { item, block }] as const)));
  const grouped = new Map<string, SummarySet[]>();
  for (const log of logs) {
    const sets = grouped.get(log.exercise_id) ?? [];
    sets.push(log);
    grouped.set(log.exercise_id, sets);
  }
  const lines: SessionSummaryLine[] = [];
  const updates: ProgressRow[] = [];
  for (const [exerciseId, allSets] of grouped) {
    const exercise = getExercise(exerciseId);
    const timed = (set: SummarySet) => set.seconds != null
      || itemById.get(set.plan_item_id ?? '')?.item.seconds != null;
    const hasTimed = allSets.some(timed);
    const seconds = allSets.reduce((sum, set) => sum + (set.seconds ?? 0), 0);
    const sets = allSets.filter(set => !timed(set));
    const loads = sets.map(set => effectiveLoadKg(set, bodyweightKg));
    const { volumeKg } = sessionTotals(sets, bodyweightKg);
    const topLoadKg = loads.reduce<number | null>((best, load) =>
      load != null && (best == null || load > best) ? load : best, null);
    const e1rm = sets.reduce((best, set, index) => {
      const load = loads[index];
      return load == null || !set.reps ? best : Math.max(best, estimateOneRepMax(load, set.reps));
    }, 0);
    const known = progress.get(exerciseId);
    const first = sets[0];
    const context = itemById.get(first?.plan_item_id ?? '');
    const workingLoad = first?.is_bodyweight ? first.added_load_kg : first?.weight_kg ?? null;
    const verdict = context && exercise ? nextLoad(
      sets.map(set => ({ reps: set.reps, rpe: set.rpe })),
      context.item.reps_high, context.item.reps_low, exercise.pattern, workingLoad,
      { last_weight_kg: known?.last_weight_kg ?? null, miss_streak: known?.miss_streak ?? 0 }, units,
    ) : null;
    const isPr = topLoadKg != null && (known?.best_weight_kg == null || topLoadKg > known.best_weight_kg);
    lines.push({ exerciseId, name: exercise?.name ?? exerciseId, sets: allSets.length,
      ...(hasTimed ? { seconds } : {}), volumeKg, topLoadKg,
      verdict: verdict?.verdict ?? null, isPr });
    // Timed-only work has no rep/load outcome. Warmups never advance a working weight.
    if (sets.length && context && context.block.kind !== 'warmup') {
      updates.push({ exercise_id: exerciseId, last_weight_kg: verdict?.last_weight_kg ?? workingLoad,
        last_reps: sets[sets.length - 1].reps,
        best_weight_kg: isPr ? topLoadKg : known?.best_weight_kg ?? null,
        best_e1rm: Math.max(e1rm, known?.best_e1rm ?? 0) || null,
        miss_streak: verdict?.miss_streak ?? 0 });
    }
  }
  return { lines, updates };
}

/** Finalize only acknowledged server sets; the caller retains and conditionally clears local state. */
export async function finalizeWorkout(workout: FinalizationWorkout, dependencies: FinalizationDependencies,
  signal?: AbortSignal): Promise<SessionSummaryLine[]> {
  // Keep the original workout context across awaits and stale-snapshot retries.
  const captured = JSON.parse(JSON.stringify(workout)) as FinalizationWorkout;
  const guard = () => {
    if (signal?.aborted)
      throw Object.assign(new Error('Workout finalization cancelled.'), { name: 'AbortError' });
    dependencies.guard?.();
  };
  guard();
  const previous = await dependencies.getReceipt(captured.sessionId, signal);
  guard();
  if (previous !== null) return previous;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    guard();
    const [snapshot, progress] = await Promise.all([
      dependencies.getSnapshot(captured.sessionId, signal),
      dependencies.getProgress(captured.ownerId, signal),
    ]);
    guard();
    const { lines, updates } = calculateSessionSummary(captured.day, snapshot.logs,
      progress, captured.units, captured.bodyweightKg ?? null);
    try {
      guard();
      const saved = await dependencies.applyProgress(captured.sessionId,
        updates.map(row => ({ exercise_id: row.exercise_id, state: progress.get(row.exercise_id) ?? null })),
        updates, lines, snapshot.versions, signal);
      guard();
      return saved;
    } catch (error) {
      guard();
      if ((error as { code?: string })?.code === '40001' && attempt < 2) continue;
      throw error;
    }
  }
  throw new Error('Could not finalize the workout. Please retry.');
}
