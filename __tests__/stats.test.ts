import { dayKey, daysSinceLast, recentDays, sessionTotals, streakDays, trainedDayKeys } from '@/lib/stats';
import { gymExerciseId } from '@/lib/data/gym-routine-exercises';
import { generateGymRoutine } from '@/lib/plan/gym-routine';
import { estimateDay } from '@/lib/plan/estimate';

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
    ], Intl.DateTimeFormat().resolvedOptions().timeZone);
    expect(streakDays(days, TODAY)).toBe(1);
  });
});

describe('sessionTotals', () => {
  it('matches the planned rep totals when every prescribed gym set is completed', () => {
    for (const [dayIndex, day] of generateGymRoutine().days.entries()) {
      const persisted = {
        ...day, id: `day-${dayIndex}`, day_index: dayIndex,
        blocks: day.blocks.map((block, index) => ({
          ...block, id: `block-${index}`, block_index: index,
          items: block.items.map((item, itemIndex) => ({ ...item, id: `item-${index}-${itemIndex}`, item_index: itemIndex })),
        })),
      };
      const logs = day.blocks.filter((block) => block.kind !== 'warmup').flatMap((block) => block.items.flatMap((item) =>
        Array.from({ length: block.kind === 'straight' ? item.sets : block.rounds }, () => ({
          exercise_id: item.exercise_id,
          reps: item.seconds != null ? null : Math.round((item.reps_low + item.reps_high) / 2),
          weight_kg: 10, is_bodyweight: false, added_load_kg: 0,
        })),
      ));
      expect(sessionTotals(logs, 80).reps).toBe(estimateDay(persisted).reps);
    }
  });

  it('counts both sides in display totals while preserving logged per-side reps', () => {
    const logs = [
      { exercise_id: gymExerciseId('Bulgarian split squat'), reps: 4, weight_kg: 10, is_bodyweight: false, added_load_kg: 0 },
      { exercise_id: gymExerciseId('Bulgarian split squat'), reps: 4, weight_kg: 10, is_bodyweight: false, added_load_kg: 0 },
    ];
    expect(sessionTotals(logs, 80)).toEqual({ sets: 2, reps: 16, volumeKg: 160 });
    expect(logs.map((log) => log.reps)).toEqual([4, 4]);
  });

  it('keeps alternating total-rep prescriptions and unknown legacy exercises at one count', () => {
    const logs = [
      { exercise_id: gymExerciseId('Dumbbell squat to alternating overhead press'), reps: 6, weight_kg: 10, is_bodyweight: false, added_load_kg: 0 },
      { exercise_id: 'unknown-legacy-id', reps: 4, weight_kg: 10, is_bodyweight: false, added_load_kg: 0 },
    ];
    expect(sessionTotals(logs, 80)).toEqual({ sets: 2, reps: 10, volumeKg: 100 });
  });

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


it('counts mixed timed and rep sets without counting seconds as reps or volume', () => {
  expect(sessionTotals([
    { reps: null, seconds: 40, weight_kg: 60, is_bodyweight: false, added_load_kg: 0 },
    { reps: 8, weight_kg: 60, is_bodyweight: false, added_load_kg: 0 },
  ], null)).toEqual({ sets: 2, reps: 8, volumeKg: 480 });
});
