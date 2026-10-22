export interface Deadline {
  endAt: number;
  pausedAt: number | null;
}

export function startDeadline(seconds: number, now = Date.now()): Deadline {
  return { endAt: now + Math.max(0, seconds) * 1000, pausedAt: null };
}

export function remainingSeconds(clock: Deadline, now = Date.now()): number {
  return Math.max(0, Math.ceil((clock.endAt - (clock.pausedAt ?? now)) / 1000));
}

export function pauseDeadline(clock: Deadline, now = Date.now()): Deadline {
  return clock.pausedAt == null ? { ...clock, pausedAt: now } : clock;
}

export function resumeDeadline(clock: Deadline, now = Date.now()): Deadline {
  return clock.pausedAt == null ? clock : { endAt: clock.endAt + now - clock.pausedAt, pausedAt: null };
}
