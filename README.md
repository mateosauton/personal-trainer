# Office Gym

A personal training app for the office gym. Onboards you, generates a plan from
your answers, and runs each session as **Warm-up + 4 blocks** with an exercise
demo, target reps, and a weight prompt after every set.

Built with Expo / React Native (runs in Expo Go, no Xcode needed) and Supabase.

## Running it

```bash
npm install
cp .env.example .env   # fill in your Supabase URL and publishable key
npx expo start --lan
```

Scan the QR with the iPhone Camera app and open in [Expo Go](https://apps.apple.com/app/expo-go/id982107779).
Your phone and this machine must be on the same Wi-Fi.

```bash
npm test        # plan generation, progression, load maths, session queue
npm run lint    # tsc --noEmit
npm run catalog # rebuild lib/data/exercises.json from source datasets
```

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
NODE_ENV=test npx expo start --web --port 8081 &  # loads the committed .env.test mock settings
node tools/dev/drive.mjs session ./shots            # screenshots a whole flow
```

The mock seeds two accounts — `demo@officegym.test` (onboarded, with a plan and
history) and `fresh@officegym.test` (needs onboarding), both `demo1234` — and
exposes `GET /__reset`, `GET /__state` (so a test can assert a write actually
landed) and `GET /__slow?ms=700` (so anything the app shows *while* it waits is
on screen long enough to see). `drive.mjs` holds one function per flow; add to
it rather than writing a new script.

To check the real thing rather than the dev server, `tools/dev/serve-dist.mjs`
serves an exported `dist/` with the same SPA fallback Cloudflare applies:

```bash
npx expo export --platform web
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
`EXPO_PUBLIC_DEV_LOGIN_PASSWORD` set in `.env`, the sign-in screen grows a
one-tap button for that account — see `lib/dev-auth.ts`, which also holds the
address whitelist. It signs a real account in, so RLS and every query behave
normally. It only appears in a dev build unless `EXPO_PUBLIC_ALLOW_DEV_LOGIN=1`
is set; leave that unset for the hosted build, since `EXPO_PUBLIC_*` values are
baked into the shipped bundle.

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
