import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';
import * as Crypto from 'expo-crypto';
import NetInfo from '@react-native-community/netinfo';

import {
  finishSession,
  logSetVersioned,
  checkLegacySet,
  getSetWriteState,
  getSessionSetSnapshot,
  type SetWriteState,
} from '@/lib/db/queries';
import { clientForAccessToken, supabase } from '@/lib/db/supabase';
import type { SetLog } from '@/lib/types';
import { Outbox, type OutboxOperation, type RejectedOperation } from './outbox';
import { SetJournal, type JournalWrite, type BlockedWrite, type LegacySetCapture, validLegacyCapture, validSet } from './set-journal';
import { storageLock } from './storage-lock';
import { archiveLegacyProgress } from './legacy-progress';
import { workouts } from './workout';
import { buildQueue } from './queue';
import { kgToDisplay, displayToKg } from '@/lib/units';
import { validateWorkout, type SavedWorkout, type WorkoutPatch } from './workout-store';

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
  'PTREVIEW',
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
          if (await hasRejectedSets(userId, sessionId))
            throw Object.assign(new Error('Review saved sets before finishing this workout.'), { code: 'PTREVIEW' });
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
/** Only a value already observed locally may seed a baseline; differing remote edits require review. */
export async function bootstrapSetBaselines(userId: string, sessionId: string, observed: SetLog[], expectedWorkout?: SavedWorkout | null) {
  requireAccount(userId);
  if (!Array.isArray(observed) || !observed.every(validSet)) throw new Error('Invalid observed workout sets.');
  const saved = JSON.parse(JSON.stringify(observed)) as SetLog[];
  const generation = accountGeneration;
  const controller = new AbortController();
  const guard = () => {
    requireAccount(userId);
    if (generation !== accountGeneration) throw new Error('The workout account changed.');
    if (controller.signal.aborted) throw new Error('Workout baseline read timed out.');
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      (async () => {
        const captured = await journalFor(userId).hasCapturedSession(sessionId);
        guard();
        if (captured) return;
        const writes = await journalFor(userId).writes();
        guard();
        if (saved.length && saved.every(set => writes.some(write => write.sessionId === sessionId.toLowerCase()
          && write.set.plan_item_id === set.plan_item_id.toLowerCase() && write.set.set_index === set.set_index))) return;
        const { data, error } = await supabase.auth.getSession();
        guard();
        if (error) throw error;
        if (data.session?.user.id !== userId) throw new Error('The workout account changed.');
        const snapshot = await getSessionSetSnapshot(sessionId,
          clientForAccessToken(data.session.access_token), controller.signal);
        guard();
        const versions = new Map(snapshot.versions.map(entry => [entry.logId.toLowerCase(), entry.serverVersion]));
        const baselines = snapshot.logs.flatMap(log => {
          const observedSet = saved.find(set => set.plan_item_id.toLowerCase() === log.plan_item_id?.toLowerCase()
            && set.set_index === log.set_index);
          if (!observedSet || !validSet(log) || !Object.keys(observedSet).every(key =>
            key === 'plan_item_id' ? observedSet.plan_item_id.toLowerCase() === log.plan_item_id.toLowerCase()
              : observedSet[key as keyof SetLog] === log[key as keyof SetLog])) return [];
          const serverVersion = versions.get(log.id.toLowerCase());
          if (!serverVersion) throw new Error('Invalid workout baseline snapshot. Your saved data is preserved.');
          return [{ set: observedSet, serverVersion, eventAt: log.completed_at }];
        });
        const needsLegacyReview = () => Object.assign(new Error('This older saved set needs explicit recovery before correction. Your draft is preserved.'), { code: 'PT409' });
        if (baselines.length !== saved.length) throw needsLegacyReview();
        const capture = () => journalFor(userId).captureBaselines(sessionId, baselines, persist =>
          queueFor(userId).withSetExclusions(async excluded => {
            guard();
            if (saved.some(set => excluded.includes(`set:${sessionId.toLowerCase()}:${set.plan_item_id.toLowerCase()}:${set.set_index}`)))
              throw needsLegacyReview();
            await persist(excluded);
          }));
        if (expectedWorkout !== undefined) await workouts.withSnapshot(userId, expectedWorkout, capture, undefined, guard);
        else await capture();
        guard();
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error('Workout baseline read timed out. Your saved data is preserved.'));
        }, 15000);
      }),
    ]);
  } finally { if (timer !== undefined) clearTimeout(timer); }
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

async function hasRejectedSets(userId: string, sessionId: string) {
  requireAccount(userId);
  const generation = accountGeneration;
  const [rejected, blocked] = await Promise.all([queueFor(userId).rejected(), journalFor(userId).blocked()]);
  requireAccount(userId);
  if (generation !== accountGeneration) throw new Error('The workout account changed.');
  return rejected.some(entry => entry.operation.kind === 'set' && belongsToSession(entry.operation, sessionId))
    || blocked.some(entry => entry.write.sessionId === sessionId);
}
export async function queueCompletion(userId: string, sessionId: string, durationS: number) {
  if (await hasRejectedSets(userId, sessionId)) throw new Error('Review saved sets before finishing this workout.');
  await queueFor(userId).retryRejected(entry => entry.code === 'PTREVIEW' && entry.operation.kind === 'complete'
    && entry.operation.payload.sessionId === sessionId);
  return enqueue(userId, { id: `complete:${sessionId}`, kind: 'complete', payload: { sessionId, durationS } });
}

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

/** User-requested handoff of a durable local rest to explicit unknown-time recovery. */
export async function stageLegacyRestRecovery(userId: string, expected: SavedWorkout): Promise<RejectedOperation> {
  requireAccount(userId);
  const generation = accountGeneration;
  const guard = () => {
    requireAccount(userId);
    if (generation !== accountGeneration) throw new Error('The workout account changed.');
  };
  const local = JSON.parse(JSON.stringify(expected)) as SavedWorkout;
  const entry = local?.phase === 'resting' ? buildQueue(local.day)[local.cursor] : null;
  if (local?.ownerId !== userId || !entry || !local.savedDraft || !local.draft)
    throw new Error('This saved rest is unavailable for recovery.');
  const kg = displayToKg(local.draft.weight, local.units);
  const set: SetLog = { plan_item_id: entry.item.id.toLowerCase(), exercise_id: entry.item.exercise_id,
    set_index: entry.set, reps: local.draft.reps, weight_kg: local.draft.asBodyweight ? null : kg,
    is_bodyweight: local.draft.asBodyweight, added_load_kg: local.draft.asBodyweight ? kg : 0, rpe: null };
  const sessionId = local.sessionId.toLowerCase();
  const id = `set:${sessionId}:${set.plan_item_id}:${set.set_index}`;
  if (!validLegacyCapture({ id, sessionId, set })) throw new Error('Invalid local rest recovery capture.');
  const capture = await workouts.withSnapshot(userId, local, () => journalFor(userId).withUnknownSet(id,
    () => queueFor(userId).captureLegacyReview({ id, kind: 'set', payload: { sessionId, set } }, guard, local)), undefined, guard);
  guard();
  if (!legacyCapture(capture.operation)) throw new Error('The saved recovery data is invalid. Its data is preserved.');
  return capture;
}
export interface LegacySetConflictReview {
  ownerId: string;
  captured: RejectedOperation;
  rest?: SavedWorkout;
  saved: LegacySetCapture;
  server: SetWriteState | null;
  workout: SavedWorkout | null;
  accountGeneration: number;
}
const legacyCapture = (operation: OutboxOperation): LegacySetCapture | null => {
  if (operation.kind !== 'set' || operation.payload.write) return null;
  const value = { id: operation.id, sessionId: operation.payload.sessionId, set: operation.payload.set };
  return validLegacyCapture(value) ? value : null;
};
export async function getLegacySetConflicts(userId: string): Promise<RejectedOperation[]> {
  requireAccount(userId);
  const generation = accountGeneration;
  const [archive, pending, writes] = await Promise.all([
    queueFor(userId).rejected(), queueFor(userId).pending(), journalFor(userId).writes(),
  ]);
  requireAccount(userId);
  if (generation !== accountGeneration) throw new Error('The workout account changed.');
  const latest = new Map<string, RejectedOperation>();
  for (const entry of archive) latest.set(entry.operation.id, entry);
  const newer = new Set([...pending.map(operation => operation.id), ...writes.map(write => write.id)]);
  return [...latest.values()].filter(entry => needsReview(entry.code)
    && legacyCapture(entry.operation) !== null && !newer.has(entry.operation.id));
}
async function currentLegacyConflict(userId: string, captured: RejectedOperation) {
  const found = (await getLegacySetConflicts(userId)).find(entry => JSON.stringify(entry) === JSON.stringify(captured));
  if (!found) throw new Error('The saved set changed. Review the latest value.');
  return found;
}
export async function reviewLegacySetConflict(userId: string, captured: RejectedOperation): Promise<LegacySetConflictReview> {
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
        const current = await currentLegacyConflict(userId, captured);
        const saved = legacyCapture(current.operation)!;
        const rest = current.localRest;
        if (rest) {
          validateWorkout(rest, userId);
          const entry = rest.phase === 'resting' ? buildQueue(rest.day)[rest.cursor] : null;
          if (rest.sessionId !== saved.sessionId || !entry || entry.item.id !== saved.set.plan_item_id || entry.set !== saved.set.set_index)
            throw new Error('The saved rest recovery data is invalid. Its data is preserved.');
        }
        const { data, error } = await supabase.auth.getSession();
        guard();
        if (error) throw error;
        if (data.session?.user.id !== userId) throw new Error('The workout account changed.');
        const client = clientForAccessToken(data.session.access_token);
        const server = await getSetWriteState(saved.sessionId, saved.set.plan_item_id, saved.set.set_index, client, controller.signal);
        guard();
        const workout = await workouts.read(userId);
        await currentLegacyConflict(userId, captured);
        guard();
        return { ownerId: userId, captured: current, saved, server, workout, rest, accountGeneration: generation };
      })(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => {
        controller.abort(); reject(new Error('Workout conflict review timed out. Your saved data is preserved.'));
      }, 15000); }),
    ]);
  } finally { if (timer !== undefined) clearTimeout(timer); }
}
const confirmedLegacyTime = (value?: string): value is string => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === (value.includes('.') ? value : value.replace('Z', '.000Z'));
};
export async function resolveLegacySetConflict(userId: string, review: LegacySetConflictReview,
  choice: 'saved' | 'server', completedAt?: string) {
  requireAccount(userId);
  const generation = accountGeneration;
  const guard = () => {
    requireAccount(userId);
    if (generation !== accountGeneration || review.accountGeneration !== generation)
      throw new Error('The workout account changed. Review this set again.');
  };
  guard();
  if (review.ownerId !== userId || !['saved', 'server'].includes(choice)
    || JSON.stringify(review.rest) !== JSON.stringify(review.captured.localRest)
    || JSON.stringify(legacyCapture(review.captured.operation)) !== JSON.stringify(review.saved))
    throw new Error('Invalid legacy conflict choice.');
  const current = await currentLegacyConflict(userId, review.captured);
  guard();
  if (current.code === 'PT410') throw new Error('This workout is finalized. Your saved edit is preserved for review.');
  if (choice === 'server' && !review.server) throw new Error('There is no server set to choose.');
  if (choice === 'saved' && !confirmedLegacyTime(completedAt))
    throw new Error('Confirm the original completion time in UTC before keeping this older set.');
  const chosen = choice === 'server' ? review.server!.set : review.saved.set;
  const eventAt = choice === 'server' ? review.server!.eventAt : completedAt!;
  const local = review.workout;
  const entry = local ? buildQueue(local.day)[local.cursor] : null;
  let patch: WorkoutPatch | undefined;
  if (local?.sessionId === review.saved.sessionId && local.phase === 'resting'
    && entry?.item.id === chosen.plan_item_id && entry.set === chosen.set_index) {
    const kg = chosen.is_bodyweight ? chosen.added_load_kg : chosen.weight_kg;
    if (chosen.reps === null || kg === null) throw new Error('This set has incomplete reps or load. Your saved draft is preserved.');
    const draft = { reps: chosen.reps, weight: kgToDisplay(kg, local.units), asBodyweight: chosen.is_bodyweight };
    const previous = local.progress.find(row => row.exercise_id === chosen.exercise_id);
    patch = { draft, progress: [...local.progress.filter(row => row.exercise_id !== chosen.exercise_id),
      { exercise_id: chosen.exercise_id, last_weight_kg: kg, last_reps: chosen.reps,
        best_weight_kg: previous?.best_weight_kg ?? null, best_e1rm: previous?.best_e1rm ?? null,
        miss_streak: previous?.miss_streak ?? 0 }] };
  }
  const recoveryRest = review.rest ?? (patch ? local : null);
  await workouts.withSnapshot(userId, local, persistDraft => journalFor(userId).importLegacy(
    review.saved, chosen, review.server?.serverVersion ?? 0, eventAt,
    (write, persist) => queueFor(userId).replaceRejected(review.captured, async () => {
      guard(); await persist(); guard();
      return { id: write.id, kind: 'set', payload: { sessionId: write.sessionId, set: write.set, write } };
    }), async () => { guard(); await persistDraft(); guard(); },
    { saved: review.saved, server: review.server, choice, eventAt,
      ...(recoveryRest ? { draftCopy: { units: recoveryRest.units, draft: recoveryRest.draft, savedDraft: recoveryRest.savedDraft, bodyweightKg: recoveryRest.bodyweightKg } } : {}) }),
    patch, guard, patch ? { savedDraft: patch.draft } : undefined);
  guard();
  void flushAccount(userId).catch(() => undefined);
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
