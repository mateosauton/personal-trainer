# Durable set-write journal

`SetJournal` is the write-ahead portion of the ordered workout protocol in migration 0007. It is wired to the app transport for ordinary sets and legacy comparison. The matching-client PR remains a draft until legacy conflict recovery, reopened-session bootstrap and native verification are complete.

Each account gets its own storage key. A set write persists a UUID origin, monotonically increasing revision, exact payload, captured server version, and original completion event time before enqueueing. Ordinary corrections retain that event time. Recovery re-enqueues pending writes without creating new revisions. A failed enqueue or acknowledgement storage write keeps the operation recoverable after restart.

Callbacks must only durably enqueue; never await server acknowledgement while the journal lock is held. Native journal instances share a per-key serialization lock. The browser transport supplies a Web Locks adapter for both journal and queue storage. Browsers without Web Locks fail before storage mutation. The default journal lock coordinates one JS runtime only.

An acknowledgement changes the record only if the complete write still matches. It cannot clear a newer correction. Superseded responses do not silently adopt a different device's server version. Blocked writes survive restart and are excluded from normal recovery.

Explicit conflict resolution verifies that the reviewed local write is still blocked and unchanged, preserves its recovery copy, and creates a new origin against the displayed server version. The new origin makes migration 0007 enforce its cross-origin comparison even if the previous write came from this device. Choosing the server value must also enqueue such a fencing write; merely dropping the local queue would leave an earlier in-flight request able to change it.

A normal edit to a blocked set preserves the rejection copy and the original baseline. It cannot silently overwrite a newer remote value. Invalid JSON, foreign-owner data, invalid payloads, and revision exhaustion fail without replacing stored data.

The journal must be included in account export/delete work. Recovery copies are retained until an explicit recovery/export policy is implemented.

Verified: 18 journal regression tests; the branch's 33 suites / 248 tests and TypeScript pass. Unit checks used the installed SDK 57 test runtime with a temporary compatibility setup; that file is excluded from the PR. A disposable Chrome two-tab fixture using the actual compiled journal, queue and lock adapter verified an interrupted first enqueue holds the second correction until release; both records then contain 12 reps, revision two, one origin and the original event time. This does not verify the full app or native flows. Native flows remain unverified for this module.

The source SDK 54 branch uses `expo-crypto ~15.0.9` as recommended by [Expo's versioned documentation](https://docs.expo.dev/versions/v54.0.0/sdk/crypto/). The installed SDK 57 test runtime uses `expo-crypto 57.0.3`; the combined release must use its SDK-compatible Crypto version and a fresh native binary.

Transport rejects expired or account-switched responses before journal acknowledgement. Legacy queued sets are compared without mutation and differing values remain unresolved. Retry does not replay a conflict or an older retryable rejection beneath a newer conflict. Journal and outbox state are combined when counting unresolved sets. Recovery archive writes share the same platform storage lock; older acknowledgements cannot clear newer rejected copies.

Summary uses `get_session_set_snapshot` and passes its complete versions to the five-argument progression RPC. A stale-set or progression baseline response reloads both sets and progression before recalculating; exhausted retries preserve the saved workout. New local workouts capture bodyweight alongside units, and both rest and summary use that context. Explicitly unknown bodyweight stays unknown. Older records or sessions with no local snapshot retain the profile fallback; server-backed context and cross-device resume are tracked in #30.

Home now compares blocked journal writes with an owned server snapshot and offers explicit saved/server choices. Reads expire after 15 seconds and cannot expose another account's result. A sign-out invalidates previously captured reviews even if the same account returns. Finalized workout rejections are read-only. Legacy queued conflicts still require the separate explicit recovery path before release.

The review also captures the local workout snapshot. Choosing a value checks that snapshot under the workout storage lock, then validates the exact blocked journal entry under the journal lock. The order is workout, journal, outbox. Reconciliation first preserves the old draft and writes the new draft as unsaved; only a durable journal write and enqueue allow savedDraft to advance. Both reviewed set values and any unsent rest draft, original units and captured bodyweight remain in the journal after the active snapshot is cleared. Invalid saved comparison records fail closed.

Warm Run screens use the last confirmed persisted snapshot to guard both enqueue and transitions. A recovery choice prevents an older screen from re-saving its draft. Optimistic edits keep their separate disk expectation after a temporary storage failure, allowing retry without losing the visible edit. The actual Run regression uses the real journal/outbox/store through conflict choice, warm-screen rejection, restarted rest, remaining set and workout completion. Native flow verification remains required.
