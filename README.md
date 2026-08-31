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

Live, no login required:
**https://cdn.jsdelivr.net/gh/mateosauton/personal-trainer@cdn/index.html**

That one is a stopgap — a CDN has no rewrite rules, so deep links 404 and you
have to enter at the root. The host you actually want is Vercel, one setting
away (below).

**https://personal-trainer-mateo-sautons-projects.vercel.app**

The same code runs on the web: `npx expo export --platform web` writes a static
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

Supabase credentials for that build live in the committed `.env.production`
rather than in a dashboard setting, so any checkout builds the same app. That is
safe on purpose: Expo bakes `EXPO_PUBLIC_*` into the bundle either way, and the
publishable key is designed to ship in a client — every table is RLS'd to
`auth.uid()`, so the key alone grants access to nothing. Local development reads
`.env` instead, which is where a local backend goes.

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
serves an exported `dist/` with the same rewrite rule Vercel applies:

```bash
npx expo export --platform web
node tools/dev/serve-dist.mjs dist 8090
```

## How it works

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
