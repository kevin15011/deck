# Artifact State Contracts Specification

## Purpose

Define safe artifact/state mutation contracts that prevent stale, conflicting, or ambiguous updates across agents and phases.

## Requirements

### Requirement: Structured Transactional Updates

Artifact and state mutations MUST be submitted as structured updates declaring target artifact, base version or event cursor, intended operation, validation expectations, actor, and phase. Free-form stale replacement MUST NOT be the only mutation mechanism for shared state.

#### Scenario: Valid structured update commits

- GIVEN an update references the current base version
- WHEN the state manager validates it
- THEN the update is committed and a new version or event is recorded

#### Scenario: Stale update is rejected with recovery data

- GIVEN an update references an old base version
- WHEN validation runs
- THEN the update is rejected with current version, conflict summary, and retry guidance

### Requirement: Locking or Single-Writer Control

The artifact/state manager MUST enforce single-writer ownership, optimistic version checks, transactional locks, or append-only events for mutable artifacts. Concurrent updates MUST resolve deterministically and preserve audit history.

#### Scenario: Concurrent writers are controlled

- GIVEN two agents attempt to update the same mutable artifact
- WHEN both updates are submitted
- THEN only valid serialized updates commit, and rejected updates receive conflict details

#### Scenario: Append-only model preserves history

- GIVEN the store uses append-only events
- WHEN multiple phase events are appended
- THEN readers can reconstruct current state without losing prior events

### Requirement: Stale Update Recovery and Acceptance Criteria

The state manager MUST provide recovery paths for stale updates: refresh-and-retry, merge proposal, append compensating event, or user escalation. Acceptance requires no silent overwrite, no dropped prior artifact reference, and a traceable final state.

#### Scenario: Recoverable stale update retries

- GIVEN a stale update has no semantic conflict after refresh
- WHEN the actor retries with the current base version
- THEN the update commits with preserved provenance

#### Scenario: Conflicting stale update escalates

- GIVEN a stale update conflicts with committed state
- WHEN automatic merge is unsafe
- THEN the manager blocks the update and emits an escalation event
