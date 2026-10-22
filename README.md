# Office Gym

A personal training app for the office gym. Onboards you, generates a plan from
your answers, and runs each session as **Warm-up + 4 blocks** with an exercise
demo, target reps, and a weight prompt after every set.

Built with Expo / React Native (runs in Expo Go, no Xcode needed) and Supabase.

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

GitHub publishing uses the repository's `EXPO_TOKEN` secret. Vercel also needs
an Expo access token named `EXPO_TOKEN` in its Production and Preview environment
settings so `npm run export:web` can read EAS. This token is only for the build;
it must not have the `EXPO_PUBLIC_` prefix.

## Authentication

Google sign-in shares the existing Supabase session and onboarding flow.
Email/password remains available. Apple is skipped and hidden by default; its
implementation can be enabled later with `EXPO_PUBLIC_APPLE_SIGN_IN_ENABLED=1`
after provider setup. Google uses the system browser or a web redirect.
See [provider setup and release checks](docs/auth-setup.md) for the Supabase
credentials, redirect URLs, Apple capability, and native rebuild requirements.

## The hosted build

Live, no login required:
**https://cdn.jsdelivr.net/gh/mateosauton/personal-trainer@cdn/index.html**

That one is a stopgap — a CDN has no rewrite rules, so deep links 404 and you
have to enter at the root. The host you actually want is Vercel, one setting
away (below).

**https://personal-trainer-mateo-sautons-projects.vercel.app**

The same code runs on the web: `npm run export:web` writes a static
single-page bundle to `dist/`, and `vercel.json` tells Vercel to do exactly that
and to rewrite every app route back to `index.html`. Vercel builds `master` on
every push. `vercel.json` also states the install command outright, because the
project predates this repo and would otherwise inherit the one it was set up
with.

`personal-trainer.vercel.app` is **not** this app — that hostname belongs to an
unrelated Vercel account.

That Vercel URL currently answers with Vercel's login page, because the project
has Deployment Protection on: Settings → Deployment Protection → Vercel
Authentication → Disabled makes it public. Nothing is exposed by doing so —
every table is RLS'd to `auth.uid()`, so a visitor still has to sign in.

A second, login-free copy is built by `.github/workflows/publish-pages.yml`,
which pushes the same export to the `gh-pages` branch. It goes live at
`https://mateosauton.github.io/personal-trainer/` once Pages is switched on:
Settings → Pages → Source: *Deploy from a branch* → `gh-pages` → `/ (root)`.
GitHub stopped auto-enabling Pages on a `gh-pages` push, and a workflow token
is not allowed to enable it, so that first switch has to be thrown by hand.

Hosted builds read the `production` environment in EAS. Local development pulls
the `development` environment into `.env.local` with `npm run env:pull`.

## Native builds and Observe

EAS Observe metrics require a new EAS preview or production build. Expo Go does
not send them.

```bash
eas build --profile preview
eas build --profile production
```

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
serves an exported `dist/` with the same rewrite rule Vercel applies:

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
