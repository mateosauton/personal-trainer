# NNNN. Short decision title

Date: YYYY-MM-DD. Owner: project owner.

Decision: proposed / accepted / rejected / superseded by NNNN.
Implementation: absent / partial / in code, with source links.
Delivery: unreleased / released, with release evidence link.
Rationale: documented / reconstructed / proposal.
Issue and PR: links.

## Scenario and context

Describe the onboarding, plan, exercise or workout problem. State current
behavior, constraints and unknowns. Link the decision being changed. Separate
observed facts from assumptions.

## Decision and alternatives

State what changes and who owns each responsibility. Compare the simplest viable
choice with realistic alternatives and keeping the current design. Explain why
the choice fits this personal project.

## Invariants and subsystem effects

State what must remain true and how failures are handled. Cover the affected
rows in the [impact matrix](../TECHNICAL_DECISIONS.md#3-subsystem-impact-matrix).

| Area | Effect or reason there is no effect |
| --- | --- |
| Schema, ownership, RLS, RPCs and migrations | |
| Expo/native runtime and local persisted state | |
| Frontend state, accessibility and phone interaction | |
| Plan, catalog, equipment and preferences | |
| Auth and account changes | |
| CI, environments, releases and diagnostics | |

## Consequences and rollout

Name the benefit, cost, limitation and rejected tradeoffs. Describe old/new
client compatibility, queued/local data, deployment order and recovery. Record
whether a binary or compatible update is needed. Local checks do not establish
production delivery.

## Validation and revisit trigger

Give checkable acceptance criteria and appropriate checks. Include an installed
phone scenario for native behavior. Define evidence that would justify revisiting
the decision. Link final verification and release records when they exist.

## References

Link source files, tests, prior decisions, research and issue/PR.
