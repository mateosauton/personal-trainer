import { candidates, isPlainLift, type Filter } from '@/lib/catalog';
import { makeRng, shuffle } from './rng';
import { SPLITS, type DayTemplate } from './splits';
import type { Exercise, Goal, Level, Pattern } from '@/lib/types';

/** Rep and set prescription per goal, applied per block. */
const SCHEME: Record<Goal, { b1: Scheme; b2: Scheme; b3: Scheme; b4: Scheme }> = {
  strength: {
    b1: { sets: 5, low: 3, high: 5 },
    b2: { sets: 3, low: 5, high: 8 },
    b3: { sets: 3, low: 8, high: 12 },
    b4: { sets: 2, low: 10, high: 15 },
  },
  hypertrophy: {
    b1: { sets: 4, low: 6, high: 10 },
    b2: { sets: 3, low: 8, high: 12 },
    b3: { sets: 3, low: 10, high: 15 },
    b4: { sets: 3, low: 12, high: 20 },
  },
  fat_loss: {
    b1: { sets: 4, low: 8, high: 12 },
    b2: { sets: 3, low: 10, high: 15 },
    b3: { sets: 3, low: 12, high: 15 },
    b4: { sets: 3, low: 15, high: 20 },
  },
  general: {
    b1: { sets: 4, low: 6, high: 10 },
    b2: { sets: 3, low: 8, high: 12 },
    b3: { sets: 3, low: 10, high: 15 },
    b4: { sets: 2, low: 12, high: 15 },
  },
};

/**
 * What to reach for when a slot's own pattern has no candidates -- the catalog
 * has real holes (no bodyweight horizontal pull at all, no bands core), so a
 * sparsely equipped gym would otherwise drop whole blocks. Ordered by how well
 * the substitute trains the same thing.
 */
const SUBSTITUTES: Record<Pattern, Pattern[]> = {
  squat: ['lunge', 'hinge'],
  hinge: ['squat', 'lunge'],
  lunge: ['squat', 'hinge'],
  h_push: ['v_push', 'triceps', 'delts'],
  v_push: ['h_push', 'delts', 'triceps'],
  h_pull: ['v_pull', 'biceps', 'traps'],
  v_pull: ['h_pull', 'biceps', 'traps'],
  biceps: ['h_pull', 'v_pull', 'forearms'],
  triceps: ['h_push', 'v_push'],
  delts: ['v_push', 'h_push'],
  traps: ['h_pull', 'v_pull'],
  calves: ['lunge', 'squat', 'conditioning'],
  forearms: ['biceps', 'h_pull'],
  core: ['conditioning', 'mobility'],
  conditioning: ['core', 'lunge', 'squat'],
  carry: ['hinge', 'core'],
  mobility: ['core'],
  other: ['core', 'conditioning'],
};

/** Everything a work block may fall back to; mobility is warm-up material. */
const ANY_PATTERN: Pattern[] = [
  'squat', 'hinge', 'lunge', 'h_push', 'v_push', 'h_pull', 'v_pull',
  'core', 'conditioning', 'biceps', 'triceps', 'delts', 'calves', 'traps',
  'forearms', 'carry',
];

interface Scheme {
  sets: number;
  low: number;
  high: number;
}

/** Rest is the biggest lever on session length, so it scales with the budget. */
const REST: Record<number, [number, number, number, number]> = {
  30: [120, 75, 45, 30],
  45: [150, 105, 60, 40],
  60: [180, 120, 75, 45],
};

/** Block 4 rounds shrink first when the session budget is tight. */
const CIRCUIT_ROUNDS: Record<number, number> = { 30: 2, 45: 2, 60: 3 };

export interface GenerateInput {
  userId: string;
  goal: Goal;
  experience: Level;
  daysPerWeek: number;
  sessionMinutes: number;
  equipment: Exercise['equipment'][];
  limitations: string[];
}

export interface GeneratedItem {
  exercise_id: string;
  sets: number;
  reps_low: number;
  reps_high: number;
  seconds: number | null;
  tempo: string | null;
  notes: string | null;
}

export interface GeneratedBlock {
  kind: 'warmup' | 'straight' | 'superset' | 'circuit';
  title: string;
  rounds: number;
  rest_seconds: number;
  items: GeneratedItem[];
}

export interface GeneratedDay {
  name: string;
  focus: string;
  blocks: GeneratedBlock[];
}

export interface GeneratedPlan {
  name: string;
  split: string;
  weeks: number;
  days: GeneratedDay[];
}

/**
 * Picks one exercise for a slot, widening the search until something fits.
 *
 * Exercises already used are skipped so a week stays varied.
 */
function pick(
  patterns: Pattern[],
  base: Omit<Filter, 'patterns'>,
  used: Set<string>,
  rng: () => number,
  prefer?: (e: Exercise) => boolean,
): Exercise | null {
  // Widen in stages, and only as far as needed: the user's own kit first, then
  // bodyweight (which they always have) before giving up on the pattern.
  const equipmentTiers = [
    base.equipment,
    [...new Set([...base.equipment, 'bodyweight' as const])],
  ];
  const patternTiers = [
    patterns,
    [...new Set(patterns.flatMap((p) => SUBSTITUTES[p] ?? []))],
    // Last resort. Declaring both bad knees and a bad lower back empties squat,
    // hinge and lunge together, so a leg day has nothing of its own left to
    // draw on. Training something safe beats handing back a two-block session.
    ANY_PATTERN,
  ];

  for (const patternTier of patternTiers) {
    if (patternTier.length === 0) continue;
    for (const equipment of equipmentTiers) {
      const pool = candidates({ ...base, equipment, patterns: patternTier });
      if (pool.length === 0) continue;

      const fresh = pool.filter((e) => !used.has(e.id));
      // A narrow pool can be exhausted mid-week. Repeating beats an empty
      // block, but only once every wider option has been tried.
      const usable = fresh.length > 0 ? fresh : pool;
      const shortlist = prefer ? usable.filter(prefer) : [];
      const source = shortlist.length > 0 ? shortlist : usable;

      const choice = shuffle(source, rng)[0];
      used.add(choice.id);
      return choice;
    }
  }
  return null;
}

const isCompound = (e: Exercise) => e.mechanic === 'compound';

function warmupBlock(
  template: DayTemplate,
  base: Omit<Filter, 'patterns'>,
  used: Set<string>,
  rng: () => number,
): GeneratedBlock {
  const items: GeneratedItem[] = [];
  // A warm-up must not be loaded work. Restricting equipment to bodyweight and
  // bands is what stops a cable lateral raise being served as "warm-up", and it
  // needs no gym kit, so it holds whatever the office gym has that day.
  const warmBase: Omit<Filter, 'patterns'> = {
    ...base,
    // Bodyweight only. Bands are loaded work -- allowing them served a banded
    // lateral raise as a "warm-up" -- and the user always has their own body,
    // so this holds whatever the gym has that day.
    equipment: ['bodyweight'],
    level: 'beginner' as Level,
    categories: ['stretching', 'cardio', 'strength'],
  };
  for (const pattern of template.warmup) {
    const exercise = pick([pattern], warmBase, used, rng);
    if (!exercise) continue;
    items.push({
      exercise_id: exercise.id,
      sets: 1,
      reps_low: 8,
      reps_high: 12,
      seconds: 40,
      tempo: null,
      notes: 'Easy pace, full range',
    });
  }
  return {
    kind: 'warmup',
    title: 'Warm-up',
    rounds: 1,
    rest_seconds: 20,
    items,
  };
}

function buildDay(
  template: DayTemplate,
  input: GenerateInput,
  used: Set<string>,
  usedWarmup: Set<string>,
  rng: () => number,
): GeneratedDay {
  const base: Omit<Filter, 'patterns'> = {
    // Bodyweight is always available; without it an empty equipment list would
    // yield a plan of nothing but warm-ups.
    equipment: input.equipment.length > 0
      ? input.equipment
      : (['bodyweight'] as GenerateInput['equipment']),
    level: input.experience,
    limitations: input.limitations,
  };

  // Warm-up picks land here too, so today's work cannot repeat a drill the
  // user has just done. The weekly set alone did not catch same-day clashes.
  const usedToday = new Set<string>();
  const scheme = SCHEME[input.goal];
  const rest = REST[input.sessionMinutes] ?? REST[45];
  const warmup = warmupBlock(template, base, usedWarmup, rng);
  for (const item of warmup.items) usedToday.add(item.exercise_id);
  const blocks: GeneratedBlock[] = [warmup];

  // Work slots avoid both the week's picks and today's warm-up.
  const taken = new Set<string>([...used, ...usedToday]);

  const toItem = (e: Exercise, s: Scheme): GeneratedItem => ({
    exercise_id: e.id,
    sets: s.sets,
    reps_low: s.low,
    reps_high: s.high,
    seconds: null,
    tempo: null,
    notes: e.is_unilateral ? 'Per side' : null,
  });

  const b1 = pick(template.b1, base, taken, rng, (e) => isCompound(e) && isPlainLift(e));
  if (b1) {
    blocks.push({
      kind: 'straight',
      title: 'Block 1 · Primary',
      rounds: 1,
      rest_seconds: rest[0],
      items: [toItem(b1, scheme.b1)],
    });
  }

  const b2 = pick(template.b2, base, taken, rng, (e) => isCompound(e) && isPlainLift(e));
  if (b2) {
    blocks.push({
      kind: 'straight',
      title: 'Block 2 · Secondary',
      rounds: 1,
      rest_seconds: rest[1],
      items: [toItem(b2, scheme.b2)],
    });
  }

  const [leftPatterns, rightPatterns] = template.b3;
  const left = pick(leftPatterns, base, taken, rng);
  const right = pick(rightPatterns, base, taken, rng);
  const supersetItems = [left, right]
    .filter((e): e is Exercise => e !== null)
    .map((e) => toItem(e, scheme.b3));
  if (supersetItems.length > 0) {
    blocks.push({
      kind: 'superset',
      title: 'Block 3 · Superset',
      rounds: scheme.b3.sets,
      rest_seconds: rest[2],
      // Rounds carry the set count for supersets; the items run back to back.
      items: supersetItems.map((item) => ({ ...item, sets: 1 })),
    });
  }

  const circuit: GeneratedItem[] = [];
  for (const pattern of template.b4) {
    const exercise = pick([pattern], { ...base, level: input.experience }, taken, rng);
    if (!exercise) continue;
    circuit.push({
      ...toItem(exercise, scheme.b4),
      sets: 1,
      seconds: pattern === 'conditioning' ? 40 : null,
    });
  }
  if (circuit.length > 0) {
    blocks.push({
      kind: 'circuit',
      title: 'Block 4 · Finisher',
      rounds: CIRCUIT_ROUNDS[input.sessionMinutes] ?? 2,
      rest_seconds: rest[3],
      items: circuit,
    });
  }

  // Fold today's work back into the week-long set.
  for (const id of taken) used.add(id);

  return { name: template.name, focus: template.focus, blocks };
}

const GOAL_LABEL: Record<Goal, string> = {
  strength: 'Strength',
  hypertrophy: 'Muscle',
  fat_loss: 'Lean',
  general: 'General',
};

export function generatePlan(input: GenerateInput): GeneratedPlan {
  const config = SPLITS[input.daysPerWeek] ?? SPLITS[3];
  const rng = makeRng(`${input.userId}:${input.goal}:${input.daysPerWeek}`);

  // Dedupe runs across the whole week, not per day, so no work exercise shows
  // up twice in the same training week. Warm-ups track separately: their pool
  // is small by design, and repeating a mobility drill across days is fine --
  // desirable, even, since the point is a familiar routine.
  const used = new Set<string>();
  const usedWarmup = new Set<string>();
  const days = config.days.map((template) =>
    buildDay(template, input, used, usedWarmup, rng),
  );

  return {
    name: `${GOAL_LABEL[input.goal]} · ${config.split}`,
    split: config.split,
    weeks: 4,
    days,
  };
}
