# Training preferences and calendar implementation plan

> For agentic workers: implement and review the GitHub issue acceptance in independent modules. Existing issue requirements and the user's parallel implementation request authorize execution.

**Goal:** Address issues 9 and 10 with editable constrained training plans and a timezone-stable calendar.

**Architecture:** Keep exercise selection in plan helpers, profile editing in an extracted card, and atomic plan/session mutations in owner-scoped RPCs. Derive calendar dates from session timestamps in a persisted home timezone and pass one explicit today key to both views.

**Tech stack:** Expo, React Native, TypeScript, Supabase/PostgreSQL, Jest and the disposable PGlite migration harness.

- [x] Read both GitHub issues, comments, current planner, sessions, and existing local office-inventory changes.
- [x] Add preference editing and onboarding equipment choices using confirmed inventory; keep history through transactional rebuilds.
- [x] Add exact compatible pre-workout swaps with stale-template and account protection; apply the same constraints to PPL activation.
- [x] Add home timezone inference with explicit UTC fallback; keep original capture metadata and derive one display calendar.
- [x] Refresh the shared today key at midnight/foreground and use it in dashboard, streak, calendar and history.
- [x] Verify core selection/calendar cases and real migration transactions/upgrade behavior. Repeat TypeScript and the combined suite after concurrent agents settle.
- [ ] Deploy migrations/RPCs and validate the authenticated native preference, swap, travel, midnight and recovery journeys. No production changes are part of this local implementation.
