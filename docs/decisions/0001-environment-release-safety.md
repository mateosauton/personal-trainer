# 0001. Isolate app targets and promote verified native updates

Date: 2026-10-22  
Status: accepted for this implementation; deployment pending  
Owner: project maintainer

## Problem

Development, preview, and production builds currently share the production Supabase project. The native update workflow publishes a new production bundle on every master push. A passing unit test does not establish backend isolation or prove that the installed app received a tested update.

## Decision

Use explicit app environment markers and a checked-in backend registry. Reject missing targets, conflicting build contexts, privileged keys, and development or preview targets that resolve to production. Keep real local development on a loopback database; mock clients and local databases cannot produce distributable builds.

Replace automatic native publishing with a manual workflow that verifies EAS metadata and promotes an existing tested update group. Verify source, project, platform, environment, backend, runtime, and compatible binaries before mutation. Require a human device-test attestation, serialize promotions, and check the current master commit immediately before promotion. Preserve release receipts for recovery when a write has an uncertain outcome.

Remove the alternate Pages/CDN publisher and its obsolete verifier. Cloudflare remains the current web publisher, with build context checked against the requested app environment.

## Consequences

Hosted environment configuration must be migrated before the guards allow development and preview distributions. Repository validation does not prove hosted isolation: the development project, permitted organization and any costs, hosted environment values, and device checks remain separate deployment prerequisites.

CI can check Metro with a synthetic public configuration. That output belongs in `.expo/web-check`, separate from deployable `dist`, and is never a production release artifact.

## Validation

Test environment routing, backend boundaries, secrets, and provider-context conflicts. Exercise release checks with fake EAS and git executables and prove rejected candidates never reach a promotion command. Run the complete repository checks before committing.
