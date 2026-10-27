# Issue progress, October 22, 2026

Reviewed the 22 issues that were open against `master`
`5f349d2e7cc71d153df591d15b087ed99d82a7c2`. Closed five addressed source
issues and retained 17 with outstanding acceptance. All 22 are assigned to
`mateosauton` and organized in named GitHub Projects.

This triage changes tracking and workflow documentation. It does not deploy
migrations, modify hosted settings, publish native updates or submit to stores.
See [issue workflow](ISSUE_WORKFLOW.md) for labels, statuses and relationships.

## Addressed source

| Issue | Evidence and remaining release checks |
| --- | --- |
| [#3](https://github.com/mateosauton/personal-trainer/issues/3) | Account queues and replay use the authenticated owner, preserve pending sets and completion across A → B → A switching, and quarantine unowned legacy data. Addressed by #32 and later regression coverage. Exact installed-build switching remains a release check in #8. |
| [#9](https://github.com/mateosauton/personal-trainer/issues/9) | Merged #49 adds confirmed, atomic preference-and-plan rebuilds with preserved history, available equipment selection and compatible pre-workout swaps. Equipment and limitations remain enforced. Original source acceptance is complete; migration and installed-build release evidence remain in #8 and #39. |
| [#10](https://github.com/mateosauton/personal-trainer/issues/10) | Merged #49 documents and implements one stable home timezone for dashboard, calendar and streaks, with explicit historical fallback. Midnight, UTC-3 ↔ UTC+9 travel and backfill regressions pass. Original source acceptance is complete; migration and native rollout remain in #8 and #39. |
| [#33](https://github.com/mateosauton/personal-trainer/issues/33) | Merged #36 and #37 preserve explicit seconds through editing, durable drafts/journals, validated ordered writes, recovery and summaries. Timed work is excluded from repetition progression and tonnage. Mixed-set and crash/replay regressions pass. Remaining exact native timed-edit/outage/restart checks are consolidated in #8. |
| [#42](https://github.com/mateosauton/personal-trainer/issues/42) | Callback URL cleanup is merged in #49 above #47 PKCE protections. Authentication fields are removed after success or failure while route, ordinary query values and anchors remain. Recovery/expired-link/reload regressions pass. Hosted email callback verification remains in #8. |

## Remaining work

| Issue | Project status | Development branch | Current scope |
| --- | --- | --- | --- |
| [#4](https://github.com/mateosauton/personal-trainer/issues/4) | In Progress | [`codex/4-ordered-history-progression`](https://github.com/mateosauton/personal-trainer/tree/codex/4-ordered-history-progression) | Per-session idempotence is implemented. Remaining work is to recompute progression from ordered completed history when an older workout arrives after a newer receipt, plus independent-connection and exact-build acceptance. Coordinate with open recovery PR #61; do not duplicate its work. |
| [#5](https://github.com/mateosauton/personal-trainer/issues/5) | In Review | [`codex/5-workout-recovery`](https://github.com/mateosauton/personal-trainer/tree/codex/5-workout-recovery) | Queue/archive export and reviewed repair, durable resume, and provisional offline summaries are merged. Remaining acceptance covers malformed journal/workout-snapshot recovery, real cross-tab coordination and exact native outage/restart/conflict checks. Open PR #61 extends recovery; review and integrate it before follow-up development. |
| [#6](https://github.com/mateosauton/personal-trainer/issues/6) | Needs Verification | [`codex/6-verify-auth-recovery`](https://github.com/mateosauton/personal-trainer/tree/codex/6-verify-auth-recovery) | Recovery screens, retries and PKCE callbacks are merged. Complete live email delivery, expired-link handling and installed-native/HTTPS callback acceptance required by docs/AUTH_RECOVERY.md. The old localhost-only configuration report is historical; recheck current authorized settings. |
| [#7](https://github.com/mateosauton/personal-trainer/issues/7) | Blocked | [`codex/7-verify-privacy-controls`](https://github.com/mateosauton/personal-trainer/tree/codex/7-verify-privacy-controls) | Private-avatar policy/client, local-inclusive export and authenticated deletion source are merged. Remaining acceptance is hosted Auth/Storage/Edge Function deletion and revoked sessions, native export/photo delivery, and representative staging restore. Production migration/deployment is blocked by #39; independent source and verification preparation can continue. |
| [#8](https://github.com/mateosauton/personal-trainer/issues/8) | Blocked | [`codex/8-complete-release-gates`](https://github.com/mateosauton/personal-trainer/tree/codex/8-complete-release-gates) | Release remains blocked by #4, #5, #6, #7, #22 and #39. Complete current-candidate device/service evidence, Apple signing access, public links, store metadata/submission and rollback records. Closed source issues #3, #9, #10, #33 and #42 still require their account-switch, preferences/timezone migration, timed-edit/outage/restart and hosted callback checks here. Open PR #60 prepares environment/release safety; an open PR is not an applied configuration or completed release. |
| [#22](https://github.com/mateosauton/personal-trainer/issues/22) | Todo | [`codex/22-review-release-dependencies`](https://github.com/mateosauton/personal-trainer/tree/codex/22-review-release-dependencies) | Compatible dependency patches and exposure review are merged. Final-lockfile audit, malformed-link decoder risk resolution or explicit acceptance, upstream advisory decisions and native rebuild/regression evidence remain. Do not apply a forced SDK downgrade. |
| [#30](https://github.com/mateosauton/personal-trainer/issues/30) | In Review | [`codex/30-cross-device-workout-recovery`](https://github.com/mateosauton/personal-trainer/tree/codex/30-cross-device-workout-recovery) | Original measurement context is persisted, exported and deleted, but workout cursor, drafts and rest state remain device-local. Add server-backed cross-device restoration and explicit conflict behavior. Related to #5 and #7; broader cross-device support does not block current-device release #8. Open PR #61 addresses shared recovery prerequisites. |
| [#39](https://github.com/mateosauton/personal-trainer/issues/39) | Blocked | [`codex/39-reconcile-migration-history`](https://github.com/mateosauton/personal-trainer/tree/codex/39-reconcile-migration-history) | Checksum baseline and fresh/upgrade rehearsals are merged. Production version mappings and verification timestamp are still null. Requires authorized production history/schema evidence, representative restore, reconciliation and a linked dry run listing only pending migrations. Open PR #60 prepares environment safeguards; it does not supply production access or prove reconciliation. |
| [#50](https://github.com/mateosauton/personal-trainer/issues/50) | Todo | [`codex/50-small-phone-onboarding`](https://github.com/mateosauton/personal-trainer/tree/codex/50-small-phone-onboarding) | Keep open: the onboarding question area still does not scroll and compact-phone controls can overlap. Preserve all original acceptance criteria. Coordinate shared compact foundations with parent #59; this work can start independently. |
| [#51](https://github.com/mateosauton/personal-trainer/issues/51) | Todo | [`codex/51-measurement-unit-drafts`](https://github.com/mateosauton/personal-trainer/tree/codex/51-measurement-unit-drafts) | Keep open: onboarding can relabel a measurement without conversion, and Profile can replace unsaved measurement drafts on unit changes. Preserve identity/photo edits and existing historical workout calculations. Parent #59 coordinates compact presentation; this correctness fix can start independently. |
| [#52](https://github.com/mateosauton/personal-trainer/issues/52) | Todo | [`codex/52-accessible-controls`](https://github.com/mateosauton/personal-trainer/tree/codex/52-accessible-controls) | Keep open: faint text contrast, persistent field identification, and loading-button accessible name/busy state remain unresolved. Parent #59 owns compact foundations; compact controls must preserve accessible interaction bounds. |
| [#53](https://github.com/mateosauton/personal-trainer/issues/53) | Todo | [`codex/53-home-workout-action`](https://github.com/mateosauton/personal-trainer/tree/codex/53-home-workout-action) | Keep open: Start remains below the initial phone viewport and large workout detail sections. Saved-workout recovery must retain priority. Coordinate card styling with #57 under parent #59; neither task is blocked by the other. |
| [#54](https://github.com/mateosauton/personal-trainer/issues/54) | Todo | [`codex/54-reachable-rest-actions`](https://github.com/mateosauton/personal-trainer/tree/codex/54-reachable-rest-actions) | Keep open: rest advance actions remain at the bottom of scrolling corrections. Preserve absolute deadlines, pause/resume and manual advance. Coordinate footer and keyboard spacing with #55 under parent #59; no hard dependency is required. |
| [#55](https://github.com/mateosauton/personal-trainer/issues/55) | Todo | [`codex/55-keyboard-safe-set-entry`](https://github.com/mateosauton/personal-trainer/tree/codex/55-keyboard-safe-set-entry) | Keep open: zero-rep correction is clamped to one, direct value editing is absent and the suggested-load decimal keyboard lacks the existing Done affordance. Coordinate with #54 under parent #59 without changing persistence or sync contracts. |
| [#56](https://github.com/mateosauton/personal-trainer/issues/56) | Todo | [`codex/56-exercise-guide`](https://github.com/mateosauton/personal-trainer/tree/codex/56-exercise-guide) | Keep open: movement instructions disappear when an image exists and media has no shared on-demand guide/error fallback. Use the existing catalog and evaluate the existing sheet dependency. Parent #59 coordinates compact presentation. |
| [#57](https://github.com/mateosauton/personal-trainer/issues/57) | Todo | [`codex/57-plan-upcoming-training`](https://github.com/mateosauton/personal-trainer/tree/codex/57-plan-upcoming-training) | Keep open: the calendar still precedes the upcoming rotation, every card has its own Start/View controls, and history has no disclosure. Coordinate with #53 under parent #59. |
| [#59](https://github.com/mateosauton/personal-trainer/issues/59) | Todo | [`codex/59-compact-app-foundation`](https://github.com/mateosauton/personal-trainer/tree/codex/59-compact-app-foundation) | Keep open as the parent of #50–#57. Shared compact typography/components, visible-word baseline and at least 50% copy reduction evidence remain absent. Preserve every child issue's behavioral acceptance and accessible interaction bounds; the children can proceed independently. |

All prepared Development branches start at the reviewed master SHA above.
Their existence does not mean implementation has started. Update the branch
before work and integrate overlapping open PR #60 or #61 before continuing
related changes. Do not overwrite those candidates.

## Project boards

- [Personal Trainer: Reliability](https://github.com/users/mateosauton/projects/6)
  contains seven implementation and follow-up issues, including completed work.
- [Personal Trainer: Release & Privacy](https://github.com/users/mateosauton/projects/7)
  contains six primary service, release and security issues, plus four
  Reliability children added by GitHub's existing parent-project automation.
- [Personal Trainer: Mobile UX](https://github.com/users/mateosauton/projects/8)
  contains the compact-app parent and its eight independently scoped children.

The release issue [#8](https://github.com/mateosauton/personal-trainer/issues/8) retains exact-build and hosted checks for closed
implementation issues. Its unresolved blockers are [#4](https://github.com/mateosauton/personal-trainer/issues/4), [#5](https://github.com/mateosauton/personal-trainer/issues/5), [#6](https://github.com/mateosauton/personal-trainer/issues/6), [#7](https://github.com/mateosauton/personal-trainer/issues/7), [#22](https://github.com/mateosauton/personal-trainer/issues/22), [#39](https://github.com/mateosauton/personal-trainer/issues/39).
Privacy issue [#7](https://github.com/mateosauton/personal-trainer/issues/7) is blocked by [#39](https://github.com/mateosauton/personal-trainer/issues/39) for production deployment.
Cross-device recovery [#30](https://github.com/mateosauton/personal-trainer/issues/30) remains a follow-up and does not block
current-device release.

## Validation

Existing focused core tests passed in the audit: 11 suites, 194 tests across
account sync, callbacks, durable recovery, timed data, progression, training
preferences and calendar logic. Tested implementation and dependency paths
match the reviewed master tree. The disposable database harness passed all 13
migrations and five SQL regression files on fresh and baseline-upgrade paths,
including fixture preservation and schema parity.

These checks support source completion. They do not establish live email,
hosted Auth/Storage/Edge Function behavior, installed-native acceptance or
production migration history. Those checks remain explicit in the open issues
and [release gates](OPEN_RELEASE_GATES.md).
