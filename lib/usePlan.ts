import { useCallback, useEffect, useState } from 'react';

import { getActivePlan, getRecentSessions } from './db/queries';
import type { Plan, PlanDay } from './types';

interface PlanState {
  plan: Plan | null;
  /** The day the rotation is up to. */
  nextDay: PlanDay | null;
  completedCount: number;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

/**
 * The plan is a rotation, not a calendar: the next session is simply the one
 * after however many have been finished. Missing a Tuesday does not leave a
 * hole to feel guilty about.
 */
export function usePlan(userId: string): PlanState {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [completedCount, setCompletedCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([getActivePlan(userId), getRecentSessions(userId, 200)])
      .then(([activePlan, sessions]) => {
        if (cancelled) return;
        setPlan(activePlan);
        setCompletedCount(sessions.length);
        setError(null);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load your plan');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [userId, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  const nextDay =
    plan && plan.days.length > 0 ? plan.days[completedCount % plan.days.length] : null;

  return { plan, nextDay, completedCount, loading, error, reload };
}
