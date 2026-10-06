-- Apply a completed workout once. Receipts are private and cannot be edited
-- through the client API. Deploy with the matching summary client, not alone.
create table public.session_progress_results (
  session_id uuid primary key references public.sessions on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  result jsonb,
  legacy boolean not null default false,
  applied_at timestamptz not null default now()
);
alter table public.session_progress_results enable row level security;
revoke all on public.session_progress_results from anon, authenticated;
grant select on public.session_progress_results to authenticated;
create policy session_progress_results_read on public.session_progress_results
  for select to authenticated using (user_id = auth.uid());

-- Existing summaries may already have applied progression. Never guess and
-- apply historical workouts again; their first receipt is display-only.
insert into public.session_progress_results (session_id, user_id, legacy)
select id, user_id, true from public.sessions where completed_at is not null;

create function public.apply_session_progress(
  p_session_id uuid, p_expected jsonb, p_updates jsonb, p_result jsonb
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  owner_id uuid := auth.uid();
  workout public.sessions%rowtype;
  receipt public.session_progress_results%rowtype;
  patch jsonb;
  baseline jsonb;
  current_state jsonb;
  inserted int;
  exercise text;
  result_lines jsonb := p_result;
  historical boolean;
begin
  if owner_id is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  -- All sessions for this account share one transaction lock. Two different
  -- workouts cannot calculate progression against the same stale baseline.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(owner_id::text, 0));
  select * into workout from public.sessions
    where id = p_session_id and user_id = owner_id for update;
  if not found or workout.completed_at is null then
    raise exception 'completed workout not found' using errcode = '42501';
  end if;
  select * into receipt from public.session_progress_results where session_id = p_session_id;
  if found and receipt.result is not null then return receipt.result; end if;
  historical := coalesce(receipt.legacy, false);

  if jsonb_typeof(p_expected) is distinct from 'array'
    or jsonb_typeof(p_updates) is distinct from 'array'
    or jsonb_typeof(p_result) is distinct from 'array' then
    raise exception 'invalid progression payload' using errcode = '22023';
  end if;
  if jsonb_array_length(p_updates) > 100 or jsonb_array_length(p_result) > 100
    or jsonb_array_length(p_expected) > 100
    or (select count(*) from jsonb_array_elements(p_updates)) <>
       (select count(distinct value->>'exercise_id') from jsonb_array_elements(p_updates)) then
    raise exception 'invalid progression payload' using errcode = '22023';
  end if;
  if historical then
    select coalesce(jsonb_agg(value || jsonb_build_object('verdict', null, 'isPr', false)), '[]'::jsonb)
      into result_lines from jsonb_array_elements(p_result);
  else
    for patch in select value from jsonb_array_elements(p_updates) order by value->>'exercise_id' loop
      exercise := patch->>'exercise_id';
      if not exists (
        select 1 from public.set_logs l
        join public.plan_items i on i.id = l.plan_item_id and i.exercise_id = l.exercise_id
        join public.plan_blocks b on b.id = i.block_id
        join public.plan_days d on d.id = b.plan_day_id
        join public.plans p on p.id = d.plan_id
        where l.session_id = p_session_id and l.exercise_id = exercise
          and d.id = workout.plan_day_id and p.user_id = owner_id and b.kind <> 'warmup'
      ) then raise exception 'exercise is not part of this workout' using errcode = '42501'; end if;

      -- Visiting an older summary must not replace a newer working weight.
      if exists (
        select 1 from public.session_progress_results r
        join public.sessions s on s.id = r.session_id
        where r.user_id = owner_id and s.started_at > workout.started_at
          and (r.result @> jsonb_build_array(jsonb_build_object('exerciseId', exercise))
            or (r.legacy and exists (select 1 from public.set_logs newer_log
              where newer_log.session_id = s.id and newer_log.exercise_id = exercise)))
      ) then
        select coalesce(jsonb_agg(case when value->>'exerciseId' = exercise
          then value || jsonb_build_object('verdict', null, 'isPr', false) else value end), '[]'::jsonb)
          into result_lines from jsonb_array_elements(result_lines);
        continue;
      end if;
      if (select count(*) from jsonb_array_elements(p_expected) where value->>'exercise_id' = exercise) <> 1 then
        raise exception 'missing progression baseline' using errcode = '22023';
      end if;
      select value->'state' into baseline from jsonb_array_elements(p_expected)
        where value->>'exercise_id' = exercise;
      -- Materialize a missing row before comparison, then lock it. A failed
      -- comparison rolls this insertion back with the rest of the transaction.
      insert into public.exercise_progress(user_id, exercise_id) values(owner_id, exercise)
        on conflict do nothing;
      get diagnostics inserted = row_count;
      select to_jsonb(p) - 'user_id' - 'updated_at' into current_state
        from public.exercise_progress p where user_id = owner_id and exercise_id = exercise for update;
      if (inserted = 1 and baseline is distinct from 'null'::jsonb)
        or (inserted = 0 and current_state is distinct from baseline) then
        raise exception 'progression changed; reload and retry' using errcode = '40001';
      end if;
      if (patch->>'miss_streak')::int < 0 then
        raise exception 'invalid miss streak' using errcode = '22023';
      end if;
      update public.exercise_progress set
        last_weight_kg = (patch->>'last_weight_kg')::numeric,
        last_reps = (patch->>'last_reps')::int,
        best_weight_kg = (patch->>'best_weight_kg')::numeric,
        best_e1rm = (patch->>'best_e1rm')::numeric,
        miss_streak = (patch->>'miss_streak')::int,
        updated_at = now()
      where user_id = owner_id and exercise_id = exercise;
    end loop;
  end if;
  insert into public.session_progress_results(session_id, user_id, result, legacy)
    values(p_session_id, owner_id, result_lines, historical)
    on conflict(session_id) do update set result = excluded.result;
  return result_lines;
end;
$$;
revoke all on function public.apply_session_progress(uuid, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.apply_session_progress(uuid, jsonb, jsonb, jsonb) to authenticated;
-- All future progression writes use the locked RPC. Old clients must be
-- retired; the matching client archives legacy queued progress without replay.
revoke insert, update, delete on public.exercise_progress from anon, authenticated;
