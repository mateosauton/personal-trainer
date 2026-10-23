# Native release

The native app is the product release target. Web builds help with previews.
Use a clean checkout of the exact master commit intended for publication.

## Verify a candidate

1. Record `git rev-parse HEAD`; run `npm ci` and `npm run check:web`.
2. Build Android with `npx eas-cli@23.2.0 build --platform android --profile release-test`.
   This installs production configuration on a separate `release-test` update
   channel. Use a dedicated test account. For iOS, build and install the same
   profile on an actual iPhone, with the required signing and distribution setup.
3. Verify sign-in and recovery, then supported onboarding inputs such as body
   measurements and goals. Check exercise choices against the configured gym
   equipment. Record any unsupported preferences or personalization explicitly.
4. On the phone, start today's workout, read exercise instructions, log a set,
   rest, background and reopen the app, finish a workout offline, reconnect, and
   confirm saved history without duplicates. Restart and switch accounts to
   check resume behavior and account isolation. Confirm controls remain usable
   with the keyboard open and near the phone's bottom safe area.
5. Record the full commit SHA, EAS build UUID, platform/device, results, and any
   limitations in the release PR. A web export alone does not pass this check.

## Publish

Run GitHub's `CI/CD` workflow on `master`. Enable `publish_native` and provide
`tested_sha`, `native_build_id`, and `release_platform` from the verification.
See [CI](CI.md) for the exact checks. Only the selected platform receives the
update. Repeat for another platform after testing its build.

The workflow validates input format and commit equality and records an operator
attestation. It does not inspect the remote build or prove the device tests ran.
If master advances before publication, retest the new candidate before retrying.

Native dependencies and configuration use Expo's fingerprint runtime policy.
For a runtime change, build production binaries from the verified commit with
the `production` profile and distribute them through the intended store or
testing route. This workflow does not automate builds or store submission.
An update cannot replace an incompatible installed native runtime.

Preview builds use the preview environment and channel. Configure that backend
deliberately; keep test passwords and developer login flags out of production
EAS variables. See [releases](RELEASES.md) for rollback and database boundaries.
