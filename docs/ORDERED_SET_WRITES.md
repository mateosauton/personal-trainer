# Ordered set writes

Migration `0007_ordered_set_writes.sql` is a backend release boundary. Do not apply it alone: it revokes direct set mutations and the old four-argument progression RPC. Deploy only after the matching app uses all of this protocol, incompatible clients are retired, and production changes have explicit approval.

## Client protocol

Persist account-scoped origin UUID, per-set revision, exact payload, captured server version, and original event time before enqueueing. Replays retain those values. `log_set_versioned` returns `applied`, `duplicate`, or `superseded`. A `PT409` conflict requires comparing saved and server values; retry must not silently replace the baseline. `PT410` means the summary already finalized the workout. Unversioned entries use comparison-only `check_legacy_set` and explicit recovery for differing or absent server values.

Use `get_session_set_snapshot(session_id)` for summary input. It returns `{logs, versions}` from one snapshot; version entries contain `logId` and `serverVersion`. Pass the complete `versions` array as `p_set_versions` to the five-argument `apply_session_progress`. A `40001` response requires fetching both a new set snapshot and progression baseline before recalculating. An existing receipt returns its original result idempotently.

Private version metadata starts at one for existing logs without changing historical values or event times. All mutations and receipt creation share account/session locks. Authenticated clients cannot access private metadata tables directly.

## Verification

`PGLITE_ROOT=/path/to/test-runtime node scripts/test-set-ordering.cjs` checks fixtures, historical preservation, permissions, revisions, legacy comparison, snapshot validation and receipt behavior. The runtime must contain `@electric-sql/pglite`.

For actual concurrency, also install `pg` in the test runtime and set `PT_ORDERING_DB_URL` to a disposable local PostgreSQL administrator URL. The script rejects non-loopback hosts, creates a uniquely named test database, and drops it afterward. Never supply production credentials. It verifies both old/new request orders and correction-first/receipt-first races with separate connections.

Verified on PostgreSQL 17.11 using the official `postgres:17` image, digest `sha256:ae69c452f483507a6b99fb654cf93aad7fe156ffd2c56247707eef4e36d3c12b`. PGlite has one connection and cannot establish concurrent transaction behavior.

The matching client, native restart/offline/conflict flows, and production deployment remain separate acceptance gates.
