# Open release gates, October 22, 2026

This document tracks the unfinished work in
[#8](https://github.com/mateosauton/personal-trainer/issues/8),
[#22](https://github.com/mateosauton/personal-trainer/issues/22) and
[#39](https://github.com/mateosauton/personal-trainer/issues/39).
Current source changes are local. No native build, hosted migration, store
submission or production publication was performed while addressing these issues.

## Evidence already recorded

The [October 8 release record](https://github.com/mateosauton/personal-trainer/issues/8#issuecomment-6054840371)
ties the prior production rollout to commit
`4561c538ca2bf8d6be36098faadfed2daabae494`, production database backup and
migrations, Android update group `9be73329-c170-4b29-9e6e-4f25f155b0e1`, and
iOS update group `c24388b4-2496-4c67-8b24-d312072b1e45`.
The [artifact follow-up](https://github.com/mateosauton/personal-trainer/issues/8#issuecomment-6055019604)
records production Android build `35969bbd-5eec-492f-8f9a-1be476507856`,
release-test build `b329a315-2838-4278-b55b-e28d13696db6`, and release-test update
group `de8b631d-748c-4bfb-a7ea-a1b23e7956aa`.

Those are historical issue records. They do not verify the current channel
routing, this working tree, a current native binary or store availability.

## Remaining gates

| Gate | Required evidence before completion |
| --- | --- |
| iOS build access | An Apple team Account Holder/Admin resolves the distribution-certificate membership-resource 403 or supplies signing access through EAS. Then produce a fresh iOS binary and complete device verification. Existing Expo Go startup evidence does not satisfy this gate. |
| Exact-candidate device flows | Record clean SHA, EAS build, platform, runtime and backend. Test signup/confirmation/recovery, onboarding, full workout, timed edit during outage, process restart, replay exactly once, completion summary, export destination, and account B-to-A history isolation. Cover web, Android and iOS; preserve separate results for each. |
| Migration release | Verify production history mappings, rehearse current-production-schema upgrade, and save a linked dry run listing only intended pending files. See [migration baseline](MIGRATION_BASELINE.md). |
| Dependency review | Record the final-lockfile audit and native rebuild/regression results. Resolve or explicitly review remaining advisories, especially malformed-link decoding. See [dependency review](DEPENDENCY_REVIEW.md). |
| Public web and links | Fetch the public host and direct auth/session paths without an authenticated dashboard session. A redirect to provider SSO is not application availability. Test callback confirmation and recovery with dedicated accounts. |
| Store metadata | Record actual support/privacy URLs, contact owner, app metadata, screenshots, account/data disclosures and submission IDs. Verify URLs are public. Publishing source pages alone does not establish store approval. |
| Recovery | Save previous compatible per-platform update IDs, runtime fingerprints, Worker version, database backup ID and restore evidence before publication. Rehearse recovery against those exact artifacts. |

Automatic [CI checks](CI.md) include fresh-schema and baseline-upgrade
rehearsals; they do not publish native updates. The separate **Promote tested
native update** workflow requires the current full `master` SHA, one platform,
the exact tested candidate group, release-test build, intended installed
production build, phone-test attestation and evidence link. It fetches actual
EAS build/group metadata, checks environment/backend and fingerprint
compatibility, and promotes that existing group without regenerating its bundle.

The operator still supplies the phone-test results and identifies the actual
installed production cohort. CI does not observe the phone or close the device,
signing, migration, dependency, store or recovery gates above. Follow
[release safety](RELEASE_SAFETY.md) for the supported candidate/promotion path,
receipts and recovery. The legacy hourly URL probe and alternate automatic
publishers have been removed.

## Candidate record to complete

Copy this record for the next release. Fill every applicable field with the
actual evidence; an older successful workout does not validate a new candidate.

```text
Clean source SHA / CI run:
Backend ref / migration history capture / dry-run output:
Backup ID / restore rehearsal:
Android build / version code / runtime / device-flow evidence:
iOS build / build number / runtime / device-flow evidence:
EAS channel routing / per-platform update IDs:
Web version / public host / direct-link checks:
Lockfile hash / audit JSON / remaining-risk decision:
Public support URL / privacy URL / metadata record:
Store submission IDs / status:
Prior compatible update IDs / prior Worker version:
Recovery operator / procedure / verification:
```

For OTA recovery, select a previously verified update for the same platform
and native runtime, then cold-start a matching installed build and verify
the delivered update plus account/workout data. A native module change needs
a compatible binary. Restore web separately to the saved Worker version.
Database changes need a reviewed forward repair or tested restore plan;
rolling back JavaScript does not undo SQL or recover lost data. See the
existing [release guide](RELEASES.md) and [native checklist](NATIVE_RELEASE.md).
