-- Disposable database only. All fixtures roll back.
\set ON_ERROR_STOP on
begin;
set local plpgsql.check_asserts=on;
do $$
declare
  owner uuid := gen_random_uuid();
  other_owner uuid := gen_random_uuid();
  plan uuid;
  day uuid;
  session uuid;
  snapshot jsonb;
begin
  insert into auth.users(id) values(owner),(other_owner);
  perform set_config('request.jwt.claim.sub',owner::text,true);
  plan := public.save_plan('{"name":"Export plan","split":"full_body","days":[{"name":"Day","focus":"Mixed","blocks":[{"kind":"straight","title":"Work","rounds":1,"rest_seconds":30,"items":[{"exercise_id":"hold","sets":1,"reps_low":8,"reps_high":12,"seconds":40}]}]}]}');
  select id into day from public.plan_days where plan_id=plan;
  insert into public.sessions(user_id,plan_day_id,local_day,tz) values(owner,day,current_date,'UTC') returning id into session;
  insert into public.set_logs(session_id,exercise_id,set_index,reps,seconds)
    select session,'hold',i,null,40 from generate_series(1,1002) i;
  insert into public.exercise_progress(user_id,exercise_id,last_reps) values(owner,'press',12);
  insert into public.session_progress_results(session_id,user_id,result)
    values(session,owner,'[{"exerciseId":"hold","seconds":40,"isPr":false,"verdict":null}]');
  assert not has_function_privilege('anon','public.export_account_data()','EXECUTE'), 'anonymous export privilege';
  execute 'set local role authenticated';
  snapshot := public.export_account_data();
  assert snapshot->>'account_id'=owner::text, 'wrong export owner';
  assert snapshot->>'format_version'='1', 'missing export version';
  assert snapshot->'profile'->>'id'=owner::text, 'profile missing';
  assert jsonb_array_length(snapshot->'plans')=1, 'plans missing';
  assert jsonb_array_length(snapshot->'plan_days')=1, 'days missing';
  assert jsonb_array_length(snapshot->'plan_blocks')=1, 'blocks missing';
  assert jsonb_array_length(snapshot->'plan_items')=1, 'items missing';
  assert jsonb_array_length(snapshot->'sessions')=1, 'session missing';
  assert snapshot->'session_summaries'->0->'lines'->0->>'seconds'='40', 'saved summary missing';
  assert not (snapshot->'session_summaries'->0 ? 'legacy'), 'summary receipt metadata leaked';
  assert jsonb_array_length(snapshot->'set_logs')=1002, 'history truncated';
  assert snapshot->'set_logs'->0->>'seconds'='40', 'duration lost';
  assert jsonb_array_length(snapshot->'exercise_progress')=1, 'progress missing';
  assert not snapshot ? 'set_write_origins' and not snapshot ? 'session_progress_results', 'internal receipts exported';
  perform set_config('request.jwt.claim.sub',other_owner::text,true);
  snapshot := public.export_account_data();
  assert snapshot->>'account_id'=other_owner::text, 'other account owner wrong';
  assert jsonb_array_length(snapshot->'plans')=0 and jsonb_array_length(snapshot->'set_logs')=0, 'foreign history leaked';
  assert position(owner::text in snapshot::text)=0, 'foreign owner leaked';
  perform set_config('request.jwt.claim.sub','',true);
  begin
    perform public.export_account_data();
    raise exception 'unauthenticated export accepted';
  exception when sqlstate '42501' then null;
  end;
  raise notice 'Export: complete history, duration, account isolation and anonymous denial passed';
end;
$$;
rollback;
