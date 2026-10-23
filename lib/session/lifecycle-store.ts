import type { SessionSummaryLine } from '@/lib/db/queries';
import type { Units } from '@/lib/types';
import type { SavedWorkout } from './workout-store';
import { storageLock } from './storage-lock';

interface Storage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}
export interface LocalSessionReceipt {
  lines: SessionSummaryLine[];
  units: Units;
  durationS: number;
  calculationContextKnown?: boolean;
}
interface StoredReceipt extends LocalSessionReceipt { sessionId: string }
interface State {
  ownerId: string;
  sessionId: string;
  startIdentity?: string;
  receipt?: StoredReceipt;
}
const keyFor = (owner: string) => `office-gym.workout-lifecycle.v1.${owner}`;
const startIdentity = (workout: SavedWorkout) => JSON.stringify({ sessionId: workout.sessionId,
  dayId: workout.day.id, startedAtMs: workout.startedAtMs, start: workout.start });
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const finite = (value: unknown, minimum = 0): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= minimum;
const validLine = (value: unknown): value is SessionSummaryLine => object(value)
  && text(value.exerciseId) && text(value.name)
  && finite(value.sets, 1) && Number.isSafeInteger(value.sets)
  && finite(value.volumeKg) && (value.topLoadKg === null || finite(value.topLoadKg))
  && (value.seconds === undefined || (finite(value.seconds) && Number.isSafeInteger(value.seconds)))
  && (value.verdict === null || ['progress', 'hold', 'deload'].includes(value.verdict as string))
  && typeof value.isPr === 'boolean';
const validReceipt = (value: unknown): value is LocalSessionReceipt => object(value)
  && Array.isArray(value.lines) && value.lines.every(validLine)
  && ['kg', 'lb'].includes(value.units as string) && finite(value.durationS, 1)
  && (value.calculationContextKnown === undefined || typeof value.calculationContextKnown === 'boolean');
const invalid = (): never => {
  throw new Error('Workout recovery data is invalid. Its data is preserved.');
};

/** One small record per account: acknowledgement of its active start and latest receipt. */
export class LifecycleStore {
  constructor(private readonly storage: Storage) {}
  private async read(owner: string): Promise<State | null> {
    const raw = await this.storage.getItem(keyFor(owner));
    if (raw === null) return null;
    let state: unknown;
    try { state = JSON.parse(raw); } catch { throw new Error('Workout recovery data could not be read. Its data is preserved.'); }
    if (!object(state) || !text(owner) || state.ownerId !== owner || !text(state.sessionId)
      || (state.startIdentity !== undefined && !text(state.startIdentity))) return invalid();
    let receipt: StoredReceipt | undefined;
    if (state.receipt !== undefined) {
      if (!validReceipt(state.receipt)) return invalid();
      const receiptSession = (state.receipt as unknown as Record<string, unknown>).sessionId;
      if (receiptSession !== undefined && !text(receiptSession)) return invalid();
      // Earlier records tied the receipt to the active session. Normalize without rewriting disk.
      receipt = { ...state.receipt, sessionId: receiptSession as string | undefined ?? state.sessionId };
    }
    return { ownerId: owner, sessionId: state.sessionId,
      ...(state.startIdentity !== undefined ? { startIdentity: state.startIdentity as string } : {}),
      ...(receipt ? { receipt } : {}) };
  }
  async hasStarted(workout: SavedWorkout) {
    if (!workout.start) return true;
    const state = await this.read(workout.ownerId);
    return state?.sessionId === workout.sessionId && state.startIdentity === startIdentity(workout);
  }
  acknowledgeStart(workout: SavedWorkout) {
    const { ownerId, sessionId } = workout;
    if (!text(ownerId) || !text(sessionId)) return Promise.reject(new Error('Invalid workout identity. Its data is preserved.'));
    const identity = startIdentity(workout);
    return storageLock(keyFor(ownerId), async () => {
      const state = await this.read(ownerId);
      await this.storage.setItem(keyFor(ownerId), JSON.stringify({ ownerId, sessionId, startIdentity: identity,
        ...(state?.receipt ? { receipt: state.receipt } : {}) }));
    });
  }
  saveReceipt(workout: SavedWorkout, receipt: LocalSessionReceipt) {
    const { ownerId, sessionId } = workout;
    if (!text(ownerId) || !text(sessionId) || !validReceipt(receipt))
      return Promise.reject(new Error('Invalid workout receipt. Its data is preserved.'));
    const captured = JSON.parse(JSON.stringify(receipt)) as LocalSessionReceipt;
    return storageLock(keyFor(ownerId), async () => {
      const state = await this.read(ownerId);
      // A late receipt for A must not replace the acknowledged start of B.
      await this.storage.setItem(keyFor(ownerId), JSON.stringify({
        ...(state ?? { ownerId, sessionId }), receipt: { ...captured, sessionId },
      }));
    });
  }
  async getReceipt(owner: string, session: string): Promise<LocalSessionReceipt | null> {
    const state = await this.read(owner);
    const receipt = state?.receipt;
    return receipt?.sessionId === session
      ? { lines: receipt.lines, units: receipt.units, durationS: receipt.durationS,
        ...(receipt.calculationContextKnown === undefined ? {} : { calculationContextKnown: receipt.calculationContextKnown }) } : null;
  }
}
