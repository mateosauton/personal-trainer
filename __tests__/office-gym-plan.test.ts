import { getExercise } from '@/lib/catalog';
import { generatePlan, type GenerateInput } from '@/lib/plan/generate';
import { generateGymRoutine, GYM_EQUIPMENT } from '@/lib/plan/gym-routine';
import { generateOfficeGymPlan } from '@/lib/plan/office-gym';
import type { Goal, Level } from '@/lib/types';

const routine = generateGymRoutine();
// Timed holds keep their duration in the authored preset. The questionnaire
// generator prescribes reps for work, so its pool excludes those hold slots.
const exerciseIds = new Set(routine.days.flatMap((day) => day.blocks.flatMap((block) =>
  block.items.filter((item) => block.kind === 'warmup' || item.seconds == null)
    .map((item) => item.exercise_id),
)));
const input: GenerateInput = {
  userId: 'office-user', goal: 'hypertrophy', experience: 'intermediate',
  daysPerWeek: 4, sessionMinutes: 45, equipment: GYM_EQUIPMENT, limitations: [],
};

describe('an exact equipment inventory', () => {
  it('keeps every fallback inside the explicitly approved exercise IDs', () => {
    const plan = generatePlan({ ...input, exerciseIds });
    for (const day of plan.days) {
      for (const block of day.blocks) {
        expect(block.items.length).toBeGreaterThan(0);
        for (const item of block.items) {
          expect(getExercise(item.exercise_id)).toBeDefined();
          expect(exerciseIds.has(item.exercise_id)).toBe(true);
        }
      }
    }
  });

  it('keeps a complete office-gym plan within the inventory across goals, levels and seeds', () => {
    for (const userId of ['office-user', 'new-member', 'returning-member']) {
      for (const goal of ['strength', 'hypertrophy', 'fat_loss', 'general'] as Goal[]) {
        for (const experience of ['beginner', 'intermediate', 'advanced'] as Level[]) {
          for (const daysPerWeek of [2, 3, 4, 5, 6]) {
            const plan = generateOfficeGymPlan({
              userId, goal, experience, daysPerWeek,
              sessionMinutes: input.sessionMinutes, limitations: [],
            });
            expect(plan.days).toHaveLength(daysPerWeek);
            for (const day of plan.days) {
              expect(day.blocks).toHaveLength(5);
              for (const block of day.blocks) {
                expect(block.items.length).toBeGreaterThan(0);
                for (const item of block.items) {
                  expect(exerciseIds.has(item.exercise_id)).toBe(true);
                  const exercise = getExercise(item.exercise_id)!;
                  expect(['cable', 'bands']).not.toContain(exercise.equipment);
                  if (exercise.equipment === 'machine') {
                    expect([
                      'Light lat-pulldown machine', 'Lat-pulldown machine',
                      'Light seated row machine', 'Seated row machine',
                    ]).toContain(exercise.name);
                  }
                  if (block.kind !== 'warmup') {
                    expect([
                      'Forearm plank', 'Side plank', 'Farmer carry', 'Suitcase hold',
                      'Long-lever forearm plank', 'Bird dog hold', 'Bent-knee hollow hold',
                    ]).not.toContain(exercise.name);
                    if (exercise.is_unilateral) expect(item.notes).toBe('Per side');
                  }
                  expect(['beginner', 'intermediate', 'advanced'].indexOf(exercise.level))
                    .toBeLessThanOrEqual(['beginner', 'intermediate', 'advanced'].indexOf(experience));
                }
              }
            }
          }
        }
      }
    }
  });

  it('preserves a saved restricted equipment list instead of granting every machine', () => {
    const equipment = ['dumbbell'] as const;
    const plan = generateOfficeGymPlan({ ...input, equipment: [...equipment] });
    const used = plan.days.flatMap((day) => day.blocks.flatMap((block) => block.items))
      .map((item) => getExercise(item.exercise_id)!.equipment);
    expect(new Set(used)).toEqual(new Set(['dumbbell', 'bodyweight']));
    expect(equipment).toEqual(['dumbbell']);
  });

  it('never expands unsupported equipment into unconfirmed kit', () => {
    const plan = generateOfficeGymPlan({ ...input, equipment: ['cable', 'bands'] });
    for (const day of plan.days) {
      expect(day.blocks).toHaveLength(5);
      for (const block of day.blocks) {
        expect(block.items.length).toBeGreaterThan(0);
        for (const item of block.items) {
          expect(getExercise(item.exercise_id)!.equipment).toBe('bodyweight');
        }
      }
    }
  });

  it('keeps declared limitations in force when the approved pool is narrow', () => {
    const plan = generateOfficeGymPlan({
      ...input, equipment: [], limitations: ['shoulders', 'lower back', 'knee', 'neck', 'wrist'],
    });
    for (const day of plan.days) {
      expect(day.blocks).toHaveLength(5);
      for (const block of day.blocks) {
        expect(block.items.length).toBeGreaterThan(0);
        for (const item of block.items) {
          const exercise = getExercise(item.exercise_id)!;
          expect(exerciseIds.has(exercise.id)).toBe(true);
          expect(exercise.equipment).toBe('bodyweight');
          expect(['squat', 'lunge', 'hinge', 'carry', 'v_push', 'delts', 'traps', 'forearms'])
            .not.toContain(exercise.pattern);
          expect(exercise.primary_muscles).not.toEqual(expect.arrayContaining(['shoulders']));
        }
      }
    }
  });
});
