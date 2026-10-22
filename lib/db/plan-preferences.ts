import { clientForAccessToken, supabase } from './supabase';
import type { GeneratedPlan } from '@/lib/plan/generate';
import type { TrainingPreferences } from '@/lib/plan/preferences';

/** Freeze the matching owner's token before a plan mutation can resolve auth again. */
export async function planWriteClient(ownerId: string) {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (data.session?.user.id !== ownerId) throw new Error('Account changed. Please retry from your profile.');
  return clientForAccessToken(data.session.access_token);
}

/** Preferences and their matching plan commit together; history stays attached to the retired plan. */
export async function saveTrainingPlan(ownerId: string, preferences: TrainingPreferences, plan: GeneratedPlan): Promise<string> {
  const client = await planWriteClient(ownerId);
  const { data, error } = await client.rpc('save_training_plan', { preferences, plan });
  if (error) throw error;
  return data as string;
}

/** Compare-and-set protects another device's edit and refuses changes during an active workout. */
export async function replacePlanExercise(ownerId: string, itemId: string, expectedExerciseId: string, exerciseId: string, preferences: TrainingPreferences, notes: string | null) {
  const client = await planWriteClient(ownerId);
  const { error } = await client.rpc('replace_plan_exercise', {
    p_item_id: itemId, p_expected_exercise_id: expectedExerciseId, p_exercise_id: exerciseId,
    p_preferences: preferences, p_notes: notes,
  });
  if (error) throw error;
}
