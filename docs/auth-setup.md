# Google and Apple sign-in

The app uses Supabase Auth for email/password, Google, and Apple. Both social
providers are hidden by default until configured and explicitly enabled in the
app environment. Social sign-in creates an account on first use. The existing
profile trigger and onboarding gate apply to every method; no database migration
is required.

## Current hosted setup

The local environment points to Supabase project `asbudyijvunpnhrhsubm`, named
`office-gym-trainer`. After the owner resumed it on October 21, 2026, its Auth
settings endpoint returned HTTP 200 and its dashboard became accessible.
An empty read-only query against `profiles` also returned HTTP 200.
Email authentication and Google are enabled. The Google web OAuth client is
configured in Supabase; its client secret is stored only there. The public Auth
settings endpoint confirms `google: true` and `apple: false`. Apple setup was
skipped and its UI remains disabled. `EXPO_PUBLIC_GOOGLE_SIGN_IN_ENABLED=1` is
set and read back on Cloudflare production and non-production build triggers,
in the project-scoped EAS development, preview, and production environments,
and in the ignored local `.env`. The Apple flag is omitted. The production
rebuild succeeded. Live Google consent and callback exchange signed an existing
account into Home; the callback code was removed from the URL and reloading
preserved the signed-in session.

The connected Supabase MCP account still cannot access this project. The
dashboard session for `mateosauton's Org` can access it, so dashboard setup can
continue. The owner approved Google Cloud and Apple Developer console access
for this app and chose personal ownership for both providers. Personal Google
Cloud is now accessible. The dedicated personal `Office Gym` project,
ID `office-gym-512401`, contains the configured web OAuth client. Google's
audience is verified as External with publishing status Testing and zero test
users. The saved scopes are limited to basic Sign in with Google, so Google's
test-user list and seven-day authorization expiry do not apply. The homepage is
saved, but publication remains disabled because branding lacks privacy-policy
and terms URLs. Apple console setup is stopped at the owner's request.

Use the project selected by `EXPO_PUBLIC_SUPABASE_URL` in each EAS environment.
Do not switch projects just to enable a provider: existing users and training
data belong to the current project's user IDs.

## Redirect URLs

In [Supabase URL configuration](https://supabase.com/dashboard/project/asbudyijvunpnhrhsubm/auth/url-configuration),
set Site URL to the app's production HTTPS origin and allow:

- `officegym://**` for installed iOS/Android builds.
- The production web root, including its trailing slash, and any intended
  preview origins.
- `http://localhost:8081/` for local web development, if used.

At the resume check, Site URL was `officegym://`. The allowlist already included
`officegym://**`, an Expo tunnel callback, and roots/reset-password callbacks
for `https://personal-trainer.sautonmateo.workers.dev` and its
`8d3ec0a9-personal-trainer` preview. These settings were left unchanged. Confirm
the intended production web origin before replacing Site URL or adding another
hosted origin.

`authRedirectTo()` in `lib/deep-link.ts` uses `Linking.createURL('/')`, so web
returns to the current origin and native returns to the registered app scheme.
OAuth codes are exchanged with PKCE in the same browser/app that started the
flow. Provider errors appear on the sign-in screen. Auth parameters are removed
from the browser URL after processing.

Legacy email confirmation links with session tokens in their URL fragment no
longer sign in automatically. Users can finish at the existing email/password
form after confirming. New confirmation links use PKCE codes.

Use an installed development or release build for mobile Google OAuth. Expo Go
cannot register the app's `officegym` callback scheme, so the app disables
browser-based social sign-in there and explains how to use email and password.
The sign-in function also rejects unsupported browser flows before starting
OAuth. Web and installed builds keep the existing PKCE flow. Native Apple
sign-in on iOS is unchanged; Expo Go does not verify the production Apple
entitlement. See [Expo's OAuth guidance](https://docs.expo.dev/guides/authentication/).

## Google

Google is configured in the dedicated personal Cloud project
`office-gym-512401` and enabled in
[Supabase providers](https://supabase.com/dashboard/project/asbudyijvunpnhrhsubm/auth/providers).
The recorded configuration is:

- Client type: **Web application**. The app uses browser OAuth for Google on
  all platforms, so a native Google SDK client is not needed.
- Public client ID:
  `743848390951-dpqln4hqobsumqmn8qa0p7lrp68bu3ns.apps.googleusercontent.com`.
- Authorized JavaScript origin:
  `https://personal-trainer.sautonmateo.workers.dev`.
- Saved app homepage:
  `https://personal-trainer.sautonmateo.workers.dev`.
- Authorized redirect URI:
  `https://asbudyijvunpnhrhsubm.supabase.co/auth/v1/callback`.
- Audience: **External**.
- Saved scopes: `openid`, `userinfo.email`, and `userinfo.profile`, all
  non-sensitive. Sensitive and restricted scope tables are empty.
- Publishing status: **Testing**, with zero test users. Publication is disabled
  because branding lacks privacy-policy and terms URLs.

Google's [basic sign-in exception](https://support.google.com/cloud/answer/15549945)
means these scopes do not require users to be in the test-user list, and their
authorizations do not expire after seven days in Testing mode. Zero configured
test users therefore does not block this sign-in flow. Adding other OAuth scopes
would remove this exception.

The Google flag is configured in each target environment. Cloudflare production
build `d76ce734-ecb7-49ff-b96e-a7ab507a2a86` succeeded from pinned `master`
commit `4189aa33f926b40359d1ff05ca9f08f94707df77`, deploying version
`fcabc071-f9f7-4c07-b7a6-0a8178f65bcb`. Its TypeScript check, 55 test suites
with 527 tests, web export, and deployment passed. The live sign-in screen
shows Google and email, with Apple hidden.

A live Google sign-in with an existing account requested only name, profile
picture, and email consent, returned to Home, removed the callback code from
the URL, and retained Home after reload. Google signup with a new account and
physical-device native Google sign-in remain unverified; native validation
requires a fresh binary. Branding publication remains optional unfinished work
while privacy-policy and terms URLs are missing.

The Google callback points to Supabase. Supabase then returns the user to the
allowlisted app root. Keep the client secret in Supabase, outside Expo variables.

## Apple

Apple setup is optional and currently skipped. Leave
`EXPO_PUBLIC_APPLE_SIGN_IN_ENABLED` unset. After completing the configuration
below, set it to `1` in the applicable EAS environment and rebuild before offering
Apple sign-in to users. The device availability check still applies on iOS.

For native iOS:

1. Enable Sign in with Apple for App ID `co.officegym.trainer` in Apple Developer.
2. Enable Apple in Supabase Auth and add `co.officegym.trainer` to its client IDs.
   Keep nonce verification enabled. The app passes a SHA-256 nonce to Apple and
   the original nonce to Supabase when exchanging the ID token.
3. Build a new iOS binary. `app.json` includes `ios.usesAppleSignIn` and the
   `expo-apple-authentication` config plugin to configure the entitlement.

For web and Android, also create an Apple Services ID associated with that App
ID, configure the website domain `asbudyijvunpnhrhsubm.supabase.co`, and register
`https://asbudyijvunpnhrhsubm.supabase.co/auth/v1/callback` as its return URL.
Add the Services ID and generated Apple client secret to the Supabase Apple
provider. Apple web OAuth secrets expire after at most six months and must be
rotated. Never put the `.p8` key or client secret in the app bundle.

Native iOS uses Apple's system button and authorization sheet. It requests the
email scope, and the button is hidden if Apple authentication is unavailable.
Web and Android use Apple's browser OAuth flow.

## Verification and release

- Test Google with a new account and confirm it reaches onboarding. Existing
  account sign-in to Home and session restoration after reload passed on the
  deployed web app.
- Cancel Google sign-in and retry. Check provider failures appear in the
  auth screen, and email/password sign-in still works.
- Build a fresh native binary, then verify Google sign-in and session
  restoration on a physical device.
- If Apple is configured later, repeat provider checks and test native Apple
  sign-in on a physical device using a newly built binary signed for
  `co.officegym.trainer`.
- This change adds native modules. Publish a new native build before shipping
  an EAS Update containing it. `runtimeVersion.policy` is `fingerprint`, so an
  update requiring the new native modules cannot target older `1.0.0` binaries.

Local validation uses mock auth responses and SDK module mocks. The live web
check above additionally verified Google consent, callback exchange, and session
restoration for an existing account. New-account onboarding and physical native
Google authentication still need live checks. Apple setup remains skipped.

References: [Supabase Google](https://supabase.com/docs/guides/auth/social-login/auth-google),
[Supabase Apple](https://supabase.com/docs/guides/auth/social-login/auth-apple),
[mobile callbacks](https://supabase.com/docs/guides/auth/native-mobile-deep-linking),
[Expo Apple authentication](https://docs.expo.dev/versions/v57.0.0/sdk/apple-authentication/).
