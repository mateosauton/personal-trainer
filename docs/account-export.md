# Account export

Profile offers “Export synced data”. It produces a versioned JSON file containing the caller's profile, all plans and their days/blocks/items, sessions with saved summaries, set logs, and exercise progression. It excludes authentication credentials, sync receipts, avatar file contents, and unsynced local edits. The screen explains this scope.

A stable, security-invoker PostgreSQL function derives ownership from auth.uid() and reads one database snapshot. It accepts no owner argument and retains RLS. Exporting more than 1,000 rows must not truncate history. Anonymous callers cannot execute it.

The client checks the current account before and after fetching the snapshot and validates its owner before creating the file. Android/iOS use a temporary JSON file and the system share sheet; the user chooses its destination. iOS removes it after the sheet closes. Android keeps the attachment in app-private cache so a delayed receiver can read it; files older than 24 hours are removed at the next startup or export. Web downloads a local Blob. Errors retain account data and show retry feedback. This requires the export migration and fresh native binaries with Expo Sharing.

Implementation and verification:

- Write failing SQL tests for complete history, another account, anonymous access, and omission of internal receipts.
- Implement the read-only RPC and run rollback-only SQL tests against disposable local Supabase.
- Write client tests for an account switch, failed RPC, malformed snapshot, file cleanup and unavailable sharing.
- Add file delivery and Profile action; run Jest, TypeScript, independent review and CI.
- Verify native JSON delivery before merging into the launch candidate. Production migration and release remain separate gates.
