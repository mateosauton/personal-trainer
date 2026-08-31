import { getExercise } from '@/lib/catalog';
import type { PlanDay } from '@/lib/types';

export interface DayEstimate {
  /** Work blocks only; the warm-up is not one of them. */
  blocks: number;
  sets: number;
  /** Planned reps, taking the middle of each rep range. */
  reps: number;
  minutes: number;
  /** Muscles the session actually targets, most-hit first. */
  bodyParts: string[];
}

/** A working set nobody times takes about this long. */
const SECONDS_PER_SET = 45;

const midpoint = (low: number, high: number) => Math.round((low + high) / 2);

/**
 * What a session costs before it is done: sets, planned reps, wall-clock
 * minutes and the muscles it hits. Pure, so the Plan and Home screens agree on
 * the numbers without either of them owning the arithmetic.
 */
export function estimateDay(day: PlanDay): DayEstimate {
  let sets = 0;
  let reps = 0;
  let seconds = 0;
  const muscleCount = new Map<string, number>();

  for (const block of day.blocks) {
    const isWork = block.kind !== 'warmup';
    // Straight sets repeat per item; supersets and circuits repeat the block.
    const rounds = block.kind === 'straight' ? 1 : block.rounds;

    for (const item of block.items) {
      const itemSets = block.kind === 'straight' ? item.sets : rounds;
      const itemSeconds = item.seconds ?? SECONDS_PER_SET;

      seconds += itemSets * itemSeconds;
      if (isWork) {
        sets += itemSets;
        if (item.seconds == null) reps += itemSets * midpoint(item.reps_low, item.reps_high);
      }

      const exercise = getExercise(item.exercise_id);
      if (exercise && isWork) {
        const muscles =
          exercise.primary_muscles.length > 0 ? exercise.primary_muscles : [exercise.body_part];
        for (const muscle of muscles) {
          muscleCount.set(muscle, (muscleCount.get(muscle) ?? 0) + itemSets);
        }
      }
    }

    // Rest happens between sets of a straight block and between rounds
    // otherwise; the last rest of a block is the transition into the next one.
    const restUnits =
      block.kind === 'straight'
        ? block.items.reduce((sum, i) => sum + i.sets, 0)
        : block.rounds;
    seconds += restUnits * block.rest_seconds;
  }

  return {
    blocks: day.blocks.filter((b) => b.kind !== 'warmup').length,
    sets,
    reps,
    minutes: Math.max(1, Math.round(seconds / 60)),
    bodyParts: [...muscleCount.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([muscle]) => muscle),
  };
}

/** Sentence-cased muscle list, capped so a card stays a card. */
export function bodyPartLabel(parts: string[], max = 4): string {
  if (parts.length === 0) return '—';
  const shown = parts.slice(0, max).map((p) => p.charAt(0).toUpperCase() + p.slice(1));
  const rest = parts.length - shown.length;
  return rest > 0 ? `${shown.join(' · ')} +${rest}` : shown.join(' · ');
}

/**
 * Planned tonnage: the reps a session asks for at the loads the user last
 * lifted. Exercises with no history contribute nothing rather than a guess, so
 * this number only ever undersells — which is the right way for an estimate
 * shown next to a real one to be wrong.
 */
export function estimateVolumeKg(
  day: PlanDay,
  lastLoadKg: Map<string, number | null>,
  bodyweightKg: number | null,
): number {
  let volume = 0;

  for (const block of day.blocks) {
    if (block.kind === 'warmup') continue;
    for (const item of block.items) {
      if (item.seconds != null) continue;
      const sets = block.kind === 'straight' ? item.sets : block.rounds;
      const exercise = getExercise(item.exercise_id);
      const load = exercise?.is_bodyweight
        ? bodyweightKg
        : (lastLoadKg.get(item.exercise_id) ?? null);
      if (load == null) continue;
      volume += sets * midpoint(item.reps_low, item.reps_high) * load;
    }
  }

  return volume;
}
