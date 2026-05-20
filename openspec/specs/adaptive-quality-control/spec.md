# Adaptive Quality Control Specification

## Purpose

Define project-agnostic quality control that uses producer self-audits, universal risk signals, conditional quality routing, loop breaking, and discovered project capabilities.

## Requirements

### Requirement: Producer Self-Audit

Spec, Design, and Tasks producers MUST emit a structured self-audit covering stated invariants, boundaries, ambiguity, risk signals, readiness gaps, rollback/test direction, and confidence. The audit MUST be reviewable without assuming any stack, file layout, or artifact path.

#### Scenario: Complete self-audit accepted

- GIVEN a Spec, Design, or Tasks artifact is produced
- WHEN the orchestrator validates the artifact
- THEN it accepts the artifact only if required self-audit fields are present and explicit

#### Scenario: Missing audit is rejected

- GIVEN a producer returns an artifact without a self-audit
- WHEN validation runs
- THEN the phase outcome is blocked or partial with a missing-audit reason

### Requirement: Lightweight Risk Scoring

The orchestrator MUST compute a lightweight risk score from universal signals, including ambiguity, cross-boundary impact, irreversible state change, permissions/secrets, migration/data shape change, missing tests, readiness gaps, failed prior cycles, and producer confidence. Risk scoring MUST adapt weights and evidence to discovered project test/build capabilities.

#### Scenario: Risk computed from generic signals

- GIVEN producer audits and project discovery results exist
- WHEN orchestration evaluates next routing
- THEN it records score, contributing signals, threshold used, and confidence

#### Scenario: No hardcoded stack assumption

- GIVEN project discovery finds no known test or build command
- WHEN risk is computed
- THEN capability absence is considered without naming a specific tool or path

### Requirement: Conditional Quality Invocation

The orchestrator MUST invoke quality agents only when risk, ambiguity, readiness, or loop signals meet configured thresholds. It MUST NOT run extra quality agents solely because a phase exists.

#### Scenario: Low-risk path avoids extra agents

- GIVEN score and ambiguity are below threshold
- WHEN the next phase is selected
- THEN no additional quality agent is invoked and the decision is logged

#### Scenario: High-risk path gates implementation

- GIVEN risk or ambiguity meets threshold
- WHEN implementation would start
- THEN focused quality review is required before implementation continues

### Requirement: Loop Breaker and Forced Replanning

The orchestrator MUST detect repeated similar review/fix or verify/fix cycles by affected scope, failure category, and requested changes. After the configured ceiling, it MUST recompute risk and force replan, split, or user escalation before another implementation attempt.

#### Scenario: Similar cycles trigger replan

- GIVEN repeated cycles report the same failure pattern
- WHEN the loop threshold is reached
- THEN another fix attempt is blocked until replanning or escalation occurs

#### Scenario: Different failures do not falsely loop

- GIVEN failures affect unrelated scopes and categories
- WHEN cycle history is evaluated
- THEN the loop breaker does not classify them as the same loop
