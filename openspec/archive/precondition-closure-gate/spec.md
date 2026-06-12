# Spec: Precondition Closure Gate

## Source

- Proposal: `precondition-closure-gate` proposal artifact
- Exploration: `precondition-closure-gate` exploration artifact
- Capabilities affected:
  - **New**: `precondition-closure-gate`
  - **Modified**: `developer-team-orchestration`, `spec-registry-validation`
  - **Unchanged**: `tasks-planning`, `apply-execution`

---

## Requirements

### Capability: precondition-closure-gate

REQ-pcg-001: The system MUST provide a `preconditions.md` artifact at `openspec/changes/{change-id}/preconditions.md` for any change that has intention to advance to Apply phase.
  Priority: MUST
  Surface: Data (artifact contract)
  Rationale: Auditable, versionable evidence that preconditions were reviewed before Apply.

REQ-pcg-002: The `preconditions.md` artifact MUST contain a preconditions table with columns: ID, Precondition, Source, Status, Evidence, Blocks Apply.
  Priority: MUST
  Surface: Data (artifact format)
  Rationale: Structured format enables Orchestrator gate evaluation and human review.

REQ-pcg-003: The `preconditions.md` artifact MUST contain a Closure Decision section with Ready for Apply field (Yes | No | Yes with conditions) and optional Notes.
  Priority: MUST
  Surface: Data (artifact format)
  Rationale: Explicit go/no-go decision with traceable rationale.

REQ-pcg-004: The system MUST support exactly five precondition statuses: `satisfied`, `blocked`, `allowed-with-placeholder`, `deferred`, `none`.
  Priority: MUST
  Surface: Data (status semantics)
  Rationale: Fixed vocabulary prevents ambiguity in gate evaluation.

REQ-pcg-005: A precondition with Status `satisfied` MUST indicate the precondition has been verified or resolved, with concrete evidence.
  Priority: MUST
  Surface: Data (status semantics)
  Rationale: Evidence-backed satisfaction proves the precondition is closed.

REQ-pcg-006: A precondition with Status `blocked` MUST indicate the precondition is not satisfied and, when Blocks Apply is `Yes`, prevents Apply from launching.
  Priority: MUST
  Surface: Data (status semantics)
  Rationale: Hard block prevents rework caused by unresolved dependencies.

REQ-pcg-007: A precondition with Status `allowed-with-placeholder` MUST include brief evidence describing the placeholder, stub, or accepted condition.
  Priority: MUST
  Surface: Data (status semantics)
  Rationale: Placeholder acceptance requires explicit documentation to avoid silent drift.

REQ-pcg-008: A precondition with Status `deferred` MUST include a brief reference to the follow-up change-id, task, or deferral reason.
  Priority: MUST
  Surface: Data (status semantics)
  Rationale: Deferred items need traceability to prevent loss.

REQ-pcg-009: A precondition with Status `none` MUST only appear when no relevant preconditions exist for the change.
  Priority: MUST
  Surface: Data (status semantics)
  Rationale: Prevents misuse of `none` as a catch-all status.

REQ-pcg-010: The `preconditions.md` content MAY be the literal value `None` (with no table) when no preconditions are identified.
  Priority: MAY
  Surface: Data (artifact format)
  Rationale: Zero-precondition changes should not be forced to produce an empty table.

REQ-pcg-011: The `preconditions.md` artifact MUST NOT duplicate tasks, dependencies, or implementation plans from `tasks.md`.
  Priority: MUST
  Surface: Data (anti-bureaucracy)
  Rationale: Duplication creates drift and maintenance burden.

REQ-pcg-012: The `preconditions.md` artifact MUST only contain closure status of known blockers, not task details or implementation steps.
  Priority: MUST
  Surface: Data (anti-bureaucracy)
  Rationale: Separation of concerns between closure tracking and work planning.

REQ-pcg-013: The `preconditions.md` artifact MUST be created only when a change has confirmed intention to advance to Apply phase.
  Priority: MUST
  Surface: Integration (lifecycle trigger)
  Rationale: Exploration-only or diagnostic changes must not be burdened with this artifact.

REQ-pcg-014: The Task Agent SHOULD create `preconditions.md` as part of its output, since it classifies blockers and open questions.
  Priority: SHOULD
  Surface: Integration (agent responsibility)
  Rationale: Task Agent has the most complete view of blockers at task-planning time.

REQ-pcg-015: The Orchestrator MAY derive or create `preconditions.md` when the Task Agent does not produce it, before launching Apply.
  Priority: MAY
  Surface: Integration (fallback)
  Rationale: Fallback prevents gate bypass due to Task Agent omission.

### Capability: developer-team-orchestration (modified)

REQ-orch-001: The Orchestrator MUST evaluate `preconditions.md` before launching Apply for any change that has the artifact.
  Priority: MUST
  Surface: Integration (gate execution)
  Rationale: Systematic gate prevents known preconditions from leaking into Apply.

REQ-orch-002: The Orchestrator MUST NOT launch Apply when any precondition row has Status `blocked` AND Blocks Apply column is `Yes`.
  Priority: MUST
  Surface: Integration (gate enforcement)
  Rationale: Hard enforcement prevents rework from unresolved blockers.

REQ-orch-003: The Orchestrator MUST stop and report to the user with the precondition table when Apply is blocked.
  Priority: MUST
  Surface: Integration (gate reporting)
  Rationale: User needs visibility into what is blocking and why.

REQ-orch-004: The Orchestrator MAY launch Apply when all preconditions are `satisfied`, `allowed-with-placeholder` (with documented evidence), or `deferred` (with follow-up reference).
  Priority: MAY
  Surface: Integration (gate pass)
  Rationale: Non-blocking statuses should not prevent progress.

REQ-orch-005: The Orchestrator MUST record the gate execution result in the registry events when advancing to Apply.
  Priority: MUST
  Surface: Integration (registry recording)
  Rationale: Auditable evidence that the gate was evaluated.

REQ-orch-006: The Orchestrator MUST skip the precondition gate for changes that have no intention to advance to Apply (exploration-only, diagnostic).
  Priority: MUST
  Surface: Integration (gate scope)
  Rationale: Gate must not burden non-Apply changes.

REQ-orch-007: The Orchestrator SHOULD infer Apply intention from: (a) explicit user instruction, (b) Tasks phase completion with Apply routing, or (c) proposal stating Apply intent.
  Priority: SHOULD
  Surface: Integration (intention detection)
  Rationale: Multiple signals reduce false negatives in gate activation.

REQ-orch-008: The gate evaluation MUST NOT take longer than resolving the underlying fix; if it does, the gate design is considered flawed.
  Priority: MUST
  Surface: Integration (anti-bureaucracy)
  Rationale: Explicit anti-bureaucracy constraint from proposal principle.

### Capability: spec-registry-validation (modified)

REQ-reg-001: The registry validator MAY verify the existence of `preconditions.md` when a change state indicates intention to advance to Apply.
  Priority: MAY
  Surface: Integration (validator support)
  Rationale: Structural sanity check supports the Orchestrator gate.

REQ-reg-002: The registry validator MUST NOT validate the full content or semantics of `preconditions.md` in the first iteration.
  Priority: MUST
  Surface: Integration (validator scope)
  Rationale: Content validation adds complexity without evidence of drift in first iteration.

REQ-reg-003: The registry validator MUST NOT block a change solely due to missing `preconditions.md` when the change is exploration-only or diagnostic.
  Priority: MUST
  Surface: Integration (validator scope)
  Rationale: Validator must respect gate scope boundaries.

REQ-reg-004: The registry state.yaml MUST reference `preconditions.md` in artifacts when the file exists.
  Priority: MUST
  Surface: Data (registry contract)
  Rationale: Consistent artifact tracking across phases.

REQ-reg-005: The registry events.yaml MUST record a gate evaluation event when the Orchestrator evaluates preconditions before Apply.
  Priority: MUST
  Surface: Data (registry contract)
  Rationale: Auditable trace of gate execution.

REQ-reg-006: The registry state.yaml SHOULD contain only minimal reference to the gate result (artifact reference + event), not duplicated precondition details.
  Priority: SHOULD
  Surface: Data (anti-bureaucracy)
  Rationale: Prevents schema bloat and duplication with `preconditions.md`.

---

## Acceptance Scenarios

### Capability: precondition-closure-gate

#### Scenario: Change with no preconditions produces None artifact

**Given** a change has completed Tasks phase with no identified blockers or preconditions
**When** the Task Agent produces output for the change
**Then** `preconditions.md` exists at `openspec/changes/{change-id}/preconditions.md`
**And** the content of `preconditions.md` is the literal value `None` (or a table with a single `none` row)
> Covers: REQ-pcg-001, REQ-pcg-010

#### Scenario: Change with satisfied preconditions passes gate

**Given** a change has `preconditions.md` with one precondition row: Status `satisfied`, Blocks Apply `No`, Evidence provided
**When** the Orchestrator evaluates the precondition gate before Apply
**Then** the Orchestrator determines the gate passes
**And** the Orchestrator launches Apply
**And** a gate evaluation event is recorded in events.yaml
> Covers: REQ-pcg-005, REQ-orch-001, REQ-orch-004, REQ-orch-005

#### Scenario: Change with blocked precondition stops Apply

**Given** a change has `preconditions.md` with one precondition row: Status `blocked`, Blocks Apply `Yes`
**When** the Orchestrator evaluates the precondition gate before Apply
**Then** the Orchestrator determines the gate fails
**And** the Orchestrator does NOT launch Apply
**And** the Orchestrator reports the blocking precondition table to the user
> Covers: REQ-pcg-006, REQ-orch-001, REQ-orch-002, REQ-orch-003

#### Scenario: Change with allowed-with-placeholder precondition passes with evidence

**Given** a change has `preconditions.md` with one precondition row: Status `allowed-with-placeholder`, Blocks Apply `No`, Evidence describes the placeholder/stub
**When** the Orchestrator evaluates the precondition gate before Apply
**Then** the Orchestrator determines the gate passes
**And** the Orchestrator launches Apply
> Covers: REQ-pcg-007, REQ-orch-001, REQ-orch-004

#### Scenario: Change with deferred precondition passes with follow-up reference

**Given** a change has `preconditions.md` with one precondition row: Status `deferred`, Blocks Apply `No`, Evidence references a follow-up change-id
**When** the Orchestrator evaluates the precondition gate before Apply
**Then** the Orchestrator determines the gate passes
**And** the Orchestrator launches Apply
> Covers: REQ-pcg-008, REQ-orch-001, REQ-orch-004

#### Scenario: preconditions.md does not duplicate tasks.md

**Given** a change has `tasks.md` with 15 tasks and implementation details
**When** `preconditions.md` is created for the change
**Then** `preconditions.md` contains only closure status of known blockers
**And** `preconditions.md` does NOT contain task descriptions, dependencies, or implementation plans
> Covers: REQ-pcg-011, REQ-pcg-012

#### Scenario: Exploration-only change skips precondition gate

**Given** a change is exploration-only with no intention to advance to Apply
**When** the Orchestrator processes the change
**Then** `preconditions.md` is NOT required
**And** the Orchestrator does NOT evaluate the precondition gate
> Covers: REQ-pcg-013, REQ-orch-006

#### Scenario: Task Agent omits preconditions.md, Orchestrator derives it

**Given** a change has completed Tasks phase but `preconditions.md` does not exist
**When** the Orchestrator prepares to launch Apply
**Then** the Orchestrator MAY derive `preconditions.md` from `tasks.md` Open Questions/Blockers section
**And** the Orchestrator evaluates the gate before launching Apply
> Covers: REQ-pcg-015, REQ-orch-001

#### Scenario: Invalid status in preconditions.md

**Given** a change has `preconditions.md` with a precondition row containing Status `unknown-status`
**When** the Orchestrator evaluates the precondition gate
**Then** the Orchestrator reports an invalid status error
**And** the Orchestrator does NOT launch Apply until the status is corrected
> Covers: REQ-pcg-004

#### Scenario: blocked status without Blocks Apply flag

**Given** a change has `preconditions.md` with a precondition row: Status `blocked`, Blocks Apply `No`
**When** the Orchestrator evaluates the precondition gate
**Then** the Orchestrator treats the precondition as non-blocking for Apply
**And** the Orchestrator MAY launch Apply if no other blockers exist
> Covers: REQ-pcg-006, REQ-orch-004

**Variant: Edge case — blocked with ambiguous Blocks Apply value**
  - Given a precondition row has Status `blocked` and Blocks Apply column is empty or missing
  - When the Orchestrator evaluates the gate
  - Then the Orchestrator SHOULD treat it as `Yes` (conservative) OR request clarification
  - And the Orchestrator does NOT silently pass the gate

---

### Capability: developer-team-orchestration (modified)

#### Scenario: Orchestrator records gate result in registry

**Given** a change has `preconditions.md` and the Orchestrator has evaluated the gate
**When** the Orchestrator advances the change to Apply phase
**Then** events.yaml contains a gate evaluation event referencing `preconditions.md`
**And** state.yaml artifacts section references `preconditions.md`
> Covers: REQ-orch-005, REQ-reg-004, REQ-reg-005

#### Scenario: Gate evaluation is fast

**Given** a change has `preconditions.md` with 3 precondition rows
**When** the Orchestrator evaluates the precondition gate
**Then** the gate evaluation completes in less time than it would take to resolve the simplest blocking precondition
> Covers: REQ-orch-008

#### Scenario: Orchestrator infers Apply intention from Tasks completion

**Given** a change has completed Tasks phase with Apply routing indicated
**When** the Orchestrator processes the change
**Then** the Orchestrator infers Apply intention
**And** the Orchestrator requires `preconditions.md` before launching Apply
> Covers: REQ-orch-007, REQ-pcg-013

---

### Capability: spec-registry-validation (modified)

#### Scenario: Validator checks existence of preconditions.md

**Given** a change state indicates intention to advance to Apply
**When** the registry validator runs
**Then** the validator MAY report if `preconditions.md` is missing
**And** the validator does NOT validate the full content of the file
> Covers: REQ-reg-001, REQ-reg-002

#### Scenario: Validator does not block exploration-only changes

**Given** a change is exploration-only with no Apply intention
**When** the registry validator runs
**Then** the validator does NOT report missing `preconditions.md`
**And** the validator does NOT block the change
> Covers: REQ-reg-003

#### Scenario: State.yaml references preconditions.md minimally

**Given** a change has `preconditions.md` and has advanced past the gate
**When** state.yaml is updated
**Then** state.yaml artifacts section contains `preconditions: preconditions.md`
**And** state.yaml does NOT duplicate precondition rows or statuses
> Covers: REQ-reg-004, REQ-reg-006

---

## Validation Rules

| Field / Input | Rule | Error Message | REQ-ID |
|---|---|---|---|
| Status | Must be one of: `satisfied`, `blocked`, `allowed-with-placeholder`, `deferred`, `none` | Invalid status `{value}`. Allowed: satisfied, blocked, allowed-with-placeholder, deferred, none | REQ-pcg-004 |
| Blocks Apply | Must be `Yes` or `No` | Invalid Blocks Apply value `{value}`. Allowed: Yes, No | REQ-pcg-002 |
| Evidence (when Status = satisfied) | Must contain concrete verification evidence | Satisfied precondition `{id}` requires concrete evidence | REQ-pcg-005 |
| Evidence (when Status = allowed-with-placeholder) | Must describe the placeholder or accepted condition | allowed-with-placeholder precondition `{id}` requires placeholder description | REQ-pcg-007 |
| Evidence (when Status = deferred) | Must reference follow-up change-id, task, or deferral reason | Deferred precondition `{id}` requires follow-up reference | REQ-pcg-008 |
| Blocks Apply (when Status = blocked) | SHOULD be `Yes` unless explicitly justified | Blocked precondition `{id}` with Blocks Apply = No requires justification | REQ-pcg-006 |
| Artifact content (when not None) | Must contain preconditions table with required columns | preconditions.md missing required columns: ID, Precondition, Source, Status, Evidence, Blocks Apply | REQ-pcg-002 |
| Artifact content (when not None) | Must contain Closure Decision section | preconditions.md missing Closure Decision section | REQ-pcg-003 |
| Artifact content | Must NOT duplicate tasks.md content | preconditions.md contains task details; only closure status allowed | REQ-pcg-011 |

---

## Error Contracts

| Condition | Error Code | Message | Status |
|---|---|---|---|
| Invalid precondition status | INVALID_STATUS | Invalid status `{value}` in precondition `{id}`. Allowed: satisfied, blocked, allowed-with-placeholder, deferred, none | Gate fails; Apply blocked |
| Missing evidence for satisfied | MISSING_EVIDENCE | Satisfied precondition `{id}` requires concrete evidence | Gate fails; Apply blocked |
| Missing placeholder description | MISSING_PLACEHOLDER | allowed-with-placeholder precondition `{id}` requires placeholder description | Gate fails; Apply blocked |
| Missing deferral reference | MISSING_DEFERRAL | Deferred precondition `{id}` requires follow-up reference | Gate fails; Apply blocked |
| Active blocker with Blocks Apply = Yes | ACTIVE_BLOCKER | Precondition `{id}` is blocked and blocks Apply. Cannot proceed. | Gate fails; Apply blocked; reported to user |
| Missing preconditions.md before Apply | MISSING_ARTIFACT | preconditions.md not found for change with Apply intention | Gate fails; Apply blocked until artifact created |
| preconditions.md duplicates tasks.md | DUPLICATE_CONTENT | preconditions.md contains task details; only closure status allowed | Warning; artifact needs correction |
| Validator reports missing artifact (exploration-only) | FALSE_POSITIVE | Validator incorrectly reports missing preconditions.md for exploration-only change | Validator misconfiguration; no gate impact |

---

## States and Transitions

### Precondition States

| State | Description | Entry Criteria |
|---|---|---|
| `none` | No relevant preconditions exist for the change | Change has no identified blockers or risks from Explorer/Design/Tasks |
| `satisfied` | Precondition has been verified or resolved with evidence | Evidence provided showing precondition is closed |
| `blocked` | Precondition is not satisfied and blocks Apply (when Blocks Apply = Yes) | Precondition identified but not resolved; impact on Apply assessed |
| `allowed-with-placeholder` | Precondition not satisfied but Apply can proceed with documented placeholder | Placeholder/stub described; accepted condition documented |
| `deferred` | Precondition recognized but moved to another change or follow-up | Follow-up change-id or deferral reason referenced |

### Gate States

| State | Description | Entry Criteria |
|---|---|---|
| `gate-not-applicable` | Change has no intention to advance to Apply | Exploration-only, diagnostic, or user explicitly states no Apply |
| `gate-pending` | Change has Apply intention but gate not yet evaluated | Tasks phase completed; Apply routing indicated |
| `gate-passed` | All preconditions are non-blocking or satisfied | No precondition with Status `blocked` AND Blocks Apply `Yes` |
| `gate-failed` | One or more preconditions block Apply | At least one precondition with Status `blocked` AND Blocks Apply `Yes` |

### Gate Transitions

| From | To | Trigger | Side Effects |
|---|---|---|---|
| `gate-not-applicable` | (no transition) | N/A | No gate evaluation; no artifact required |
| `gate-pending` | `gate-passed` | Orchestrator evaluates gate; no active blockers | Apply launched; gate event recorded in events.yaml |
| `gate-pending` | `gate-failed` | Orchestrator evaluates gate; active blocker found | Apply NOT launched; blocking table reported to user |
| `gate-failed` | `gate-pending` | User resolves blocking precondition; re-evaluation requested | Orchestrator re-evaluates gate |
| `gate-failed` | `gate-passed` | All blockers resolved or reclassified | Apply launched; gate event recorded |

---

## Open Questions

### Classification: Design Decision (requires user/stakeholder input)

- **OQ-1**: Should the Task Agent ALWAYS create `preconditions.md`, or can the Orchestrator derive it when Tasks does not produce it?
  - Current direction: Task Agent SHOULD create it; Orchestrator MAY derive as fallback.
  - Open: Is the fallback acceptable, or should it be mandatory for Task Agent?

- **OQ-2**: Should the gate execution be recorded as an artifact/provenance entry in `state.yaml`, or is an event in `events.yaml` sufficient?
  - Current direction: Event in events.yaml + minimal artifact reference in state.yaml.
  - Open: Is minimal reference enough, or should state.yaml contain gate result summary?

### Classification: Implementation Detail (can be deferred to Design/Tasks)

- **OQ-3**: How should the Orchestrator infer Apply intention when not explicitly stated?
  - Current direction: From Tasks completion with Apply routing, or proposal stating Apply intent.
  - Open: What are the exact heuristics? (Deferred to Design)

- **OQ-4**: Should the registry validator's existence check be opt-in or always-on when `strict_tdd: true`?
  - Current direction: Optional support; not a dependency.
  - Open: Integration with `strict_tdd_gates` config. (Deferred to Design)

### Classification: Future Enhancement (out of scope for first iteration)

- **OQ-5**: Should the validator validate content/semantics of `preconditions.md` in a future iteration?
  - Current direction: No; existence-only in first iteration.
  - Open: Under what evidence of drift would content validation be justified? (Follow-up)

- **OQ-6**: Should exploration-only changes that find blocking preconditions be archived with a `blocked` or `deferred` state?
  - Current direction: Use `deferred` in `preconditions.md`; explore `diagnosed` lifecycle state in follow-up.
  - Open: Is a new lifecycle state needed? (Follow-up: exploration-lifecycle)

---

## Compliance Matrix

| REQ-ID | Scenario(s) | Status |
|---|---|---|
| REQ-pcg-001 | Change with no preconditions produces None artifact | Defined |
| REQ-pcg-002 | Validation Rules (table columns) | Defined |
| REQ-pcg-003 | Validation Rules (Closure Decision section) | Defined |
| REQ-pcg-004 | Invalid status in preconditions.md | Defined |
| REQ-pcg-005 | Change with satisfied preconditions passes gate | Defined |
| REQ-pcg-006 | Change with blocked precondition stops Apply; blocked status without Blocks Apply flag | Defined |
| REQ-pcg-007 | Change with allowed-with-placeholder precondition passes with evidence | Defined |
| REQ-pcg-008 | Change with deferred precondition passes with follow-up reference | Defined |
| REQ-pcg-009 | Validation Rules (none status usage) | Defined |
| REQ-pcg-010 | Change with no preconditions produces None artifact | Defined |
| REQ-pcg-011 | preconditions.md does not duplicate tasks.md | Defined |
| REQ-pcg-012 | preconditions.md does not duplicate tasks.md | Defined |
| REQ-pcg-013 | Exploration-only change skips precondition gate | Defined |
| REQ-pcg-014 | (Agent responsibility; covered by Task Agent scenarios) | Defined |
| REQ-pcg-015 | Task Agent omits preconditions.md, Orchestrator derives it | Defined |
| REQ-orch-001 | Change with satisfied preconditions passes gate; Change with blocked precondition stops Apply | Defined |
| REQ-orch-002 | Change with blocked precondition stops Apply | Defined |
| REQ-orch-003 | Change with blocked precondition stops Apply | Defined |
| REQ-orch-004 | Change with satisfied/allowed-with-placeholder/deferred preconditions passes gate | Defined |
| REQ-orch-005 | Orchestrator records gate result in registry | Defined |
| REQ-orch-006 | Exploration-only change skips precondition gate | Defined |
| REQ-orch-007 | Orchestrator infers Apply intention from Tasks completion | Defined |
| REQ-orch-008 | Gate evaluation is fast | Defined |
| REQ-reg-001 | Validator checks existence of preconditions.md | Defined |
| REQ-reg-002 | Validator checks existence of preconditions.md | Defined |
| REQ-reg-003 | Validator does not block exploration-only changes | Defined |
| REQ-reg-004 | Orchestrator records gate result in registry; State.yaml references preconditions.md minimally | Defined |
| REQ-reg-005 | Orchestrator records gate result in registry | Defined |
| REQ-reg-006 | State.yaml references preconditions.md minimally | Defined |

---

## Mermaid Capability Map

```mermaid
flowchart TB
    subgraph "precondition-closure-gate (NEW)"
        PCG_Artifact[preconditions.md<br/>artifact contract]
        PCG_Status[Status semantics<br/>satisfied | blocked |<br/>allowed-with-placeholder |<br/>deferred | none]
        PCG_Format[Minimum format<br/>table + Closure Decision]
        PCG_AntiBuro[Anti-bureaucracy<br/>None allowed | no task duplication]
    end

    subgraph "developer-team-orchestration (MODIFIED)"
        ORCH_Gate[Gate evaluation<br/>before Apply]
        ORCH_Enforce[Gate enforcement<br/>block if blocked+Yes]
        ORCH_Report[Gate reporting<br/>to user]
        ORCH_Record[Gate recording<br/>in registry]
        ORCH_Scope[Gate scope<br/>skip if no Apply intent]
    end

    subgraph "spec-registry-validation (MODIFIED)"
        REG_Exist[Existence check<br/>optional support]
        REG_NoContent[No content validation<br/>first iteration]
        REG_NoBlock[No block for<br/>exploration-only]
    end

    PCG_Artifact --> ORCH_Gate
    PCG_Status --> ORCH_Enforce
    PCG_Format --> REG_Exist
    PCG_AntiBuro --> ORCH_Scope

    ORCH_Gate --> ORCH_Enforce
    ORCH_Enforce --> ORCH_Report
    ORCH_Gate --> ORCH_Record
    ORCH_Scope --> ORCH_Gate

    REG_Exist -. supports .-> ORCH_Gate
    REG_NoContent -. constraint .-> REG_Exist
    REG_NoBlock -. constraint .-> REG_Exist
```

---

## Verification Matrix

| Verification Point | Method | Expected Result | REQ-IDs |
|---|---|---|---|
| preconditions.md exists before Apply | File existence check | File exists at expected path | REQ-pcg-001 |
| preconditions.md has required table columns | Column presence check | ID, Precondition, Source, Status, Evidence, Blocks Apply present | REQ-pcg-002 |
| preconditions.md has Closure Decision section | Section presence check | Section exists with Ready for Apply field | REQ-pcg-003 |
| Status values are valid | Enum validation | All Status values in {satisfied, blocked, allowed-with-placeholder, deferred, none} | REQ-pcg-004 |
| satisfied status has evidence | Content check | Evidence column non-empty for satisfied rows | REQ-pcg-005 |
| blocked+Yes prevents Apply | Gate logic check | Orchestrator does not launch Apply | REQ-pcg-006, REQ-orch-002 |
| allowed-with-placeholder has placeholder description | Content check | Evidence describes placeholder/stub | REQ-pcg-007 |
| deferred has follow-up reference | Content check | Evidence references change-id or reason | REQ-pcg-008 |
| none status only when no preconditions | Semantic check | none appears only in zero-precondition changes | REQ-pcg-009 |
| None content allowed | Content check | Literal "None" accepted as valid content | REQ-pcg-010 |
| No task duplication | Content comparison | preconditions.md does not contain task details from tasks.md | REQ-pcg-011, REQ-pcg-012 |
| Gate skipped for exploration-only | Scope check | No gate evaluation for non-Apply changes | REQ-pcg-013, REQ-orch-006 |
| Task Agent creates preconditions.md | Agent output check | Artifact present after Tasks phase | REQ-pcg-014 |
| Orchestrator fallback derivation | Fallback check | Orchestrator creates artifact when Task Agent omits | REQ-pcg-015 |
| Orchestrator evaluates gate | Gate execution check | Gate evaluation occurs before Apply launch | REQ-orch-001 |
| Gate failure reported to user | Reporting check | User receives blocking precondition table | REQ-orch-003 |
| Gate event recorded | Registry check | events.yaml contains gate evaluation event | REQ-orch-005, REQ-reg-005 |
| Gate evaluation is fast | Performance check | Evaluation time < simplest fix resolution time | REQ-orch-008 |
| Validator existence check | Validator check | Validator reports missing artifact when applicable | REQ-reg-001 |
| Validator no content validation | Validator scope check | Validator does not parse full content | REQ-reg-002 |
| Validator no block for exploration-only | Validator scope check | Validator does not block non-Apply changes | REQ-reg-003 |
| State.yaml minimal reference | Registry check | state.yaml references artifact without duplicating content | REQ-reg-004, REQ-reg-006 |
