type SummaryMotion = 'intro' | 'pr' | 'streak';

// Presentation cues last only for this app run. They never change workout data.
const presented = new Map<string, Set<SummaryMotion>>();
const home = new Map<string, { sessionId?: string; day?: string; trained?: boolean }>();
const limit = 64;

function trim<T>(entries: Map<string, T>) {
  while (entries.size > limit) entries.delete(entries.keys().next().value!);
}

export function claimCompletionMotion(ownerId: string, sessionId: string, cue: SummaryMotion): boolean {
  const key = JSON.stringify([ownerId, sessionId]);
  const cues = presented.get(key) ?? new Set<SummaryMotion>();
  if (cues.has(cue)) return false;
  cues.add(cue);
  presented.set(key, cues);
  trim(presented);
  return true;
}

export function signalWorkoutCompletion(ownerId: string, sessionId: string) {
  home.set(ownerId, { ...home.get(ownerId), sessionId });
  trim(home);
}

/** A retained URL alone must not replay a celebration after an app restart. */
export function isFreshWorkoutCompletion(ownerId: string, sessionId: string): boolean {
  return home.get(ownerId)?.sessionId === sessionId;
}

/** A fresh finish must also add today to Home's actual completed-session query. */
export function takeTrainedDayMotion(
  ownerId: string,
  day: string,
  trained: boolean,
  sessions: { id: string; local_day: string }[],
): string | null {
  const previous = home.get(ownerId);
  const completed = sessions.find(session => session.id === previous?.sessionId);
  // The single-day baseline survives Home remounts, without storing history.
  home.set(ownerId, {
    ...previous,
    day,
    trained,
    sessionId: completed ? undefined : previous?.sessionId,
  });
  trim(home);
  return completed?.local_day === day && previous?.day === day
    && previous.trained === false && trained ? completed.id : null;
}
