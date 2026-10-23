import type { Equipment, Goal, Level, Profile } from '@/lib/types';
import { GYM_EQUIPMENT } from './gym-routine';

export const TRAINING_GOALS: { value: Goal; label: string }[] = [
  { value: 'strength', label: 'Get stronger' }, { value: 'hypertrophy', label: 'Build muscle' },
  { value: 'fat_loss', label: 'Lean out' }, { value: 'general', label: 'Stay fit' },
];
export const TRAINING_LEVELS: { value: Level; label: string }[] = [
  { value: 'beginner', label: 'New to it' }, { value: 'intermediate', label: 'Comfortable' },
  { value: 'advanced', label: 'Experienced' },
];
export const TRAINING_LIMITATIONS = [
  { value: 'shoulders', label: 'Shoulders' }, { value: 'lower back', label: 'Lower back' },
  { value: 'knee', label: 'Knees' }, { value: 'neck', label: 'Neck' }, { value: 'wrist', label: 'Wrists' },
];
export const OFFICE_EQUIPMENT: { value: Equipment; label: string }[] = [
  { value: 'barbell', label: 'Barbell and rack' }, { value: 'dumbbell', label: 'Dumbbells' },
  { value: 'kettlebell', label: 'Kettlebells' }, { value: 'machine', label: 'Row and pulldown machines' },
  { value: 'other', label: 'Plates and other confirmed kit' },
];
export interface TrainingPreferences {
  goal: Goal;
  experience: Level;
  days_per_week: number;
  session_minutes: number;
  equipment: Equipment[];
  limitations: string[];
}
export function trainingPreferences(profile: Partial<Profile> | null): TrainingPreferences {
  return {
    goal: profile?.goal ?? 'hypertrophy', experience: profile?.experience ?? 'intermediate',
    days_per_week: profile?.days_per_week ?? 4, session_minutes: profile?.session_minutes ?? 45,
    equipment: profile?.equipment?.filter((item) => GYM_EQUIPMENT.includes(item)) ?? [...GYM_EQUIPMENT],
    limitations: [...(profile?.limitations ?? [])],
  };
}
