# Migration baseline and upgrade checks

Issue [#39](https://github.com/mateosauton/personal-trainer/issues/39) remains
open until production history and a linked dry run are reconciled. Do not run
an ordinary `supabase db push` against this project yet. Production originally
recorded the initialization, profile and save-plan migrations with timestamp
versions while this repository kept `0001`, `0002` and `0004`.

`supabase/migration-baseline.json` pins the exact bytes of the nine source
migrations reported deployed in the
[October 8 release record](https://github.com/mateosauton/personal-trainer/issues/8#issuecomment-6054840371).
Those files stay unchanged. New migrations must sort after
`20261007181857_account_data_export.sql`. The manifest records the production
project reference and source commit separately from migration versions.

The manifest's `productionVersion` fields and `productionHistoryVerifiedAt`
are deliberately null. On October 22, the connected Supabase account did not
list project `asbudyijvunpnhrhsubm`; querying its migrations returned permission
denied. No remote history, schema, or application data was modified. The source
baseline is based on the release record, not a fresh production schema dump.

## Checks available now

```sh
npm run migrations:check
npm run test:migrations
npm run test:db
```

The first command checks deployed-source hashes. The planner tests check
missing mappings, missing and unknown remote history, duplicate versions and
backdated additions. The database suite runs every migration on a fresh
PGlite database, then independently builds the nine-file baseline, inserts
account, plan, timed-set and summary-receipt fixtures, and applies only newer
migrations. Existing fixture values must survive. Both resulting schemas
must agree on columns, functions, grants, constraints, policies, indexes and RLS flags, and both
run the SQL regressions. `npm run check:web` runs these in CI.

These checks exercise the repository's representation of the deployed schema.
PGlite supplies test Auth/Storage tables and roles; it does not exercise the
hosted Auth service, Storage service, managed roles, or a restored production
backup. A production-schema restore rehearsal remains required.

## Complete the production reconciliation

1. From the existing authorized project connection, export these read-only
   rows as a JSON array. Record the project, capture time and backup identifier.

   ```sql
   select version, name
   from supabase_migrations.schema_migrations
   order by version;
   ```

2. Inspect the deployed definitions and migration statements to establish
   equivalence with each pinned source file. A matching name alone is not
   proof. Fill each `productionVersion` with its verified recorded version
   and set `productionHistoryVerifiedAt`. Preserve deployed SQL bytes.
3. Run the read-only planner with that saved export:

   ```sh
   node scripts/migration-baseline.cjs --history /path/to/history.json
   ```

   It refuses unknown history and missing baseline rows. It skips every
   baseline migration and lists only genuinely pending source files. With
   null mappings it fails before returning an upgrade plan. The planner does
   not repair Supabase history or make `db push` safe on its own.
4. Rehearse the mappings and new migrations on a disposable restore of the
   current production schema and representative data. Compare row counts,
   ownership, grants, RPC permissions and policy behavior before and after.
5. Review a separate reconciliation change that makes Supabase's local and
   remote version lists agree. If filenames change, update all local test
   references without changing SQL bytes. History repair is a separate
   database operation and requires an explicit reviewed plan. Never replay
   initialization or mark an unverified migration applied to silence a diff.
6. Only after that reconciliation, run a linked `supabase db push --dry-run`
   using the existing authorized connection and record its exact output.
   It must contain only the intended newer migrations. Do not use
   `--include-all` to force unmatched initialization through.

Supabase documents [migration history and dry runs](https://supabase.com/docs/reference/cli/supabase-db-push).
No linked dry run or hosted restore is claimed by the local test suite.
