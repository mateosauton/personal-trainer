import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ProgressRow } from '@/lib/db/queries';
import type { Plan } from '@/lib/types';
import { nativeJournalLock, type JournalLock } from './set-journal';
import { validSeconds } from './set-values';
import { storageLock } from './storage-lock';

interface Storage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}
export interface CachedPlan {
  plan: Plan;
  progress: ProgressRow[];
  /** Last confirmed rotation, retained while offline. */
  nextDayId?: string;
}
const keyFor = (owner: string) => `office-gym.plan-cache.v1.${owner}`;
const record = (value: unknown): value is Record<string, any> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string';
const id = (value: unknown): value is string => text(value) && value.length > 0;
const number = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const integer = (value: unknown, minimum = 0, maximum = 1000000) =>
  number(value) && Number.isInteger(value) && value >= minimum && value <= maximum;
const list = (value: unknown): value is any[] => Array.isArray(value) && value.length <= 100;
const nullableText = (value: unknown) => value === null || text(value);

function validPlan(value: unknown): value is Plan {
  return record(value) && id(value.id) && text(value.name) && text(value.split)
    && integer(value.weeks, 1) && list(value.days) && value.days.every((day) =>
      record(day) && id(day.id) && integer(day.day_index) && text(day.name) && text(day.focus)
      && list(day.blocks) && day.blocks.every((block) =>
        record(block) && id(block.id) && integer(block.block_index) && text(block.title)
        && ['warmup', 'straight', 'superset', 'circuit'].includes(block.kind)
        && integer(block.rounds, 1, 100) && number(block.rest_seconds)
        && (block.duration_seconds == null || number(block.duration_seconds))
        && list(block.items) && block.items.every((item) =>
          record(item) && id(item.id) && integer(item.item_index) && id(item.exercise_id)
          && integer(item.sets, 1, 100) && integer(item.reps_low, 0, 1000)
          && integer(item.reps_high, item.reps_low, 1000)
          && (item.seconds === null || validSeconds(item.seconds))
          && nullableText(item.tempo) && nullableText(item.notes))));
}
function validProgress(value: unknown): value is ProgressRow[] {
  return Array.isArray(value) && value.every((row) => record(row) && id(row.exercise_id)
    && integer(row.miss_streak) && ['last_weight_kg', 'last_reps', 'best_weight_kg', 'best_e1rm']
      .every((field) => row[field] === null || number(row[field])));
}
function validSnapshot(value: unknown, owner: string): value is CachedPlan & { ownerId: string; version: 1 } {
  return record(value) && id(owner) && value.ownerId === owner && value.version === 1
    && validPlan(value.plan) && validProgress(value.progress)
    && (value.nextDayId === undefined || value.plan.days.some((day) => day.id === value.nextDayId));
}

/** Account-scoped prescriptions, never a substitute for a saved workout. */
export class PlanCache {
  constructor(private readonly storage: Storage, private readonly lock: JournalLock = nativeJournalLock) {}
  private async load(owner: string): Promise<CachedPlan | null> {
    const raw = await this.storage.getItem(keyFor(owner));
    if (!raw) return null;
    try {
      const value: unknown = JSON.parse(raw);
      if (!validSnapshot(value, owner)) return null;
      return { plan: value.plan, progress: value.progress,
        ...(value.nextDayId === undefined ? {} : { nextDayId: value.nextDayId }) };
    } catch {
      // A corrupt cache is unusable, but leave its bytes available for diagnosis.
      return null;
    }
  }
  read(owner: string) {
    return this.lock(keyFor(owner), () => this.load(owner));
  }
  /** A refresh may publish only over the snapshot it observed before its network reads. */
  write(owner: string, plan: Plan, progress: ProgressRow[], nextDayId?: string, expected?: CachedPlan | null) {
    return this.lock(keyFor(owner), async () => {
      const previous = await this.load(owner);
      if (expected !== undefined && JSON.stringify(previous) !== JSON.stringify(expected)) return false;
      const rotation = nextDayId ?? (previous?.plan.id === plan.id ? previous.nextDayId : undefined);
      const snapshot = { version: 1, ownerId: owner, plan, progress,
        ...(rotation && plan.days.some((day) => day.id === rotation) ? { nextDayId: rotation } : {}) };
      if (!validSnapshot(snapshot, owner)) throw new Error('The saved plan could not be read.');
      await this.storage.setItem(keyFor(owner), JSON.stringify(snapshot));
      return true;
    });
  }
  /** Advance only the rotation that still points at this confirmed session's day. */
  advanceAfterSession(owner: string, dayId: string, progress?: ProgressRow[]) {
    return this.lock(keyFor(owner), async () => {
      if (progress !== undefined && !validProgress(progress))
        throw new Error('The saved plan could not be read.');
      const current = await this.load(owner);
      if (!current) return;
      let nextDayId = current.nextDayId;
      if (nextDayId === dayId) {
        const index = current.plan.days.findIndex((day) => day.id === dayId);
        if (index >= 0) nextDayId = current.plan.days[(index + 1) % current.plan.days.length].id;
      }
      if (nextDayId === current.nextDayId && progress === undefined) return;
      await this.storage.setItem(keyFor(owner), JSON.stringify({
        version: 1, ownerId: owner, ...current, nextDayId, progress: progress ?? current.progress,
      }));
    });
  }
  clear(owner: string, expected?: CachedPlan | null) {
    return this.lock(keyFor(owner), async () => {
      if (expected !== undefined && JSON.stringify(await this.load(owner)) !== JSON.stringify(expected)) return false;
      await this.storage.setItem(keyFor(owner), 'null');
      return true;
    });
  }
}
export const planCache = new PlanCache(AsyncStorage, storageLock);
