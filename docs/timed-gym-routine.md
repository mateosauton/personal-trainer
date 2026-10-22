# Timed gym routine

Open **Plan → Use 47 min PPL routine** to activate the authored gym preset. The current plan is retired through the existing atomic `save_plan` RPC; logged sessions and weights remain available.

The rotation is Push A → Pull A → Legs A → Push B → Pull B → Legs B. Completing a session advances the next day in this plan; rest days do not advance it. The questionnaire generator remains available for other plans.

Each session targets 47 minutes: a five-minute full-body warmup and four work blocks of at least six minutes. Block durations vary across days. The allocator uses exercise count, sets or rounds, midpoint reps, tempo, unilateral work, timed holds, and recovery. Strength and advanced full-body work receive most of the remaining budget. Counts and durations round to integer seconds while preserving the 2,820-second total.

The live player shows block remaining time or overtime, active session elapsed time, the target, and per-set work/recovery windows. Pause freezes the workout and rest clocks. Deadlines catch up after background suspension. Sets and weights are always recorded manually. Finishing a block early retains its remaining recovery; choosing Skip rest shortens the actual session. Expiry does not skip exercises or invent logged sets.

Per-side reps are saved per side for progression. Display totals count both sides. Timed holds store total seconds for both sides and do not invent rep counts.

Only the listed gym equipment is used: barbell, dumbbells, plates, kettlebells, flat/incline benches, squat rack, pull-up bar, parallel bars, seated resistance row, and lat-pulldown machine. The authored instructions include substitutions for pull-ups, dips, swings, and a cardio rower in place of the resistance-row machine.

Routine-specific exercise IDs and instructions live in `lib/data/gym-routine-exercises.ts`; exact aliases reuse appropriate demos, and new combination movements show instructions instead of an unrelated image. They do not alter the questionnaire generator's candidate pool.

Block timing is derived from persisted prescriptions when loading this preset. No new database columns or migration are needed. The existing `save_plan(jsonb)` RPC must already be installed, as required by the rest of the app.

Verification:

```sh
npm test -- --runInBand
npm run lint
node --test tools/dev/mock-supabase.test.mjs
```

The local browser flow also verifies activation, reload, manual completion, persisted set logs, and advancement to Pull A. The mock is a test backend; this does not establish a production deployment.
