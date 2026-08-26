import { nextLoad, incrementKg } from '@/lib/progression';
import { effectiveLoadKg, estimateOneRepMax, displayToKg, kgToDisplay } from '@/lib/units';

const fresh = { last_weight_kg: 60, miss_streak: 0 };

describe('nextLoad', () => {
  it('adds weight when every set tops the range at a manageable effort', () => {
    const r = nextLoad([{ reps: 10, rpe: 7 }, { reps: 10, rpe: 8 }], 10, 6, 'h_push', 60, fresh);
    expect(r.verdict).toBe('progress');
    expect(r.last_weight_kg).toBe(62.5);
  });

  it('steps lower body in bigger jumps than upper body', () => {
    expect(incrementKg('squat')).toBe(5);
    expect(incrementKg('biceps')).toBe(2.5);
    const legs = nextLoad([{ reps: 10, rpe: 7 }], 10, 6, 'squat', 100, fresh);
    expect(legs.last_weight_kg).toBe(105);
  });

  it('holds when the top of the range came at a hard effort', () => {
    const r = nextLoad([{ reps: 10, rpe: 9 }], 10, 6, 'h_push', 60, fresh);
    expect(r.verdict).toBe('hold');
    expect(r.last_weight_kg).toBe(60);
  });

  it('holds once, then deloads on a second miss', () => {
    const first = nextLoad([{ reps: 4, rpe: 9 }], 10, 6, 'h_push', 60, fresh);
    expect(first.verdict).toBe('hold');
    expect(first.miss_streak).toBe(1);

    const second = nextLoad([{ reps: 4, rpe: 9 }], 10, 6, 'h_push', 60, first as never);
    expect(second.verdict).toBe('deload');
    expect(second.last_weight_kg).toBe(55);
    expect(second.miss_streak).toBe(0);
  });

  it('treats an unreported RPE as manageable', () => {
    const r = nextLoad([{ reps: 10, rpe: null }], 10, 6, 'h_push', 60, fresh);
    expect(r.verdict).toBe('progress');
  });

  it('does nothing without logged reps or a known load', () => {
    expect(nextLoad([], 10, 6, 'h_push', 60, fresh).verdict).toBeNull();
    expect(nextLoad([{ reps: 10, rpe: 7 }], 10, 6, 'h_push', null, fresh).verdict).toBeNull();
  });
});

describe('load maths', () => {
  it('adds bodyweight to added load for bodyweight movements', () => {
    const set = { is_bodyweight: true, weight_kg: null, added_load_kg: 20 };
    expect(effectiveLoadKg(set, 80)).toBe(100);
  });

  it('uses plain bodyweight when nothing is hanging off the belt', () => {
    expect(effectiveLoadKg({ is_bodyweight: true, weight_kg: null, added_load_kg: 0 }, 80)).toBe(80);
  });

  it('cannot compute a bodyweight load without a bodyweight', () => {
    expect(effectiveLoadKg({ is_bodyweight: true, weight_kg: null, added_load_kg: 20 }, null)).toBeNull();
  });

  it('uses the bar weight for external load', () => {
    expect(effectiveLoadKg({ is_bodyweight: false, weight_kg: 60, added_load_kg: 0 }, 80)).toBe(60);
  });

  it('estimates a one rep max above the working load', () => {
    expect(estimateOneRepMax(100, 1)).toBe(100);
    expect(estimateOneRepMax(100, 5)).toBeCloseTo(116.67, 1);
  });

  it('round-trips unit conversion', () => {
    expect(displayToKg(kgToDisplay(60, 'lb'), 'lb')).toBeCloseTo(60, 6);
    expect(kgToDisplay(60, 'kg')).toBe(60);
  });
});
