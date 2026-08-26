# Office Gym

A personal training app for the office gym. Onboards you, generates a plan from
your answers, and runs each session as **Warm-up + 4 blocks** with an animated
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

**The catalog** is 889 exercises bundled in the app (`lib/data/exercises.json`),
not in Postgres — it is static reference data versioned with the binary, and the
generator runs on-device, so it must work with no network. Postgres holds only
your data, every table RLS'd to `auth.uid()`.

**Media** has two tiers behind one component (`components/ExerciseMedia.tsx`):
16 exercises play a real looping animation, the rest crossfade between start and
end stills. The player never branches on which.

## Licensing — read before shipping this

**This app is licensed for personal, non-commercial use only.**

The 16 animations in `assets/exercises/` come from the [RepDB](https://repdb.co)
preview pack under **CC BY-NC 4.0**: attribution required, non-commercial use
only. If this ever goes to the App Store, gets sold, or is deployed as a company
product, either delete `assets/exercises/` — the media layer falls back cleanly
to tier 2, no code change — or buy a commercial tier ($499 Standard includes
animations).

The remaining artwork and exercise data come from
[free-exercise-db](https://github.com/yuhonas/free-exercise-db), public domain
under the Unlicense.

Both credits are surfaced in-app on Profile → Attribution, which is a licence
obligation, not decoration.
