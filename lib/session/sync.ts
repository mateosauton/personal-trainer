import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';
import NetInfo from '@react-native-community/netinfo';

import { finishSession, logSet, upsertProgress, type ProgressRow } from '@/lib/db/queries';
import { clientForAccessToken, supabase } from '@/lib/db/supabase';
import type { SetLog } from '@/lib/types';
import { Outbox, type OutboxOperation } from './outbox';

let activeAccount: string | null = null;
const queues = new Map<string, Outbox>();

/** Call synchronously on auth transitions, before changing visible routes. */
export function setSyncAccount(userId: string | null) {
  activeAccount = userId;
}

const requireAccount = (userId: string) => {
  if (activeAccount !== userId) throw new Error('The workout account changed. Sign in again to sync.');
};

function queueFor(userId: string): Outbox {
  let queue = queues.get(userId);
  if (!queue) {
    queue = new Outbox(AsyncStorage, async (operation, signal) => {
      requireAccount(userId);
      const { data, error } = await supabase.auth.getSession();
      if (error) throw error;
      if (signal.aborted) throw new Error('Workout sync timed out.');
      requireAccount(userId);
      if (data.session?.user.id !== userId) throw new Error('The workout account changed.');
      // Capture this account's token. An in-flight A write remains an A write
      // even if the shared auth client switches to B before fetch begins.
      const client = clientForAccessToken(data.session.access_token);
      if (operation.kind === 'set') {
        const { sessionId, set } = operation.payload as { sessionId: string; set: SetLog };
        await logSet(sessionId, set, client, signal);
      } else if (operation.kind === 'progress') {
        const { userId: owner, rows } = operation.payload as { userId: string; rows: ProgressRow[] };
        if (owner !== userId) throw new Error('Queued progress belongs to another account.');
        await upsertProgress(userId, rows, client, signal);
      } else {
        const { sessionId, durationS } = operation.payload as { sessionId: string; durationS: number };
        await finishSession(sessionId, { duration_s: durationS, rpe: null }, client, signal);
      }
    }, `office-gym.session-outbox.v2.${userId}`);
    queues.set(userId, queue);
  }
  return queue;
}

const enqueue = async (userId: string, operation: OutboxOperation) => {
  requireAccount(userId);
  const queue = queueFor(userId);
  await queue.enqueue(operation);
  void queue.flush().catch(() => undefined);
};

export const queueSet = (userId: string, sessionId: string, set: SetLog) => enqueue(userId, {
  id: `set:${sessionId}:${set.plan_item_id}:${set.set_index}`,
  kind: 'set', payload: { sessionId, set },
});

export const queueProgress = (userId: string, rows: ProgressRow[]) => enqueue(userId, {
  id: `progress:${userId}:${rows.map((row) => row.exercise_id).sort().join(',')}`,
  kind: 'progress', payload: { userId, rows },
});

export const queueCompletion = (userId: string, sessionId: string, durationS: number) => enqueue(userId, {
  id: `complete:${sessionId}`, kind: 'complete', payload: { sessionId, durationS },
});

export const pendingSyncCount = () => activeAccount
  ? queueFor(activeAccount).pending().then((items) => items.length)
  : Promise.resolve(0);
export const flushOutbox = () => activeAccount ? queueFor(activeAccount).flush() : Promise.resolve();

/** Install for the authenticated account only. Old callbacks cannot replay a new account. */
export function startOutboxSync(userId: string) {
  const flush = () => {
    if (activeAccount === userId) void queueFor(userId).flush().catch(() => undefined);
  };
  const network = NetInfo.addEventListener((state) => { if (state.isConnected) flush(); });
  const app = AppState.addEventListener('change', (state) => { if (state === 'active') flush(); });
  flush();
  return () => { network(); app.remove(); };
}
