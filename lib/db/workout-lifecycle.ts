import { supabase } from './supabase';

/** Captured once on device, before either local persistence or a network write. */
export interface SessionStart {
  sessionId: string;
  planDayId: string;
  startedAt: string;
  localDay: string;
  tz: string;
}

export async function startSessionOnce(
  start: SessionStart,
  client = supabase,
  signal?: AbortSignal,
): Promise<string> {
  const request = client.rpc('start_session', {
    p_session_id: start.sessionId,
    p_plan_day_id: start.planDayId,
    p_started_at: start.startedAt,
    p_local_day: start.localDay,
    p_tz: start.tz,
  });
  const { data, error } = await (signal ? request.abortSignal(signal) : request);
  if (error) throw error;
  if (typeof data !== 'string'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(data)
    || data.toLowerCase() !== start.sessionId.toLowerCase())
    throw new Error('Invalid workout start response. Your saved workout is preserved.');
  return data.toLowerCase();
}
