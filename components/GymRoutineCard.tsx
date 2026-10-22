import { useRef, useState } from 'react';

import { Body, Button, Card, Heading, Muted, Overline } from '@/components/ui';
import { savePlan } from '@/lib/db/queries';
import { generateGymRoutine } from '@/lib/plan/gym-routine';
import { space } from '@/lib/theme';

export function GymRoutineCard({ userId, onActivated }: {
  userId: string;
  onActivated: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const activate = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    setError(null);
    try {
      await savePlan(userId, generateGymRoutine());
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
      <Muted>Your logged sessions and weights stay when you switch plans.</Muted>
      {error ? <Body accessibilityRole="alert">{error}</Body> : null}
      <Button title="Use 47 min PPL routine" loading={saving} onPress={activate} />
    </Card>
  );
}
