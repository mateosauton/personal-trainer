# Git workflow and environments

This document explains how a workout change moves from an idea to reviewed
source code and then to an environment. It recommends a lightweight workflow
for this personal project. Git records the source; the release process decides
when that source reaches browsers and phones.

The product test for every change is concrete: can someone enter their gym
equipment and preferences, receive a suitable plan, and complete a workout on
a phone without unnecessary decisions or lost progress?

## Contents

- [1. What exists, and what is proposed](#1-what-exists-and-what-is-proposed)
- [2. Environment means three different things](#2-environment-means-three-different-things)
- [3. Classify work before branching](#3-classify-work-before-branching)
- [4. Start safely and make a focused change](#4-start-safely-and-make-a-focused-change)
- [5. Verify the subsystem that changed](#5-verify-the-subsystem-that-changed)
- [6. Review and merge without losing the context](#6-review-and-merge-without-losing-the-context)
- [7. Coordinate database and infrastructure changes](#7-coordinate-database-and-infrastructure-changes)
- [8. Hotfixes, rollback, and cleanup](#8-hotfixes-rollback-and-cleanup)
- [9. Improvements to apply in order](#9-improvements-to-apply-in-order)

## 1. What exists, and what is proposed

Verified on 2026-10-22 against the checkout and connected GitHub API:

| Area | Observed state | Recommended policy |
| --- | --- | --- |
| Integration branch | Current remote `master` is `5f349d2e7cc71d153df591d15b087ed99d82a7c2`. | Keep `master` releasable. Use short `codex/<issue-number>-<slug>` branches and PRs. |
| Work in progress | PR #49 is merged. Open PRs #60 and #61 prepare environment safety and recovery changes. | Check those candidates before starting overlapping work. Prepared issue branches alone do not mean implementation has started. |
| Merge enforcement | GitHub reports `protected: false`, required checks off, and no rulesets. The detailed protection endpoint returns 403 for this connector. | Configure and verify an enforced PR/check rule. |
| Native publication | Remote `master` contains `checks.yml`, with manual publication after checks and a tested SHA, build ID, and platform. | Follow the device checklist and publish only the verified platform. A source merge is separate from native publication. |
| Hosted web | Repository configuration builds Cloudflare assets; the release notes describe `master` as its production trigger. | Recheck hosted trigger settings before changing release behavior. Git cannot prove those settings. |

The [merged CI/CD workflow](../.github/workflows/checks.yml) checks PRs and
`master`; its native publisher requires an explicit manual dispatch. PR #49
merged the consolidated workflow and source improvements. GitHub still reports
`master` as unprotected, so check enforcement remains unfinished.

Merged source now includes editable
training preferences and pre-workout swaps, private avatars and account
deletion, immutable session calculation context, home-timezone handling, and
migration-baseline tooling. Their source merge does not establish hosted
configuration or installed-device behavior. Follow
[open release gates](OPEN_RELEASE_GATES.md) before shipping a candidate.

Use one integration branch for now. A permanent `develop` branch would add a
second integration step without solving database isolation. Pro Git explains
both long-running stability branches and focused topic branches; this project
needs the latter at its present scale.
[Source: Pro Git, Branching Workflows](https://git-scm.com/book/en/v2/Git-Branching-Branching-Workflows).

## 2. Environment means three different things

A branch is a source-code reference. An app environment selects configuration
and update delivery. A backend environment owns authentication, data, and
storage. Naming all three `preview` does not connect them automatically.

| Layer | Current mechanism | What it separates |
| --- | --- | --- |
| Source | `master`, issue-linked `codex/...` branches, commit SHA | File versions and review history. A branch creates no database. |
| Local app | Expo/Metro on the developer's machine | App code and local configuration. Its Supabase URL can still target real data. |
| EAS configuration | `development`, `preview`, `production` variable sets | Build/update values. Isolation depends on the URLs and keys assigned. |
| Native delivery | Build profiles and update channels in `eas.json` | Who can install a build and which updates it requests. An EAS channel is distinct from a Git branch. |
| Cloudflare | Production deployment and preview versions | Web assets and URLs. Separate URLs may call the same backend. |
| Supabase | Project URL, publishable key, Auth, Postgres, Storage | The actual account and data boundary. |

`eas.json` currently defines these profiles:

- `development`: internal development client, EAS development variables.
- `preview`: internal distribution, EAS preview variables, preview channel.
- `production`: production variables and channel, remote build increment.
- `release-test`: inherits production variables, uses internal distribution
  and the separate release-test channel. It can access production data
  despite its test name.

Keep this distinction explicit when requesting a build or testing a PR.
[Sources: EAS environment configuration](https://docs.expo.dev/eas/environment-variables/)
and [Expo update delivery concepts](https://docs.expo.dev/eas-update/deployment/).

### Proposed data layout

Start with two persistent Supabase projects, development and production.
Use synthetic test accounts in development; keep real workout history in
production. Point EAS development/preview and Cloudflare previews at
development. Point production builds, production web assets, and deliberate
release-test builds at production. Record each project's identifier, schema
migration head, Auth redirects, and Storage setup in an environment inventory
without credentials.

This proposal does not establish that two projects already exist. Inspect the
configured project URLs first, then prepare development through the authorized
Supabase connection. Avoid copying production users or personal data. Consider
a per-PR database later if simultaneous schema changes collide. A shared
development backend and named test accounts are sufficient initially.
Supabase's environment guide demonstrates independent databases and migration
promotion. We adopt that separation without its extra Git branch.
[Source: Supabase managing environments](https://supabase.com/docs/guides/deployment/managing-environments).

Until separation exists, treat any preview using the production URL as a
production client. Use a designated test account and avoid destructive test
flows. A preview hostname does not make a migration safe for real users.

### Local configuration

Use Node 22, `npm ci`, and the committed lockfile. `npm run env:pull` retrieves
development configuration into `.env.local`; the preview and production
variants replace the same file. Keep local overrides in
`.env.development.local`, which has higher priority during development.
After switching targets, restart Expo and verify the intended project URL.

Every `EXPO_PUBLIC_*` value enters the app bundle. Use publishable Supabase
keys, never service-role credentials. Do not commit actual environment files.
For deterministic mock runs or hosted exports, `EXPO_NO_DOTENV=1` prevents
local files from overriding explicitly supplied build values.
[Source: Expo environment variables](https://docs.expo.dev/guides/environment-variables/).

### Source-only database setup and integration targets

The new [Supabase configuration](../supabase/config.toml) names the local project
`office-gym-trainer` and declares the `delete-account` Edge Function entrypoint
with platform JWT verification enabled. That local project name does not select
a hosted backend, create development infrastructure, or prove a complete local
Supabase stack was started successfully. The deletion handler needs server-side
credentials in its function environment; those never belong in an app env file.

For repository-only database verification, `npm ci` installs PGlite and
`npm run test:db` creates disposable databases. It needs no hosted Supabase
credentials. For integration with real Auth, Storage, OAuth callbacks and Edge
Functions, use the intended managed development project through the existing
authorized connection, or separately verify local service startup and seed
setup. Pulling EAS variables configures the app client, not those services.

The [baseline manifest](../supabase/migration-baseline.json) pins nine historical
source migrations. Its production version mappings and verification timestamp
are still null. `npm run migrations:check` checks source hashes only. An ordinary
linked `supabase db push` is not an approved next step until the history mapping,
restore rehearsal and dry run in [migration baseline](MIGRATION_BASELINE.md) are
complete. Keep local fixtures, development data and production history distinct.

## 3. Classify work before branching

Use an issue for user-visible work, uncertain bugs, migrations, or a change
needing a decision. An isolated documentation correction can use the PR itself.
Keep an issue to the problem, acceptance criteria, affected subsystems, and
verification. Link relevant [technical decisions](TECHNICAL_DECISIONS.md).

Follow [issue workflow](ISSUE_WORKFLOW.md) for managed labels, assignment,
named GitHub Projects, status, parent/dependency relationships and Development
linked branches. Keep that policy and [.github/labels.json](../.github/labels.json)
in sync when changing classification. Record remaining release checks in #8
before closing an addressed implementation issue.

| Type | Example in this app | What makes it complete |
| --- | --- | --- |
| Bug | A plan rebuild assigns a machine excluded in onboarding. | Reproduce with a saved profile, correct selection, and verify new and rebuilt plans. |
| Feature | A user can exclude disliked exercises and request a suitable replacement. | Define persistence, allowed alternatives, unavailable-equipment behavior, and the phone interaction. |
| Chore | Upgrade an Expo dependency or consolidate CI jobs. | Preserve behavior, update the lockfile when needed, and check runtime/build consequences. |
| Hotfix | Logging a set loses its weight after a failed connection. | Contain the live failure, fix the smallest responsible path, and verify replay and ownership. |

These are examples of work classification, not a list of unfixed production
bugs. The local `TrainingPreferences` component now edits goal, experience,
schedule, available equipment and limitations. `ExerciseSwap` offers compatible
alternatives before starting a workout. Their candidate SQL commits profile
preferences and the rebuilt plan together, and rejects swaps during an active
session. Persistent named exercise likes/dislikes remain a separate proposal;
the training-preference type does not currently store those lists.

A bug restores an existing contract. A feature changes it. A chore changes
maintenance or operation while preserving the user contract. If a chore changes
a backend boundary or deployment strategy, it still needs a technical decision.
Prefixes do not determine risk.

For a bug, record expected versus actual behavior, platform/build or deployment
ID, reproduction steps, network state, and the first failing layer. Exclude
tokens and personal health details. Prioritize wrong-account access, lost
sets, unavailable-equipment assignments, and blocked workouts ahead of
cosmetic changes. Reproduce on current `master` when possible so an
uncommitted local change does not become a false production report.

## 4. Start safely and make a focused change

First inspect the checkout:

```sh
git status --short
git branch --show-current
git worktree list
git fetch origin --prune
```

If it is clean and suitable for the new task:

```sh
git switch -c codex/123-respect-gym-equipment origin/master
npm ci
```

If another change is in progress, leave it in place and use a separate
worktree. In Codex, prefer the managed worktree tool. The manual equivalent is:

```sh
git worktree add -b codex/123-respect-gym-equipment ../personal-trainer-equipment origin/master
cd ../personal-trainer-equipment
npm ci
```

A worktree has independent working files while sharing repository history.
Ignored environment files and installed dependencies are not copied. Configure
its intended development environment explicitly; do not copy credentials by
default. No `reset --hard`, forced checkout, or automatic stash is part of
this workflow.
[Source: Git worktree documentation](https://git-scm.com/docs/git-worktree).

Make one coherent improvement per PR. It can span frontend, queries,
migration, and tests when those implement one usable behavior. Keep unrelated
formatting or dependency cleanup separate. Stage exact paths and review them:

```sh
git diff
git add lib/plan/generate.ts __tests__/office-gym-plan.test.ts
git diff --cached
git commit -m "respect gym equipment"
```

These paths illustrate a planner change; stage the files actually changed.
Use short imperative commit and PR messages. Do not impose an elaborate
commit taxonomy on this personal repository.

For the proposed persistent exercise-exclusion feature, merge useful increments:
preserve excluded IDs with safe defaults, filter new plans, then add the phone
controls. Build on the merged training-preference and pre-workout-swap implementations
instead of implementing them twice. A mid-workout replacement needs a separate
decision about existing snapshots and set identities. Each increment must
preserve existing users and saved plans. If an incomplete feature needs a flag,
propose and document that flag. The repository has no general feature rollout
system to assume. Google's review guide explains why self-contained changes
are easier to assess and revert.
[Source: Small CLs](https://google.github.io/eng-practices/review/developer/small-cls.html).

## 5. Verify the subsystem that changed

Run the same basic commands as CI before requesting merge:

```sh
npm run check:web
EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 EXPO_PUBLIC_SUPABASE_KEY=mock npm run build:web
git diff --check
```

`check:web` runs TypeScript and unit/database suites. The current `test:db`
chain includes historical ownership/progression/ordering checks,
`test:migrations`, and `test-database.cjs`. The last checks both a fresh schema
and an upgrade from the pinned nine-file baseline with existing account,
plan, timed-set and receipt fixtures. It compares resulting columns, functions,
grants, constraints, policies, indexes and RLS flags, and runs SQL regressions.
These are local test definitions, not a claim that every current check passes.
The web export checks bundling with fixture settings; it does not authenticate
against a backend. Use the [architecture subsystem map](ARCHITECTURE.md) to trace
the changed code, then select additional evidence:

| Changed area | Relevant evidence |
| --- | --- |
| Planner/catalog | Equipment exclusions, limitations, stable exercise IDs, generation/rebuild behavior, and no valid candidate. |
| Workout writes | Unit checks plus `npm run test:db`; retry, out-of-order writes, resume, and two-account isolation. |
| SQL/RPC/RLS | `npm run migrations:check`, `npm run test:migrations`, fresh-schema/baseline-upgrade behavior, old client payloads, and ownership denial. Hosted Auth/REST/Storage checks remain separate. |
| Preferences/swaps | Atomic profile/plan save, stale preference or exercise rejection, unavailable alternatives, active-session swap rejection, and preserved history. |
| Session context/calendar | Immutable captured units/bodyweight, explicit unknown historical context, home timezone across midnight/travel, and old-client defaults. `node scripts/test-session-context.cjs` is an additional local harness, not currently in `test:db`. |
| Privacy/account deletion | Private-avatar access and old URL handling; function deployment/JWT behavior; token-bound deletion and storage cleanup. Handler unit tests do not verify the hosted function. |
| UI/navigation | Narrow phone layout, keyboard, one-handed actions, loading/error states, back navigation, and the changed workout flow. |
| Auth | Sign-in/out, confirmation/recovery callbacks, existing/new account routing, and the affected native platform. |
| Native dependency/config | A compatible new binary on the affected platform; browser tests cannot establish native compatibility. |
| CI/hosting | Triggers, target refs, public variables, credential exposure, build output, and rollback path. |

The repository has `tools/dev/mock-supabase.mjs` and `tools/dev/drive.mjs` for
repeatable UI flows. The driver currently hardcodes a Linux Chromium path;
configure a locally available browser before using it on this Mac. The mock's
`/__state` helps confirm a plan or set reached it, but cannot prove real
authentication, row policies, or mobile gestures. PGlite checks local database
behavior, not hosted service configuration. Report those boundaries in the
PR. Expo's contributor guide provides the model of targeted
regression tests plus platform evidence; adapt that practice to this app.
[Source: Expo contributing guide](https://github.com/expo/expo/blob/main/CONTRIBUTING.md).

## 6. Review and merge without losing the context

Push the topic branch and open a PR into `master`. Use the repository's
[Summary and Testing template](../.github/pull_request_template.md). Keep the
body short; link the issue, decision, migration order, and release record
instead of copying the design document. Explain the effect, such as
"Rebuilding preserves the user's equipment exclusions."

A solo owner can self-review. Read the final diff, inspect CI for the latest
commit, and compare phone behavior with acceptance criteria. Seek independent
review for account isolation, write ordering, destructive schema changes, or
uncertain native compatibility. A second human approval is not required by
this proposal.

If `master` advances, update a shared branch without rewriting its history:

```sh
git fetch origin --prune
git merge origin/master
```

Understand both behaviors before resolving conflicts, stage resolved files,
and finish the merge. If the merge is unsafe, `git merge --abort` returns to
the pre-merge state. Rerun affected checks. Never resolve migration conflicts
by renaming already-applied migrations or discarding another change's SQL.
Rebase is optional for a private branch before sharing; avoid force pushes
as the normal collaboration path.

Continue the repository's merge-commit convention. Record the resulting
`master` SHA for release verification. Close the issue after checking its
acceptance criteria and record a pending release when delivery follows merge.
GitHub flow supplies the branch/PR/merge pattern used here.
[Source: GitHub flow](https://docs.github.com/en/get-started/using-github/github-flow).

## 7. Coordinate database and infrastructure changes

Git merges source atomically. It does not deploy Postgres, OAuth settings,
web assets, and installed phone binaries atomically. Old phones can keep
running after new web code ships.

For a proposed persisted exercise exclusion:

1. Add an optional field or owned table with a compatible default. Preserve
   existing RPC signatures and permissions.
2. Verify the migration on development with an existing account and old client
   payloads. Add ownership checks for the new data.
3. Deliberately apply the additive production migration and record its ID.
4. Release code that tolerates missing preferences and writes the new value.
5. Remove obsolete structures only in a later decision after determining
   which old builds still depend on them.

Append migrations after the baseline boundary; never edit one already applied
remotely. The manifest checks historical source bytes, but cannot establish
which versions production recorded. Its read-only planner refuses an upgrade
plan while mappings are null, or if remote history contains unknown versions.
It does not repair history or change a database. Follow
[migration reconciliation](MIGRATION_BASELINE.md) before any linked migration
release. A reverted client must remain safe against the expanded schema.
Detailed deployment and recovery steps belong in [releases](RELEASES.md).

Treat Auth redirect allowlists, Storage policies, EAS variables/channels, and
Cloudflare triggers as changes too. Record the setting, environment, previous
value without secrets, desired value, verifier, and recovery step in the issue
or release record. A dashboard edit with no linked record is unreviewed
infrastructure state.

## 8. Hotfixes, rollback, and cleanup

For a live regression, identify the affected deployment/update and source
SHA. If current `master` is releasable, branch from freshly fetched
`origin/master`, reproduce, fix, and run normal PR checks. Pause unrelated
merges while preparing an urgent release.

If `master` contains unrelated unreleased work, first roll back the affected
deployment when safe, then correct or revert the blocking work through `master`.
The local native dispatcher only publishes current master. It cannot publish
a patch branched from an older shipped SHA. That option requires a separately
reviewed immutable-candidate publication gate before use, with the fix also
integrated into `master`. Do not treat a historical release branch as an
existing bypass. Follow [release recovery](RELEASES.md#10-incident-rollback-and-hotfix).

Rollback restores a deployed artifact. Revert adds source history undoing a
change so the next deployment does not reintroduce it. Neither undoes database
writes or migrations. GitHub's Revert action can prepare a reversal PR;
review dependencies and schema compatibility before merging. Follow the
platform recovery instructions in [releases](RELEASES.md).

After verification, delete the merged remote branch. Remove a clean manual
worktree with `git worktree remove` or archive a managed worktree through
Codex. Preserve unmerged work and needed local files first.

## 9. Improvements to apply in order

| Priority | Change | Done when |
| --- | --- | --- |
| Complete | Consolidated CI/native-publication changes merged in #49. | Remote workflow checks PRs and requires explicit publication with commit/build/platform evidence. |
| First | Enforce PRs and `Core and security checks` on `master`. | An unchecked test PR cannot merge; the rule applies to the owner and prevents force pushes/deletion. |
| First | Reconcile the pinned source baseline with production migration history. | Verified version mappings, a representative restore rehearsal and a linked dry run list only intended additions. Source checksums alone do not close this gate. |
| Next | Establish development Supabase and map all targets. | Preview accounts/data are separate; Auth, Storage, and migration checks pass there. |
| Next | Record source SHA, backend migration head, and platform IDs per release. | A phone bug can be traced to its runtime and data contract. |
| Later | Automate onboarding and completed-session mobile smoke flows. | CI reproduces those flows; physical-device evidence remains explicit. |

Consolidation has merged and GitHub has run the replacement workflow. Configure
the required check and verify
enforcement instead of equating a saved rule with a working gate. Require PRs,
current passing checks, and resolved conversations. Keep required approvals
at zero for solo work. GitHub documents checks, administrator bypass, and plan
availability; verify actual account eligibility when applying the setting.
[Source: protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches).
