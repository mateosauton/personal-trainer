import { useCallback, useEffect, useRef, useState } from 'react';
import { Body, Button, Card, Overline } from '@/components/ui';
import { getSyncStatus, retrySync } from '@/lib/session/sync';
import { space } from '@/lib/theme';

type State = {
  ownerId: string;
  pending: number;
  rejected: number;
  error?: boolean;
};

/** Recovery is account-scoped; prior account results never appear on Home. */
export function SyncRecovery({ userId }: { userId: string }) {
  const [state, setState] = useState<State | null>(null);
  const [busyOwner, setBusyOwner] = useState<string | null>(null);
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
      const next = await getSyncStatus(userId);
      if (latest()) setState(next);
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
      <Button
        title="Retry workout sync"
        loading={busyOwner === userId}
        onPress={() => {
          void retry();
        }}
      />
    </Card>
  );
}
