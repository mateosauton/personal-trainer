import { useState } from 'react';
import { View } from 'react-native';

import { ExerciseMedia } from '@/components/ExerciseMedia';
import { Body, Button, Muted } from '@/components/ui';
import { useAuth, useUserId } from '@/lib/auth';
import { getProfile } from '@/lib/db/queries';
import { replacePlanExercise } from '@/lib/db/plan-preferences';
import { trainingPreferences } from '@/lib/plan/preferences';
import { compatibleSwaps } from '@/lib/plan/swaps';
import { workouts } from '@/lib/session/workout';
import { space } from '@/lib/theme';
import type { Exercise, PlanItem } from '@/lib/types';

/** Swap before a workout starts so its saved snapshot and logs never change underneath it. */
export function ExerciseSwap({ item, excluded, disabled, onBusy, onSwapped }: {
  item: PlanItem;
  excluded: ReadonlySet<string>;
  disabled: boolean;
  onBusy: (busy: boolean) => void;
  onSwapped: () => Promise<void>;
}) {
  const userId = useUserId();
  const { profile } = useAuth();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alternatives = compatibleSwaps(item, trainingPreferences(profile), excluded).slice(0, 5);

  const swap = async (exercise: Exercise) => {
    if (saving || disabled) return;
    setSaving(true);
    onBusy(true);
    setError(null);
    try {
      if (await workouts.read(userId)) throw new Error('Finish your saved workout before swapping.');
      const current = await getProfile(userId);
      if (!current) throw new Error('Could not read your training preferences.');
      const preferences = trainingPreferences(current);
      if (!compatibleSwaps(item, preferences, excluded).some((candidate) => candidate.id === exercise.id)) {
        throw new Error('This exercise no longer fits your preferences. Reopen the session.');
      }
      await replacePlanExercise(userId, item.id, item.exercise_id, exercise.id, preferences,
        exercise.is_unilateral ? item.seconds != null ? `${item.seconds / 2} seconds per side` : 'Per side' : null);
      await onSwapped();
      setOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not swap this exercise.');
    } finally {
      setSaving(false);
      onBusy(false);
    }
  };

  return (
    <View style={{ gap: space.sm }}>
      <Button title={open ? 'Cancel swap' : 'Swap exercise'} variant="ghost" disabled={disabled || saving}
        onPress={() => setOpen((value) => !value)} />
      {open && alternatives.length === 0 ? <Muted>No compatible alternative fits your equipment, level and limitations. Update your preferences to rebuild the plan.</Muted> : null}
      {open ? alternatives.map((exercise) => <View key={exercise.id} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <ExerciseMedia exercise={exercise} style={{ width: 48, height: 48 }} />
        <View style={{ flex: 1, gap: space.xs }}>
          <Body>{exercise.name}</Body>
          <Button title="Use exercise" variant="surface" disabled={disabled || saving} onPress={() => swap(exercise)} />
        </View>
      </View>) : null}
      {error ? <Body accessibilityRole="alert">{error}</Body> : null}
    </View>
  );
}
