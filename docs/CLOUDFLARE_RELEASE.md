# Cloudflare web releases

Cloudflare hosts the web testing app at
https://personal-trainer.sautonmateo.workers.dev.
Supabase remains the backend. Native releases use Expo/EAS.

## Build settings

- Worker: `personal-trainer`.
- Repository: `mateosauton/personal-trainer`, production branch `master`.
- Root directory: `/`.
- Node: 22, selected by `.nvmrc`.
- Deploy command: `npx wrangler deploy`.
- Preview command: `npx wrangler versions upload`.
- Exclude `master`, `gh-pages`, and `cdn` from non-production builds.

Wrangler runs `npm run check:web && npm run build:web`, so failed TypeScript,
unit, database or migration checks prevent deployment and preview upload. The export writes
`dist/`. Keep `expo.web.output` as `single` and the SPA fallback enabled in
`wrangler.jsonc`. Do not run the GitHub Pages base-path script for Cloudflare.

Set these build-time variables separately on the production and preview triggers:

| Variable | Production (`master`) | Every other branch |
| --- | --- | --- |
| `APP_ENV` | `production` | `preview` |
| `EXPO_PUBLIC_APP_ENV` | `production` | `preview` |
| `EXPO_PUBLIC_SUPABASE_URL` | Registered production URL | Registered, isolated preview URL |
| `EXPO_PUBLIC_SUPABASE_KEY` | Production public key | Preview public key |
| `EXPO_PUBLIC_GOOGLE_SIGN_IN_ENABLED` | `1`, with the verified production provider | Enable after isolated provider/callback setup |
| `EXPO_NO_DOTENV` | `1` | `1` |
| `EXPO_NO_TELEMETRY` | `1` | `1` |
| `NODE_VERSION` | `22` | `22` |

The shared guard checks Cloudflare's `WORKERS_CI_BRANCH` independently: `master`
requires production and any other branch requires preview. Renaming production
values to preview does not pass. Never put a service-role key or developer-login
credentials in build variables or assets.

The existing Google flag was read back on both triggers while they shared the
production backend. Recheck the provider on a new isolated preview before
enabling its button. Omit `EXPO_PUBLIC_APPLE_SIGN_IN_ENABLED`; Apple setup is skipped.

**Migration prerequisite:** read-only inspection on 2026-10-22 found both
Cloudflare triggers pointed at the production project and had no environment
markers. Production markers have since been configured and verified for the
existing `asbudyijvunpnhrhsubm` project. New preview builds remain blocked until
an isolated preview backend (a branch or project) is verified, registered in
`config/environments.json`, and configured on the preview trigger. Production
builds use the explicit markers above. Existing deployed versions keep their
old configuration until replaced. Follow [ENVIRONMENTS.md](ENVIRONMENTS.md).

`npm run build:web:check` uses synthetic public values only to validate Metro
in CI; its `.expo/web-check` output must never be deployed. Hosted builds use
the guarded `npm run build:web` and real target-specific public configuration.

## Authentication

Allow these exact redirects in Supabase Auth:

- `https://personal-trainer.sautonmateo.workers.dev/`
- `https://personal-trainer.sautonmateo.workers.dev/reset-password`

Keep the native `officegym` scheme and authorized Expo Go callbacks. The app
passes its platform's redirect explicitly, so the native Site URL can remain
`officegym://`. Add exact callbacks for a preview before testing email links
there. Do not allow every `workers.dev` domain.

The earlier Google production build `d76ce734-ecb7-49ff-b96e-a7ab507a2a86`
succeeded from pinned `master` commit `4189aa33f926b40359d1ff05ca9f08f94707df77`, deploying
version `fcabc071-f9f7-4c07-b7a6-0a8178f65bcb`. TypeScript, 55 test suites with
527 tests, web export, and deployment passed.

That release's `/sign-in` verification showed Google and email, with Apple hidden.
Google sign-in with an existing account requested only name, profile picture, and email,
returned to Home, removed the callback code from the URL, and preserved Home
after reload. Google onboarding with a new account and physical native Google
authentication remain unverified. Native validation requires a fresh binary.
Apple remains skipped; optional Google branding publication still needs
privacy-policy and terms URLs.

## Verify and promote

Keep [migration baseline reconciliation](MIGRATION_BASELINE.md) separate from
web publication. The current source includes private avatars, session calculation
context, training-preference RPCs and home-timezone migrations after the pinned
nine-file baseline. Local migration checks do not prove these changes exist in
production. Verify the target's schema and paired private-photo client before
releasing dependent UI. Account deletion also requires its Edge Function; see
[privacy controls](PRIVACY_CONTROLS.md). Never use an actual account deletion as
a deployment smoke test.

1. Push a source branch and open a PR. Confirm its Cloudflare preview build and
   the GitHub checks pass for the exact commit.
2. Open the preview and test sign-in, onboarding, plan creation, workout logging,
   timed exercises, refresh/resume, and JSON data export with a test account.
3. Check direct navigation to `/sign-in` and `/reset-password`. Exercise email
   confirmation and recovery callbacks; inspect browser console errors.
4. Check narrow mobile layouts and real mobile Safari before claiming iPhone
   browser coverage. Unit tests alone do not establish browser or native coverage.
5. Merge the verified PR. Confirm the production Cloudflare build records the
   merge commit and succeeds. Open the production URL and repeat the smoke checks.

## Rollback

Record the current production version ID before promotion. In Cloudflare's
Worker Deployments tab, roll back to that version if verification fails.
Alternatively, from an authenticated CLI:

```sh
npx wrangler rollback <previous-version-id>
```

Confirm the expected app loads after rollback, then revert the source change
through a PR so the next automatic build does not deploy it again. Rolling back
static assets does not undo Supabase data or migrations. The isolation and safety changes introduce no database migration.
