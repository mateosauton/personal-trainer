# Native launch blockers implementation plan

Goal: resolve issues 3-8, verify complete authenticated native workout flows, merge reviewed fixes and deploy fresh native builds. Web serves test verification only.
Architecture: keep the deterministic planner. Namespace durable queues by account and bind each send to the matching access token; pause old queue instances on account transitions. Move progression to a transaction that records session application once. Persist the player snapshot and use pending+confirmed logs for offline summaries. Add recovery and privacy operations with owner authorization. Preserve pending SDK57 work while integrating it in a separate release branch. Use fingerprint runtimes and explicit EAS channels to avoid incompatible OTA updates.
Tech stack: Expo/React Native, Supabase/Postgres, AsyncStorage, Jest, EAS, Android emulator.

- [ ] Review and merge PR11-15; fresh tests, type checks and builds required. Release approval review rejected the attempted workflow pause/merge; obtain approval before retry.
- [ ] Issue3 account-safe queue: regression tests for A -> sign out -> B -> A, stale callbacks and legacy quarantine; bind send to exact account/token; start sync inside authenticated provider.
- [ ] Issue5 recoverable queue: preserve invalid payloads, bound sends, separate enqueue from replay, quarantine terminal failures, prevent tab races; persist player snapshots and render pending logs offline.
- [ ] Issue4 progression: inspect deployed schema; add session-scoped server RPC with locking/idempotence and event timestamps; repeat/concurrent replay tests; remove summary-mount progress writes.
- [ ] Issue6 auth recovery: email request and callback/new-password form; initial-session, profile-cache and retry errors; test complete recovery flow.
- [ ] Issue7 privacy: owner storage, account deletion/export, foreign-key ownership, executable two-user/anon RLS tests, staging migration verification and backup/restore evidence.
- [ ] Issue8 native release: resolve paused backend, integrate SDK57/Observe, configure compatible runtime/channels, fresh Android/iOS builds; test signup -> onboarding -> plan -> sets -> summary -> history -> restart/offline replay and account recovery. Record build IDs and release evidence.
- [ ] Address issues9/10 after launch blockers: training preference edits/swaps and explicit timezone semantics.

Execution: write and run failing regressions before implementation; run focused checks and full suite; request independent review; small commit/PR per coherent change. Never close an issue solely on unit tests when its acceptance criteria require a deployed/full-flow check.
