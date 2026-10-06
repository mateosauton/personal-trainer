import type { WorkoutDraft } from './workout-store';
import type { SetLog } from '@/lib/types';
import type { OutboxStorage } from './outbox';

export interface JournalWrite {
  id: string;
  ownerId: string;
  sessionId: string;
  set: SetLog;
  origin: string;
  revision: number;
  expectedVersion: number;
  eventAt: string;
}
export interface BlockedWrite {
  write: JournalWrite;
  code: string;
}
export interface SetComparison {
  saved: JournalWrite;
  server: { set: SetLog; serverVersion: number; eventAt: string } | null;
  choice: 'saved' | 'server';
  draftCopy?: { units: 'kg' | 'lb'; draft: WorkoutDraft | null; savedDraft: WorkoutDraft | null; bodyweightKg?: number | null };
}
interface Entry {
  write: JournalWrite;
  status: 'pending' | 'blocked' | 'synced';
  code?: string;
  acknowledgedVersion: number;
}
interface SavedJournal {
  version: 1;
  ownerId: string;
  origin: string;
  entries: Entry[];
  recovery: BlockedWrite[];
  comparisons?: SetComparison[];
}
export type JournalLock = <T>(
  key: string,
  work: () => Promise<T>,
) => Promise<T>;
// Native instances in one JS runtime share this lock. The web transport must
// supply a Web Locks implementation to coordinate separate browser tabs.
const tails = new Map<string, Promise<void>>();
export const nativeJournalLock: JournalLock = (key, work) => {
  const result = (tails.get(key) ?? Promise.resolve()).then(work, work);
  const tail = result.then(
    () => undefined,
    () => undefined,
  );
  tails.set(key, tail);
  void tail.then(() => {
    if (tails.get(key) === tail) tails.delete(key);
  });
  return result;
};
const object = (v: unknown): v is Record<string, any> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
const safe = (v: unknown, min = 0): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= min;
const uuid = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const time = (v: unknown): v is string =>
  typeof v === 'string' && Number.isFinite(Date.parse(v));
const bounded = (v: unknown, max: number, integer = false) =>
  typeof v === 'number' &&
  Number.isFinite(v) &&
  v >= 0 &&
  v <= max &&
  (!integer || Number.isInteger(v));
export const validSet = (v: unknown): v is SetLog =>
  object(v) &&
  uuid(v.plan_item_id) &&
  typeof v.exercise_id === 'string' &&
  v.exercise_id.length > 0 &&
  v.exercise_id.length <= 500 &&
  bounded(v.set_index, 1000, true) &&
  v.set_index >= 1 &&
  (v.reps === null || bounded(v.reps, 1000, true)) &&
  (v.weight_kg === null || bounded(v.weight_kg, 100000)) &&
  typeof v.is_bodyweight === 'boolean' &&
  bounded(v.added_load_kg, 100000) &&
  (v.rpe === null || (bounded(v.rpe, 10, true) && v.rpe >= 1));
const idFor = (session: string, set: SetLog) =>
  `set:${session}:${set.plan_item_id}:${set.set_index}`;
const canonicalSet = (set: SetLog): SetLog => {
  if (!validSet(set)) throw new Error('Invalid saved set.');
  return {
    plan_item_id: set.plan_item_id.toLowerCase(),
    exercise_id: set.exercise_id,
    set_index: set.set_index,
    reps: set.reps,
    weight_kg: set.weight_kg,
    is_bodyweight: set.is_bodyweight,
    added_load_kg: set.added_load_kg,
    rpe: set.rpe,
  };
};
const validWrite = (v: unknown, owner: string): v is JournalWrite =>
  object(v) &&
  v.ownerId === owner &&
  uuid(v.sessionId) &&
  v.sessionId === v.sessionId.toLowerCase() &&
  validSet(v.set) &&
  v.set.plan_item_id === v.set.plan_item_id.toLowerCase() &&
  v.id === idFor(v.sessionId, v.set) &&
  uuid(v.origin) &&
  safe(v.revision, 1) &&
  safe(v.expectedVersion) &&
  time(v.eventAt);
const same = (a: JournalWrite, b: JournalWrite) =>
  JSON.stringify(a) === JSON.stringify(b);

const validDraftCopy = (value: unknown) => value === null || (object(value)
  && bounded(value.reps, 1000, true) && typeof value.weight === 'number'
  && Number.isFinite(value.weight) && value.weight >= 0 && typeof value.asBodyweight === 'boolean');
const validComparison = (value: unknown, owner: string): value is SetComparison =>
  object(value) && validWrite(value.saved, owner)
  && ['saved', 'server'].includes(value.choice)
  && (value.server === null || (object(value.server) && validSet(value.server.set)
    && idFor(value.saved.sessionId, value.server.set) === value.saved.id
    && safe(value.server.serverVersion, 1) && time(value.server.eventAt)))
  && (value.choice !== 'server' || value.server !== null)
  && (value.draftCopy === undefined || (object(value.draftCopy)
    && ['kg', 'lb'].includes(value.draftCopy.units)
    && validDraftCopy(value.draftCopy.draft) && validDraftCopy(value.draftCopy.savedDraft)
    && (value.draftCopy.bodyweightKg === undefined || value.draftCopy.bodyweightKg === null
      || (typeof value.draftCopy.bodyweightKg === 'number' && Number.isFinite(value.draftCopy.bodyweightKg)
        && value.draftCopy.bodyweightKg >= 0))));

/** Write-ahead recovery record: saving never depends on a network response. */
export class SetJournal {
  private readonly owner: string;
  private readonly key: string;
  constructor(
    private readonly storage: OutboxStorage,
    owner: string,
    private readonly randomUUID: () => string,
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly lock: JournalLock = nativeJournalLock,
  ) {
    if (!uuid(owner)) throw new Error('Invalid workout account.');
    this.owner = owner.toLowerCase();
    this.key = `office-gym.set-journal.v1.${this.owner}`;
  }
  private invalid(): never {
    throw new Error(
      'The saved set journal could not be read. Its data has been preserved.',
    );
  }
  private async read(): Promise<SavedJournal | null> {
    const raw = await this.storage.getItem(this.key);
    if (raw === null) return null;
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      return this.invalid();
    }
    if (
      !object(value) ||
      value.version !== 1 ||
      value.ownerId !== this.owner ||
      !uuid(value.origin) ||
      !Array.isArray(value.entries) ||
      !Array.isArray(value.recovery)
    )
      return this.invalid();
    if (
      !value.entries.every(
        (e: unknown) =>
          object(e) &&
          validWrite(e.write, this.owner) &&
          ['pending', 'blocked', 'synced'].includes(e.status) &&
          safe(e.acknowledgedVersion) &&
          (e.status !== 'blocked' ||
            (typeof e.code === 'string' && e.code.length > 0)),
      ) ||
      new Set(value.entries.map((e: Entry) => e.write.id)).size !==
        value.entries.length ||
      (value.comparisons !== undefined && (!Array.isArray(value.comparisons)
        || !value.comparisons.every((entry: unknown) => validComparison(entry, this.owner)))) ||
      !value.recovery.every(
        (e: unknown) =>
          object(e) &&
          validWrite(e.write, this.owner) &&
          typeof e.code === 'string' &&
          e.code.length > 0,
      )
    )
      return this.invalid();
    return value as unknown as SavedJournal;
  }
  private freshOrigin() {
    const value = this.randomUUID();
    if (!uuid(value)) throw new Error('Could not create a workout writer.');
    return value.toLowerCase();
  }
  private async persist(journal: SavedJournal) {
    await this.storage.setItem(this.key, JSON.stringify(journal));
  }
  private prepare(sessionId: string, set: SetLog, eventAt: string) {
    if (!uuid(sessionId) || !time(eventAt))
      throw new Error('Invalid workout or set event time.');
    return {
      sessionId: sessionId.toLowerCase(),
      set: canonicalSet(set),
      eventAt,
    };
  }
  async save(
    sessionId: string,
    set: SetLog,
    enqueue: (write: JournalWrite) => Promise<void>,
  ) {
    const input = this.prepare(sessionId, set, this.now());
    return this.lock(this.key, async () => {
      const journal = (await this.read()) ?? {
        version: 1,
        ownerId: this.owner,
        origin: this.freshOrigin(),
        entries: [],
        recovery: [],
      };
      const id = idFor(input.sessionId, input.set);
      const previous = journal.entries.find((e) => e.write.id === id);
      if (previous?.status === 'blocked')
        journal.recovery.push({ write: previous.write, code: previous.code! });
      const revision = (previous?.write.revision ?? 0) + 1;
      if (!safe(revision, 1)) throw new Error('Set revision limit reached.');
      const write: JournalWrite = {
        id,
        ownerId: this.owner,
        ...input,
        eventAt: previous?.write.eventAt ?? input.eventAt,
        origin: previous?.write.origin ?? journal.origin,
        revision,
        expectedVersion:
          previous?.acknowledgedVersion || previous?.write.expectedVersion || 0,
      };
      const entry: Entry = {
        write,
        status: 'pending',
        acknowledgedVersion: previous?.acknowledgedVersion ?? 0,
      };
      if (previous) journal.entries[journal.entries.indexOf(previous)] = entry;
      else journal.entries.push(entry);
      await this.persist(journal); // A crash after this point can reconstruct enqueue.
      await enqueue(write);
      return write;
    });
  }
  recover(enqueue: (write: JournalWrite) => Promise<void>) {
    return this.lock(this.key, async () => {
      for (const entry of (await this.read())?.entries ?? [])
        if (entry.status === 'pending') await enqueue(entry.write);
    });
  }
  pending() {
    return this.lock(this.key, async () =>
      ((await this.read())?.entries ?? [])
        .filter((e) => e.status === 'pending')
        .map((e) => e.write),
    );
  }
  blocked() {
    return this.lock(this.key, async () =>
      ((await this.read())?.entries ?? [])
        .filter((e) => e.status === 'blocked')
        .map((e) => ({ write: e.write, code: e.code! })),
    );
  }
  recoveryCopies() {
    return this.lock(this.key, async () => (await this.read())?.recovery ?? []);
  }
  acknowledge(
    write: JournalWrite,
    result: {
      status: 'applied' | 'duplicate' | 'superseded';
      serverVersion: number;
    },
  ) {
    if (
      !validWrite(write, this.owner) ||
      !['applied', 'duplicate', 'superseded'].includes(result.status) ||
      !safe(result.serverVersion, 1)
    )
      return Promise.reject(new Error('Invalid set acknowledgement.'));
    return this.lock(this.key, async () => {
      const journal = await this.read();
      const entry = journal?.entries.find(
        (e) => e.write.id === write.id && same(e.write, write),
      );
      if (!journal || !entry) return; // Never acknowledge a newer local correction.
      entry.status = 'synced';
      delete entry.code;
      if (result.status !== 'superseded')
        entry.acknowledgedVersion = result.serverVersion;
      await this.persist(journal);
    });
  }
  block(write: JournalWrite, code: string) {
    if (!validWrite(write, this.owner) || !code)
      return Promise.reject(new Error('Invalid set rejection.'));
    return this.lock(this.key, async () => {
      const journal = await this.read();
      const entry = journal?.entries.find(
        (e) => e.write.id === write.id && same(e.write, write),
      );
      if (!journal || !entry) return;
      entry.status = 'blocked';
      entry.code = code;
      await this.persist(journal);
    });
  }
  async resolve(
    captured: JournalWrite,
    set: SetLog,
    serverVersion: number,
    eventAt: string,
    enqueue: (write: JournalWrite) => Promise<void>,
    beforePersist: () => void | Promise<void> = () => {},
    comparison?: SetComparison,
  ) {
    const input = this.prepare(captured.sessionId, set, eventAt);
    if (
      !validWrite(captured, this.owner) ||
      !safe(serverVersion) ||
      idFor(input.sessionId, input.set) !== captured.id
    )
      return Promise.reject(new Error('Invalid conflict choice.'));
    if (comparison && (!validComparison(comparison, this.owner)
      || !same(comparison.saved, captured)
      || (comparison.server?.serverVersion ?? 0) !== serverVersion
      || JSON.stringify(canonicalSet(comparison.choice === 'server' ? comparison.server!.set : captured.set)) !== JSON.stringify(input.set)
      || (comparison.choice === 'server' ? comparison.server!.eventAt : captured.eventAt) !== eventAt))
      throw new Error('Invalid conflict comparison.');
    return this.lock(this.key, async () => {
      const journal = await this.read();
      const entry = journal?.entries.find((e) => e.write.id === captured.id);
      if (
        !journal ||
        !entry ||
        entry.status !== 'blocked' ||
        !same(entry.write, captured)
      )
        throw new Error('The saved set changed. Review the latest value.');
      const revision = captured.revision + 1;
      if (!safe(revision, 1)) throw new Error('Set revision limit reached.');
      // A new origin forces the server to check the displayed baseline even
      // when the rejected write came from this device's previous origin.
      const nextOrigin = this.freshOrigin();
      if (nextOrigin === captured.origin)
        throw new Error('Could not create a new workout writer.');
      const write: JournalWrite = {
        ...captured,
        ...input,
        origin: nextOrigin,
        revision,
        expectedVersion: serverVersion,
      };
      journal.recovery.push({ write: entry.write, code: entry.code! });
      entry.write = write;
      entry.status = 'pending';
      delete entry.code;
      entry.acknowledgedVersion = 0;
      if (comparison) (journal.comparisons ??= []).push(JSON.parse(JSON.stringify(comparison)));
      await beforePersist();
      await this.persist(journal);
      await enqueue(write);
      return write;
    });
  }
}
