import { useCallback, useEffect, useState } from 'react';

import {
  getActivePlan, getLastCompletedPlanDayIndex, getProgress, getRecentSessions,
  getSetLogsForSessions, getTrainedDayKeys,
} from './db/queries';
import { dayKey, sessionTotals, streakDays, type Totals } from './stats';
import { planCache } from './session/plan-cache';
import type { Plan, PlanDay } from './types';

export interface HistorySession {
  id: string;
  started_at: string;
  duration_s: number | null;
  rpe: number | null;
  local_day: string;
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
  /** Sessions finished today, and what they added up to. */
  todaySessions: HistorySession[];
  todayTotals: Totals | null;
  /** Last load lifted per exercise, for estimating a session before it runs. */
  lastLoadKg: Map<string, number | null>;
  loading: boolean;
  usingCachedPlan: boolean;
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
export function useDashboard(userId: string, bodyweightKg: number | null): DashboardState {
  const [stateOwner, setStateOwner] = useState(userId);
  const [usingCachedPlan, setUsingCachedPlan] = useState(false);
  const [cachedNextDayId, setCachedNextDayId] = useState<string | undefined>();
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
    setStateOwner(userId);
    setLoading(true);
    setPlan(null);
    setSessions([]);
    setTodayTotals(null);
    setLastLoadKg(new Map());
    setLastCompletedDayIndex(null);
    setStoredTrainedDays(new Set());
    setCachedNextDayId(undefined);
    setUsingCachedPlan(false);
    setError(null);

    (async () => {
      const cached = await planCache.read(userId).catch(() => null);
      if (cancelled) return;
      if (cached) {
        setPlan(cached.plan);
        setLastLoadKg(new Map(cached.progress.map((row) => [row.exercise_id, row.last_weight_kg])));
        setCachedNextDayId(cached.nextDayId);
        setUsingCachedPlan(true);
        setLoading(false);
      }
      // Read disk first so a stalled refresh cannot hide a usable offline plan.
      const [planResult, progressResult, historyResult, daysResult] = await Promise.allSettled([
        getActivePlan(userId), getProgress(userId), getRecentSessions(userId, 200), getTrainedDayKeys(userId),
      ]);
      if (cancelled) return;
      let activePlan = planResult.status === 'fulfilled' ? planResult.value : cached?.plan ?? null;
      if (planResult.status === 'rejected' && !activePlan) throw planResult.reason;
      let progress = progressResult.status === 'fulfilled'
        ? [...progressResult.value.values()] : cached?.progress ?? [];
      let lastIndex: number | null = null;
      let rotation = cached?.plan.id === activePlan?.id ? cached?.nextDayId : undefined;
      let readError: unknown = planResult.status === 'rejected' ? planResult.reason : null;
      let showCachedPlan = planResult.status === 'rejected';
      let accepted: boolean | null = null;
      if (planResult.status === 'fulfilled') {
        if (!activePlan) accepted = await planCache.clear(userId, cached).catch(() => null);
        else {
          try {
            lastIndex = await getLastCompletedPlanDayIndex(userId, activePlan.id);
            rotation = activePlan.days.length > 0
              ? activePlan.days[((lastIndex ?? -1) + 1) % activePlan.days.length]?.id : undefined;
          } catch (error) {
            readError = error;
          }
          if (cancelled) return;
          // History failures must not prevent an otherwise usable plan from being cached.
          if (progressResult.status === 'fulfilled')
            accepted = await planCache.write(userId, activePlan, progress, rotation, cached).catch(() => null);
        }
      }
      if (cancelled) return;
      if (accepted === false) {
        // A completed workout or another refresh published newer data while this request waited.
        const winner = await planCache.read(userId);
        if (cancelled) return;
        activePlan = winner?.plan ?? null;
        progress = winner?.progress ?? [];
        rotation = winner?.nextDayId;
        lastIndex = null;
        showCachedPlan = winner !== null;
      }
      setPlan(activePlan);
      setLastLoadKg(new Map(progress.map((row) => [row.exercise_id, row.last_weight_kg])));
      setLastCompletedDayIndex(lastIndex);
      setCachedNextDayId(rotation);
      setUsingCachedPlan(showCachedPlan);

      if (historyResult.status === 'rejected' || daysResult.status === 'rejected') {
        throw readError ?? (historyResult.status === 'rejected' ? historyResult.reason
          : daysResult.status === 'rejected' ? daysResult.reason : null);
      }
      const history = historyResult.value as unknown as HistorySession[];
      setSessions(history);
      setStoredTrainedDays(new Set(daysResult.value));
      const today = dayKey(new Date());
      const todayIds = history.filter((session) => session.local_day === today).map((session) => session.id);
      const logs = await getSetLogsForSessions(todayIds);
      if (cancelled) return;
      setTodayTotals(todayIds.length === 0 ? null : sessionTotals(logs, bodyweightKg));
      if (readError) throw readError;
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
  }, [userId, bodyweightKg, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  const ownState = stateOwner === userId;
  const completedCount = ownState ? sessions.length : 0;
  const nextDay =
    ownState && plan && plan.days.length > 0
      ? plan.days.find((day) => day.id === cachedNextDayId)
        ?? plan.days[((lastCompletedDayIndex ?? -1) + 1) % plan.days.length]
      : null;
  const trainedDays = ownState ? storedTrainedDays : new Set<string>();
  const today = dayKey(new Date());

  return {
    plan: ownState ? plan : null,
    nextDay,
    completedCount,
    sessions: ownState ? sessions : [],
    trainedDays,
    streak: streakDays(trainedDays),
    todaySessions: ownState ? sessions.filter((s) => s.local_day === today) : [],
    todayTotals: ownState ? todayTotals : null,
    lastLoadKg: ownState ? lastLoadKg : new Map(),
    loading: !ownState || loading,
    usingCachedPlan: ownState && usingCachedPlan,
    error: ownState ? error : null,
    reload,
  };
}
