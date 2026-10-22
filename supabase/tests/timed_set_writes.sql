-- Run against a disposable database after migrations; all fixtures roll back.
\set ON_ERROR_STOP on
begin;
set local plpgsql.check_asserts=on;
do $$
declare
  owner uuid := gen_random_uuid();
  other_owner uuid := gen_random_uuid();
  plan uuid;
  day uuid;
  timed_item uuid;
  rep_item uuid;
  session uuid;
  origin uuid := gen_random_uuid();
  event_time timestamptz := now();
  payload jsonb;
  legacy jsonb;
  state jsonb;
  outcome jsonb;
  invalid jsonb;
begin
  payload := jsonb_build_object('plan_item_id',gen_random_uuid(),'exercise_id','hold',
    'set_index',1,'reps',null,'seconds',40,'weight_kg',0,
    'is_bodyweight',false,'added_load_kg',0,'rpe',null);
  assert public.normalize_set_write(payload)->>'seconds' = '40', 'duration was discarded';
  foreach invalid in array array['0'::jsonb,'-1'::jsonb,'40.5'::jsonb,'86401'::jsonb,'"40"'::jsonb] loop
    begin
      perform public.normalize_set_write(payload || jsonb_build_object('seconds',invalid));
      raise exception 'invalid duration accepted: %',invalid;
    exception when sqlstate '22023' then null;
    end;
  end loop;
  begin
    perform public.normalize_set_write(payload || '{"reps":20}');
    raise exception 'mixed reps and duration accepted';
  exception when sqlstate '22023' then null;
  end;
  legacy := payload - 'seconds' || '{"reps":12}';
  assert not (public.normalize_set_write(legacy) ? 'seconds'), 'legacy receipt shape changed';
  assert public.normalize_set_write(legacy || '{"seconds":null}') = public.normalize_set_write(legacy),
    'null duration must preserve legacy receipt shape';

  insert into auth.users(id) values(owner),(other_owner);
  perform set_config('request.jwt.claim.sub',owner::text,true);
  plan := public.save_plan('{"name":"Timed test","split":"full_body","days":[{"name":"Day","focus":"Mixed","blocks":[{"kind":"straight","title":"Work","rounds":1,"rest_seconds":30,"items":[{"exercise_id":"hold","sets":2,"reps_low":8,"reps_high":12,"seconds":40},{"exercise_id":"press","sets":2,"reps_low":8,"reps_high":12}]}]}]}');
  select id into day from public.plan_days where plan_id=plan;
  select i.id into timed_item from public.plan_items i join public.plan_blocks b on b.id=i.block_id
    where b.plan_day_id=day and i.exercise_id='hold';
  select i.id into rep_item from public.plan_items i join public.plan_blocks b on b.id=i.block_id
    where b.plan_day_id=day and i.exercise_id='press';
  insert into public.sessions(user_id,plan_day_id,local_day,tz) values(owner,day,current_date,'UTC') returning id into session;
  assert not has_function_privilege('anon','public.log_set_versioned(uuid,jsonb,uuid,bigint,bigint,timestamptz)','EXECUTE'), 'anonymous write privilege';
  execute 'set local role authenticated';
  payload := payload || jsonb_build_object('plan_item_id',timed_item);
  outcome := public.log_set_versioned(session,payload,origin,1,0,event_time);
  assert outcome->>'status'='applied', 'timed write not applied';
  assert public.log_set_versioned(session,payload,origin,1,0,event_time)->>'status'='duplicate', 'timed replay not idempotent';
  state := public.get_set_write_state(session,timed_item,1);
  assert state->'set'->>'seconds'='40' and state->'set'->'reps'='null'::jsonb, 'timed state incorrect';
  assert public.check_legacy_set(session,payload)->>'status'='duplicate', 'duration comparison incorrect';
  payload := payload || '{"seconds":45}';
  assert public.log_set_versioned(session,payload,origin,2,1,event_time)->>'status'='applied', 'timed edit failed';
  assert public.log_set_versioned(session,payload || '{"seconds":40}',origin,1,0,event_time)->>'status'='superseded', 'stale duration overwrote edit';
  state := public.get_session_set_snapshot(session);
  assert jsonb_array_length(state->'logs')=1 and state->'logs'->0->>'seconds'='45', 'duration missing from snapshot';

  begin
    perform public.log_set_versioned(session,payload || jsonb_build_object('plan_item_id',rep_item,'exercise_id','press'),origin,1,0,event_time);
    raise exception 'duration accepted for rep movement';
  exception when sqlstate '22023' then null;
  end;
  legacy := legacy || jsonb_build_object('plan_item_id',rep_item,'exercise_id','press');
  assert public.log_set_versioned(session,legacy,origin,1,0,event_time)->>'status'='applied', 'legacy rep write failed';
  assert public.log_set_versioned(session,legacy || '{"seconds":null}',origin,1,0,event_time)->>'status'='duplicate', 'legacy receipt replay failed';
  begin
    insert into public.set_logs(session_id,plan_item_id,exercise_id,set_index,reps,seconds) values(session,timed_item,'hold',2,null,40);
    raise exception 'direct write bypassed ordering';
  exception when sqlstate '42501' then null;
  end;
  perform set_config('request.jwt.claim.sub',other_owner::text,true);
  begin
    perform public.log_set_versioned(session,payload,origin,3,2,event_time);
    raise exception 'foreign account wrote duration';
  exception when sqlstate '42501' then null;
  end;
  raise notice 'Timed writes: validation, persistence, edits, replay, snapshots, legacy compatibility and account isolation passed';
end;
$$;
rollback;
