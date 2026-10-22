-- Disposable database only. Rebuilds and exercise edits keep completed history intact.
\set ON_ERROR_STOP on
begin;
set local plpgsql.check_asserts=on;
do $$
declare
  owner uuid := gen_random_uuid();
  other_owner uuid := gen_random_uuid();
  old_plan uuid;
  new_plan uuid;
  item uuid;
  day_id uuid;
  saved_session uuid;
  outcome text;
  template jsonb;
  started_session uuid;
  preferences jsonb := '{"goal":"strength","experience":"intermediate","days_per_week":2,"session_minutes":30,"equipment":["dumbbell"],"limitations":["knee"]}';
  payload jsonb := '{"name":"New plan","split":"Full body","days":[{"name":"A","focus":"Full body","blocks":[{"kind":"straight","title":"Work","rounds":1,"rest_seconds":60,"items":[{"exercise_id":"press","sets":3,"reps_low":6,"reps_high":8}]}]},{"name":"B","focus":"Full body","blocks":[{"kind":"straight","title":"Work","rounds":1,"rest_seconds":60,"items":[{"exercise_id":"row","sets":3,"reps_low":6,"reps_high":8}]}]}]}';
begin
  insert into auth.users(id) values(owner),(other_owner);
  perform set_config('request.jwt.claim.sub',owner::text,true);
  old_plan := public.save_plan(payload);
  select d.id,i.id into day_id,item from public.plan_days d join public.plan_blocks b on b.plan_day_id=d.id join public.plan_items i on i.block_id=b.id where d.plan_id=old_plan and d.day_index=0;
  insert into public.sessions(user_id,plan_day_id,local_day,tz,completed_at) values(owner,day_id,current_date,'UTC',now()) returning id into saved_session;
  insert into public.set_logs(session_id,plan_item_id,exercise_id,set_index,reps) values(saved_session,item,'press',0,8);
  assert not has_function_privilege('anon','public.save_training_plan(jsonb,jsonb)','EXECUTE'), 'anonymous rebuild permitted';
  assert not has_function_privilege('anon','public.replace_plan_exercise(uuid,text,text,jsonb,text)','EXECUTE'), 'anonymous swap permitted';
  execute 'set local role authenticated';
  new_plan := public.save_training_plan(preferences,payload);
  assert exists(select 1 from public.profiles where id=owner and goal='strength' and days_per_week=2 and equipment=array['dumbbell'] and limitations=array['knee']), 'preferences missing';
  assert exists(select 1 from public.plans where id=old_plan and not is_active), 'old plan not retired';
  assert exists(select 1 from public.sessions where id=saved_session), 'history deleted';
  assert exists(select 1 from public.set_logs where session_id=saved_session and exercise_id='press'), 'logged exercise changed';
  begin
    perform public.save_training_plan(preferences || '{"days_per_week":5}',payload);
    raise exception 'mismatched rebuild accepted';
  exception when raise_exception then
    get stacked diagnostics outcome = message_text;
    assert outcome = 'invalid training preferences', 'wrong invalid-preference failure';
  end;
  assert (select days_per_week=2 from public.profiles where id=owner), 'failed rebuild changed profile';
  assert (select is_active from public.plans where id=new_plan), 'failed rebuild retired active plan';
  begin
    perform public.save_training_plan(preferences || '{"goal":"hypertrophy"}',
      jsonb_set(payload,'{days,0,blocks,0,items,0,exercise_id}','null'::jsonb));
    raise exception 'broken plan accepted';
  exception when not_null_violation then null;
  end;
  assert (select goal='strength' from public.profiles where id=owner), 'plan failure did not roll back profile';
  assert (select is_active from public.plans where id=new_plan), 'plan failure did not roll back active plan';
  select d.id,i.id into day_id,item from public.plan_days d join public.plan_blocks b on b.plan_day_id=d.id join public.plan_items i on i.block_id=b.id where d.plan_id=new_plan and d.day_index=0;
  select jsonb_agg(jsonb_build_object('id',i.id,'exercise_id',i.exercise_id)) into template from public.plan_items i join public.plan_blocks b on b.id=i.block_id where b.plan_day_id=day_id;
  perform public.replace_plan_exercise(item,'press','floor_press',preferences,null);
  begin
    perform public.start_workout(day_id,template,'{"units":"lb","bodyweightKg":80}');
    raise exception 'stale overview accepted';
  exception when raise_exception then
    get stacked diagnostics outcome = message_text;
    assert outcome like 'This plan changed%', 'stale overview was not rejected';
  end;
  assert not exists(select 1 from public.sessions where plan_day_id=day_id), 'failed start created a session';
  assert (select exercise_id='floor_press' from public.plan_items where id=item), 'swap not persisted';
  begin
    perform public.replace_plan_exercise(item,'press','stale_choice',preferences,null);
    raise exception 'stale edit accepted';
  exception when raise_exception then
    get stacked diagnostics outcome = message_text;
    assert outcome like 'This plan changed%', 'stale edit not rejected';
  end;
  perform set_config('request.jwt.claim.sub',other_owner::text,true);
  begin
    perform public.replace_plan_exercise(item,'floor_press','foreign',preferences,null);
    raise exception 'foreign edit accepted';
  exception when raise_exception then
    get stacked diagnostics outcome = message_text;
    assert outcome like 'Training preferences changed%' or outcome like 'This plan changed%', 'foreign edit not rejected';
  end;
  perform set_config('request.jwt.claim.sub',owner::text,true);
  select jsonb_agg(jsonb_build_object('id',i.id,'exercise_id',i.exercise_id)) into template from public.plan_items i join public.plan_blocks b on b.id=i.block_id where b.plan_day_id=day_id;
  started_session := public.start_workout(day_id,template,'{"units":"lb","bodyweightKg":80}');
  assert exists(select 1 from public.sessions s join public.profiles p on p.id=s.user_id
    where s.id=started_session and s.calculation_units='lb' and s.bodyweight_kg=80 and s.calculation_context_captured
      and s.tz=p.home_timezone and s.local_day=(s.started_at at time zone p.home_timezone)::date), 'session context or home calendar was not captured atomically';
  begin
    perform public.replace_plan_exercise(item,'floor_press','mid_workout',preferences,null);
    raise exception 'active workout edit accepted';
  exception when raise_exception then
    get stacked diagnostics outcome = message_text;
    assert outcome like 'Finish the active%', 'active workout edit not rejected';
  end;
  assert (select exercise_id='floor_press' from public.plan_items where id=item), 'rejected edit changed exercise';
end;
$$;
rollback;
