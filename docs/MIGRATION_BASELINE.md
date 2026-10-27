# Migration baseline and upgrade checks

Issue [#39](https://github.com/mateosauton/personal-trainer/issues/39) is
reconciled. Fresh local setup and production history share
`supabase/migration-baseline.json`. Every checked-in migration file's version
prefix equals its `productionVersion`, and those versions are the rows in
`supabase/production-history.json`.

Production project `asbudyijvunpnhrhsubm` (`office-gym-trainer`) recorded the
same SQL under a different history than the old `0001` / `0002` / `0004`
filenames. Statement bytes were read from `supabase_migrations.schema_migrations`
on 2026-10-27T07:12:00Z. Each checked-in file matches those bytes. The squashed
`0001_init.sql` and commented `0002_profile_identity.sql` were replaced by the
statements production actually stored: `init`, `slim_exercise_catalog`,
`catalog_is_client_side`, `lock_down_handle_new_user`, and `profile_identity`.
`save_plan_rpc` matched the old `0004` file exactly and kept those bytes.

Four short versions sorted before the schema they change, so a fresh database
could not apply them in lexical order:

| Previous version | Reconciled version | Migration |
| --- | --- | --- |
| `0003` | `20260831213153` | `correctness_foundation` |
| `0005` | `20261006071539` | `session_progress_rpc` |
| `0006` | `20261006084911` | `workout_reference_ownership` |
| `0007` | `20261006110122` | `ordered_set_writes` |

That version-only update was applied where the name and statement checksum
still matched, and `list_migrations` then matched
`supabase/production-history.json`. Statements were not rewritten.
Initialization SQL was not replayed. No application table was modified.
The four keys were then restored to `previousVersion` so the current `master`
filenames still match production until this branch is merged. Re-apply this
update as part of the merge, before any `db push`:

```sql
update supabase_migrations.schema_migrations
set version = case version
  when '0003' then '20260831213153'
  when '0005' then '20261006071539'
  when '0006' then '20261006084911'
  when '0007' then '20261006110122'
end
where (version = '0003' and name = 'correctness_foundation')
   or (version = '0005' and name = 'session_progress_rpc')
   or (version = '0006' and name = 'workout_reference_ownership')
   or (version = '0007' and name = 'ordered_set_writes');
```

```sh
npm run migrations:check
npm run test:migrations
npm run test:db
```

`migrations:check` verifies the pinned bytes and prints the upgrade plan for
the checked-in history. The plan lists only migrations whose versions are not
in that history. With the reconciled history the pending list is empty. The
database suite applies every migration on a fresh PGlite database, then
repeats that full production baseline, inserts account, plan, timed-set and
summary-receipt fixtures, and applies only newer files. Existing fixture
values must survive. Both schemas must agree, and both run the SQL
regressions. `npm run check:web` runs these in CI.

PGlite supplies test Auth/Storage tables and roles. It does not exercise
hosted Auth, Storage, managed roles, or a restored production backup.

## Adding a migration

Add a new file that sorts after `20261023011509_recovery_start_context.sql`.
Do not edit a pinned file or reuse a version. `npm run migrations:check` fails
until `supabase/production-history.json` contains the version that production
has actually recorded. Do not use `--include-all` to force an older file
through, and do not replay initialization to silence a diff.

Before `supabase db push`, run:

```sh
node scripts/migration-baseline.cjs --history supabase/production-history.json
supabase migration list --linked
supabase db push --linked --dry-run
```

The dry run must list only the intended new files. Push only after that review.
Supabase documents [migration history and dry runs](https://supabase.com/docs/reference/cli/supabase-db-push).
