# Native release

Native distribution has two independent artifacts: a signed iOS/Android binary from EAS Build, and a JavaScript/assets update from EAS Update. An OTA can only reach an installed binary with a compatible fingerprint runtime and channel. It cannot change native code or upgrade old `appVersion` runtimes.

## Build a new native runtime

Use a clean current `master` checkout, Node 22 and EAS CLI 23.2.0. Run `npm ci`, `npm run lint`, and `npm test -- --runInBand --testTimeout=20000`. Configure and validate environment variables following [ENVIRONMENTS.md](ENVIRONMENTS.md).

Build a release-test device binary with production backend configuration and the separate release-test channel:

```sh
EXPO_NO_DOTENV=1 npx eas-cli@23.2.0 env:exec production \
  'node scripts/verify-environment.cjs --distribution --environment production && npx eas-cli@23.2.0 build --platform android --profile release-test --non-interactive' \
  --non-interactive
```

Use `--platform ios` for an iPhone build. Complete the phone checks in [RELEASE_SAFETY.md](RELEASE_SAFETY.md#prepare-and-test-a-candidate). Build production from the same verified source using `--profile production`. Record both EAS build IDs, exact commit, resolved environment, platform and runtime. Store submission and rollout are separate explicit operator actions; no repository workflow submits a binary automatically.

A build merely finishing does not prove it is installed by users. Record the actual production build cohort from the App Store/Play Console before supplying its ID to an OTA promotion.

## Release a JavaScript fix

Export one candidate platform to `release-test` using the **production** EAS environment, load that exact update group on a physical phone, and record test evidence. Then dispatch the manual **Promote tested native update** workflow from `master`. The workflow verifies actual EAS build/group metadata and promotes the existing group without creating a new bundle.

Follow [RELEASE_SAFETY.md](RELEASE_SAFETY.md) for exact inputs, environment setup, compatibility checks, retained receipts, failures and recovery. A normal `master` push runs checks; it does not publish a native update.

Preview builds use their own preview environment/backend. They cannot be promoted into production: environment values are compiled into JavaScript. The release-test profile exists specifically to test production values on a separate native update channel.
