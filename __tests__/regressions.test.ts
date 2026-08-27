/**
 * Each test here pins a bug found during a full test pass on the working app.
 * They are grouped by the defect they prevent coming back.
 */
import { CATALOG, candidates, getExercise } from '@/lib/catalog';
import { generatePlan, type GenerateInput } from '@/lib/plan/generate';
import { nextLoad } from '@/lib/progression';
import { estimateOneRepMax } from '@/lib/units';
import type { Equipment } from '@/lib/types';

const ALL: Equipment[] = [
  'barbell', 'dumbbell', 'cable', 'machine', 'kettlebell', 'bands', 'bodyweight',
];
const base: GenerateInput = {
  userId: 'user-1', goal: 'general', experience: 'intermediate',
  daysPerWeek: 5, sessionMinutes: 45, equipment: ALL, limitations: [],
};

const workBlocks = (p: ReturnType<typeof generatePlan>) =>
  p.days.map((d) => d.blocks.filter((b) => b.kind !== 'warmup').length);

describe('a sparse gym still gets a whole plan', () => {
  // The catalog has real holes -- no bodyweight horizontal pull, no bands core --
  // and blocks used to be dropped silently when a slot found no candidates.
  const sparse: Equipment[][] = [
    ['bodyweight'], ['bands'], ['dumbbell'], ['machine'], ['kettlebell'],
    ['bodyweight', 'bands'], ALL,
  ];

  it.each(sparse)('gives four work blocks with %s', (...equipment) => {
    for (const daysPerWeek of [2, 3, 4, 5, 6]) {
      const plan = generatePlan({ ...base, equipment: equipment as Equipment[], daysPerWeek });
      expect(workBlocks(plan)).toEqual(Array(daysPerWeek).fill(4));
      for (const day of plan.days) {
        for (const block of day.blocks) expect(block.items.length).toBeGreaterThan(0);
      }
    }
  });

  it('falls back to bodyweight rather than emitting an empty plan', () => {
    const plan = generatePlan({ ...base, equipment: [], daysPerWeek: 4 });
    expect(workBlocks(plan)).toEqual([4, 4, 4, 4]);
  });

  it('still gives four blocks with every limitation declared', () => {
    const plan = generatePlan({
      ...base,
      limitations: ['shoulders', 'lower back', 'knee', 'neck', 'wrist'],
      daysPerWeek: 4,
    });
    expect(workBlocks(plan)).toEqual([4, 4, 4, 4]);
  });
});

describe('no exercise appears twice in one day', () => {
  it.each([2, 3, 4, 5, 6])('holds for a %s day split', (daysPerWeek) => {
    for (const equipment of [ALL, ['bodyweight'] as Equipment[], ['dumbbell'] as Equipment[]]) {
      const plan = generatePlan({ ...base, equipment, daysPerWeek });
      for (const day of plan.days) {
        // Warm-up included: a drill used to be repeated as work later the same day.
        const ids = day.blocks.flatMap((b) => b.items.map((i) => i.exercise_id));
        expect(new Set(ids).size).toBe(ids.length);
      }
    }
  });
});

describe('limitations rule out the movements that actually load the joint', () => {
  it('drops squats and lunges for bad knees, not just drills named "knee"', () => {
    const plan = generatePlan({ ...base, limitations: ['knee'], daysPerWeek: 4 });
    const patterns = plan.days
      .flatMap((d) => d.blocks.flatMap((b) => b.items))
      .map((i) => getExercise(i.exercise_id)!.pattern);
    expect(patterns).not.toContain('squat');
    expect(patterns).not.toContain('lunge');
  });

  it('drops overhead pressing for bad shoulders', () => {
    const pool = candidates({
      equipment: ALL, level: 'advanced', patterns: ['v_push', 'delts'], limitations: ['shoulders'],
    });
    expect(pool).toHaveLength(0);
  });

  it('drops hinging for a bad lower back', () => {
    const pool = candidates({
      equipment: ALL, level: 'advanced', patterns: ['hinge'], limitations: ['lower back'],
    });
    expect(pool).toHaveLength(0);
  });
});

describe('warm-ups are unloaded', () => {
  it('uses bodyweight only -- never bands, which are loaded work', () => {
    for (const daysPerWeek of [2, 3, 4, 5, 6]) {
      const plan = generatePlan({ ...base, daysPerWeek });
      for (const day of plan.days) {
        const warmup = day.blocks.find((b) => b.kind === 'warmup')!;
        expect(warmup.items.length).toBeGreaterThan(0);
        for (const item of warmup.items) {
          expect(getExercise(item.exercise_id)!.equipment).toBe('bodyweight');
        }
      }
    }
  });
});

describe('deload never raises or zeroes the load', () => {
  const missTwice = (kg: number, units: 'kg' | 'lb' = 'kg') =>
    nextLoad([{ reps: 2, rpe: 9 }], 10, 6, 'h_push', kg, { last_weight_kg: kg, miss_streak: 1 }, units);

  it.each([0.5, 1, 1.5, 2, 5, 20, 60, 100])('deloads %s kg downward and above zero', (kg) => {
    const result = missTwice(kg);
    expect(result.verdict).toBe('deload');
    expect(result.last_weight_kg!).toBeGreaterThan(0);
    expect(result.last_weight_kg!).toBeLessThanOrEqual(kg);
  });

  it('does nothing at all for a zero load, as on an unweighted push-up', () => {
    const topped = nextLoad([{ reps: 12, rpe: 7 }], 10, 6, 'h_push', 0, { last_weight_kg: 0, miss_streak: 0 });
    expect(topped.verdict).toBeNull();
    expect(topped.last_weight_kg).toBe(0);
  });
});

describe('progression lands on plates the gym actually has', () => {
  const asLb = (kg: number) => kg * 2.2046226218;

  it('steps an lb user in whole 5 and 10 lb jumps', () => {
    let kg = 61.234;
    for (let i = 0; i < 4; i += 1) {
      kg = nextLoad([{ reps: 12, rpe: 7 }], 10, 6, 'h_push', kg,
        { last_weight_kg: kg, miss_streak: 0 }, 'lb').last_weight_kg!;
    }
    // Four upper-body sessions at 5 lb each.
    expect(asLb(kg) - asLb(61.234)).toBeCloseTo(20, 6);
  });

  it('keeps kg users on 2.5 and 5 kg jumps', () => {
    const upper = nextLoad([{ reps: 12, rpe: 7 }], 10, 6, 'h_push', 60, { last_weight_kg: 60, miss_streak: 0 });
    const lower = nextLoad([{ reps: 12, rpe: 7 }], 10, 6, 'squat', 100, { last_weight_kg: 100, miss_streak: 0 });
    expect(upper.last_weight_kg).toBeCloseTo(62.5, 6);
    expect(lower.last_weight_kg).toBeCloseTo(105, 6);
  });

  it('deloads an lb user onto a round lb number', () => {
    const r = nextLoad([{ reps: 2, rpe: 9 }], 10, 6, 'squat', 102.058,
      { last_weight_kg: 102.058, miss_streak: 1 }, 'lb');
    expect(asLb(r.last_weight_kg!) % 5).toBeCloseTo(0, 6);
  });
});

describe('one rep max estimates refuse nonsense input', () => {
  it('treats a failed set as no max rather than a single', () => {
    expect(estimateOneRepMax(100, 0)).toBe(0);
    expect(estimateOneRepMax(100, -3)).toBe(0);
    expect(estimateOneRepMax(0, 5)).toBe(0);
  });

  it('still estimates normally in range', () => {
    expect(estimateOneRepMax(100, 1)).toBe(100);
    expect(estimateOneRepMax(100, 5)).toBeCloseTo(116.67, 1);
  });
});

describe('catalog is reachable and well formed', () => {
  it('offers every equipment token the catalog uses', () => {
    // 'other' existed in the data but was absent from onboarding, stranding
    // 239 exercises including most mobility work.
    const offered: Equipment[] = [...ALL, 'other'];
    const used = new Set(CATALOG.map((e) => e.equipment));
    for (const token of used) expect(offered).toContain(token);
  });

  it('points every exercise at two https stills', () => {
    for (const e of CATALOG) {
      expect(e.media_refs.start).toMatch(/^https:\/\//);
      expect(e.media_refs.end).toMatch(/^https:\/\//);
    }
  });
});
