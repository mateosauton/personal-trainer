import { validDraft, validSeconds, type WorkoutDraft } from './set-values';
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
export interface LegacySetCapture { id: string; sessionId: string; set: SetLog }
export interface LegacySetComparison {
  saved: LegacySetCapture;
  server: SetComparison['server'];
  choice: 'saved' | 'server';
  eventAt: string;
  draftCopy?: SetComparison['draftCopy'];
}
interface Entry {
  write: JournalWrite;
  status: 'pending' | 'blocked' | 'synced';
  code?: string;
  acknowledgedVersion: number;
}
export interface SetBaseline { set: SetLog; serverVersion: number; eventAt: string }
interface CapturedBaseline extends SetBaseline { sessionId: string; id: string }
interface SavedJournal {
  version: 1;
  ownerId: string;
  origin: string;
  entries: Entry[];
  recovery: BlockedWrite[];
  comparisons?: SetComparison[];
  legacyComparisons?: LegacySetComparison[];
  baselines?: CapturedBaseline[];
  capturedSessions?: string[];
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
  (v.seconds == null || (validSeconds(v.seconds) && v.reps === null)) &&
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
    ...(set.seconds != null ? { seconds: set.seconds } : {}),
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

const validDraftCopy = (value: unknown) => value === null || validDraft(value);
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

export const validLegacyCapture = (value: unknown): value is LegacySetCapture => object(value)
  && uuid(value.sessionId) && value.sessionId === value.sessionId.toLowerCase()
  && validSet(value.set) && value.set.plan_item_id === value.set.plan_item_id.toLowerCase()
  && value.id === idFor(value.sessionId, value.set);
const validLegacyComparison = (value: unknown, owner: string): value is LegacySetComparison => {
  if (!object(value) || !validLegacyCapture(value.saved) || !time(value.eventAt)) return false;
  // Reuse payload/context validation with a temporary validation-only shape.
  // The original capture is stored as-is without invented origin/revision/time metadata.
  const saved = { ...value.saved, ownerId: owner, origin: owner, revision: 1, expectedVersion: 0, eventAt: value.eventAt };
  return validComparison({ saved, server: value.server, choice: value.choice, draftCopy: value.draftCopy }, owner)
    && (value.choice !== 'server' || value.eventAt === value.server.eventAt);
};

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
      (value.legacyComparisons !== undefined && (!Array.isArray(value.legacyComparisons)
        || !value.legacyComparisons.every((entry: unknown) => validLegacyComparison(entry, this.owner)))) ||
      (value.capturedSessions !== undefined && (!Array.isArray(value.capturedSessions)
        || !value.capturedSessions.every((id: unknown) => uuid(id) && id === id.toLowerCase())
        || new Set(value.capturedSessions).size !== value.capturedSessions.length)) ||
      (value.baselines !== undefined && (!Array.isArray(value.baselines)
        || !value.baselines.every((entry: unknown) => object(entry)
          && uuid(entry.sessionId) && entry.sessionId === entry.sessionId.toLowerCase()
          && validSet(entry.set) && entry.id === idFor(entry.sessionId, entry.set)
          && safe(entry.serverVersion, 1) && time(entry.eventAt))
        || new Set(value.baselines.map((entry: CapturedBaseline) => entry.id)).size !== value.baselines.length)) ||
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
  /** Local-only recovery cannot replace an ordinary write or a known captured baseline. */
  withUnknownSet<T>(id: string, action: () => Promise<T>) {
    return this.lock(this.key, async () => {
      const journal = await this.read();
      if (journal?.entries.some(entry => entry.write.id === id)
        || journal?.baselines?.some(entry => entry.id === id))
        throw new Error('The saved set changed. Review its current value from Home.');
      return action();
    });
  }
  hasCapturedSession(sessionId: string) {
    if (!uuid(sessionId)) throw new Error('Invalid workout session.');
    return this.lock(this.key, async () =>
      (await this.read())?.capturedSessions?.includes(sessionId.toLowerCase()) ?? false);
  }
  /** Capture once: a later snapshot must never silently refresh a correction's baseline. */
  async captureBaselines(sessionId: string, values: SetBaseline[],
    publish: (persist: (excluded: string[]) => Promise<void>) => Promise<void> = persist => persist([]),
  ) {
    if (!uuid(sessionId) || !Array.isArray(values)) throw new Error('Invalid workout baselines.');
    const session = sessionId.toLowerCase();
    const captured = values.map(value => {
      if (!value || !safe(value.serverVersion, 1)) throw new Error('Invalid workout baseline.');
      const input = this.prepare(sessionId, value.set, value.eventAt);
      return { ...input, id: idFor(input.sessionId, input.set), serverVersion: value.serverVersion };
    });
    if (new Set(captured.map(value => value.id)).size !== captured.length)
      throw new Error('Duplicate workout baseline.');
    return this.lock(this.key, async () => {
      const journal: SavedJournal = (await this.read()) ?? {
        version: 1, ownerId: this.owner, origin: this.freshOrigin(), entries: [], recovery: [],
      };
      if (journal.capturedSessions?.includes(session)) return;
      const existing = new Set([
        ...journal.entries.map(entry => entry.write.id),
        ...(journal.baselines ?? []).map(entry => entry.id),
      ]);
      let persisted = false;
      await publish(async ids => {
        if (persisted) throw new Error('Workout baselines were already persisted.');
        const excluded = new Set(ids);
        const additions = captured.filter(entry => !existing.has(entry.id) && !excluded.has(entry.id));
        journal.capturedSessions = [...(journal.capturedSessions ?? []), session];
        journal.baselines = [...(journal.baselines ?? []), ...additions];
        await this.persist(journal);
        persisted = true;
      });
      if (!persisted) throw new Error('Workout baselines were not persisted.');
    });
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
      const baseline = journal.baselines?.find(entry => entry.id === id);
      if (previous?.status === 'blocked')
        journal.recovery.push({ write: previous.write, code: previous.code! });
      const revision = (previous?.write.revision ?? 0) + 1;
      if (!safe(revision, 1)) throw new Error('Set revision limit reached.');
      const write: JournalWrite = {
        id,
        ownerId: this.owner,
        ...input,
        eventAt: previous?.write.eventAt ?? baseline?.eventAt ?? input.eventAt,
        origin: previous?.write.origin ?? journal.origin,
        revision,
        expectedVersion:
          previous ? previous.acknowledgedVersion || previous.write.expectedVersion : baseline?.serverVersion ?? 0,
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
  writes() {
    return this.lock(this.key, async () => ((await this.read())?.entries ?? []).map(entry => entry.write));
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
  /** Convert only an explicit legacy choice; publication must validate its outbox capture. */
  async importLegacy(
    captured: LegacySetCapture, set: SetLog, serverVersion: number, eventAt: string,
    publish: (write: JournalWrite, persist: () => Promise<void>) => Promise<void>,
    beforePersist: () => void | Promise<void>, comparison: LegacySetComparison,
  ) {
    const input = this.prepare(captured.sessionId, set, eventAt);
    if (!validLegacyCapture(captured) || !safe(serverVersion) || idFor(input.sessionId, input.set) !== captured.id
      || !validLegacyComparison(comparison, this.owner)
      || JSON.stringify(comparison.saved) !== JSON.stringify(captured)
      || (comparison.server?.serverVersion ?? 0) !== serverVersion || comparison.eventAt !== eventAt
      || JSON.stringify(canonicalSet(comparison.choice === 'server' ? comparison.server!.set : captured.set)) !== JSON.stringify(input.set))
      throw new Error('Invalid legacy conflict choice.');
    const copy = JSON.parse(JSON.stringify(comparison)) as LegacySetComparison;
    return this.lock(this.key, async () => {
      const journal: SavedJournal = (await this.read()) ?? {
        version: 1, ownerId: this.owner, origin: this.freshOrigin(), entries: [], recovery: [],
      };
      if (journal.entries.some(entry => entry.write.id === copy.saved.id))
        throw new Error('The saved set changed. Review the latest value.');
      const write: JournalWrite = { id: copy.saved.id, ownerId: this.owner, ...input,
        origin: this.freshOrigin(), revision: 1, expectedVersion: serverVersion };
      journal.entries.push({ write, status: 'pending', acknowledgedVersion: 0 });
      (journal.legacyComparisons ??= []).push(copy);
      let persisted = false;
      await publish(write, async () => {
        if (persisted) return;
        await beforePersist();
        await this.persist(journal);
        persisted = true;
      });
      if (!persisted) throw new Error('The legacy choice was not saved. Its original data is preserved.');
      return write;
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
