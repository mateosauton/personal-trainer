-- One statement snapshot; caller ownership and existing RLS both apply.
create or replace function public.export_account_data()
returns jsonb
language plpgsql stable security invoker
set search_path = public, pg_temp
as $$
declare owner uuid := auth.uid();
begin
  if owner is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  return (
    with owned_plans as (select * from public.plans where user_id=owner),
    owned_days as (select d.* from public.plan_days d join owned_plans p on p.id=d.plan_id),
    owned_blocks as (select b.* from public.plan_blocks b join owned_days d on d.id=b.plan_day_id),
    owned_items as (select i.* from public.plan_items i join owned_blocks b on b.id=i.block_id),
    owned_sessions as (select * from public.sessions where user_id=owner)
    select jsonb_build_object(
      'format_version',1, 'account_id',owner, 'exported_at',statement_timestamp(),
      'profile',(select to_jsonb(p) from public.profiles p where p.id=owner),
      'plans',coalesce((select jsonb_agg(to_jsonb(p) order by p.id) from owned_plans p),'[]'::jsonb),
      'plan_days',coalesce((select jsonb_agg(to_jsonb(d) order by d.id) from owned_days d),'[]'::jsonb),
      'plan_blocks',coalesce((select jsonb_agg(to_jsonb(b) order by b.id) from owned_blocks b),'[]'::jsonb),
      'plan_items',coalesce((select jsonb_agg(to_jsonb(i) order by i.id) from owned_items i),'[]'::jsonb),
      'sessions',coalesce((select jsonb_agg(to_jsonb(s) order by s.started_at,s.id) from owned_sessions s),'[]'::jsonb),
      'session_summaries',coalesce((select jsonb_agg(jsonb_build_object('session_id',r.session_id,'lines',r.result) order by r.session_id) from public.session_progress_results r join owned_sessions s on s.id=r.session_id where r.user_id=owner and r.result is not null),'[]'::jsonb),
      'set_logs',coalesce((select jsonb_agg(to_jsonb(l) order by l.completed_at,l.id) from public.set_logs l join owned_sessions s on s.id=l.session_id),'[]'::jsonb),
      'exercise_progress',coalesce((select jsonb_agg(to_jsonb(e) order by e.exercise_id) from public.exercise_progress e where e.user_id=owner),'[]'::jsonb)
    )
  );
end;
$$;
revoke all on function public.export_account_data() from public, anon;
grant execute on function public.export_account_data() to authenticated;
notify pgrst, 'reload schema';
