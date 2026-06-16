# Spec: Exploration lifecycle states

## Source

- Proposal: `openspec/changes/exploration-lifecycle-states/proposal.md`
- Exploration: `openspec/changes/exploration-lifecycle-states/exploration.md`
- Repair clarification: Historical examples such as `fix-provider-engram-leak` were not necessarily stopped Run SDD flows; they may have been Orchestrator delegations to Explorer for diagnosis before deciding whether to start SDD.
- Capabilities affected: `exploration-lifecycle`, `developer-orchestrator-flow`, `openspec-registry-schema`
- Unchanged capabilities: canonical SDD phase model; precondition closure gate; exploratory Q&A/delegation without actionable findings

## Requirements

### Capability: exploration-lifecycle

REQ-LIFECYCLE-001: The system MUST support an optional `exploration_context` classification with values `sdd` and `delegated` when an exploration lifecycle is recorded.
  Priority: MUST
  Surface: Data
  Rationale: SDD Explorer and delegated Explorer diagnostics are different contexts and must not be conflated.

REQ-LIFECYCLE-002: For `exploration_context: sdd`, lifecycle MUST apply only when the formal SDD Explorer completes with an actionable diagnosis and the SDD flow stops before Proposal.
  Priority: MUST
  Surface: Data
  Rationale: Formal SDD pauses need an auditable next decision without adding friction to normal Explorer → Proposal flow.

REQ-LIFECYCLE-003: For `exploration_context: delegated`, lifecycle MUST apply only when an Orchestrator-delegated Explorer produces an actionable diagnosis/root cause and the result is not immediately converted into a formal SDD/Proposal flow.
  Priority: MUST
  Surface: Data
  Rationale: Delegated diagnostic work can create actionable follow-up without having been a stopped Run SDD.

REQ-LIFECYCLE-004: Lifecycle MUST NOT be requested or recorded for exploratory queries, investigation notes, or delegated analyses that produce no actionable diagnosis/root cause.
  Priority: MUST
  Surface: General
  Rationale: The lifecycle is anti-bureaucratic and must not turn lightweight exploration into process overhead.

REQ-LIFECYCLE-005: The lifecycle MUST allow these externally documented values: `diagnosed`, `deferred`, `closed-no-action`, `converted-to-change`, and `converted-to-sdd`; it MAY also allow `keep-as-reference` when a diagnosis is intentionally retained as reference material without planned action.
  Priority: MUST
  Surface: Data
  Rationale: The fixed vocabulary must cover both stopped SDD explorations and delegated diagnoses that later become formal SDD.

REQ-LIFECYCLE-006: `diagnosed` MUST mean an actionable diagnosis exists and a decision is still required: for `sdd`, the flow stopped before Proposal; for `delegated`, no immediate conversion to SDD/Proposal occurred.
  Priority: MUST
  Surface: Data
  Rationale: `diagnosed` is the pending-decision state, not a closure or deferment.

REQ-LIFECYCLE-007: `deferred` MUST mean the diagnosis is acknowledged and intentionally postponed, with a brief reason and minimum reactivation condition.
  Priority: MUST
  Surface: Data
  Rationale: Deferred work must be distinguishable from undecided work.

REQ-LIFECYCLE-008: `closed-no-action` MUST mean the diagnosis is acknowledged and a decision was made not to implement a change, with a brief reason.
  Priority: MUST
  Surface: Data
  Rationale: Closed diagnostics should not remain ambiguous or appear accidentally abandoned.

REQ-LIFECYCLE-009: `converted-to-change` MUST mean the diagnosis was used to continue to Proposal after a pause or to link to another formal change, with an idempotent reference to `proposal.md` or the target change.
  Priority: MUST
  Surface: Data
  Rationale: Delayed conversion needs an auditable bridge without duplicating changes.

REQ-LIFECYCLE-010: `converted-to-sdd` MUST mean a delegated Explorer diagnosis was converted into a formal SDD flow, with an idempotent reference to the resulting change or SDD entry point.
  Priority: MUST
  Surface: Data
  Rationale: Delegated diagnostics may precede the decision to create a formal SDD change.

REQ-LIFECYCLE-011: `keep-as-reference`, when used, SHOULD mean the diagnosis remains useful as reference material but has no current planned action, with a brief rationale.
  Priority: SHOULD
  Surface: Data
  Rationale: Some delegated diagnoses are intentionally preserved for knowledge without creating a pending action queue.

REQ-LIFECYCLE-012: The lifecycle MUST NOT introduce a canonical SDD phase, global status, Apply gate, or replacement for `explore.completed` / `proposal.completed` events.
  Priority: MUST
  Surface: General
  Rationale: The proposal requires lifecycle to remain auxiliary and anti-bureaucratic.

### Capability: developer-orchestrator-flow

REQ-ORCH-001: After a formal SDD Explorer is `blocked`, the Orchestrator MUST preserve the existing blocked/open-question behavior and MUST NOT set `exploration_lifecycle`.
  Priority: MUST
  Surface: General
  Rationale: Unclear diagnostics are not lifecycle candidates.

REQ-ORCH-002: After a formal SDD Explorer is `completed` and the flow continues immediately to Proposal, the Orchestrator MUST NOT ask for or record additional lifecycle state.
  Priority: MUST
  Surface: General
  Rationale: Normal Explorer → Proposal flow must remain frictionless.

REQ-ORCH-003: After a formal SDD Explorer is `completed`, an actionable diagnosis exists, and the flow stops before Proposal, the Orchestrator MUST record or request lifecycle classification beginning with `exploration_context: sdd` and `diagnosed` unless the user has already chosen defer, no-action closure, or conversion.
  Priority: MUST
  Surface: General
  Rationale: Paused diagnosed SDD explorations need an auditable next decision.

REQ-ORCH-004: After a delegated Explorer returns an actionable diagnosis/root cause and the Orchestrator does not immediately convert it into SDD/Proposal, the Orchestrator MUST record or request lifecycle classification beginning with `exploration_context: delegated` and `diagnosed` unless the user has already chosen defer, no-action closure, conversion, or keep-as-reference.
  Priority: MUST
  Surface: General
  Rationale: Delegated diagnostics can be actionable even when no formal SDD run had started.

REQ-ORCH-005: After a delegated Explorer returns no actionable diagnosis/root cause, the Orchestrator MUST NOT request lifecycle classification and SHOULD treat the result as ordinary exploratory context, answer, blocker, or open question.
  Priority: MUST
  Surface: General
  Rationale: The lifecycle must not apply to every Explorer delegation.

REQ-ORCH-006: In Interactive mode, the Orchestrator SHOULD present the minimum decision options needed for a lifecycle-eligible diagnosis: continue/create Proposal or SDD, defer, close with no action, leave diagnosed pending decision, or keep as reference when applicable.
  Priority: SHOULD
  Surface: General
  Rationale: The user should see available lifecycle decisions without extra ceremony.

REQ-ORCH-007: In Automatic mode, the Orchestrator SHOULD avoid lifecycle ceremony when it can continue directly to Proposal/SDD, and SHOULD only record lifecycle when execution stops after an actionable Explorer diagnosis due to user direction, dependency, or unresolved decision.
  Priority: SHOULD
  Surface: General
  Rationale: Automation should not add bureaucracy to successful flows.

REQ-ORCH-008: The Orchestrator MUST keep lifecycle rationale brief in registry surfaces and rely on `exploration.md` and lifecycle events for richer context.
  Priority: MUST
  Surface: Data
  Rationale: `state.yaml` must remain a minimum index, not a duplicated artifact.

### Capability: openspec-registry-schema

REQ-REGISTRY-001: When lifecycle applies, `state.yaml` MUST support optional `exploration_context` and `exploration_lifecycle` fields whose values are from the documented context and lifecycle vocabularies.
  Priority: MUST
  Surface: Data
  Rationale: Registry users need a consultable state without changing canonical phase/status fields.

REQ-REGISTRY-002: When lifecycle is `diagnosed`, `state.yaml` MUST indicate that a decision is required and MUST include an explicit next action.
  Priority: MUST
  Surface: Data
  Rationale: Diagnosed means pending decision, so the next action must be visible.

REQ-REGISTRY-003: When lifecycle is `deferred`, `closed-no-action`, `converted-to-change`, `converted-to-sdd`, or `keep-as-reference`, registry data or events MUST include the minimum required reason or reference for that lifecycle state.
  Priority: MUST
  Surface: Data
  Rationale: Non-pending lifecycle states need enough audit context to be meaningful.

REQ-REGISTRY-004: Lifecycle transitions MUST be auditable through optional events: `exploration.diagnosed`, `exploration.deferred`, `exploration.closed-no-action`, `exploration.converted-to-change`, `exploration.converted-to-sdd`, and optionally `exploration.keep-as-reference`.
  Priority: MUST
  Surface: Data
  Rationale: State alone does not preserve transition history.

REQ-REGISTRY-005: Lifecycle events MUST include actor, timestamp, artifact reference, exploration context, lifecycle value, and a brief note or reference appropriate to the state.
  Priority: MUST
  Surface: Data
  Rationale: Events must remain minimally auditable across both SDD and delegated contexts.

REQ-REGISTRY-006: Registry schema documentation MUST describe `exploration_context` and `exploration_lifecycle` as optional and warning-level, not as strict canonical enums for `currentPhase` or global `status`.
  Priority: MUST
  Surface: Integration
  Rationale: Compatibility and existing canonical validations must be preserved.

REQ-REGISTRY-007: Validator support MUST treat unknown or malformed lifecycle/context-only values as warning-level findings rather than strict errors, while preserving strict errors for existing canonical registry fields.
  Priority: MUST
  Surface: Integration
  Rationale: Lifecycle must not block existing changes or expand core enums.

REQ-REGISTRY-008: The validator MAY warn when a formal SDD change has `explore completed` with no Proposal and no lifecycle only if the check can avoid severe false positives.
  Priority: MAY
  Surface: Integration
  Rationale: Detection of floating SDD explorations is useful but must not create noisy bureaucracy.

REQ-REGISTRY-009: The validator MAY warn when a delegated Explorer diagnosis is explicitly recorded as actionable but has no lifecycle/next action only if that signal is reliable and low-noise.
  Priority: MAY
  Surface: Integration
  Rationale: Delegated exploration records are more varied, so warnings must not assume every delegation implies SDD.

REQ-REGISTRY-010: The change MUST NOT automatically migrate historical exploration-only or delegated-diagnostic records.
  Priority: MUST
  Surface: General
  Rationale: Historical examples informed the gap, but cleanup is explicitly out of scope and may require human classification.

## Acceptance Scenarios

### Capability: exploration-lifecycle

#### Scenario: Formal SDD pause becomes diagnosed
**Given** a formal SDD Explorer completed with an actionable diagnosis and the SDD flow stops before Proposal
**When** lifecycle classification is recorded without a final decision
**Then** the exploration is classified with `exploration_context: sdd`, `exploration_lifecycle: diagnosed`, visible decision required, and explicit next action
> Covers: REQ-LIFECYCLE-001, REQ-LIFECYCLE-002, REQ-LIFECYCLE-006, REQ-REGISTRY-001, REQ-REGISTRY-002

#### Scenario: Delegated diagnosis becomes diagnosed
**Given** the Orchestrator delegated Explorer for analysis before deciding whether to start SDD, and Explorer returned an actionable root cause
**When** the Orchestrator does not immediately create/continue a formal SDD or Proposal
**Then** the result is eligible for `exploration_context: delegated`, `exploration_lifecycle: diagnosed`, visible decision required, and explicit next action
> Covers: REQ-LIFECYCLE-001, REQ-LIFECYCLE-003, REQ-LIFECYCLE-006, REQ-ORCH-004, REQ-REGISTRY-001, REQ-REGISTRY-002

#### Scenario: Delegated exploratory answer has no lifecycle
**Given** the Orchestrator delegated Explorer for a question, code reading, options analysis, or investigation
**When** Explorer returns no actionable diagnosis/root cause requiring follow-up
**Then** no `exploration_context` or `exploration_lifecycle` is requested or recorded solely because the delegation occurred
> Covers: REQ-LIFECYCLE-004, REQ-ORCH-005

#### Scenario: Diagnosis is intentionally deferred
**Given** an SDD or delegated exploration has an actionable diagnosis
**When** the user or Orchestrator records a decision to postpone action
**Then** the lifecycle is `deferred` and includes a brief reason plus a minimum reactivation condition
> Covers: REQ-LIFECYCLE-005, REQ-LIFECYCLE-007, REQ-REGISTRY-003

#### Scenario: Diagnosis is closed without action
**Given** an SDD or delegated exploration has an actionable diagnosis
**When** the user decides no implementation change should be made
**Then** the lifecycle is `closed-no-action` and includes a brief no-action reason
> Covers: REQ-LIFECYCLE-005, REQ-LIFECYCLE-008, REQ-REGISTRY-003

#### Scenario: Paused SDD diagnosis converts to formal change
**Given** an SDD-context `diagnosed` or `deferred` exploration exists
**When** a Proposal is later created or another formal change is linked as the destination
**Then** the lifecycle is `converted-to-change` with an idempotent reference to `proposal.md` or the destination change
> Covers: REQ-LIFECYCLE-005, REQ-LIFECYCLE-009, REQ-REGISTRY-003

#### Scenario: Delegated diagnosis converts to SDD
**Given** a delegated-context `diagnosed` or `deferred` exploration exists
**When** the user or Orchestrator creates a formal SDD flow from that diagnosis
**Then** the lifecycle is `converted-to-sdd` with an idempotent reference to the resulting change or SDD entry point
> Covers: REQ-LIFECYCLE-005, REQ-LIFECYCLE-010, REQ-REGISTRY-003

#### Scenario: Delegated diagnosis is retained as reference
**Given** a delegated-context actionable diagnosis is useful for future reference but no action is planned
**When** the user or Orchestrator records that decision
**Then** the lifecycle may be `keep-as-reference` with a brief rationale and without marking the item as requiring a decision
> Covers: REQ-LIFECYCLE-005, REQ-LIFECYCLE-011, REQ-REGISTRY-003

#### Scenario: Lifecycle remains auxiliary
**Given** any exploration lifecycle value is recorded
**When** registry phase/status are inspected
**Then** canonical SDD phases and global statuses are unchanged, and lifecycle has not replaced canonical events
> Covers: REQ-LIFECYCLE-012, REQ-REGISTRY-006

### Capability: developer-orchestrator-flow

#### Scenario: Blocked formal SDD Explorer does not use lifecycle
**Given** a formal SDD Explorer returns `blocked` with open questions or insufficient diagnosis
**When** the Orchestrator records the Explorer outcome
**Then** the flow uses existing blocker behavior and no `exploration_lifecycle` value is recorded
> Covers: REQ-ORCH-001

#### Scenario: Immediate Proposal has no lifecycle friction
**Given** formal SDD Explorer completed and the user or automation continues immediately to Proposal in the same flow
**When** the Orchestrator advances to Proposal
**Then** no lifecycle prompt is shown and no extra lifecycle state is required
> Covers: REQ-ORCH-002, REQ-ORCH-007

#### Scenario: Immediate delegated-to-SDD conversion has no diagnosed pause
**Given** a delegated Explorer returns an actionable diagnosis and the Orchestrator immediately starts or continues formal SDD/Proposal
**When** the formal flow is created without a pause
**Then** no pending `diagnosed` lifecycle is required; if a bridge is recorded, it uses conversion semantics rather than pending-decision semantics
> Covers: REQ-LIFECYCLE-003, REQ-LIFECYCLE-010, REQ-ORCH-004, REQ-ORCH-007

#### Scenario: Interactive pause asks only minimum decision
**Given** Interactive mode and an SDD or delegated Explorer result is lifecycle-eligible
**When** the Orchestrator summarizes the Explorer result
**Then** it presents only the minimum applicable lifecycle choices: continue/create Proposal or SDD, defer, close no action, leave diagnosed pending decision, or keep as reference when applicable
> Covers: REQ-ORCH-003, REQ-ORCH-004, REQ-ORCH-006, REQ-ORCH-008

#### Scenario: Automatic pause records lifecycle only when stopped
**Given** Automatic mode and Explorer completed with actionable diagnosis in either context
**When** execution cannot or should not continue to Proposal/SDD because of explicit user direction, dependency, or unresolved decision
**Then** the Orchestrator records the applicable lifecycle without adding lifecycle ceremony to direct Proposal/SDD flows
> Covers: REQ-ORCH-003, REQ-ORCH-004, REQ-ORCH-007

### Capability: openspec-registry-schema

#### Scenario: Minimal state entry for SDD diagnosed
**Given** lifecycle applies to a stopped formal SDD Explorer and the state is `diagnosed`
**When** `state.yaml` is inspected
**Then** it includes optional `exploration_context: sdd`, `exploration_lifecycle: diagnosed`, `decision_required: true`, and an explicit `next_action`, while `artifacts.exploration` still points to `exploration.md`
> Covers: REQ-REGISTRY-001, REQ-REGISTRY-002

#### Scenario: Minimal state entry for delegated diagnosed
**Given** lifecycle applies to a delegated Explorer diagnosis and the state is `diagnosed`
**When** `state.yaml` or equivalent registry surface is inspected
**Then** it includes optional `exploration_context: delegated`, `exploration_lifecycle: diagnosed`, `decision_required: true`, an explicit `next_action`, and a reference to the diagnostic artifact or note
> Covers: REQ-REGISTRY-001, REQ-REGISTRY-002, REQ-REGISTRY-005

#### Scenario: Lifecycle transition event is auditable
**Given** a lifecycle transition occurs in either context
**When** `events.yaml` is inspected
**Then** an appropriate lifecycle event exists with actor, timestamp, artifact, exploration context, lifecycle value, and a brief note or reference
> Covers: REQ-REGISTRY-004, REQ-REGISTRY-005

#### Scenario: Validator emits warning for lifecycle issue
**Given** registry data contains an unknown lifecycle-only or context-only value
**When** registry validation runs
**Then** validation reports a warning-level finding and does not fail solely because of that lifecycle/context value
> Covers: REQ-REGISTRY-006, REQ-REGISTRY-007

#### Scenario: Canonical registry errors stay strict
**Given** registry data contains an invalid canonical phase or global status
**When** registry validation runs
**Then** existing strict validation behavior remains in force
> Covers: REQ-REGISTRY-006, REQ-REGISTRY-007

#### Scenario: Optional SDD floating-exploration warning avoids false-positive strictness
**Given** a formal SDD change has `explore completed` with no Proposal and no lifecycle
**When** the validator supports a reliable low-noise check
**Then** it may emit a warning, not an error; if reliability is insufficient, the warning may be omitted
> Covers: REQ-REGISTRY-008

#### Scenario: Optional delegated-diagnosis warning avoids broad delegation false positives
**Given** a delegated Explorer record is explicitly marked as actionable but has no lifecycle or next action
**When** the validator supports a reliable low-noise check
**Then** it may emit a warning, not an error; ordinary delegated explorations without actionable findings are not warned solely for lacking lifecycle
> Covers: REQ-REGISTRY-009, REQ-LIFECYCLE-004

#### Scenario: Historical records are not auto-migrated
**Given** existing historical exploration-only changes or delegated diagnostic records
**When** this change is applied
**Then** those historical records are not automatically modified by this lifecycle change
> Covers: REQ-REGISTRY-010

## Validation Rules

| Field / Input | Rule | Error or Warning Message | REQ-ID |
|---|---|---|---|
| `exploration_context` | Optional when no lifecycle is present; required when `exploration_lifecycle` is present; expected values are `sdd` or `delegated` | Warning: unknown or missing exploration context for lifecycle | REQ-LIFECYCLE-001, REQ-REGISTRY-001, REQ-REGISTRY-007 |
| `exploration_lifecycle` | Optional; if present, expected values are `diagnosed`, `deferred`, `closed-no-action`, `converted-to-change`, `converted-to-sdd`, or `keep-as-reference` | Warning: unknown exploration lifecycle value | REQ-LIFECYCLE-005, REQ-REGISTRY-007 |
| Lifecycle applicability | Must only be requested/recorded for actionable diagnosis/root cause in SDD-stopped or delegated-not-immediately-converted contexts | Warning: lifecycle should only apply to actionable diagnoses that did not immediately continue | REQ-LIFECYCLE-002, REQ-LIFECYCLE-003, REQ-LIFECYCLE-004 |
| `decision_required` | Required and `true` when lifecycle is `diagnosed`; should not be true for `closed-no-action` or `keep-as-reference` | Warning: diagnosed exploration should mark decision_required true | REQ-LIFECYCLE-006, REQ-REGISTRY-002 |
| `next_action` | Required when lifecycle is `diagnosed`; must be explicit enough to indicate the next decision | Warning: diagnosed exploration should include next_action | REQ-LIFECYCLE-006, REQ-REGISTRY-002 |
| Deferred reason | Required in state note, event note, or artifact reference when lifecycle is `deferred` | Warning: deferred exploration should include reason | REQ-LIFECYCLE-007, REQ-REGISTRY-003 |
| Deferred reactivation condition | Required in state note, event note, or artifact reference when lifecycle is `deferred` | Warning: deferred exploration should include reactivation condition | REQ-LIFECYCLE-007, REQ-REGISTRY-003 |
| No-action reason | Required in state note, event note, or artifact reference when lifecycle is `closed-no-action` | Warning: closed-no-action exploration should include reason | REQ-LIFECYCLE-008, REQ-REGISTRY-003 |
| Change conversion reference | Required when lifecycle is `converted-to-change`; must reference `proposal.md` or target change | Warning: converted-to-change exploration should reference proposal or target change | REQ-LIFECYCLE-009, REQ-REGISTRY-003 |
| SDD conversion reference | Required when lifecycle is `converted-to-sdd`; must reference resulting change or SDD entry point | Warning: converted-to-sdd exploration should reference resulting SDD/change | REQ-LIFECYCLE-010, REQ-REGISTRY-003 |
| Keep-as-reference rationale | Required when lifecycle is `keep-as-reference` | Warning: keep-as-reference exploration should include rationale | REQ-LIFECYCLE-011, REQ-REGISTRY-003 |
| Lifecycle event metadata | Actor, timestamp, artifact, exploration context, lifecycle value, and brief note/reference expected | Warning: lifecycle event metadata incomplete | REQ-REGISTRY-005 |
| Canonical `currentPhase` / phase | Must remain one of the existing SDD canonical phases | Existing strict error | REQ-LIFECYCLE-012, REQ-REGISTRY-006 |
| Canonical global `status` | Must remain one of the existing canonical statuses | Existing strict error | REQ-LIFECYCLE-012, REQ-REGISTRY-006 |

## Error and Warning Contracts

| Condition | Code / Type | Message | Status |
|---|---|---|---|
| Unknown `exploration_context` value | `registry.lifecycle.unknown_context` | Unknown exploration context; expected sdd or delegated | Warning; validation must not fail solely for this |
| Missing `exploration_context` when lifecycle is present | `registry.lifecycle.missing_context` | Exploration lifecycle should include exploration_context | Warning |
| Unknown `exploration_lifecycle` value | `registry.lifecycle.unknown_value` | Unknown exploration lifecycle value; expected diagnosed, deferred, closed-no-action, converted-to-change, converted-to-sdd, or keep-as-reference | Warning; validation must not fail solely for this |
| Missing `next_action` for `diagnosed` | `registry.lifecycle.missing_next_action` | Diagnosed exploration should include explicit next_action | Warning |
| Missing reason or reactivation condition for `deferred` | `registry.lifecycle.incomplete_deferred` | Deferred exploration should include reason and reactivation condition | Warning |
| Missing reason for `closed-no-action` | `registry.lifecycle.incomplete_closed_no_action` | Closed-no-action exploration should include a brief reason | Warning |
| Missing change conversion reference | `registry.lifecycle.missing_conversion_reference` | Converted-to-change exploration should reference proposal.md or a target change | Warning |
| Missing SDD conversion reference | `registry.lifecycle.missing_sdd_reference` | Converted-to-sdd exploration should reference resulting SDD/change | Warning |
| Missing keep-as-reference rationale | `registry.lifecycle.missing_reference_rationale` | Keep-as-reference exploration should include a brief rationale | Warning |
| Invalid canonical phase/status | Existing canonical registry error | Existing canonical registry error message | Error; unchanged |

## States and Transitions

### States

| State | Description | Entry Criteria | Required Minimum Context |
|---|---|---|---|
| `diagnosed` | Actionable diagnosis exists, but no decision to propose/start SDD, defer, close, or keep as reference has been made | `sdd`: Explorer completed and flow stopped before Proposal; `delegated`: actionable diagnosis exists and was not immediately converted | `exploration_context`; `decision_required: true`; explicit `next_action`; brief reason or reference to diagnostic artifact |
| `deferred` | Diagnosis acknowledged and intentionally postponed | User/Orchestrator records a defer decision in either context | `exploration_context`; brief reason; minimum reactivation condition |
| `closed-no-action` | Diagnosis acknowledged and intentionally not implemented | User/Orchestrator records no-action decision in either context | `exploration_context`; brief reason |
| `converted-to-change` | Diagnosis converted to Proposal or linked target change after a pause/decision | Proposal is created after pause or destination change is linked | `exploration_context`; idempotent reference to `proposal.md` or target change |
| `converted-to-sdd` | Delegated diagnosis converted into formal SDD | Formal SDD/change is created from delegated diagnosis | `exploration_context: delegated`; idempotent reference to resulting SDD/change |
| `keep-as-reference` | Diagnosis intentionally retained as reference material with no current action planned | User/Orchestrator records reference-only decision, usually for delegated context | `exploration_context`; brief rationale; `decision_required` absent or false |

### Transitions

| From | To | Trigger | Side Effects |
|---|---|---|---|
| Formal SDD Explorer `blocked` | No lifecycle | Explorer lacks actionable diagnosis or has blockers | Preserve existing blocked/open-question behavior |
| Formal SDD Explorer `completed` | No lifecycle | Flow continues immediately to Proposal | No lifecycle prompt; canonical Proposal artifacts/events suffice |
| Formal SDD Explorer `completed` | `diagnosed` | Actionable diagnosis exists and SDD flow stops before Proposal without final decision | Optional state fields include `exploration_context: sdd`; `exploration.diagnosed` event when registry update is performed |
| Delegated Explorer result | No lifecycle | No actionable diagnosis/root cause is produced | Treat as ordinary exploratory answer/context/open question |
| Delegated Explorer result | No pending lifecycle or `converted-to-sdd` | Actionable diagnosis immediately creates/continues formal SDD | Formal SDD artifacts/events carry the flow; optional conversion bridge is not pending-decision state |
| Delegated Explorer result | `diagnosed` | Actionable diagnosis exists and is not immediately converted to SDD/Proposal | Optional state fields include `exploration_context: delegated`; `exploration.diagnosed` event when registry update is performed |
| `diagnosed` | `deferred` | User/Orchestrator decides to postpone | `exploration.deferred` event with reason/reactivation condition |
| `diagnosed` | `closed-no-action` | User/Orchestrator decides not to act | `exploration.closed-no-action` event with reason |
| `diagnosed` or `deferred` | `converted-to-change` | Proposal is created after pause or another change is linked | `exploration.converted-to-change` event with reference |
| Delegated `diagnosed` or `deferred` | `converted-to-sdd` | Formal SDD/change is created from delegated diagnosis | `exploration.converted-to-sdd` event with resulting SDD/change reference |
| Delegated `diagnosed` | `keep-as-reference` | User/Orchestrator keeps diagnosis for reference only | Optional `exploration.keep-as-reference` event with rationale |
| Any lifecycle state | No canonical phase/status change | Lifecycle is recorded or updated | Canonical SDD phase model remains unchanged |

## Anti-Bureaucracy Constraints

- Lifecycle MUST apply only to actionable diagnoses/root causes.
- Lifecycle MUST distinguish `exploration_context: sdd` from `exploration_context: delegated` when recorded.
- SDD lifecycle MUST apply only when formal SDD Explorer stops before Proposal.
- Delegated lifecycle MUST apply only when delegated Explorer produces actionable diagnosis/root cause and is not immediately converted to SDD/Proposal.
- Lifecycle MUST NOT be requested for exploratory queries, analysis, or Q&A with no actionable finding.
- Lifecycle MUST NOT be requested or recorded for direct Explorer → Proposal continuation or immediate delegated → SDD/Proposal conversion.
- Lifecycle MUST NOT create new artifacts beyond existing `exploration.md`, `state.yaml`, and `events.yaml` surfaces.
- Lifecycle MUST NOT become a new SDD phase, pipeline gate, Apply prerequisite, or strict validator blocker.
- `state.yaml` MUST remain a minimal index; extended rationale belongs in `exploration.md` and lifecycle events.
- Historical exploration-only or delegated-diagnostic records MUST NOT be auto-migrated in this change.

## Validator Warning-Level Support

- `exploration_context` and `exploration_lifecycle` are optional and auxiliary.
- Unknown lifecycle/context-only values, missing lifecycle metadata, and optional floating-exploration detection are warning-level findings.
- Warning-level lifecycle findings must not produce a failing validator outcome by themselves.
- Existing strict errors for canonical registry fields remain unchanged.
- A warning for formal `explore completed` without Proposal or lifecycle is allowed only if it can be implemented with low false-positive risk.
- A warning for delegated diagnoses without lifecycle is allowed only when the delegated record is explicitly actionable and detection is low-noise; generic Explorer delegations must not be warned solely for lacking lifecycle.

## Verification Matrix

| REQ-ID | Scenario(s) | Verification Method | Status |
|---|---|---|---|
| REQ-LIFECYCLE-001 | Formal SDD pause becomes diagnosed; Delegated diagnosis becomes diagnosed | Schema/doc and fixture coverage | Defined |
| REQ-LIFECYCLE-002 | Formal SDD pause becomes diagnosed | Prompt/content fixture for stopped SDD Explorer | Defined |
| REQ-LIFECYCLE-003 | Delegated diagnosis becomes diagnosed; Immediate delegated-to-SDD conversion has no diagnosed pause | Prompt/content fixture for delegated Explorer | Defined |
| REQ-LIFECYCLE-004 | Delegated exploratory answer has no lifecycle; Optional delegated-diagnosis warning avoids broad delegation false positives | Anti-bureaucracy prompt/content test | Defined |
| REQ-LIFECYCLE-005 | All lifecycle value scenarios; validator warning | Schema/doc and fixture coverage | Defined |
| REQ-LIFECYCLE-006 | Formal SDD pause becomes diagnosed; Delegated diagnosis becomes diagnosed | Fixture asserts decision_required and next_action | Defined |
| REQ-LIFECYCLE-007 | Diagnosis is intentionally deferred | Fixture asserts reason and reactivation condition | Defined |
| REQ-LIFECYCLE-008 | Diagnosis is closed without action | Fixture asserts brief reason | Defined |
| REQ-LIFECYCLE-009 | Paused SDD diagnosis converts to formal change | Fixture asserts idempotent proposal/change reference | Defined |
| REQ-LIFECYCLE-010 | Delegated diagnosis converts to SDD; Immediate delegated-to-SDD conversion has no diagnosed pause | Fixture asserts resulting SDD/change reference | Defined |
| REQ-LIFECYCLE-011 | Delegated diagnosis is retained as reference | Fixture asserts rationale and no pending decision | Defined |
| REQ-LIFECYCLE-012 | Lifecycle remains auxiliary | Schema/content check for unchanged canonical phases | Defined |
| REQ-ORCH-001 | Blocked formal SDD Explorer does not use lifecycle | Orchestrator prompt/content test | Defined |
| REQ-ORCH-002 | Immediate Proposal has no lifecycle friction | Orchestrator prompt/content test | Defined |
| REQ-ORCH-003 | Formal SDD pause becomes diagnosed; Interactive pause asks only minimum decision; Automatic pause records lifecycle only when stopped | Orchestrator prompt/content test | Defined |
| REQ-ORCH-004 | Delegated diagnosis becomes diagnosed; Immediate delegated-to-SDD conversion has no diagnosed pause; Interactive pause asks only minimum decision | Orchestrator prompt/content test | Defined |
| REQ-ORCH-005 | Delegated exploratory answer has no lifecycle | Orchestrator prompt/content test | Defined |
| REQ-ORCH-006 | Interactive pause asks only minimum decision | Prompt/content test | Defined |
| REQ-ORCH-007 | Immediate Proposal has no lifecycle friction; Immediate delegated-to-SDD conversion has no diagnosed pause; Automatic pause records lifecycle only when stopped | Prompt/content test | Defined |
| REQ-ORCH-008 | Interactive pause asks only minimum decision; Minimal state entry scenarios | Registry fixture/content inspection | Defined |
| REQ-REGISTRY-001 | Minimal state entry for SDD diagnosed; Minimal state entry for delegated diagnosed | Registry schema/doc fixture | Defined |
| REQ-REGISTRY-002 | Minimal state entry scenarios | Registry fixture validation | Defined |
| REQ-REGISTRY-003 | Deferred, closed, converted, keep-reference scenarios | Registry fixture validation | Defined |
| REQ-REGISTRY-004 | Lifecycle transition event is auditable | Events fixture inspection | Defined |
| REQ-REGISTRY-005 | Minimal delegated state entry; Lifecycle transition event is auditable | Events fixture validation | Defined |
| REQ-REGISTRY-006 | Validator emits warning; canonical errors stay strict | Validator behavior/content test | Defined |
| REQ-REGISTRY-007 | Validator emits warning; canonical errors stay strict | Validator behavior/content test | Defined |
| REQ-REGISTRY-008 | Optional SDD floating-exploration warning avoids false-positive strictness | Validator behavior test or documented non-implementation | Defined |
| REQ-REGISTRY-009 | Optional delegated-diagnosis warning avoids broad delegation false positives | Validator behavior test or documented non-implementation | Defined |
| REQ-REGISTRY-010 | Historical records are not auto-migrated | Diff/content review confirms no historical registry rewrites | Defined |

## Open Questions / Blockers

### Blockers

- None — the repair clarification is sufficient for Design and Task phases.

### Open Questions

- None — spec is self-contained after distinguishing formal SDD Explorer from delegated Explorer diagnostics.

### Follow-up Questions (Non-blocking)

- Should a future doctor/list command list `diagnosed`, `deferred`, and `keep-as-reference` explorations by context?
- Should historical exploration-only/delegated diagnostic records be classified manually in a separate cleanup change?

## Compliance Matrix

| REQ-ID | Scenario(s) | Status |
|---|---|---|
| REQ-LIFECYCLE-001 | Formal SDD pause becomes diagnosed; Delegated diagnosis becomes diagnosed | Defined |
| REQ-LIFECYCLE-002 | Formal SDD pause becomes diagnosed | Defined |
| REQ-LIFECYCLE-003 | Delegated diagnosis becomes diagnosed; Immediate delegated-to-SDD conversion has no diagnosed pause | Defined |
| REQ-LIFECYCLE-004 | Delegated exploratory answer has no lifecycle; Optional delegated-diagnosis warning avoids broad delegation false positives | Defined |
| REQ-LIFECYCLE-005 | Deferred, closed, converted, keep-reference, validator scenarios | Defined |
| REQ-LIFECYCLE-006 | Formal SDD pause becomes diagnosed; Delegated diagnosis becomes diagnosed | Defined |
| REQ-LIFECYCLE-007 | Diagnosis is intentionally deferred | Defined |
| REQ-LIFECYCLE-008 | Diagnosis is closed without action | Defined |
| REQ-LIFECYCLE-009 | Paused SDD diagnosis converts to formal change | Defined |
| REQ-LIFECYCLE-010 | Delegated diagnosis converts to SDD; Immediate delegated-to-SDD conversion has no diagnosed pause | Defined |
| REQ-LIFECYCLE-011 | Delegated diagnosis is retained as reference | Defined |
| REQ-LIFECYCLE-012 | Lifecycle remains auxiliary | Defined |
| REQ-ORCH-001 | Blocked formal SDD Explorer does not use lifecycle | Defined |
| REQ-ORCH-002 | Immediate Proposal has no lifecycle friction | Defined |
| REQ-ORCH-003 | Formal SDD pause becomes diagnosed; Interactive pause asks only minimum decision; Automatic pause records lifecycle only when stopped | Defined |
| REQ-ORCH-004 | Delegated diagnosis becomes diagnosed; Immediate delegated-to-SDD conversion has no diagnosed pause; Interactive pause asks only minimum decision | Defined |
| REQ-ORCH-005 | Delegated exploratory answer has no lifecycle | Defined |
| REQ-ORCH-006 | Interactive pause asks only minimum decision | Defined |
| REQ-ORCH-007 | Immediate Proposal has no lifecycle friction; Immediate delegated-to-SDD conversion has no diagnosed pause; Automatic pause records lifecycle only when stopped | Defined |
| REQ-ORCH-008 | Interactive pause asks only minimum decision; Minimal state entry scenarios | Defined |
| REQ-REGISTRY-001 | Minimal state entries | Defined |
| REQ-REGISTRY-002 | Minimal state entries | Defined |
| REQ-REGISTRY-003 | Deferred, closed, converted, keep-reference scenarios | Defined |
| REQ-REGISTRY-004 | Lifecycle transition event is auditable | Defined |
| REQ-REGISTRY-005 | Minimal delegated state entry; Lifecycle transition event is auditable | Defined |
| REQ-REGISTRY-006 | Validator emits warning; canonical errors stay strict | Defined |
| REQ-REGISTRY-007 | Validator emits warning; canonical errors stay strict | Defined |
| REQ-REGISTRY-008 | Optional SDD floating-exploration warning avoids false-positive strictness | Defined |
| REQ-REGISTRY-009 | Optional delegated-diagnosis warning avoids broad delegation false positives | Defined |
| REQ-REGISTRY-010 | Historical records are not auto-migrated | Defined |

## Mermaid Capability Map

```mermaid
flowchart TD
  A[Explorer result] --> B{Context?}
  B -->|Formal SDD| C{Blocked?}
  C -->|Yes| D[Existing blocker flow\nNo lifecycle]
  C -->|No: completed| E{Immediate Proposal?}
  E -->|Yes| F[Proposal flow\nNo lifecycle friction]
  E -->|No| G{Actionable diagnosis?}
  G -->|No| D
  G -->|Yes| H[sdd + diagnosed\ndecision_required + next_action]
  B -->|Delegated| I{Actionable diagnosis/root cause?}
  I -->|No| J[Exploratory answer/context\nNo lifecycle]
  I -->|Yes| K{Immediate SDD/Proposal?}
  K -->|Yes| L[converted-to-sdd or formal flow\nNo pending diagnosis]
  K -->|No| M[delegated + diagnosed\ndecision_required + next_action]
  H --> N[deferred\nreason + reactivation]
  M --> N
  H --> O[closed-no-action\nbrief reason]
  M --> O
  H --> P[converted-to-change\nproposal/change reference]
  N --> P
  M --> Q[converted-to-sdd\nresulting SDD/change reference]
  N --> Q
  M --> R[keep-as-reference\nrationale]
  H -. state.yaml .-> S[Optional context + lifecycle]
  M -. state.yaml .-> S
  N -. events.yaml .-> T[Auditable lifecycle event]
  O -. events.yaml .-> T
  P -. events.yaml .-> T
  Q -. events.yaml .-> T
  R -. events.yaml .-> T
  S --> U[Validator warning-level only]
  T --> U
```
