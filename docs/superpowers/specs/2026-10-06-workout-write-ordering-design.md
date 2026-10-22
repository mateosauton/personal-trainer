# Ordered workout writes

## Problem and release requirement

The current set upsert accepts whichever request commits last. Local reproduction using the existing schema and owner role showed a corrected 12-rep set overwritten by an older 8-rep request. Cancelling a client request does not retract a server-accepted write.

The launch requirement is stable sets after retries, corrections, restart, device changes, and summary receipt creation. Existing production migration approvals remain pending. This backend change must not be applied without its matching client and explicit production approval.

## Protocol

Each set has a server version. Each device origin has a monotonically increasing revision for that set. Revision and exact payload, including its original event time, are persisted together before enqueueing. An unfinished durable journal operation can reconstruct an interrupted enqueue. Origin allocation and revision changes are serialized across shared-storage writers; web uses a cross-tab lock.

The database RPC takes session, set payload, origin UUID, origin revision, captured server version, and event time. It shares the account advisory lock and session lock used by progression. It verifies owner, original plan day, item, and exercise, then:

1. A lower revision already superseded within that origin returns a superseded acknowledgement.
2. An accepted equal revision with identical payload/event time returns duplicate or superseded without mutation; different content is rejected.
3. A higher revision from the current origin applies, even when intermediate local versions were replaced before transmission.
4. Changing origins requires the captured server version to equal the current version. A mismatch is a conflict, never an automatic overwrite.
5. New mutations after a progression receipt are rejected. Previously accepted/superseded requests may still be acknowledged.

A private per-set version table and private per-origin history retain ordering across A/B/A device interleavings. Existing set values and event times stay unchanged; metadata starts at server version one. Direct authenticated set insert/update/delete privileges are revoked, so older clients cannot bypass ordering.

## Summary consistency

Summary reads logs and their versions together through `get_session_set_snapshot`. The five-argument `apply_session_progress` compares the complete set membership and server versions under the same account/session locks before applying progression. A correction or additional set after the read returns `40001`; the client must reload both logs and progression before recalculating. Existing receipt replay remains idempotent. The old four-argument RPC is revoked from client roles.

## Legacy and conflicting data

Unversioned queued sets never receive an artificial newer revision. Identical server content may be acknowledged without writing. Missing or differing content remains recoverable and requires explicit review against current server data.

The recovery UI compares the user's saved set with the server set. Choosing the saved value creates a new operation against the displayed server version. A changed server version returns another conflict. A newer local correction also invalidates the displayed choice. Retry alone never refreshes a conflict's baseline silently.

## Verification

Use real PostgreSQL with separate connections for older/newer commit ordering, origin A/B/A, same revision/different content, account isolation, receipt-versus-correction locking, and old direct-write rejection. Use disposable data only. Also test journal crashes before enqueue and after acknowledgement, shared-origin allocation, late auth responses, and conflict UI account changes.

PGlite checks can cover SQL syntax and role behavior; its single connection cannot prove concurrency. Native offline/restart flows must use a fresh build tied to the exact reviewed revision.
