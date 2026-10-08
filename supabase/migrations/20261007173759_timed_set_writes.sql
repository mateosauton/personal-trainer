-- Additive backend prerequisite for timed-set clients. Existing history is unchanged.
-- Deploy after 0007; validate with the paired client before a production rollout.
alter table public.set_logs add column seconds int
  check (seconds is null or (seconds between 1 and 86400 and reps is null));

create or replace function public.normalize_set_write(p_set jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare
  field text;
  value numeric;
  item uuid;
  seconds numeric;
  canonical jsonb;
begin
  if jsonb_typeof(p_set) is distinct from 'object'
    or jsonb_typeof(p_set->'plan_item_id') is distinct from 'string'
    or jsonb_typeof(p_set->'exercise_id') is distinct from 'string'
    or length(p_set->>'exercise_id') not between 1 and 500
    or jsonb_typeof(p_set->'is_bodyweight') is distinct from 'boolean' then
    raise exception 'invalid set payload' using errcode='22023';
  end if;
  item := (p_set->>'plan_item_id')::uuid;
  for field in select unnest(array['set_index','reps','weight_kg','added_load_kg','rpe']) loop
    if jsonb_typeof(p_set->field) is distinct from 'number'
      and (field in ('set_index','added_load_kg') or jsonb_typeof(p_set->field) is distinct from 'null') then
      raise exception 'invalid set payload' using errcode='22023';
    end if;
    value := (p_set->>field)::numeric;
    if value is not null and (value < 0 or value > 100000
      or (field in ('set_index','reps','rpe') and value <> trunc(value))
      or (field='set_index' and value not between 1 and 1000)
      or (field='reps' and value > 1000)
      or (field='rpe' and value not between 1 and 10)) then
      raise exception 'invalid set payload' using errcode='22023';
    end if;
  end loop;
  -- Omit null duration from canonical payloads so pre-migration receipts still replay.
  if p_set ? 'seconds' and jsonb_typeof(p_set->'seconds') <> 'null' then
    if jsonb_typeof(p_set->'seconds') <> 'number' then
      raise exception 'invalid set duration' using errcode='22023';
    end if;
    seconds := (p_set->>'seconds')::numeric;
    if seconds not between 1 and 86400 or seconds <> trunc(seconds)
      or p_set->'reps' <> 'null'::jsonb then
      raise exception 'invalid set duration' using errcode='22023';
    end if;
  end if;
  canonical := jsonb_build_object('plan_item_id',item,'exercise_id',p_set->>'exercise_id',
    'set_index',(p_set->>'set_index')::int,'reps',(p_set->>'reps')::int,
    'weight_kg',(p_set->>'weight_kg')::numeric,'is_bodyweight',(p_set->>'is_bodyweight')::boolean,
    'added_load_kg',(p_set->>'added_load_kg')::numeric,'rpe',(p_set->>'rpe')::int);
  if seconds is not null then canonical := canonical || jsonb_build_object('seconds',seconds::int); end if;
  return canonical;
end;
$$;
revoke all on function public.normalize_set_write(jsonb) from public, anon, authenticated;

create or replace function public.log_set_versioned(
  p_session_id uuid,p_set jsonb,p_origin uuid,p_revision bigint,
  p_expected_version bigint,p_event_at timestamptz
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  owner_id uuid := auth.uid();
  workout public.sessions%rowtype;
  log public.set_logs%rowtype;
  version public.set_write_versions%rowtype;
  previous public.set_write_origins%rowtype;
  canonical jsonb;
  item uuid;
  next_version bigint;
  outcome text;
begin
  if owner_id is null then raise exception 'not authenticated' using errcode='42501'; end if;
  if p_origin is null or p_revision is null or p_revision not between 1 and 9007199254740991
    or p_expected_version is null or p_expected_version not between 0 and 9007199254740991
    or p_event_at is null or not isfinite(p_event_at) then
    raise exception 'invalid set version or event time' using errcode='22023';
  end if;
  canonical := public.normalize_set_write(p_set);
  item := (canonical->>'plan_item_id')::uuid;
  -- Share progression's account/session locks: a receipt freezes acknowledged sets.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(owner_id::text,0));
  select * into workout from public.sessions where id=p_session_id and user_id=owner_id for update;
  if not found then raise exception 'workout not found' using errcode='42501'; end if;
  if not exists(select 1 from public.plan_items i
    join public.plan_blocks b on b.id=i.block_id
    join public.plan_days d on d.id=b.plan_day_id
    join public.plans p on p.id=d.plan_id
    where i.id=item and i.exercise_id=canonical->>'exercise_id'
      and d.id=workout.plan_day_id and p.user_id=owner_id) then
    raise exception 'set is not part of this workout' using errcode='42501';
  end if;
  if canonical ? 'seconds' and exists(select 1 from public.plan_items where id=item and seconds is null) then
    raise exception 'duration requires a timed plan item' using errcode='22023';
  end if;
  select * into log from public.set_logs where session_id=p_session_id
    and plan_item_id=item and set_index=(canonical->>'set_index')::int for update;
  if found then
    select * into version from public.set_write_versions where log_id=log.id for update;
    if not found then raise exception 'set version requires recovery' using errcode='PT409'; end if;
    select * into previous from public.set_write_origins where log_id=log.id and origin=p_origin;
    if found and p_revision <= previous.revision then
      outcome := 'superseded';
      if p_revision=previous.revision then
        if canonical is distinct from previous.payload or p_event_at is distinct from previous.event_at then
          raise exception 'set revision was reused with different content' using errcode='22023';
        end if;
        if version.current_origin=p_origin and version.server_version=previous.server_version then outcome:='duplicate'; end if;
      end if;
      return jsonb_build_object('status',outcome,'serverVersion',version.server_version);
    end if;
  end if;
  if exists(select 1 from public.session_progress_results where session_id=p_session_id) then
    raise exception 'workout summary is already finalized' using errcode='PT410';
  end if;
  if log.id is null then
    if p_expected_version<>0 then raise exception 'set changed on the server' using errcode='PT409'; end if;
    next_version:=1;
    insert into public.set_logs(session_id,plan_item_id,exercise_id,set_index,reps,seconds,weight_kg,is_bodyweight,added_load_kg,rpe,completed_at)
      values(p_session_id,item,canonical->>'exercise_id',(canonical->>'set_index')::int,
        (canonical->>'reps')::int,(canonical->>'seconds')::int,(canonical->>'weight_kg')::numeric,(canonical->>'is_bodyweight')::boolean,
        (canonical->>'added_load_kg')::numeric,(canonical->>'rpe')::int,p_event_at) returning * into log;
    insert into public.set_write_versions(log_id,user_id,current_origin,server_version)
      values(log.id,owner_id,p_origin,next_version);
  else
    if version.current_origin is distinct from p_origin and p_expected_version<>version.server_version then
      raise exception 'set changed on another device' using errcode='PT409';
    end if;
    if version.server_version=9007199254740991 then raise exception 'set version limit reached' using errcode='22023'; end if;
    next_version:=version.server_version+1;
    update public.set_logs set reps=(canonical->>'reps')::int,seconds=(canonical->>'seconds')::int,weight_kg=(canonical->>'weight_kg')::numeric,
      is_bodyweight=(canonical->>'is_bodyweight')::boolean,added_load_kg=(canonical->>'added_load_kg')::numeric,
      rpe=(canonical->>'rpe')::int,completed_at=p_event_at where id=log.id;
    update public.set_write_versions set current_origin=p_origin,server_version=next_version where log_id=log.id;
  end if;
  insert into public.set_write_origins(log_id,origin,revision,payload,event_at,server_version)
    values(log.id,p_origin,p_revision,canonical,p_event_at,next_version)
    on conflict(log_id,origin) do update set revision=excluded.revision,payload=excluded.payload,
      event_at=excluded.event_at,server_version=excluded.server_version;
  return jsonb_build_object('status','applied','serverVersion',next_version);
end;
$$;
revoke all on function public.log_set_versioned(uuid,jsonb,uuid,bigint,bigint,timestamptz) from public, anon;
grant execute on function public.log_set_versioned(uuid,jsonb,uuid,bigint,bigint,timestamptz) to authenticated;


notify pgrst, 'reload schema';
