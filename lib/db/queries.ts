import { supabase } from './supabase';
import type { GeneratedPlan } from '@/lib/plan/generate';
import { GYM_ROUTINE_BLOCK_TITLES, isGymRoutine } from '@/lib/plan/gym-routine';
import { withDayTiming } from '@/lib/plan/timing';
import { dayKey } from '@/lib/stats';
import type { Plan, PlanDay, Profile, SetLog } from '@/lib/types';
import type { ExerciseWeightHistory } from '@/lib/weights';

export async function getProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  return data as Profile | null;
}

export async function updateProfile(userId: string, patch: Partial<Profile>) {
  const { error } = await supabase.from('profiles').update(patch).eq('id', userId);
  if (error) throw error;
}

/**
 * Puts a picked photo in the public `avatars` bucket and hands back its URL.
 * Objects are pathed under the user's id because that is what the storage
 * policy checks; the bucket itself is public so the app can render a plain URL.
 */
export async function uploadAvatar(userId: string, uri: string): Promise<string> {
  const response = await fetch(uri);
  const contentType = response.headers.get('content-type') || 'image/jpeg';
  const body = await response.arrayBuffer();
  const extension = contentType.split('/')[1]?.split('+')[0] || 'jpg';
  // One object per user: re-picking replaces the old photo rather than
  // orphaning it, and the URL stays stable.
  const path = `${userId}/avatar.${extension}`;

  const { error } = await supabase.storage
    .from('avatars')
    .upload(path, body, { contentType, upsert: true });
  if (error) throw error;

  const { data } = supabase.storage.from('avatars').getPublicUrl(path);
  // A cache-buster, since the path never changes but the photo can.
  return `${data.publicUrl}?v=${Date.now()}`;
}

/**
 * Writes a generated plan and retires any previous one. Blocks and items are
 * inserted level by level because each level needs the ids the level above
 * just produced.
 */
export async function savePlan(userId: string, generated: GeneratedPlan): Promise<string> {
  void userId; // The RPC derives ownership from auth.uid(), never caller input.
  const { data, error } = await supabase.rpc('save_plan', { plan: generated });
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

export async function startSession(userId: string, planDayId: string): Promise<string> {
  const now = new Date();
  const { data, error } = await supabase
    .from('sessions')
    .insert({
      user_id: userId,
      plan_day_id: planDayId,
      local_day: dayKey(now),
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    })
    .select('id')
    .single();
  if (error) throw error;
  return data.id as string;
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
export async function getTrainedDayKeys(userId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('sessions')
    .select('local_day')
    .eq('user_id', userId)
    .not('completed_at', 'is', null);
  if (error) throw error;
  return (data ?? []).flatMap((row) => typeof row.local_day === 'string' ? [row.local_day] : []);
}

export async function logSet(sessionId: string, set: SetLog) {
  const { error } = await supabase
    .from('set_logs')
    .upsert(
      { session_id: sessionId, ...set },
      { onConflict: 'session_id,plan_item_id,set_index' },
    );
  if (error) throw error;
}

export async function finishSession(
  sessionId: string,
  patch: { duration_s: number; rpe: number | null; notes?: string | null },
) {
  const { error } = await supabase
    .from('sessions')
    .update({ completed_at: new Date().toISOString(), ...patch })
    .eq('id', sessionId)
    .is('completed_at', null);
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

export interface ProgressRow {
  exercise_id: string;
  last_weight_kg: number | null;
  last_reps: number | null;
  best_weight_kg: number | null;
  best_e1rm: number | null;
  miss_streak: number;
}

/** Prefills the weight sheet, so the common case is one tap to accept. */
export async function getProgress(userId: string): Promise<Map<string, ProgressRow>> {
  const { data, error } = await supabase
    .from('exercise_progress')
    .select('exercise_id, last_weight_kg, last_reps, best_weight_kg, best_e1rm, miss_streak')
    .eq('user_id', userId);
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

export async function upsertProgress(userId: string, rows: (ProgressRow & { exercise_id: string })[]) {
  if (rows.length === 0) return;
  const { error } = await supabase.from('exercise_progress').upsert(
    rows.map((r) => ({ user_id: userId, ...r, updated_at: new Date().toISOString() })),
    { onConflict: 'user_id,exercise_id' },
  );
  if (error) throw error;
}

export async function getRecentSessions(userId: string, limit = 30) {
  const { data, error } = await supabase
    .from('sessions')
    .select('id, plan_day_id, started_at, local_day, completed_at, duration_s, rpe, plan_days ( name, focus )')
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
    .select('session_id, exercise_id, reps, weight_kg, is_bodyweight, added_load_kg')
    .in('session_id', sessionIds);
  if (error) throw error;
  return data ?? [];
}
