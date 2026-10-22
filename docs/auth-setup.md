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
Email authentication is enabled. Google and Apple are disabled, and both
provider forms have empty client IDs and OAuth secrets. No hosted provider
settings have been changed yet. Live Google sign-in requires the provider
credentials below and `EXPO_PUBLIC_GOOGLE_SIGN_IN_ENABLED=1` in the applicable
EAS environment, followed by a rebuild and a real provider sign-in.

The connected Supabase MCP account still cannot access this project. The
dashboard session for `mateosauton's Org` can access it, so dashboard setup can
continue. The owner approved Google Cloud and Apple Developer console access
for this app and chose personal ownership for both providers. Personal Google
Cloud is now accessible. Its existing projects belong to other apps, so a new
`Office Gym` project, ID `office-gym-512401`, is prepared for OAuth configuration.
Project creation awaits explicit owner approval; it has not been submitted
successfully. The owner chose to skip unavailable Apple sign-in, so Apple console
setup is stopped and its UI stays disabled. No provider credentials have been
created or entered.

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

Use a development build for mobile OAuth. Expo Go's `exp://` callback is not a
stable provider redirect and does not verify the production Apple entitlement.

## Google

Leave `EXPO_PUBLIC_GOOGLE_SIGN_IN_ENABLED` unset until the hosted provider is
configured. After completing the steps below, set it to `1` in the applicable
EAS environment and rebuild before offering Google sign-in to users.

1. Configure the Google Auth Platform consent screen and audience for Office Gym.
   Request only OpenID, email, and profile scopes. Add test users if the consent
   screen is still in testing.
2. Create a **Web application** OAuth client. This app uses browser OAuth for
   Google on all platforms, so a native Google SDK client is not needed.
   Use the dedicated personal Office Gym Cloud project once it has been created.
3. Add the app's web origin to authorized JavaScript origins, and add this
   authorized redirect URI:
   `https://asbudyijvunpnhrhsubm.supabase.co/auth/v1/callback`.
   The verified primary web origin is
   `https://personal-trainer.sautonmateo.workers.dev`.
4. In [Supabase providers](https://supabase.com/dashboard/project/asbudyijvunpnhrhsubm/auth/providers),
   enable Google and enter its client ID and client secret.

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

- Test Google and Apple with both a new account and an existing account. New
  accounts must reach onboarding; onboarded accounts must reach Home.
- Cancel each provider flow and retry. Check provider failures appear in the
  auth screen, and email/password sign-in still works.
- Restart the app/browser after signing in and verify session restoration.
- Test native Apple sign-in on a physical device using a newly built binary
  signed for `co.officegym.trainer`.
- This change adds native modules. Publish a new native build before shipping
  an EAS Update containing it. `runtimeVersion.policy` is `fingerprint`, so an
  update requiring the new native modules cannot target older `1.0.0` binaries.

Local validation uses mock auth responses and SDK module mocks. It does not
prove Google consent, Apple provisioning, hosted redirect allowlists, or real
provider-token exchange.

References: [Supabase Google](https://supabase.com/docs/guides/auth/social-login/auth-google),
[Supabase Apple](https://supabase.com/docs/guides/auth/social-login/auth-apple),
[mobile callbacks](https://supabase.com/docs/guides/auth/native-mobile-deep-linking),
[Expo Apple authentication](https://docs.expo.dev/versions/v57.0.0/sdk/apple-authentication/).
