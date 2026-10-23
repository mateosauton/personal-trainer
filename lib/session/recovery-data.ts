import { nativeJournalLock, type JournalLock } from './set-journal';
import { validOperation, type OutboxStorage, type RejectedOperation } from './outbox';
import { validateWorkout, type SavedWorkout } from './workout-store';

const account = (owner: string) => {
  if (!/^[a-zA-Z0-9-]+$/.test(owner)) throw new Error('Invalid workout account.');
  return owner;
};
/** Exact account keys only. The unowned legacy global queue is never attributed to a user. */
export function recoveryKeys(ownerId: string): string[] {
  const owner = account(ownerId);
  return [
    `office-gym.profile.${owner}`,
    `office-gym.session-outbox.v2.${owner}`,
    `office-gym.session-outbox.v2.${owner}.rejected`,
    `office-gym.set-journal.v1.${owner}`,
    `office-gym.active-workout.v1.${owner}`,
    `office-gym.legacy-progress.v1.${owner}`,
    `office-gym.recovery-backups.v1.${owner}`,
    `office-gym.archived-workouts.v1.${owner}`,
    `office-gym.workout-lifecycle.v1.${owner}`,
    `office-gym.plan-cache.v1.${owner}`,
  ];
}
const lockKey = (key: string) => key.endsWith('.rejected') ? key.slice(0, -'.rejected'.length) : key;
/** Raw values deliberately survive broken JSON, so an export never silently omits damaged data. */
export async function readRecoveryData(storage: OutboxStorage, owner: string, lock: JournalLock = nativeJournalLock) {
  const records: Record<string, string | null> = {};
  for (const key of recoveryKeys(owner))
    records[key] = await lock(lockKey(key), () => storage.getItem(key));
  return { format_version: 1, account_id: owner, exported_at: new Date().toISOString(), records };
}

export interface QueueRepairReview {
  key: string;
  label: string;
  raw: string;
  recoverable: number;
  suggested: string | null;
}
const rejected = (entry: any) => entry && validOperation(entry.operation)
  && typeof entry.code === 'string' && typeof entry.resolved === 'boolean';
const parse = (raw: string): unknown => { try { return JSON.parse(raw); } catch { return undefined; } };

/** Repairs are local, reviewed and byte-preserving; no repaired payload is sent here. */
export class QueueDataRecovery {
  constructor(private readonly storage: OutboxStorage, private readonly owner: string,
    private readonly lock: JournalLock = nativeJournalLock) { account(owner); }
  private sources() {
    const queue = `office-gym.session-outbox.v2.${this.owner}`;
    return [
      { key: queue, label: 'Workout queue', valid: validOperation },
      { key: `${queue}.rejected`, label: 'Rejected workout updates', valid: rejected },
      { key: `office-gym.legacy-progress.v1.${this.owner}`, label: 'Older progression archive', valid: validOperation },
    ];
  }
  async inspect(): Promise<QueueRepairReview[]> {
    const damaged: QueueRepairReview[] = [];
    for (const source of this.sources()) {
      const raw = await this.lock(lockKey(source.key), () => this.storage.getItem(source.key));
      if (raw === null) continue;
      const value = parse(raw);
      if (Array.isArray(value) && value.every(source.valid)) continue;
      const readable = Array.isArray(value) ? value.filter(source.valid) : [];
      damaged.push({ key: source.key, label: source.label, raw, recoverable: readable.length,
        suggested: Array.isArray(value) ? JSON.stringify(readable, null, 2) : null });
    }
    return damaged;
  }
  async repair(review: QueueRepairReview, replacement: string, guard: () => void = () => {}) {
    const source = this.sources().find(entry => entry.key === review.key);
    if (!source) throw new Error('This saved data does not belong to the current account.');
    const candidate = parse(replacement);
    if (!Array.isArray(candidate) || !candidate.every(source.valid))
      throw new Error('The repair must be a valid JSON array of workout updates.');
    const original = parse(review.raw);
    // Retain every readable capture in its original order, including repeated corrections.
    let cursor = 0;
    for (const entry of Array.isArray(original) ? original.filter(source.valid) : []) {
      const encoded = JSON.stringify(entry);
      while (cursor < candidate.length && JSON.stringify(candidate[cursor]) !== encoded) cursor++;
      if (cursor === candidate.length) throw new Error('Keep every readable workout update in its original order.');
      cursor++;
    }
    await this.lock(lockKey(source.key), async () => {
      guard();
      if (await this.storage.getItem(source.key) !== review.raw)
        throw new Error('Your saved data changed. Review its latest copy.');
      const backupKey = `office-gym.recovery-backups.v1.${this.owner}`;
      await this.lock(backupKey, async () => {
        const raw = await this.storage.getItem(backupKey);
        const old = raw === null ? [] : parse(raw);
        // A damaged archive is itself preserved verbatim instead of blocking recovery forever.
        const backups = Array.isArray(old) ? old : [{ key: backupKey, raw, reason: 'unreadable-backup' }];
        guard();
        await this.storage.setItem(backupKey, JSON.stringify([...backups,
          { key: source.key, raw: review.raw, repairedAt: new Date().toISOString() }]));
      });
      guard();
      await this.storage.setItem(source.key, JSON.stringify(candidate));
    });
  }
}

interface ArchivedWorkout {
  ownerId: string;
  sessionId: string;
  archivedAt: string;
  workout: SavedWorkout;
  rejection: RejectedOperation;
  records: Record<string, string | null>;
}

/** Explicit local archive. Original queue and journal bytes remain in their own keys. */
export class RejectedWorkoutArchive {
  private readonly key: string;
  constructor(private readonly storage: OutboxStorage, private readonly owner: string,
    private readonly lock: JournalLock = nativeJournalLock) {
    this.key = `office-gym.archived-workouts.v1.${account(owner)}`;
  }
  private async read(): Promise<ArchivedWorkout[]> {
    const raw = await this.storage.getItem(this.key);
    if (raw === null) return [];
    const rows = parse(raw);
    if (!Array.isArray(rows)) throw new Error('The workout archive is unreadable. Its data is preserved.');
    for (const row of rows) {
      if (!row || row.ownerId !== this.owner || row.sessionId !== row.workout?.sessionId
        || !rejected(row.rejection) || row.rejection.operation.kind !== 'start'
        || row.rejection.operation.payload.sessionId !== row.sessionId
        || typeof row.archivedAt !== 'string' || !Number.isFinite(Date.parse(row.archivedAt))
        || !row.records || typeof row.records !== 'object' || Array.isArray(row.records)
        || Object.entries(row.records).some(([key, value]) => !recoveryKeys(this.owner).includes(key)
          || key === this.key || (value !== null && typeof value !== 'string')))
        throw new Error('The workout archive is invalid. Its data is preserved.');
      validateWorkout(row.workout, this.owner);
    }
    return rows;
  }
  ids(): Promise<Set<string>> {
    return this.lock(this.key, async () => new Set((await this.read()).map(row => row.sessionId)));
  }
  whileLive<T>(sessionId: string, action: () => Promise<T>): Promise<T> {
    return this.lock(this.key, async () => {
      if ((await this.read()).some(row => row.sessionId === sessionId))
        throw new Error('This workout is archived on this device. Its saved data is available for export.');
      return action();
    });
  }
  save(workout: SavedWorkout, rejection: RejectedOperation, records: Record<string, string | null>,
    guard: () => void = () => {}) {
    validateWorkout(workout, this.owner);
    if (!rejected(rejection) || rejection.resolved || rejection.operation.kind !== 'start'
      || rejection.operation.payload.sessionId !== workout.sessionId)
      throw new Error('Review the rejected workout again before archiving it.');
    const captured = JSON.parse(JSON.stringify({ workout, rejection, records })) as {
      workout: SavedWorkout; rejection: RejectedOperation; records: Record<string, string | null>;
    };
    // Never nest earlier archives inside each new recovery capture.
    delete captured.records[this.key];
    return this.lock(this.key, async () => {
      const previous = await this.read();
      guard();
      await this.storage.setItem(this.key, JSON.stringify([...previous, {
        ownerId: this.owner, sessionId: workout.sessionId, archivedAt: new Date().toISOString(), ...captured,
      }]));
    });
  }
}
