# Account isolation

Migration `0006_workout_reference_ownership.sql` tightens two existing write policies. A session must use a plan day owned by its user. A set with a plan-item reference must match that item's exercise, session day and owner. Owner reads/deletes stay unchanged; null references remain valid for historical logs whose items were deleted.

The migration does not modify existing records and does not depend on the calendar or progression migrations. The existing production policies matched the original permissive rules on October 6; a read-only preflight found zero foreign-plan sessions and zero inconsistent set references.

## Local verification

```
npm install --prefix /tmp/pt-postgres-tests --ignore-scripts --no-audit --no-fund @electric-sql/pglite@0.5.0
PGLITE_ROOT=/tmp/pt-postgres-tests node scripts/test-account-isolation.cjs
PGLITE_ROOT=/tmp/pt-postgres-tests node scripts/test-session-progression.cjs
```

The account check loads all migrations into isolated PostgreSQL, with two disposable users. It verifies account-scoped reads for nine public tables, foreign-parent insert/update rejection, exercise/day consistency, legitimate set upserts/corrections, anonymous denial and owner-scoped avatar writes. Running it with `SKIP_WORKOUT_OWNERSHIP_FIX=1` reproduces the foreign-plan session insertion allowed by the original rules.

Storage uses a minimal test schema for these policy predicates; this does not verify actual file uploads, public URL delivery or storage-service behavior. Existing avatar reads remain public. Account export/deletion, private media requirements, deployed API checks and installed native account switching remain issue #7 acceptance requirements. Do not close that issue based only on this policy fix.
