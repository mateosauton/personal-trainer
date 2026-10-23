import { calendarDayKey, shiftDayKey, validTimeZone } from '@/lib/calendar-days';
import { daysSinceLast, recentDays, streakDays, trainedDayKeys } from '@/lib/stats';

const buenosAires = 'America/Argentina/Buenos_Aires';
const tokyo = 'Asia/Tokyo';

describe('a stable home calendar', () => {
  it('changes at midnight in the home timezone', () => {
    expect(calendarDayKey('2026-08-31T02:59:00Z', buenosAires)).toBe('2026-08-30');
    expect(calendarDayKey('2026-08-31T03:01:00Z', buenosAires)).toBe('2026-08-31');
  });

  it('keeps UTC-3 history and the streak while the device travels to UTC+9', () => {
    const rows = [{ started_at: '2026-08-31T00:00:00Z' }];
    const days = trainedDayKeys(rows, buenosAires);
    const now = '2026-08-31T15:30:00Z';
    expect(calendarDayKey(now, tokyo)).toBe('2026-09-01');
    const today = calendarDayKey(now, buenosAires);
    expect(streakDays(days, today)).toBe(1);
    expect(daysSinceLast(days, today)).toBe(1);
    expect(recentDays(2, today)).toEqual(['2026-08-30', '2026-08-31']);
  });

  it('keeps UTC+9 history when the device travels west to UTC-3', () => {
    const days = trainedDayKeys([{ started_at: '2026-08-31T15:30:00Z' }], tokyo);
    const today = calendarDayKey('2026-08-31T16:00:00Z', tokyo);
    expect(today).toBe('2026-09-01');
    expect(streakDays(days, today)).toBe(1);
    expect(daysSinceLast(days, today)).toBe(0);
    expect(recentDays(1, today)).toEqual(['2026-09-01']);
  });

  it('uses an explicit UTC fallback for old records without timezone evidence', () => {
    expect(validTimeZone(null)).toBe('UTC');
    expect(validTimeZone('invalid/timezone')).toBe('UTC');
    expect([...trainedDayKeys([{ started_at: '2026-08-31T01:00:00Z' }], validTimeZone(null))])
      .toEqual(['2026-08-31']);
    expect(shiftDayKey('2026-03-08', 1)).toBe('2026-03-09');
    expect(shiftDayKey('2026-11-01', -1)).toBe('2026-10-31');
    expect(daysSinceLast(new Set(['2026-09-02']), '2026-09-01')).toBe(0);
  });
});
