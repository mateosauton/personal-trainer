import { SetEntry } from '@/lib/session/set-entry';
import { validDraft, type WorkoutDraft } from '@/lib/session/set-values';

const reps = (overrides: Partial<WorkoutDraft> = {}): WorkoutDraft => ({
  reps: 8, weight: 20, asBodyweight: false, ...overrides,
});

describe('set entry', () => {
  it('corrects a failed attempt to zero reps and keeps that draft valid', () => {
    const failed = SetEntry.nudgeMeasurement(reps({ reps: 1 }), -1);
    expect(failed.reps).toBe(0);
    expect(SetEntry.nudgeMeasurement(failed, -1).reps).toBe(0);
    expect(SetEntry.commitMeasurement(failed, '0')).toBe(failed);
    expect(validDraft(failed)).toBe(true);
    expect(SetEntry.commitMeasurement(reps(), '0')).toEqual(reps({ reps: 0 }));
  });

  it('edits a timed set in seconds and does not turn it back into reps', () => {
    const timed = reps({ reps: 0, seconds: 60, weight: 0 });
    expect(SetEntry.commitMeasurement(timed, '45')).toEqual({ ...timed, seconds: 45 });
    expect(SetEntry.nudgeMeasurement(timed, -1)).toEqual({ ...timed, seconds: 59 });
    expect(SetEntry.nudgeMeasurement({ ...timed, seconds: 1 }, -1).seconds).toBe(1);
    expect(SetEntry.commitMeasurement(timed, '0')).toBeNull();
    expect(SetEntry.commitMeasurement(timed, '86401')).toBeNull();
    expect(SetEntry.repsFromText('0')).toBe(0);
    expect(SetEntry.secondsFromText('45')).toBe(45);
  });

  it('accepts 12.5 kg or lb and plate-steps added load without a negative weight', () => {
    expect(SetEntry.weightFromText('12.5')).toBe(12.5);
    expect(SetEntry.weightFromText('12,5')).toBe(12.5);
    expect(SetEntry.commitWeight(reps(), '12.5')).toEqual(reps({ weight: 12.5 }));
    const added = reps({ reps: 5, weight: 0, asBodyweight: true });
    expect(SetEntry.nudgeWeight(added, 'kg', 1)).toMatchObject({ weight: 2.5, asBodyweight: true, reps: 5 });
    expect(SetEntry.nudgeWeight(added, 'kg', -1).weight).toBe(0);
    expect(SetEntry.nudgeWeight(added, 'lb', 1).weight).toBe(5);
    expect(SetEntry.formatDecimal(12.5)).toBe('12.5');
    expect(SetEntry.formatDecimal(60)).toBe('60');
  });

  it('refuses partial or invalid text so the last valid draft is not replaced', () => {
    const saved = reps();
    for (const text of ['', '12.', '.', '12.25', '-1', '1e2', 'abc']) {
      expect(SetEntry.commitWeight(saved, text)).toBeNull();
    }
    expect(SetEntry.commitMeasurement(saved, '')).toBeNull();
    expect(SetEntry.commitMeasurement(saved, '1001')).toBeNull();
    expect(SetEntry.commitMeasurement(saved, '8.5')).toBeNull();
    expect(SetEntry.commitMeasurement(saved, '8')).toBe(saved);
    expect(SetEntry.weightError()).toMatch(/saved set stays/);
    expect(SetEntry.measurementError(saved)).toMatch(/0 to 1000/);
    expect(SetEntry.measurementError(reps({ reps: 0, seconds: 60 }))).toMatch(/seconds/);
  });

  it('names each control and applies rapid nudges one step at a time', () => {
    expect(SetEntry.fieldName('reps', 'kg', false)).toBe('Repetitions');
    expect(SetEntry.fieldName('seconds', 'lb', false)).toBe('Duration in seconds');
    expect(SetEntry.fieldName('weight', 'kg', true)).toBe('Added load in kg');
    expect(SetEntry.adjustName('Decrease', 'Repetitions')).toBe('Decrease repetitions');
    expect(SetEntry.adjustName('Increase', 'Added load in kg')).toBe('Increase added load in kg');

    let draft = reps({ reps: 3 });
    for (let tap = 0; tap < 5; tap += 1) draft = SetEntry.nudgeMeasurement(draft, -1);
    expect(draft.reps).toBe(0);
    draft = SetEntry.nudgeMeasurement(reps({ reps: 998 }), 1);
    draft = SetEntry.nudgeMeasurement(draft, 1);
    draft = SetEntry.nudgeMeasurement(draft, 1);
    expect(draft.reps).toBe(1000);
  });
});
