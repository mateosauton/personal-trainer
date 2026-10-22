/** Display-unit draft; reps stay zero when a duration is recorded. */
export interface WorkoutDraft {
  reps: number;
  seconds?: number | null;
  weight: number;
  asBodyweight: boolean;
}
export const validSeconds = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 86400;
export const validDraft = (value: unknown): value is WorkoutDraft => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const draft = value as WorkoutDraft;
  return Number.isInteger(draft.reps) && draft.reps >= 0 && draft.reps <= 1000
    && (draft.seconds == null || (validSeconds(draft.seconds) && draft.reps === 0))
    && typeof draft.weight === 'number' && Number.isFinite(draft.weight) && draft.weight >= 0
    && typeof draft.asBodyweight === 'boolean';
};
export const draftMeasurement = (draft: WorkoutDraft) => draft.seconds != null
  ? { reps: null, seconds: draft.seconds } : { reps: draft.reps };
export const measurementLabel = (value: { reps: number | null; seconds?: number | null }) =>
  value.seconds != null ? `${value.seconds}s` : `${value.reps ?? 'No'} reps`;
