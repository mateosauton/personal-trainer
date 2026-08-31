# Supabase operations

Apply migrations in lexical order with the Supabase CLI or SQL Editor. Before
`0003_correctness_foundation.sql`, capture a database backup and run:

```sql
select user_id, count(*)
from public.plans
where is_active
group by user_id
having count(*) > 1;
```

Resolve every returned row before creating the unique active-plan index.

`0003` contains the C2 historical-session backfill. It marks only sessions
with five or more logged sets complete, which changes historical streaks and
rotation. Record the backup identifier and row count before applying it.

After applying `0003` and `0004`, verify as an authenticated test user:

```sql
select public.save_plan('{"name":"Verification","split":"Full","weeks":4,"days":[{"name":"Day 1","focus":"Full","blocks":[]}]}'::jsonb);
```

The call must either produce a complete active plan or roll back entirely.
RLS verification uses two distinct authenticated users: each must see only
their own profile, plans, sessions, set logs, and progress rows.

Offline logging guarantees that writes made during an already-started session
survive and replay. Starting a brand-new session offline remains out of scope:
it needs a cached active plan plus a queued parent-session insert, which is a
separate read-cache feature.
