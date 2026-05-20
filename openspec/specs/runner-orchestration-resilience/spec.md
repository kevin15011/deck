# Runner Orchestration Resilience Specification

## Purpose

Define recoverable, project-agnostic runner outcomes for transport ambiguity, budget exhaustion, watchdog escalation, and discovered verification capabilities.

## Requirements

### Requirement: Transport Failure Classification

The runner MUST distinguish implementation failure from transport failure. Transport failures MUST be classified as no-artifact, artifact-present-unvalidated, or artifact-present-valid, and MUST NOT be treated as implementation failure until artifact reconciliation proves the implementation failed.

#### Scenario: Transport failure without artifact

- GIVEN transport disconnects before any artifact is found
- WHEN recovery runs
- THEN the outcome is transport-failure/no-artifact and retry or escalation is allowed

#### Scenario: Lost acknowledgement after valid artifact

- GIVEN transport disconnects after an artifact was written
- WHEN the runner validates required structure and freshness
- THEN it records artifact-present-valid instead of relaunching duplicate work

#### Scenario: Invalid artifact is not success

- GIVEN a partial or malformed artifact exists after disconnect
- WHEN reconciliation runs
- THEN the outcome is artifact-present-unvalidated or partial, not completed

### Requirement: Phase Budgets and Watchdogs

Each phase MUST have configurable token, tool-call, turn, and time thresholds. Soft thresholds SHOULD request checkpoint/split behavior; hard thresholds MUST stop or pause the phase and emit a budget outcome requiring split, replan, or user escalation.

#### Scenario: Soft budget requests checkpoint

- GIVEN a phase crosses a soft budget
- WHEN the watchdog fires
- THEN the agent is asked for a concise checkpoint and continuation risk

#### Scenario: Hard budget prevents runaway loop

- GIVEN a phase crosses a hard budget
- WHEN the watchdog fires
- THEN execution stops or pauses with budget-exceeded and no silent continuation occurs

### Requirement: Discovery-Based Verification Capability

Quality and risk decisions MUST use detected test, build, lint, type-check, runtime, and deployment capabilities when available, and MUST degrade gracefully when absent or unknown.

#### Scenario: Capabilities detected

- GIVEN project discovery reports available verification commands
- WHEN routing chooses quality or verify steps
- THEN decisions cite the detected capabilities generically

#### Scenario: Capabilities absent

- GIVEN discovery cannot identify verification capabilities
- WHEN implementation readiness is evaluated
- THEN risk is raised or human/producer evidence is requested instead of assuming a tool exists
