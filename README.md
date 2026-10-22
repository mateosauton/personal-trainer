# Office Gym

A personal training app for the office gym. Onboards you, generates a plan from
your answers, and runs each session as **Warm-up + 4 blocks** with an exercise
demo, target reps, and a weight prompt after every set.

Built with Expo / React Native (runs in Expo Go, no Xcode needed) and Supabase.

## Running it

Use Node 22 and `npm ci`. Start an isolated local Supabase stack with Docker
for local web development:

```sh
npm ci
npm run db:local:start
npm run db:local:seed
npm run db:local:env
npm run web
```

The environment command preserves an existing `.env.local`; move it intentionally
before switching backends. See [environment setup](docs/ENVIRONMENTS.md) for local
accounts, ports, database checks, native-device limits, and hosted provisioning.
Hosted development and preview builds remain blocked until their distinct
Supabase project references are registered. No command falls back to production.

```sh
npm run check:web        # TypeScript, safety tests, preview server, app tests
npm run build:web:check  # synthetic Metro check in .expo/web-check; never deploy
npm run db:local:test    # SQL integration tests on the local stack
npm run catalog         # rebuild the exercise catalog
```

## Environment variables

[config/environments.json](config/environments.json) binds each hosted target to
one distinct Supabase project. Both `APP_ENV` and `EXPO_PUBLIC_APP_ENV` are
required and must match. The public URL must match that registered backend;
the public key must be a publishable key or matching legacy anon key. Service
keys and public developer-login credentials are rejected for distribution.

EAS profiles, Cloudflare branch context and Vercel environment context must
agree with the target. `eas.json` pins markers for each native profile; OTA
commands also require a supported channel and explicit EAS environment. See
[environment setup](docs/ENVIRONMENTS.md) before pulling hosted values.

```sh
npm run env:pull             # isolated development values into .env.local
npm run env:pull:preview     # isolated preview values into .env.local
npm run env:pull:production  # production; use a separate checkout deliberately
npm run env:check           # validate injected values for distribution
npm run export:web          # fetch and validate production, then export dist/
```

EAS pulls replace `.env.local`. Local development overrides belong in
`.env.development.local`; remove them before distribution. Restart Expo after
switching backends. `.env.example` is a template; `.env.test` holds only the
explicit mock fixture. Public variables ship in the bundle. Real env files
and server credentials must remain outside Git.

Native updates require a manually dispatched promotion of an already tested
update group. A master push runs checks and may deploy the Cloudflare web app;
it does not publish a native OTA. Follow the [native release runbook](docs/RELEASE_SAFETY.md).

## Authentication

Social sign-in shares the existing Supabase session and onboarding flow.
Email/password remains available. Google requires `EXPO_PUBLIC_GOOGLE_SIGN_IN_ENABLED=1`
after its provider setup. Apple is skipped and hidden by default; its
implementation can be enabled later with `EXPO_PUBLIC_APPLE_SIGN_IN_ENABLED=1`
after provider setup. Google uses the system browser or a web redirect.
See [provider setup and release checks](docs/auth-setup.md) for the Supabase
credentials, redirect URLs, Apple capability, and native rebuild requirements.

## The hosted build

The web testing app is hosted on Cloudflare:
[Open Office Gym](https://personal-trainer.sautonmateo.workers.dev).
It stays available when the local Expo server is off. Users still sign in to
Supabase to access their own data. Expo/EAS handles native app distribution.

Cloudflare Workers Builds watches `master` and deploys with `npx wrangler deploy`.
The custom build in `wrangler.jsonc` runs TypeScript checks and all tests before
exporting the website. `dist/` is served at the domain root, with an SPA fallback
for direct links and browser refreshes. See [Cloudflare release steps](docs/CLOUDFLARE_RELEASE.md)
for build variables, previews, verification, and rollback.

The existing Vercel, GitHub Pages, and jsDelivr deployments are legacy test
mirrors. Cloudflare is the primary web testing URL.

## Driving the UI without a device

`tools/dev/` runs the app in a headless browser against a stand-in backend, for
when there is no phone (or no route to Supabase) to hand:

```bash
node tools/dev/mock-supabase.mjs 54321 &          # GoTrue + the PostgREST slice this app uses
EXPO_NO_DOTENV=1 APP_ENV=mock EXPO_PUBLIC_APP_ENV=mock EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 EXPO_PUBLIC_SUPABASE_KEY=sb_publishable_LOCAL_TEST_FIXTURE_ONLY npx expo start --web --port 8081 &
node tools/dev/drive.mjs session ./shots            # screenshots a whole flow
```

The mock seeds two accounts — `demo@officegym.test` (onboarded, with a plan and
history) and `fresh@officegym.test` (needs onboarding), both `demo1234` — and
exposes `GET /__reset`, `GET /__state` (so a test can assert a write actually
landed) and `GET /__slow?ms=700` (so anything the app shows *while* it waits is
on screen long enough to see). `drive.mjs` holds one function per flow; add to
it rather than writing a new script.

To check the real thing rather than the dev server, `tools/dev/serve-dist.mjs`
serves an exported `dist/` with the same SPA fallback Cloudflare applies.
The preview listens only on `127.0.0.1` and refuses paths or symlinks outside the export:

```bash
npm run export:web
node tools/dev/serve-dist.mjs dist 8090
```

## How it works

**Two tabs.** *Home* is who you are (avatar top-left, opening the profile),
how you are doing (streak, sessions, the last fortnight as a strip) and what is
next: today's time, reps and tonnage — projected from the plan before you train,
replaced by what you actually did once a session is logged — then one Start
button. *Plan* is the plan and its record together: a month calendar with every
trained day filled green, a card per session in the rotation showing reps,
estimated minutes, blocks and the muscles it targets, and the recent-session
list that used to be its own History tab. A live session takes the whole screen
with no tab bar and no swipe-back (`app/session/`).

The numbers behind all of that are pure functions, tested rather than trusted:
`lib/stats.ts` (streak, tonnage, calendar days) and `lib/plan/estimate.ts`
(sets, reps, minutes, body parts, projected volume). Both tabs read one hook,
`lib/useDashboard.ts`, so they cannot disagree.

**Signing in for testing.** With `EXPO_PUBLIC_DEV_LOGIN_EMAIL` and
`EXPO_PUBLIC_DEV_LOGIN_PASSWORD` set in `.env.development.local`, the sign-in screen grows a
one-tap button for that account — see `lib/dev-auth.ts`, which also holds the
address whitelist. It signs a real account in, so RLS and every query behave
normally. It only appears in a dev build unless `EXPO_PUBLIC_ALLOW_DEV_LOGIN=1`
is set. Keep all three test-login variables out of EAS; `EXPO_PUBLIC_*` values
are baked into the shipped bundle even when the button is hidden.

**The plan generator** (`lib/plan/`) is a deterministic rule engine, not a model
call. It picks a split from your training frequency, then fills each day with a
warm-up plus four blocks: two straight-set compounds, an antagonist superset,
and a core/conditioning circuit. Rep schemes come from your goal, rest scales
with your session budget, and exercises are filtered to the equipment you
actually have, capped at your experience level, and deduped across the week.
Seeded from your user id, so the same answers reproduce the same plan.

**Progression** (`lib/progression.ts`) is double progression: work up the rep
range at a fixed load, add weight once every set tops the range at RPE ≤ 8
(+5 kg lower body, +2.5 kg upper). Two sessions stuck at the bottom of the range
backs the load off 10%.

**Bodyweight movements** store load as `bodyweight + added_load_kg`, so a
weighted pull-up is comparable to a lat pulldown and estimated 1RMs stay honest.

**The catalog** is 873 exercises bundled in the app (`lib/data/exercises.json`),
not in Postgres — it is static reference data versioned with the binary, and the
generator runs on-device, so it must work with no network. Postgres holds only
your data, every table RLS'd to `auth.uid()`.

**Media** is one path (`components/ExerciseMedia.tsx`): every exercise crossfades
between its start and end stills, which reads as the two ends of the movement.
The stills stream from a CDN and are disk-cached, so a session repeats offline
after its first run.

## Licensing

Exercise data and images come from
[free-exercise-db](https://github.com/yuhonas/free-exercise-db), public domain
under the Unlicense. Nothing here restricts commercial use, and the credit in
Profile -> Attribution is courtesy rather than obligation.
