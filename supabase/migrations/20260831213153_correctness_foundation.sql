-- C6: database-enforced active-plan invariant.
do $$
begin
  if exists (
    select 1 from public.plans where is_active
    group by user_id having count(*) > 1
  ) then
    raise exception 'cannot create plans_one_active_per_user: resolve duplicate active plans first';
  end if;
end;
$$;
drop index if exists public.plans_user_idx;
create unique index if not exists plans_one_active_per_user
  on public.plans (user_id) where is_active;

-- C7: calendar membership is a fact captured when the session starts, not a
-- value recalculated later in whatever timezone the device happens to use.
alter table public.sessions add column if not exists local_day date;
alter table public.sessions add column if not exists tz text;
update public.sessions
  set local_day = (started_at at time zone 'UTC')::date
  where local_day is null;
alter table public.sessions alter column local_day set not null;

create index if not exists sessions_user_local_day_idx
  on public.sessions (user_id, local_day desc)
  where completed_at is not null;
create index if not exists sessions_plan_day_completed_idx
  on public.sessions (plan_day_id, completed_at desc)
  where completed_at is not null;

-- C2: only sessions with substantial recorded work are backfilled. Apply this
-- only after a database snapshot; it changes historical streaks/rotation.
with logged as (
  select session_id, count(*) as n, max(completed_at) as last_set
    from public.set_logs group by session_id
)
update public.sessions s
   set completed_at = l.last_set,
       duration_s = greatest(1, extract(epoch from (l.last_set - s.started_at))::int)
  from logged l
 where l.session_id = s.id
   and s.completed_at is null
   and l.n >= 5;
