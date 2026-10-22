# Technical decisions and change management

Reviewed against the local checkout on 2026-10-22. This guide explains the choices
the code makes, their effect on each subsystem, and a proposed process for
changing them. It does not establish which migrations or builds run in production.

The product test is concrete: can someone get a suitable plan for the confirmed
gym, understand each exercise, log sets with little phone work, and resume
without losing progress? The local candidate persists editable training inputs
and offers constrained pre-workout swaps. In the target design, equipment and
explicit exercise exclusions constrain selection, then preferences rank eligible
choices. Preferred/excluded exercise-ID persistence and ranking remain proposed
in D06. Collecting height or weight does not itself make a plan personalized.

Read [architecture](ARCHITECTURE.md) for implementation details, [Git
workflow](GIT_WORKFLOW.md) for branches/environments, and [releases](RELEASES.md)
for delivery and recovery.

## Contents

- [1. A decision is different from a task](#1-a-decision-is-different-from-a-task)
- [2. Separate facts, rationale, implementation and delivery](#2-separate-facts-rationale-implementation-and-delivery)
- [3. Subsystem impact matrix](#3-subsystem-impact-matrix)
- [4. Current decisions and their consequences](#4-current-decisions-and-their-consequences)
- [5. Handling bugs, features, chores and incidents](#5-handling-bugs-features-chores-and-incidents)
- [6. Proposed implementation plan](#6-proposed-implementation-plan)
- [7. Sources and adaptations](#7-sources-and-adaptations)

## 1. A decision is different from a task

A task describes work to finish. A technical decision records a choice between
plausible approaches and the costs left by that choice. An architecture decision
record, or ADR, preserves the reasoning. Nygard's original proposal covers
structure, quality, dependencies, interfaces and construction, retaining
superseded records instead of erasing them. This guide adopts that scope.
[Nygard, Documenting Architecture Decisions](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions)

| Work type | Example here | Normal record | When an ADR is needed |
| --- | --- | --- | --- |
| Bug | Saved equipment restrictions disappear on rebuild. | Reproduction, expected behavior, regression and PR. | The fix changes the inventory authority or persisted plan contract. |
| Feature | Replace a busy machine during a workout. | Scenario, acceptance criteria and issue. | Substitution eligibility, history linkage or session/plan ownership must change. |
| Chore | Upgrade a compatible patch dependency or repair instructions. | Reason and verification in PR. | A native dependency, SDK/runtime, storage format or deployment provider changes. |
| Refactor | Extract a workout transition from a screen. | Preserved behavior and focused checks. | Responsibility moves between UI, disk and server. |
| Security | Reject an unexpected auth callback. | Restricted evidence if sensitive, regression and release record. | Authentication or authorization boundaries change. |

Use an ADR when ownership, schema, RPC, local storage, plan eligibility, native
compatibility, environment isolation or recovery changes. Also use one when the
rejection of a reasonable alternative would be hard to explain from code.
Correcting copy or a calculation normally needs only its PR explanation.

This threshold borrows from Rust's community process, which separates
substantial design changes from ordinary fixes and documentation. This personal
repository does not need its committees or consensus stages. [Rust RFC
process](https://github.com/rust-lang/rfcs/blob/main/README.md)

## 2. Separate facts, rationale, implementation and delivery

Reasons already exist in dated plans and protocol documents. The missing piece
was a navigable register that distinguishes observed code from historical intent.
Use these fields:

- **Decision:** proposed, accepted, rejected, or superseded. The owner accepts a
  proposal in its PR and can self-review and merge.
- **Implementation:** absent, partial, or in code, with source/test links.
  Acceptance alone does not implement a proposal.
- **Delivery:** unreleased or released, with environment, exact commit,
  migrations, runtime/build/update identifiers and verification evidence.
- **Rationale:** documented, reconstructed, or proposed. Code establishes
  behavior; it cannot establish an earlier author's motivation.

D01-D10 below form a reconstructed baseline reviewed on 2026-10-22, not invented
historical acceptance dates. This shared checkout changed during the review;
the records include the newly inspected local preference/swap, calculation
context, recovery and privacy candidates. D06 is partly implemented; its further
personalization remains proposed. D09 remains a proposal with existing helper
extractions. Local source presence does not establish acceptance, passing tests,
applied migrations, hosted functions or production delivery. See the outstanding
[release gates](OPEN_RELEASE_GATES.md).

Create future records as `docs/decisions/NNNN-short-name.md` using the
[template](decisions/TEMPLATE.md). Use increasing numbers and preserve IDs. Link
issue, PR, decision, architecture and release. Replace a decision by adding a
new record and marking the old one superseded; retain its old tradeoff. arc42
calls for criteria, alternatives and reasons because an implementation
description alone does not explain a choice. [arc42, architecture
decisions](https://docs.arc42.org/section-9/)

## 3. Subsystem impact matrix

For a material change, cover the affected rows. For other rows, give a short
reason there is no effect. This catches a screen feature that also changes
history or an older installed client's behavior.

| Subsystem and responsibility | Questions the decision must answer | Required evidence |
| --- | --- | --- |
| Database: profile, plan tree, sessions, logs, progress and receipts in [migrations](../supabase/migrations/) | What is canonical? Who owns rows? Which references are legal? Do RLS and grants permit exactly that access? | Fresh-schema/upgrade fixtures, two-account denial and transaction failure tests. |
| RPC boundary in [queries](../lib/db/queries.ts) and [training-plan writes](../lib/db/plan-preferences.ts) | Must this be atomic? Are retries idempotent? What errors must clients handle? Do privileged functions check ownership? Is eligibility enforced in the client or server? | RPC examples, invalid payloads, replay/conflict checks, migration order. |
| Native/runtime in [app config](../app.json), [EAS config](../eas.json) and [workout storage](../lib/session/workout-store.ts) | Is a new binary needed? Can old disk records load? What survives background/restart/sign-out? | Installed platform evidence, runtime/build IDs and storage migration checks. |
| Frontend routes and components | Who owns loading, retry, draft and committed state? Do keyboard, large text and screen readers permit the next action? | Complete phone scenario, state regression and taps/time for friction claims. |
| [Plan](../lib/plan/) and [catalog](../lib/catalog.ts) | Which constraints are mandatory? How do preferences rank? What if no eligible exercise exists? Can old plans still display? | Eligibility across every fallback, deterministic fixtures, empty-result UX. |
| [Authentication](../lib/auth.tsx) and [callbacks](../lib/deep-link.ts) | Which identity owns cached/read/replayed data? Can delayed responses cross an account switch? Which callbacks are trusted? | Expired-session, malformed callback, account-switch and actual provider/device flows. |
| Photos, export and deletion in [privacy controls](PRIVACY_CONTROLS.md) | Is the photo an owned object path or a public URL? Which unsynced device data is exported/deleted? What happens after partial or ambiguous server deletion? | Storage-role denial checks, signed-image/device behavior, fixed-account function checks and cleanup/retry evidence. |
| CI/environments/releases in [workflow](../.github/workflows/checks.yml) | Which backend receives the build? What publishes automatically? Can the tested artifact be identified and recovered? | Environment/commit/build record, smoke test, rollback or forward-fix procedure. |
| [Observe](../lib/observe.ts) and sync recovery | How is failure detected? Which identifiers help debug without exposing tokens or private measurements/workouts? | Defined/redacted events and actionable recovery. The adapter alone does not establish production alerting. |

## 4. Current decisions and their consequences

### D01. Share the client through Expo and React Native

**In code; reason reconstructed.** [Dependencies](../package.json) and
[routes](../app/) implement one application for iOS, Android and web. Supabase
provides managed auth and data. The inferred benefit is less duplicated client
work for a personal project. Separate native apps could specialize more but add
parallel implementation/releases. No original comparison was verified.

Preserve shared domain behavior with explicit platform adapters, such as
[file export](../lib/export-file.ts) and its [web
variant](../lib/export-file.web.ts). Web checks cannot establish native keyboard,
background timer, linking or module behavior. Revisit if platform workarounds
dominate core workout code. Validate domain checks and installed target-platform
flows. Review native compatibility whenever a dependency changes: a JavaScript
update must match the native code fixed in the binary. [Expo runtime
versions](https://docs.expo.dev/eas-update/runtime-versions/)

### D02. Generate plans locally through explicit rules

**In code; reason reconstructed.** [GenerateInput](../lib/plan/generate.ts)
contains goal, experience, days, time, equipment, limitations and optional exact
exercise IDs. Seeded rules select catalog exercises and prescribe sets/reps/rest.
[Progression](../lib/progression.ts) separately adjusts loads from outcomes. A
remote model is an alternative for future evaluation; it would add network
dependence and output validation. There is no verified historical rejection.

Preserve reproducibility for the same inputs/catalog. Height, bodyweight,
preferred/excluded exercise IDs and history are absent from this generator's
interface. Bodyweight has a separate role in load calculations. Revisit when a
validated requirement cannot fit these rules. [Generator](../__tests__/generate.test.ts)
and [progression](../__tests__/progression.test.ts) tests cover separate contracts.
Proposed follow-up: save generator/catalog versions and input provenance with
new plans so recommendations remain reproducible after changes.

### D03. Persist set intent before network replay

**In code; recovery rationale documented.** The
[journal](../lib/session/set-journal.ts) saves owner, origin, revision, payload,
expected server version and event time before the [outbox](../lib/session/outbox.ts)
sends it. [Sync](../lib/session/sync.ts) binds transport to the account.
[Versioned SQL](../supabase/migrations/0007_ordered_set_writes.sql) and its
[timed extension](../supabase/migrations/20261007173759_timed_set_writes.sql)
check server writes. [Ordering](ORDERED_SET_WRITES.md) and
[journal documentation](SET_WRITE_JOURNAL.md) explain the recovery model.

The invariant is that retry cannot silently overwrite a newer correction or
invent a completion time. An acknowledgement resolves only its exact write;
completion cannot conceal unresolved sets. `PT409` requires comparison; `PT410`
means summary finalization prevents mutation. Network-only writes lose offline
intent. Blind last-write-wins lets arrival order decide user data. Those
alternatives violate the protocol's documented recovery requirements.

The local candidate also captures new sessions' original units and bodyweight in
the owned session insert. A [migration](../supabase/migrations/20261022211126_session_calculation_context.sql)
makes that context immutable; historical sessions remain explicitly unknown.
The [query adapter](../lib/db/queries.ts) restores it for server-backed resume.
[Offline summary](../lib/session/offline-summary.ts) produces provisional local
feedback without confirming PRs or future loads before the server receipt.
These changes preserve the distinction between saved intent, acknowledged sets
and finalized progression. [Context](../__tests__/session-context.test.ts),
[database context](../scripts/test-session-context.cjs) and
[offline-summary](../__tests__/offline-summary.test.ts) tests exist; their
presence alone does not verify the current combined candidate or phone behavior.

The cost is storage, locking, conflict UI and compatibility work. Changing a disk
key or payload needs migration/recovery, not only a TypeScript change. Validate
interruptions, duplicate replay, stale acknowledgement, isolation and conflict
recovery through [journal](../__tests__/set-journal.test.ts),
[sync](../__tests__/sync.test.ts) and [ordering](../scripts/test-set-ordering.cjs)
checks. PGlite cannot establish concurrent transactions. PostgreSQL concurrency
and native restart/offline verification remain separate checks. Revisit when
cross-device resume changes ownership of active workout state.

### D04. Separate native publication from merge

**Locally implemented change; delivery unverified.** The current
[workflow](../.github/workflows/checks.yml) requires explicit native publication
tied to a tested SHA, build and platform. The reason is recorded in the
[native release guide](NATIVE_RELEASE.md): device verification precedes
publication. Publishing after every merge does not establish that evidence.

Preserve traceability from candidate to publication. CI checks the supplied
record's shape. A human attestation does not prove the binary contains that SHA
or the test happened. Close that gap with artifact metadata. Revisit when a
device smoke test can produce reliable evidence automatically. Validate dispatch
conditions and installed flows in [releases](RELEASES.md).

### D05. Restrict generation to confirmed gym movements

**Locally implemented change; delivery unverified.** A `machine` label cannot
prove a specific machine exists. [Office gym generation](../lib/plan/office-gym.ts)
derives exact eligible IDs from the authored routine and intersects saved
equipment restrictions with confirmed inventory. [Onboarding](../app/onboarding.tsx)
and [training-preference rebuild](../components/TrainingPreferences.tsx) use it.
Candidate fallbacks retain the ID filter. The preset activation path now calls
[generateSafeGymRoutine](../lib/plan/swaps.ts) through
[GymRoutineCard](../components/GymRoutineCard.tsx). It applies equipment,
experience and limitations, replaces or omits ineligible items, and refuses a
routine when a whole block has no eligible item. This is local source behavior,
not delivered-device evidence.

The invariant is that rebuilding cannot broaden restrictions or invent equipment.
Category-only filtering was rejected because it permits unavailable machines.
The cost is coupling inventory evidence to the preset and maintaining its curated
pool. Existing saved plans do not change automatically. [Regressions](../__tests__/office-gym-plan.test.ts)
cover generation and saved restrictions; [training-preference
tests](../__tests__/training-preferences.test.ts) add preset/swap fixtures. These
do not establish end-to-end onboarding or native interaction. Revisit by
separating versioned inventory from exercise requirements when adding another
gym or temporary availability. Filtering the preset does not prove that its
volume, six-day rotation or timing adapts to every questionnaire goal and schedule.

### D06. Edit training inputs and swap before a workout starts

**Partly implemented locally; delivery and combined verification unestablished.**
[TrainingPreferences](../components/TrainingPreferences.tsx) edits goal,
experience, days, session duration, equipment and limitations using
[profile defaults](../lib/plan/preferences.ts). The
[save_training_plan migration](../supabase/migrations/20261022211340_training_preferences.sql)
updates those profile fields and saves the matching plan in one transaction.
This fixes the paired-rebuild consistency problem. Onboarding still calls
`savePlan` and `updateProfile` separately, so this atomic guarantee does not
cover all profile/plan writes.

[ExerciseSwap](../components/ExerciseSwap.tsx) offers up to five alternatives
before workout start. [Compatibility rules](../lib/plan/swaps.ts) retain movement
pattern, unilateral convention, reps/timed mode and current equipment/level/
limitations, excluding exercises already selected for the day. The
[RPC adapter](../lib/db/plan-preferences.ts) uses compare-and-set. SQL checks
ownership, unchanged training inputs/current exercise and absence of an
unfinished session for that day. It modifies the active plan item, affecting
future uses of that plan; it is not a session-only or mid-workout substitution.
Existing set-log exercise IDs are not rewritten.

The invariant is that a swap cannot silently change a running workout or erase
logged exercise identity. Client UI also blocks changes when this device has a
saved workout. Database ownership checks stand separately. However, exact
catalog/pattern/equipment eligibility is currently checked by the client; the
RPC accepts a nonempty replacement ID rather than validating a server catalog.
Do not describe it as server-enforced recommendation correctness. A versioned
server validator is a follow-up option if consistent enforcement across clients
becomes a requirement.

[Unit fixtures](../__tests__/training-preferences.test.ts) and
[SQL scenarios](../supabase/tests/training_preferences.sql) exist for constraints,
atomic rebuild, stale/foreign edits and active-workout denial. Confirm the
combined candidate's results, real service behavior and phone UX before release.
Add coverage for failure/retry, another device starting a workout and preserved
historical display. The choice reduces risky mid-workout mutation but requires
users to choose alternatives before starting. Revisit after observing actual
busy-machine use.

Preferred/excluded exercise-ID fields, preference ranking, history-based
selection and session-scoped swaps remain proposals. Persist explicit exclusions
before ranking eligible preferences. Record a focused schema/scope decision
before extending the current feature; do not label all personalization complete
because editable training inputs now exist.

### D07. Validate auth callbacks and bind work to an account

**In code; security intent documented in implementation.** The
[client](../lib/db/supabase.ts) uses PKCE and disables automatic URL session
detection. [Callbacks](../lib/deep-link.ts) limit accepted routes/code exchange;
[native crypto](../lib/auth-crypto.ts) supplies required primitives. The
[provider](../lib/auth.tsx) invalidates stale reads, and
[gating](../lib/auth-gate.ts) distinguishes profile failure from missing onboarding.

The implementation rejects raw token fragments. Treating a profile load error as
absence would send an existing user into onboarding. Preserve the account
boundary across callbacks, reads and replay. Validate [links](../__tests__/deep-link.test.ts),
[provider](../__tests__/auth-provider.test.tsx), [bound
client](../__tests__/bound-client.test.ts) and real provider/device links.
Revisit before changing redirect domains, providers, session storage or account
support. AsyncStorage persistence exists; these files do not establish encrypted
session storage.

### D08. Enforce transactions and ownership in Postgres

**In code; transaction reason documented.** [save_plan](../supabase/migrations/0004_save_plan_rpc.sql)
retires a plan and inserts its replacement hierarchy atomically, deriving owner
from `auth.uid()`. [RLS](../supabase/migrations/0001_init.sql) and
[reference checks](../supabase/migrations/0006_workout_reference_ownership.sql)
restrict access. Some specialized set/progression RPCs use `SECURITY DEFINER`;
their contracts require explicit identity/reference checks and restricted grants.

UI filtering cannot authorize database access. Sequential client inserts were
rejected for plans because a failure can leave a partial tree. Privileged SQL is
not a permission-error workaround. RLS runs independently of frontend state.
[Supabase RLS guide](https://supabase.com/docs/guides/database/postgres/row-level-security)

Validate permitted/forbidden operations, atomic failure and upgrades. Revisit on
new tables/RPCs, shared gym ownership or roles. Migration 0007 revokes older
writes and needs a coordinated client transition described in
[ordered writes](ORDERED_SET_WRITES.md); do not assume it is additive.

### D09. Extract workout behavior from growing screens

**Controller extraction proposed; some helpers already local.**
[Run](../app/session/[dayId]/run.tsx) coordinates UI state, timers, snapshots,
drafts, history and sync. [Offline summary](../lib/session/offline-summary.ts)
and [recovery data](../lib/session/recovery-data.ts) are separate helpers now;
they do not constitute a complete session controller. Extract transitions/validation
and a session controller where an invariant becomes independently testable.
Keep rendering/accessibility in components, disk writes in stores and server
writes behind query/sync modules. Avoid wholesale navigation/state-library
rewrites without a specific failure to solve.

Successful save feedback must follow durable persistence and remain valid across
recovery/account changes. A global store for every screen value would add
lifetime/cleanup work without proving that invariant. Validate timers, rest
edits, restart, large text, screen readers and keyboard behavior. Measure actions
per logged set. Revisit when another flow needs the same session behavior.

### D10. Keep photos private and account removal server-owned

**Local client, migration and function candidate; hosted delivery unverified.**
[Avatar handling](../lib/avatar.ts) stores owned object paths and resolves
five-minute signed URLs. The [private-avatar
migration](../supabase/migrations/20261022211107_private_avatars.sql) restricts
bucket reads to the owner; legacy public URLs become object references rather
than rendered external URLs. Pair the client with this migration: older public
URL clients lose access when the bucket becomes private. Cached public images
cannot be recalled and signed URLs remain valid until expiry.

[Account export](../lib/account-export.ts) can include owned raw local recovery
records as well as the database snapshot. Photos and other devices' unsynced
data are excluded. [Deletion](../lib/account-delete.ts) freezes the expected
account/token and stops replay before invoking a [server
handler](../supabase/functions/delete-account/handler.ts). The
[Edge adapter](../supabase/functions/delete-account/index.js) verifies Auth,
removes photos, revokes sessions and deletes the Auth user using server-only
credentials. The client removes this owner's local keys after confirmation.

The invariant is that request data or an account switch cannot redirect removal
to a different account. A public photo URL and a client-held service key are
rejected approaches. Removal spans Storage and Auth and is not one distributed
transaction; partial/ambiguous failure needs explicit retry/recovery. Revisit
when photo sharing or multi-device cache removal becomes a requirement. Verify
owner/anonymous/foreign access, expired signed images, fixed-account deletion,
partial failure and device export/cleanup using the tests and outstanding hosted
checks listed in [privacy controls](PRIVACY_CONTROLS.md). No real account needs
deletion to prove that this source exists.

## 5. Handling bugs, features, chores and incidents

### Triage

An issue records observed/desired behavior, environment/build/commit, a
reproduction or scenario, affected subsystems, severity and a checkable finish
condition. Record uncertainty. Proposed priorities are P0 for active account/data
exposure or broad data loss, P1 for blocked sign-in/workouts, lost sets or violated
equipment restrictions, P2 for important missing behavior, and P3 for low-impact
cleanup. Work type does not dictate urgency.

### Bugs and hotfixes

1. Reproduce using disposable data and isolate the failed layer.
2. Name the violated invariant and existing decision. Add a regression when it
   can catch recurrence; editorial fixes need no new tests.
3. Make the smallest correction. If a contract changes, update/create its ADR.
   Keep unrelated feature work out of urgent fixes.
4. Run affected-layer checks and the failing phone scenario. A set-loss fix
   needs restart/replay evidence, not only rendering checks.
5. Use the [hotfix release path](RELEASES.md) and record recovery. Containment can
   precede a full rationale writeup; it cannot make destructive schema changes
   compatible with old clients. Track remaining work explicitly.

### Features

Start with a scenario such as "the row machine is occupied; choose an allowed
replacement without losing the previous set." Define hard constraints, offline
behavior, error recovery and acceptance criteria. Fill the subsystem matrix and
write an ADR when contracts change. Compare the simplest viable approach, one
realistic alternative and deferral. Resolve design before the implementation PR
becomes large. The Google engineering book distinguishes design discussion from
code review and recommends understandable changes. [Software Engineering at
Google, chapter 9](https://abseil.io/resources/swe-book/html/ch09.html)

Slice compatible delivery: expand persistence/RPCs, add tolerant reads, implement
behavior, then remove old paths when client evidence permits it. Keep a feature
issue open until its specified environment and phone scenario pass, even when a
foundation PR has merged. A swap must preserve completed session history.

### Chores and security work

For chores, name the maintenance problem and preserved behavior. Compatible patch
upgrades normally use a PR. SDK/native plugin, runtime, storage and RPC changes
need compatibility evidence and often an ADR. Separate formatting from behavior.

For security issues, restrict exploit details when disclosure exposes users,
repair the trust boundary and test the forbidden operation. Rotate an actually
exposed credential when applicable. Never attach tokens, private exports or raw
workout payloads to public issues/ADRs. Record recovery implications safely.

### Review, rollout and closure

A material PR identifies schema order, old-client behavior, disk migration,
runtime, target environment and recovery. Prefer additive fields with defaults
and tolerant readers. Before destructive changes, account for older clients and
queued writes. A frontend rollback cannot safely reverse committed database
data by itself.

The owner can self-review against the issue/ADR; another reviewer is optional.
Merge means implemented only when the matching code exists. Mark released only
after exact artifacts and acceptance evidence exist. Supersede decisions when
their revisit conditions occur rather than silently changing their reasons.

## 6. Proposed implementation plan

These follow-ups are proposals. This documentation update does not implement
them or change live infrastructure.

| Order | Deliverable | Finish condition |
| --- | --- | --- |
| 1 | Owner reviews this baseline and explicitly accepts/rejects proposals. Material PRs link their decision. | Observed code, inferred rationale, proposals and delivered evidence remain distinguishable. |
| 2 | Verify the new [migration baseline](MIGRATION_BASELINE.md) against deployed history, native runtimes and client contracts; create release evidence. | Local SQL/function candidates, ordered-write compatibility and native guard changes have explicit delivered/unreleased status. |
| 3 | Validate new constrained preset/generator/swap paths, then separate inventory from programming and add provenance. | Existing fixture results and phone empty-pool behavior are recorded; preset schedule/volume limitations remain explicit. |
| 4 | Prove the local atomic training-input rebuild, then decide preferred/excluded exercise-ID persistence and ranking. | Existing inputs survive reload/rebuild; proposed exercise exclusions are separately implemented/tested before being claimed. |
| 5 | Verify the local pre-workout swap's stale edit, active-session, history and retry behavior; decide separately whether in-session swaps are needed. | Deployed semantics match active-plan mutation and preserve logged identity. No session-only behavior is implied. |
| 6 | Verify calculation-context, provisional-summary and privacy candidates on their paired backend/device; extract D09 controller behavior only where needed. | Original/unknown context, offline feedback, photo access, export and deletion failure behavior are demonstrated without timer/restart/conflict regressions. |
| 7 | Add redacted release/sync diagnostics and lightweight incident/revisit records. | Failure traces to a build/operation without private payloads. |

No recurring decision meeting or ADR for every task is needed. One owner, issue,
relevant decision and reviewable PR are enough for most work here.

## 7. Sources and adaptations

Research accessed 2026-10-22. Sources are author/project/vendor documentation;
repository links support project-specific claims.

| Source | Adopted | Left out |
| --- | --- | --- |
| [Nygard's ADR article](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions) | Context, decision, consequences, stable IDs and preserved supersession. | A record for every implementation detail. |
| [arc42 section 9](https://docs.arc42.org/section-9/) | Criteria, rejected alternatives and rationale. | A full architecture template for small fixes. |
| [Software Engineering at Google, chapter 9](https://abseil.io/resources/swe-book/html/ch09.html) | Design before detailed implementation review; understandable changes. | Google's approval hierarchy and mandatory independent review for personal-repo edits. |
| [Rust RFCs](https://github.com/rust-lang/rfcs/blob/main/README.md) and [template](https://github.com/rust-lang/rfcs/blob/main/0000-template.md) | Substantial-change threshold, user examples, alternatives and unresolved questions. | Committees and final-comment periods. |
| [Expo runtime versions](https://docs.expo.dev/eas-update/runtime-versions/) | Native/update compatibility as a recorded consequence. | Assuming OTA can add missing native code. |
| [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security) | Database ownership independent of UI. | Assuming RLS alone explains authorization inside privileged functions. |
