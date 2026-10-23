import { useRef, useState } from 'react';

import { Body, Button, Card, Heading, Muted, Overline } from '@/components/ui';
import { savePlan } from '@/lib/db/queries';
import { generateSafeGymRoutine } from '@/lib/plan/swaps';
import { trainingPreferences } from '@/lib/plan/preferences';
import { useAuth } from '@/lib/auth';
import { confirm } from '@/lib/alerts';
import { workouts } from '@/lib/session/workout';
import { space } from '@/lib/theme';

export function GymRoutineCard({ userId, onActivated }: {
  userId: string;
  onActivated: () => void;
}) {
  const { profile } = useAuth();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const activate = async () => {
    if (inFlight.current) return;
    if (!await confirm({ title: 'Use the PPL rotation?', message: 'Your equipment, experience and limitations apply. Your logged sessions and weights stay.', confirmLabel: 'Use rotation' })) return;
    inFlight.current = true;
    setSaving(true);
    setError(null);
    try {
      if (await workouts.read(userId)) throw new Error('Finish your saved workout before switching plans.');
      await savePlan(userId, generateSafeGymRoutine(trainingPreferences(profile)));
      onActivated();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the routine. Try again.');
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  };

  return (
    <Card style={{ marginTop: space.xl, gap: space.md }}>
      <Overline>Gym routine</Overline>
      <Heading>Push · Pull · Legs</Heading>
      <Body>Six sessions in rotation. A 47-minute target with four timed blocks.</Body>
      <Muted>
        Every work block gets at least 6 minutes. Time adjusts to the exercises and reps,
        with most of it reserved for strength and advanced full-body work.
      </Muted>
      <Muted>
        Uses your barbell, dumbbells, plates, kettlebells, benches, row and pull machines,
        pull-up bar, squat rack and parallel bars.
      </Muted>
      <Muted>Your saved equipment, experience and limitations apply. Unavailable movements are replaced or omitted. Your logged sessions and weights stay.</Muted>
      {error ? <Body accessibilityRole="alert">{error}</Body> : null}
      <Button title="Use 47 min PPL routine" loading={saving} onPress={activate} />
    </Card>
  );
}
