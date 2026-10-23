# Dependency review, October 22, 2026

This review addresses [#22](https://github.com/mateosauton/personal-trainer/issues/22).
The current Expo SDK 57 lockfile was audited with npm. Counts describe
affected packages, including parents that inherit a leaf advisory. They do
not represent independent exploits or prove that every flagged package ships
in the installed app.

| Scan | High | Moderate | Critical | Total |
| --- | ---: | ---: | ---: | ---: |
| Before patches, all dependencies | 54 | 5 | 0 | 59 |
| After patches, all dependencies | 51 | 5 | 0 | 56 |
| After patches, `--omit=dev` | 47 | 3 | 0 | 50 |

The omit-dev scan still includes Expo CLI, Metro and code-signing tooling
under application dependencies. It is not a scan of a native bundle. The
earlier issue's 73-package count is historical.

Reviewed lockfile SHA-256:
`ac6277709a55ea3ee8768c41ca585bc21747dd3b0b6ad427c8a5196e1c4638f7`.

## Compatible patches applied

Only seven installed leaf-package instances changed in `package-lock.json`.
All satisfy their existing parent dependency ranges. Expo, React Native,
native modules and direct dependency versions stay at their existing versions.
No overrides or forced audit fixes were added.

| Package | Before | After | Advisory |
| --- | --- | --- | --- |
| `brace-expansion`, four Jest/test-exclude copies | 1.1.18 | 1.1.21 | [Quadratic expansion](https://github.com/advisories/GHSA-q2hr-2g5m-vwhr), [nested groups](https://github.com/advisories/GHSA-qhr7-859c-m2p7), [comma parsing](https://github.com/advisories/GHSA-6j4f-fj2g-mc7p) |
| `brace-expansion`, minimatch copy | 5.0.9 | 5.0.12 | Same brace-expansion advisories |
| `fast-uri`, AJV dependency | 3.1.6 | 3.1.9 | [Port injection](https://github.com/advisories/GHSA-qw65-cvwx-89v3), [bracket parsing](https://github.com/advisories/GHSA-58mr-gqgx-xq4g), [host normalization](https://github.com/advisories/GHSA-hrr3-gc8f-f4qj) |
| `http-cache-semantics`, development cacheable-request dependency | 4.2.0 | 4.3.0 | [Cross-user cache reuse](https://github.com/advisories/GHSA-ch52-4w7c-c8xp) |

The pre-existing `shell-quote` patch remains at 1.12.0.

## Remaining advisory roots and exposure

| Root | Installed version | Exposure and decision |
| --- | --- | --- |
| [`decode-uri-component`](https://github.com/advisories/GHSA-vcc3-ghjq-m6fr) | 0.2.2 | Expo Router imports `query-string` in path parsing and serialization; `query-string` uses this decoder. Malformed incoming links can reach client code, so native and web denial of service remain plausible. The available 0.5.0 falls outside the parent's `^0.2.2` range. Keep open for an upstream-compatible Router fix or a separately tested decoder replacement. No accepted runtime risk is claimed. |
| [`braces`](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) | 3.0.3 | Glob parsing through micromatch in Jest and Metro. This is test, development-server and bundling exposure; the app does not import glob matching. npm reports no patched version of this package. Use trusted project/configuration inputs, keep Metro off public networks except an intentional test tunnel, and track the upstream fix. Native bundle exclusion still needs artifact inspection. |
| [`node-forge`](https://github.com/advisories/GHSA-86w9-cpqp-85rv) | 1.4.0 | Imported by Expo CLI iOS signing and `@expo/code-signing-certificates`. Signature-verification weakness matters where those Node tools verify attacker-controlled material. No app source import was found, and this is separate from native Expo Updates verification. npm reports no patched version. Keep signing inputs trusted and track Expo/tooling updates; no native signature-bypass claim is established. |
| [`uuid`](https://github.com/advisories/GHSA-w5hq-g745-h8pq) | 3.4.0 | Development-only `@expo/ngrok` dependency. Advisory requires v3/v5/v6 with a supplied output buffer. It is absent from the omit-dev audit. A forced major UUID override could break the old CommonJS consumer and was not applied. This is a local tunnel-tool risk, not evidence of a shipped workout-runtime flaw. |

The available npm suggestions include incompatible Expo, React Native and
Jest changes. Those require their own SDK compatibility review. A lower
advisory count alone does not justify such a change.

## Reproduce and release gate

```sh
npm audit --json
npm audit --omit=dev --json
npm run lint
npm run test:unit
npm run test:db
EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 EXPO_PUBLIC_SUPABASE_KEY=mock npm run build:web
```

Audit commands exit 1 while advisories remain. A registry/network failure is
not a clean audit. Save the JSON and lockfile hash with the release record.
The compatible patches need fresh candidate native builds and regression
verification before launch. This document does not accept the remaining
runtime decoder risk or establish native verification.
