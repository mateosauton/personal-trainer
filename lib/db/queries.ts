import { validSet } from '@/lib/session/set-journal';
import { avatarPath, storeAvatar } from '@/lib/avatar';
import type { JournalWrite } from '@/lib/session/set-journal';
import { supabase } from './supabase';
import type { GeneratedPlan } from '@/lib/plan/generate';
import { GYM_ROUTINE_BLOCK_TITLES, isGymRoutine } from '@/lib/plan/gym-routine';
import { withDayTiming } from '@/lib/plan/timing';
import { dayKey } from '@/lib/stats';
import { planWriteClient } from './plan-preferences';
import type { Plan, PlanDay, Profile, SetLog, Units } from '@/lib/types';
import type { ExerciseWeightHistory } from '@/lib/weights';

export async function getProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const profile = data as Profile;
  return { ...profile, avatar_url: avatarPath(profile.avatar_url, userId) };
}

export async function updateProfile(userId: string, patch: Partial<Profile>) {
  const { error } = await supabase.from('profiles').update(patch).eq('id', userId);
  if (error) throw error;
}

/** Persist an owner-scoped object path; profile reads resolve private access. */
export async function uploadAvatar(userId: string, uri: string): Promise<string> {
  return storeAvatar(userId, uri);
}

/**
 * Writes a generated plan and retires any previous one. Blocks and items are
 * inserted level by level because each level needs the ids the level above
 * just produced.
 */
export async function savePlan(userId: string, generated: GeneratedPlan): Promise<string> {
  const client = await planWriteClient(userId);
  const { data, error } = await client.rpc('save_plan', { plan: generated });
  if (error) throw error;
  return data as string;
}

const PLAN_SELECT = `
  id, name, split, weeks,
  plan_days (
    id, day_index, name, focus,
    plan_blocks (
      id, block_index, kind, title, rounds, rest_seconds,
      plan_items ( id, item_index, exercise_id, sets, reps_low, reps_high, seconds, tempo, notes )
    )
  )
`;

/** Nested selects come back unordered, so sort on the way out. */
export async function getActivePlan(userId: string): Promise<Plan | null> {
  const { data, error } = await supabase
    .from('plans')
    .select(PLAN_SELECT)
    .eq('user_id', userId)
    .eq('is_active', true)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const days: PlanDay[] = (data.plan_days as never[])
    .map((day: never) => {
      const d = day as {
        id: string; day_index: number; name: string; focus: string; plan_blocks: never[];
      };
      return {
        id: d.id,
        day_index: d.day_index,
        name: d.name,
        focus: d.focus,
        blocks: (d.plan_blocks as never[])
          .map((block: never) => {
            const b = block as {
              id: string; block_index: number; kind: PlanDay['blocks'][number]['kind'];
              title: string; rounds: number; rest_seconds: number; plan_items: never[];
            };
            return {
              id: b.id,
              block_index: b.block_index,
              kind: b.kind,
              title: b.title,
              rounds: b.rounds,
              rest_seconds: b.rest_seconds,
              items: (b.plan_items as PlanDay['blocks'][number]['items'])
                .slice()
                .sort((x, y) => x.item_index - y.item_index),
            };
          })
          .sort((x, y) => x.block_index - y.block_index),
      };
    })
    .sort((x, y) => x.day_index - y.day_index);

  // Timing is derived from the stored exercise prescriptions. This keeps old
  // plans and the existing save_plan RPC compatible with the timed routine.
  return {
    id: data.id, name: data.name, split: data.split, weeks: data.weeks,
    days: isGymRoutine(data) ? days.map((day) => withDayTiming({
      ...day,
      blocks: day.blocks.map((block) => ({
        ...block,
        title: GYM_ROUTINE_BLOCK_TITLES[block.block_index] ?? block.title,
      })),
    })) : days,
  };
}

export interface SessionCalculationContext { units: Units; bodyweightKg: number | null }
export async function startSession(
  userId: string, planDayId: string, context: SessionCalculationContext | undefined, expectedDay: PlanDay,
): Promise<string> {
  if (context) sessionCalculationContext({ calculation_context_captured: true, calculation_units: context.units, bodyweight_kg: context.bodyweightKg });
  if (!expectedDay || expectedDay.id !== planDayId) throw new Error('Reopen the session before starting.');
  const client = await planWriteClient(userId);
  const { data, error } = await client.rpc('start_workout', {
    p_day_id: planDayId,
    p_expected_items: expectedDay.blocks.flatMap((block) => block.items.map((item) => ({ id: item.id, exercise_id: item.exercise_id }))),
    p_context: context ?? null,
  });
  if (error) throw error;
  return data as string;
}

/** The rotation is derived from the last completed day in this exact plan. */
export async function getLastCompletedPlanDayIndex(userId: string, planId: string): Promise<number | null> {
  const { data, error } = await supabase
    .from('sessions')
    .select('plan_days!inner(day_index, plan_id)')
    .eq('user_id', userId)
    .eq('plan_days.plan_id', planId)
    .not('completed_at', 'is', null)
    .order('completed_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  const row = data as { plan_days: { day_index: number } | null } | null;
  return row?.plan_days?.day_index ?? null;
}

/** Unlimited, small rows: calendar history must not inherit the recent-list cap. */
export async function getTrainedDayKeys(userId: string, timeZone = 'UTC'): Promise<string[]> {
  const keys = new Set<string>();
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase.from('sessions')
      .select('id, started_at, local_day, tz').eq('user_id', userId)
      .not('completed_at', 'is', null).order('id').range(offset, offset + 999);
    if (error) throw error;
    for (const row of data ?? []) keys.add(dayKey(row.started_at, timeZone));
    if (!data || data.length < 1000) return [...keys];
  }
}

export interface SetWriteResult {
  status: 'applied' | 'duplicate' | 'superseded';
  serverVersion: number;
}
export async function logSetVersioned(
  write: JournalWrite,
  client = supabase,
  signal?: AbortSignal,
): Promise<SetWriteResult> {
  const request = client.rpc('log_set_versioned', {
    p_session_id: write.sessionId,
    p_set: write.set,
    p_origin: write.origin,
    p_revision: write.revision,
    p_expected_version: write.expectedVersion,
    p_event_at: write.eventAt,
  });
  const { data, error } = await (signal
    ? request.abortSignal(signal)
    : request);
  if (error) throw error;
  if (
    !data ||
    !['applied', 'duplicate', 'superseded'].includes(data.status) ||
    !Number.isSafeInteger(data.serverVersion) ||
    data.serverVersion < 1
  )
    throw new Error('Invalid workout sync response.');
  return data as SetWriteResult;
}
export interface SetWriteState {
  serverVersion: number;
  set: SetLog;
  eventAt: string;
}
/** Read an owned set for comparison; never adopt its baseline automatically. */
export async function getSetWriteState(
  sessionId: string,
  planItemId: string,
  setIndex: number,
  client = supabase,
  signal?: AbortSignal,
): Promise<SetWriteState | null> {
  const request = client.rpc('get_set_write_state', {
    p_session_id: sessionId,
    p_plan_item_id: planItemId,
    p_set_index: setIndex,
  });
  const { data, error } = await (signal ? request.abortSignal(signal) : request);
  if (error) throw error;
  if (data === null) return null;
  if (!data || !Number.isSafeInteger(data.serverVersion) || data.serverVersion < 1
    || !validSet(data.set)
    || data.set.plan_item_id.toLowerCase() !== planItemId.toLowerCase()
    || data.set.set_index !== setIndex
    || typeof data.eventAt !== 'string' || !Number.isFinite(Date.parse(data.eventAt)))
    throw new Error('Invalid workout recovery response. Your saved data is preserved.');
  return data as SetWriteState;
}
export async function checkLegacySet(
  sessionId: string,
  set: SetLog,
  client = supabase,
  signal?: AbortSignal,
) {
  const request = client.rpc('check_legacy_set', {
    p_session_id: sessionId,
    p_set: set,
  });
  const { data, error } = await (signal
    ? request.abortSignal(signal)
    : request);
  if (error) throw error;
  if (!data || !['duplicate', 'conflict'].includes(data.status))
    throw new Error('Invalid workout recovery response.');
  return data as {
    status: 'duplicate' | 'conflict';
    serverVersion: number;
    set: SetLog | null;
    eventAt?: string;
  };
}

export async function finishSession(
  sessionId: string,
  patch: { duration_s: number; rpe: number | null; notes?: string | null },
  client = supabase,
  signal?: AbortSignal,
) {
  const request = client
    .from('sessions')
    .update({ completed_at: new Date().toISOString(), ...patch })
    .eq('id', sessionId)
    .is('completed_at', null);
  const { error } = await (signal ? request.abortSignal(signal) : request);
  if (error) throw error;
}

export async function getSetLogs(sessionId: string) {
  const { data, error } = await supabase
    .from('set_logs')
    .select('*')
    .eq('session_id', sessionId)
    .order('completed_at');
  if (error) throw error;
  return data ?? [];
}

export interface SetSnapshotVersion { logId: string; serverVersion: number }
export interface SessionSetSnapshot {
  logs: (Omit<SetLog, 'plan_item_id'> & { id: string; plan_item_id: string | null; completed_at: string })[];
  versions: SetSnapshotVersion[];
}
/** Logs and their complete version membership come from one database snapshot. */
export async function getSessionSetSnapshot(sessionId: string, client = supabase, signal?: AbortSignal): Promise<SessionSetSnapshot> {
  const request = client.rpc('get_session_set_snapshot', { p_session_id: sessionId });
  const { data, error } = await (signal ? request.abortSignal(signal) : request);
  if (error) throw error;
  const uuid = (value: unknown): value is string => typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
  if (!data || !Array.isArray(data.logs) || !Array.isArray(data.versions)
    || data.logs.length !== data.versions.length
    || !data.logs.every((log: any) => log && uuid(log.id))
    || !data.versions.every((version: any) => version && uuid(version.logId)
      && Number.isSafeInteger(version.serverVersion) && version.serverVersion > 0))
    throw new Error('Invalid workout set snapshot. Your saved data is preserved.');
  const ids = new Set<string>(data.logs.map((log: any) => log.id.toLowerCase()));
  const versions = new Set<string>(data.versions.map((version: any) => version.logId.toLowerCase()));
  if (ids.size !== data.logs.length || versions.size !== data.versions.length
    || [...versions].some(id => !ids.has(id)))
    throw new Error('Invalid workout set snapshot. Your saved data is preserved.');
  return data as SessionSetSnapshot;
}

export interface ProgressRow {
  exercise_id: string;
  last_weight_kg: number | null;
  last_reps: number | null;
  best_weight_kg: number | null;
  best_e1rm: number | null;
  miss_streak: number;
}

/** Prefills the weight sheet, so the common case is one tap to accept. */
export async function getProgress(userId: string, client = supabase, signal?: AbortSignal): Promise<Map<string, ProgressRow>> {
  const request = client
    .from('exercise_progress')
    .select('exercise_id, last_weight_kg, last_reps, best_weight_kg, best_e1rm, miss_streak')
    .eq('user_id', userId);
  const { data, error } = await (signal ? request.abortSignal(signal) : request);
  if (error) throw error;
  return new Map((data ?? []).map((row) => [row.exercise_id, row as ProgressRow]));
}

interface WeightHistorySetRow {
  id: string;
  exercise_id: string;
  session_id: string;
  weight_kg: number | null;
  added_load_kg: number;
  is_bodyweight: boolean;
  reps: number | null;
  completed_at: string;
  sessions: { user_id: string; completed_at: string | null } | null;
  plan_items: { plan_blocks: { kind: string } | null } | null;
}

/** The highest working load from each exercise's most recent completed session. */
export async function getWeightHistory(
  userId: string,
  exerciseIds: string[],
  excludeSessionId?: string,
): Promise<Map<string, ExerciseWeightHistory>> {
  const history = new Map<string, ExerciseWeightHistory>();
  if (exerciseIds.length === 0) return history;

  const requested = new Set(exerciseIds);
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    let query = supabase
      .from('set_logs')
      .select('id, exercise_id, session_id, weight_kg, added_load_kg, is_bodyweight, reps, completed_at, sessions!inner(user_id, completed_at), plan_items(plan_blocks(kind))')
      .eq('sessions.user_id', userId)
      .not('sessions.completed_at', 'is', null)
      .in('exercise_id', [...requested]);
    if (excludeSessionId) query = query.neq('session_id', excludeSessionId);
    const { data, error } = await query
      .order('completed_at', { ascending: false })
      .order('id', { ascending: false })
      .range(offset, offset + pageSize - 1);
    if (error) throw error;

    // Both embedded relations are many-to-one foreign keys in the schema.
    for (const row of (data ?? []) as unknown as WeightHistorySetRow[]) {
      if (!requested.has(row.exercise_id) || row.session_id === excludeSessionId
        || row.sessions?.user_id !== userId || !row.sessions.completed_at
        || row.plan_items?.plan_blocks?.kind === 'warmup') continue;
      const weightKg = row.is_bodyweight ? row.added_load_kg : row.weight_kg;
      if (typeof weightKg !== 'number' || !Number.isFinite(weightKg) || weightKg < 0
        || !Number.isFinite(Date.parse(row.completed_at))) continue;

      const previous = history.get(row.exercise_id);
      // Descending timestamps identify the newest valid session first. Keep
      // reading its earlier sets, including those on later result pages.
      if (previous && (previous.sessionId !== row.session_id || previous.weightKg >= weightKg)) continue;
      history.set(row.exercise_id, {
        exerciseId: row.exercise_id,
        sessionId: row.session_id,
        weightKg,
        reps: typeof row.reps === 'number' && Number.isFinite(row.reps) && row.reps >= 0 ? row.reps : null,
        completedAt: row.completed_at,
        isBodyweight: row.is_bodyweight,
      });
    }
    if (!data || data.length < pageSize) break;
  }
  return history;
}

export async function getRecentSessions(userId: string, limit = 30) {
  const { data, error } = await supabase
    .from('sessions')
    .select('id, plan_day_id, started_at, local_day, tz, completed_at, duration_s, rpe, plan_days ( name, focus )')
    .eq('user_id', userId)
    .not('completed_at', 'is', null)
    .order('started_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

/**
 * Set logs for several sessions at once. Home needs today's tonnage and Plan
 * needs a picked day's; one round trip beats one per session.
 */
export async function getSetLogsForSessions(sessionIds: string[]) {
  if (sessionIds.length === 0) return [];
  const { data, error } = await supabase
    .from('set_logs')
    .select('session_id, exercise_id, reps, seconds, weight_kg, is_bodyweight, added_load_kg')
    .in('session_id', sessionIds);
  if (error) throw error;
  return data ?? [];
}


/** The session's original day remains valid after the active plan changes. */
export async function getSessionPlanDay(sessionId: string, userId: string, client = supabase, signal?: AbortSignal): Promise<PlanDay | null> {
  const request = client.from('sessions').select(`
    plan_days (id, day_index, name, focus, plans(split),
      plan_blocks (id, block_index, kind, title, rounds, rest_seconds,
        plan_items (id, item_index, exercise_id, sets, reps_low, reps_high, seconds, tempo, notes)))
  `).eq('id', sessionId).eq('user_id', userId);
  const { data, error } = await (signal ? request.abortSignal(signal) : request).maybeSingle();
  if (error) throw error;
  if (!data?.plan_days) return null;
  const raw = data.plan_days as unknown as Omit<PlanDay, 'blocks'> & {
    plans?: { split: string };
    plan_blocks: (Omit<PlanDay['blocks'][number], 'items'> & { plan_items: PlanDay['blocks'][number]['items'] })[];
  };
  const { plan_blocks, plans, ...day } = raw;
  const restored = { ...day, blocks: plan_blocks.map(({ plan_items, ...block }) => ({
    ...block, items: plan_items.slice().sort((a, b) => a.item_index - b.item_index),
  })).sort((a, b) => a.block_index - b.block_index) };
  return plans && isGymRoutine(plans) ? withDayTiming({
    ...restored,
    blocks: restored.blocks.map(block => ({
      ...block, title: GYM_ROUTINE_BLOCK_TITLES[block.block_index] ?? block.title,
    })),
  }) : restored;
}

export interface SessionSummaryLine {
  exerciseId: string;
  name: string;
  sets: number;
  volumeKg: number;
  seconds?: number;
  topLoadKg: number | null;
  verdict: 'progress' | 'hold' | 'deload' | null;
  isPr: boolean;
}

export async function getSessionProgressResult(sessionId: string, client = supabase, signal?: AbortSignal): Promise<SessionSummaryLine[] | null> {
  const request = client.from('session_progress_results')
    .select('result').eq('session_id', sessionId);
  const { data, error } = await (signal ? request.abortSignal(signal) : request).maybeSingle();
  if (error) throw error;
  return data?.result as SessionSummaryLine[] | null ?? null;
}

export async function applySessionProgress(
  sessionId: string,
  expected: { exercise_id: string; state: ProgressRow | null }[],
  updates: ProgressRow[],
  result: SessionSummaryLine[],
  setVersions: SetSnapshotVersion[],
  client = supabase,
  signal?: AbortSignal,
): Promise<SessionSummaryLine[]> {
  const request = client.rpc('apply_session_progress', {
    p_session_id: sessionId, p_expected: expected, p_updates: updates, p_result: result, p_set_versions: setVersions,
  });
  const { data, error } = await (signal ? request.abortSignal(signal) : request);
  if (error) throw error;
  return data as SessionSummaryLine[];
}


export async function getSessionResumeDetails(sessionId: string, userId: string) {
  const { data, error } = await supabase.from('sessions').select('started_at, completed_at, duration_s, calculation_units, bodyweight_kg, calculation_context_captured')
    .eq('id', sessionId).eq('user_id', userId).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Workout not found.');
  return data as { started_at: string; completed_at: string | null; duration_s: number | null;
    calculation_units: Units | null; bodyweight_kg: number | null; calculation_context_captured: boolean };
}

export function sessionCalculationContext(row: { calculation_context_captured: boolean; calculation_units: unknown; bodyweight_kg: unknown }): SessionCalculationContext | null {
  if (!row.calculation_context_captured) return null;
  if (!['kg','lb'].includes(row.calculation_units as string)
    || (row.bodyweight_kg !== null && (typeof row.bodyweight_kg !== 'number' || !Number.isFinite(row.bodyweight_kg) || row.bodyweight_kg < 0 || row.bodyweight_kg > 100000)))
    throw new Error('Could not read the original workout calculation details.');
  return { units: row.calculation_units as Units, bodyweightKg: row.bodyweight_kg as number | null };
}
export async function getSessionCalculationContext(sessionId: string, userId: string, client = supabase,
  signal?: AbortSignal): Promise<SessionCalculationContext | null> {
  const request = client.from('sessions').select('calculation_units, bodyweight_kg, calculation_context_captured')
    .eq('id', sessionId).eq('user_id', userId);
  const { data, error } = await (signal ? request.abortSignal(signal) : request).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Workout not found.');
  return sessionCalculationContext(data);
}
