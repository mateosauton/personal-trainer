# Open issue implementation progress

Reviewed all 13 open GitHub issues on October 22, 2026. Three subagents worked
in parallel on workout recovery, preferences/timezones, and release tooling.
Auth and privacy work was integrated alongside them. Existing uncommitted
work was preserved. These changes are local and have not been released.

| Issue | Source work and remaining acceptance |
| --- | --- |
| [#3](https://github.com/mateosauton/personal-trainer/issues/3) Account queues | Existing owner-scoped queues and frozen replay tokens are retained. Expanded account-switch regression includes both a pending set and completion. Unowned global legacy data remains quarantined. Installed native switching remains a release check. |
| [#4](https://github.com/mateosauton/personal-trainer/issues/4) Progression | Existing receipt, stale-baseline and snapshot guards remain covered by the database suite. Full ordered-history recomputation when an earlier workout arrives after a later summary is still open, as are independent-connection concurrency and exact native acceptance. |
| [#5](https://github.com/mateosauton/personal-trainer/issues/5) Recovery | Added raw local export, reviewed queue/archive repair with byte-exact backups, and provisional offline summaries. Authoritative records and next loads wait for server confirmation. Invalid journals/workout snapshots can be exported but are not automatically repaired. Real cross-tab and native outage/restart verification remain open. |
| [#6](https://github.com/mateosauton/personal-trainer/issues/6) Auth recovery | Existing recovery screens and retry controls retained. Callback cleanup now preserves unrelated URL state on success and failure. Live email delivery and exact production/native redirect verification remain open. |
| [#7](https://github.com/mateosauton/personal-trainer/issues/7) Privacy | Added private photo policy/client access, account export including local archives, and authenticated account deletion source. Owner/anonymous storage rules pass disposable database tests. Hosted function/storage/deletion, backup/restore and native delivery remain open. See [privacy controls](PRIVACY_CONTROLS.md). |
| [#8](https://github.com/mateosauton/personal-trainer/issues/8) Release | Added current [release gates](OPEN_RELEASE_GATES.md), migration rehearsals and dependency evidence. Apple signing, exact candidate devices, public links and store submission remain open. |
| [#9](https://github.com/mateosauton/personal-trainer/issues/9) Editable plans | Added training preferences saved atomically with their regenerated plan, equipment selection, and compatible swaps before starting a workout. Swaps preserve pattern, duration/reps mode and per-side convention; both generated and PPL plans enforce equipment, experience and limitations. Changing an exercise during an active workout remains unsupported. |
| [#10](https://github.com/mateosauton/personal-trainer/issues/10) Timezones | Added one home timezone for calendar, streak and dashboard reads. Onboarding captures it; existing users use a valid recorded zone or explicit UTC fallback. Historical local_day values are preserved. Midnight, travel and backfill tests cover the shared date logic. |
| [#22](https://github.com/mateosauton/personal-trainer/issues/22) Advisories | Applied compatible transitive patches. Full audit changed from 59 to 56 affected packages, with 51 high, 5 moderate and no critical findings. Upstream advisories and native rebuild acceptance remain open. See [dependency review](DEPENDENCY_REVIEW.md). |
| [#30](https://github.com/mateosauton/personal-trainer/issues/30) Other devices | New sessions preserve immutable original units/bodyweight for resume and summaries, which export and deletion include. Historical unknown values remain unknown. Cross-device cursor/draft restoration, conflict handling, and dashboard history totals using each session's original bodyweight are still open. |
| [#33](https://github.com/mateosauton/personal-trainer/issues/33) Timed sets | Existing seconds persistence remains covered, including the new provisional summary. Timed work stays outside rep progression and tonnage. Exact native timed-edit/outage/restart acceptance remains open. |
| [#39](https://github.com/mateosauton/personal-trainer/issues/39) Migrations | Added checksum-pinned deployed-source baseline, conservative read-only planning and fresh/upgrade rehearsals. The connected account cannot access this production project. Real timestamp mappings, hosted schema comparison and linked dry run remain open. The planner refuses unverified mappings. |
| [#42](https://github.com/mateosauton/personal-trainer/issues/42) Callback URL | Auth parameters are removed without dropping route, ordinary anchors or other parameters. Regression tests cover PKCE, rejected implicit links, expired recovery links and reload. Hosted browser acceptance remains open. |

No GitHub issues were closed. A passing source check does not satisfy the
remaining service, device or store requirements.

## Validation

Run `npm run check:web` for TypeScript, core tests and disposable database
checks. The database suite exercises fresh setup, upgrade preservation, owner
isolation, progression, ordered writes, calculation context, export, private
photos and preference/timezone policies. `npm run migrations:check` validates
the nine deployed-source checksums. `npm run docs:verify` checks documentation
invariants. A web export with mock public settings verifies bundle generation.
The deletion Edge Function still requires a real runtime/service check.
