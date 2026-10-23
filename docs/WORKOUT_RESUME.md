# Workout recovery

The account's last usable plan and progression are cached on the device. Home and Plan can open the last confirmed next workout while offline. Recent changes from another device appear after reconnecting. A first plan still requires online setup.

Begin saves a workout snapshot and client-assigned UUID before any server request. The snapshot includes the original day, units, bodyweight, progression, local training date and timezone. Retrying Begin resumes the same saved workout. Failed local storage prevents a network start.

The outbox replays `start_session` before sets. The additive `20261022224931_idempotent_session_start.sql` migration makes repeated starts acknowledge the same UUID and captured context. It derives ownership from authentication and rejects changed or foreign starts. Retired owned plan days remain valid for a workout begun from an offline cache.

Cursor changes, drafts, recorded sets and timer deadlines remain durable. Restart restores the original snapshot without reloading the plan. Paused timers retain their offsets, and a completed workout keeps its frozen active duration.

Ending a workout leaves a durable finalization intent in that snapshot. Account sync reconstructs missing start, set and finalization operations after restart. Finalization waits for acknowledged sets, checks the server's complete version snapshot, and saves progression plus its existing idempotent receipt. It runs independently of the summary screen. Conflicting sets block finalization and stay available for explicit review.

The summary immediately displays recorded local sets while offline. Pending results do not claim a personal record or a next-load change. Confirmed progression receipts are saved locally before clearing the matching workout snapshot. A concurrent local change or failed storage write preserves the draft. Beginning another workout returns to the saved workout until finalization succeeds.

Transient sync failures retry up to six times with exponential backoff and jitter, capped at 30 seconds between attempts. Enqueue, connectivity and foreground events can start a new retry cycle. Backgrounding, sign-out and account changes stop scheduled retries. Delivery resumes when the app becomes active.

## Verification and deployment

Recovery tests cover offline starts, parent-before-set replay, missing queue reconstruction, lost responses, local storage failures, screen-independent finalization, receipt reuse, pause duration and account isolation. Component checks cover cached-plan entry and pending summaries. Database checks cover ownership, invalid context, replay and immutable start identity.

`npm run test:recovery-db` uses disposable PGlite databases by default. Set `PT_LIFECYCLE_DB_URL` and `PT_ORDERING_DB_URL` to local PostgreSQL to run separate-connection start and set-ordering races. CI supplies a disposable PostgreSQL service. These checks do not verify hosted Auth, production schema or installed native behavior.

Existing saved workouts and old completion queue entries remain readable. Invalid saved data is preserved for recovery.

Production migration `20261022224931` was applied to `office-gym-trainer` (`asbudyijvunpnhrhsubm`) on 2026-10-22 through the SQL Editor. The function and migration-history entry were committed together. The recorded SQL matches the repository file (MD5 `9c3fe81642c36f311a051e1ce5cc8028`). Verification confirmed security invoker, an empty search path, authenticated-only execution and unauthenticated denial. The six existing sessions were unchanged. No app update was published manually.
