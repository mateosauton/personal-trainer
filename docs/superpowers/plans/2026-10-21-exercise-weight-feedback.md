# Exercise weight suggestions and feedback

**Goal:** Show an editable personal weight suggestion before lifting and an actual weight comparison after the final set of an exercise.

**Design:** Keep the stored next-session target separate from previous recorded lifts. Read the signed-in user's completed workout logs, with explicit equivalent catalog names where the movement and load convention match. Preserve kg storage, kg/lb display, bodyweight added loads, and the existing timed session flow. New exercises request a first weight instead of displaying an invented recommendation.

## Implementation

- [x] Test and implement a pure history resolver and weight comparison in `lib/weights.ts`, with explicit alias metadata in the routine catalog.
- [x] Test and implement a paginated, user-scoped history read in `lib/db/queries.ts`. Exclude the active session and warmups; retain history for deleted plans.
- [x] Test and implement editable suggestion and completed-exercise feedback cards in `components/ExerciseWeight.tsx`.
- [x] Integrate immutable prior-workout baselines and replaceable current-session set logs into the player. Show feedback only after all sets of the exercise, including circuits. Reflect rest-screen corrections immediately.
- [x] Pass the user's units to the existing summary progression calculation.
- [x] Run focused tests, the full suite, TypeScript, and browser runtime verification. Publish the verified change to the existing Expo project.

Verified 248 tests across 33 suites, TypeScript, native iOS/Android production exports, and an authenticated live history read. Browser runtime verification used isolated fixture data: a 42.5 kg suggested target from an equivalent exercise, corrected 47.5 kg sets, and a +7.5 kg comparison against a 40 kg prior workout. The three completed sets persisted without duplicate keys. Physical phone execution remains for the user to test with the Expo QR.

## Verification cases

Exact and equivalent exercise history; saved target versus actual previous weight; first recorded workout; missing-history errors; bodyweight added load; timed holds; kg/lb; final circuit round; corrected logs replacing earlier values; signed increases/decreases without unsupported strength claims; user ownership and pagination.
