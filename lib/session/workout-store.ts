import type { ProgressRow } from '@/lib/db/queries';
import type { PlanDay, Units } from '@/lib/types';
import { buildQueue } from './queue';
import { nativeJournalLock, type JournalLock } from './set-journal';

import { validDraft, validSeconds, type WorkoutDraft } from './set-values';
export type { WorkoutDraft } from './set-values';
export interface SavedWorkout {
  version: 1;
  recoveryCopies?: Pick<SavedWorkout, 'cursor' | 'phase' | 'draft' | 'savedDraft' | 'progress' | 'restUntilMs' | 'endedAtMs'>[];
  ownerId: string;
  sessionId: string;
  day: PlanDay;
  units: Units;
  /** Absent only in older saved workouts; null means unknown at capture time. */
  bodyweightKg?: number | null;
  progress: ProgressRow[];
  cursor: number;
  phase: 'work' | 'resting';
  draft: WorkoutDraft | null;
  savedDraft: WorkoutDraft | null;
  restUntilMs: number | null;
  startedAtMs: number;
  endedAtMs: number | null;
}
interface Storage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}
export type WorkoutPatch = Partial<
  Pick<
    SavedWorkout,
    | 'progress'
    | 'cursor'
    | 'phase'
    | 'draft'
    | 'savedDraft'
    | 'restUntilMs'
    | 'endedAtMs'
  >
>;

const keyFor = (owner: string) => `office-gym.active-workout.v1.${owner}`;
const record = (value: unknown): value is Record<string, any> =>
  value != null && typeof value === 'object' && !Array.isArray(value);
const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
const integer = (value: unknown, min = 0, max = 100) =>
  finite(value) && Number.isInteger(value) && value >= min && value <= max;
const text = (value: unknown) => typeof value === 'string' && value.length > 0;


export function validateWorkout(
  value: unknown,
  owner: string,
): asserts value is SavedWorkout {
  const invalid = () => {
    throw new Error(
      'The saved workout could not be read. Its data has been preserved.',
    );
  };
  if (
    !record(value) ||
    value.version !== 1 ||
    value.ownerId !== owner ||
    !text(owner) ||
    !text(value.sessionId) ||
    !record(value.day) ||
    !text(value.day.id) ||
    !Array.isArray(value.day.blocks) ||
    value.day.blocks.length > 100 ||
    !['kg', 'lb'].includes(value.units) ||
    (value.bodyweightKg !== undefined &&
      value.bodyweightKg !== null &&
      (!finite(value.bodyweightKg) || value.bodyweightKg < 0)) ||
    !integer(value.cursor, 0, 1000000) ||
    !['work', 'resting'].includes(value.phase) ||
    !finite(value.startedAtMs) ||
    value.startedAtMs < 0 ||
    (value.endedAtMs !== null &&
      (!finite(value.endedAtMs) || value.endedAtMs < value.startedAtMs)) ||
    !Array.isArray(value.progress)
  )
    return invalid();
  if (value.recoveryCopies !== undefined) {
    if (!Array.isArray(value.recoveryCopies)) return invalid();
    for (const copy of value.recoveryCopies) {
      if (!record(copy)) return invalid();
      validateWorkout({ ...value, ...copy, recoveryCopies: undefined }, owner);
    }
  }
  for (const b of value.day.blocks) {
    if (
      !record(b) ||
      !text(b.id) ||
      !['warmup', 'straight', 'superset', 'circuit'].includes(b.kind) ||
      !integer(b.rounds, 1) ||
      !finite(b.rest_seconds) ||
      b.rest_seconds < 0 ||
      !Array.isArray(b.items) ||
      b.items.length > 100
    )
      return invalid();
    for (const i of b.items)
      if (
        !record(i) ||
        !text(i.id) ||
        !text(i.exercise_id) ||
        !integer(i.sets, 1) ||
        !integer(i.reps_low, 0, 1000) ||
        !integer(i.reps_high, 0, 1000) ||
        (i.seconds != null && !validSeconds(i.seconds))
      )
        return invalid();
  }
  for (const p of value.progress)
    if (
      !record(p) ||
      !text(p.exercise_id) ||
      !integer(p.miss_streak, 0, 1000000) ||
      !['last_weight_kg', 'last_reps', 'best_weight_kg', 'best_e1rm'].every(
        (k) => p[k] === null || finite(p[k]),
      )
    )
      return invalid();
  if (
    buildQueue(value.day as unknown as PlanDay).length === 0 ||
    value.cursor > buildQueue(value.day as unknown as PlanDay).length ||
    (value.cursor === buildQueue(value.day as unknown as PlanDay).length) !==
      (value.endedAtMs !== null) ||
    (value.draft !== null && !validDraft(value.draft)) ||
    (value.savedDraft !== null && !validDraft(value.savedDraft)) ||
    (value.restUntilMs !== null && !finite(value.restUntilMs)) ||
    (value.phase === 'resting' &&
      (value.draft === null ||
        value.savedDraft === null ||
        value.restUntilMs === null))
  )
    return invalid();
}

/** Serialized local transitions; every owner has an independent disk key. */
export class WorkoutStore {
  constructor(private readonly storage: Storage, private readonly lock: JournalLock = nativeJournalLock) {}
  private exclusive<T>(owner: string, action: () => Promise<T>): Promise<T> {
    return this.lock(keyFor(owner), action);
  }
  /** Serialize a reviewed snapshot with its set write; no network acknowledgement is awaited. */
  withSnapshot<T>(owner: string, expected: SavedWorkout | null,
    action: (persistDraft: () => Promise<void>) => Promise<T>,
    patch?: WorkoutPatch, guard: () => void = () => {}, finalPatch?: WorkoutPatch) {
    return this.exclusive(owner, async () => {
      const current = await this.load(owner);
      if (JSON.stringify(current) !== JSON.stringify(expected))
        throw new Error('Your workout changed. Review the latest value from Home.');
      guard();
      let next = current;
      let persisted = false;
      const persistDraft = async () => {
        guard();
        if (!patch || !current || persisted) return;
        const copy = { cursor: current.cursor, phase: current.phase, draft: current.draft,
          savedDraft: current.savedDraft, progress: current.progress, restUntilMs: current.restUntilMs,
          endedAtMs: current.endedAtMs };
        next = { ...current, ...patch, recoveryCopies: [...(current.recoveryCopies ?? []), copy] };
        validateWorkout(next, owner);
        await this.storage.setItem(keyFor(owner), JSON.stringify(next));
        persisted = true;
      };
      // The journal calls this hook only after checking its exact blocked entry
      // under its own lock. Until its write is durable, savedDraft remains unchanged.
      const result = await action(persistDraft);
      guard();
      if (persisted && next && finalPatch) {
        const finished = { ...next, ...finalPatch };
        validateWorkout(finished, owner);
        await this.storage.setItem(keyFor(owner), JSON.stringify(finished));
      }
      return result;
    });
  }
  private async load(owner: string): Promise<SavedWorkout | null> {
    const raw = await this.storage.getItem(keyFor(owner));
    if (!raw || raw === 'null') return null;
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      throw new Error(
        'The saved workout could not be read. Its data has been preserved.',
      );
    }
    validateWorkout(value, owner);
    return value;
  }
  read(owner: string) {
    return this.exclusive(owner, () => this.load(owner));
  }
  create(workout: SavedWorkout) {
    return this.exclusive(workout.ownerId, async () => {
      const existing = await this.load(workout.ownerId);
      if (existing) {
        if (existing.sessionId !== workout.sessionId)
          throw new Error(
            'Resume your unfinished workout from Home before starting another.',
          );
        return existing;
      }
      validateWorkout(workout, workout.ownerId);
      await this.storage.setItem(
        keyFor(workout.ownerId),
        JSON.stringify(workout),
      );
      return workout;
    });
  }
  update(
    owner: string,
    session: string,
    expected: { cursor: number; phase: SavedWorkout['phase']; snapshot?: SavedWorkout },
    patch: WorkoutPatch,
  ) {
    return this.exclusive(owner, async () => {
      const current = await this.load(owner);
      if (
        !current ||
        current.sessionId !== session ||
        current.cursor !== expected.cursor ||
        current.phase !== expected.phase
        || (expected.snapshot !== undefined && JSON.stringify(current) !== JSON.stringify(expected.snapshot))
      )
        throw new Error('Your workout changed. Reopen it from Home.');
      const next = { ...current, ...patch };
      validateWorkout(next, owner);
      await this.storage.setItem(keyFor(owner), JSON.stringify(next));
      return next;
    });
  }
  clear(owner: string, session: string) {
    return this.exclusive(owner, async () => {
      const current = await this.load(owner);
      if (current?.sessionId === session)
        await this.storage.setItem(keyFor(owner), 'null');
    });
  }
}
