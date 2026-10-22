# Workout recovery implementation plan

**Goal:** Preserve one workout identity from Begin through confirmed progression, including restart, offline logging and lost responses.

**Architecture:** Save a client-assigned session ID and its immutable start context before any network write. Replay session creation before sets, then completion and progression finalization. Keep the existing set journal, conflict review and versioned receipt checks. Cache the last usable plan and progression per account for offline starts.

**Scope:** Workout lifecycle only. Dashboard aggregates, general cache redesign, journal compaction and production deployment are separate work. Existing clients and saved workouts remain readable.

## Tasks

- [x] Verify a clean default-branch baseline in the managed worktree.
- [x] Add failing SQL and client tests for idempotent session start, ownership, immutable retry context and lost responses; add an additive RPC migration and typed wrapper.
- [x] Add failing tests for account-scoped offline plan snapshots, then populate and restore the cache in dashboard/overview.
- [x] Extract summary calculation and receipt application into a screen-independent finalization service. Test receipt replay, stale-version retries, timed work and cancellation.
- [x] Add lifecycle integration tests before changing sync. Persist local start intent before enqueue; reconstruct creation and finalization after restart; keep parent creation ahead of set writes; bind every request to the captured account.
- [x] Add bounded retry scheduling with fake-timer tests. Stop on account/background changes and retain manual conflict review.
- [x] Make the summary read confirmed receipts or display saved local sets while synchronization is pending. Validate recovery without keeping the summary mounted.
- [x] Run types, affected unit/component checks, database checks, a fixture web export and independent review. CI supplies real PostgreSQL for separate-connection checks.

Publication follows passing checks: review the exact diff, commit, push and open a concise PR into master, then attach it to this chat.

## Acceptance checks

1. An offline Begin persists a recoverable workout with one UUID and no server prerequisite.
2. Restart reconstructs missing queue entries from saved intent, including a completed workout whose summary was never opened.
3. Retrying an ambiguous start returns the same server session and rejects changed or foreign context.
4. Finalization waits for every pending set and blocks on unresolved conflicts; replay returns the existing receipt without applying progression twice.
5. Signed-out or switched-account callbacks cannot send new writes, clear another workout or display another account's cache.
6. Temporary network failures retry while the app is active; background/sign-out cancels scheduling.
7. The matching local workout is cleared only after a durable server receipt, with a local receipt retained for immediate offline display.

## Deployment

The additive migration must precede the new client release. This PR does not apply production SQL or publish an app update. Local PGlite checks do not replace hosted Auth or native-device verification.

## Local verification

`npm run check:web` passed TypeScript, 663 Jest tests and nine static-server checks. `npm run test:recovery-db`, `npm run docs:verify`, `git diff --check` and a web export configured with fixture Supabase values passed. Independent review findings about stalled requests, stale cached progression and overlapping refreshes have regression coverage. Separate-connection races are required in CI; installed-native and hosted-service verification remain release checks.
