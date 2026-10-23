# Environment isolation and release safety implementation plan

## Goal

Make backend targeting explicit and stop automatic native releases. Deliver a reviewable pull request with tests and truthful deployment prerequisites.

## Baseline

- Start from remote master `bf5e9898b87d3786515d6bcce3ce72ba329bc789`.
- Use the isolated `codex/environment-release-safety` worktree to preserve unrelated changes in the primary checkout.
- Baseline verification: TypeScript, 56 Jest suites / 552 tests, and nine preview-server tests passed.

## Work areas

1. Environment policy: shared validation, Expo runtime/config guards, explicit EAS targets, fixture changes, and negative tests.
2. Local infrastructure: reproducible isolated Supabase development, boundary tests, and read-only inspection of hosted configuration.
3. Release safety: manual verified-group promotion, compatibility checks, release receipts, negative integration tests, and removal of alternate publishers.
4. Integration: package commands, CI bundle checks, documentation, independent review, full verification, commit, push, and pull request.

## Completion criteria

- Unconfigured or production-backed development/preview distributions fail closed.
- Mock and local targets cannot produce distributions.
- Promotion requires verifiable candidate source, platform, runtime, backend, compatible binaries, and recorded device attestation.
- Unrelated primary-checkout work stays untouched.
- Changes are committed, pushed, and attached as a pull request; missing hosted provisioning and device evidence are reported explicitly.
