# Spec: Optimize SDD v2 Core Implementation

## Source

- Proposal: `optimize-sdd-v2-core-implementation` proposal artifact
- Prior spec (reused): `optimize-sdd-apply-and-commit-suggestions/spec.md` — 27 valid REQs across 7 capabilities
- Exploration: `optimize-sdd-v2-core-implementation/exploration.md`
- Capabilities affected: `sdd-apply-orchestration`, `sdd-post-archive-git-suggestions`, `sdd-explorer-triage`, `orchestrator-role-based-delegation`, `sdd-phase-artifact-verification`, `orchestrator-agent-config-respect`, `sdd-phase-mermaid-summaries`
- Registry mode: deferred; this artifact defines registry intent only and does not update `state.yaml` or `events.yaml`.

## v2 Change from Prior Spec

This v2 cycle addresses the same 7 orchestration needs as the prior spec but targets the **correct source layer** (`packages/core/src/teams/developer/`) instead of `.pi/` (which is gitignored adapter output). All requirements, acceptance scenarios, validation rules, error contracts, and states from the prior spec remain valid. This spec updates **source file references** and adds a **Source File Map** section to guide implementation.

## Source File Map

| Need | Capability | Primary Source File(s) | Section(s) to Modify |
|---|---|---|---|
| 1. Apply batching | `sdd-apply-orchestration` | `packages/core/src/teams/developer/orchestrator-content.ts` | ORCHESTRATOR_SYSTEM_PROMPT Apply Routing; ORCHESTRATOR_SKILL_BODY |
| 2. Post-Archive Git suggestions | `sdd-post-archive-git-suggestions` | `orchestrator-content.ts` + `archive-content.ts` | ORCHESTRATOR_SYSTEM_PROMPT post-Archive section; ARCHIVE_SKILL_BODY diff-context prep |
| 3. Explorer-before-Proposal triage | `sdd-explorer-triage` | `orchestrator-content.ts` | ORCHESTRATOR_SYSTEM_PROMPT SDD Triage Gate; ORCHESTRATOR_SKILL_BODY |
| 4. Role-based delegation | `orchestrator-role-based-delegation` | `orchestrator-content.ts` | ORCHESTRATOR_SYSTEM_PROMPT Delegation Rules; Sub-Agent Context Protocol |
| 5. Persistence hardening | `sdd-phase-artifact-verification` | `orchestrator-content.ts` + all `*-content.ts` files + possibly `packages/sdd-runtime/src/artifact-state/artifact-state-manager.ts` | ORCHESTRATOR_SYSTEM_PROMPT Artifact Persistence Policy; per-phase SKILL_BODY self-verification steps |
| 6. Execution config respect | `orchestrator-agent-config-respect` | `orchestrator-content.ts` | ORCHESTRATOR_SYSTEM_PROMPT Agent Launch/Delegation Guidance |
| 7. Mermaid-backed summaries | `sdd-phase-mermaid-summaries` | `visual-explanations-content.ts` + `orchestrator-content.ts` + `proposal-content.ts` + `spec-content.ts` + `design-content.ts` + `task-content.ts` | VISUAL_EXPLANATIONS_SKILL_FRAGMENT; Orchestrator summary guidance; phase return contracts |

**NOT in scope:** `packages/adapter-pi/` (adapter is passthrough), `.pi/` (generated output), product source code.

## Requirements

### Capability: sdd-apply-orchestration

REQ-APPLY-001: The Orchestrator MUST NOT default to launching one Apply agent per task when tasks share a coherent owner, context, dependency chain, file area, component, service, or verification path.
  Priority: MUST
  Surface: General
  Rationale: Reduces unnecessary fanout and preserves context continuity for related work.
  Source: `orchestrator-content.ts` — Apply Routing section

REQ-APPLY-002: The Orchestrator MUST group related Apply work into coherent batches by owner/context and may assign an ordered list of related tasks to one appropriately specialized Apply agent.
  Priority: MUST
  Surface: General
  Rationale: Ensures related implementation work is handled with shared context and explicit ordering.
  Source: `orchestrator-content.ts` — Apply Routing section

REQ-APPLY-003: The Orchestrator MUST launch multiple Apply agents only when work areas are independent, non-overlapping, have no ordering dependency, have low conflict risk, and can be verified independently.
  Priority: MUST
  Surface: General
  Rationale: Keeps parallelism safe and prevents avoidable conflicts.
  Source: `orchestrator-content.ts` — Apply Routing section

REQ-APPLY-004: Apply dispatch MUST preserve dependency-aware ordering, including shared/contracts work before dependent backend/frontend work and backend/frontend parallelism only when dependencies are clear.
  Priority: MUST
  Surface: General
  Rationale: Prevents dependent agents from implementing against unstable or missing contracts.
  Source: `orchestrator-content.ts` — Apply Routing section

REQ-APPLY-005: Task output SHOULD provide execution groups and parallelization guidance that the Orchestrator can use as the primary source for Apply batching decisions.
  Priority: SHOULD
  Surface: General
  Rationale: Keeps Apply dispatch grounded in the formal task plan.
  Source: `orchestrator-content.ts` — Apply Routing section

### Capability: sdd-post-archive-git-suggestions

REQ-GIT-001: After Archive completes, the Orchestrator MUST provide advisory conventional commit message suggestion(s) based on the completed change/diff context.
  Priority: MUST
  Surface: UI
  Rationale: Helps users finish changes with consistent Git metadata.
  Source: `orchestrator-content.ts` — post-Archive section

REQ-GIT-002: Post-Archive Git suggestions MUST NOT automatically commit, push, change branches, create PRs, or otherwise mutate Git state.
  Priority: MUST
  Surface: Security
  Rationale: Preserves human control of repository state.
  Source: `orchestrator-content.ts` — post-Archive section

REQ-GIT-003: The Orchestrator SHOULD provide optional PR title/body suggestions after Archive when sufficient completed change/diff context exists.
  Priority: SHOULD
  Surface: UI
  Rationale: Assists users preparing review metadata without requiring automation.
  Source: `orchestrator-content.ts` — post-Archive section; `archive-content.ts` — ARCHIVE_SKILL_BODY diff-context prep

REQ-GIT-004: When conventional commit type or scope is ambiguous, suggestions SHOULD be labeled advisory and may include multiple candidates or note the ambiguity.
  Priority: SHOULD
  Surface: UI
  Rationale: Avoids presenting inferred Git metadata as authoritative.
  Source: `orchestrator-content.ts` — post-Archive section

### Capability: sdd-explorer-triage

REQ-TRIAGE-001: Before Proposal, the Orchestrator MUST route to Explorer when requested work requires codebase, architecture, agent configuration, prompt, SDD workflow, OpenSpec, routing, or broad-impact understanding.
  Priority: MUST
  Surface: General
  Rationale: Ensures Proposal is informed by appropriate discovery for high-impact workflow changes.
  Source: `orchestrator-content.ts` — SDD Triage Gate section

REQ-TRIAGE-002: Explorer-before-Proposal triage MUST treat internal workflow and agent-system changes as eligible for exploration even when they do not modify product code.
  Priority: MUST
  Surface: General
  Rationale: Prevents prompt/configuration/workflow changes from bypassing discovery.
  Source: `orchestrator-content.ts` — SDD Triage Gate section

### Capability: orchestrator-role-based-delegation

REQ-DELEGATION-001: Outside formal SDD and direct workflows, the Orchestrator MUST apply specialized role-based delegation when registered delegation rules trigger.
  Priority: MUST
  Surface: General
  Rationale: Preserves specialized agent responsibilities in non-SDD contexts.
  Source: `orchestrator-content.ts` — Delegation Rules and Sub-Agent Context Protocol sections

REQ-DELEGATION-002: Role-based delegation outside SDD MUST NOT redefine or skip the formal SDD phase sequence when the user is running an SDD workflow.
  Priority: MUST
  Surface: General
  Rationale: Keeps formal SDD authoritative while allowing delegation elsewhere.
  Source: `orchestrator-content.ts` — Delegation Rules section

### Capability: sdd-phase-artifact-verification

REQ-VERIFY-001: A phase agent MUST self-verify required artifact files exist on disk before claiming phase completion.
  Priority: MUST
  Surface: Data
  Rationale: Prevents false-positive completion reports for missing artifacts.
  Source: `orchestrator-content.ts` — Artifact Persistence Policy; per-phase `*-content.ts` SKILL_BODY self-verification steps; possibly `artifact-state-manager.ts`

REQ-VERIFY-002: In non-deferred registry mode, a phase agent MUST verify required registry state/event persistence before claiming completion.
  Priority: MUST
  Surface: Data
  Rationale: Ensures official OpenSpec registry reflects reported phase completion.
  Source: `orchestrator-content.ts` — Artifact Persistence Policy; possibly `artifact-state-manager.ts`

REQ-VERIFY-003: In registry-deferred mode, a phase agent MUST verify the phase artifact exists and return registry intent instead of claiming registry writes.
  Priority: MUST
  Surface: Data
  Rationale: Supports safe parallel phases without concurrent registry writes.
  Source: `orchestrator-content.ts` — Artifact Persistence Policy

REQ-VERIFY-004: The Orchestrator MUST verify official artifact and registry state before advancing to the next phase that depends on those records.
  Priority: MUST
  Surface: Data
  Rationale: Makes official OpenSpec artifacts and registry entries the source of truth for phase advancement.
  Source: `orchestrator-content.ts` — Artifact Persistence Policy

REQ-VERIFY-005: Completion evidence SHOULD include the artifact path, `exists=true`, byte count, phase status, registry intent or recorded event type, and any blocker.
  Priority: SHOULD
  Surface: Data
  Rationale: Provides compact, testable verification evidence.
  Source: `orchestrator-content.ts` — Artifact Persistence Policy

### Capability: orchestrator-agent-config-respect

REQ-CONFIG-001: The Orchestrator MUST use registered agent execution configuration by default, including model, context, thinking, tools, and similar settings.
  Priority: MUST
  Surface: General
  Rationale: Prevents arbitrary launcher overrides from bypassing registered agent configuration.
  Source: `orchestrator-content.ts` — Agent Launch/Delegation Guidance

REQ-CONFIG-002: The Orchestrator MUST NOT override registered execution configuration unless explicitly requested by the user or required by documented workflow rules.
  Priority: MUST
  Surface: General
  Rationale: Keeps exceptions deliberate and auditable.
  Source: `orchestrator-content.ts` — Agent Launch/Delegation Guidance

REQ-CONFIG-003: When an allowed execution-configuration override is used, the Orchestrator SHOULD identify the basis for the override in its delegation context or summary.
  Priority: SHOULD
  Surface: General
  Rationale: Provides provenance for non-default execution behavior.
  Source: `orchestrator-content.ts` — Agent Launch/Delegation Guidance

### Capability: sdd-phase-mermaid-summaries

REQ-MERMAID-001: After Proposal, Spec, Design, and Task phases, the Orchestrator MUST include a concise Mermaid diagram in its user-facing phase summary.
  Priority: MUST
  Surface: UI
  Rationale: Improves user comprehension of phase outputs across supported runners.
  Source: `orchestrator-content.ts` — summary guidance; `visual-explanations-content.ts` — VISUAL_EXPLANATIONS_SKILL_FRAGMENT

REQ-MERMAID-002: Phase agents for Proposal, Spec, Design, and Task SHOULD provide Mermaid source or diagram-ready data in artifacts or return contracts when useful for Orchestrator summaries.
  Priority: SHOULD
  Surface: Data
  Rationale: Enables consistent summaries while keeping presentation ownership with the Orchestrator.
  Source: `proposal-content.ts`, `spec-content.ts`, `design-content.ts`, `task-content.ts` — return contracts

REQ-MERMAID-003: Mermaid diagrams MUST be explanatory and non-authoritative; official OpenSpec artifacts and registry entries remain authoritative.
  Priority: MUST
  Surface: General
  Rationale: Prevents diagrams from replacing required textual specifications or registry records.
  Source: `orchestrator-content.ts` — summary guidance; `visual-explanations-content.ts`

REQ-MERMAID-004: Mermaid summaries MUST be runner-agnostic and remain understandable as fenced source when a runner does not render Mermaid.
  Priority: MUST
  Surface: UI
  Rationale: Maintains usability across rendering environments.
  Source: `orchestrator-content.ts` — summary guidance

REQ-MERMAID-005: Phase-summary guidance that discourages Mermaid syntax MUST be reconciled so it does not prohibit the required Proposal, Spec, Design, and Task summary diagrams.
  Priority: MUST
  Surface: UI
  Rationale: Removes conflict between existing visual guidance and the new phase-specific requirement.
  Source: `orchestrator-content.ts` — summary guidance; `visual-explanations-content.ts`

## Acceptance Scenarios

### Capability: sdd-apply-orchestration

#### Scenario: Related tasks are batched into one ordered Apply assignment
**Given** a Task artifact defines related shared and backend tasks that touch the same service or contract
**When** the Orchestrator dispatches Apply work
**Then** it assigns the related tasks as an ordered list to one suitable Apply agent instead of launching one agent per task
> Covers: REQ-APPLY-001, REQ-APPLY-002, REQ-APPLY-004, REQ-APPLY-005

#### Scenario: Independent work is safely parallelized
**Given** a Task artifact defines frontend and backend work with non-overlapping files/components/services, no ordering dependency, low conflict risk, and independent verification paths
**When** the Orchestrator dispatches Apply work
**Then** it may launch separate appropriately specialized Apply agents for those independent areas
> Covers: REQ-APPLY-003, REQ-APPLY-005

#### Scenario: Shared contract work blocks dependent parallelism
**Given** frontend and backend tasks both depend on a shared contract task
**When** the Orchestrator plans Apply dispatch
**Then** it schedules or delegates the shared/contract task before dependent backend/frontend work and does not parallelize dependent work until dependencies are clear
> Covers: REQ-APPLY-004

#### Scenario: Conflict risk prevents multi-agent fanout
**Given** two tasks appear independent but modify overlapping files, components, services, or verification fixtures
**When** the Orchestrator evaluates Apply fanout
**Then** it keeps the tasks in one ordered batch or otherwise avoids parallel Apply agents for those tasks
> Covers: REQ-APPLY-001, REQ-APPLY-003

### Capability: sdd-post-archive-git-suggestions

#### Scenario: Archive completion produces advisory Git metadata
**Given** Archive has completed and completed change/diff context is available
**When** the Orchestrator presents the post-Archive summary
**Then** it includes advisory conventional commit suggestion(s) and optional PR title/body suggestions when sufficient context exists
> Covers: REQ-GIT-001, REQ-GIT-003

#### Scenario: Git suggestions do not mutate repository state
**Given** Archive has completed
**When** the Orchestrator provides commit or PR metadata suggestions
**Then** no commit, push, branch change, PR creation, or other Git-state mutation occurs automatically
> Covers: REQ-GIT-002

#### Scenario: Ambiguous conventional commit suggestion
**Given** the completed diff supports more than one plausible conventional commit type or scope
**When** the Orchestrator generates post-Archive suggestions
**Then** it labels the suggestions as advisory and either presents multiple candidates or notes the ambiguity
> Covers: REQ-GIT-004

#### Scenario: Archive agent prepares diff context for post-Archive step
**Given** the Archive agent has completed its archival work for a change
**When** it writes its completion response
**Then** it includes the change diff context needed for the Orchestrator's post-Archive Git suggestion step
> Covers: REQ-GIT-001, REQ-GIT-003

### Capability: sdd-explorer-triage

#### Scenario: Internal workflow change triggers Explorer before Proposal
**Given** a user requests a change involving agent configuration, prompts, SDD workflow internals, OpenSpec behavior, routing, or broad project impact
**When** the Orchestrator performs pre-Proposal triage
**Then** it routes to Explorer before Proposal
> Covers: REQ-TRIAGE-001, REQ-TRIAGE-002

#### Scenario: Product architecture change triggers Explorer before Proposal
**Given** a user requests a change that requires codebase or architecture understanding
**When** the Orchestrator performs pre-Proposal triage
**Then** it routes to Explorer before Proposal
> Covers: REQ-TRIAGE-001

### Capability: orchestrator-role-based-delegation

#### Scenario: Specialized delegation outside formal SDD
**Given** the user is not running formal SDD or a direct workflow and a registered specialized delegation rule triggers
**When** the Orchestrator handles the request
**Then** it delegates to the appropriate specialized role according to registered rules
> Covers: REQ-DELEGATION-001

#### Scenario: Formal SDD sequence remains authoritative
**Given** the user is running a formal SDD workflow
**When** specialized role rules would otherwise apply
**Then** the Orchestrator preserves the formal SDD phase sequence and does not skip required phases because of non-SDD delegation rules
> Covers: REQ-DELEGATION-002

### Capability: sdd-phase-artifact-verification

#### Scenario: Phase agent verifies artifact before success
**Given** a phase agent has written its required artifact
**When** it prepares its completion response
**Then** it verifies the artifact exists on disk and reports completion evidence including path and byte count
> Covers: REQ-VERIFY-001, REQ-VERIFY-005

#### Scenario: Non-deferred registry mode requires registry verification
**Given** a phase runs in non-deferred registry mode
**When** the phase agent prepares to claim completion
**Then** it verifies required artifact, state, and event persistence before reporting completed status
> Covers: REQ-VERIFY-001, REQ-VERIFY-002, REQ-VERIFY-005

#### Scenario: Registry-deferred phase returns intent only
**Given** a phase runs in registry-deferred mode
**When** the phase agent prepares its completion response
**Then** it verifies the phase artifact exists and returns registry intent without writing or claiming registry updates
> Covers: REQ-VERIFY-003, REQ-VERIFY-005

#### Scenario: Orchestrator blocks advancement on missing official records
**Given** a phase agent reports completion but the official artifact or required registry record is missing
**When** the Orchestrator verifies phase completion before advancement
**Then** it does not advance the dependent phase and reports or repairs the persistence issue according to workflow rules
> Covers: REQ-VERIFY-004

### Capability: orchestrator-agent-config-respect

#### Scenario: Registered configuration is used by default
**Given** an agent has registered execution configuration
**When** the Orchestrator launches that agent
**Then** it uses the registered configuration without arbitrary model, context, thinking, tools, or similar overrides
> Covers: REQ-CONFIG-001

#### Scenario: Explicit override is allowed and identified
**Given** the user explicitly requests an execution-configuration override or a documented workflow rule requires one
**When** the Orchestrator launches an agent with the override
**Then** the override is allowed and its basis is identifiable in delegation context or summary
> Covers: REQ-CONFIG-002, REQ-CONFIG-003

#### Scenario: Undocumented override is rejected
**Given** no explicit user request and no documented workflow rule requires an override
**When** an Orchestrator launch would override registered execution configuration
**Then** the override is not used
> Covers: REQ-CONFIG-002

### Capability: sdd-phase-mermaid-summaries

#### Scenario: Orchestrator summary includes Mermaid after each planning phase
**Given** Proposal, Spec, Design, or Task phase has completed
**When** the Orchestrator presents the user-facing phase summary
**Then** the summary includes a concise fenced Mermaid diagram for that phase
> Covers: REQ-MERMAID-001, REQ-MERMAID-004

#### Scenario: Agent provides diagram-ready source data
**Given** a Proposal, Spec, Design, or Task phase agent has phase relationships that can be summarized visually
**When** it writes its artifact or return contract
**Then** it should include Mermaid source or diagram-ready data that the Orchestrator may use for the user-facing summary
> Covers: REQ-MERMAID-002

#### Scenario: Diagram does not replace authoritative text
**Given** a Mermaid diagram appears in a phase summary or artifact
**When** a diagram conflicts with official textual requirements, design, tasks, or registry entries
**Then** the official OpenSpec artifact text and registry entries are authoritative
> Covers: REQ-MERMAID-003

#### Scenario: Mermaid discouragement guidance is reconciled
**Given** existing guidance discourages Mermaid syntax in user-facing copy
**When** applying Proposal, Spec, Design, or Task phase-summary rules
**Then** that discouragement does not prohibit the required phase-specific Mermaid diagram
> Covers: REQ-MERMAID-005

## Validation Rules

| Field / Input | Rule | Error Message | REQ-ID |
|---|---|---|---|
| Apply batch | Must be grouped by coherent owner/context when tasks are related | Apply dispatch must not default to one agent per related task | REQ-APPLY-001, REQ-APPLY-002 |
| Multi-agent Apply fanout | Must satisfy independence, non-overlap, no ordering dependency, low conflict risk, and independent verification | Parallel Apply fanout is not safe for this task group | REQ-APPLY-003 |
| Apply order | Shared/contracts dependencies must precede dependent work | Dependent Apply work cannot start before required shared/contracts work is clear | REQ-APPLY-004 |
| Post-Archive Git action | Suggestions are advisory only and must not mutate Git state | Automatic Git mutation is not allowed by this workflow | REQ-GIT-002 |
| Pre-Proposal triage | Codebase, architecture, agent config, prompt, workflow, OpenSpec, routing, or broad-impact changes require Explorer | Explorer is required before Proposal for this change type | REQ-TRIAGE-001 |
| Phase completion | Required artifact must exist on disk before completion is claimed | Phase artifact verification failed | REQ-VERIFY-001 |
| Registry-deferred phase | Must return registry intent and must not claim registry writes | Registry writes are deferred; return intent only | REQ-VERIFY-003 |
| Agent launch config | Registered execution configuration must be used unless allowed exception exists | Execution override requires explicit user request or documented workflow rule | REQ-CONFIG-001, REQ-CONFIG-002 |
| Phase summary | Proposal, Spec, Design, and Task summaries must include concise Mermaid source | Missing required phase-summary Mermaid diagram | REQ-MERMAID-001 |

## Error Contracts

| Condition | Error Code | Message | Status |
|---|---|---|---|
| Unsafe Apply parallelization criteria are not met | `APPLY_FANOUT_UNSAFE` | Parallel Apply fanout is unsafe; use an ordered batch or resolve dependencies first. | Blocked dispatch until regrouped |
| Phase agent cannot verify required artifact | `ARTIFACT_VERIFICATION_FAILED` | Required phase artifact does not exist or cannot be verified on disk. | Blocked phase completion |
| Phase agent cannot verify required registry in non-deferred mode | `REGISTRY_VERIFICATION_FAILED` | Required registry state or event is missing or unverifiable. | Blocked phase completion |
| Phase agent claims registry write in deferred mode | `REGISTRY_DEFERRED_WRITE_CLAIM` | Registry mode is deferred; phase may only return registry intent. | Blocked or corrected response |
| Orchestrator cannot verify official artifact/registry before phase advancement | `PHASE_ADVANCEMENT_VERIFICATION_FAILED` | Official phase records are missing or inconsistent; do not advance. | Blocked advancement |
| Undocumented execution configuration override attempted | `AGENT_CONFIG_OVERRIDE_NOT_ALLOWED` | Registered agent execution configuration must be respected unless an explicit exception applies. | Blocked launch or launch without override |
| Required Mermaid phase summary missing | `MERMAID_SUMMARY_MISSING` | Phase summary requires a concise Mermaid diagram. | Summary incomplete |

## States and Transitions

| State | Description | Entry Criteria |
|---|---|---|
| Apply Planning | Orchestrator is mapping Task execution groups to Apply assignments | Task artifact is available for Apply dispatch |
| Batched Apply Ready | Related work has been grouped into coherent ordered Apply assignments | Batching criteria and dependency ordering are satisfied |
| Parallel Apply Ready | Independent work has been approved for multi-agent fanout | All multi-agent criteria are satisfied |
| Phase Artifact Written | A phase artifact has been written by a phase agent | Artifact write operation completed |
| Phase Verified | Required artifact and applicable registry records or registry intent have been verified | Self-verification succeeds |
| Phase Advancement Ready | Orchestrator has verified official records needed to advance | Official artifact/registry verification succeeds |
| Archive Completed | Archive phase has completed and completed change/diff context is available | Archive completion is verified |
| Git Suggestions Presented | Advisory commit and optional PR metadata have been shown | Post-Archive suggestions are generated without Git mutation |

| From | To | Trigger | Side Effects |
|---|---|---|---|
| Apply Planning | Batched Apply Ready | Related tasks are grouped by owner/context with required ordering | One Apply agent can receive an ordered task list |
| Apply Planning | Parallel Apply Ready | Work satisfies all safe fanout criteria | Multiple Apply agents may be launched for independent areas |
| Phase Artifact Written | Phase Verified | Phase agent verifies artifact plus registry or registry intent as applicable | Completion evidence can be reported |
| Phase Verified | Phase Advancement Ready | Orchestrator verifies official artifact/registry records | Dependent phase may advance |
| Archive Completed | Git Suggestions Presented | Orchestrator evaluates completed change/diff context | Advisory Git/PR metadata is displayed; Git state is unchanged |

## Open Questions

- Does `packages/sdd-runtime/src/artifact-state/artifact-state-manager.ts` need new verification helper functions, or is Orchestrator text guidance sufficient for persistence hardening? (Design phase should confirm.)
- Is there a runtime launcher (separate from the adapter) that overrides agent model/context/thinking/tools independently of Orchestrator guidance?
- Should the existing Orchestrator "avoid Mermaid" guidance be narrowed to non-SDD conversational summaries, or replaced entirely?
- Should Mermaid diagrams be required in both phase-agent artifacts and Orchestrator summaries, or should agents provide only diagram-ready structure?
- Should post-Archive PR title/body suggestions always be shown, or only when a PR workflow is detected or requested?
- Should artifact self-verification wording be repeated in every phase-agent skill, centralized in shared Developer Team guidance, or both?

## Compliance Matrix

| REQ-ID | Scenario(s) | Status |
|---|---|---|
| REQ-APPLY-001 | Related tasks are batched; Conflict risk prevents fanout | Defined |
| REQ-APPLY-002 | Related tasks are batched | Defined |
| REQ-APPLY-003 | Independent work is safely parallelized; Conflict risk prevents fanout | Defined |
| REQ-APPLY-004 | Related tasks are batched; Shared contract work blocks parallelism | Defined |
| REQ-APPLY-005 | Related tasks are batched; Independent work is parallelized | Defined |
| REQ-GIT-001 | Archive completion produces advisory Git metadata | Defined |
| REQ-GIT-002 | Git suggestions do not mutate repository state | Defined |
| REQ-GIT-003 | Archive completion produces advisory Git metadata | Defined |
| REQ-GIT-004 | Ambiguous conventional commit suggestion | Defined |
| REQ-TRIAGE-001 | Internal workflow change triggers Explorer; Product architecture triggers Explorer | Defined |
| REQ-TRIAGE-002 | Internal workflow change triggers Explorer | Defined |
| REQ-DELEGATION-001 | Specialized delegation outside formal SDD | Defined |
| REQ-DELEGATION-002 | Formal SDD sequence remains authoritative | Defined |
| REQ-VERIFY-001 | Phase agent verifies artifact; Non-deferred registry verification | Defined |
| REQ-VERIFY-002 | Non-deferred registry verification | Defined |
| REQ-VERIFY-003 | Registry-deferred phase returns intent only | Defined |
| REQ-VERIFY-004 | Orchestrator blocks advancement on missing records | Defined |
| REQ-VERIFY-005 | Phase agent verifies artifact; Non-deferred registry verification; Registry-deferred intent | Defined |
| REQ-CONFIG-001 | Registered configuration is used by default | Defined |
| REQ-CONFIG-002 | Explicit override is allowed; Undocumented override is rejected | Defined |
| REQ-CONFIG-003 | Explicit override is allowed and identified | Defined |
| REQ-MERMAID-001 | Orchestrator summary includes Mermaid after planning phases | Defined |
| REQ-MERMAID-002 | Agent provides diagram-ready source data | Defined |
| REQ-MERMAID-003 | Diagram does not replace authoritative text | Defined |
| REQ-MERMAID-004 | Orchestrator summary includes Mermaid after planning phases | Defined |
| REQ-MERMAID-005 | Mermaid discouragement guidance is reconciled | Defined |

## Mermaid Summary Source

```mermaid
flowchart TD
  subgraph SDD_APPLY["sdd-apply-orchestration"]
    A1[REQ-APPLY-001 — No one-task-one-agent default]
    A2[REQ-APPLY-002 — Group by owner/context]
    A3[REQ-APPLY-003 — Multi-agent only when safe]
    A4[REQ-APPLY-004 — Dependency-aware ordering]
    A5[REQ-APPLY-005 — Task groups as primary source]
  end

  subgraph SDD_GIT["sdd-post-archive-git-suggestions"]
    G1[REQ-GIT-001 — Advisory commit suggestions]
    G2[REQ-GIT-002 — No automatic Git mutation]
    G3[REQ-GIT-003 — Optional PR metadata]
    G4[REQ-GIT-004 — Label ambiguous suggestions]
  end

  subgraph SDD_TRIAGE["sdd-explorer-triage"]
    T1[REQ-TRIAGE-001 — Route to Explorer for broad impact]
    T2[REQ-TRIAGE-002 — Internal changes are triage-eligible]
  end

  subgraph SDD_DELEGATION["orchestrator-role-based-delegation"]
    D1[REQ-DELEGATION-001 — Delegate by role outside SDD]
    D2[REQ-DELEGATION-002 — SDD sequence stays authoritative]
  end

  subgraph SDD_VERIFY["sdd-phase-artifact-verification"]
    V1[REQ-VERIFY-001 — Self-verify artifact on disk]
    V2[REQ-VERIFY-002 — Verify registry in non-deferred mode]
    V3[REQ-VERIFY-003 — Return intent in deferred mode]
    V4[REQ-VERIFY-004 — Orchestrator gates advancement]
    V5[REQ-VERIFY-005 — Completion evidence format]
  end

  subgraph SDD_CONFIG["orchestrator-agent-config-respect"]
    C1[REQ-CONFIG-001 — Use registered config by default]
    C2[REQ-CONFIG-002 — No undocumented overrides]
    C3[REQ-CONFIG-003 — Identify override basis]
  end

  subgraph SDD_MERMAID["sdd-phase-mermaid-summaries"]
    M1[REQ-MERMAID-001 — Mermaid in phase summaries]
    M2[REQ-MERMAID-002 — Agents provide source/data]
    M3[REQ-MERMAID-003 — Diagrams are non-authoritative]
    M4[REQ-MERMAID-004 — Runner-agnostic fenced source]
    M5[REQ-MERMAID-005 — Reconcile conflicting guidance]
  end

  SDD_APPLY --> Scen1["Scenario: Batched Apply"]
  SDD_APPLY --> Scen2["Scenario: Safe parallelization"]
  SDD_GIT --> Scen3["Scenario: Advisory Git metadata"]
  SDD_GIT --> Scen4["Scenario: No Git mutation"]
  SDD_TRIAGE --> Scen5["Scenario: Explorer triage"]
  SDD_DELEGATION --> Scen6["Scenario: Role delegation"]
  SDD_VERIFY --> Scen7["Scenario: Artifact verification"]
  SDD_CONFIG --> Scen8["Scenario: Config respect"]
  SDD_MERMAID --> Scen9["Scenario: Mermaid summaries"]

  style SDD_APPLY fill:#e8f4e8
  style SDD_GIT fill:#e8e8f4
  style SDD_TRIAGE fill:#f4e8e8
  style SDD_DELEGATION fill:#f4f4e8
  style SDD_VERIFY fill:#e8f0f4
  style SDD_CONFIG fill:#f4e8f4
  style SDD_MERMAID fill:#e8f4f4
```

Diagram note: This Mermaid source is explanatory and non-authoritative. The requirements, scenarios, and OpenSpec registry are authoritative.