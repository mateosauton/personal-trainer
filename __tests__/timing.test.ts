import { CATALOG } from '@/lib/catalog';
import type { GeneratedBlock, GeneratedDay, GeneratedItem } from '@/lib/plan/generate';
import { generateGymRoutine } from '@/lib/plan/gym-routine';
import { buildQueue } from '@/lib/session/queue';
import type { PlanDay } from '@/lib/types';
import {
  allocateBlockDurations, estimateSetWorkSeconds, formatClock, withDayTiming,
} from '@/lib/plan/timing';
import {
  pauseDeadline, remainingSeconds, resumeDeadline, startDeadline,
} from '@/lib/session/timing';

const bilateral = CATALOG.find((exercise) => !exercise.is_unilateral)!;
const unilateral = CATALOG.find((exercise) => exercise.is_unilateral)!;
const item = (over: Partial<GeneratedItem> = {}): GeneratedItem => ({
  exercise_id: bilateral.id, sets: 2, reps_low: 8, reps_high: 8,
  seconds: null, tempo: null, notes: null, ...over,
});
const block = (kind: GeneratedBlock['kind'], sets: number, rest: number): GeneratedBlock => ({
  kind, title: kind, rounds: sets, rest_seconds: rest,
  items: Array.from({ length: 4 }, () => item({ sets })),
});
const blocks = (): GeneratedBlock[] => [
  block('warmup', 1, 0), block('circuit', 1, 15), block('straight', 2, 90),
  block('circuit', 2, 45), block('circuit', 1, 15),
];

describe('timed routine allocation', () => {
  it('allocates exactly 47 minutes with a five-minute warmup and six-minute minimum work blocks', () => {
    const durations = allocateBlockDurations(blocks());
    expect(durations.reduce((sum, seconds) => sum + seconds, 0)).toBe(47 * 60);
    expect(durations[0]).toBe(300);
    expect(durations.slice(1).every((seconds) => seconds >= 360)).toBe(true);
    expect(durations[2] + durations[3]).toBeGreaterThan(21 * 60);
    expect(durations[3]).toBeGreaterThanOrEqual(12 * 60);
    expect(durations[2]).toBeGreaterThan(durations[1]);
    expect(durations[3]).toBeGreaterThan(durations[4]);
  });

  it('gives a block more time when its exercise count or reps increase', () => {
    const original = blocks();
    const originalDurations = allocateBlockDurations(original);
    const moreExercises = blocks();
    moreExercises[2].items.push(item());
    const moreReps = blocks();
    moreReps[2].items = moreReps[2].items.map((entry) => ({ ...entry, reps_low: 15, reps_high: 15 }));
    expect(allocateBlockDurations(moreExercises)[2]).toBeGreaterThan(originalDurations[2]);
    expect(allocateBlockDurations(moreReps)[2]).toBeGreaterThan(originalDurations[2]);
  });

  it('keeps IDs and prescriptions intact without mutating the saved plan', () => {
    const original: GeneratedDay & { id: string } = { id: 'day-1', name: 'Push A', focus: 'Push', blocks: blocks() };
    const timed = withDayTiming(original);
    expect(timed.id).toBe('day-1');
    expect(timed.blocks.every((entry) => typeof entry.duration_seconds === 'number')).toBe(true);
    expect(timed.blocks.map((entry) => entry.items)).toEqual(original.blocks.map((entry) => entry.items));
    expect(original.blocks.every((entry) => entry.duration_seconds == null)).toBe(true);
  });

  it('rejects budgets too short for the requested minimums', () => {
    expect(() => allocateBlockDurations(blocks(), 25 * 60)).toThrow(RangeError);
  });

  it('fits every prescribed gym set into its station and varies budgets across the rotation', () => {
    const routine = generateGymRoutine();
    expect(new Set(routine.days.map((day) => day.blocks.map((entry) => entry.duration_seconds).join(','))).size)
      .toBeGreaterThan(1);
    for (const [dayIndex, generated] of routine.days.entries()) {
      const persisted: PlanDay = {
        ...generated, id: `day-${dayIndex}`, day_index: dayIndex,
        blocks: generated.blocks.map((entry, blockIndex) => ({
          ...entry, id: `block-${blockIndex}`, block_index: blockIndex,
          items: entry.items.map((exercise, index) => ({ ...exercise, id: `item-${blockIndex}-${index}`, item_index: index })),
        })),
      };
      const queue = buildQueue(persisted);
      expect(queue.reduce((sum, entry) => sum + (entry.slotSeconds ?? 0), 0)).toBe(47 * 60);
      expect(queue.every((entry) => entry.workSeconds === estimateSetWorkSeconds(entry.item))).toBe(true);
    }
  });
});

describe('set work estimates', () => {
  it('accounts for both sides of a rep prescription', () => {
    expect(estimateSetWorkSeconds(item({ exercise_id: unilateral.id }))).toBe(48);
    expect(estimateSetWorkSeconds(item({ notes: 'Per side' }))).toBe(48);
    expect(estimateSetWorkSeconds(item())).toBe(24);
  });

  it('respects total-rep notes when the catalog marks an alternating exercise unilateral', () => {
    expect(estimateSetWorkSeconds(item({ exercise_id: unilateral.id, notes: '8 total reps, alternating sides.' }))).toBe(24);
  });

  it('treats timed holds as total set duration even when they name both sides', () => {
    expect(estimateSetWorkSeconds(item({ exercise_id: unilateral.id, seconds: 30, notes: '15 seconds per side' }))).toBe(30);
  });

  it('uses prescribed tempo rather than a fixed set length', () => {
    expect(estimateSetWorkSeconds(item({ tempo: '3-1-1-0' }))).toBe(40);
    expect(estimateSetWorkSeconds(item({ tempo: '3010' }))).toBe(32);
  });
});

describe('absolute deadlines', () => {
  it('catches up after background suspension without counting interval ticks', () => {
    const deadline = startDeadline(60, 1_000);
    expect(remainingSeconds(deadline, 46_000)).toBe(15);
    expect(remainingSeconds(deadline, 70_000)).toBe(0);
  });

  it('freezes during pause and shifts the deadline on resume', () => {
    const deadline = startDeadline(60, 1_000);
    const paused = pauseDeadline(deadline, 11_000);
    expect(remainingSeconds(paused, 121_000)).toBe(50);
    const resumed = resumeDeadline(paused, 121_000);
    expect(remainingSeconds(resumed, 131_000)).toBe(40);
    expect(deadline.endAt).toBe(61_000);
  });

  it('makes repeated pause and resume calls harmless', () => {
    const deadline = startDeadline(60, 0);
    const paused = pauseDeadline(deadline, 10_000);
    expect(pauseDeadline(paused, 20_000)).toEqual(paused);
    const resumed = resumeDeadline(paused, 30_000);
    expect(resumeDeadline(resumed, 40_000)).toEqual(resumed);
  });

  it('formats clocks without negative time', () => {
    expect(formatClock(47 * 60)).toBe('47:00');
    expect(formatClock(65)).toBe('1:05');
    expect(formatClock(-3)).toBe('0:00');
  });
});
