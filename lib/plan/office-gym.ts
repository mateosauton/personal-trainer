import { generatePlan, type GenerateInput } from '@/lib/plan/generate';
import { generateGymRoutine, GYM_EQUIPMENT } from '@/lib/plan/gym-routine';

/**
 * Only movements already authored for the confirmed gym inventory are eligible.
 * This includes the named benches, rack, bars, row and lat-pulldown machines;
 * a broad "machine" or "bodyweight" label alone cannot establish availability.
 * Timed work holds remain in the preset because this generator prescribes reps.
 */
export const OFFICE_GYM_EXERCISE_IDS = new Set(generateGymRoutine().days.flatMap((day) =>
  day.blocks.flatMap((block) => block.items
    .filter((item) => block.kind === 'warmup' || item.seconds == null)
    .map((item) => item.exercise_id)),
));

type OfficeGymInput = Omit<GenerateInput, 'equipment' | 'exerciseIds'> & {
  equipment?: GenerateInput['equipment'];
};

/** Saved equipment restrictions can narrow the confirmed inventory, never expand it. */
export function generateOfficeGymPlan(input: OfficeGymInput) {
  return generatePlan({
    ...input,
    equipment: (input.equipment ?? GYM_EQUIPMENT).filter((item) => GYM_EQUIPMENT.includes(item)),
    exerciseIds: OFFICE_GYM_EXERCISE_IDS,
  });
}
