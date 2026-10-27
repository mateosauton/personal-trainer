import { MeasurementDrafts } from '@/lib/measurement-drafts';
import { displayToKg } from '@/lib/units';

describe('measurement drafts', () => {
  it('converts 78kg to about 172lb and round-trips the same mass', () => {
    const draft = MeasurementDrafts.fromCanonical('kg', 78, 180);
    const pounds = MeasurementDrafts.switchUnits(draft, 'lb');
    expect(pounds.blockedReason).toBeNull();
    expect(pounds.draft.massText).toBe('172');
    expect(pounds.draft.massKg).toBe(78);
    expect(pounds.draft.lengthText).toBe('70.9');
    expect(pounds.draft.lengthCm).toBe(180);

    const metric = MeasurementDrafts.switchUnits(pounds.draft, 'kg');
    expect(metric.draft.massText).toBe('78');
    expect(metric.draft.lengthText).toBe('180');
    expect(metric.draft.massKg).toBe(78);
    expect(metric.draft.lengthCm).toBe(180);
  });

  it('keeps an unsaved 90kg edit when the unit changes', () => {
    const stored = MeasurementDrafts.fromCanonical('kg', 78, null);
    const edited = MeasurementDrafts.editMass(stored, '90');
    const pounds = MeasurementDrafts.switchUnits(edited, 'lb');
    expect(pounds.draft.massText).toBe('198.4');
    expect(pounds.draft.massKg).toBe(90);
    const committed = MeasurementDrafts.commit(pounds.draft);
    expect(committed).toEqual({ ok: true, massKg: 90, lengthCm: null });
  });

  it('leaves empty measurements empty and refuses partial or invalid input', () => {
    const empty = MeasurementDrafts.switchUnits(MeasurementDrafts.fromCanonical('kg', null, null), 'lb');
    expect(empty.draft.massText).toBe('');
    expect(empty.draft.lengthText).toBe('');
    expect(MeasurementDrafts.commit(empty.draft)).toEqual({ ok: true, massKg: null, lengthCm: null });

    const partial = MeasurementDrafts.editMass(MeasurementDrafts.fromCanonical('kg', 78, null), '78.');
    const blocked = MeasurementDrafts.switchUnits(partial, 'lb');
    expect(blocked.blockedReason).toMatch(/clear it/i);
    expect(blocked.draft.units).toBe('kg');
    expect(blocked.draft.massText).toBe('78.');
    expect(blocked.draft.massKg).toBe(78);
    expect(MeasurementDrafts.commit(blocked.draft).ok).toBe(false);
    expect(MeasurementDrafts.parse('.').kind).toBe('partial');
    expect(MeasurementDrafts.parse(',').kind).toBe('partial');

    const invalid = MeasurementDrafts.editMass(MeasurementDrafts.fromCanonical('kg', 78, 180), 'abc');
    expect(MeasurementDrafts.commit(invalid).ok).toBe(false);
    expect(invalid.massKg).toBe(78);
  });

  it('treats a comma as a decimal separator', () => {
    const draft = MeasurementDrafts.editMass(MeasurementDrafts.fromCanonical('kg', null, null), '78,5');
    expect(draft.massKg).toBeCloseTo(78.5);
    const committed = MeasurementDrafts.commit(draft);
    expect(committed.ok).toBe(true);
    if (committed.ok) expect(committed.massKg).toBeCloseTo(78.5);
  });

  it('does not drift across repeated unit toggles', () => {
    let draft = MeasurementDrafts.fromCanonical('kg', 78, 180);
    for (let toggle = 0; toggle < 6; toggle += 1) {
      draft = MeasurementDrafts.switchUnits(draft, draft.units === 'kg' ? 'lb' : 'kg').draft;
    }
    expect(draft.massKg).toBe(78);
    expect(draft.lengthCm).toBe(180);
    expect(draft.massText).toBe('78');
    expect(draft.lengthText).toBe('180');
  });

  it('stores a typed pound value as kilograms without relabeling it', () => {
    const typed = MeasurementDrafts.editMass(MeasurementDrafts.fromCanonical('lb', null, null), '172');
    expect(typed.massKg).toBeCloseTo(displayToKg(172, 'lb'));
    const committed = MeasurementDrafts.commit(typed);
    expect(committed.ok).toBe(true);
    if (committed.ok) expect(committed.massKg).not.toBe(172);
  });
});
