-- The client persists one UUID and time context before sending a workout start.
-- Retrying after an ambiguous response acknowledges that same session only.
create function public.start_session(
  p_session_id uuid,
  p_plan_day_id uuid,
  p_started_at timestamptz,
  p_local_day date,
  p_tz text
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  owner_id uuid := auth.uid();
  existing public.sessions%rowtype;
begin
  if owner_id is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_session_id is null or p_plan_day_id is null
    or p_started_at is null or not pg_catalog.isfinite(p_started_at)
    or p_local_day is null or not pg_catalog.isfinite(p_local_day)
    or p_tz is null or not exists (
      select 1 from pg_catalog.pg_timezone_names where name = p_tz
    ) then
    raise exception 'invalid workout start context' using errcode = '22023';
  end if;
  if (p_started_at at time zone p_tz)::date <> p_local_day then
    raise exception 'workout date does not match its captured timezone' using errcode = '22023';
  end if;
  -- A cached plan may have been retired while the device was offline.
  if not exists (
    select 1 from public.plan_days d join public.plans p on p.id = d.plan_id
    where d.id = p_plan_day_id and p.user_id = owner_id
  ) then
    raise exception 'workout day not found' using errcode = '42501';
  end if;

  -- The primary key serializes concurrent copies of the same request. A fresh
  -- statement snapshot then sees the winner, including a just-committed insert.
  insert into public.sessions (id, user_id, plan_day_id, started_at, local_day, tz)
  values (p_session_id, owner_id, p_plan_day_id, p_started_at, p_local_day, p_tz)
  on conflict (id) do nothing;

  select * into existing from public.sessions where id = p_session_id for update;
  if not found or existing.user_id <> owner_id then
    raise exception 'workout not found' using errcode = '42501';
  end if;
  if existing.plan_day_id is distinct from p_plan_day_id
    or existing.started_at is distinct from p_started_at
    or existing.local_day is distinct from p_local_day
    or existing.tz is distinct from p_tz then
    raise exception 'workout start identity changed' using errcode = 'PT409';
  end if;
  return existing.id;
end;
$$;

revoke all on function public.start_session(uuid,uuid,timestamptz,date,text) from public, anon;
grant execute on function public.start_session(uuid,uuid,timestamptz,date,text) to authenticated;

notify pgrst, 'reload schema';
