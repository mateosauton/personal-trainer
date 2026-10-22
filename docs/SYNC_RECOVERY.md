# Rejected workout sync recovery

A database validation rejection no longer blocks all later workout writes. The account's queue first copies the complete operation and error code into a separate local recovery archive, then removes the rejected entry from active replay. If either storage step fails, the queued entry is retained or the archived copy remains available for retry.

Home shows pending writes and rejected writes even if its dashboard cannot load. Retry workout sync requeues the latest unresolved correction for each set. A newer correction already in the active queue wins over older archived data. After the server acknowledges a set, archived failures for that operation are marked resolved; their recovery copies remain on the device.

Network errors, timeouts, authentication errors, permission errors, and unknown server errors remain pending. Only specific PostgreSQL validation errors are quarantined: null violations (23502), missing parent references (23503), check violations (23514), invalid typed values (22P02), and numeric overflow (22003). The distinction follows [PostgreSQL's SQLSTATE definitions](https://www.postgresql.org/docs/current/errcodes-appendix.html).

A summary cannot apply progression or clear its saved workout while that session has rejected or pending writes. Another session's rejected writes do not block it. Legacy operations with no session ID are treated conservatively as potentially relevant to every summary.

## Verification and remaining work

Tests cover rejected-head bypass, restart recovery, account isolation, failed archive persistence, correction edits during an in-flight send, latest rejected correction selection, retry UI, and summary protection.

Malformed queue JSON and malformed archive JSON are preserved and reported; they still require an explicit export/repair workflow. The recovery archive must be included in future account export/deletion controls. Native restart/offline acceptance and server ordering of ambiguous late writes remain required before closing issue #5. Browser cross-tab coordination remains separate work; web is a test surface.
