-- Deploy only with the reviewed versioned client and explicit production approval.
-- Existing set values and event times are preserved; only private metadata is added.
create table public.set_write_versions (
  log_id uuid primary key references public.set_logs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  current_origin uuid,
  server_version bigint not null check(server_version between 1 and 9007199254740991)
);
create table public.set_write_origins (
  log_id uuid not null references public.set_write_versions(log_id) on delete cascade,
  origin uuid not null,
  revision bigint not null check(revision between 1 and 9007199254740991),
  payload jsonb not null,
  event_at timestamptz not null,
  server_version bigint not null,
  primary key(log_id, origin)
);
alter table public.set_write_versions enable row level security;
alter table public.set_write_origins enable row level security;
revoke all on public.set_write_versions, public.set_write_origins from public, anon, authenticated;
insert into public.set_write_versions(log_id,user_id,server_version)
  select l.id,s.user_id,1 from public.set_logs l join public.sessions s on s.id=l.session_id;

create function public.normalize_set_write(p_set jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare
  field text;
  value numeric;
  item uuid;
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
  return jsonb_build_object('plan_item_id',item,'exercise_id',p_set->>'exercise_id',
    'set_index',(p_set->>'set_index')::int,'reps',(p_set->>'reps')::int,
    'weight_kg',(p_set->>'weight_kg')::numeric,'is_bodyweight',(p_set->>'is_bodyweight')::boolean,
    'added_load_kg',(p_set->>'added_load_kg')::numeric,'rpe',(p_set->>'rpe')::int);
end;
$$;
revoke all on function public.normalize_set_write(jsonb) from public, anon, authenticated;

create function public.get_set_write_state(p_session_id uuid,p_plan_item_id uuid,p_set_index int)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  if auth.uid() is null or not exists(select 1 from public.sessions s
    where s.id=p_session_id and s.user_id=auth.uid()) then
    raise exception 'workout not found' using errcode='42501';
  end if;
  select jsonb_build_object('serverVersion',v.server_version,'origin',v.current_origin,
    'revision',coalesce(o.revision,0),'set',public.normalize_set_write(to_jsonb(l)),
    'eventAt',l.completed_at) into result
    from public.set_logs l join public.set_write_versions v on v.log_id=l.id
    left join public.set_write_origins o on o.log_id=l.id and o.origin=v.current_origin
    where l.session_id=p_session_id and l.plan_item_id=p_plan_item_id and l.set_index=p_set_index;
  return result;
end;
$$;
revoke all on function public.get_set_write_state(uuid,uuid,int) from public, anon;
grant execute on function public.get_set_write_state(uuid,uuid,int) to authenticated;

create function public.log_set_versioned(
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
    insert into public.set_logs(session_id,plan_item_id,exercise_id,set_index,reps,weight_kg,is_bodyweight,added_load_kg,rpe,completed_at)
      values(p_session_id,item,canonical->>'exercise_id',(canonical->>'set_index')::int,
        (canonical->>'reps')::int,(canonical->>'weight_kg')::numeric,(canonical->>'is_bodyweight')::boolean,
        (canonical->>'added_load_kg')::numeric,(canonical->>'rpe')::int,p_event_at) returning * into log;
    insert into public.set_write_versions(log_id,user_id,current_origin,server_version)
      values(log.id,owner_id,p_origin,next_version);
  else
    if version.current_origin is distinct from p_origin and p_expected_version<>version.server_version then
      raise exception 'set changed on another device' using errcode='PT409';
    end if;
    if version.server_version=9007199254740991 then raise exception 'set version limit reached' using errcode='22023'; end if;
    next_version:=version.server_version+1;
    update public.set_logs set reps=(canonical->>'reps')::int,weight_kg=(canonical->>'weight_kg')::numeric,
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

create function public.check_legacy_set(p_session_id uuid,p_set jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare canonical jsonb; current_state jsonb;
begin
  canonical:=public.normalize_set_write(p_set);
  current_state:=public.get_set_write_state(p_session_id,(canonical->>'plan_item_id')::uuid,(canonical->>'set_index')::int);
  if current_state is not null and current_state->'set'=canonical then
    return current_state || jsonb_build_object('status','duplicate');
  end if;
  -- No guesses about missing event times or whether a legacy queued edit is newer.
  return coalesce(current_state,jsonb_build_object('serverVersion',0,'set',null))
    || jsonb_build_object('status','conflict');
end;
$$;
revoke all on function public.check_legacy_set(uuid,jsonb) from public, anon;
grant execute on function public.check_legacy_set(uuid,jsonb) to authenticated;
-- Retire direct mutation clients; otherwise a late old request bypasses ordering.
revoke insert,update,delete on public.set_logs from public,anon,authenticated;

-- Return logs and their complete version set from one database snapshot.
create function public.get_session_set_snapshot(p_session_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare snapshot jsonb; missing boolean;
begin
  if auth.uid() is null or not exists(select 1 from public.sessions
    where id=p_session_id and user_id=auth.uid()) then
    raise exception 'workout not found' using errcode='42501';
  end if;
  select jsonb_build_object(
      'logs',coalesce(jsonb_agg(to_jsonb(l) order by l.completed_at,l.id),'[]'::jsonb),
      'versions',coalesce(jsonb_agg(jsonb_build_object('logId',l.id,'serverVersion',v.server_version)
        order by l.id),'[]'::jsonb)),coalesce(bool_or(v.log_id is null),false)
    into snapshot,missing from public.set_logs l
    left join public.set_write_versions v on v.log_id=l.id where l.session_id=p_session_id;
  if missing then raise exception 'set version requires recovery' using errcode='PT409'; end if;
  return snapshot;
end;
$$;
revoke all on function public.get_session_set_snapshot(uuid) from public,anon;
grant execute on function public.get_session_set_snapshot(uuid) to authenticated;

-- Membership and versions must still match when progression obtains its lock.
create function public.apply_session_progress(
  p_session_id uuid,p_expected jsonb,p_updates jsonb,p_result jsonb,p_set_versions jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  owner_id uuid := auth.uid();
  result jsonb;
  entry jsonb;
  captured jsonb;
  current_snapshot jsonb;
  version numeric;
begin
  if owner_id is null then raise exception 'not authenticated' using errcode='42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(owner_id::text,0));
  perform 1 from public.sessions where id=p_session_id and user_id=owner_id
    and completed_at is not null for update;
  if not found then raise exception 'completed workout not found' using errcode='42501'; end if;
  select r.result into result from public.session_progress_results r where r.session_id=p_session_id;
  if result is not null then return result; end if;
  if jsonb_typeof(p_set_versions) is distinct from 'array' then
    raise exception 'invalid set snapshot' using errcode='22023';
  end if;
  if jsonb_array_length(p_set_versions)>10000 then
    raise exception 'invalid set snapshot' using errcode='22023';
  end if;
  for entry in select value from jsonb_array_elements(p_set_versions) loop
    if jsonb_typeof(entry) is distinct from 'object'
      or jsonb_typeof(entry->'logId') is distinct from 'string'
      or jsonb_typeof(entry->'serverVersion') is distinct from 'number' then
      raise exception 'invalid set snapshot' using errcode='22023';
    end if;
    perform (entry->>'logId')::uuid;
    version:=(entry->>'serverVersion')::numeric;
    if version not between 1 and 9007199254740991 or version<>trunc(version) then
      raise exception 'invalid set snapshot' using errcode='22023';
    end if;
  end loop;
  if (select count(*) from jsonb_array_elements(p_set_versions)) <>
    (select count(distinct (value->>'logId')::uuid) from jsonb_array_elements(p_set_versions)) then
    raise exception 'duplicate set snapshot entry' using errcode='22023';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('logId',(value->>'logId')::uuid,
    'serverVersion',(value->>'serverVersion')::bigint) order by (value->>'logId')::uuid),'[]'::jsonb)
    into captured from jsonb_array_elements(p_set_versions);
  current_snapshot:=public.get_session_set_snapshot(p_session_id);
  if captured is distinct from current_snapshot->'versions' then
    raise exception 'workout sets changed; reload and retry' using errcode='40001';
  end if;
  return public.apply_session_progress(p_session_id,p_expected,p_updates,p_result);
end;
$$;
revoke all on function public.apply_session_progress(uuid,jsonb,jsonb,jsonb) from public,anon,authenticated;
revoke all on function public.apply_session_progress(uuid,jsonb,jsonb,jsonb,jsonb) from public,anon;
grant execute on function public.apply_session_progress(uuid,jsonb,jsonb,jsonb,jsonb) to authenticated;
