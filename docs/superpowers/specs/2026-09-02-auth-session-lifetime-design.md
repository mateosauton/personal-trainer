# One-month authentication session lifetime

## Goal

Keep a signed-in user authenticated while they remain active, but require a new
sign-in after 30 days without activity.

## Design

Supabase Auth owns session expiry and inactivity policy. Configure the project's
Auth settings with an inactivity timeout of 2,592,000 seconds (30 days). Leave
the mobile client configuration unchanged: it already persists sessions and
automatically refreshes valid sessions.

The app must not attempt to enforce this limit locally. Local storage can be
cleared, reinstalled, or manipulated and cannot invalidate server-side tokens.

## Expected behavior

- Any authenticated activity within the 30-day window keeps the user signed in.
- After 30 days without activity, the next attempted token refresh/session use
  is rejected and the app presents sign-in.
- Existing explicit sign-out behavior remains unchanged.

## Verification

- Document the required Supabase Auth setting in the repository operations
  guide so deployments have an auditable, repeatable configuration step.
- Retain a source-level test for client session persistence and automatic token
  refresh; the 30-day timeout itself is enforced by Supabase, not application
  code.
