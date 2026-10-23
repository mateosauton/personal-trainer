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
- [x] Create the dedicated personal Cloud project `office-gym-512401`.
- [x] Create the Google web OAuth client and save its credentials in Supabase. Public Auth settings confirm Google enabled and Apple disabled.
- [x] Verify Google's audience is External, publishing status is Testing, and no test users are configured.
- [x] Save the app homepage and exactly the non-sensitive `openid`, `userinfo.email`, and `userinfo.profile` scopes. Confirm sensitive and restricted scope tables are empty.
- [x] Set and read back `EXPO_PUBLIC_GOOGLE_SIGN_IN_ENABLED=1` on Cloudflare production/non-production triggers, project-scoped EAS development/preview/production environments, and the ignored local `.env`. Leave Apple disabled.
- [x] Verify the production rebuild, real Google consent and Supabase callback exchange for an existing account, callback-code removal, and session restoration after reload. Basic sign-in is exempt from Testing's test-user list and seven-day authorization expiry.
- [ ] Verify new-account onboarding with Google and physical native Google sign-in using a fresh binary.
- [ ] Optional: complete branding publication with privacy-policy and terms URLs. Publication is currently disabled; this does not block the basic sign-in exception.
- [x] Skip unavailable Apple setup and gate its UI behind `EXPO_PUBLIC_APPLE_SIGN_IN_ENABLED=1`.

**Hosted setup:** The current environment points to `asbudyijvunpnhrhsubm`. After the owner resumed it on October 21, 2026, the public Auth settings endpoint and dashboard became accessible. The Supabase MCP connection still lacks project access. The dedicated personal `Office Gym` Cloud project `office-gym-512401` now contains web OAuth client `743848390951-dpqln4hqobsumqmn8qa0p7lrp68bu3ns.apps.googleusercontent.com`. Its authorized JavaScript origin and saved homepage are `https://personal-trainer.sautonmateo.workers.dev`; its redirect URI is `https://asbudyijvunpnhrhsubm.supabase.co/auth/v1/callback`. Credentials are saved in Supabase only, and public Auth settings confirm `google: true` and `apple: false`. Google's audience is External, publishing status is Testing, and zero test users are configured. Only `openid`, `userinfo.email`, and `userinfo.profile` are saved, with no sensitive or restricted scopes. Basic sign-in does not require listed test users or inherit Testing's seven-day authorization expiry. Branding publication remains disabled because privacy-policy and terms URLs are missing. Apple console setup is stopped at the owner's request, and its app flag remains off. The native app callback is already allowlisted.

## Validation

- After skipping Apple: 19 auth-screen/dev-login tests, TypeScript, and web export passed; browser verified Google/email remain and Apple is hidden by default. Existing Apple flow tests explicitly opt in to its environment flag.
- Initial local `npm test -- --runInBand --silent`: 33 suites and 248 tests passed. An initial workout-player failure passed on isolated and full reruns.
- `npm run lint`: passed.
- Expo export for web, iOS, and Android: passed with the mock Supabase URL and key and dotenv loading disabled.
- Expo config introspection: generated `com.apple.developer.applesignin: ["Default"]`; runtime policy is `fingerprint`.
- Browser: provider controls in both modes, denied callback error, rejection of legacy implicit token links, email sign-in to onboarding, and session restoration after reload verified against the local mock.
- Actual Supabase JS code challenge generation verified as S256 using the native crypto adapter in a test.
- `npm run docs:verify`: five stale checks remain in the existing engineering handoff for catalog readers, query count, and theme call counts. Auth does not change those counts.
- Hosted provider check: public Auth settings report Google enabled and Apple disabled after saving the Google web client in Supabase.
- Google flag readback: Cloudflare production/non-production build triggers, project-scoped EAS development/preview/production environments, and ignored local `.env` all have `EXPO_PUBLIC_GOOGLE_SIGN_IN_ENABLED=1`. Apple remains omitted.
- Production build `d76ce734-ecb7-49ff-b96e-a7ab507a2a86` succeeded from pinned `master` commit `4189aa33f926b40359d1ff05ca9f08f94707df77`, deploying version `fcabc071-f9f7-4c07-b7a6-0a8178f65bcb`. TypeScript, 55 suites with 527 tests, web export, and deployment passed.
- Live production web check: `/sign-in` shows Google and email with Apple hidden. Existing-account Google consent requested only name, profile picture, and email. Callback exchange returned Home, removed the code from the URL, and retained Home after reload.
- Google Audience and Data Access checks: External, Testing, zero test users, and only three non-sensitive basic sign-in scopes. Google's [documented exception](https://support.google.com/cloud/answer/15549945) removes the test-user list and seven-day authorization expiry for these requests. Homepage saved; branding publication remains disabled pending privacy-policy and terms URLs.
- New-account onboarding with Google and physical-device native Google authentication remain unverified. Native validation requires a fresh binary. Apple is skipped; its provisioning and live flow have not been verified. Optional Google branding publication still needs privacy-policy and terms URLs.
