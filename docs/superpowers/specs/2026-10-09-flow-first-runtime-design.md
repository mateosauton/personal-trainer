# Flow-first runtime validation

## Goal

Prove and repair the user journey from a fresh account through onboarding, plan
creation, and one completed workout before starting the security backlog.

## Scope

- Run the web app against the repository's mock Supabase-compatible backend.
- Exercise the seeded fresh account through sign-in, the full onboarding flow,
  generated plan, session start, set logging, completion, and summary.
- Inspect the mock backend state after the run to verify plan, session, and set
  writes reached persistence.
- Turn the validated journey into a repeatable browser smoke flow and fix only
  failures that the flow reproduces.

## Exclusions

- Do not create a real production Supabase account during the initial run.
- Do not deploy database migrations or change RLS/storage policies in this
  phase; those follow after the runtime flow is proven.
- Do not attempt to diagnose a native simulator while Android platform tools
  and Xcode simulator tools are unavailable on this machine.

## Acceptance criteria

1. The fresh mock account can reach the onboarding route without an error.
2. Completing onboarding creates an active plan and reaches the authenticated
   home route.
3. Starting a planned workout, logging its required sets, and finishing it
   reaches the summary route.
4. The mock backend records the plan, session completion, and set logs.
5. The smoke flow can run again from a reset mock state.

## Follow-up security order

After this flow is passing, address R35–R40 (outbox and gate correctness),
then R41 (dev credential exposure). Establish R25 migration/RLS tooling before
any production schema or policy change.
