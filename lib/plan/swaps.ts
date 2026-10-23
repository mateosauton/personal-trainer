import { candidates, getExercise } from '@/lib/catalog';
import type { GeneratedPlan } from './generate';
import { generateGymRoutine, GYM_EQUIPMENT } from './gym-routine';
import { withDayTiming } from './timing';
import type { Equipment, Level, PlanItem } from '@/lib/types';

const routine = generateGymRoutine();
const authoredItems = routine.days.flatMap((day) => day.blocks.flatMap((block) => block.items));
const ids = new Set(authoredItems.map((item) => item.exercise_id));
const timedIds = new Set(authoredItems.filter((item) => item.seconds != null).map((item) => item.exercise_id));
const repIds = new Set(authoredItems.filter((item) => item.seconds == null).map((item) => item.exercise_id));
export interface ExerciseConstraints { equipment: Equipment[]; experience: Level; limitations: string[] }

/** Preserve movement pattern, per-side convention and duration/reps prescription. */
export function compatibleSwaps(
  item: Pick<PlanItem, 'exercise_id' | 'seconds'>,
  preferences: ExerciseConstraints,
  excluded: ReadonlySet<string> = new Set(),
) {
  const original = getExercise(item.exercise_id);
  if (!original) return [];
  const mode = item.seconds == null ? repIds : timedIds;
  return candidates({
    exerciseIds: ids, patterns: [original.pattern],
    equipment: [...new Set<Equipment>([...preferences.equipment.filter((e) => GYM_EQUIPMENT.includes(e)), 'bodyweight'])],
    level: preferences.experience, limitations: preferences.limitations,
  }).filter((exercise) => exercise.id !== original.id && !excluded.has(exercise.id)
    && mode.has(exercise.id) && exercise.is_unilateral === original.is_unilateral)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Apply the same constraints to the authored preset; never silently grant kit. */
export function generateSafeGymRoutine(preferences: ExerciseConstraints): GeneratedPlan {
  const allowed = new Set(candidates({
    exerciseIds: ids,
    patterns: [...new Set(authoredItems.map((item) => getExercise(item.exercise_id)!.pattern))],
    equipment: [...new Set<Equipment>([...preferences.equipment.filter((e) => GYM_EQUIPMENT.includes(e)), 'bodyweight'])],
    level: preferences.experience, limitations: preferences.limitations,
  }).map((exercise) => exercise.id));
  const plan = generateGymRoutine();
  plan.days = plan.days.map((day) => {
    const blocks = day.blocks.map((block) => ({
      ...block, items: block.items.flatMap((item) => {
        if (allowed.has(item.exercise_id)) return [item];
        const alternative = compatibleSwaps(item, preferences)[0];
        if (!alternative) return [];
        return [{ ...item, exercise_id: alternative.id, notes: alternative.is_unilateral ? 'Per side' : null }];
      }),
    }));
    if (blocks.some((block) => block.items.length === 0)) {
      throw new Error('No compatible PPL exercises fit these preferences. Build a plan from Profile instead.');
    }
    return withDayTiming({ ...day, blocks });
  });
  return plan;
}
