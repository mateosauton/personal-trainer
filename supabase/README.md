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

Account-scoped queues use `office-gym.session-outbox.v2.<user-id>`. Signing out
pauses replay but preserves pending work for the same account to resume later.
The old global `office-gym.session-outbox.v1` key is quarantined in place: its
payloads do not carry reliable account ownership, so the app never replays or
assigns them automatically. Preserve it for owner-verified recovery; do not
clear device storage to repair a queue.

Timed set persistence is added by `20261007173759_timed_set_writes.sql` after
`0007`. It stores `set_logs.seconds` with null reps, validates timed plan
membership, and keeps missing/null seconds out of old receipt payloads so
queued rep writes remain replayable. Existing history is not converted.
The client still needs duration editing, recovery and summary support before
this resolves #33 or a timed-set release can be verified.

Run the duration regression against a disposable local database after migrations:

```sh
psql 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' \
  -f supabase/tests/timed_set_writes.sql
```

The test rolls back its fixtures. It checks authenticated ordered writes,
validation, replay, correction, stale suppression, snapshots, legacy payloads,
and rejection of cross-account and direct writes.
