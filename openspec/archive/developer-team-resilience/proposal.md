# Proposal: Developer Team Resilience

## Intent

Reduce expensive multi-agent SDD failure loops by catching high-risk gaps earlier and making runner/artifact orchestration resilient to partial, long-running, or transport-ambiguous executions. The change must remain project-agnostic: behavior is driven by project discovery, artifact contracts, and configurable thresholds, not stack-specific assumptions.

## Goal

Enable SDD pipelines to adapt quality effort to change risk while preserving deterministic recovery from runner, state, and budget failures.

## Scope

### In Scope
- Producer self-audits in Spec, Design, and Tasks for invariants, boundaries, risk surface, task readiness, rollback, and test direction.
- Lightweight orchestrator risk scoring and conditional quality-agent routing only when thresholds indicate risk.
- Loop breaker with risk recomputation, task repair/replan, user escalation, and hard cycle ceiling.
- Runner resilience contracts: transport failure classification, idempotent artifact reconciliation, budgets/watchdogs, and structured artifact/state updates.
- Artifact/state manager contract supporting locking/versioning and single-writer or transactional updates.

### Out of Scope
- Always-on quality agents for every phase.
- Project-specific stacks, paths, test tools, artifact names, or implementation details as requirements.
- Replacing existing SDD phases or defining detailed specs/tasks/designs here.

## Affected Capabilities

### New Capabilities
- `adaptive-quality-control`: self-audit, risk scoring, conditional quality routing, and loop breaking.
- `runner-orchestration-resilience`: transport recovery, watchdog budgets, and phase outcome classification.
- `artifact-state-contracts`: structured updates, locking/versioning, and transactional or single-writer mutation.

### Modified Capabilities
- None — no existing capabilities were found.

### Unchanged Capabilities
- Existing project discovery and artifact conventions remain the source of project-specific behavior.

## Approach

Adopt adaptive/proportional quality. Producers emit machine-readable audit signals; the orchestrator computes risk and invokes focused quality agents only above configured thresholds. Runner outcomes distinguish agent failure, transport failure, artifact-written-with-lost-ack, timeout, and budget exhaustion. Mutable artifacts move behind a state manager that applies append-only, structured overlay, or transactional updates with optimistic version checks.

## Alternatives and Tradeoffs

| Alternative | Why Considered | Why Not Chosen |
|---|---|---|
| Always-on quality agents | Highest early-detection confidence | Slower and more expensive for low-risk changes; explicitly rejected. |
| Loop counter only | Simple guardrail | Stops runaway loops but does not prevent late invariants, stale artifacts, or transport false negatives. |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Risk score miscalibration | Medium | Configurable thresholds, transparent scoring inputs, retrospective tuning. |
| State manager complexity | Medium | Define small contracts first; allow multiple backend strategies. |
| Platform-specific transport hooks vary | Medium | Specify abstract classifications and recovery obligations, not runner internals. |

## Rollback Plan

Disable adaptive routing and resilience enforcement via orchestrator configuration, then fall back to the prior fixed phase flow and direct artifact writes while preserving produced artifacts for audit.

## Dependencies

- Agreement on generic artifact contracts for phase outputs, audit signals, state updates, and phase outcome events.

## Open Questions

- What default risk thresholds and budget limits should ship before project-level calibration exists?

## Acceptance Direction

- [ ] Low-risk changes proceed without extra quality agents.
- [ ] Risky changes trigger focused pre-Apply quality checks before implementation.
- [ ] Repeated Review/Verify failures trigger replan or escalation instead of unbounded loops.
- [ ] Transport and budget failures produce recoverable, classified outcomes.
- [ ] Concurrent or stale artifact writes are prevented or reconciled deterministically.

## Next Steps

Ready for Spec (`deck-developer-spec`) and Design (`deck-developer-design`) in parallel.
