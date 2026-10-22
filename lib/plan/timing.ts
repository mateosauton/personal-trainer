import { getExercise } from '@/lib/catalog';
import type { BlockKind, PlanItem } from '@/lib/types';

type TimingItem = Pick<PlanItem,
  'exercise_id' | 'sets' | 'reps_low' | 'reps_high' | 'seconds' | 'tempo' | 'notes'>;

interface TimingBlock {
  kind: BlockKind;
  rounds: number;
  rest_seconds: number;
  duration_seconds?: number | null;
  items: TimingItem[];
}

/** Rep counts for unilateral work are per side; timed holds store total seconds. */
export function isPerSide(item: TimingItem): boolean {
  if (/\btotal\b/i.test(item.notes ?? '')) return false;
  return Boolean(getExercise(item.exercise_id)?.is_unilateral)
    || /(?:per|each)\s+(?:side|leg|arm)|\/side/i.test(item.notes ?? '');
}

function secondsPerRep(tempo: string | null): number {
  if (!tempo) return 3;
  const compact = tempo.replace(/\s/g, '');
  const phases = compact.includes('-') ? compact.split('-') : compact.split('');
  if (phases.length < 3 || phases.length > 4 || phases.some((phase) => !/^(\d+|x)$/i.test(phase))) return 3;
  return Math.max(1, phases.reduce((sum, phase) => sum + (/x/i.test(phase) ? 1 : Number(phase)), 0));
}

export function estimateSetWorkSeconds(item: TimingItem): number {
  if (item.seconds != null) return Math.max(1, item.seconds);
  const reps = Math.max(1, Math.round((item.reps_low + item.reps_high) / 2));
  return reps * secondsPerRep(item.tempo) * (isPerSide(item) ? 2 : 1);
}

export function getBlockDurationSeconds(block: Pick<TimingBlock, 'duration_seconds'>): number | null {
  const duration = block.duration_seconds;
  return duration != null && Number.isFinite(duration) && duration > 0 ? Math.round(duration) : null;
}

/** Allocate integer seconds without losing time to rounding. */
export function proportionalSeconds(total: number, weights: number[]): number[] {
  if (weights.length === 0) return [];
  const sum = weights.reduce((value, weight) => value + Math.max(0, weight), 0);
  const shares = weights.map((weight) => total * (sum > 0 ? Math.max(0, weight) / sum : 1 / weights.length));
  const allocated = shares.map(Math.floor);
  const order = shares.map((share, index) => ({ index, remainder: share - allocated[index] }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  const remaining = total - allocated.reduce((value, seconds) => value + seconds, 0);
  for (let index = 0; index < remaining; index += 1) allocated[order[index % order.length].index] += 1;
  return allocated;
}

function blockWorkloadSeconds(block: TimingBlock): number {
  const sets = block.items.reduce((sum, item) => sum + (block.kind === 'straight' ? item.sets : block.rounds), 0);
  const work = block.items.reduce((sum, item) => sum
    + estimateSetWorkSeconds(item) * (block.kind === 'straight' ? item.sets : block.rounds), 0);
  const recovery = block.kind === 'straight'
    ? sets * block.rest_seconds
    : block.rounds * (block.rest_seconds + Math.max(0, block.items.length - 1) * 10);
  return Math.max(1, work + recovery);
}

/** Five-minute warmup, four work blocks of at least six minutes, 47 minutes total. */
export function allocateBlockDurations(blocks: TimingBlock[], totalSeconds = 47 * 60): number[] {
  const work = blocks.filter((block) => block.kind !== 'warmup');
  const warmupCount = blocks.length - work.length;
  if (warmupCount !== 1 || work.length !== 4) {
    throw new RangeError('Timed sessions need one warmup and four work blocks.');
  }
  const minimum = 6 * 60;
  const extra = Math.round(totalSeconds) - 5 * 60 - work.length * minimum;
  if (!Number.isFinite(extra) || extra < 0) throw new RangeError('Session budget is shorter than the block minimums.');
  // Keep most training time in strength and advanced full-body work. Reps,
  // exercise count, sets, tempo and recovery still determine the daily split.
  const priorities = [0.15, 1, 2, 0.15];
  const additions = proportionalSeconds(extra, work.map((block, index) => blockWorkloadSeconds(block) * priorities[index]));
  let ordinal = 0;
  return blocks.map((block) => block.kind === 'warmup' ? 5 * 60 : minimum + additions[ordinal++]);
}

/** Applies equally before saving a generated day and after loading its database IDs. */
export function withDayTiming<T extends { blocks: TimingBlock[] }>(day: T): T {
  const durations = allocateBlockDurations(day.blocks);
  return {
    ...day,
    blocks: day.blocks.map((block, index) => ({ ...block, duration_seconds: durations[index] })),
  };
}

export function formatClock(seconds: number): string {
  const whole = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}
