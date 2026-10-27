# Issue workflow

Use this policy with [Git workflow](GIT_WORKFLOW.md) and
[open release gates](OPEN_RELEASE_GATES.md). Keep issue and PR messages concise.

## Triage and ownership

Assign current project issues to `mateosauton`. Give every issue one type label:
`bug`, `enhancement`, or `chore`. Use `bug` with `release-blocker` for a hotfix.
An umbrella issue can also use `epic`.

Choose one priority, `priority:p1` or `priority:p2`, and the affected `area:*`
labels. Add `security` or `accessibility` when the acceptance criteria cover
those concerns. Use `release-blocker` only for a documented production gate.
Issue #30 remains follow-up work, not a release blocker.

[.github/labels.json](../.github/labels.json) defines the managed label names,
colors and descriptions. Update it before introducing a label, then reconcile
GitHub labels manually. Preserve unrelated existing labels. This manifest does
not install a label sync action or publish app updates.

## Projects and status

Use these existing GitHub Projects. Keep their names consistent with this table.

| Project | Issues |
| --- | --- |
| #6 Personal Trainer: Reliability | #3, #4, #5, #9, #10, #30, #33 |
| #7 Personal Trainer: Release & Privacy | #6, #7, #8, #22, #39, #42 |
| #8 Personal Trainer: Mobile UX | #50 through #57, #59 |

These are primary project assignments. Existing GitHub project automation also
adds sub-issues to their parent's board. The release board therefore includes
#3, #4, #5 and #33 from Reliability, for ten items in total. Keep a mirrored
issue's status aligned across boards. The existing Done/close automation remains
enabled, so check acceptance before moving an item to Done.

Use project status for execution state rather than adding status labels.

| Status | Meaning |
| --- | --- |
| Todo | Scoped and unstarted, including issues with a prepared branch |
| In Progress | Implementation is actively underway |
| Blocked | A recorded dependency or required external action prevents progress |
| In Review | A concrete PR is awaiting review or merge |
| Needs Verification | Implementation exists and required acceptance checks remain |
| Done | Issue closed after its scoped acceptance criteria are addressed |

Add `needs-verification` while required evidence remains. Record the candidate
SHA, environment, check performed and result. A passing source check does not
prove hosted configuration or an installed native flow. Use focused checks for
the changed behavior; this triage policy adds no blanket UX test requirement.

## Relationships

Use GitHub parent/sub-issue relationships for scope and blocked-by relationships
only for work that must finish first. Link related work without inventing a
dependency. Keep the issue body and GitHub relationship consistent.

- #59 owns the compact app foundation and copy target, with #50 through #57 as
  children. Each child retains its behavioral acceptance criteria.
- #8 coordinates release readiness, with #3, #4, #5, #6, #7, #22, #33, #39 and
  #42 as children. Completed children remain linked as implementation evidence.
- #8 is blocked by #4, #5, #6, #7, #22 and #39.
- #7 is blocked by #39 for hosted privacy and environment verification.
- Home/Plan work in #53 and #57, and rest/set-entry work in #54 and #55, must
  coordinate shared controls. These pairs have no hard dependency.

## Branches and review

Create one GitHub Development linked branch per open issue using
`codex/<issue-number>-<short-slug>`. Branches are prepared from `master`; their
existence alone does not mean work has started. The October 22, 2026 triage
baseline is `5f349d2`.

Before implementation, fetch `origin/master` and update the branch to current
master. Finish and merge an overlapping prerequisite before building its
follow-up. PR #61 owns recovery work and PR #60 owns environment setup. Preserve
their changes when continuing related issues.

Open focused PRs into `master`, link the issue and follow the existing Summary
and Testing template. Keep commits and PR messages short. Merge source changes
separately from production publication; use the existing release process.

## Closing issues

Compare each acceptance criterion with merged source and recorded evidence.
Close only the addressed scope. If installed-device or hosted-release checks
belong to a release gate, list the remaining checks in #8 and link both issues
before closing the implementation issue. Do not describe deferred checks as
passed.

The October 22 triage closes #3, #9, #10, #33 and #42 for implemented source
changes, with remaining device and hosted checks tracked in #8. Issue #6 stays
open with `needs-verification` because password recovery requires the complete
email, callback, new-password and sign-in flow. Issues #50 through #57 and #59
remain open; compact styling alone does not fulfill their behavioral criteria.
