import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';
import * as Crypto from 'expo-crypto';
import NetInfo from '@react-native-community/netinfo';

import {
  finishSession,
  logSetVersioned,
  checkLegacySet,
} from '@/lib/db/queries';
import { clientForAccessToken, supabase } from '@/lib/db/supabase';
import type { SetLog } from '@/lib/types';
import { Outbox, type OutboxOperation } from './outbox';
import { SetJournal, type JournalWrite } from './set-journal';
import { storageLock } from './storage-lock';
import { archiveLegacyProgress } from './legacy-progress';

let activeAccount: string | null = null;
const queues = new Map<string, Outbox>();
const journals = new Map<string, SetJournal>();
const permanentCodes = [
  '23502',
  '23503',
  '23514',
  '22P02',
  '22003',
  '22023',
  'PT409',
  'PT410',
];
const needsReview = (code: string) => code === 'PT409' || code === 'PT410';
function journalFor(userId: string) {
  let journal = journals.get(userId);
  if (!journal) {
    journal = new SetJournal(
      AsyncStorage,
      userId,
      () => Crypto.randomUUID(),
      undefined,
      storageLock,
    );
    journals.set(userId, journal);
  }
  return journal;
}

/** Call synchronously on auth transitions, before changing visible routes. */
export function setSyncAccount(userId: string | null) {
  activeAccount = userId;
}

const requireAccount = (userId: string) => {
  if (activeAccount !== userId)
    throw new Error('The workout account changed. Sign in again to sync.');
};

function queueFor(userId: string): Outbox {
  let queue = queues.get(userId);
  if (!queue) {
    queue = new Outbox(
      AsyncStorage,
      async (operation, signal) => {
        requireAccount(userId);
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;
        if (signal.aborted) throw new Error('Workout sync timed out.');
        requireAccount(userId);
        if (data.session?.user.id !== userId)
          throw new Error('The workout account changed.');
        // Capture this account's token. An in-flight A write remains an A write
        // even if the shared auth client switches to B before fetch begins.
        const client = clientForAccessToken(data.session.access_token);
        if (operation.kind === 'set') {
          const { sessionId, set, write } = operation.payload as {
            sessionId: string;
            set: SetLog;
            write?: JournalWrite;
          };
          if (write) {
            if (
              write.ownerId !== userId ||
              write.id !== operation.id ||
              write.sessionId !== sessionId ||
              JSON.stringify(write.set) !== JSON.stringify(set)
            )
              throw new Error(
                'Saved set identity does not match its queue entry.',
              );
            try {
              const result = await logSetVersioned(write, client, signal);
              if (signal.aborted) throw new Error('Workout sync timed out.');
              requireAccount(userId);
              await journalFor(userId).acknowledge(write, result);
            } catch (error) {
              const code = (error as { code?: string })?.code;
              if (
                !signal.aborted &&
                activeAccount === userId &&
                code &&
                permanentCodes.includes(code)
              )
                await journalFor(userId).block(write, code);
              throw error;
            }
          } else {
            // Never assign an artificial revision to an old queued write.
            const result = await checkLegacySet(sessionId, set, client, signal);
            if (signal.aborted) throw new Error('Workout sync timed out.');
            requireAccount(userId);
            if (result.status === 'conflict')
              throw Object.assign(
                new Error('Review this saved set against the server value.'),
                { code: 'PT409' },
              );
          }
        } else if (operation.kind === 'progress') {
          const { userId: owner } = operation.payload as { userId: string };
          if (owner !== userId)
            throw new Error('Queued progress belongs to another account.');
          // Old summaries queued non-idempotent progress patches. Preserve them
          // for recovery, but do not replay them over newer server receipts.
          const archiveKey = `office-gym.legacy-progress.v1.${userId}`;
          await archiveLegacyProgress(
            AsyncStorage,
            archiveKey,
            operation,
            storageLock,
          );
        } else {
          const { sessionId, durationS } = operation.payload as {
            sessionId: string;
            durationS: number;
          };
          await finishSession(
            sessionId,
            { duration_s: durationS, rpe: null },
            client,
            signal,
          );
        }
      },
      `office-gym.session-outbox.v2.${userId}`,
      (error) => {
        // Validation failures cannot succeed with the same payload. Auth, schema,
        // network, and ambiguous timeout failures stay in the active queue.
        const code = (error as { code?: string } | null)?.code;
        return code != null && permanentCodes.includes(code);
      },
      storageLock,
    );
    queues.set(userId, queue);
  }
  return queue;
}

const enqueue = async (userId: string, operation: OutboxOperation) => {
  requireAccount(userId);
  const queue = queueFor(userId);
  await queue.enqueue(operation);
  requireAccount(userId);
  void flushAccount(userId).catch(() => undefined);
};

const enqueueWrite = (userId: string, write: JournalWrite) =>
  enqueue(userId, {
    id: write.id,
    kind: 'set',
    payload: { sessionId: write.sessionId, set: write.set, write },
  });
export async function queueSet(userId: string, sessionId: string, set: SetLog) {
  requireAccount(userId);
  await journalFor(userId).save(sessionId, set, (write) =>
    enqueueWrite(userId, write),
  );
  requireAccount(userId);
}
async function flushAccount(userId: string) {
  requireAccount(userId);
  await journalFor(userId).recover(async (write) => {
    requireAccount(userId);
    await queueFor(userId).enqueue({
      id: write.id,
      kind: 'set',
      payload: { sessionId: write.sessionId, set: write.set, write },
    });
  });
  requireAccount(userId);
  await queueFor(userId).flush();
}

export const queueCompletion = (
  userId: string,
  sessionId: string,
  durationS: number,
) =>
  enqueue(userId, {
    id: `complete:${sessionId}`,
    kind: 'complete',
    payload: { sessionId, durationS },
  });

const belongsToSession = (operation: OutboxOperation, sessionId?: string) =>
  !sessionId ||
  !operation.payload.sessionId ||
  operation.payload.sessionId === sessionId;

async function readStatus(userId: string, sessionId?: string) {
  requireAccount(userId);
  const [pending, rejected, unfinished, blocked] = await Promise.all([
    queueFor(userId).pending(),
    queueFor(userId).rejected(),
    journalFor(userId).pending(),
    journalFor(userId).blocked(),
  ]);
  requireAccount(userId);
  return {
    ownerId: userId,
    pending: new Set([
      ...pending
        .filter((op) => belongsToSession(op, sessionId))
        .map((op) => op.id),
      ...unfinished
        .filter((w) => !sessionId || w.sessionId === sessionId)
        .map((w) => w.id),
    ]).size,
    rejected: new Set([
      ...rejected
        .filter((e) => belongsToSession(e.operation, sessionId))
        .map((e) => e.operation.id),
      ...blocked
        .filter((e) => !sessionId || e.write.sessionId === sessionId)
        .map((e) => e.write.id),
    ]).size,
  };
}
export const pendingSyncCount = async (sessionId?: string) =>
  activeAccount ? (await readStatus(activeAccount, sessionId)).pending : 0;
export const failedSyncCount = async (sessionId?: string) =>
  activeAccount ? (await readStatus(activeAccount, sessionId)).rejected : 0;
export const flushOutbox = () =>
  activeAccount ? flushAccount(activeAccount) : Promise.resolve();
export const getSyncStatus = (userId: string) => readStatus(userId);
export async function retrySync(userId: string) {
  requireAccount(userId);
  const queue = queueFor(userId);
  await queue.retryRejected((entry) => !needsReview(entry.code));
  requireAccount(userId);
  await flushAccount(userId);
  requireAccount(userId);
}

/** Install for the authenticated account only. Old callbacks cannot replay a new account. */
export function startOutboxSync(userId: string) {
  const flush = () => {
    if (activeAccount === userId)
      void flushAccount(userId).catch(() => undefined);
  };
  const network = NetInfo.addEventListener((state) => {
    if (state.isConnected) flush();
  });
  const app = AppState.addEventListener('change', (state) => {
    if (state === 'active') flush();
  });
  flush();
  return () => {
    network();
    app.remove();
  };
}
