# Office Gym Correctness Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement and deploy the C1–C8 correctness and data-integrity improvements from `docs/IMPROVEMENTS.md`.

**Architecture:** Keep all client data access in `lib/db/queries.ts`. Move atomic plan construction and schema invariants into versioned PostgreSQL migrations; model profile loading, calendar identity, completion, rotation, and retryable writes as explicit application states. The outbox owns persistence and replay, while the player owns user interaction.

**Tech Stack:** Expo Router, React Native, TypeScript, Supabase/Postgres, AsyncStorage, Jest.

**Spec:** `docs/IMPROVEMENTS.md`

## Global Constraints

- Preserve the existing uncommitted product work; never reset or overwrite it.
- Add a test before each behavioral production-code change and observe its failure.
- Every outbox operation must be idempotent.
- Database work must be versioned migrations; snapshot/inspect before applying an irreversible backfill.
- A session belongs to the device-local day when it starts; stored `local_day` is authoritative thereafter.

---

### Task 1: Migration safeguards and database invariants

**Files:**
- Create: `supabase/migrations/0003_correctness_foundation.sql`
- Create: `supabase/migrations/0004_save_plan_rpc.sql`
- Create: `supabase/README.md`
- Modify: `tools/dev/mock-supabase.mjs`
- Test: `__tests__/queries.test.ts`

- [ ] Add migration metadata, backup/restore instructions, and an RLS/migration verification command.
- [ ] Add and verify the one-active-plan unique partial index, `sessions.local_day`, and idempotent session-completion support.
- [ ] Add the `save_plan(jsonb)` security-invoker RPC with user-bound input validation and atomic day/block/item inserts.
- [ ] Extend the mock backend so tests exercise the RPC contract and uniqueness invariant.

### Task 2: Atomic plans and resilient auth

**Files:**
- Modify: `lib/db/queries.ts`
- Modify: `lib/auth.tsx`
- Modify: `app/_layout.tsx`
- Test: `__tests__/auth.test.tsx`, `__tests__/queries.test.ts`

- [ ] Test that a failed profile read is an error state, never an onboarding state, and that retry resolves it.
- [ ] Test that `savePlan` makes one RPC call and returns its plan ID.
- [ ] Replace the multi-request save implementation with the RPC; cache a successfully loaded profile and expose loading/ready/error states.
- [ ] Render a retry/sign-out gate for profile-load failures.

### Task 3: Completion, local calendar days, and per-plan rotation

**Files:**
- Modify: `lib/types.ts`, `lib/stats.ts`, `lib/useDashboard.ts`, `lib/db/queries.ts`
- Modify: `app/session/[dayId]/index.tsx`, `app/session/[dayId]/run.tsx`, `app/session/[dayId]/summary.tsx`
- Modify: `tools/dev/mock-supabase.mjs`
- Test: `__tests__/stats.test.ts`, `__tests__/dashboard.test.tsx`, `__tests__/queries.test.ts`

- [ ] Test stored local days across midnight/timezone boundaries, a 500-session history, and a new plan with existing history.
- [ ] Test session completion/progression is idempotent and occurs before summary navigation.
- [ ] Store `local_day` at start, mark completion at queue exhaustion, apply progress on summary load, and make Done navigation-only.
- [ ] Fetch full calendar-day history independently of the bounded recent list and derive next day from the latest completed session on the active plan.

### Task 4: Offline-tolerant logging

**Files:**
- Create: `lib/session/outbox.ts`
- Modify: `lib/db/queries.ts`, `app/_layout.tsx`, `app/session/[dayId]/run.tsx`, `app/session/[dayId]/summary.tsx`
- Modify: `package.json`, `package-lock.json`
- Test: `__tests__/outbox.test.ts`, `__tests__/run.test.tsx`

- [ ] Add failing tests for durable enqueue, replay, no duplicate set writes, and retry after failure.
- [ ] Implement an AsyncStorage-backed outbox with serial flush, pending count, and idempotent operation keys.
- [ ] Flush on foreground/reconnect, route set/progress/complete writes through it, and show the pending-sync state in the session flow.
- [ ] Use client-generated session UUIDs so set logging can queue consistently.

### Task 5: Production application and completion audit

**Files:**
- Modify: `docs/IMPROVEMENTS.md` only to record completed C1–C8 work and operational commands.

- [ ] Run the focused suites after each task, then the full typecheck and Jest suite.
- [ ] Use the configured live Supabase access to snapshot/inspect, apply migrations in order, run the backfill after its snapshot, and verify the resulting invariants.
- [ ] Record migration identifiers, verification queries, and any production result without recording secrets.
- [ ] Re-audit every C1–C8 done condition against current source, test output, and live database evidence.
