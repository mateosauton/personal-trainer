# Focused motion implementation plan

**Goal:** Implement the approved set transitions, rest-ready cue, workout finish and plan expansion without delaying workout actions.

**Architecture:** Extend the existing Reanimated components with 140/240 ms timing and a 10 px content entrance. Keep session timers, saving and progression independent of animation. Apply system reduced motion throughout.

**Tech stack:** Expo Router, React Native, Reanimated 4.5.1.

## Implementation

- [x] Add Focused parameters in `lib/motion.ts` and an optional scale to `components/Doodle.tsx`, preserving existing callers.
- [x] Animate the phase content in `app/session/[dayId]/run.tsx` on set/phase changes only. Keep the session header and timers fixed. Show local-save confirmation only after a successful set commit, and clear it on edits.
- [x] Add a single 1.025 scale cue to the ready button in `components/RestPage.tsx`. Keep the clock steady, preserve deadline/pause behavior, and wait for the user's next action. Reopening an expired rest renders Ready without replaying the cue.
- [x] Refine the summary entrance and existing PR animation in `app/session/[dayId]/summary.tsx`. Use 45 ms stagger with a cap. Show accurate numbers immediately; celebrate confirmed achievements once per session. Require both a live finish signal and the route flag so a retained URL cannot replay after restart.
- [x] Fill the newly trained day's pip once in `components/Streak.tsx` after Home confirms the completed session. Keep any transient signal scoped to account/session.
- [x] Add measured 240 ms plan expansion with a 140 ms chevron rotation in `app/(tabs)/plan.tsx`. Interrupt safely and hide collapsed details from accessibility.

## Verification

- [x] Review the motion-only changes against the saved starting files in `/tmp/trainer-focused-motion-baseline`.
- [x] Run `npm run lint`, `npm run test:unit`, and `npm run build:web` with mock environment values.
- [x] Exercise the actual app with the isolated fixture backend: complete and edit a set, observe rest readiness, rapidly expand/collapse plan details, finish a workout with confirmed PRs, and return Home to the new streak fill. Fixture state confirms the two saved sets and corrected second set.
- [x] Request an independent review of the resulting changes and resolve actionable findings.

System reduced-motion paths were reviewed in source. Native visual verification remains unavailable because this host has no `simctl`. The full unit suite intermittently hits the pre-existing UUID mock failure in `export-file.test.ts`; its isolated six tests pass. Completion-motion and existing workout/timer/progression tests pass.

The core Jest suite intentionally excludes screen, layout and animation tests. Use its existing workout/timer coverage and browser checks for this reversible UI change. Do not commit unrelated local work or change dependencies.
