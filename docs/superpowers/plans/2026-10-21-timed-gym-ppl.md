# Timed gym PPL implementation plan

**Goal:** Add the approved six-session gym routine with a 47-minute target, timed work blocks of at least six minutes, and time allocated from prescribed work.

**Architecture:** Keep the existing generic generator and save-plan RPC. Add a selectable authored routine and local exercise catalog entries. Derive block durations from persisted prescriptions when loading this routine, so no database migration is required. Use absolute deadlines for work, recovery, pause, and foreground refresh.

**Stack:** Expo, React Native, TypeScript, Supabase client, Jest, local mock backend.

The approved session sequence is Push A, Pull A, Legs A, Push B, Pull B, Legs B. The source routine is the written plan developed in this chat. Five minutes go to the warmup; four work blocks share 42 minutes with a six-minute floor. Sets, midpoint reps, per-side work, holds, and recovery determine allocation; blocks 2 and 3 receive greater weight. Completing the previous session advances the rotation, independently of calendar days.

- [x] Add failing tests for exact exercise prescriptions, gear constraints, complete catalog resolution, and A/B order. Implement the authored routine and honest exercise instructions/media.
- [x] Add failing allocation and queue tests for 2,820 total seconds, six-minute work floors, rep-dependent durations, and preserved sets. Implement duration metadata, weighted slots, pauseable absolute deadlines, and shared estimates.
- [x] Add failing Plan-screen tests for activation, errors, and rotation wording. Implement a routine card using `savePlan(userId, generateGymRoutine())`, preserve history, and reload after success.
- [x] Add a persisted-plan read test. Hydrate timing with `withDayTiming(day)` only when `isGymRoutine(plan)` is true; keep existing database selects compatible.
- [x] Add session tests for countdowns, pause/resume, expiry without phantom logs, and final recovery. Implement timed UI and retain manual set/weight logging.
- [x] Add the missing local mock `save_plan` RPC and correct completed-day rotation query behavior. Verify activation, reload, and a completed-session rotation against the mock.
- [x] Run targeted tests, the full Jest suite, TypeScript, and a local web export. Inspect the Plan and live session screens at phone dimensions. Report local verification separately from deployment.

Unrelated existing working-tree changes remain untouched. No deployment, production account write, or commit is part of this request.
