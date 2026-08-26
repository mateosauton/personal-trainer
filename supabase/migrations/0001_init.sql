-- Office Gym Trainer — initial schema.
-- Every user-scoped table is RLS'd to auth.uid(). The exercise catalog is the
-- one public-read table: it is shared reference data, written only by the seed
-- script running under the service role.

create type goal_kind        as enum ('strength', 'hypertrophy', 'fat_loss', 'general');
create type experience_kind  as enum ('beginner', 'intermediate', 'advanced');
create type unit_kind        as enum ('kg', 'lb');
create type block_kind       as enum ('warmup', 'straight', 'superset', 'circuit');

-- ---------------------------------------------------------------- profile --

create table profiles (
  id              uuid primary key references auth.users on delete cascade,
  display_name    text,
  units           unit_kind not null default 'kg',
  bodyweight_kg   numeric,
  goal            goal_kind,
  experience      experience_kind,
  days_per_week   int check (days_per_week between 2 and 6),
  session_minutes int check (session_minutes in (30, 45, 60)),
  equipment       text[] not null default '{}',
  limitations     text[] not null default '{}',
  onboarded_at    timestamptz,
  created_at      timestamptz not null default now()
);

-- ------------------------------------------------------------------- plan --

create table plans (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users on delete cascade,
  name       text not null,
  split      text not null,
  weeks      int not null default 4,
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);
create index plans_user_idx on plans (user_id) where is_active;

create table plan_days (
  id        uuid primary key default gen_random_uuid(),
  plan_id   uuid not null references plans on delete cascade,
  day_index int not null,
  name      text not null,
  focus     text not null,
  unique (plan_id, day_index)
);

create table plan_blocks (
  id           uuid primary key default gen_random_uuid(),
  plan_day_id  uuid not null references plan_days on delete cascade,
  block_index  int not null,
  kind         block_kind not null,
  title        text not null,
  rounds       int not null default 1,
  rest_seconds int not null default 90,
  unique (plan_day_id, block_index)
);

create table plan_items (
  id          uuid primary key default gen_random_uuid(),
  block_id    uuid not null references plan_blocks on delete cascade,
  item_index  int not null,
  -- Key into lib/data/exercises.json (the app-bundled catalog); deliberately
  -- not a foreign key, since Postgres holds no copy of the catalog.
  exercise_id text not null,
  sets        int not null default 3,
  reps_low    int not null default 8,
  reps_high   int not null default 12,
  -- Timed work (warm-ups, conditioning) sets this instead of reps.
  seconds     int,
  tempo       text,
  notes       text,
  unique (block_id, item_index)
);

-- --------------------------------------------------------------- sessions --

create table sessions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users on delete cascade,
  plan_day_id  uuid not null references plan_days on delete cascade,
  started_at   timestamptz not null default now(),
  completed_at timestamptz,
  duration_s   int,
  rpe          int check (rpe between 1 and 10),
  notes        text
);
create index sessions_user_idx on sessions (user_id, started_at desc);

create table set_logs (
  id            uuid primary key default gen_random_uuid(),
  session_id    uuid not null references sessions on delete cascade,
  plan_item_id  uuid references plan_items on delete set null,
  exercise_id   text not null,
  set_index     int not null,
  reps          int,
  -- External load. For bodyweight movements this stays null and the load lives
  -- in added_load_kg; effective load = profile.bodyweight_kg + added_load_kg.
  weight_kg     numeric,
  is_bodyweight boolean not null default false,
  added_load_kg numeric not null default 0,
  rpe           int check (rpe between 1 and 10),
  completed_at  timestamptz not null default now(),
  unique (session_id, plan_item_id, set_index)
);
create index set_logs_session_idx  on set_logs (session_id);
create index set_logs_exercise_idx on set_logs (exercise_id);

create table exercise_progress (
  user_id        uuid not null references auth.users on delete cascade,
  exercise_id    text not null,
  last_weight_kg numeric,
  last_reps      int,
  best_weight_kg numeric,
  best_e1rm      numeric,
  -- Consecutive sessions that fell short of the rep target; 2 triggers a
  -- deload in the progression rule.
  miss_streak    int not null default 0,
  updated_at     timestamptz not null default now(),
  primary key (user_id, exercise_id)
);

-- -------------------------------------------------------------------- RLS --

alter table profiles         enable row level security;
alter table plans            enable row level security;
alter table plan_days        enable row level security;
alter table plan_blocks      enable row level security;
alter table plan_items       enable row level security;
alter table sessions         enable row level security;
alter table set_logs         enable row level security;
alter table exercise_progress enable row level security;

create policy profiles_rw on profiles
  for all to authenticated using (auth.uid() = id) with check (auth.uid() = id);

create policy plans_rw on plans
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy plan_days_rw on plan_days
  for all to authenticated
  using (exists (select 1 from plans p where p.id = plan_id and p.user_id = auth.uid()))
  with check (exists (select 1 from plans p where p.id = plan_id and p.user_id = auth.uid()));

create policy plan_blocks_rw on plan_blocks
  for all to authenticated
  using (exists (
    select 1 from plan_days d join plans p on p.id = d.plan_id
    where d.id = plan_day_id and p.user_id = auth.uid()))
  with check (exists (
    select 1 from plan_days d join plans p on p.id = d.plan_id
    where d.id = plan_day_id and p.user_id = auth.uid()));

create policy plan_items_rw on plan_items
  for all to authenticated
  using (exists (
    select 1 from plan_blocks b join plan_days d on d.id = b.plan_day_id
    join plans p on p.id = d.plan_id
    where b.id = block_id and p.user_id = auth.uid()))
  with check (exists (
    select 1 from plan_blocks b join plan_days d on d.id = b.plan_day_id
    join plans p on p.id = d.plan_id
    where b.id = block_id and p.user_id = auth.uid()));

create policy sessions_rw on sessions
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy set_logs_rw on set_logs
  for all to authenticated
  using (exists (select 1 from sessions s where s.id = session_id and s.user_id = auth.uid()))
  with check (exists (select 1 from sessions s where s.id = session_id and s.user_id = auth.uid()));

create policy exercise_progress_rw on exercise_progress
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- A profile row must exist before onboarding can write to it.
create function public.handle_new_user() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id) values (new.id) on conflict do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Living in `public` also exposes this at /rest/v1/rpc/handle_new_user, callable
-- by anon. It runs as SECURITY DEFINER, so only the trigger should invoke it.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
