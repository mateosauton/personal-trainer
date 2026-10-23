# Native release

The native app is the product release target. Web builds help with previews.
Use a clean checkout of the exact current `master` commit intended for publication.

Native distribution has two independent artifacts: a signed iOS/Android binary
from EAS Build, and a JavaScript/assets update from EAS Update. An OTA can only
reach an installed binary with a compatible fingerprint runtime and channel.
It cannot change native code or upgrade old `appVersion` runtimes.

## Build a new native runtime

Record `git rev-parse HEAD`; use Node 22 and EAS CLI 23.2.0. Run `npm ci` and
`npm run check:web`. These checks include TypeScript, core workout/security
behavior, fresh-schema database tests and the migration-baseline upgrade rehearsal.
Configure and validate environment variables following [environments](ENVIRONMENTS.md).

Build a release-test device binary with production backend configuration and
the separate release-test channel:

```sh
EXPO_NO_DOTENV=1 npx eas-cli@23.2.0 env:exec production \
  'node scripts/verify-environment.cjs --distribution --environment production && npx eas-cli@23.2.0 build --platform android --profile release-test --non-interactive' \
  --non-interactive
```

Use `--platform ios` to build for an actual iPhone, with the required signing
and distribution access. Use a dedicated test account: release-test intentionally
contacts the production backend. A web export or Expo Go startup alone does not
validate a native release.

## Verify on the phone

Complete the exact-candidate checks in [release safety](RELEASE_SAFETY.md#prepare-and-test-a-candidate):

1. Verify signup, confirmation, sign-in and password recovery. Check supported
   onboarding inputs such as body measurements and goals, exercise preferences
   and the gym's available equipment. Record unsupported personalization explicitly.
2. Start today's workout, read exercise instructions, log and edit a set, rest,
   background and reopen the app. Finish a workout offline, reconnect and confirm
   saved history without duplicates. Cover a timed-set edit during an outage,
   process restart, completion summary and export destination.
3. Restart and switch accounts to check resume behavior and account isolation.
   Confirm controls remain usable with the keyboard open and near the phone's
   bottom safe area.
4. Record the full SHA, EAS build UUID, runtime, platform/device, backend and
   results in the release issue or PR. For an OTA, also record the exact tested
   update group and intended installed production build. Keep separate evidence
   for Android and iOS.

Check the unresolved [open release gates](OPEN_RELEASE_GATES.md), including iOS
signing access, migration history, final dependency review, public links, store
metadata and recovery rehearsal. These remain separate from CI's artifact checks.

For a native runtime change, build production binaries from the same verified
source using `--profile production` and distribute through the intended store.
Record both EAS build IDs and their resolved environment, platform and runtime.
Store submission and rollout are explicit operator actions; no repository
workflow builds or submits a binary automatically.

A build finishing does not prove users installed it. Identify the actual
production build cohort from the App Store/Play Console before supplying its
ID to an OTA promotion.

## Release a JavaScript fix

Use the guarded candidate publisher in [release safety](RELEASE_SAFETY.md) to
export one platform to `release-test` with the **production** EAS environment.
Load that exact update group on a physical phone and record test evidence.
Then dispatch **Promote tested native update** from `master`, providing the source
SHA, platform, candidate group, tested device build, intended production build,
phone-test attestation and evidence URL. Repeat separately for another platform.

The workflow verifies actual EAS build/group metadata and promotes the existing
group without creating a new bundle. Phone-test results remain human attestations.
If `master` advances, test a candidate for the new commit before retrying.
A normal `master` push runs checks; it does not publish a native update.
See [CI](CI.md) for automatic checks and [release safety](RELEASE_SAFETY.md) for
exact inputs, compatibility checks, retained receipts, failures and recovery.

Preview builds use their own preview environment/backend. They cannot be
promoted into production because environment values are compiled into JavaScript.
Keep test passwords and developer login flags out of production EAS variables.
The release-test profile tests production values on a separate update channel.
See [releases](RELEASES.md) for release types and database boundaries.
