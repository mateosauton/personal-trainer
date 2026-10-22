import { useEffect, useRef, useState } from 'react';
import { Keyboard, TextInput } from 'react-native';
import { Body, Button, Card, Overline } from '@/components/ui';
import { exerciseName } from '@/lib/catalog';
import { buildQueue } from '@/lib/session/queue';
import type { RejectedOperation } from '@/lib/session/outbox';
import { reviewLegacySetConflict, resolveLegacySetConflict, type LegacySetConflictReview } from '@/lib/session/sync';
import type { SetLog } from '@/lib/types';
import { measurementLabel } from '@/lib/session/set-values';
import { colors, radius, space } from '@/lib/theme';
const describe = (set: SetLog) => `${measurementLabel(set)} · ${set.is_bodyweight
  ? `bodyweight + ${set.added_load_kg} kg` : set.weight_kg === null ? 'No load' : `${set.weight_kg} kg`}`;

/** Mounted with an account/capture key; pending results cannot survive a new capture. */
export function LegacySetRecovery({ userId, captured, onResolved }: {
  userId: string; captured: RejectedOperation; onResolved: () => Promise<void>;
}) {
  const [review, setReview] = useState<LegacySetConflictReview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [date, setDate] = useState(''), [clock, setClock] = useState('');
  const mounted = useRef(true), request = useRef(0), choosing = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const saved = captured.operation.payload.set as SetLog;
  const open = async () => {
    const attempt = ++request.current;
    setBusy(true); setError(null); setDate(''); setClock('');
    try {
      const next = await reviewLegacySetConflict(userId, captured);
      if (mounted.current && request.current === attempt) setReview(next);
    } catch (failure) {
      if (mounted.current && request.current === attempt)
        setError(failure instanceof Error ? failure.message : 'Could not review the older set. Your saved data is preserved.');
    } finally { if (mounted.current && request.current === attempt) setBusy(false); }
  };
  const choose = async (choice: 'saved' | 'server') => {
    if (!review || choosing.current || (choice === 'saved' && (!date.trim() || !clock.trim()))) return;
    choosing.current = true; setBusy(true); setError(null);
    try {
      const time = choice === 'saved' ? `${date.trim()}T${clock.trim()}:00.000Z` : undefined;
      await resolveLegacySetConflict(userId, review, choice, time);
      if (mounted.current) setReview(null);
      await onResolved();
    } catch (failure) {
      if (mounted.current) {
        setReview(null);
        setError(failure instanceof Error ? failure.message : 'Could not save your choice. The older edit is preserved.');
        await onResolved();
      }
    } finally { choosing.current = false; if (mounted.current) setBusy(false); }
  };
  const local = review?.rest ?? review?.workout;
  const entry = local ? buildQueue(local.day)[local.cursor] : null;
  const unsent = local?.sessionId === review?.saved.sessionId && local?.phase === 'resting'
    && entry?.item.id === review?.saved.set.plan_item_id && entry?.set === review?.saved.set.set_index
    && JSON.stringify(local.draft) !== JSON.stringify(local.savedDraft) ? local.draft : null;
  const inputStyle = { color: colors.text, backgroundColor: colors.elevated, padding: space.md,
    borderRadius: radius.sm, borderWidth: 1, borderColor: colors.borderStrong };
  return (
    <Card style={{ gap: space.md }}>
      {error ? <Body>{error}</Body> : null}
      {!review ? <Button title={`Review older ${exerciseName(saved.exercise_id)} set ${saved.set_index}`}
        variant="surface" loading={busy} onPress={() => { void open(); }} /> : (
        <>
          <Overline>{exerciseName(review.saved.set.exercise_id)} · Set {review.saved.set.set_index}</Overline>
          <Body>Older saved set: {describe(review.saved.set)}</Body>
          <Body>Server: {review.server ? describe(review.server.set) : 'No saved server set'}</Body>
          {local?.savedDraft && entry?.item.id === review.saved.set.plan_item_id
            && entry.set === review.saved.set.set_index && local.sessionId === review.saved.sessionId ?
            <Body>Last saved rest value: {measurementLabel(local.savedDraft)} · {local.savedDraft.asBodyweight ? 'bodyweight + ' : ''}{local.savedDraft.weight} {local.units}</Body> : null}
          {unsent ? <Body>Unsent rest draft: {measurementLabel(unsent)} · {unsent.asBodyweight ? 'bodyweight + ' : ''}{unsent.weight} {local!.units}. Your choice will replace this draft; a recovery copy is kept.</Body> : null}
          {review.captured.code === 'PT410' ? <Body>This workout is finalized. Your older edit is preserved for review.</Body> : (
            <>
              {review.server ? <>
                <Body>Server completion time: {new Date(review.server.eventAt).toLocaleString(undefined, { timeZone: 'UTC', timeZoneName: 'short' })}</Body>
                <Button title="Use server set" disabled={busy} onPress={() => { void choose('server'); }} />
              </> : null}
              <Body>The original completion time was not saved. To keep this older edit, enter when you completed it in UTC. Both values stay saved for recovery.</Body>
              <Body>Completion date (YYYY-MM-DD, UTC)</Body>
              <TextInput accessibilityLabel="Completion date in UTC" value={date} onChangeText={setDate}
                placeholder="YYYY-MM-DD" placeholderTextColor={colors.muted} autoCapitalize="none" autoCorrect={false}
                editable={!busy} style={inputStyle} returnKeyType="done" onSubmitEditing={Keyboard.dismiss} />
              <Body>Completion time (HH:mm, 24-hour UTC)</Body>
              <TextInput accessibilityLabel="Completion time in UTC" value={clock} onChangeText={setClock}
                placeholder="HH:mm" placeholderTextColor={colors.muted} autoCapitalize="none" autoCorrect={false}
                editable={!busy} style={inputStyle} returnKeyType="done" onSubmitEditing={Keyboard.dismiss} />
              <Button title="Keep older set at this time" variant="surface" disabled={busy || !date.trim() || !clock.trim()}
                onPress={() => { void choose('saved'); }} />
            </>
          )}
          <Button title="Close older set review" variant="ghost" disabled={busy} onPress={() => {
            request.current++; setReview(null); setError(null); setDate(''); setClock('');
          }} />
        </>
      )}
    </Card>
  );
}
