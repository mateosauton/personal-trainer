import { useCallback, useEffect, useRef, useState } from 'react';
import { LegacySetRecovery } from './LegacySetRecovery';
import { QueueDataRecovery } from './QueueDataRecovery';
import type { RejectedOperation } from '@/lib/session/outbox';
import { Body, Button, Card, Overline } from '@/components/ui';
import { confirm } from '@/lib/alerts';
import {
  getSyncStatus, retrySync, getSetConflicts, getLegacySetConflicts, reviewSetConflict, resolveSetConflict,
  getRejectedStarts, archiveRejectedWorkout, exportWorkoutRecovery,
  type SetConflictReview, type RejectedStartReview,
} from '@/lib/session/sync';
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
  archived?: number;
  starts?: RejectedStartReview[];
  error?: boolean;
  conflicts?: BlockedWrite[];
  legacy?: RejectedOperation[];
};

type SyncRecoveryProps = { userId: string; onArchived?: () => void };

/** Recovery is account-scoped; prior account results never appear on Home. */
export function SyncRecovery({ userId, onArchived }: SyncRecoveryProps) {
  return <AccountSyncRecovery key={userId} userId={userId} onArchived={onArchived} />;
}
const setDescription = (set: SetLog) => `${measurementLabel(set)} · ${set.is_bodyweight
  ? `bodyweight + ${set.added_load_kg} kg` : `${set.weight_kg ?? 'No load'}${set.weight_kg === null ? '' : ' kg'}`}`;
function AccountSyncRecovery({ userId, onArchived }: SyncRecoveryProps) {
  const [state, setState] = useState<State | null>(null);
  const [busyOwner, setBusyOwner] = useState<string | null>(null);
  const [review, setReview] = useState<SetConflictReview | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [startReview, setStartReview] = useState<RejectedStartReview | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const startReviewRequest = useRef(0);
  const working = useRef(false);
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
      const [next, conflicts, legacy, starts] = await Promise.all([
        getSyncStatus(userId), getSetConflicts(userId), getLegacySetConflicts(userId), getRejectedStarts(userId),
      ]);
      if (latest()) {
        setState({ ...next, conflicts, legacy, starts });
        setStartReview(previous => previous && starts.some(entry =>
          JSON.stringify(entry) === JSON.stringify(previous)) ? previous : null);
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
    if (!current() || working.current) return;
    working.current = true;
    setBusyOwner(userId);
    try {
      await retrySync(userId);
      await refresh();
    } catch {
      if (current())
        setState({ ownerId: userId, pending: 0, rejected: 0, error: true });
    } finally {
      working.current = false;
      if (current()) setBusyOwner(null);
    }
  };
  const openReview = async (blocked: BlockedWrite) => {
    if (!current() || working.current) return;
    working.current = true;
    const attempt = ++reviewRequest.current;
    setBusyOwner(userId); setReviewError(null); setReview(null);
    try {
      const next = await reviewSetConflict(userId, blocked.write);
      if (current() && attempt === reviewRequest.current) setReview(next);
    } catch (error) {
      if (current() && attempt === reviewRequest.current)
        setReviewError(error instanceof Error ? error.message : 'Could not review this set. Your saved data is preserved.');
    } finally { working.current = false; if (current() && attempt === reviewRequest.current) setBusyOwner(null); }
  };
  const choose = async (choice: 'saved' | 'server') => {
    if (!current() || !review || review.ownerId !== userId || choosing.current || working.current) return;
    working.current = true;
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
    } finally { choosing.current = false; working.current = false; if (current()) setBusyOwner(null); }
  };
  const openStartReview = async (captured: RejectedStartReview) => {
    if (!current() || working.current || captured.ownerId !== userId) return;
    working.current = true;
    const attempt = ++startReviewRequest.current;
    setBusyOwner(userId); setStartError(null);
    try {
      const starts = await getRejectedStarts(userId);
      if (!current() || attempt !== startReviewRequest.current) return;
      const latest = starts.find(entry => entry.workout.sessionId === captured.workout.sessionId);
      if (!latest) throw new Error('This saved workout changed. Review its latest copy before archiving.');
      setStartReview(latest);
    } catch (error) {
      if (current() && attempt === startReviewRequest.current)
        setStartError(error instanceof Error ? error.message : 'Could not review this workout. Its saved data is preserved.');
    } finally { working.current = false; if (current() && attempt === startReviewRequest.current) setBusyOwner(null); }
  };
  const archiveStart = async () => {
    if (!current() || working.current || !startReview || startReview.ownerId !== userId) return;
    working.current = true;
    const captured = startReview;
    const attempt = startReviewRequest.current;
    const latest = () => current() && attempt === startReviewRequest.current;
    setBusyOwner(userId); setStartError(null);
    try {
      const accepted = await confirm({
        title: 'Archive saved workout?',
        message: `${captured.workout.day.name} and its saved data will stay on this device for export. Archiving frees the workout slot so you can start from your current plan.`,
        confirmLabel: 'Archive saved workout',
      });
      if (!accepted || !latest()) return;
      await archiveRejectedWorkout(userId, captured);
      if (!latest()) return;
      setStartReview(null);
      await refresh();
      if (current()) onArchived?.();
    } catch (error) {
      if (latest()) {
        // The archive may be durable while clearing the active slot failed. Keep the reviewed copy available.
        setStartError(error instanceof Error ? error.message : 'Could not finish archiving. Your saved workout is preserved.');
        await refresh();
      }
    } finally { working.current = false; if (current()) setBusyOwner(null); }
  };
  const exportRecovery = async () => {
    if (!current() || working.current) return;
    working.current = true;
    setBusyOwner(userId); setStartError(null);
    try { await exportWorkoutRecovery(userId); }
    catch (error) {
      if (current()) setStartError(error instanceof Error ? error.message : 'Could not export saved workout data.');
    } finally { working.current = false; if (current()) setBusyOwner(null); }
  };
  const local = review?.workout;
  const entry = local ? buildQueue(local.day)[local.cursor] : null;
  const unsentDraft = local?.sessionId === review?.write.sessionId && local?.phase === 'resting'
    && entry?.item.id === review?.write.set.plan_item_id && entry?.set === review?.write.set.set_index
    && JSON.stringify(local.draft) !== JSON.stringify(local.savedDraft) ? local.draft : null;
  const own = state?.ownerId === userId ? state : null;
  const savedSetCount = startReview?.workout.recordedSets === undefined ? null
    : new Set(startReview.workout.recordedSets.map(([, set]) => `${set.plan_item_id}:${set.set_index}`)).size;
  if (!own || (!own.error && own.pending === 0 && own.rejected === 0
    && (own.archived ?? 0) === 0 && !own.starts?.length && !startReview)) return null;
  return (
    <Card style={{ marginTop: space.lg, gap: space.md }}>
      <Overline>Workout sync</Overline>
      <Body>
        {own.error
          ? 'Could not read workout sync. Your saved data is preserved.'
          : own.starts?.length
            ? 'A saved workout could not start syncing. Review it before starting another.'
          : own.rejected > 0
            ? `${own.rejected} workout update${own.rejected === 1 ? '' : 's'} ${own.rejected === 1 ? 'needs' : 'need'} attention. Your saved data is preserved.`
            : own.pending > 0
              ? `${own.pending} workout update${own.pending === 1 ? '' : 's'} waiting to sync.`
              : `${own.archived ?? 0} saved workout${own.archived === 1 ? '' : 's'} archived on this device and available for export.`}
      </Body>
      {startError ? <Body accessibilityRole="alert">{startError}</Body> : null}
      {startReview ? <Card style={{ gap: space.md }}>
        <Overline>Saved workout</Overline>
        <Body>{startReview.workout.day.name}</Body>
        <Body>{savedSetCount === null
          ? 'A saved set count is unavailable in this older workout copy.'
          : `${savedSetCount} saved set${savedSetCount === 1 ? '' : 's'} in this workout copy.`}</Body>
        <Body>This workout could not sync. Archive it to keep a local recovery copy and free the slot for another workout.</Body>
        <Button title="Archive saved workout" loading={busyOwner === userId}
          onPress={() => { void archiveStart(); }} />
        <Button title="Close workout review" variant="ghost" disabled={busyOwner === userId} onPress={() => {
          if (!current() || working.current) return;
          startReviewRequest.current++; setStartReview(null); setStartError(null);
        }} />
      </Card> : (own.starts ?? []).map(captured => <Button key={captured.workout.sessionId}
        title={`Review saved workout: ${captured.workout.day.name}`} variant="surface" disabled={busyOwner === userId}
        onPress={() => { void openStartReview(captured); }} />)}
      {!own.error && ((own.archived ?? 0) > 0 || own.starts?.length || startReview) ? <Button
        title="Export saved workout data" variant="surface" disabled={busyOwner === userId}
        onPress={() => { void exportRecovery(); }} /> : null}
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
          <Button title="Close review" variant="ghost" disabled={busyOwner === userId} onPress={() => {
            if (!current() || working.current) return;
            reviewRequest.current++; setReview(null); setReviewError(null);
          }} />
        </Card>
      ) : (own.conflicts ?? []).map(entry => (
        <Button key={entry.write.id} title={`Review ${exerciseName(entry.write.set.exercise_id)} set ${entry.write.set.set_index}`}
          variant="surface" disabled={busyOwner === userId} onPress={() => { void openReview(entry); }} />
      ))}
      {(own.legacy ?? []).map(captured => <LegacySetRecovery key={JSON.stringify(captured)}
        userId={userId} captured={captured} onResolved={refresh} />)}
      {own.error ? <QueueDataRecovery userId={userId} onRepaired={refresh} /> : null}
      {own.error || own.pending > 0 || own.rejected > 0 ? <Button
        title="Retry workout sync"
        disabled={busyOwner === userId}
        onPress={() => {
          void retry();
        }}
      /> : null}
    </Card>
  );
}
