# Release safety

This change removes production OTA publishing on every `master` push. The only repository production native publisher is **Promote tested native update**, dispatched manually from `master`. It promotes one already tested platform and update group, preserving its JavaScript and assets. Merging a PR does not publish a native update.

## One release, three distinct identities

| Identity | Purpose | What the gate verifies |
| --- | --- | --- |
| Candidate update group | Exact JavaScript and assets tested on a phone | EAS project, one platform, clean source SHA matching current `master`, `production` environment, `release-test` branch, production backend marker and asset manifest hash |
| Tested device build | Native runtime used during the phone test | Finished `release-test` internal build, production EAS environment, release-test channel, clean source, application identifier, fingerprint and runtime |
| Installed production build | Native binary the target users already have | Finished production store build, production EAS environment/channel, clean source, application identifier, fingerprint and runtime |

The candidate runtime must equal both binary runtimes and their EAS fingerprints. A JavaScript fix can reuse an earlier binary whose commit is an ancestor of the candidate. Native dependency or config changes require new binaries. A valid-looking build UUID is only input syntax; release authorization comes from authenticated EAS metadata.

## Prepare once

1. Register the isolated development and preview backends as described in [ENVIRONMENTS.md](ENVIRONMENTS.md). Production remains the registered production project. Do not copy production credentials into preview.
2. Configure `APP_ENV=production`, `EXPO_PUBLIC_APP_ENV=production`, the production URL, and its public key in the EAS `production` environment. Plain text or Sensitive variables are available to `eas env:exec`; Secret variables cannot be bundled on the local runner. Never include service-role keys or developer login credentials.
3. Keep `release-test` and `production` EAS channels on separate, identically named branches. Both must have one unconditional mapping and be unpaused. Split channel rollouts are deliberately rejected by this first pipeline.
4. Add `EXPO_TOKEN` to the GitHub `production` environment. Restrict that environment to `master`; configure a required reviewer if your GitHub plan supports it. The workflow requests the environment, but repository code cannot provision or prove its protection settings.
5. Build and distribute the first binaries containing the environment checks and manifest markers. Existing binaries without the required EAS metadata or compatible fingerprint cannot pass this gate.

## Prepare and test a candidate

Use a clean checkout of the current `master` commit, Node 22 and EAS CLI 23.2.0. Run `npm ci`, `npm run lint`, and `npm test -- --runInBand --testTimeout=20000`.

Load production environment values explicitly for candidate export:

```sh
EXPO_NO_DOTENV=1 npx eas-cli@23.2.0 env:exec production \
  'node scripts/publish-update.cjs --channel release-test --environment production --platform android --message "Candidate workout fix"' \
  --non-interactive
```

For iOS, change the explicit platform to `ios`; create and test a separate group. This command uploads to the release-test channel. It is an operator action and should only be run after the code is ready for a phone test.

The wrapper validates the selected environment and backend **before starting EAS**, disables dotenv loading and invokes pinned EAS CLI 23.2.0. It carries the requested target in the private `TRAINER_UPDATE_APP_ENV` marker through EAS into the actual Expo export. If refetched EAS values select a different app environment, export fails before an update can be published. It requires exactly one channel, environment, platform and nonempty message. It rejects direct production publishing, branch targeting, skipped bundling, old input directories, duplicate arguments and unknown options. The only supported pairs are `release-test` with `production`, and `preview` with `preview`; preview also requires a separately registered backend. For an isolated preview, load `eas env:exec preview` and pass `--channel preview --environment preview` to the same wrapper.

Install a matching release-test build and load **that exact update group**. Verify its group ID in the Expo update diagnostics/EAS dashboard before recording results. In an issue or PR, record source SHA, platform, update group, test build, intended installed production build, phone/OS, test time, and these results:

- Sign in, sign out, account switching and password recovery work without showing another account's state.
- Onboarding uses the user's actual gym equipment; the resulting plan and exercise details are usable on the phone.
- Start a workout, record/edit sets, finish it, restart, and confirm history and totals.
- Disconnect, record a set, reconnect, and confirm replay without duplicates or lost progress.
- Confirm current database migrations/RPCs remain compatible with installed clients and the candidate. List any prerequisite backend deployment.

The workflow checks the identities. The phone test and backend compatibility statements are explicit human attestations, not automated device or database proofs. Use a test account; the release-test build intentionally contacts the production backend.

## Promote

Open GitHub Actions → **Promote tested native update** → **Run workflow**, select `master`, and enter the exact source SHA, one platform, candidate group, tested device build, intended installed production build and the evidence issue/PR URL. Confirm the attestation only after completing the checks above.

The runner validates local production config, fetches actual EAS records, checks binary source history, verifies separate channel mappings, then re-fetches metadata and current remote `master` immediately before publishing. It calls `update:republish` with the verified destination **branch**, avoiding channel creation/remapping during promotion. It never regenerates the bundle. After the write it verifies the production group's asset manifest equals the tested candidate.

Download the `native-release-<run-id>` artifact. The receipt records source, platform, runtime, backend, build identities, candidate/production groups, bundle hash, evidence, operator and timestamps. It contains no API token, public key, or raw manifest.

## Failure and rollback

A validation failure stops before the production write. Fix the cause and repeat the relevant checks. If `master` advanced, export and test a candidate for its new SHA; this pipeline deliberately does not release an older commit.

An error after the republish starts is an **unknown write outcome**. The receipt says `unknown-after-promotion-attempt` and includes the new group ID if received. Inspect that group and production channel in EAS before retrying; a timeout does not prove no update was published.

For an incident, stop new promotions. Identify the last known-good compatible group from receipts, its runtime, backend compatibility and affected platform. A maintainer can republish it to the production branch using EAS 23.2.0 after confirming these facts; save a recovery record and observe the resulting group. This is a deliberate emergency operation outside the normal current-master gate. Users may continue running a downloaded bad update until the recovery downloads. If native code is wrong, ship a corrected binary; an OTA cannot replace native code. Prefer forward database fixes over destructive migration rollback while old clients are installed.

## Deliberate limits

- This pipeline supports the repository's current **unsigned EAS Update** configuration. Any remote or local signing configuration is rejected. Introducing signing requires a reviewed certificate/key distribution design and new compatible binaries. App-store binary signing remains managed by EAS and the stores.
- The supported publishing paths are this candidate wrapper and the manual promotion workflow. EAS 23.2.0 discovers configuration through child `expo config --json` calls, which cannot see the outer command's channel arguments. Discovery without valid variables returns app identity without routing proof; actual exports remain strict about their environment and backend. These checks cannot bind a raw `eas update` or `update:republish` invocation to the repository channel policy. A user holding EAS publishing permissions can bypass repository scripts, so restrict those permissions and use the supported paths. The guarded wrapper pins the target through config discovery and actual export; do not configure `TRAINER_UPDATE_APP_ENV` in shared EAS environments, where it could override the wrapper's private child-process value. Avoid editing EAS variables during candidate publication.
- EAS fingerprints and source metadata are evidence from EAS; the gate trusts the EAS account, token, GitHub workflow code and dependencies. It does not establish device-test authenticity or inspect a store-installed binary remotely. The operator must identify the actual production build cohort correctly. Different runtime cohorts need separate release decisions.
- GitHub serializes this workflow without cancellation; manual CLI writes or other repositories can bypass that lock. Restrict EAS publishing permissions. GitHub/EAS cannot atomically lock the Git branch and update service together: a small race remains after the final `master` read. Freeze merges during promotion when strict source stability is needed.
- Channel state can change after validation. Restrict channel administration and avoid channel edits during release. The explicit destination branch prevents this script from creating or choosing a different branch during its write.
- Native build submission, store rollout, production database migration and Edge Function deployment remain explicit operator operations. This PR performs none of them.
- Legacy GitHub Pages/CDN export/push workflows and the old Vercel URL probe were removed. They were alternate automatic publishing paths and did not prove artifact source identity. Existing remote sites/branches are not deleted by removing workflows. Cloudflare hosting uses the guarded export path described in the environment documentation; it is configured outside this workflow.

## Verification and sources

`node --test scripts/release-safety.test.mjs` runs the policy cases and a runner integration suite with fake `git` and `eas` executables in a disposable directory. It proves mismatches stop before republish, a late `master` movement stops publication, promotion reuses the exact group, payload changes are caught, and ambiguous writes keep a receipt. No test publishes a real update.

`node --test scripts/publish-update.test.cjs` verifies the candidate wrapper with an injected child process. It checks exact pinned CLI arguments for both supported targets and proves routing conflicts, unsupported options, missing configuration, privileged keys and developer credentials fail before any EAS invocation.

The design follows [Expo's deployment guidance](https://docs.expo.dev/eas-update/deployment/) for promoting the tested group. Metadata and CLI behavior are pinned to [EAS CLI 23.2.0 schema](https://github.com/expo/eas-cli/blob/v23.2.0/packages/eas-cli/src/graphql/generated.ts), [update JSON formatting](https://github.com/expo/eas-cli/blob/v23.2.0/packages/eas-cli/src/update/utils.ts), [republish command](https://github.com/expo/eas-cli/blob/v23.2.0/packages/eas-cli/src/commands/update/republish.ts), and [republish implementation](https://github.com/expo/eas-cli/blob/v23.2.0/packages/eas-cli/src/update/republish.ts). In this version, `update:view --json` omits environment, dirty-source and signing metadata, so the gate uses authenticated read-only GraphQL queries. Missing fields or a changed API fail closed. The release receipt preserves the relevant verified values.
