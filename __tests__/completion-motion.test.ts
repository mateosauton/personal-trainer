import {
  claimCompletionMotion,
  isFreshWorkoutCompletion,
  signalWorkoutCompletion,
  takeTrainedDayMotion,
} from '@/lib/session/completion-motion';

const today = '2026-10-22';
const completed = (id: string, local_day = today) => ({ id, local_day });

describe('workout completion motion', () => {
  it('requires a fresh in-memory finish signal before a retained summary URL can celebrate', () => {
    expect(isFreshWorkoutCompletion('intent-owner', 'new-session')).toBe(false);
    signalWorkoutCompletion('intent-owner', 'new-session');
    expect(isFreshWorkoutCompletion('intent-owner', 'new-session')).toBe(true);
    expect(isFreshWorkoutCompletion('different-owner', 'new-session')).toBe(false);
    expect(isFreshWorkoutCompletion('intent-owner', 'old-session')).toBe(false);
    takeTrainedDayMotion('intent-owner', today, true, [completed('new-session')]);
    expect(isFreshWorkoutCompletion('intent-owner', 'new-session')).toBe(false);
  });

  it('claims each cue once per account and session', () => {
    expect(claimCompletionMotion('claims-a', 'workout-1', 'intro')).toBe(true);
    expect(claimCompletionMotion('claims-a', 'workout-1', 'intro')).toBe(false);
    expect(claimCompletionMotion('claims-a', 'workout-1', 'pr')).toBe(true);
    expect(claimCompletionMotion('claims-a', 'workout-1', 'pr')).toBe(false);
    expect(claimCompletionMotion('claims-a', 'workout-1', 'streak')).toBe(true);
    expect(claimCompletionMotion('claims-a', 'workout-1', 'streak')).toBe(false);
    expect(claimCompletionMotion('claims-b', 'workout-1', 'intro')).toBe(true);
    expect(claimCompletionMotion('claims-a', 'workout-2', 'intro')).toBe(true);
  });

  it('waits for a freshly finished session to appear in Home and fills today once', () => {
    const owner = 'fresh-day';
    expect(takeTrainedDayMotion(owner, today, false, [])).toBeNull();
    signalWorkoutCompletion(owner, 'new-session');
    expect(takeTrainedDayMotion(owner, today, false, [])).toBeNull();
    expect(takeTrainedDayMotion(owner, today, true, [completed('new-session')])).toBe('new-session');
    expect(takeTrainedDayMotion(owner, today, true, [completed('new-session')])).toBeNull();
    // Even a repeated finish signal cannot fill an already trained day again.
    signalWorkoutCompletion(owner, 'new-session');
    expect(takeTrainedDayMotion(owner, today, true, [completed('new-session')])).toBeNull();
  });

  it('waits for both dashboard reads regardless of which confirms the new day first', () => {
    for (const sessionArrivesFirst of [false, true]) {
      const owner = `separate-reads-${sessionArrivesFirst}`;
      takeTrainedDayMotion(owner, today, false, []);
      signalWorkoutCompletion(owner, 'new-session');
      expect(takeTrainedDayMotion(owner, today, !sessionArrivesFirst,
        sessionArrivesFirst ? [completed('new-session')] : [])).toBeNull();
      expect(takeTrainedDayMotion(owner, today, true, [completed('new-session')])).toBe('new-session');
      expect(takeTrainedDayMotion(owner, today, true, [completed('new-session')])).toBeNull();
    }
  });

  it('does not fill on initial load, history refresh, or another workout on the same day', () => {
    expect(takeTrainedDayMotion('initial-load', today, true, [completed('old')])).toBeNull();
    expect(takeTrainedDayMotion('refresh', today, false, [])).toBeNull();
    expect(takeTrainedDayMotion('refresh', today, true, [completed('synced')])).toBeNull();
    signalWorkoutCompletion('refresh', 'second');
    expect(takeTrainedDayMotion('refresh', today, true, [completed('synced'), completed('second')])).toBeNull();
    signalWorkoutCompletion('fresh-without-baseline', 'new');
    expect(takeTrainedDayMotion('fresh-without-baseline', today, true, [completed('new')])).toBeNull();
  });

  it('keeps completion signals and baselines isolated between accounts', () => {
    takeTrainedDayMotion('owner-a', today, false, []);
    takeTrainedDayMotion('owner-b', today, false, []);
    signalWorkoutCompletion('owner-a', 'shared-session-id');
    expect(takeTrainedDayMotion('owner-b', today, true, [completed('shared-session-id')])).toBeNull();
    expect(takeTrainedDayMotion('owner-a', today, true, [completed('shared-session-id')])).toBe('shared-session-id');
  });

  it('consumes old-day completion without celebrating today or carrying it into tomorrow', () => {
    const owner = 'stale-day';
    takeTrainedDayMotion(owner, today, false, []);
    signalWorkoutCompletion(owner, 'yesterday');
    const sessions = [completed('yesterday', '2026-10-21')];
    expect(takeTrainedDayMotion(owner, today, true, sessions)).toBeNull();
    expect(takeTrainedDayMotion(owner, '2026-10-23', true, sessions)).toBeNull();
  });

  it('does not treat a new calendar day or timezone as a newly trained day', () => {
    const owner = 'calendar-change';
    takeTrainedDayMotion(owner, today, false, []);
    signalWorkoutCompletion(owner, 'next-day-session');
    expect(takeTrainedDayMotion(owner, '2026-10-23', true, [completed('next-day-session', '2026-10-23')])).toBeNull();
  });
});
