import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';
import * as Crypto from 'expo-crypto';
import NetInfo from '@react-native-community/netinfo';

import {
  finishSession,
  logSetVersioned,
  checkLegacySet,
  getSetWriteState,
  type SetWriteState,
} from '@/lib/db/queries';
import { clientForAccessToken, supabase } from '@/lib/db/supabase';
import type { SetLog } from '@/lib/types';
import { Outbox, type OutboxOperation } from './outbox';
import { SetJournal, type JournalWrite, type BlockedWrite } from './set-journal';
import { storageLock } from './storage-lock';
import { archiveLegacyProgress } from './legacy-progress';
import { workouts } from './workout';
import { buildQueue } from './queue';
import { kgToDisplay } from '@/lib/units';
import type { SavedWorkout, WorkoutPatch } from './workout-store';

let activeAccount: string | null = null;
let accountGeneration = 0;
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
  if (activeAccount !== userId) accountGeneration++;
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

export interface SetConflictReview extends BlockedWrite {
  ownerId: string;
  server: SetWriteState | null;
  accountGeneration: number;
  workout: SavedWorkout | null;
}
export async function getSetConflicts(userId: string): Promise<BlockedWrite[]> {
  requireAccount(userId);
  const generation = accountGeneration;
  const entries = await journalFor(userId).blocked();
  requireAccount(userId);
  if (generation !== accountGeneration) throw new Error('The workout account changed.');
  return entries.filter(entry => needsReview(entry.code));
}
const exactWrite = (a: JournalWrite, b: JournalWrite) => JSON.stringify(a) === JSON.stringify(b);
async function currentConflict(userId: string, write: JournalWrite) {
  const entry = (await getSetConflicts(userId)).find(entry => exactWrite(entry.write, write));
  if (!entry) throw new Error('The saved set changed. Review the latest value.');
  return entry;
}
/** A review is a snapshot, not permission to adopt a newly fetched baseline. */
export async function reviewSetConflict(userId: string, write: JournalWrite): Promise<SetConflictReview> {
  requireAccount(userId);
  const generation = accountGeneration;
  const controller = new AbortController();
  const guard = () => {
    requireAccount(userId);
    if (generation !== accountGeneration) throw new Error('The workout account changed.');
    if (controller.signal.aborted) throw new Error('Workout conflict review timed out.');
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async () => {
        const blocked = await currentConflict(userId, write);
        const { data, error } = await supabase.auth.getSession();
        guard();
        if (error) throw error;
        if (data.session?.user.id !== userId) throw new Error('The workout account changed.');
        const client = clientForAccessToken(data.session.access_token);
        const server = await getSetWriteState(write.sessionId, write.set.plan_item_id,
          write.set.set_index, client, controller.signal);
        guard();
        const workout = await workouts.read(userId);
        await currentConflict(userId, write);
        guard();
        return { ownerId: userId, ...blocked, server, accountGeneration: generation, workout };
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error('Workout conflict review timed out. Your saved data is preserved.'));
        }, 15000);
      }),
    ]);
  } finally { if (timer !== undefined) clearTimeout(timer); }
}
export async function resolveSetConflict(userId: string, review: SetConflictReview, choice: 'saved' | 'server') {
  requireAccount(userId);
  const generation = accountGeneration;
  const guard = () => {
    requireAccount(userId);
    if (generation !== accountGeneration) throw new Error('The workout account changed.');
  };
  if (review.accountGeneration !== generation) throw new Error('The workout account changed. Review this set again.');
  if (review.ownerId !== userId || review.write.ownerId !== userId
    || !['saved', 'server'].includes(choice)) throw new Error('Invalid conflict choice.');
  const blocked = await currentConflict(userId, review.write);
  guard();
  if (blocked.code === 'PT410')
    throw new Error('This workout is finalized. Your saved edit is preserved for review.');
  if (choice === 'server' && !review.server) throw new Error('There is no server set to choose.');
  const chosen = choice === 'server' ? review.server!.set : review.write.set;
  const local = review.workout;
  const entry = local ? buildQueue(local.day)[local.cursor] : null;
  let patch: WorkoutPatch | undefined;
  if (local?.sessionId === review.write.sessionId && local.phase === 'resting'
    && entry?.item.id === chosen.plan_item_id && entry.set === chosen.set_index) {
    const kg = chosen.is_bodyweight ? chosen.added_load_kg : chosen.weight_kg;
    if (chosen.reps === null || kg === null)
      throw new Error('This set has incomplete reps or load. Your saved draft is preserved.');
    const draft = { reps: chosen.reps, weight: kgToDisplay(kg, local.units), asBodyweight: chosen.is_bodyweight };
    const previous = local.progress.find(row => row.exercise_id === chosen.exercise_id);
    const row = { exercise_id: chosen.exercise_id, last_weight_kg: kg, last_reps: chosen.reps,
      best_weight_kg: previous?.best_weight_kg ?? null, best_e1rm: previous?.best_e1rm ?? null,
      miss_streak: previous?.miss_streak ?? 0 };
    patch = { draft,
      progress: [...local.progress.filter(row => row.exercise_id !== chosen.exercise_id), row] };
  }
  await workouts.withSnapshot(userId, local, persistDraft => journalFor(userId).resolve(review.write,
    chosen, review.server?.serverVersion ?? 0,
    choice === 'server' ? review.server!.eventAt : review.write.eventAt,
    async write => { guard(); await enqueueWrite(userId, write); }, async () => { guard(); await persistDraft(); guard(); },
    { saved: review.write, server: review.server, choice,
      ...(patch && local ? { draftCopy: { units: local.units, draft: local.draft, savedDraft: local.savedDraft, bodyweightKg: local.bodyweightKg } } : {}) }), patch, guard, patch ? { savedDraft: patch.draft } : undefined);
  guard();
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
