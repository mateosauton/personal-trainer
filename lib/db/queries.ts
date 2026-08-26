import { supabase } from './supabase';
import type { GeneratedPlan } from '@/lib/plan/generate';
import type { Plan, PlanDay, Profile, SetLog } from '@/lib/types';

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
 * Writes a generated plan and retires any previous one. Blocks and items are
 * inserted level by level because each level needs the ids the level above
 * just produced.
 */
export async function savePlan(userId: string, generated: GeneratedPlan): Promise<string> {
  await supabase.from('plans').update({ is_active: false }).eq('user_id', userId);

  const { data: plan, error: planError } = await supabase
    .from('plans')
    .insert({
      user_id: userId,
      name: generated.name,
      split: generated.split,
      weeks: generated.weeks,
    })
    .select('id')
    .single();
  if (planError) throw planError;

  const { data: days, error: dayError } = await supabase
    .from('plan_days')
    .insert(
      generated.days.map((day, index) => ({
        plan_id: plan.id,
        day_index: index,
        name: day.name,
        focus: day.focus,
      })),
    )
    .select('id, day_index');
  if (dayError) throw dayError;

  const dayIdByIndex = new Map(days.map((d) => [d.day_index, d.id]));

  const blockRows = generated.days.flatMap((day, dayIndex) =>
    day.blocks.map((block, blockIndex) => ({
      plan_day_id: dayIdByIndex.get(dayIndex)!,
      block_index: blockIndex,
      kind: block.kind,
      title: block.title,
      rounds: block.rounds,
      rest_seconds: block.rest_seconds,
    })),
  );
  const { data: blocks, error: blockError } = await supabase
    .from('plan_blocks')
    .insert(blockRows)
    .select('id, plan_day_id, block_index');
  if (blockError) throw blockError;

  const blockId = new Map(
    blocks.map((b) => [`${b.plan_day_id}:${b.block_index}`, b.id]),
  );

  const itemRows = generated.days.flatMap((day, dayIndex) =>
    day.blocks.flatMap((block, blockIndex) =>
      block.items.map((item, itemIndex) => ({
        block_id: blockId.get(`${dayIdByIndex.get(dayIndex)}:${blockIndex}`)!,
        item_index: itemIndex,
        exercise_id: item.exercise_id,
        sets: item.sets,
        reps_low: item.reps_low,
        reps_high: item.reps_high,
        seconds: item.seconds,
        tempo: item.tempo,
        notes: item.notes,
      })),
    ),
  );
  const { error: itemError } = await supabase.from('plan_items').insert(itemRows);
  if (itemError) throw itemError;

  return plan.id as string;
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

  return { id: data.id, name: data.name, split: data.split, weeks: data.weeks, days };
}

export async function startSession(userId: string, planDayId: string): Promise<string> {
  const { data, error } = await supabase
    .from('sessions')
    .insert({ user_id: userId, plan_day_id: planDayId })
    .select('id')
    .single();
  if (error) throw error;
  return data.id as string;
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
    .eq('id', sessionId);
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
    .select('id, plan_day_id, started_at, completed_at, duration_s, rpe, plan_days ( name, focus )')
    .eq('user_id', userId)
    .not('completed_at', 'is', null)
    .order('started_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}
