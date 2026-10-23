# Authentication recovery verification

Password recovery starts from Forgot password on sign-in. Reset emails redirect to `/reset-password` through Expo Linking. Signup confirmation and password recovery use PKCE: request the email and open its link in the same browser or installed app on the same device. The SDK must find the verifier saved when the request began. Implicit token fragments and callbacks outside the generated signup/reset routes are rejected. The reset form is unavailable until code exchange succeeds. Saving a new password signs out so the user signs in with the new credentials.

Email callbacks cannot replace an existing signed-in session. Sign out first, then request a new email link on this device; signing out removes any previous verifier. Older implicit-flow emails must also be replaced with a newly requested link.

Native PKCE uses Expo Crypto's secure random values and SHA-256 digest for S256 challenges. Existing WebCrypto implementations are preserved; unavailable native crypto fails the request instead of using weak randomness.

In Supabase Auth URL Configuration, allow the native `officegym://**` scheme and the exact HTTPS testing origin with `/reset-password`. Email confirmation uses the same native scheme with the root callback. Web is a testing surface, not the native release target.

Verify using the installed release binary:

- Request a reset email and open its link with the app stopped. Save a new password, sign in again, and confirm the existing plan/history remain.
- While signed in as account A, open a recovery or signup link for test account B. Verify the link shows an error before code exchange, A remains signed in, and no reset form for B appears. Sign out, request a fresh reset email, then complete recovery on the same device.
- Open a synthetic token-fragment link and an unrelated-path code link. Verify neither establishes a session. Open a code link on a different device/browser and verify the missing verifier prevents sign-in.
- Open expired links and verify a visible error with a route back to sign-in and another reset request.
- Repeat on the HTTPS web testing origin and verify the approved redirect is used.
- Simulate backend and local-storage failures and verify Retry/sign-out remain available.

These installed-device and delivery checks are required before closing issue #6; unit tests alone do not prove email delivery or production redirect configuration.

Browser callbacks remove authentication parameters after successful exchange or a rejected link while preserving ordinary route and URL state.
