# Engineering review and next work

This is the initial issue summary. The detailed researched proposals and
implementation stages now live in [architecture](ARCHITECTURE.md),
[technical decisions](TECHNICAL_DECISIONS.md), [Git workflow](GIT_WORKFLOW.md),
and [releases](RELEASES.md).

Reviewed on 2026-10-22 against this checkout. These changes are local until
reviewed and merged. Existing authentication edits are outside this work.

## Product goal

Help someone open the app, get a suitable plan, and train with little phone
interaction. Use only confirmed gym equipment. Respect their experience,
limitations, exercise preferences, available time, and recorded performance.
Show the movement, target, load, and next action when they need them.

The confirmed inventory is barbell, dumbbells, plates, kettlebells, flat/incline
benches, squat rack, pull-up bar, parallel bars, seated resistance row, and
lat-pulldown machine. The [authored routine](timed-gym-routine.md) records it.
An equipment category such as `machine` does not establish that a leg press,
Smith machine, or treadmill exists.

## Initial findings and local candidate solutions

| Area | Confirmed problem | Solution / status |
| --- | --- | --- |
| Git | No short contribution path or PR template; GitHub reports unprotected `master`. | Add [workflow guide](GIT_WORKFLOW.md) and concise PR template. Repository protection remains a proposed GitHub setting. |
| Releases | The original workflow publishes native updates after merging, although its release guide requires device verification. | The local replacement requires an explicit tested commit, build, and platform. Remote master still has its original publisher until consolidation merges. See [releases](RELEASES.md). |
| Decisions | Reasons are scattered across large historical notes and dated plans. | Add a [current decision register](TECHNICAL_DECISIONS.md), a short record format, and links from historical notes. |
| Architecture | Onboarding assumes all equipment exists; rebuilding overwrites saved equipment. | Constrain app-generated plans to reviewed gym exercises and preserve saved equipment restrictions. See [architecture](ARCHITECTURE.md) and its regression tests. Existing plans need an explicit rebuild. |

## Next product work, in order

Further local candidates now add constrained PPL adaptation, editable core
training inputs, pre-workout swaps, privacy controls and immutable session
calculation context. Their presence is not device or production verification.
Review the detailed guides and [release gates](OPEN_RELEASE_GATES.md) before
extending or publishing them.

1. **Extend preferences with exercise choices.** Verify the existing goal,
   time, experience, equipment and limitation editor first. Add preferred and
   excluded exercise-ID persistence and ranking. Pass when reload/rebuild keeps
   exclusions and cannot introduce unavailable equipment.
2. **Verify swaps before extending their scope.** The current candidate swaps
   active-plan items before a workout and rejects unfinished sessions. Verify
   stale state, empty alternatives and retained history. An in-session swap
   needs a separate item/snapshot decision before implementation.
3. **Personalize from useful evidence.** Bodyweight currently contributes to
   effective load for bodyweight exercises; height is stored. Neither provides
   a complete body-specific prescription. Use actual load/reps history,
   limitations, and user feedback before adding new body measurements. Keep
   first-session loads user-confirmed and editable.
4. **Validate the phone journey.** Keep optional profile work out of the critical
   path. Test one-handed set logging, large text, keyboard dismissal, background
   timers, offline completion, restart/resume, and sync recovery on installed
   iOS and Android builds. Measure time to first workout and actions per logged
   set before claiming the experience is smoother.

These are scoped proposals, not shipped features. The fixes in this review
establish constraints and release discipline. Present local candidates need
service/device validation; favorite/exclusion ranking and in-session swaps
remain design and implementation work.

## Earlier snapshot verification

`npm run check:web` passed TypeScript, 358 unit tests, and the disposable
database checks. The mock-configured web export and `npm run docs:verify`
passed before the later shared-checkout additions. Workflow validation exercised
dispatch conditions, invalid verification records, and superseded commits.
Those results do not validate the full expanded candidate. This documentation
pass checks source references and guide links. No phone flow or live release
was run here.
