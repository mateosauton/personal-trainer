import { useEffect, useRef, useState } from 'react';
import { TextInput } from 'react-native';
import { Body, Button, Card, Overline } from './ui';
import { confirm } from '@/lib/alerts';
import { exportWorkoutRecovery, inspectQueueRecovery, repairQueueRecovery } from '@/lib/session/sync';
import type { QueueRepairReview } from '@/lib/session/recovery-data';
import { colors, space } from '@/lib/theme';

/** The user reviews a repair before the complete original is archived on disk. */
export function QueueDataRecovery({ userId, onRepaired }: { userId: string; onRepaired: () => Promise<void> }) {
  const [reviews, setReviews] = useState<QueueRepairReview[] | null>(null);
  const [selected, setSelected] = useState<QueueRepairReview | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setMessage(null);
    try { await action(); }
    catch (error) { if (mounted.current) setMessage(error instanceof Error ? error.message : 'Could not read saved data.'); }
    finally { if (mounted.current) setBusy(false); }
  };
  return <Card style={{ gap: space.md }}>
    <Button title="Export saved workout data" variant="surface" disabled={busy}
      onPress={() => { void run(() => exportWorkoutRecovery(userId)); }} />
    <Button title="Review damaged queue data" variant="surface" disabled={busy}
      onPress={() => { void run(async () => {
        const next = await inspectQueueRecovery(userId);
        if (mounted.current) { setReviews(next); setSelected(null); }
      }); }} />
    {reviews?.length === 0 ? <Body>The queue archives are readable. The export includes your saved workout and set journal for further recovery.</Body> : null}
    {reviews?.map(review => <Button key={review.key} title={`Repair ${review.label.toLowerCase()}`}
      variant="surface" disabled={busy} onPress={() => {
        setSelected(review); setDraft(review.suggested ?? review.raw); setMessage(null);
      }} />)}
    {selected ? <Card style={{ gap: space.md }}>
      <Overline>{selected.label}</Overline>
      <Body>{selected.suggested !== null
        ? `${selected.recoverable} readable update${selected.recoverable === 1 ? '' : 's'} will be kept. Damaged entries stay in an exportable recovery copy.`
        : 'Correct the damaged JSON below, or export it for help. Your complete original stays in an exportable recovery copy.'}</Body>
      <TextInput multiline value={draft} onChangeText={setDraft} editable={!busy} autoCapitalize="none" autoCorrect={false}
        accessibilityLabel="Repaired workout queue JSON" textAlignVertical="top"
        style={{ color: colors.text, borderColor: colors.borderStrong, borderWidth: 1, borderRadius: 8,
          minHeight: 160, maxHeight: 320, padding: space.md, fontFamily: 'monospace' }} />
      <Button title="Save reviewed repair" disabled={busy} onPress={() => { void run(async () => {
        const captured = selected;
        if (!await confirm({ title: 'Save this repair?', message: 'The complete original is saved first. Readable updates must remain in their original order.', confirmLabel: 'Save repair' })) return;
        await repairQueueRecovery(userId, captured, draft);
        const next = await inspectQueueRecovery(userId);
        if (mounted.current) { setReviews(next); setSelected(null); setMessage('Repair saved. Retry workout sync when ready.'); }
        await onRepaired();
      }); }} />
      <Button title="Cancel repair" variant="ghost" disabled={busy} onPress={() => setSelected(null)} />
    </Card> : null}
    {message ? <Body>{message}</Body> : null}
  </Card>;
}
