# CI and releases

This checkout's [workflow](../.github/workflows/checks.yml) runs on pull requests,
pushes to `master`, and manual dispatch. These changes take effect in GitHub
after merging. Hosted settings and secrets require separate verification.

Node 22 and `npm ci` use the committed lockfile. Checks run TypeScript, core
workout and security tests, database tests, and a web export. Pull requests use
mock public Supabase settings and receive no release secrets. The suite does
not test screen layout, gestures, or the complete mobile workout journey.

## Local checks

```sh
npm ci
npm run check:web
EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 EXPO_PUBLIC_SUPABASE_KEY=mock npm run build:web
```

`npm test` runs Jest and disposable PostgreSQL checks. `npm run test:unit` and
`npm run test:db` run them separately. Database checks use PGlite in memory and
need no Supabase credentials. They cover row policies, account isolation,
progression replay, write ordering, timed sets, and account exports. Latest-schema
checks apply every migration and execute `supabase/tests/`; historical checks
protect existing workout records during upgrades.

## Native publishing

Automatic checks do not publish to phones. After completing
[native verification](NATIVE_RELEASE.md), manually run `CI/CD` on `master` with:

- `publish_native` enabled.
- `tested_sha` equal to the run's full 40-character master SHA.
- `native_build_id` equal to the installed EAS build UUID.
- `release_platform` equal to the platform verified with that build.

Actions reruns checks, validates the record, and records the operator, commit,
build, and platform in its summary. These are human attestations. CI cannot
confirm that the operator tested the build or that it contains that SHA.
Publish Android and iOS separately after testing each.

Publishing needs the repository's `EXPO_TOKEN` secret and EAS production public
configuration. Native publishes are serialized; an active publish is not
cancelled. A queued release skips if its SHA no longer matches master. This
check cannot prevent a push during an already active publish.

Expo's fingerprint policy delivers updates only to compatible installed
builds. Native runtime changes require new binaries. Actions does not build or
submit those binaries, apply migrations, or verify device behavior.

## Web publishing

`wrangler.jsonc` runs `npm run check:web && npm run build:web` when Wrangler
deploys the `personal-trainer` web app. Cloudflare's branch trigger and build
environment are hosted settings, not declared here. Its configured integration
can deploy independently of GitHub's native job. Real public Supabase settings
must come from that build environment, rather than the mock PR bundle.

See [releases](RELEASES.md) for release types and recovery.
