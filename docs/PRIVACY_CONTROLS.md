# Account privacy controls

These changes are local source work for issue #7. No hosted bucket, account,
function or production migration was changed during this work.

## Photos

The private-avatar migration makes the `avatars` bucket private and limits
reads to the authenticated owner's directory. Uploads persist an object path
in `profiles.avatar_url`. Both network and cached profile reads normalize legacy
Storage URLs to owner paths. Visible avatars resolve these references into
five-minute signed URLs for the current project's bucket and refresh access
every four minutes and on app foreground.
Unknown external URLs and another account's paths are hidden. A photo signing
failure hides the photo without preventing profile or workout access.

Pair the migration with the client. Old clients which render public URLs will
lose photo access after the bucket becomes private. Already cached public
images cannot be recalled. Signed URLs remain usable until expiration.

## Export

Profile's account export includes the existing owner-scoped database snapshot
and exact raw values from this device's profile cache, outbox, rejected updates,
set journal, active workout, old progression archive and repair backups. Broken
JSON is retained verbatim. The unowned legacy global queue is not attributed
to the signed-in account. Photo binaries, credentials, and other devices'
unsynced changes are not included. Recovery export on Home remains available
without a working backend.

## Deletion

Profile asks for explicit confirmation before calling `delete-account` with a
frozen user token and expected account ID. The function verifies the token
against Auth, requires the expected ID to match that verified account, deletes
its avatar files through Storage, revokes refresh sessions, and deletes the
Auth user. Existing foreign keys cascade deletion through app records. The
service role key stays in the function environment.

The client stops replay before requesting deletion. It signs out locally and
removes only that owner's local keys after a confirmed response. A switch to
another account does not sign that account out or erase its data. Rejected or
ambiguous network requests retain local recovery data. A lost response may
require signing in again to establish whether deletion finished. If local
cleanup fails after confirmed server deletion, that failure is reported.

Deployment requires the function entrypoint in `supabase/config.toml`, its
normal server environment variables, and the paired private-avatar migration.
Do not put a service key in `EXPO_PUBLIC_*`. Deletion of a real account is a
destructive user action, not a deployment smoke test.

## Evidence and remaining checks

Core tests cover account mismatch, fixed-token deletion, account switching,
backend failure retention, photo cleanup ordering, owner path validation,
signed URLs and malformed recovery exports. Disposable PostgreSQL tests cover
owner and anonymous photo reads, foreign uploads, and uploads with a deleted
account's still-unexpired JWT. Fresh-schema and baseline-upgrade checks pass.

The Edge Function adapter has not been deployed or exercised against hosted
Auth/Storage. Hosted signed-image delivery, deletion cascade, revoked-session
behavior, native photo rendering/export sharing, and staging backup/restore
still require service and device verification. Other devices can retain their
own offline caches until they reconnect or explicitly remove local data.
