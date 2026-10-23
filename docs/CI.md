# CI and releases

The [checks workflow](../.github/workflows/checks.yml) runs on pull requests,
pushes to `master`, and manual dispatch. Its checkout and Node setup actions are
pinned to full commit SHAs for v6. Node 22 and `npm ci` use the committed
lockfile. Pull requests and pushes run checks without publishing an app or
loading release credentials.

## Local checks

```sh
npm ci
npm run check:web
npm run build:web:check
```

`check:web` runs TypeScript and `npm test`. The test command combines these
checks:

| Check | What it verifies |
| --- | --- |
| `npm run test:unit` | Core workout calculations, plans, persistence and security behavior through Jest. The headless auth-provider test checks account-switching races. |
| `npm run test:db` | Disposable PostgreSQL checks through PGlite, including account isolation, progression, set ordering, session context, current migrations and the recorded baseline upgrade. |
| `npm run test:safety` | Environment routing, public-key restrictions, local database tooling, isolated bundle configuration, guarded candidate publishing and tested-group promotion. Release tests use fake EAS executables and never publish an update. |
| `node --test tools/dev/serve-dist.test.mjs` | The local preview server's request handling and file-access restrictions. |

This stays a focused core and security suite. Screen layout, animation, gestures
and the complete mobile workout journey need device verification. Removing
screen-render tests does not remove workout, account-isolation or release checks.

PGlite runs in memory without Docker or hosted Supabase credentials. The database
suite applies every migration and executes `supabase/tests/`. Its upgrade checks
protect existing workout records against changes after the recorded baseline.
See [migration baselines](MIGRATION_BASELINE.md) for the historical checkpoint.
These checks do not prove the production database or Supabase Auth deployment.

## Environment and bundle checks

The checks job provides only the exact offline mock environment and loopback
fixture from [.env.test](../.env.test). It disables automatic dotenv loading.
Those values cannot pass a distributable build's environment guard.

`build:web:check` supplies a separate synthetic public configuration and compiles
Metro into `.expo/web-check`. It makes no backend requests and creates no
production-ready artifact. CI does not upload or deploy this directory. Do not
replace it with a mock-backed `build:web` command.

`build:web` and `export:web` remain distribution commands. They validate the
selected environment and registered backend before exporting to `dist`. Use
[environment setup](ENVIRONMENTS.md) to load production values or run the isolated
local backend. Hosted development and preview remain blocked until separate
backend projects are registered.

## Native publishing

The separate [Promote tested native update workflow](../.github/workflows/eas-update.yml)
runs only by manual dispatch from `master`. It replaces the former checkbox-only
native job in the checks workflow.

Prepare a candidate through the guarded update wrapper, test its exact update
group on a physical phone, then provide the source SHA, platform, candidate group,
tested device build, installed production build and evidence URL. The promotion
runner fetches authenticated EAS metadata and checks source, backend, runtime,
fingerprint, build profiles and channel mappings. It republishes the tested
group's JavaScript and assets rather than rebuilding them.

Phone testing and backend compatibility still require the operator's explicit
attestation. The workflow uses the GitHub `production` environment and
`EXPO_TOKEN`, serializes promotions without cancelling an active write, and saves
a release receipt. An uncertain write requires checking EAS before retrying.
Follow [release safety](RELEASE_SAFETY.md) for setup, exact commands, evidence,
limitations and recovery, and [native verification](NATIVE_RELEASE.md) for device
checks. Actions does not build store binaries, submit them, apply production SQL
or deploy Edge Functions.

## Web publishing

Cloudflare hosting is configured separately from GitHub checks. Its Wrangler
build runs `check:web` followed by the guarded `build:web` export using the
hosting environment's real public configuration. The synthetic CI bundle is
never its deployment input.

See [Cloudflare releases](CLOUDFLARE_RELEASE.md) for branch triggers, environment
settings and deployment verification. Merging does not publish a native update;
a configured Cloudflare branch integration can deploy the web app independently.
