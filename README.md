# Office Gym

A personal training app for the office gym. Onboards you, generates a plan from
your answers, and runs each session as **Warm-up + 4 blocks** with an exercise
demo, target reps, and a weight prompt after every set.

Built with Expo / React Native (runs in Expo Go, no Xcode needed) and Supabase.

## Project guides

- [Architecture](docs/ARCHITECTURE.md): infrastructure, modules, schema, runtime flows, failure behavior, and the proposed evolution.
- [Technical decisions](docs/TECHNICAL_DECISIONS.md): subsystem effects, decision records, and bug/feature/chore management.
- [Git workflow](docs/GIT_WORKFLOW.md): environments, branches, worktrees, change review, migrations, and hotfixes.
- [Releases](docs/RELEASES.md): native/web/database artifacts, verification, promotion, compatibility, and recovery.
- [Issues, fixes, and mobile product priorities](docs/ENGINEERING_REVIEW.md)

## Running it

```bash
npm install
npx eas-cli@23.2.0 login
npm run env:pull       # development values from EAS into .env.local
npx expo start --lan
```

Scan the QR with the iPhone Camera app and open in [Expo Go](https://apps.apple.com/app/expo-go/id982107779).
Your phone and this machine must be on the same Wi-Fi.

```bash
npm test        # plan generation, progression, load maths, session queue
npm run lint    # tsc --noEmit
npm run catalog # rebuild lib/data/exercises.json from source datasets
```

## Environment variables

Manage app configuration in [the Expo project's environment settings](https://expo.dev/accounts/mrsauron/projects/office-gym-trainer/environment-variables).
Each EAS environment, `development`, `preview`, and `production`, needs these
project variables with **plain text** visibility:

| Variable | Value |
| --- | --- |
| `EXPO_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `EXPO_PUBLIC_SUPABASE_KEY` | Supabase publishable key |
| `EXPO_PUBLIC_GOOGLE_SIGN_IN_ENABLED` | `1` |

Google's flag is set to `1` in the EAS `development`, `preview`, and `production`
environments. Apple stays unset until its provider configuration is complete.

The app reads these through `process.env.EXPO_PUBLIC_*`. They are public in
the bundle; never use a Supabase service-role key or secret key here.

`eas.json` selects the matching environment for each build profile. EAS Update
uses `--environment production`, and the web export command fetches production
values through `eas env:exec`. It disables local dotenv loading so local testing
credentials cannot enter the hosted export. See [Expo's EAS environment guide](https://docs.expo.dev/eas/environment-variables/).

```bash
npm run env:pull             # development
npm run env:pull:preview     # preview
npm run env:pull:production  # production
npm run export:web          # production web bundle in dist/
```

Pulls replace `.env.local`. Keep local test-login overrides in
`.env.development.local`, and keep provider-specific tokens outside that pull
target. Restart Expo after switching environments. `.env.example` is a template
for offline setup; `.env.test` contains only mock settings. Actual values are
gitignored and managed in EAS.

GitHub publishing uses the repository's `EXPO_TOKEN` secret. Cloudflare builds
use `npm run build:web` with the Supabase public values and Google sign-in flag
mirrored from EAS production into the build environment. Cloudflare does not
need an Expo access token. Local production exports use `npm run export:web`
to fetch EAS values directly.

## Authentication

Social sign-in shares the existing Supabase session and onboarding flow.
Email/password remains available. Google requires `EXPO_PUBLIC_GOOGLE_SIGN_IN_ENABLED=1`
after its provider setup. Apple is skipped and hidden by default; its
implementation can be enabled later with `EXPO_PUBLIC_APPLE_SIGN_IN_ENABLED=1`
after provider setup. Google uses the system browser or a web redirect.
See [provider setup and release checks](docs/auth-setup.md) for the Supabase
credentials, redirect URLs, Apple capability, and native rebuild requirements.

## The hosted build

Cloudflare is the only web host for the testing app:
[Open Office Gym](https://personal-trainer.sautonmateo.workers.dev).
It stays available when the local Expo server is off. Users still sign in to
Supabase to access their own data. Expo/EAS handles native app distribution.

Cloudflare Workers Builds watches `master` and deploys with `npx wrangler deploy`.
The custom build in `wrangler.jsonc` runs TypeScript checks and all tests before
exporting the website. `dist/` is served at the domain root, with an SPA fallback
for direct links and browser refreshes. See [Cloudflare release steps](docs/CLOUDFLARE_RELEASE.md)
for build variables, previews, verification, and rollback.

Vercel, GitHub Pages, and jsDelivr were earlier test mirrors. Use the
Cloudflare URL above; the repository no longer configures a Vercel deployment.

## Driving the UI without a device

`tools/dev/` runs the app in a headless browser against a stand-in backend, for
when there is no phone (or no route to Supabase) to hand:

```bash
node tools/dev/mock-supabase.mjs 54321 &          # GoTrue + the PostgREST slice this app uses
EXPO_NO_DOTENV=1 EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 EXPO_PUBLIC_SUPABASE_KEY=mock npx expo start --web --port 8081 &
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
actually have and capped at your experience level. The app uses
`lib/plan/office-gym.ts` to restrict every selection and fallback to reviewed
movements for this gym. Rebuilding keeps your saved equipment restrictions.
Narrow pools may repeat exercises. Seeded from your user id, so the same
answers reproduce the same plan. The separate 47-minute authored routine keeps
its prescribed rotation, while the local candidate applies equipment, experience
and limitation filters with compatible replacements or omissions.

**Progression** (`lib/progression.ts`) is double progression: work up the rep
range at a fixed load, add weight once every set tops the range at RPE ≤ 8
(+5 kg lower body, +2.5 kg upper). Two sessions stuck at the bottom of the range
backs the load off 10%.

**Bodyweight movements** store added load separately. Effective-load estimates
add the captured bodyweight when known. The candidate preserves original
session units/bodyweight; unknown historical context stays unknown.

**The catalog** combines 873 source exercises (`lib/data/exercises.json`) with
authored gym variations bundled in the app. The metadata is static reference
data versioned with the app bundle. The generator runs on-device without a
network request; Postgres stores account plans and workout records protected
by ownership policies and RPC checks.

**Media** uses `components/ExerciseMedia.tsx` to show the exercise's static
start-position image when available. Authored movements can use text instructions
without an image. Images stream from a CDN and use memory/disk caching; images
never downloaded remain unavailable offline.

## Licensing

Exercise data and images come from
[free-exercise-db](https://github.com/yuhonas/free-exercise-db), public domain
under the Unlicense. Nothing here restricts commercial use, and the credit in
Profile -> Attribution is courtesy rather than obligation.
