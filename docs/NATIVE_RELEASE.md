# Native release

The native app is the release target. Web deployments are test previews.

Build and update compatibility uses the Expo fingerprint policy. Changing native dependencies requires a fresh build; old appVersion 1.0.0 builds cannot receive these updates.

## Verification

1. Run `npm ci`, `npm run lint`, and `npm test -- --runInBand --testTimeout=20000`.
2. Build Android with `npx eas-cli@23.2.0 build --platform android --profile release-test`. This uses production configuration with a separate release-test update channel.
3. Install the resulting APK and verify sign-in, onboarding, workout completion, offline replay, restart, account switching, history, and password recovery. Record the tested commit and build ID.
4. Build production binaries from the same verified commit. The production profile uses the production environment and update channel.
5. Publish updates only after native flow verification: `EXPO_NO_DOTENV=1 npx eas-cli@23.2.0 update --channel production --environment production`.

Preview builds use the preview environment and channel. Configure its backend intentionally before testing. Do not put test passwords or developer login flags in production EAS variables.

The first fingerprint build must be distributed as a new binary. Publishing an update does not upgrade the native runtime of an installed app.
