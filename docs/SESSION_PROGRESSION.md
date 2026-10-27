# Session progression

Migration `20261006071539_session_progress_rpc.sql` (previously recorded as `0005`) shipped with the matching client. It is already in the reconciled production history. Do not apply it again. A change to this RPC still needs a backup, an authenticated check, and a client that understands the receipt.

A completed workout has one private receipt. The RPC verifies ownership, locks the account, compares the exercise baselines, updates progression and saves the receipt in one transaction. The summary reads an existing receipt before calculating anything. A concurrent baseline change causes a bounded reload/retry, rather than overwriting newer state. The summary loads its original plan day, even if the active plan changed.

Older workouts do not replace progression from newer processed or historical workouts. Existing completed workouts receive historical markers; their summaries are display-only because the previous client may already have applied their progression. Legacy queued progress patches are copied to an account-scoped archive before removal from the replay queue. They are never replayed over new receipts.

Direct client writes to exercise_progress are revoked. An old native client is incompatible with this migration: its queued progress write would be denied. Install the matching build before applying this to production. Account deletion must also remove receipts and the local legacy archive.

## Verification

The repeatable local database check uses isolated PostgreSQL through PGlite. It does not access production:

```
npm install --prefix /tmp/pt-postgres-tests --ignore-scripts --no-audit --no-fund @electric-sql/pglite@0.5.0
PGLITE_ROOT=/tmp/pt-postgres-tests node scripts/test-session-progression.cjs
```

It checks repeated application, stale baseline recovery, older and legacy workout ordering, transaction rollback, ownership isolation and direct-write restrictions. Overlapping calls on its single database connection are not a substitute for concurrent transactions on separate server connections.

Before closing issue #4, verify those separate-connection races in a staging database, replay after a lost response, all native completion/summary flows, reopening after restart, and an active-plan change. The separate set-log request ordering limitation in issue #5 remains unresolved. This migration does not make set corrections immune to out-of-order server commits.
