import type { Pattern } from '@/lib/types';

/**
 * A day template names the movement patterns each of the four work blocks may
 * draw from. Block 1 and 2 are straight sets on compounds, block 3 is an
 * antagonist accessory superset, block 4 a core + conditioning circuit.
 */
export interface DayTemplate {
  name: string;
  focus: string;
  /** Primary compound. */
  b1: Pattern[];
  /** Secondary compound. */
  b2: Pattern[];
  /** Superset pair -- one exercise drawn from each list. */
  b3: [Pattern[], Pattern[]];
  /** Circuit: core plus conditioning. */
  b4: Pattern[];
  /** Warm-up patterns, matched to the day's work. */
  warmup: Pattern[];
}

const FULL_A: DayTemplate = {
  name: 'Full Body A',
  focus: 'Squat + Push',
  b1: ['squat'],
  b2: ['h_push'],
  b3: [['h_pull'], ['delts', 'triceps']],
  b4: ['core', 'conditioning'],
  warmup: ['mobility', 'core'],
};

const FULL_B: DayTemplate = {
  name: 'Full Body B',
  focus: 'Hinge + Pull',
  b1: ['hinge'],
  b2: ['v_pull', 'h_pull'],
  b3: [['lunge', 'squat'], ['biceps', 'core']],
  b4: ['core', 'conditioning'],
  warmup: ['mobility', 'core'],
};

const FULL_C: DayTemplate = {
  name: 'Full Body C',
  focus: 'Press + Lunge',
  b1: ['v_push'],
  b2: ['lunge', 'squat'],
  b3: [['h_pull', 'v_pull'], ['delts', 'calves']],
  b4: ['core', 'conditioning'],
  warmup: ['mobility', 'delts'],
};

const UPPER_A: DayTemplate = {
  name: 'Upper A',
  focus: 'Horizontal',
  b1: ['h_push'],
  b2: ['h_pull'],
  b3: [['v_push', 'delts'], ['biceps', 'triceps']],
  b4: ['core', 'conditioning'],
  warmup: ['mobility', 'delts'],
};

const UPPER_B: DayTemplate = {
  name: 'Upper B',
  focus: 'Vertical',
  b1: ['v_pull'],
  b2: ['v_push'],
  b3: [['h_push', 'h_pull'], ['triceps', 'biceps']],
  b4: ['core', 'conditioning'],
  warmup: ['mobility', 'traps'],
};

const LOWER_A: DayTemplate = {
  name: 'Lower A',
  focus: 'Squat',
  b1: ['squat'],
  b2: ['hinge'],
  b3: [['lunge'], ['calves', 'core']],
  b4: ['core', 'conditioning'],
  warmup: ['mobility', 'squat'],
};

const LOWER_B: DayTemplate = {
  name: 'Lower B',
  focus: 'Hinge',
  b1: ['hinge'],
  b2: ['lunge', 'squat'],
  b3: [['squat'], ['calves', 'core']],
  b4: ['core', 'conditioning'],
  warmup: ['mobility', 'hinge'],
};

const PUSH: DayTemplate = {
  name: 'Push',
  focus: 'Chest + Shoulders',
  b1: ['h_push'],
  b2: ['v_push'],
  b3: [['delts'], ['triceps']],
  b4: ['core', 'conditioning'],
  warmup: ['mobility', 'delts'],
};

const PULL: DayTemplate = {
  name: 'Pull',
  focus: 'Back + Biceps',
  b1: ['v_pull'],
  b2: ['h_pull'],
  b3: [['traps', 'delts'], ['biceps']],
  b4: ['core', 'conditioning'],
  warmup: ['mobility', 'traps'],
};

const LEGS: DayTemplate = {
  name: 'Legs',
  focus: 'Quads + Hamstrings',
  b1: ['squat'],
  b2: ['hinge'],
  b3: [['lunge'], ['calves']],
  b4: ['core', 'conditioning'],
  warmup: ['mobility', 'squat'],
};

/**
 * Weekly split by training frequency. Two and three days go full-body so every
 * pattern is hit often enough to progress; four splits upper/lower; five adds
 * a push/pull/legs front half.
 */
export const SPLITS: Record<number, { split: string; days: DayTemplate[] }> = {
  2: { split: 'Full Body', days: [FULL_A, FULL_B] },
  3: { split: 'Full Body', days: [FULL_A, FULL_B, FULL_C] },
  4: { split: 'Upper / Lower', days: [UPPER_A, LOWER_A, UPPER_B, LOWER_B] },
  5: { split: 'PPL + Upper/Lower', days: [PUSH, PULL, LEGS, UPPER_A, LOWER_A] },
  6: { split: 'Push / Pull / Legs', days: [PUSH, PULL, LEGS, PUSH, PULL, LEGS] },
};
