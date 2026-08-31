import { dayKey, daysSinceLast, recentDays, sessionTotals, streakDays, trainedDayKeys } from '@/lib/stats';

const day = (offset: number) => {
  const d = new Date('2026-08-27T10:00:00');
  d.setDate(d.getDate() + offset);
  return dayKey(d);
};

const TODAY = new Date('2026-08-27T10:00:00');

describe('streakDays', () => {
  it('is zero with nothing logged', () => {
    expect(streakDays(new Set(), TODAY)).toBe(0);
  });

  it('counts back from today', () => {
    expect(streakDays(new Set([day(0), day(-1), day(-2)]), TODAY)).toBe(3);
  });

  it('survives today not being trained yet', () => {
    expect(streakDays(new Set([day(-1), day(-2)]), TODAY)).toBe(2);
  });

  it('breaks once a whole day has been missed', () => {
    expect(streakDays(new Set([day(-2), day(-3)]), TODAY)).toBe(0);
  });

  it('ignores days on the far side of a gap', () => {
    expect(streakDays(new Set([day(0), day(-1), day(-4), day(-5)]), TODAY)).toBe(2);
  });

  it('counts two sessions on one day once', () => {
    const days = trainedDayKeys([
      { started_at: '2026-08-27T08:00:00' },
      { started_at: '2026-08-27T19:00:00' },
    ]);
    expect(streakDays(days, TODAY)).toBe(1);
  });
});

describe('sessionTotals', () => {
  it('adds reps and tonnage', () => {
    const totals = sessionTotals(
      [
        { reps: 10, weight_kg: 60, is_bodyweight: false, added_load_kg: 0 },
        { reps: 8, weight_kg: 60, is_bodyweight: false, added_load_kg: 0 },
      ],
      80,
    );
    expect(totals).toEqual({ sets: 2, reps: 18, volumeKg: 1080 });
  });

  it('counts bodyweight plus added load', () => {
    const totals = sessionTotals(
      [{ reps: 5, weight_kg: null, is_bodyweight: true, added_load_kg: 10 }],
      80,
    );
    expect(totals.volumeKg).toBe(450);
  });

  it('keeps the reps but drops the volume when bodyweight is unknown', () => {
    const totals = sessionTotals(
      [{ reps: 5, weight_kg: null, is_bodyweight: true, added_load_kg: 0 }],
      null,
    );
    expect(totals).toEqual({ sets: 1, reps: 5, volumeKg: 0 });
  });

  it('treats a set with no reps as zero, not NaN', () => {
    const totals = sessionTotals(
      [{ reps: null, weight_kg: 40, is_bodyweight: false, added_load_kg: 0 }],
      80,
    );
    expect(totals.volumeKg).toBe(0);
  });
});

describe('calendar helpers', () => {
  it('returns the last n days oldest first, ending today', () => {
    const days = recentDays(3, TODAY);
    expect(days).toEqual([day(-2), day(-1), day(0)]);
  });

  it('measures the gap since the last session', () => {
    expect(daysSinceLast(new Set([day(-3), day(-9)]), TODAY)).toBe(3);
    expect(daysSinceLast(new Set(), TODAY)).toBeNull();
  });
});
