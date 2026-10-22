# Authentication recovery verification

Password recovery starts from Forgot password on sign-in. Reset emails redirect to `/reset-password` through Expo Linking. Both implicit token fragments and PKCE query codes are exchanged explicitly. The reset form is unavailable until that exchange succeeds. Saving a new password signs out so the user signs in with the new credentials.

In Supabase Auth URL Configuration, allow the native `officegym://**` scheme and the exact HTTPS testing origin with `/reset-password`. Email confirmation uses the same native scheme with the root callback. Web is a testing surface, not the native release target.

Verify using the installed release binary:

- Request a reset email and open its link with the app stopped. Save a new password, sign in again, and confirm the existing plan/history remain.
- While signed in as account A, open a recovery link for test account B. Verify the form stays blocked during exchange and the password update belongs to B.
- Open expired links and verify a visible error with a route back to sign-in and another reset request.
- Repeat on the HTTPS web testing origin and verify the approved redirect is used.
- Simulate backend and local-storage failures and verify Retry/sign-out remain available.

These installed-device and delivery checks are required before closing issue #6; unit tests alone do not prove email delivery or production redirect configuration.
