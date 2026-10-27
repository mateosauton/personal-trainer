-- Keep the deployed five-argument start_session unchanged for older saved starts.
-- New starts bind calculation and template context to the same client UUID.
alter table public.sessions add column start_template_items jsonb;

create function public.preserve_session_start_template()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.start_template_items is distinct from old.start_template_items then
    raise exception 'Original workout template is immutable' using errcode='22023';
  end if;
  return new;
end;
$$;
revoke all on function public.preserve_session_start_template() from public, anon, authenticated;
create trigger preserve_session_start_template before update on public.sessions
for each row execute function public.preserve_session_start_template();

create function public.start_session_with_context(
  p_session_id uuid, p_plan_day_id uuid, p_started_at timestamptz,
  p_local_day date, p_tz text, p_expected_items jsonb, p_context jsonb
) returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  owner_id uuid := auth.uid();
  existing public.sessions%rowtype;
  expected jsonb;
  actual jsonb;
  entry jsonb;
begin
  if owner_id is null then raise exception 'not authenticated' using errcode='42501'; end if;
  if p_session_id is null or p_plan_day_id is null
    or p_started_at is null or not pg_catalog.isfinite(p_started_at)
    or p_local_day is null or not pg_catalog.isfinite(p_local_day)
    or p_tz is null or not exists(select 1 from pg_catalog.pg_timezone_names where name=p_tz)
    or (p_started_at at time zone p_tz)::date is distinct from p_local_day then
    raise exception 'invalid workout start context' using errcode='22023';
  end if;
  if jsonb_typeof(p_context) is distinct from 'object'
    or jsonb_typeof(p_context->'units') is distinct from 'string'
    or p_context->>'units' not in ('kg','lb')
    or not p_context ? 'bodyweightKg'
    or jsonb_typeof(p_context->'bodyweightKg') not in ('number','null') then
    raise exception 'original workout context required' using errcode='22023';
  end if;
  if (p_context->>'bodyweightKg')::numeric not between 0 and 100000 then
    raise exception 'invalid original bodyweight' using errcode='22023';
  end if;
  if jsonb_typeof(p_expected_items) is distinct from 'array'
    or jsonb_array_length(p_expected_items) not between 1 and 10000 then
    raise exception 'workout template required' using errcode='22023';
  end if;
  for entry in select value from jsonb_array_elements(p_expected_items) loop
    if jsonb_typeof(entry) is distinct from 'object'
      or jsonb_typeof(entry->'id') is distinct from 'string'
      or jsonb_typeof(entry->'exercise_id') is distinct from 'string'
      or length(entry->>'exercise_id')=0 then
      raise exception 'invalid workout template' using errcode='22023';
    end if;
    perform (entry->>'id')::uuid;
  end loop;
  select jsonb_agg(jsonb_build_object('id',(value->>'id')::uuid,
    'exercise_id',value->>'exercise_id') order by (value->>'id')::uuid)
    into expected from jsonb_array_elements(p_expected_items);
  if jsonb_array_length(expected)<>(select count(distinct (value->>'id')::uuid)
    from jsonb_array_elements(p_expected_items)) then
    raise exception 'duplicate workout template item' using errcode='22023';
  end if;
  -- The same owner lock serializes starts with exercise swaps and other starts.
  perform 1 from public.profiles where id=owner_id for update;
  if not found then raise exception 'profile not found' using errcode='42501'; end if;
  select * into existing from public.sessions where id=p_session_id for update;
  if not found then
    if not exists(select 1 from public.plan_days d join public.plans p on p.id=d.plan_id
      where d.id=p_plan_day_id and p.user_id=owner_id) then
      raise exception 'workout day not found' using errcode='42501';
    end if;
    select jsonb_agg(jsonb_build_object('id',i.id,'exercise_id',i.exercise_id) order by i.id)
      into actual from public.plan_items i join public.plan_blocks b on b.id=i.block_id
      join public.plan_days d on d.id=b.plan_day_id join public.plans p on p.id=d.plan_id
      where d.id=p_plan_day_id and p.user_id=owner_id;
    -- Retired owned days remain usable offline, but a swapped template must be reviewed.
    if actual is null or actual is distinct from expected then
      raise exception 'This plan changed. Reopen the session before starting.' using errcode='PT409';
    end if;
    insert into public.sessions(id,user_id,plan_day_id,started_at,local_day,tz,
      calculation_units,bodyweight_kg,calculation_context_captured,start_template_items)
    values(p_session_id,owner_id,p_plan_day_id,p_started_at,p_local_day,p_tz,
      p_context->>'units',(p_context->>'bodyweightKg')::numeric,true,expected)
    on conflict(id) do nothing;
    select * into existing from public.sessions where id=p_session_id for update;
  end if;
  if existing.id is null or existing.user_id<>owner_id then
    raise exception 'workout not found' using errcode='42501';
  end if;
  if existing.plan_day_id is distinct from p_plan_day_id
    or existing.started_at is distinct from p_started_at
    or existing.local_day is distinct from p_local_day or existing.tz is distinct from p_tz
    or existing.calculation_context_captured is distinct from true
    or existing.calculation_units is distinct from p_context->>'units'
    or existing.bodyweight_kg is distinct from (p_context->>'bodyweightKg')::numeric
    or existing.start_template_items is distinct from expected then
    raise exception 'workout start identity changed' using errcode='PT409';
  end if;
  return existing.id;
end;
$$;
revoke all on function public.start_session_with_context(uuid,uuid,timestamptz,date,text,jsonb,jsonb) from public,anon;
grant execute on function public.start_session_with_context(uuid,uuid,timestamptz,date,text,jsonb,jsonb) to authenticated;
notify pgrst, 'reload schema';
