import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';
import NetInfo from '@react-native-community/netinfo';

import { finishSession, logSet, upsertProgress, type ProgressRow } from '@/lib/db/queries';
import type { SetLog } from '@/lib/types';
import { Outbox, type OutboxOperation } from './outbox';

const outbox = new Outbox(AsyncStorage, async (operation) => {
  if (operation.kind === 'set') {
    const { sessionId, set } = operation.payload as { sessionId: string; set: SetLog };
    await logSet(sessionId, set);
  } else if (operation.kind === 'progress') {
    const { userId, rows } = operation.payload as { userId: string; rows: ProgressRow[] };
    await upsertProgress(userId, rows);
  } else {
    const { sessionId, durationS } = operation.payload as { sessionId: string; durationS: number };
    await finishSession(sessionId, { duration_s: durationS, rpe: null });
  }
});

const enqueue = async (operation: OutboxOperation) => {
  await outbox.enqueue(operation);
  void outbox.flush();
};

export const queueSet = (sessionId: string, set: SetLog) => enqueue({
  id: `set:${sessionId}:${set.plan_item_id}:${set.set_index}`,
  kind: 'set', payload: { sessionId, set },
});

export const queueProgress = (userId: string, rows: ProgressRow[]) => enqueue({
  id: `progress:${userId}:${rows.map((row) => row.exercise_id).sort().join(',')}`,
  kind: 'progress', payload: { userId, rows },
});

export const queueCompletion = (sessionId: string, durationS: number) => enqueue({
  id: `complete:${sessionId}`, kind: 'complete', payload: { sessionId, durationS },
});

export const pendingSyncCount = () => outbox.pending().then((items) => items.length);
export const flushOutbox = () => outbox.flush();

/** Install once at app startup; returned cleanup avoids duplicate listeners. */
export function startOutboxSync() {
  const network = NetInfo.addEventListener((state) => { if (state.isConnected) void outbox.flush(); });
  const app = AppState.addEventListener('change', (state) => { if (state === 'active') void outbox.flush(); });
  void outbox.flush();
  return () => { network(); app.remove(); };
}
