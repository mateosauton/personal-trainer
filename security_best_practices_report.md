# Security review, October 21, 2026

Three subagents reviewed client authentication and persistence, database authorization,
and dependencies/CI/tooling. Two new medium-severity vulnerabilities were reproduced
and filed as GitHub issues. Existing security tickets were checked to avoid duplicates.

The working tree is on `codex/timed-ppl-routine` at `34fcd92` with substantial existing
uncommitted work. Findings below were also verified against the newer default-branch
source at `45af39674aeefe65a2097a33de0e004ad0d36e4a`. GitHub file reads confirmed the
reported source matches the current default branch. Application source was not changed.

## Medium severity

### 1. Unsolicited authentication callbacks can replace the active account

Issue: [#45, Bind auth callbacks to an initiated login](https://github.com/mateosauton/personal-trainer/issues/45).

Evidence on the reviewed default branch:

- `lib/deep-link.ts:49-57` imports arbitrary fragment tokens through `setSession`.
- `lib/auth.tsx:82-104` processes startup/runtime links without a pending auth transaction.
- `app.json:8` registers the public `officegym` scheme.

An attacker with their own valid project account can send a crafted `officegym` link.
Opening it silently signs the victim into the attacker's account, including when the
victim already has a session. Measurements and workouts entered afterward can be
submitted to the attacker-owned account. Existing victim-account data was not shown
to leak. This is separate from #42, which tracks tokens remaining in web callback URLs.

Validation executed the exact default-branch callback using the installed Supabase SDK,
synthetic users/tokens, and mocked Auth responses. An unrelated-path callback returned
success and replaced synthetic account A with B. The primary reviewer reran the proof.
No live accounts, real tokens, or network requests were used.

Fix criteria: bind callbacks to initiated auth transactions, preferably using PKCE;
restrict callback routes; reject unsolicited implicit credentials; prevent silent
cross-account replacement. Test signed-in/signed-out, native/web, confirmation and
recovery flows. [Supabase PKCE guidance](https://supabase.com/docs/guides/auth/sessions/pkce-flow).

### 2. Preview server can read files outside its configured root

Issue: [#46, Block path traversal in the preview server](https://github.com/mateosauton/personal-trainer/issues/46).

`tools/dev/serve-dist.mjs:20-26` decodes the URL before joining it to the root, without
checking containment. Line 27 omits a bind hostname. While the preview tool runs,
any peer able to reach its port can request an encoded traversal such as
`/..%2foutside-fixture.txt` and retrieve a readable sibling file.

Two reviewers independently executed the original default-branch request handler
with real temporary synthetic files and intercepted server binding. Both obtained a
200 response containing a sentinel outside `dist`. Valid root requests also returned
200. Malformed URL encoding throws an unhandled `URIError` in the same handler.
No real secrets were read. A socket-based attempt was blocked by the execution
sandbox; the successful proof exercised the original handler without opening a port.

This finding concerns the development preview server. Exposure of the hosted static
app was not established. [Node documentation](https://nodejs.org/api/net.html#serverlistenport-host-backlog-callback)
confirms that an omitted hostname listens on unspecified interfaces.

Fix criteria: enforce root containment after decoding/resolution, account for symlink
escapes, bind loopback by default, and handle malformed URLs. Test encoded traversal
and valid static assets/SPA fallback.

## Existing findings and review coverage

- Avatar visibility/listing remains covered by [#7](https://github.com/mateosauton/personal-trainer/issues/7).
- Callback token retention remains covered by [#42](https://github.com/mateosauton/personal-trainer/issues/42).
- Dependencies remain covered by [#22](https://github.com/mateosauton/personal-trainer/issues/22).
  The default-branch npm audit reported 69 affected dependency nodes, 14 moderate and
  55 high, with no critical nodes. These are audit dependency counts, not 69 confirmed
  application vulnerabilities. No additional reachable exploit was established.
- Default-branch database migrations fix the old checkout's foreign-parent ownership
  gaps. Source review checked RLS, privileged RPC ownership checks, direct-write
  restrictions, and owner-filtered account export. No novel database exploit was found.
- Default-branch CI fixes the old EAS commit-message injection and pins the patched
  `shell-quote` override. No tracked private secret or new PR-triggered secret exposure
  was confirmed. The committed Supabase publishable configuration is public by design.

## Limits

This was source review plus isolated proofs and dependency auditing. Hosted database
configuration and installed native auth flows were not tested. SQL regression suites
were not executed. No production changes, commits, pushes, or fixes were made. The
only new workspace artifact is this report; the two issue creations are verified.
