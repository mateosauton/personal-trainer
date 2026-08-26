import { generatePlan, type GenerateInput } from '@/lib/plan/generate';
import { getExercise } from '@/lib/catalog';
import type { Equipment, Goal, Level } from '@/lib/types';

const GYM: Equipment[] = [
  'barbell', 'dumbbell', 'cable', 'machine', 'kettlebell', 'bands', 'bodyweight',
];

const base: GenerateInput = {
  userId: 'user-1',
  goal: 'hypertrophy',
  experience: 'intermediate',
  daysPerWeek: 4,
  sessionMinutes: 45,
  equipment: GYM,
  limitations: [],
};

const GOALS: Goal[] = ['strength', 'hypertrophy', 'fat_loss', 'general'];
const LEVELS: Level[] = ['beginner', 'intermediate', 'advanced'];
const DAYS = [2, 3, 4, 5, 6];
const MINUTES = [30, 45, 60];

describe('generatePlan', () => {
  it('gives every day a warm-up plus exactly four work blocks', () => {
    for (const goal of GOALS) {
      for (const days of DAYS) {
        for (const sessionMinutes of MINUTES) {
          const plan = generatePlan({ ...base, goal, daysPerWeek: days, sessionMinutes });
          expect(plan.days).toHaveLength(days);
          for (const day of plan.days) {
            const warmups = day.blocks.filter((b) => b.kind === 'warmup');
            const work = day.blocks.filter((b) => b.kind !== 'warmup');
            expect(warmups).toHaveLength(1);
            expect(work).toHaveLength(4);
            expect(warmups[0].items.length).toBeGreaterThan(0);
            for (const block of work) expect(block.items.length).toBeGreaterThan(0);
          }
        }
      }
    }
  });

  it('never prescribes equipment the user does not have', () => {
    const plan = generatePlan({ ...base, equipment: ['dumbbell', 'bodyweight'] });
    const seen = new Set<string>();
    for (const day of plan.days) {
      for (const block of day.blocks) {
        for (const item of block.items) {
          const exercise = getExercise(item.exercise_id);
          expect(exercise).toBeDefined();
          seen.add(exercise!.equipment);
        }
      }
    }
    expect([...seen].sort()).toEqual(['bodyweight', 'dumbbell']);
  });

  it('does not repeat a work exercise within a training week', () => {
    for (const days of DAYS) {
      const plan = generatePlan({ ...base, daysPerWeek: days });
      const ids = plan.days.flatMap((d) =>
        d.blocks.filter((b) => b.kind !== 'warmup').flatMap((b) => b.items.map((i) => i.exercise_id)),
      );
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('keeps warm-ups unloaded -- bodyweight or bands only', () => {
    const plan = generatePlan(base);
    for (const day of plan.days) {
      const warmup = day.blocks.find((b) => b.kind === 'warmup')!;
      for (const item of warmup.items) {
        expect(['bodyweight', 'bands']).toContain(getExercise(item.exercise_id)!.equipment);
      }
    }
  });

  it('keeps specialist lifts out of a non-advanced plan', () => {
    const plan = generatePlan({ ...base, experience: 'intermediate' });
    for (const day of plan.days) {
      for (const block of day.blocks) {
        for (const item of block.items) {
          expect(['strongman', 'olympic weightlifting']).not.toContain(
            getExercise(item.exercise_id)!.category,
          );
        }
      }
    }
  });

  it('respects declared limitations', () => {
    const plan = generatePlan({ ...base, limitations: ['shoulders', 'knee'] });
    for (const day of plan.days) {
      for (const block of day.blocks) {
        for (const item of block.items) {
          const e = getExercise(item.exercise_id)!;
          const haystack = `${e.name} ${e.primary_muscles.join(' ')} ${e.body_part}`.toLowerCase();
          expect(haystack).not.toContain('shoulders');
          expect(haystack).not.toContain('knee');
        }
      }
    }
  });

  it('never exceeds the user experience level', () => {
    const rank = { beginner: 0, intermediate: 1, advanced: 2 };
    for (const experience of LEVELS) {
      const plan = generatePlan({ ...base, experience });
      for (const day of plan.days) {
        // Warm-ups are deliberately pinned to beginner, so they pass trivially.
        for (const block of day.blocks) {
          for (const item of block.items) {
            const e = getExercise(item.exercise_id)!;
            expect(rank[e.level]).toBeLessThanOrEqual(rank[experience]);
          }
        }
      }
    }
  });

  it('is deterministic for the same user and answers', () => {
    const a = generatePlan(base);
    const b = generatePlan(base);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('gives different users different plans', () => {
    const a = generatePlan(base);
    const b = generatePlan({ ...base, userId: 'user-2' });
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });

  it('shortens rest and trims the finisher for a 30 minute session', () => {
    const short = generatePlan({ ...base, sessionMinutes: 30 });
    const long = generatePlan({ ...base, sessionMinutes: 60 });
    const primary = (p: typeof short) => p.days[0].blocks.find((b) => b.title.includes('Block 1'))!;
    const finisher = (p: typeof short) => p.days[0].blocks.find((b) => b.kind === 'circuit')!;
    expect(primary(short).rest_seconds).toBeLessThan(primary(long).rest_seconds);
    expect(finisher(short).rounds).toBeLessThan(finisher(long).rounds);
  });

  it('favours exercises that have real animations', () => {
    const plan = generatePlan(base);
    const ids = plan.days.flatMap((d) => d.blocks.flatMap((b) => b.items.map((i) => i.exercise_id)));
    const animated = ids.filter((id) => getExercise(id)?.media_kind === 'animated');
    expect(animated.length).toBeGreaterThan(0);
  });
});
