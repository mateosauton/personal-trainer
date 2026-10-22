# Google and Apple sign-in implementation plan

**Goal:** Add Google account creation and sign-in through the existing Supabase project, with Apple optional and disabled until configured.

**Design:** Keep email/password as a fallback. Google uses Supabase OAuth with PKCE and the system auth browser on native. Apple uses the native iOS authorization sheet with a hashed nonce, and Supabase browser OAuth elsewhere. Callback URLs return to the existing app root. All methods reuse the existing session and profile onboarding gate.

**Stack:** Expo SDK 57, Supabase JS 2, Expo WebBrowser, AppleAuthentication, Crypto, Expo Router.

- [x] Add failing callback and provider tests covering success, cancellation, failed callbacks, duplicate code exchange, and nonce binding.
- [x] Implement `lib/social-auth.ts` and harden `lib/deep-link.ts`; enable PKCE in `lib/db/supabase.ts` with native secure randomness and SHA-256.
- [x] Add provider buttons to both auth modes. Use Apple's native button on supported iOS devices. Lock competing actions during sign-in and display callback errors.
- [x] Set the iOS Apple entitlement and Expo plugin. Keep existing profile triggers and row ownership unchanged.
- [x] Handle startup and deep-link failures in `lib/auth.tsx`; prevent stale profile routing and signed-out access to protected tabs.
- [x] Run auth tests, the full Jest suite, TypeScript, and platform exports. Inspect the sign-in screen in the browser.
- [x] Document provider configuration and redirect URLs in `docs/auth-setup.md`.
- [ ] Create the dedicated personal Cloud project, configure Google OAuth, and verify live Google sign-in.
- [x] Skip unavailable Apple setup and gate its UI behind `EXPO_PUBLIC_APPLE_SIGN_IN_ENABLED=1`.

**Hosted prerequisite:** The current environment points to `asbudyijvunpnhrhsubm`. After the owner resumed it on October 21, 2026, the public Auth settings endpoint and dashboard became accessible. The Supabase MCP connection still lacks project access. Both provider configurations are empty and disabled. The owner chose personal account ownership and then chose to skip unavailable Apple setup. Personal Google Cloud is accessible. A new `Office Gym` project, ID `office-gym-512401`, is prepared but awaits explicit approval before creation. The primary web origin was verified as `https://personal-trainer.sautonmateo.workers.dev`; the native callback is already allowlisted. Hosted settings have not been changed.

## Validation

- After skipping Apple: 19 auth-screen/dev-login tests, TypeScript, and web export passed; browser verified Google/email remain and Apple is hidden by default. Existing Apple flow tests explicitly opt in to its environment flag.
- `npm test -- --runInBand --silent`: 33 suites and 248 tests passed. An initial workout-player failure passed on isolated and full reruns.
- `npm run lint`: passed.
- Expo export for web, iOS, and Android: passed with the mock Supabase URL and key and dotenv loading disabled.
- Expo config introspection: generated `com.apple.developer.applesignin: ["Default"]`; runtime policy is `fingerprint`.
- Browser: provider controls in both modes, denied callback error, rejection of legacy implicit token links, email sign-in to onboarding, and session restoration after reload verified against the local mock.
- Actual Supabase JS code challenge generation verified as S256 using the native crypto adapter in a test.
- `npm run docs:verify`: five stale checks remain in the existing engineering handoff for catalog readers, query count, and theme call counts. Auth does not change those counts.
- Live Google/Apple consent and token exchange, Apple provisioning, and physical-device authentication remain unverified.
