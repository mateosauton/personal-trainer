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
- [x] Open backend PR #28; deployment requires the matching client.

- [x] Add atomic logs/version snapshot and guarded five-argument progression RPC. Verify stale versions, added/omitted membership, malformed snapshots, owner checks, old RPC revocation, and idempotent receipts.

## Client boundary

- [x] Add `lib/session/set-journal.ts`: account-scoped atomic origin/revision/payload journal with pending state, exact acknowledgement guards, blocked records, preserved event times and explicit new-origin conflict choices.
- [x] Wire Expo Crypto and Web Locks through the native/browser transport. The journal core default lock covers one JS runtime.
- [x] Test journal enqueue/ack crash boundaries, sequence allocation across instances, correction reverts, stale acknowledgements/choices, malformed data preservation and safe-integer limits. Independent review found no remaining actionable journal findings.
- [x] Verify integrated outbox recovery, token binding, request expiry, shared-instance queue/archive mutations and a real two-tab Chrome journal/queue fixture. Independent review findings fixed and covered by regressions.
- [x] Update `lib/session/sync.ts` and `lib/db/queries.ts` to call versioned RPCs, carry original event times, recover interrupted journal enqueues, and preserve legacy conflicts.
- [x] Summary uses the atomic set snapshot and guarded progression RPC, reloads logs and progression together on `40001`, and preserves new local workout units/bodyweight. Legacy/no-local-context fallback is documented in #30.
- [ ] Bootstrap captured server versions for reopened sessions. Fresh sessions begin with expected version zero.
- [x] Add journal conflict comparison/recovery in `components/SyncRecovery.tsx`. Display saved/server reps and loads plus any unsent rest draft; require an explicit choice against the captured local snapshot and displayed server baseline. Keep finalized-workout values read-only.
- [x] Preserve both reviewed values and the unsent draft after active-workout cleanup; reconcile guarded rest drafts without stale warm-screen overwrites. Verify completion after reconciliation and retry after a transient draft storage failure.
- [x] Add explicit legacy queued-set recovery in Home. Require a confirmed UTC completion time for saved values, retain the original payload, and verify stale captures, account changes and interrupted publication.
- [x] Test journal conflict account switching, stale reads, newly corrected local/remote values, deadlines, finalized-workout rejection and paused-rest resume/completion. Client PR #29 remains draft for bootstrap and fresh native verification.

## Launch acceptance

- [ ] Validate the combined native branch and existing database verifiers.
- [ ] Back up production, obtain explicit approval for the reviewed migration and release pair, apply and verify metadata/permissions.
- [ ] Build and test the exact native revision: login, onboarding, offline workout completion, restart/rest recovery, corrected-set retries, summary, account switch, and conflicting/legacy recovery.
- [ ] Merge reviewed PRs with compatible update gating; deploy and verify the running native release.
