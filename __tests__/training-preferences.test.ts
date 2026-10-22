import { candidates, getExercise } from '@/lib/catalog';
import { gymExerciseId } from '@/lib/data/gym-routine-exercises';
import { generateGymRoutine, GYM_EQUIPMENT } from '@/lib/plan/gym-routine';
import { trainingPreferences } from '@/lib/plan/preferences';
import { compatibleSwaps, generateSafeGymRoutine } from '@/lib/plan/swaps';

const preferences = { equipment: GYM_EQUIPMENT, experience: 'advanced' as const, limitations: [] as string[] };

it('retains restricted and empty equipment preferences', () => {
  expect(trainingPreferences({ equipment: [] }).equipment).toEqual([]);
  expect(trainingPreferences({ equipment: ['cable', 'dumbbell'] }).equipment).toEqual(['dumbbell']);
});

it('only swaps compatible movements using confirmed equipment and allowed limitations', () => {
  const item = { exercise_id: gymExerciseId('Barbell bench press'), seconds: null };
  const options = compatibleSwaps(item, { ...preferences, equipment: ['dumbbell'] });
  expect(options.length).toBeGreaterThan(0);
  for (const option of options) {
    expect(option.pattern).toBe('h_push');
    expect(['bodyweight', 'dumbbell']).toContain(option.equipment);
    expect(option.is_unilateral).toBe(false);
  }
  expect(compatibleSwaps(item, { ...preferences, limitations: ['shoulders'] })).toEqual([]);
});

it('never prescribes repetitions for a timed hold or offers a same-day duplicate', () => {
  const item = { exercise_id: gymExerciseId('Forearm plank'), seconds: 30 };
  const options = compatibleSwaps(item, preferences);
  const timed = new Set(generateGymRoutine().days.flatMap((day) => day.blocks.flatMap((block) =>
    block.items.filter((entry) => entry.seconds != null).map((entry) => entry.exercise_id))));
  expect(options.length).toBeGreaterThan(0);
  for (const option of options) expect(timed.has(option.id)).toBe(true);
  expect(compatibleSwaps(item, preferences, new Set(options.map((option) => option.id)))).toEqual([]);
});

it('enforces equipment, level and limitations across every fixed PPL block', () => {
  const constrained = { equipment: GYM_EQUIPMENT, experience: 'advanced' as const, limitations: ['neck'] };
  const plan = generateSafeGymRoutine({ ...constrained, equipment: [...constrained.equipment] });
  expect(plan.days).toHaveLength(6);
  for (const day of plan.days) {
    expect(day.blocks.some((block) => block.kind !== 'warmup')).toBe(true);
    for (const block of day.blocks) for (const item of block.items) {
      const exercise = getExercise(item.exercise_id)!;
      expect(candidates({ exerciseIds: new Set([exercise.id]), patterns: [exercise.pattern],
        level: constrained.experience, equipment: [...constrained.equipment], limitations: constrained.limitations }))
        .toEqual([exercise]);
    }
  }
});

it('refuses a fixed PPL routine when restrictions leave a whole block without a compatible exercise', () => {
  expect(() => generateSafeGymRoutine({ equipment: ['bodyweight'], experience: 'beginner', limitations: ['knee', 'lower back', 'shoulders'] }))
    .toThrow('No compatible PPL');
});
