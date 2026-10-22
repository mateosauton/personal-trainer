# Flow validation and security remediation — technical specification

Status: ready for implementation. This document supersedes the implementation guidance in
`docs/superpowers/specs/2026-10-09-flow-first-runtime-design.md`.
The approved sequence is full account/workout flow first, security and data integrity second.
No separate product spec is required for this work.

## Context

Research baseline: `34fcd92880e4d7d5b98e49d98c15df362cdb9c1d`, plus the existing dirty working tree.
Commit links below identify tracked baseline code; Observe instrumentation, SDK 57 dependencies,
EAS environments, and Supabase environment validation also have uncommitted changes.
Preserve those changes during implementation.

| Boundary | Current implementation and evidence |
| --- | --- |
| Runtime / configuration | `package.json` currently selects Expo SDK 57 and Node 22. `lib/db/supabase.ts` throws at module evaluation if either public Supabase variable is missing. `eas.json` selects development, preview, and production environments. |
| Navigation | [`app/_layout.tsx:29`](https://github.com/mateosauton/personal-trainer/blob/34fcd92880e4d7d5b98e49d98c15df362cdb9c1d/app/_layout.tsx#L29) owns protected route groups. [`lib/auth-gate.ts:12`](https://github.com/mateosauton/personal-trainer/blob/34fcd92880e4d7d5b98e49d98c15df362cdb9c1d/lib/auth-gate.ts#L12) currently returns `ready` for signed-out users, which also enables authenticated routes. |
| Authentication | [`lib/auth.tsx:29`](https://github.com/mateosauton/personal-trainer/blob/34fcd92880e4d7d5b98e49d98c15df362cdb9c1d/lib/auth.tsx#L29) loads the session/profile and subscribes to auth/deep-link events. Initial session/URL promises and profile-cache reads can reject without a settled UI state. `app/(auth)/sign-in.tsx` submits signup and shows an email-confirmation notice when no session is returned. |
| Onboarding | `app/onboarding.tsx:100` generates a plan, awaits `savePlan`, updates the profile's `onboarded_at`, and calls `refreshProfile`. Plan and profile writes are separate operations. |
| Persistence | [`lib/db/queries.ts:50`](https://github.com/mateosauton/personal-trainer/blob/34fcd92880e4d7d5b98e49d98c15df362cdb9c1d/lib/db/queries.ts#L50) calls `supabase.rpc('save_plan', { plan })`; [migration 0004](https://github.com/mateosauton/personal-trainer/blob/34fcd92880e4d7d5b98e49d98c15df362cdb9c1d/supabase/migrations/0004_save_plan_rpc.sql#L2) performs transactional plan replacement with ownership derived from `auth.uid()`. |
| Workout execution | `lib/session/queue.ts` flattens warm-ups, straight sets, supersets, and circuits. `app/session/[dayId]/run.tsx` queues set writes and completion, then opens the summary. Warm-up completion advances without logging a working set. |
| Queue / summary | `lib/session/outbox.ts` stores one global queue and holds a shared mutex throughout replay. Send failures are swallowed. `summary.tsx` reads remote logs and calculates progression; `queueProgress` identifies operations by user/exercise IDs, without session identity. |
| Mock backend | `tools/dev/mock-supabase.mjs:280` supports signup and inserts a blank profile. It has no `/rest/v1/rpc/save_plan` handler: unknown REST requests return HTTP 200 with `[]`. `/__state` returns only a plan count rather than the plan hierarchy/progression. |
| Browser harness | `tools/dev/drive.mjs:25` hardcodes a Linux Chromium executable; Playwright is absent from the manifest. It clears runtime overlays, uses fixed sleeps, and prints errors without failing. `fullSession` never presses Save & finish or checks stored data. |

The reported seven simulator errors have not been captured. Previous tool discovery found no
`adb` or `simctl`; that is historical evidence, not a current environment guarantee.
A successful cloud Android build proves compilation, not a working launch or signup flow.

## Proposed changes

### 1. Capture runtime evidence and establish a portable harness

Inventory current Node/npm, browser availability, native tools, running servers, and configured
environment variable names without printing secrets. Record the launch URL/build ID, platform,
exact error messages, stack traces, and reproduction steps in `output/playwright/`.
Recheck native tool availability before declaring native execution blocked.

Use Node 22 as declared by the project. Install Playwright as a development dependency and use
its managed Chromium launcher; remove the hardcoded executable and container-only flags.
Permit an explicit executable override only for environments that require it.
Add `test:flow` to invoke the existing driver with a new `signupWorkout` scenario.
Start mock and Metro with explicit loopback mock URL/key and dotenv loading disabled.
Bind mock test hooks to loopback; never package or deploy them with the app.

Use readiness polling for server startup and locator/URL/state assertions for UI transitions.
Collect console errors, uncaught exceptions, failed same-origin requests, and HTTP failures.
A runtime overlay is evidence of failure: capture it and exit nonzero instead of dismissing it.
Always close browser/server processes owned by the run in cleanup; preserve unrelated processes.

### 2. Bring mock persistence into alignment with application contracts

Add an explicit POST handler for `/rest/v1/rpc/save_plan` before generic REST table dispatch.
Resolve the user from the request session, reject unauthenticated calls, validate the supported
generated-plan structure, and return the scalar UUID expected by `savePlan`.

Stage the entire replacement hierarchy in temporary arrays before mutating mock state.
Assign UUIDs and ordinal indices to plan/day/block/item rows using migration 0004's mapping.
Only after validation succeeds, retire that user's prior active plan and commit the new tree.
Malformed input must preserve the old active plan and return a structured non-2xx error.
Unknown RPC/table routes must return a structured error rather than successful empty arrays.

Extend `/__state` with additive fields:
`plan_rows`, `plan_days`, `plan_blocks`, `plan_items`, and `exercise_progress`.
Keep the existing numeric `plans` field for compatibility. Return profiles/sessions/set logs
without authentication secrets or passwords. Honor the filters, nested joins, ordering, limits,
and conflict keys actually used by queries; in particular session/day joins must include
`day_index` and `plan_id` when requested for rotation.

The mock is a UI fixture. Its tests prove API shape and app orchestration; SQL transaction,
constraint, and authorization guarantees require real local Supabase tests in stage 2.

### 3. Implement the complete account-to-workout smoke scenario

Use a fresh browser context and reset mock state. Create a new synthetic account through the
Create account UI, then complete all onboarding steps with fixed input values.
The seeded fresh-account login remains a separate regression scenario.
Mock signup returns a session; test the no-session email-confirmation path separately.

After onboarding, assert the authenticated home route, nonempty generated plan, profile values,
and exactly one active plan for the newly created user. Retrieve the selected day hierarchy and
calculate expected working-set identities using the same queue contract as the app:
`(session_id, plan_item_id, set_index)`, excluding warm-up entries.

Start the session through the UI. Complete each work entry, fill reps/load where supported,
advance rest using the app's Skip rest control, and require summary navigation.
Bound the interaction count using the expected queue size; an unrecognized player state fails
with a screenshot and visible controls. Click Save & finish and require a return to Home.

Poll persistence with a finite timeout and assert: one completed session belonging to this
user/day; valid duration and local-day fields; the exact expected unique set identities;
entered reps/loads; progression rows for working exercises; and the next rotation day on Home.
Screenshots supplement these assertions rather than determine success.

### 4. Fix reproduced application failures at their owning boundaries

Fix the signed-out gate by adding `signedOut` to `ProfileGate`; retain `ready` exclusively for
onboarded authenticated users. Set each `Stack.Protected` guard from explicit gate states.
Update Observe readiness to exclude auth/profile loading while recognizing sign-in and retry
screens as interactive. Cover signed-out deep links and loading-to-ready transitions.

Give initial auth/session/link errors and workout-load failures explicit handled states and
retry actions. Keep profile absence distinct from read failure. Catch profile-cache failures
so a rejected cache read cannot leave the spinner indefinitely; ensure cancellation prevents
stale responses updating a different account. Capture the underlying error for diagnostics.

For each additional runtime failure, write a reproduction first, trace its owning module,
implement the smallest correction, and rerun the affected flow segment.
The summary must not claim a complete workout from partial remote logs: if replay/read fails,
show an explicit pending/retry state and defer progression until completeness is established.
The durable offline solution belongs to the next stage; this phase must expose failures.

### 5. Security and data-integrity stage after the flow passes

Implement R35–R40 in dependency order. Move replay I/O outside the queue mutation lock (R39);
persist operations under per-user keys with ownership checked before sending (R36);
classify terminal/retryable errors with bounded retries and persisted failed operations (R35);
include session identity in progression operations and make repeat completion/replay safe (R37);
capture event timestamps at enqueue time and preserve them through retries (R38).
Retain failed operation details for recovery, without logging credentials.

Introduce a versioned operation envelope containing `id`, `userId`, `sessionId`, `kind`,
`occurredAt`, `payload`, `attempts`, and sanitized failure metadata. Serialize storage
mutations; allow only one replay worker per account. Reconcile acknowledgements by operation
version so a corrected set enqueued during replay cannot be deleted by an old acknowledgement.
For legacy global entries with unknown ownership, quarantine and expose recovery status rather
than replaying under whichever account signs in next. Account switches must isolate all reads.

R46 extends this with a session read model combining persisted local sets/completion and remote
acknowledgements, keyed by session and set identity. Compute summary from that complete read
model, then progression exactly once per session. Client operation IDs alone do not make
accumulator updates replay-safe; database idempotency must be verified before claiming R37/R44.

For R41, remove real test-account credentials from distributable code. Keep synthetic mock
credentials confined to tooling/test fixtures and scan production exports for configured
credential sentinels. Preserve an explicit development testing route without embedding a
real account password in `EXPO_PUBLIC_*`.

Before R7/R42/R44/R47 or other schema changes, implement R25: reconcile migration history,
establish a local Supabase stack, obtain a restorable backup before production mutation,
and test ownership with two authenticated users plus an anonymous client.
Generate new migrations using the installed CLI, verify its help/current documentation,
and apply locally first. Avatar privacy work must migrate stored URL values and use signed
reads; making the bucket private alone breaks existing photos.
Production application is a separate rollout checkpoint requiring verified access and backup.

## Testing and validation

| Invariant | Proof required |
| --- | --- |
| Startup renders a usable screen or retry UI | Runtime error capture plus root/auth tests for rejected session, profile, cache, and deep-link reads. |
| Signed-out clients cannot mount authenticated screens | Gate matrix and protected deep-link UI regression. |
| Signup/profile/plan creation is persisted | HTTP contract tests for signup/RPC and browser assertions on newly created user/hierarchy. |
| Failed plan writes preserve the old plan | Mock staged-write regression and local SQL rollback/ownership tests. |
| Every completed work set is present exactly once | Expected queue identities compared to stored set logs, including a corrected-set replay. |
| Completion and progression survive retries | Duplicate replay, terminal head failure, slow network, restart, and account-switch tests. |
| Summary matches all completed sets | Immediate-summary test with delayed writes; no progression computed from incomplete logs. |
| Confirmation-required signup is usable | No-session signup component test; live confirmation/deep-link test with a controlled test mailbox. |
| Security boundaries hold | Two-user/anonymous RLS and Storage tests on local Supabase, plus production bundle credential scan. |

Run focused regressions per fix, then `npm test -- --runInBand`, `npm run lint`, and `npm run test:flow`.
Run the smoke scenario twice from reset state and once with delayed mock responses.
Save a machine-readable result with stage, expected/actual row counts, sanitized failures,
and artifact paths. A nonzero process exit is required for any failed assertion.

Repeat the flow against a static web export configured to use the mock, to cover bundled startup.
Then validate native launch and the complete journey on a current development/preview build
when a native target is available. If unavailable, report native validation as outstanding.
A real Supabase signup uses a controlled test mailbox and actual migrations; mock results
cannot prove email delivery, native modules, RLS, or production data persistence.

## Execution order and rollout

Implement runtime evidence/harness and mock contracts first; run signupWorkout; repair its
failures and pass persistence assertions; then execute the security stage and repeat the flow.
Use small commits for each independently verified correction. Existing package/config/docs
changes must not be swept into unrelated commits.

A native dependency/config change requires a new EAS build. Reuse a development client only
when its native fingerprint matches. Verify Observe using real native sessions separately
from browser success. Reassess SDK diagnostics against the installed versions at implementation
time; the September diagnostics and build artifacts are historical.

## Remaining backlog

This spec makes the requested flow executable and defines the first security stage.
It does not mark the remaining improvement list complete. R6 password reset, R12 timer,
R28 resume, R29 swaps, R30 editable plans, R43 training-profile edits, and other open entries
retain their individual acceptance criteria in `docs/IMPROVEMENTS.md`.
After this stage, reconcile that list against verified code and schedule remaining modules
with their own technical designs. Record completion only with execution evidence.
