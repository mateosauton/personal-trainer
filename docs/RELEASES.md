# Releases: artifacts, environments, verification, and recovery

## Current operating procedures

Use [environment isolation](ENVIRONMENTS.md), [release safety](RELEASE_SAFETY.md)
and [CI](CI.md) for this checkout's operating procedures. They supersede dated
workflow snapshots and environment proposals below where those differ.
Production remains on the existing Supabase project `asbudyijvunpnhrhsubm`;
local development uses the disposable local stack. Hosted development and
preview builds remain blocked while their isolated backend references are
unregistered; no additional paid backend has been provisioned.

The supported production native path publishes a guarded release-test candidate,
then manually promotes that exact phone-tested update group after checking
actual EAS build/runtime/backend evidence. It does not regenerate the tested
bundle, and merging source does not publish a native update. The separate
[open release gates](OPEN_RELEASE_GATES.md) still need their recorded evidence.

Office Gym succeeds when someone can open their phone, understand their next
exercise, use equipment their gym actually has, and finish without losing sets.
A release must preserve that journey, including interrupted and offline sessions.

Reviewed on **22 October 2026** against this working tree, based on commit
`5e2d3172bdb4bff9b72e37c749209c7f2f3307db`. Some configuration changes are local
and uncommitted. **Current** describes source files, not an audit of hosted
settings, store availability, or installed versions. **Proposed** means work to
implement. No release was performed while writing this document.

The shared checkout also gained local privacy, session-context, training, calendar,
dependency, and migration-baseline work during this review. Their presence is
implementation evidence, not proof of combined integration or deployment. Use
the final clean candidate and the [open release gates](OPEN_RELEASE_GATES.md)
for publication; do not reuse an earlier test result after those inputs change.

Related: [Git workflow](GIT_WORKFLOW.md), [architecture](ARCHITECTURE.md),
[technical decisions](TECHNICAL_DECISIONS.md), [CI](CI.md),
[native checklist](NATIVE_RELEASE.md), and [Cloudflare guide](CLOUDFLARE_RELEASE.md).

## Contents

- [1. Five independent release paths](#1-five-independent-release-paths)
- [2. Environments and configuration](#2-environments-and-configuration)
- [3. Identify the actual release](#3-identify-the-actual-release)
- [4. Current automation and its limits](#4-current-automation-and-its-limits)
- [5. Prepare and verify a candidate](#5-prepare-and-verify-a-candidate)
- [6. Native delivery: OTA and binaries](#6-native-delivery-ota-and-binaries)
- [7. Web delivery](#7-web-delivery)
- [8. SQL order and old installed clients](#8-sql-order-and-old-installed-clients)
- [9. Rollout and acceptance](#9-rollout-and-acceptance)
- [10. Incident, rollback, and hotfix](#10-incident-rollback-and-hotfix)
- [11. Release record and change examples](#11-release-record-and-change-examples)
- [12. Staged improvement plan](#12-staged-improvement-plan)
- [13. Research and adaptation](#13-research-and-adaptation)

## 1. Five independent release paths

One feature can require several artifacts, applied in a deliberate order.

| Artifact | Contents and delivery | Example | Recovery boundary |
| --- | --- | --- | --- |
| Native binary | Native modules/configuration, embedded JavaScript/assets and update settings; EAS Build then explicit store/internal distribution | Adding a native library or config plugin | Usually requires a corrected binary; installed copies remain |
| Native update, or OTA | Compatible JavaScript/assets; EAS Update to a channel/runtime/platform | Exercise-screen or plan-algorithm fix | Prior compatible update or embedded JavaScript; no database undo |
| Web app | Static Expo export in `dist/`; Cloudflare Worker assets | Browser layout or callback fix | Prior Worker version; no backend undo |
| Database | Tables, constraints, policies, RPCs, backfills; reviewed Supabase SQL migrations | Timed-set persistence | Forward repair or planned restore; separate from client rollback |
| Edge Function | Server code and function configuration; separate Supabase function deployment | Account deletion through `delete-account` | Redeploy reviewed server code; this cannot restore a deleted account or its data |

`app.json` uses Expo's `fingerprint` runtime policy. Native runtime changes need
matching new binaries; OTA cannot supply missing native code. Matching also
does not prove correct workout behavior or database contracts. See
[Expo runtime versions](https://docs.expo.dev/eas-update/runtime-versions/).

A JavaScript-only rest-button fix may need OTA and web delivery. Timed sets need
compatible database validation before clients submit `seconds`. An authentication
plugin change needs native builds even if browser authentication already works.

## 2. Environments and configuration

An environment selects backend/configuration values. An EAS channel selects an
update stream. A build profile selects build settings. Similar names do not
provide data isolation.

### Current configuration

| Profile/path | EAS variables | Update channel | Distribution and limits |
| --- | --- | --- | --- |
| `development` | `development` | None explicitly declared | Development client, internal, Android APK |
| `preview` | `preview` | `preview` | Internal, Android APK; backend depends on hosted variables |
| `release-test` | Inherits `production` | `release-test` | Extends production, internal, Android APK; inherits `autoIncrement` |
| `production` | `production` | `production` | Production defaults, remote build-version increment |
| PR CI | Mock Supabase URL/key | None | Bundle validation; cannot establish authenticated behavior |
| Cloudflare production/preview | Hosted build settings | Not applicable | Existing operator guide documents production Supabase values for both |

These come from [eas.json](../eas.json) and
[checks.yml](../.github/workflows/checks.yml). `release-test` separates OTA
delivery from users but uses production configuration and may write production
data. A preview hostname also does not isolate accounts or records.

### Proposed minimum: two backend projects

Use a development Supabase project with synthetic accounts/data for local
work, `preview`, and PR previews. Use production for production native/web and
the final `release-test` smoke check with dedicated test accounts. The maintainer
records project references, callback allowlists, migration status, and owners
in an environment inventory. Keep real workout history out of development
fixtures. Add a third staging backend only when migration rehearsals require it.

Supply the intended public configuration at bundle time for EAS Build, EAS
Update, and Cloudflare. Expo inlines `EXPO_PUBLIC_*`; EAS Update's `--environment`
selects its variable set. Changing a dashboard value does not alter existing
bundles. See [EAS variable usage](https://docs.expo.dev/eas/environment-variables/usage/).

| Setting | Owner/location | Release check |
| --- | --- | --- |
| Supabase URL and publishable key | EAS environments and Cloudflare build settings | Record intended project; check both point to it |
| Google/Apple visibility flags | Public build configuration | Test enabled providers and exact callbacks on every intended platform |
| Developer login email/password/flag | Local throwaway-account settings only | Absent from distributable builds and shared environments |
| `EXPO_TOKEN` | GitHub Actions secret | Authorized publishing only; never a public app variable |
| Signing/provider/database credentials | EAS/store/Supabase secret stores | Never committed, bundled, or included in release records |

The new `delete-account` function reads `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY` on the server. Its config enables platform JWT
verification and its handler verifies the caller through Auth again. Record
function deployment/configuration separately from SQL and client artifacts;
the function has not been established as deployed by this review.

`.env.example` documents names; Git must not contain actual credentials. EAS
visibility labels do not protect values embedded in client code. See
[EAS visibility rules](https://docs.expo.dev/eas/environment-variables/).

## 3. Identify the actual release

`app.json` currently declares `1.0.0`. That cannot identify every later OTA or
SQL change.

| Identifier | What to record |
| --- | --- |
| Full Git SHA | Exact clean source tree and CI run URL |
| App version | Store/product version; proposed major/minor/patch convention for breaking/additive/fix milestones |
| iOS build number / Android version code | Store binary identity; EAS uses remote versions and production `autoIncrement` |
| EAS build UUID | Platform, profile, source, distribution and concrete build |
| Runtime fingerprint | Per-platform native compatibility identity |
| Channel, update group and platform update ID | OTA destination and actual delivered artifact; channel routing can change |
| Cloudflare version / deployment ID | Web artifact / activation record |
| Migration IDs and applied status | Backend contract/data state; a source SHA does not prove SQL was applied |
| Edge Function source/deployment/configuration | Server-side deletion implementation and verified target project |
| Public configuration record | Backend reference and provider flags used to produce artifacts |

Proposed source tags such as `v1.1.0` identify milestones. The release record
still lists which platforms/runtimes received them. An OTA does not increment
a store build or replace its native code.

Record Node/npm/EAS versions, Expo SDK, native build image, lockfile, and public
configuration revision alongside the SHA. Current Node 22, the lockfile and
pinned publishing CLI reduce drift; they do not make builds byte-for-byte
reproducible. Wrangler is not pinned here, hosted variables can change, and
exercise media still references external URLs. Retain tested artifacts rather
than assuming a future rebuild will reproduce them.

## 4. Current automation and its limits

This section describes the local candidate workflow. The remote `master`
workflow still publishes native updates on pushes, as recorded with its pinned
source in [Git workflow](GIT_WORKFLOW.md#1-what-exists-and-what-is-proposed).
The manual gate below is not effective until that consolidation is merged.

`CI/CD` runs on PRs, pushes to `master`, and manual dispatch. Node 22 and `npm ci`
use the lockfile. `npm run check:web` runs TypeScript, Jest, and disposable PGlite
database checks; `test:db` now includes `test:migrations` and the fresh-schema/
pinned-baseline-upgrade checks. `npm run build:web` checks the web export with mock settings.
PR jobs receive no release credentials. These protect logic; they cannot prove
keyboard clearance, touch behavior, or a completed workout on a phone.

Native publishing requires manual dispatch on `master` with these exact inputs:

| Input | Type | Check performed |
| --- | --- | --- |
| `publish_native` | Boolean, default false | Explicitly enabled |
| `tested_sha` | String | Lowercase 40-character hexadecimal SHA equal to run `GITHUB_SHA` |
| `native_build_id` | String | UUID format only |
| `release_platform` | Choice: `android` or `ios` | One verified platform per dispatch |

The summary records operator, SHA, build, and platform as a human attestation.
CI does not retrieve the build, compare its source/runtime, or inspect device
results. It publishes a production OTA using EAS CLI 23.2.0.

`eas-production` concurrency serializes publishers without cancelling an active
publish. A late check skips a queued commit superseded on `master`; a push
between that check and publication can still race. Until immutable promotion
exists, keep `master` unchanged during this window and inspect the resulting
update. This job does not build/store-submit binaries, apply SQL, or roll back.
It also does not deploy the new Edge Function. Test scripts and dependency
patches in this candidate need final-lockfile verification; see
[dependency review](DEPENDENCY_REVIEW.md), including its unresolved advisory
decisions. A successful unit suite is not a clean dependency audit.

## 5. Prepare and verify a candidate

Use a clean checkout of the intended full `master` SHA. Do not publish this mixed
working tree. First record affected artifacts, compatibility requirements and
last known good IDs.

```sh
git status --short
git rev-parse HEAD
npm ci
npm run check:web
EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 EXPO_PUBLIC_SUPABASE_KEY=mock npm run build:web
```

Require empty status. These commands come from the repository; the mock export
is validation only. Build/install each intended platform's candidate:

```sh
npx eas-cli@23.2.0 build --platform android --profile release-test
```

For iOS, use `--platform ios` and complete signing/device registration. Simulator
or Expo Go results do not establish physical-device release coverage. Inspect
the EAS record for source SHA, profile, environment, platform, and runtime.
Current CI does not perform that comparison.

Before an OTA release, compare the candidate's per-platform runtime fingerprint
with the intended installed production binaries. A fresh release-test build
can validate a new runtime that no production user has installed. If no intended
production binary matches, deliver a new production binary first; publishing
an incompatible OTA will not update those devices. Record the compatible build
IDs/runtimes, not just the candidate build ID.

Record pass/fail with device, OS, build UUID and evidence:

1. Sign in, reopen, sign out, recover access, and test enabled social callbacks.
2. Complete onboarding; verify saved goals, measurements, schedule, and equipment.
   Every generated exercise must belong to the reviewed gym collection and use
   available equipment. Record preferences the current product cannot honor.
3. Read exercise setup/instructions, log/correct reps and weight, edit a timed
   set, use rest controls, and finish using one-handed interactions.
4. Open the keyboard; check bottom controls, safe areas, text size, back
   navigation, and accidental double taps on a narrow phone.
5. Start online, disconnect, log sets, background/terminate, reopen, complete,
   reconnect, and confirm one result per operation. Starting a brand-new session
   offline is currently unsupported.
6. Sign out with pending work, use a second account, then return. Confirm queues
   do not cross accounts and session/rest state resumes correctly.
7. Verify history, progression, and account export against those completed sets.

For the new local candidate, also verify private/signed photo loading and expiry,
unknown historical calculation context, preference save/rebuild, rejected swaps
during an active workout, home-timezone calendar boundaries, and raw recovery
export without a working backend. Exercise deletion only on a designated
synthetic account in the development environment. A real account deletion is
the user's destructive action, not a production smoke test. Confirm hosted
Auth/Storage cleanup, revoked-session behavior, and local cleanup separately.

The [native checklist](NATIVE_RELEASE.md) is the short operator version. Failed
saving, wrong-account access, or unavailable-equipment recommendations block
release. Record missing platform coverage; passing Android does not authorize iOS.

## 6. Native delivery: OTA and binaries

### Current OTA publication

After verification, dispatch `CI/CD` on `master`. This equivalent CLI example is
an operator template, not a command executed during this review:

```sh
gh workflow run checks.yml --ref master \
  -f publish_native=true \
  -f tested_sha='<full-tested-master-sha>' \
  -f native_build_id='<installed-eas-build-uuid>' \
  -f release_platform=android
```

The workflow's publishing step is:

```sh
eas update --platform "$RELEASE_PLATFORM" --channel production --environment production --message "Release $GITHUB_SHA" --non-interactive
```

Inspect the completed run/update, record IDs/runtime, receive it on a
production-channel test device, restart through the normal update lifecycle,
and repeat saving/reconnection. Availability does not prove every installed
phone has downloaded or launched it.

Current CI regenerates a bundle from source. A same-SHA tested binary does not
prove exact OTA artifact promotion. Proposed replacement: publish/test a
`release-test` OTA, verify identical public configuration, matching runtime,
and identical code-signing settings when enabled, then republish that exact
group. Expo documents this approach in its
[deployment guide](https://docs.expo.dev/eas-update/deployment/). Add workflow
artifact checks before replacing today's publication path.

### Binary delivery

Native dependency/plugin, permission, scheme, and runtime changes require new
production builds from the verified commit for each platform:

```sh
npx eas-cli@23.2.0 build --platform android --profile production
```

Record actual build number/code and UUID. Verify the production artifact through
the selected store beta/internal track, then follow the store release process.
A `release-test` APK differs from a production store artifact. Store accounts,
signing, submissions, review, and staged rollout are not automated here.
Build success does not mean publication. Inspect command forms in the
[EAS CLI reference](https://docs.expo.dev/eas/cli/).

## 7. Web delivery

`wrangler.jsonc` defines Worker `personal-trainer`, `./dist` static assets and
SPA fallback. Builds run `npm run check:web && npm run build:web`. Hosted
Cloudflare integration can deploy merged `master` independently of native
publishing. Inspect that trigger/backend configuration before merging; delaying
native publication does not delay web.

Follow [CLOUDFLARE_RELEASE.md](CLOUDFLARE_RELEASE.md) for URLs and callback setup.
Record source SHA, version/deployment IDs, and URL. Test direct `/sign-in` and
`/reset-password` loads, authentication callbacks, refresh/resume and saved
workouts. Browser verification does not establish native behavior.

Cloudflare separates uploaded versions from activated deployments; `wrangler
deploy` normally does both. Proposed controlled promotion should activate the
tested version instead of rebuilding with possibly changed configuration. See
[versions and deployments](https://developers.cloudflare.com/workers/versions-and-deployments/).

## 8. SQL order and old installed clients

Neither GitHub's job nor Wrangler applies migrations. The maintainer records
and verifies the target project separately. The repository mixes legacy-numbered
and timestamped files. It now has a minimal [Supabase config](../supabase/config.toml)
for `delete-account`, a [source baseline](../supabase/migration-baseline.json),
and [read-only planning script](../scripts/migration-baseline.cjs). Supabase CLI
is still unpinned; config presence does not establish a working full local stack.

The baseline pins nine historical source files, not the entire current schema.
The reviewed snapshot has four newer SQL files. All baseline `productionVersion`
fields and `productionHistoryVerifiedAt` remain null. Therefore an ordinary
production `db push` is blocked pending the reconciliation in
[MIGRATION_BASELINE.md](MIGRATION_BASELINE.md). A checksum pass establishes local
bytes only. The planner deliberately refuses missing production mappings;
never fill them from filenames or use `--include-all` to force initialization.

Available local checks are:

```sh
npm run migrations:check
npm run test:migrations
npm run test:db
```

The database script applies all migrations to a fresh disposable database and
separately applies only additions after a populated pinned baseline. It compares
existing fixture values and resulting schema definitions. Its Auth/Storage
stubs cannot establish hosted service behavior or a restored production schema.
Production history capture, definition equivalence, restore rehearsal, and a
reviewed history reconciliation remain required before a linked dry run.

Keep applied files immutable and add migrations for corrections. Proposed
standard: no dashboard-only schema changes, superseding the SQL Editor option
in the older operations guide. Supabase explains that direct remote changes
bypass migration history. See [database migrations](https://supabase.com/docs/guides/deployment/database-migrations).

Use expand, migrate, contract:

1. **Expand.** Add compatible columns/functions/policies before dependent clients.
   Old payloads retain their meaning; test old requests against the new schema.
2. **Migrate.** Deliver new clients and bounded backfills. Keep old/new paths
   working; compare historical records and delayed queue replay.
3. **Contract later.** Remove old behavior only with a supported-client policy,
   adoption evidence, and a recovery path for offline devices. A green OTA is
   insufficient: old binaries and queued operations can return much later.

This directly affects `log_set_versioned` and
`office-gym.session-outbox.v2.<user-id>`. The timed-set migration preserves
legacy receipt representation when `seconds` is absent. An incompatible RPC
can reject previously recorded workouts while today's screen works. Test old
payload fixtures, current requests, replay/idempotency, stale writes, two-account
isolation, and upgrade with pending work.

Before production SQL, inspect backup/restore readiness, affected counts,
constraints and locking/transaction behavior. `0003_correctness_foundation.sql`
needs duplicate-active-plan preflight and changes historical completion;
follow [Supabase operations](../supabase/README.md) for that backfill. Never
rerun an applied historical migration to repair history.

Existing breaking migrations need additional checks before CLI use.

There is an existing breaking exception to the expansion-first sequence:
`0007_ordered_set_writes.sql` revokes direct set mutations and the old
four-argument progression RPC. It must not be treated as an additive migration
or applied automatically to an unverified production baseline. Hold that
cutover until the matching versioned client is installed, incompatible clients
are retired through an explicit supported-client policy, and retained outboxes
have a tested recovery path. Follow [ordered set writes](ORDERED_SET_WRITES.md)
and record the compatibility evidence before production application. Inspect
any migration dry-run for this boundary; a successful dry-run is not permission
to apply it.

### Review the new local backend changes as separate cutovers

These files are local candidates. Do not batch-apply them merely because they
sort after the baseline.

| Candidate | Compatibility and release evidence required |
| --- | --- |
| [Private avatars](../supabase/migrations/20261022211107_private_avatars.sql) | Bucket privacy and owner reads are a behavior change. Old clients rendering public URLs lose photos. Verify the signed-photo client first, then the private bucket with two accounts, anonymous access, expiry, upload/update and deleted-account JWT checks. Preserve this privacy boundary during recovery; re-publicizing the bucket is not a routine rollback. |
| [Session calculation context](../supabase/migrations/20261022211126_session_calculation_context.sql) | Adds insert-time units/bodyweight and a capture flag, with immutable-context update protection. Historical sessions stay explicitly unknown. Apply columns before dependent client reads/inserts; test old inserts/defaults, normal completion updates, context-change denial and restart/outbox behavior. Do not fabricate historical context from today's profile. |
| [Training preferences and swaps](../supabase/migrations/20261022211340_training_preferences.sql) | New `save_training_plan` commits profile settings and plan together; `replace_plan_exercise` checks ownership, expected item/profile state and active-session rejection. Older `save_plan` remains. Verify transaction failure, stale callers, old clients and completed history before enabling the client. Goal/equipment/limitations are implemented here; per-exercise favorites/exclusions are not persisted by this migration. Target-exercise eligibility still needs client-policy review and arbitrary-RPC-caller testing before claiming server-enforced inventory. |
| [Home timezone](../supabase/migrations/20261022211407_home_timezone.sql) | Adds validated profile timezone, backfills earliest valid session zone or UTC, and preserves existing `local_day`. Review changed calendar interpretation, travel/midnight/DST cases and old profiles. At this refresh only this timezone migration exists; the earlier transient `20261022100100_home_timezone.sql` is absent. Re-enumerate the final candidate and stop if both add the same column/trigger; distinct timestamp versions do not prove semantic deduplication. |
| [Account deletion function](../supabase/functions/delete-account/index.js) and [handler](../supabase/functions/delete-account/handler.ts) | Separate server deployment after the paired privacy controls are reviewed. Verify JWT/configuration and required server variables, wrong-account/anonymous denial, paginated photo cleanup, revocation and cascade behavior with synthetic data. Preserve local recovery until a confirmed response; test ambiguous/lost response and account switching. Client/SQL rollback cannot recreate deleted data. |

See [privacy controls](PRIVACY_CONTROLS.md) for cache, signed-URL and deletion
limits. The function deployment mechanism is independent of migrations, as
documented by [Supabase Edge Function deployment](https://supabase.com/docs/guides/functions/deploy).
Neither a local handler test nor `verify_jwt=true` proves hosted Auth/Storage
integration. Keep those checks open in the candidate release record.

Once baseline reconciliation and the applicable cutover conditions are satisfied,
the CLI templates are:

```sh
supabase migration list --linked
supabase db push --linked --dry-run
supabase db push --linked
```

Check installed CLI help and verify the linked project's identity first. These
commands were checked against documentation, not run locally. Dry-run lists
migrations; it does not repair baseline mismatches or prove locking/runtime safety. Never reset production
as a migration test. See [Supabase CLI](https://supabase.com/docs/reference/cli/supabase-db-push).

Release order is expansion, authenticated old/new verification, clients,
observation, later cleanup. Web publishes on merge, so expansion may need a
separate earlier PR/release.

## 9. Rollout and acceptance

Proposed policy: small releases when ready, with the maintainer responsible for
publication and observation. UI fixes need focused phone checks; auth, sync,
progression and SQL changes need the full affected journey.

EAS supports percentage rollouts with `--rollout-percentage`, `update:edit`, and
cancellation; today's workflow omits them. After release signals exist, start
with a proposed 10%, 50%, 100% progression requiring a completed/reconnected
workout at each stage and a next-day review. For a tiny audience, named beta
testers give more useful evidence. These are initial operating choices, not
statistically proven limits. See [EAS rollouts](https://docs.expo.dev/eas-update/rollouts/).

Stop for cross-account access, lost/duplicated sets, blocked workouts, or
invalid-equipment plans. Proposed signals: launch/crash failures, sign-in
completion, plan failures, save acknowledgement time, pending/rejected queue
age, and session completion. Compare with the prior release by
platform/runtime/update. Exclude tokens, passwords, body measurements and full
workout payloads from diagnostic logs.

`lib/observe.ts` wraps Expo Observe and `app/_layout.tsx` marks interactivity.
This does not establish a configured production dashboard or these business
signals. Record manual results and blind spots meanwhile. A canary needs an
evaluation process as well as partial exposure. See the SRE Workbook's
[Canarying releases](https://sre.google/workbook/canarying-releases/).

## 10. Incident, rollback, and hotfix

1. Stop publication. Record impact, platform/runtime, first failure time, release
   IDs, SQL changes, and last known good artifacts.
2. Preserve device queues/journals. Clearing storage or reinstalling can remove
   the only copy of an unsynced workout.
3. Select artifact-specific recovery below. Check that recovered clients still
   understand current database and saved-queue formats.
4. Verify sign-in, saving, restart, reconnect and history on an affected device.
   Record recovery evidence; offline clients may remain affected until relaunch.
5. Correct/revert source in a small PR so later deployments do not restore the
   fault. Record cause and one preventive issue.

| Failure | Recovery and limits |
| --- | --- |
| OTA JavaScript/assets | Restore a known compatible update or embedded JavaScript, after checking platform/runtime and current SQL compatibility |
| Native module/config | Halt new store rollout where supported; ship corrected binary. OTA cannot replace native code |
| Web version | Activate known good Cloudflare version, check callbacks/assets, revert source |
| SQL/data | Prefer corrective migration; restore requires a plan for writes since backup and replay receipts |
| Edge Function | Redeploy a reviewed compatible handler/configuration, preserving caller ownership checks. This does not undo already-completed deletion or repair missing photo objects |
| Bundled backend/flag | Produce corrected artifacts; hosted configuration changes cannot repair already-inlined values |

The official interactive EAS recovery command is
`npx eas-cli@23.2.0 update:rollback`. It can republish a previous update or direct
clients to embedded JavaScript. Embedded code differs by binary; it is not a
universal backend snapshot. Automatic launch-error recovery does not protect
against logical bugs such as wrong weights. See [EAS rollbacks](https://docs.expo.dev/eas-update/rollbacks/)
and [debugging](https://docs.expo.dev/eas-update/debug/).

Cloudflare supports `npx wrangler rollback '<previous-version-id>'` or dashboard
recovery. Inspect the target first. Worker rollback cannot undo Supabase data
or migrations. See [Cloudflare rollbacks](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/).

For an urgent fix, reproduce, add a regression, verify the smallest correction,
and follow the same artifact path. If `master` contains unrelated unreleased
work, today's native gate cannot publish a historical release branch. Prefer
reverting unfinished work from `master`, or implement an immutable-candidate
hotfix path deliberately. Avoid undocumented manual updates around the gate.

## 11. Release record and change examples

Proposed location: `docs/releases/<date>-<release>.md`, linked from the PR.
No release-record directory/automation exists yet. Record:

```text
Owner/date; issue/PR; full clean SHA; CI run
Change type/user outcome; affected artifacts
Backend reference; migration IDs/status; backup/recovery reference
Edge Function source/deployment/configuration and hosted-service checks
Public configuration names/targets; no credentials
Platform/device/OS; version/build UUID/runtime; checklist results
OTA group/platform IDs/channel; web version/deployment IDs/URL
Prior good IDs; compatibility limits; observation; gaps/follow-up issue
```

| Change | Required release work |
| --- | --- |
| Bug: corrected set reappears on reconnect | Reproduce ordering; test old/current replay; OTA/web if runtime unchanged; SQL first only if needed |
| Feature: pre-session exercise swap | Check reviewed alternatives, equipment, compare-and-set state, completed history and phone controls; active-workout swaps currently reject; paired RPC must exist before client use |
| Chore: Expo/native dependency upgrade | New runtime/build review and physical-device tests; its issue label does not make it OTA-safe |
| Docs-only clarification | Check links/source accuracy; no native/store/SQL release is needed. Until consolidation merges, every master push can still invoke the remote native publisher as well as hosted web builds |

## 12. Staged improvement plan

All items are proposed. The maintainer can use one small issue/PR per item and
subagents for bounded implementation, retaining the final release decision.

| Order | Work and acceptance | Dependency / risk |
| --- | --- | --- |
| 1 | Inventory and separate dev/prod. Preview fixtures reach only dev; production smoke accounts/callbacks pass | Hosted provider/config access; a wrong URL sends builds to the wrong backend |
| 2 | Complete the new config/baseline work: pin Supabase/Wrangler, verify production mappings, rehearse restored-schema upgrades and reconcile history. Local checksum/planner/fresh-upgrade scripts exist; release passes only when a linked dry run lists the intended additions without replaying baseline SQL | Authorized production history and development/restore target; null mappings and semantic duplicate migrations block publication |
| 3 | Release records plus automated build metadata/fingerprint checks. Wrong SHA/platform/environment/build stops before upload | EAS reads; still needs human device evidence |
| 4 | Test/promote exact OTA groups bound to immutable candidates. Tested assets/runtime reach production despite unrelated `master` advancement | Workflow redesign and tested recovery |
| 5 | Privacy-conscious release signals and staged delivery. Simulated crash/save failure blocks promotion and test rollout can recover | Artifact IDs and beta activity; sparse samples hide faults |
| 6 | Extend the new baseline-upgrade fixtures with supported old-client/outbox contracts; record privacy, context, training, timezone and deletion cutovers. Current/oldest-supported requests/replays and hosted integration pass before removal or activation | Local integration/deployment remains unverified; devices may remain offline and old clients may still use public photo URLs |

Environment isolation and recoverable release records are the first useful
results. A separate release-management service is unnecessary at this scale.

## 13. Research and adaptation

Primary documentation and publicly available book chapters were reviewed on
22 October 2026. Commands were checked against source or official references;
no build, deployment, rollback, or remote SQL command was executed.

| Source | Adopted | Not copied |
| --- | --- | --- |
| [Site Reliability Engineering, chapter 8: Release engineering](https://sre.google/sre-book/release-engineering/) | Traceable build inputs, small releases, retained artifacts, repeatable recovery | Dedicated release teams, bespoke infrastructure, mandatory release branches |
| [Site Reliability Workbook, chapter 16: Canarying releases](https://sre.google/workbook/canarying-releases/) | Observation, candidate/control comparison, stop criteria | Percentages without enough users or measured workout outcomes |
| [Software Engineering at Google, chapter 23: Continuous integration](https://abseil.io/resources/swe-book/html/ch23.html) | Separate continuous checks from release qualification; address version skew | Green unit suites as proof of physical-device UX |
| [Software Engineering at Google, chapter 24: Continuous delivery](https://abseil.io/resources/swe-book/html/ch24.html) | Small deliverable changes and staged process improvements | Microservices or enterprise staffing for one app |
| [Immich community upgrade guide](https://docs.immich.app/install/upgrading/) and [public mobile/backend compatibility release](https://github.com/immich-app/immich/discussions/6808) | Explicit breaking-change notes and client/server compatibility | Its upgrade/downgrade support model; this app needs old-client and delayed-outbox compatibility |
| Official Expo, Cloudflare and Supabase references linked above | Platform-specific artifact and recovery boundaries | Assuming a documented platform capability is already configured here |
