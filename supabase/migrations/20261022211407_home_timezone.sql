-- Existing local_day values retain their original capture/backfill meaning.
-- Home-calendar reads derive every date from started_at in one stable zone.
alter table public.profiles add column home_timezone text;
update public.profiles p set home_timezone = coalesce((
  select s.tz from public.sessions s join pg_catalog.pg_timezone_names z on z.name = s.tz
  where s.user_id = p.id order by s.started_at, s.id limit 1
), 'UTC');
alter table public.profiles alter column home_timezone set default 'UTC';
alter table public.profiles alter column home_timezone set not null;

create or replace function public.validate_home_timezone()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if not exists(select 1 from pg_catalog.pg_timezone_names where name = new.home_timezone) then
    raise exception 'invalid home timezone';
  end if;
  return new;
end;
$$;
revoke all on function public.validate_home_timezone() from public, anon;
create trigger validate_home_timezone before insert or update of home_timezone on public.profiles
for each row execute function public.validate_home_timezone();

-- Session starts and exercise swaps take the same profile lock. The template
-- comparison also rejects an overview loaded before another device's swap.
create or replace function public.lock_workout_start()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  perform 1 from public.profiles where id = new.user_id for update;
  if not found then raise exception 'profile not found' using errcode = '42501'; end if;
  return new;
end;
$$;
revoke all on function public.lock_workout_start() from public, anon, authenticated;
create trigger lock_workout_start before insert on public.sessions
for each row execute function public.lock_workout_start();

create or replace function public.start_workout(p_day_id uuid, p_expected_items jsonb, p_context jsonb)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare owner uuid := auth.uid(); zone text; actual jsonb; expected jsonb; session_id uuid; started timestamptz := clock_timestamp();
begin
  if owner is null then raise exception 'not authenticated'; end if;
  select home_timezone into zone from public.profiles where id = owner for update;
  if not found then raise exception 'profile not found'; end if;
  if jsonb_typeof(p_expected_items) is distinct from 'array' then raise exception 'workout template required'; end if;
  select jsonb_agg(value order by value->>'id') into expected from jsonb_array_elements(p_expected_items);
  select jsonb_agg(jsonb_build_object('id',i.id,'exercise_id',i.exercise_id) order by i.id::text) into actual
    from public.plan_items i join public.plan_blocks b on b.id=i.block_id
    join public.plan_days d on d.id=b.plan_day_id join public.plans p on p.id=d.plan_id
    where d.id=p_day_id and p.user_id=owner and p.is_active;
  if actual is null or actual is distinct from expected then
    raise exception 'This plan changed. Reopen the session before starting.';
  end if;
  if p_context is not null and (jsonb_typeof(p_context) is distinct from 'object'
      or p_context->>'units' is null or not p_context ? 'bodyweightKg') then
    raise exception 'original workout context required';
  end if;
  insert into public.sessions(user_id,plan_day_id,started_at,local_day,tz,
    calculation_units,bodyweight_kg,calculation_context_captured)
  values(owner,p_day_id,started,(started at time zone zone)::date,zone,
    p_context->>'units',(p_context->>'bodyweightKg')::numeric,p_context is not null)
  returning id into session_id;
  return session_id;
end;
$$;
revoke all on function public.start_workout(uuid,jsonb,jsonb) from public, anon;
grant execute on function public.start_workout(uuid,jsonb,jsonb) to authenticated;
