-- Profile and plan updates must not disagree after a failed rebuild.
create or replace function public.save_training_plan(preferences jsonb, plan jsonb)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare owner uuid := auth.uid();
begin
  if owner is null then raise exception 'not authenticated'; end if;
  perform 1 from public.profiles where id = owner for update;
  if not found then raise exception 'profile not found'; end if;
  if jsonb_typeof(preferences->'equipment') is distinct from 'array'
    or jsonb_typeof(preferences->'limitations') is distinct from 'array'
    or jsonb_typeof(plan->'days') is distinct from 'array'
    or jsonb_array_length(plan->'days') is distinct from (preferences->>'days_per_week')::int
    or (preferences->>'goal') is null or (preferences->>'experience') is null
    or (preferences->>'days_per_week') is null or (preferences->>'session_minutes') is null then
    raise exception 'invalid training preferences';
  end if;
  if exists(select 1 from jsonb_array_elements_text(preferences->'equipment') e(value)
    where value not in ('barbell','dumbbell','kettlebell','machine','bodyweight','other')) then
    raise exception 'equipment is outside the confirmed gym inventory';
  end if;
  update public.profiles set
    goal = (preferences->>'goal')::public.goal_kind,
    experience = (preferences->>'experience')::public.experience_kind,
    days_per_week = (preferences->>'days_per_week')::int,
    session_minutes = (preferences->>'session_minutes')::int,
    equipment = array(select jsonb_array_elements_text(preferences->'equipment')),
    limitations = array(select jsonb_array_elements_text(preferences->'limitations'))
  where id = owner;
  return public.save_plan(plan);
end;
$$;
revoke all on function public.save_training_plan(jsonb,jsonb) from public, anon;
grant execute on function public.save_training_plan(jsonb,jsonb) to authenticated;

create or replace function public.replace_plan_exercise(
  p_item_id uuid, p_expected_exercise_id text, p_exercise_id text, p_preferences jsonb, p_notes text
) returns void language plpgsql security invoker set search_path = '' as $$
declare owner uuid := auth.uid(); day_id uuid; current_exercise text; stored_preferences jsonb;
begin
  if owner is null then raise exception 'not authenticated'; end if;
  select jsonb_build_object('goal',p.goal,'experience',p.experience,'days_per_week',p.days_per_week,
    'session_minutes',p.session_minutes,'equipment',array(select e from unnest(p.equipment) e where e in ('barbell','dumbbell','kettlebell','machine','bodyweight','other')),'limitations',p.limitations)
  into stored_preferences from public.profiles p where p.id = owner for update;
  if stored_preferences is distinct from p_preferences then
    raise exception 'Training preferences changed. Reopen the session before swapping.';
  end if;
  select d.id, i.exercise_id into day_id, current_exercise
  from public.plan_items i join public.plan_blocks b on b.id = i.block_id
  join public.plan_days d on d.id = b.plan_day_id join public.plans p on p.id = d.plan_id
  where i.id = p_item_id and p.user_id = owner and p.is_active for update of i;
  if not found or current_exercise is distinct from p_expected_exercise_id then
    raise exception 'This plan changed. Reopen the session before swapping.';
  end if;
  if exists(select 1 from public.sessions where user_id = owner and plan_day_id = day_id and completed_at is null) then
    raise exception 'Finish the active workout before changing this exercise.';
  end if;
  if p_exercise_id is null or length(p_exercise_id) = 0 then raise exception 'exercise required'; end if;
  update public.plan_items set exercise_id = p_exercise_id, notes = p_notes where id = p_item_id;
end;
$$;
revoke all on function public.replace_plan_exercise(uuid,text,text,jsonb,text) from public, anon;
grant execute on function public.replace_plan_exercise(uuid,text,text,jsonb,text) to authenticated;
