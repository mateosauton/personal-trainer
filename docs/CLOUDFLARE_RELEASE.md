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

Wrangler runs `npm run check:web && npm run build:web`, so failed TypeScript
checks or tests prevent both deployment and preview upload. The export writes
`dist/`. Keep `expo.web.output` as `single` and the SPA fallback enabled in
`wrangler.jsonc`. Do not run the GitHub Pages base-path script for Cloudflare.

Set these build-time variables for production and preview builds:

- `EXPO_PUBLIC_SUPABASE_URL`: the intended Supabase project URL.
- `EXPO_PUBLIC_SUPABASE_KEY`: that project's publishable key.
- `EXPO_PUBLIC_GOOGLE_SIGN_IN_ENABLED=1`.
- `EXPO_NO_DOTENV=1`: use configured build variables rather than local files.
- `EXPO_NO_TELEMETRY=1`.
- `NODE_VERSION=22`.

The Google flag is set and read back on both production and non-production
build triggers. Omit `EXPO_PUBLIC_APPLE_SIGN_IN_ENABLED`; Apple setup is skipped.

Only enable `EXPO_NO_DOTENV` after both public Supabase variables are configured.
The two public values are mirrored from the EAS production environment into
the Cloudflare build triggers. Local dotenv loading is disabled; actual env
files are gitignored. Never put a service-role key or other server credential in `EXPO_PUBLIC_*`, Wrangler assets, or a committed env file.

Previews using the production project share production data. Use a dedicated
test account for verification. A fully isolated preview needs its own Supabase
project and migrations; a different hostname alone does not isolate data.

## Authentication

Allow these exact redirects in Supabase Auth:

- `https://personal-trainer.sautonmateo.workers.dev/`
- `https://personal-trainer.sautonmateo.workers.dev/reset-password`

Keep the native `officegym` scheme and authorized Expo Go callbacks. The app
passes its platform's redirect explicitly, so the native Site URL can remain
`officegym://`. Add exact callbacks for a preview before testing email links
there. Do not allow every `workers.dev` domain.

Google production build `d76ce734-ecb7-49ff-b96e-a7ab507a2a86` succeeded from
pinned `master` commit `4189aa33f926b40359d1ff05ca9f08f94707df77`, deploying
version `fcabc071-f9f7-4c07-b7a6-0a8178f65bcb`. TypeScript, 55 test suites with
527 tests, web export, and deployment passed.

The live `/sign-in` screen shows Google and email, with Apple hidden. Google
sign-in with an existing account requested only name, profile picture, and email,
returned to Home, removed the callback code from the URL, and preserved Home
after reload. Google onboarding with a new account and physical native Google
authentication remain unverified. Native validation requires a fresh binary.
Apple remains skipped; optional Google branding publication still needs
privacy-policy and terms URLs.

## Verify and promote

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
static assets does not undo Supabase data or migrations. This release changes
no database schema.
