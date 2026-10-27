import type { Units } from '@/lib/types';
import { step } from '@/lib/units';

import type { WorkoutDraft } from './set-values';

/**
 * Parsing and nudges for the rest correction and the suggested-load field.
 * A blank, partial, or out-of-range string returns null so the caller can
 * keep the last valid draft on the existing ordered write path.
 */
export class SetEntry {
  static parseDecimal(text: string): number | null {
    const normalized = text.trim().replace(',', '.');
    if (!/^\d+(\.\d)?$/.test(normalized)) return null;
    const value = Number(normalized);
    return Number.isFinite(value) ? value : null;
  }

  static weightFromText(text: string): number | null {
    const value = SetEntry.parseDecimal(text);
    return value == null || value < 0 ? null : value;
  }

  static parseInteger(text: string, min: number, max: number): number | null {
    const normalized = text.trim();
    if (!/^\d+$/.test(normalized)) return null;
    const value = Number(normalized);
    if (!Number.isInteger(value) || value < min || value > max) return null;
    return value;
  }

  static repsFromText(text: string): number | null {
    return SetEntry.parseInteger(text, 0, 1000);
  }

  static secondsFromText(text: string): number | null {
    return SetEntry.parseInteger(text, 1, 86400);
  }

  static formatDecimal(value: number): string {
    if (!Number.isFinite(value)) return '';
    const rounded = Math.round(value * 10) / 10;
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  }

  static measurementError(draft: WorkoutDraft): string {
    return draft.seconds != null
      ? 'Enter whole seconds from 1 to 86400. The saved set stays until this is valid.'
      : 'Enter whole reps from 0 to 1000. The saved set stays until this is valid.';
  }

  static weightError(): string {
    return 'Enter a weight of 0 or more, with at most one decimal. The saved set stays until this is valid.';
  }

  static fieldName(kind: 'reps' | 'seconds' | 'weight', units: Units, added: boolean): string {
    if (kind === 'reps') return 'Repetitions';
    if (kind === 'seconds') return 'Duration in seconds';
    return `${added ? 'Added load' : 'Weight'} in ${units}`;
  }

  static adjustName(direction: 'Increase' | 'Decrease', field: string): string {
    return `${direction} ${field.charAt(0).toLowerCase()}${field.slice(1)}`;
  }

  static applyMeasurement(draft: WorkoutDraft, value: number): WorkoutDraft {
    return draft.seconds != null
      ? { ...draft, reps: 0, seconds: value }
      : { ...draft, reps: value };
  }

  static nudgeMeasurement(draft: WorkoutDraft, delta: number): WorkoutDraft {
    if (draft.seconds != null) {
      const seconds = Math.min(86400, Math.max(1, draft.seconds + delta));
      return { ...draft, reps: 0, seconds };
    }
    const reps = Math.min(1000, Math.max(0, draft.reps + delta));
    return { ...draft, reps };
  }

  static nudgeWeight(draft: WorkoutDraft, units: Units, direction: -1 | 1): WorkoutDraft {
    const weight = Math.max(0, Math.round((draft.weight + step(units) * direction) * 10) / 10);
    return { ...draft, weight };
  }

  /** Same draft when the text is already saved; null when it must not be written. */
  static commitMeasurement(draft: WorkoutDraft, text: string): WorkoutDraft | null {
    const value = draft.seconds != null ? SetEntry.secondsFromText(text) : SetEntry.repsFromText(text);
    if (value == null) return null;
    const next = SetEntry.applyMeasurement(draft, value);
    if (next.reps === draft.reps && (next.seconds ?? null) === (draft.seconds ?? null)) return draft;
    return next;
  }

  static commitWeight(draft: WorkoutDraft, text: string): WorkoutDraft | null {
    const weight = SetEntry.weightFromText(text);
    if (weight == null) return null;
    if (weight === draft.weight) return draft;
    return { ...draft, weight };
  }
}
