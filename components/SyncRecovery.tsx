import { useCallback, useEffect, useRef, useState } from 'react';
import { LegacySetRecovery } from './LegacySetRecovery';
import type { RejectedOperation } from '@/lib/session/outbox';
import { Body, Button, Card, Overline } from '@/components/ui';
import { getSyncStatus, retrySync, getSetConflicts, getLegacySetConflicts, reviewSetConflict, resolveSetConflict, type SetConflictReview } from '@/lib/session/sync';
import type { BlockedWrite } from '@/lib/session/set-journal';
import type { SetLog } from '@/lib/types';
import { measurementLabel } from '@/lib/session/set-values';
import { exerciseName } from '@/lib/catalog';
import { buildQueue } from '@/lib/session/queue';
import { space } from '@/lib/theme';

type State = {
  ownerId: string;
  pending: number;
  rejected: number;
  error?: boolean;
  conflicts?: BlockedWrite[];
  legacy?: RejectedOperation[];
};

/** Recovery is account-scoped; prior account results never appear on Home. */
export function SyncRecovery({ userId }: { userId: string }) {
  return <AccountSyncRecovery key={userId} userId={userId} />;
}
const setDescription = (set: SetLog) => `${measurementLabel(set)} · ${set.is_bodyweight
  ? `bodyweight + ${set.added_load_kg} kg` : `${set.weight_kg ?? 'No load'}${set.weight_kg === null ? '' : ' kg'}`}`;
function AccountSyncRecovery({ userId }: { userId: string }) {
  const [state, setState] = useState<State | null>(null);
  const [busyOwner, setBusyOwner] = useState<string | null>(null);
  const [review, setReview] = useState<SetConflictReview | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const reviewRequest = useRef(0);
  const choosing = useRef(false);
  const identity = useRef(userId);
  identity.current = userId;
  const mounted = useRef(true);
  const request = useRef(0);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const current = useCallback(
    () => mounted.current && identity.current === userId,
    [userId],
  );
  const refresh = useCallback(async () => {
    const attempt = ++request.current;
    const latest = () => current() && request.current === attempt;
    try {
      const [next, conflicts, legacy] = await Promise.all([getSyncStatus(userId), getSetConflicts(userId), getLegacySetConflicts(userId)]);
      if (latest()) {
        setState({ ...next, conflicts, legacy });
        setReview(previous => previous && conflicts.some(entry =>
          entry.code === previous.code && JSON.stringify(entry.write) === JSON.stringify(previous.write)) ? previous : null);
      }
    } catch {
      if (latest())
        setState({ ownerId: userId, pending: 0, rejected: 0, error: true });
    }
  }, [userId, current]);
  useEffect(() => {
    let cancelled = false;
    const read = () => {
      if (!cancelled) void refresh();
    };
    read();
    const timer = setInterval(read, 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [refresh]);
  const retry = async () => {
    setBusyOwner(userId);
    try {
      await retrySync(userId);
      await refresh();
    } catch {
      if (current())
        setState({ ownerId: userId, pending: 0, rejected: 0, error: true });
    } finally {
      if (current()) setBusyOwner(null);
    }
  };
  const openReview = async (blocked: BlockedWrite) => {
    const attempt = ++reviewRequest.current;
    setBusyOwner(userId); setReviewError(null); setReview(null);
    try {
      const next = await reviewSetConflict(userId, blocked.write);
      if (current() && attempt === reviewRequest.current) setReview(next);
    } catch (error) {
      if (current() && attempt === reviewRequest.current)
        setReviewError(error instanceof Error ? error.message : 'Could not review this set. Your saved data is preserved.');
    } finally { if (current() && attempt === reviewRequest.current) setBusyOwner(null); }
  };
  const choose = async (choice: 'saved' | 'server') => {
    if (!review || choosing.current) return;
    choosing.current = true;
    const captured = review;
    setBusyOwner(userId); setReviewError(null);
    try {
      await resolveSetConflict(userId, captured, choice);
      if (current()) setReview(null);
      await refresh();
    } catch (error) {
      if (current()) {
        setReview(null);
        setReviewError(error instanceof Error ? error.message : 'Could not save your choice. Both copies are preserved.');
        await refresh();
      }
    } finally { choosing.current = false; if (current()) setBusyOwner(null); }
  };
  const local = review?.workout;
  const entry = local ? buildQueue(local.day)[local.cursor] : null;
  const unsentDraft = local?.sessionId === review?.write.sessionId && local?.phase === 'resting'
    && entry?.item.id === review?.write.set.plan_item_id && entry?.set === review?.write.set.set_index
    && JSON.stringify(local.draft) !== JSON.stringify(local.savedDraft) ? local.draft : null;
  const own = state?.ownerId === userId ? state : null;
  if (!own || (!own.error && own.pending === 0 && own.rejected === 0))
    return null;
  return (
    <Card style={{ marginTop: space.lg, gap: space.md }}>
      <Overline>Workout sync</Overline>
      <Body>
        {own.error
          ? 'Could not read workout sync. Your saved data is preserved.'
          : own.rejected > 0
            ? `${own.rejected} workout update${own.rejected === 1 ? '' : 's'} ${own.rejected === 1 ? 'needs' : 'need'} attention. Your saved data is preserved.`
            : `${own.pending} workout update${own.pending === 1 ? '' : 's'} waiting to sync.`}
      </Body>
      {reviewError ? <Body>{reviewError}</Body> : null}
      {review ? (
        <Card style={{ gap: space.md }}>
          <Overline>{exerciseName(review.write.set.exercise_id)} · Set {review.write.set.set_index}</Overline>
          <Body>Saved: {setDescription(review.write.set)}</Body>
          <Body>Server: {review.server ? setDescription(review.server.set) : 'No saved server set'}</Body>
          {unsentDraft ? <Body>Unsent rest draft: {measurementLabel(unsentDraft)} · {unsentDraft.asBodyweight ? 'bodyweight + ' : ''}{unsentDraft.weight} {local!.units}. Your choice will replace this draft; a recovery copy is kept.</Body> : null}
          {review.code === 'PT410' ? (
            <Body>This workout is finalized. Your saved edit is preserved for review.</Body>
          ) : (
            <>
              <Body>Choose which set to keep. Both copies stay on this device for recovery.</Body>
              <Button title="Keep saved set" loading={busyOwner === userId} onPress={() => { void choose('saved'); }} />
              {review.server ? <Button title="Use server set" variant="surface" disabled={busyOwner === userId} onPress={() => { void choose('server'); }} /> : null}
            </>
          )}
          <Button title="Close review" variant="ghost" disabled={choosing.current} onPress={() => {
            reviewRequest.current++; setReview(null); setReviewError(null);
          }} />
        </Card>
      ) : (own.conflicts ?? []).map(entry => (
        <Button key={entry.write.id} title={`Review ${exerciseName(entry.write.set.exercise_id)} set ${entry.write.set.set_index}`}
          variant="surface" disabled={busyOwner === userId} onPress={() => { void openReview(entry); }} />
      ))}
      {(own.legacy ?? []).map(captured => <LegacySetRecovery key={JSON.stringify(captured)}
        userId={userId} captured={captured} onResolved={refresh} />)}
      <Button
        title="Retry workout sync"
        disabled={busyOwner === userId}
        onPress={() => {
          void retry();
        }}
      />
    </Card>
  );
}
