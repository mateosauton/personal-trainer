# Workout write ordering implementation plan

> Execute inline with the existing isolated worktree and independent review at each boundary.

**Goal:** Prevent late requests from overwriting newer corrected sets, without silently resolving cross-device or legacy conflicts.

**Architecture:** An account-locked RPC owns all set mutations. Private server version/origin metadata protects ordering; a durable client journal supplies stable revisions and payloads. Conflict recovery requires the user's choice against a captured baseline.

**Tech Stack:** PostgreSQL/Supabase, TypeScript, AsyncStorage, Expo Crypto, Jest, disposable local PostgreSQL.

## Backend boundary

- [x] Reproduce existing failure: commit reps 12 then late reps 8 through the existing upsert. Expected 12, observed 8.
- [x] Add `scripts/test-set-ordering.cjs` with a real database option and disposable fixtures. Its old-write bypass check must fail before the migration.
- [x] Add `supabase/migrations/0007_ordered_set_writes.sql` with private version/origin tables and signatures:
  `log_set_versioned(uuid,jsonb,uuid,bigint,bigint,timestamptz) returns jsonb`,
  `get_set_write_state(uuid,uuid,int) returns jsonb`,
  `check_legacy_set(uuid,jsonb) returns jsonb`.
- [x] Verify applied/duplicate/superseded/conflict states, exact payload/event equality, owner/reference checks, safe integer bounds, direct mutation revocation, and unchanged historical data.
- [x] Verify two-connection request and receipt races under shared transaction locks; independent backend review found no remaining actionable findings.
- [ ] Open backend PR; deployment requires the matching client.

- [x] Add atomic logs/version snapshot and guarded five-argument progression RPC. Verify stale versions, added/omitted membership, malformed snapshots, owner checks, old RPC revocation, and idempotent receipts.

## Client boundary

- [ ] Add `lib/session/set-journal.ts`: account-scoped atomic origin/revision/payload journal with pending state and conditional acknowledgement. Allocate with Expo Crypto; serialize native storage and shared web storage.
- [ ] Test crashes between journal and outbox persistence, sequence allocation across instances, identical retries, corrections reverted to prior values, and stale acknowledgements.
- [ ] Update `lib/session/sync.ts` and `lib/db/queries.ts` to call versioned RPCs, carry original event times, recover interrupted journal enqueues, and preserve legacy conflicts.
- [ ] Summary must use the atomic set snapshot and guarded progression RPC, reload logs and progression together on `40001`, and preserve saved workout units/bodyweight.
- [ ] Bootstrap captured server versions for reopened sessions. Fresh sessions begin with expected version zero.
- [ ] Add conflict comparison/recovery in `components/SyncRecovery.tsx`. Display saved/server reps and loads; require an explicit choice, verify the local revision has not changed, and use the displayed server baseline.
- [ ] Test account switching, stale reads, a newly corrected local value, a changed remote baseline, and finalized-workout rejection. Review and open matching client PR.

## Launch acceptance

- [ ] Validate the combined native branch and existing database verifiers.
- [ ] Back up production, obtain explicit approval for the reviewed migration and release pair, apply and verify metadata/permissions.
- [ ] Build and test the exact native revision: login, onboarding, offline workout completion, restart/rest recovery, corrected-set retries, summary, account switch, and conflicting/legacy recovery.
- [ ] Merge reviewed PRs with compatible update gating; deploy and verify the running native release.
