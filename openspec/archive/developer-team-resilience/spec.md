# Spec: Developer Team Resilience

## Source

- Proposal: `developer-team-resilience`
- Capabilities affected: adaptive-quality-control, runner-orchestration-resilience, artifact-state-contracts
- Scope: general/project-agnostic; requirements avoid Deck layout, TypeScript, OpenSpec paths, and stack-specific assumptions.

## Requirements Index

| Capability | Requirements | Scenarios |
|---|---:|---:|
| adaptive-quality-control | 4 MUST | 8 |
| runner-orchestration-resilience | 3 MUST/SHOULD | 7 |
| artifact-state-contracts | 3 MUST | 6 |

## Artifact References

- `specs/adaptive-quality-control/spec.md`
- `specs/runner-orchestration-resilience/spec.md`
- `specs/artifact-state-contracts/spec.md`

## Acceptance Criteria

- Producer artifacts expose structured self-audit signals for Spec, Design, and Tasks.
- Orchestrator risk scoring uses universal signals and discovered project capabilities.
- Quality agents run conditionally, not always-on.
- Repeated similar fix/review loops force replan, split, or escalation.
- Transport failures are classified separately from implementation failures and reconciled against artifacts.
- State updates are structured, versioned or serialized, and recover stale writes deterministically.
- Budgets/watchdogs produce checkpoint, split, replan, or escalation outcomes.
- Capability discovery influences quality/risk decisions without hardcoded stack assumptions.

## Open Questions

- What default threshold values should ship before project-level calibration exists?
