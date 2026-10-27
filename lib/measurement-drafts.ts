import type { Units } from './types';
import { cmToDisplay, displayToCm, displayToKg, kgToDisplay } from './units';

export type ParsedDraft =
  | { kind: 'empty' }
  | { kind: 'partial' }
  | { kind: 'invalid' }
  | { kind: 'complete'; value: number };

export interface MeasurementDraft {
  units: Units;
  massText: string;
  lengthText: string;
  /** Canonical kilograms. Display text is rounded; this value is not. */
  massKg: number | null;
  /** Canonical centimeters. Display text is rounded; this value is not. */
  lengthCm: number | null;
}

export type CommittedMeasurements =
  | { ok: true; massKg: number | null; lengthCm: number | null }
  | { ok: false; reason: string };

/**
 * Measurement text the person is editing, kept apart from the saved profile.
 * Unit changes reformat the canonical kg/cm value. Partial numbers stay put
 * so a trailing separator cannot become zero or a different measurement.
 */
export class MeasurementDrafts {
  static parse(text: string): ParsedDraft {
    const trimmed = text.trim();
    if (trimmed === '') return { kind: 'empty' };
    if (trimmed.includes(',') && trimmed.includes('.')) return { kind: 'invalid' };
    const separator = trimmed.includes(',') ? ',' : trimmed.includes('.') ? '.' : null;
    if (separator && trimmed.split(separator).length > 2) return { kind: 'invalid' };
    if (/^\d*[.,]$/.test(trimmed)) return { kind: 'partial' };
    if (!/^\d+([.,]\d+)?$/.test(trimmed) && !/^[.,]\d+$/.test(trimmed)) return { kind: 'invalid' };
    const value = Number.parseFloat(trimmed.replace(',', '.'));
    if (!Number.isFinite(value) || value < 0) return { kind: 'invalid' };
    return { kind: 'complete', value };
  }

  static formatNumber(value: number): string {
    const rounded = Math.round(value * 10) / 10;
    return rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(1);
  }

  static formatMass(kg: number, units: Units): string {
    return MeasurementDrafts.formatNumber(kgToDisplay(kg, units));
  }

  static formatLength(cm: number, units: Units): string {
    const shown = cmToDisplay(cm, units);
    return MeasurementDrafts.formatNumber(units === 'kg' ? Math.round(shown) : shown);
  }

  static fromCanonical(units: Units, massKg: number | null, lengthCm: number | null): MeasurementDraft {
    return {
      units,
      massKg,
      lengthCm,
      massText: massKg == null ? '' : MeasurementDrafts.formatMass(massKg, units),
      lengthText: lengthCm == null ? '' : MeasurementDrafts.formatLength(lengthCm, units),
    };
  }

  static editMass(draft: MeasurementDraft, text: string): MeasurementDraft {
    return MeasurementDrafts.edit(draft, 'mass', text);
  }

  static editLength(draft: MeasurementDraft, text: string): MeasurementDraft {
    return MeasurementDrafts.edit(draft, 'length', text);
  }

  static switchUnits(draft: MeasurementDraft, next: Units): { draft: MeasurementDraft; blockedReason: string | null } {
    if (next === draft.units) return { draft, blockedReason: null };
    const mass = MeasurementDrafts.parse(draft.massText);
    const length = MeasurementDrafts.parse(draft.lengthText);
    if (mass.kind === 'partial' || mass.kind === 'invalid' || length.kind === 'partial' || length.kind === 'invalid') {
      return {
        draft,
        blockedReason: 'Finish the number or clear it before switching units.',
      };
    }
    const massKg = mass.kind === 'empty' ? null : draft.massKg ?? displayToKg(mass.value, draft.units);
    const lengthCm = length.kind === 'empty' ? null : draft.lengthCm ?? displayToCm(length.value, draft.units);
    return { draft: MeasurementDrafts.fromCanonical(next, massKg, lengthCm), blockedReason: null };
  }

  static commit(draft: MeasurementDraft): CommittedMeasurements {
    const mass = MeasurementDrafts.parse(draft.massText);
    const length = MeasurementDrafts.parse(draft.lengthText);
    if (mass.kind === 'partial' || mass.kind === 'invalid') {
      return { ok: false, reason: 'Enter a bodyweight or leave it blank.' };
    }
    if (length.kind === 'partial' || length.kind === 'invalid') {
      return { ok: false, reason: 'Enter a height or leave it blank.' };
    }
    return {
      ok: true,
      massKg: mass.kind === 'empty' ? null : draft.massKg ?? displayToKg(mass.value, draft.units),
      lengthCm: length.kind === 'empty' ? null : draft.lengthCm ?? displayToCm(length.value, draft.units),
    };
  }

  private static edit(draft: MeasurementDraft, field: 'mass' | 'length', text: string): MeasurementDraft {
    const parsed = MeasurementDrafts.parse(text);
    if (field === 'mass') {
      if (parsed.kind === 'empty') return { ...draft, massText: text, massKg: null };
      if (parsed.kind === 'complete') return { ...draft, massText: text, massKg: displayToKg(parsed.value, draft.units) };
      return { ...draft, massText: text };
    }
    if (parsed.kind === 'empty') return { ...draft, lengthText: text, lengthCm: null };
    if (parsed.kind === 'complete') return { ...draft, lengthText: text, lengthCm: displayToCm(parsed.value, draft.units) };
    return { ...draft, lengthText: text };
  }
}
