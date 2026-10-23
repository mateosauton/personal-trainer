import { useCallback, useEffect, useState } from 'react';

import {
  getActivePlan, getLastCompletedPlanDayIndex, getProgress, getRecentSessions,
  getSetLogsForSessions, getTrainedDayKeys,
} from './db/queries';
import { dayKey, sessionTotals, streakDays, type Totals } from './stats';
import type { Plan, PlanDay } from './types';
import { validTimeZone } from './calendar-days';
import { useCalendarToday } from './useCalendarToday';

export interface HistorySession {
  id: string;
  started_at: string;
  duration_s: number | null;
  rpe: number | null;
  local_day: string;
  tz: string | null;
  plan_days: { name: string; focus: string } | null;
}

interface DashboardState {
  plan: Plan | null;
  /** The day the rotation is up to. */
  nextDay: PlanDay | null;
  completedCount: number;
  sessions: HistorySession[];
  /** yyyy-MM-dd for every day with a finished session. */
  trainedDays: Set<string>;
  streak: number;
  today: string;
  homeTimezone: string;
  /** Sessions finished today, and what they added up to. */
  todaySessions: HistorySession[];
  todayTotals: Totals | null;
  /** Last load lifted per exercise, for estimating a session before it runs. */
  lastLoadKg: Map<string, number | null>;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

/**
 * One read for both tabs: the plan, the history, and the numbers derived from
 * them. Home and Plan used to run the same two queries separately and then do
 * their own arithmetic, which is how they drifted apart.
 *
 * The plan stays a rotation — the next session is the one after however many
 * have been finished, so a missed Tuesday leaves no hole to feel guilty about.
 * The calendar is a record of what happened, not a schedule to fall behind.
 */
export function useDashboard(userId: string, bodyweightKg: number | null, homeTimezone?: string): DashboardState {
  const timeZone = validTimeZone(homeTimezone);
  const today = useCalendarToday(timeZone);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [sessions, setSessions] = useState<HistorySession[]>([]);
  const [todayTotals, setTodayTotals] = useState<Totals | null>(null);
  const [lastLoadKg, setLastLoadKg] = useState<Map<string, number | null>>(new Map());
  const [lastCompletedDayIndex, setLastCompletedDayIndex] = useState<number | null>(null);
  const [storedTrainedDays, setStoredTrainedDays] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    (async () => {
      const [activePlan, rows, progress, dayKeys] = await Promise.all([
        getActivePlan(userId),
        getRecentSessions(userId, 200),
        getProgress(userId),
        getTrainedDayKeys(userId, timeZone),
      ]);
      const lastIndex = activePlan
        ? await getLastCompletedPlanDayIndex(userId, activePlan.id)
        : null;
      if (cancelled) return;

      const history = (rows as unknown as HistorySession[]).map((row) => ({
        ...row, local_day: dayKey(row.started_at, timeZone),
      }));
      setPlan(activePlan);
      setSessions(history);
      setLastLoadKg(new Map([...progress].map(([id, row]) => [id, row.last_weight_kg])));
      setLastCompletedDayIndex(lastIndex);
      setStoredTrainedDays(new Set(dayKeys));

      const todayIds = history.filter((s) => s.local_day === today).map((s) => s.id);
      const logs = await getSetLogsForSessions(todayIds);
      if (cancelled) return;
      setTodayTotals(todayIds.length === 0 ? null : sessionTotals(logs, bodyweightKg));
      setError(null);
    })()
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load your plan');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [userId, bodyweightKg, nonce, today, timeZone]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  const completedCount = sessions.length;
  const nextDay =
    plan && plan.days.length > 0
      ? plan.days[((lastCompletedDayIndex ?? -1) + 1) % plan.days.length]
      : null;
  const trainedDays = storedTrainedDays;

  return {
    plan,
    nextDay,
    completedCount,
    sessions,
    trainedDays,
    streak: streakDays(trainedDays, today),
    today,
    homeTimezone: timeZone,
    todaySessions: sessions.filter((s) => s.local_day === today),
    todayTotals,
    lastLoadKg,
    loading,
    error,
    reload,
  };
}
