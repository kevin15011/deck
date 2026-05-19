# Spec: Add Supermemory MCP Memory Provider

## Source

- Proposal: `add-supermemory-mcp-memory-provider` proposal artifact
- Context: `docs/prd-supermemory-mcp-adaptive-memory.md` for supporting detail only
- Capabilities affected: `supermemory-provider-selection`, `supermemory-install-token-configuration`, `supermemory-pi-runtime-integration`, `supermemory-adaptive-context`, `adaptive-memory-governance`, `adaptive-memory-provider`, `installer-memory-provider-configuration`, `sdd-phase-context-assembly`, `openspec-artifact-authority`, `sdd-phase-workflow`, `engram-provider`

## Requirements

### Capability: supermemory-provider-selection

REQ-SPS-001: Installation/configuration MUST offer Supermemory MCP as an adaptive-memory provider option alongside existing supported options.
  Priority: MUST
  Surface: UI
  Rationale: Teams must be able to select Supermemory during setup.

REQ-SPS-002: Installation/configuration MUST allow no more than one active adaptive-memory provider to be selected for the runner.
  Priority: MUST
  Surface: Validation
  Rationale: The proposal explicitly forbids multiple active providers in one runner session.

REQ-SPS-003: The selected adaptive-memory provider MUST be persisted in non-secret Deck configuration so subsequent runner sessions use the same active provider until changed.
  Priority: MUST
  Surface: Data
  Rationale: Provider selection must survive installation/configuration while excluding credentials.

REQ-SPS-004: The configuration experience SHOULD confirm which adaptive-memory provider is active after setup or reconfiguration.
  Priority: SHOULD
  Surface: UI
  Rationale: Users need observable confirmation that the intended provider is active.

### Capability: supermemory-install-token-configuration

REQ-SIT-001: When the user selects Supermemory MCP during installation, the installer MUST ask the user for the Supermemory token before completing Supermemory configuration.
  Priority: MUST
  Surface: UI
  Rationale: Supermemory requires a token and the proposal clarifies token collection happens during installation.

REQ-SIT-002: The Supermemory token or credential MUST NOT be stored in `.deck/config.json`.
  Priority: MUST
  Surface: Security
  Rationale: `.deck/config.json` is reserved for non-secret configuration.

REQ-SIT-003: Non-secret Supermemory/provider settings MAY be stored in `.deck/config.json`, including active provider and non-secret identity/scope values.
  Priority: MAY
  Surface: Data
  Rationale: The proposal allows non-secret provider settings in Deck config.

REQ-SIT-004: Supermemory configuration MUST require an explicit `userId`.
  Priority: MUST
  Surface: Validation
  Rationale: The proposal clarifies `userId` is required for Supermemory.

REQ-SIT-005: Supermemory configuration MUST support optional `teamId` and `orgId` without requiring either value for personal/project memory operation.
  Priority: MUST
  Surface: Validation
  Rationale: The proposal clarifies team and org identity values are optional.

REQ-SIT-006: If required Supermemory installation inputs are missing, invalid, or cannot be validated, setup MUST not mark Supermemory as available and MUST present an actionable configuration error.
  Priority: MUST
  Surface: Error
  Rationale: Users must be able to distinguish configured, unavailable, and incomplete provider states.

### Capability: supermemory-pi-runtime-integration

REQ-SPI-001: The first supported runtime integration for Supermemory MCP MUST be the Pi runtime/integration path.
  Priority: MUST
  Surface: Integration
  Rationale: The proposal clarifies Pi is the first implementation target.

REQ-SPI-002: When Supermemory MCP is configured as the active provider for the Pi runtime and is available, Pi runtime sessions MUST be able to request advisory adaptive context through the provider-neutral memory behavior.
  Priority: MUST
  Surface: Integration
  Rationale: Supermemory must be usable in the initial target runtime.

REQ-SPI-003: Non-Pi runtime integrations MUST NOT be treated as required acceptance scope for this change unless separately approved.
  Priority: MUST
  Surface: General
  Rationale: The proposal explicitly defers non-Pi runtime integrations from the first target.

### Capability: adaptive-memory-provider

REQ-AMP-001: The runner MUST load exactly the configured active adaptive-memory provider, or no provider when memory is disabled.
  Priority: MUST
  Surface: Integration
  Rationale: Active-provider enforcement must be observable at runtime.

REQ-AMP-002: Engram, Supermemory, and future providers MUST expose equivalent provider-neutral memory behavior to the runner: load adaptive context, search memories, commit selected memories, summarize a session, configure the provider, and report health.
  Priority: MUST
  Surface: Integration
  Rationale: SDD phase behavior must not depend on provider-specific behavior.

REQ-AMP-003: Provider-specific failures MUST NOT block OpenSpec-driven workflow execution.
  Priority: MUST
  Surface: Reliability
  Rationale: OpenSpec remains authoritative and the workflow must continue without advisory memory.

REQ-AMP-004: When the active provider is unavailable, the runner SHOULD make the absence of adaptive memory visible in the phase context or user-visible status.
  Priority: SHOULD
  Surface: UI
  Rationale: Users and agents should know when advisory context is missing.

REQ-AMP-005: The system MUST support switching the active provider back to another supported provider or `none` without changing OpenSpec artifacts.
  Priority: MUST
  Surface: Data
  Rationale: Rollback requires provider reconfiguration while preserving official artifacts.

REQ-AMP-006: The system MUST validate actual Supermemory MCP tool names, parameters, authentication behavior, and health/connectivity behavior before treating Supermemory MCP as available for runtime use.
  Priority: MUST
  Surface: Integration
  Rationale: The proposal identifies real Supermemory MCP validation as an early gating blocker before relying on mocked assumptions.

### Capability: supermemory-adaptive-context

REQ-SAC-001: When Supermemory MCP is active and available, SDD phases MUST be able to receive advisory context from Supermemory through the provider-neutral memory behavior.
  Priority: MUST
  Surface: Integration
  Rationale: Supermemory must be usable for SDD phase context.

REQ-SAC-002: Supermemory advisory context MUST include only memory relevant to the active phase and scoped user/project/team/org context available to the system.
  Priority: MUST
  Surface: Data
  Rationale: Scoping prevents cross-context leakage and irrelevant memory drift.

REQ-SAC-003: Supermemory advisory context SHOULD combine broad profile/context recall with targeted memory search when both are available and validated.
  Priority: SHOULD
  Surface: Integration
  Rationale: The PRD describes profiles for broad context and search for specific details, while the proposal requires validating actual MCP behavior.

REQ-SAC-004: Supermemory failure, missing credentials, failed validation, or failed health checks MUST result in safe fallback that continues the phase without Supermemory-derived adaptive context.
  Priority: MUST
  Surface: Reliability
  Rationale: Memory must be advisory and non-blocking.

### Capability: sdd-phase-context-assembly

REQ-SPCA-001: SDD phase prompts MUST clearly separate official OpenSpec context from adaptive-memory context using explicit sections or labels equivalent to `OFFICIAL CONTEXT` and `ADAPTIVE CONTEXT`.
  Priority: MUST
  Surface: UI
  Rationale: Agents and users must distinguish authoritative context from advisory memory.

REQ-SPCA-002: SDD phase prompts that include adaptive memory MUST state the authority rule: OpenSpec is authoritative, adaptive memory is advisory, and specs must not be modified based only on memory.
  Priority: MUST
  Surface: UI
  Rationale: This mitigates memory drift and preserves OpenSpec authority.

REQ-SPCA-003: Official OpenSpec context MUST be present and ranked above adaptive memory when both are available.
  Priority: MUST
  Surface: Data
  Rationale: The change preserves OpenSpec as the source of truth.

REQ-SPCA-004: When no adaptive memory is available, SDD phase prompts SHOULD continue with official context and indicate that adaptive context was not loaded.
  Priority: SHOULD
  Surface: UI
  Rationale: Empty-state behavior should be explicit and non-blocking.

### Capability: adaptive-memory-governance

REQ-AMG-001: Saved adaptive memories MUST use separated scopes for personal, project, team, and org memory.
  Priority: MUST
  Surface: Data
  Rationale: Scope separation prevents mixing preferences, project heuristics, and team conventions.

REQ-AMG-002: Supermemory container tags MUST be short, scoped identifiers and MUST NOT use one global container for all memory.
  Priority: MUST
  Surface: Data
  Rationale: The proposal requires scoped container-tag policies.

REQ-AMG-003: Container tags MUST be at most 100 characters and SHOULD use only letters, numbers, `_`, `:`, and `-`.
  Priority: MUST
  Surface: Validation
  Rationale: The PRD defines tag limits and expected characters.

REQ-AMG-004: Every saved memory MUST include metadata for source, scope, type, confidence, creator, and applicable project/change/phase/artifact/promotion fields when known.
  Priority: MUST
  Surface: Data
  Rationale: Metadata enables filtering, promotion status, confidence, and auditability.

REQ-AMG-005: Saved memory candidates MUST be limited to high-signal learnings such as explicit user corrections, repeated rejections, preferences, project heuristics, candidate conventions, and retrospectives.
  Priority: MUST
  Surface: Data
  Rationale: The change aims to reduce noise and preserve useful learning.

REQ-AMG-006: A session memory commit MUST save no more than 7 learnings and SHOULD save at least 3 only when at least 3 high-signal learnings exist.
  Priority: MUST
  Surface: Validation
  Rationale: The proposal and PRD specify a 3-7 high-signal learning limit.

REQ-AMG-007: The system MUST NOT save active specs, active tasks, raw chats, secrets, credentials, sensitive code, unapproved product requirements, experimental deltas, or Engram migration payloads as adaptive memory in this change.
  Priority: MUST
  Surface: Security
  Rationale: Adaptive memory must not duplicate official artifacts, leak sensitive data, or perform out-of-scope migration.

REQ-AMG-008: Team-scoped memories MUST be marked as candidate unless explicit human approval or an approved future promotion condition is present.
  Priority: MUST
  Surface: Data
  Rationale: Team conventions must not be promoted from inference alone, and a full review/promote UI is out of scope.

REQ-AMG-009: Memory search and retrieval MUST apply available scope/container and metadata filters before advisory context is used.
  Priority: MUST
  Surface: Data
  Rationale: Filtering is required to prevent cross-scope leakage and irrelevant recall.

REQ-AMG-010: Automatically saved memories SHOULD have observable audit information sufficient to identify what was saved, its scope, source, and why it was accepted or discarded, without exposing sensitive content.
  Priority: SHOULD
  Surface: Security
  Rationale: The proposal raises audit expectations for automatic commits.

### Capability: openspec-artifact-authority

REQ-OAA-001: OpenSpec MUST remain the official store for requirements, designs, tasks, and approved change history.
  Priority: MUST
  Surface: Data
  Rationale: The central rule is that OpenSpec is authoritative and memory is advisory.

REQ-OAA-002: Adaptive memory MUST NOT modify OpenSpec artifacts without explicit user action through the normal SDD/OpenSpec workflow.
  Priority: MUST
  Surface: Permission
  Rationale: Memory cannot independently change official artifacts.

REQ-OAA-003: Derived OpenSpec learnings MAY be saved as adaptive memory only when they are summaries, retrospectives, or heuristics from completed/approved work and satisfy governance rules.
  Priority: MAY
  Surface: Data
  Rationale: The proposal allows safe high-signal learning while avoiding duplicate active specs/tasks.

REQ-OAA-004: This change MUST NOT migrate existing Engram memories into Supermemory.
  Priority: MUST
  Surface: Data
  Rationale: The proposal clarifies Engram migration is out of scope.

### Capability: sdd-phase-workflow

REQ-SW-001: The Proposal → Spec/Design → Tasks → Apply → Verify/Review workflow MUST remain unchanged except for advisory memory context injection.
  Priority: MUST
  Surface: General
  Rationale: The proposal marks the SDD phase workflow as unchanged.

REQ-SW-002: SDD phases MUST remain functional when adaptive memory is disabled or unavailable.
  Priority: MUST
  Surface: Reliability
  Rationale: The workflow is OpenSpec-driven, not memory-dependent.

## Acceptance Scenarios

### Capability: supermemory-provider-selection

#### Scenario: Select Supermemory during installation
**Given** the installation experience lists adaptive-memory provider options
**When** the user selects Supermemory MCP and completes required Supermemory configuration inputs
**Then** Supermemory MCP is persisted as the single active provider and the user can observe that Supermemory is active
> Covers: REQ-SPS-001, REQ-SPS-002, REQ-SPS-003, REQ-SPS-004

#### Scenario: Reject multiple active providers
**Given** adaptive-memory configuration is being saved
**When** the selection would make more than one provider active
**Then** the save is rejected with an error explaining that exactly one provider may be active
> Covers: REQ-SPS-002

#### Scenario: Disable adaptive memory
**Given** an adaptive-memory provider is currently active
**When** the user configures the provider as `none`
**Then** no adaptive-memory provider is active for subsequent runner sessions and OpenSpec artifacts remain unchanged
> Covers: REQ-SPS-002, REQ-SPS-003, REQ-AMP-005

### Capability: supermemory-install-token-configuration

#### Scenario: Prompt for token when Supermemory is selected
**Given** the user is installing or configuring Deck and chooses Supermemory MCP as the adaptive-memory provider
**When** the installer proceeds to provider configuration
**Then** the installer asks the user for the Supermemory token before completing Supermemory setup
> Covers: REQ-SIT-001

#### Scenario: Do not persist token in Deck config
**Given** the user supplied a Supermemory token during installation
**When** Supermemory provider configuration is persisted
**Then** `.deck/config.json` contains only non-secret provider settings and does not contain the Supermemory token or credential value
> Covers: REQ-SIT-002, REQ-SIT-003

#### Scenario: Require explicit userId
**Given** the user selected Supermemory MCP during installation
**When** the user attempts to complete setup without an explicit `userId`
**Then** setup is rejected with an error that `userId` is required for Supermemory configuration
> Covers: REQ-SIT-004, REQ-SIT-006

#### Scenario: Optional teamId and orgId omitted
**Given** the user selected Supermemory MCP and provided a token and explicit `userId`
**When** `teamId` and `orgId` are omitted
**Then** setup can complete for personal/project-scoped operation and no team/org scope is queried or saved by default
> Covers: REQ-SIT-005, REQ-SAC-002, REQ-AMG-009

#### Scenario: Invalid Supermemory credential blocks provider availability only
**Given** the user selected Supermemory MCP during installation
**When** the provided token cannot be validated or used to connect
**Then** Supermemory is not marked available, an actionable configuration error is shown, and the OpenSpec workflow remains usable without Supermemory context
> Covers: REQ-SIT-006, REQ-AMP-003, REQ-SAC-004, REQ-SW-002

### Capability: supermemory-pi-runtime-integration

#### Scenario: Pi runtime uses Supermemory as active provider
**Given** Supermemory MCP is configured as the active provider and has passed required validation
**When** a Pi runtime session starts and requests adaptive memory
**Then** the Pi runtime uses Supermemory through provider-neutral behavior and does not load another active memory provider
> Covers: REQ-SPI-001, REQ-SPI-002, REQ-AMP-001, REQ-AMP-002

#### Scenario: Non-Pi runtime is not required for acceptance
**Given** Supermemory MCP is available for the Pi runtime
**When** acceptance for this change is evaluated
**Then** lack of non-Pi runtime integration does not fail this change unless a separate approved scope expands the target
> Covers: REQ-SPI-003

### Capability: adaptive-memory-provider

#### Scenario: Runner loads only the configured provider
**Given** exactly one adaptive-memory provider is configured as active
**When** a runner session starts
**Then** the runner loads only that provider and does not use any other provider for adaptive-memory operations
> Covers: REQ-AMP-001, REQ-AMP-002

#### Scenario: Supermemory MCP behavior validation gates availability
**Given** Supermemory MCP is selected as the active provider
**When** actual tool names, parameters, authentication behavior, or health/connectivity behavior have not been validated
**Then** Supermemory is not treated as available for runtime advisory context and the user-visible status identifies validation as incomplete or failed
> Covers: REQ-AMP-006, REQ-SAC-004

#### Scenario: Provider health failure is non-blocking
**Given** Supermemory MCP is configured as the active provider
**When** its health check or connection fails before a phase starts
**Then** the phase continues using OpenSpec context and reports or marks that adaptive memory was unavailable
> Covers: REQ-AMP-003, REQ-AMP-004, REQ-SAC-004, REQ-SW-002

#### Scenario: Provider can be switched for rollback
**Given** Supermemory MCP is configured as the active provider
**When** the user switches the active provider to Engram or `none`
**Then** later runner sessions use the newly selected provider state and existing OpenSpec artifacts are not changed
> Covers: REQ-AMP-005, REQ-OAA-001

### Capability: supermemory-adaptive-context

#### Scenario: Load phase-relevant advisory context
**Given** Supermemory MCP is active and available, and scoped identity values for the current session are available
**When** an SDD phase requests adaptive context
**Then** the returned adaptive context is advisory, scoped to the available user/project/team/org context, and relevant to the active phase
> Covers: REQ-SAC-001, REQ-SAC-002, REQ-AMG-009

#### Scenario: Combine profile and targeted recall when available
**Given** Supermemory supports validated broad context/profile retrieval and targeted memory search
**When** adaptive context is assembled for an SDD phase
**Then** the adaptive context can include both broad profile/context information and targeted memories, clearly as advisory content
> Covers: REQ-SAC-003, REQ-SAC-001

#### Scenario: Missing optional identity values limit scope
**Given** Supermemory MCP is active and available with `userId` but without `teamId` or `orgId`
**When** adaptive context is requested
**Then** retrieval uses only available valid scopes and does not query missing or unknown team/org scopes
> Covers: REQ-SIT-005, REQ-SAC-002, REQ-AMG-001, REQ-AMG-009

### Capability: sdd-phase-context-assembly

#### Scenario: Prompt separates official and adaptive context
**Given** official OpenSpec context and adaptive memory are both available for a phase
**When** the phase prompt is assembled
**Then** the prompt contains separately labeled official and adaptive context and states that OpenSpec is authoritative while memory is advisory
> Covers: REQ-SPCA-001, REQ-SPCA-002, REQ-SPCA-003

#### Scenario: Prompt without adaptive memory
**Given** official OpenSpec context is available and no adaptive memory is available
**When** the phase prompt is assembled
**Then** the prompt includes official context, omits or empties adaptive context safely, and indicates that adaptive context was not loaded
> Covers: REQ-SPCA-003, REQ-SPCA-004, REQ-SW-002

#### Scenario: Adaptive memory conflicts with OpenSpec
**Given** adaptive memory suggests behavior that conflicts with active OpenSpec artifacts
**When** a phase consumes the assembled context
**Then** the official OpenSpec context takes precedence and the memory does not justify modifying OpenSpec without explicit user action
> Covers: REQ-SPCA-002, REQ-SPCA-003, REQ-OAA-001, REQ-OAA-002

### Capability: adaptive-memory-governance

#### Scenario: Save high-signal session learnings
**Given** a session ends with high-signal user corrections, preferences, or project heuristics
**When** memory commit runs
**Then** at most 7 learnings are saved, each with valid scope/container separation and required metadata
> Covers: REQ-AMG-001, REQ-AMG-002, REQ-AMG-004, REQ-AMG-005, REQ-AMG-006

#### Scenario: Do not save low-signal or forbidden content
**Given** a session includes raw chat, secrets, credentials, sensitive code, active tasks, active specs, unapproved requirements, experimental deltas, or migration payloads
**When** memory commit evaluates candidates
**Then** those items are not saved as adaptive memory and official OpenSpec artifacts remain the source of truth
> Covers: REQ-AMG-005, REQ-AMG-007, REQ-OAA-001, REQ-OAA-004

#### Scenario: Team convention remains candidate
**Given** a memory candidate is scoped to a team and lacks explicit human approval
**When** the memory is saved
**Then** it is saved with candidate promotion status rather than as an accepted team rule, without requiring a full review/promote UI in this change
> Covers: REQ-AMG-008

#### Scenario: Invalid container tag is rejected
**Given** a memory candidate has a container tag longer than 100 characters or containing unsupported characters
**When** the memory is validated for saving or querying
**Then** the operation is rejected or the candidate is excluded with a validation error
> Covers: REQ-AMG-003

#### Scenario: Metadata filters constrain recall
**Given** memories exist across personal, project, team, and org scopes
**When** adaptive context is retrieved for a specific project and phase
**Then** only memories matching allowed scopes, container tags, and applicable metadata filters are eligible for the adaptive context
> Covers: REQ-AMG-001, REQ-AMG-009

#### Scenario: Audit automatic commit decision
**Given** automatic memory commit accepts or discards candidate memories
**When** commit completes
**Then** observable audit information identifies saved/discarded counts, scopes, sources, and decision reasons without exposing sensitive content
> Covers: REQ-AMG-010

### Capability: openspec-artifact-authority

#### Scenario: Memory cannot modify OpenSpec alone
**Given** adaptive memory suggests adding or changing a requirement
**When** no explicit user action requests an OpenSpec change
**Then** no OpenSpec artifact is modified based only on adaptive memory
> Covers: REQ-OAA-001, REQ-OAA-002

#### Scenario: Save derived learning from completed work
**Given** a completed or approved change produced a retrospective project heuristic that is not an active spec or task
**When** the heuristic satisfies memory governance rules
**Then** the heuristic may be saved as adaptive memory with appropriate metadata and scope
> Covers: REQ-OAA-003, REQ-AMG-004, REQ-AMG-007

#### Scenario: No Engram migration occurs
**Given** Engram memories exist before Supermemory is selected
**When** this change is installed or configured
**Then** existing Engram memories are not migrated into Supermemory as part of this change
> Covers: REQ-OAA-004

### Capability: sdd-phase-workflow

#### Scenario: Workflow sequence remains unchanged
**Given** a change follows the SDD workflow
**When** adaptive memory is enabled
**Then** the workflow phases and required OpenSpec artifacts remain the same, with only advisory adaptive context added to phase prompts
> Covers: REQ-SW-001, REQ-SW-002

## Validation Rules

| Field / Input | Rule | Error Message | REQ-ID |
|---|---|---|---|
| active provider selection | Must resolve to exactly one supported provider or `none` | Exactly one adaptive-memory provider may be active. | REQ-SPS-002, REQ-AMP-001 |
| provider option | Must include Supermemory MCP as a selectable option | Supermemory MCP must be available as an adaptive-memory provider option. | REQ-SPS-001 |
| Supermemory token | Required when Supermemory is selected during installation; must not be persisted in `.deck/config.json` | Supermemory token is required and must be stored outside Deck config. | REQ-SIT-001, REQ-SIT-002 |
| `.deck/config.json` | Must contain only non-secret provider settings; must not contain Supermemory token/credential values | Deck config may not contain Supermemory credentials. | REQ-SIT-002, REQ-SIT-003 |
| Supermemory `userId` | Must be explicit and non-empty | Supermemory configuration requires an explicit userId. | REQ-SIT-004 |
| Supermemory `teamId` | Optional; if absent, team-scoped operations must not be attempted | teamId is optional; team scope is unavailable when omitted. | REQ-SIT-005, REQ-SAC-002 |
| Supermemory `orgId` | Optional; if absent, org-scoped operations must not be attempted | orgId is optional; org scope is unavailable when omitted. | REQ-SIT-005, REQ-SAC-002 |
| Supermemory MCP validation | Actual tool names, parameters, authentication, and health/connectivity behavior must be validated before runtime availability | Supermemory MCP validation is incomplete or failed. | REQ-AMP-006 |
| runtime target | Pi runtime/integration is the required first target; non-Pi runtimes are not required in this change | Supermemory runtime support is required for Pi first. | REQ-SPI-001, REQ-SPI-003 |
| user/project/team/org identity | Use only available valid identity values for scoped memory operations | Scoped identity is missing or invalid for the requested memory scope. | REQ-SAC-002, REQ-AMG-001 |
| containerTag | Maximum 100 characters | Container tag must be 100 characters or fewer. | REQ-AMG-003 |
| containerTag | Should contain only letters, numbers, `_`, `:`, and `-` | Container tag contains unsupported characters. | REQ-AMG-003 |
| memory metadata.source | Must be one of the supported source classifications | Memory source metadata is required and must be supported. | REQ-AMG-004 |
| memory metadata.scope | Must be personal, project, team, or org | Memory scope metadata is required and must be supported. | REQ-AMG-004 |
| memory metadata.type | Must classify the memory as a supported preference/correction/pattern/heuristic/convention/workflow/anti-pattern type | Memory type metadata is required and must be supported. | REQ-AMG-004 |
| memory metadata.confidence | Must be present and numeric | Memory confidence metadata is required. | REQ-AMG-004 |
| memory metadata.createdBy | Must identify user, agent, or system | Memory creator metadata is required. | REQ-AMG-004 |
| team-scoped memory promotionStatus | Must be candidate unless approved promotion criteria are present | Team memory requires candidate status unless explicitly approved. | REQ-AMG-008 |
| session commit count | Must not save more than 7 memories per session | Session memory commit may save at most 7 learnings. | REQ-AMG-006 |
| forbidden memory content | Must reject active specs, active tasks, raw chats, secrets, credentials, sensitive code, unapproved requirements, experimental deltas, and Engram migration payloads | This content is not allowed in adaptive memory. | REQ-AMG-007, REQ-OAA-004 |

## Error Contracts

| Condition | Error Code | Message | Status |
|---|---|---|---|
| Multiple active providers requested | `ADAPTIVE_MEMORY_MULTIPLE_PROVIDERS` | Exactly one adaptive-memory provider may be active. | N/A |
| Unsupported provider selected | `ADAPTIVE_MEMORY_UNSUPPORTED_PROVIDER` | The selected adaptive-memory provider is not supported. | N/A |
| Supermemory token missing | `SUPERMEMORY_TOKEN_REQUIRED` | Supermemory token is required to configure Supermemory MCP. | N/A |
| Supermemory credential found in Deck config | `SUPERMEMORY_CREDENTIAL_IN_DECK_CONFIG` | Deck config may not store Supermemory credentials. | N/A |
| Supermemory userId missing | `SUPERMEMORY_USER_ID_REQUIRED` | Supermemory configuration requires an explicit userId. | N/A |
| Supermemory configuration incomplete | `SUPERMEMORY_CONFIG_INCOMPLETE` | Supermemory configuration is incomplete or missing required inputs. | N/A |
| Supermemory MCP validation incomplete or failed | `SUPERMEMORY_MCP_VALIDATION_REQUIRED` | Supermemory MCP behavior must be validated before runtime use. | N/A |
| Supermemory unavailable or health check failed | `SUPERMEMORY_UNAVAILABLE` | Adaptive memory is unavailable; continuing with OpenSpec context only. | N/A |
| Invalid container tag | `ADAPTIVE_MEMORY_INVALID_CONTAINER_TAG` | Container tag is invalid for adaptive-memory scope. | N/A |
| Missing required memory metadata | `ADAPTIVE_MEMORY_METADATA_REQUIRED` | Required memory metadata is missing or invalid. | N/A |
| Forbidden content in memory candidate | `ADAPTIVE_MEMORY_FORBIDDEN_CONTENT` | This content is not allowed in adaptive memory. | N/A |
| Engram migration requested in this change | `ENGRAM_MIGRATION_OUT_OF_SCOPE` | Engram memory migration is not part of this change. | N/A |
| Attempt to modify OpenSpec from memory alone | `ADAPTIVE_MEMORY_NOT_AUTHORITATIVE` | Adaptive memory is advisory and cannot modify OpenSpec without explicit user action. | N/A |

## States and Transitions

| State | Description | Entry Criteria |
|---|---|---|
| Memory disabled | No adaptive-memory provider is active | Provider configured as `none` or no active provider is set |
| Provider configured | Exactly one provider is selected and non-secret configuration is persisted | Valid provider selection is saved |
| Supermemory credential pending | Supermemory is selected but required token/credential has not been supplied or validated | Supermemory selected without a usable credential |
| Supermemory validation pending | Supermemory is selected but actual MCP tool/parameter/auth/health behavior has not passed validation | Required MCP validation has not completed |
| Provider available | Active provider can be used for context/search/commit | Required inputs exist and health/connection/MCP validation succeeds |
| Provider unavailable | Active provider cannot be used safely | Credentials missing, MCP validation fails, health check fails, or service unavailable |
| Memory candidate | Potential memory identified but not yet saved or promoted | Session signal or retrospective produces a candidate |
| Memory saved | Candidate is saved with required scope and metadata | Candidate passes governance validation |
| Team candidate | Team-scoped memory saved as candidate | Team memory lacks explicit approval |
| Memory rejected | Candidate is not saved or is marked rejected | Candidate fails governance, relevance, scope, or safety rules |

| From | To | Trigger | Side Effects |
|---|---|---|---|
| Memory disabled | Provider configured | User selects a supported provider | Non-secret active provider selection is persisted |
| Provider configured | Supermemory credential pending | Supermemory selected without usable token/credential | Setup requests credential; provider is not available |
| Supermemory credential pending | Supermemory validation pending | Required credential and `userId` are supplied | MCP validation can be attempted |
| Supermemory validation pending | Provider available | Actual MCP tool/parameter/auth/health validation succeeds | Provider may supply advisory context |
| Supermemory validation pending | Provider unavailable | Actual MCP validation fails | Workflow continues with OpenSpec context only |
| Provider configured | Provider available | Health/connection validation succeeds for the selected provider | Provider may supply advisory context |
| Provider configured | Provider unavailable | Required inputs missing or health/connection validation fails | Workflow continues with OpenSpec context only |
| Provider available | Provider unavailable | Runtime provider failure | Adaptive context is omitted or marked unavailable |
| Provider configured | Memory disabled | User selects `none` | Future sessions do not use adaptive memory |
| Memory candidate | Memory saved | Candidate passes governance and scope validation | Memory is available for future scoped recall |
| Memory candidate | Team candidate | Candidate is team-scoped without explicit approval | Saved or tracked as candidate, not accepted rule |
| Memory candidate | Memory rejected | Candidate is low-signal, forbidden, unsafe, or invalid | Candidate is not used as saved adaptive memory |

## Open Questions

- What exact secret-storage mechanism should hold the Supermemory token outside `.deck/config.json`?
- How is `projectId` derived in this repository?
- Should Supermemory container prompts be configured automatically or documented for manual setup?
- What is the exact fallback mode beyond non-blocking continuation when Supermemory credentials are missing, invalid, validation fails, or the service is unavailable?
- What audit logging detail is expected for automatically committed memories?
- What are the verified Supermemory MCP tool names, parameters, authentication requirements, and health/connectivity behavior? This is an implementation validation blocker before runtime reliance.

## Compliance Matrix

| REQ-ID | Scenario(s) | Status |
|---|---|---|
| REQ-SPS-001 | Select Supermemory during installation | Defined |
| REQ-SPS-002 | Select Supermemory during installation; Reject multiple active providers; Disable adaptive memory | Defined |
| REQ-SPS-003 | Select Supermemory during installation; Disable adaptive memory | Defined |
| REQ-SPS-004 | Select Supermemory during installation | Defined |
| REQ-SIT-001 | Prompt for token when Supermemory is selected | Defined |
| REQ-SIT-002 | Do not persist token in Deck config | Defined |
| REQ-SIT-003 | Do not persist token in Deck config | Defined |
| REQ-SIT-004 | Require explicit userId | Defined |
| REQ-SIT-005 | Optional teamId and orgId omitted; Missing optional identity values limit scope | Defined |
| REQ-SIT-006 | Require explicit userId; Invalid Supermemory credential blocks provider availability only | Defined |
| REQ-SPI-001 | Pi runtime uses Supermemory as active provider | Defined |
| REQ-SPI-002 | Pi runtime uses Supermemory as active provider | Defined |
| REQ-SPI-003 | Non-Pi runtime is not required for acceptance | Defined |
| REQ-AMP-001 | Pi runtime uses Supermemory as active provider; Runner loads only the configured provider | Defined |
| REQ-AMP-002 | Pi runtime uses Supermemory as active provider; Runner loads only the configured provider | Defined |
| REQ-AMP-003 | Invalid Supermemory credential blocks provider availability only; Provider health failure is non-blocking | Defined |
| REQ-AMP-004 | Provider health failure is non-blocking | Defined |
| REQ-AMP-005 | Disable adaptive memory; Provider can be switched for rollback | Defined |
| REQ-AMP-006 | Supermemory MCP behavior validation gates availability | Defined |
| REQ-SAC-001 | Load phase-relevant advisory context; Combine profile and targeted recall when available | Defined |
| REQ-SAC-002 | Optional teamId and orgId omitted; Load phase-relevant advisory context; Missing optional identity values limit scope | Defined |
| REQ-SAC-003 | Combine profile and targeted recall when available | Defined |
| REQ-SAC-004 | Invalid Supermemory credential blocks provider availability only; Supermemory MCP behavior validation gates availability; Provider health failure is non-blocking | Defined |
| REQ-SPCA-001 | Prompt separates official and adaptive context | Defined |
| REQ-SPCA-002 | Prompt separates official and adaptive context; Adaptive memory conflicts with OpenSpec | Defined |
| REQ-SPCA-003 | Prompt separates official and adaptive context; Prompt without adaptive memory; Adaptive memory conflicts with OpenSpec | Defined |
| REQ-SPCA-004 | Prompt without adaptive memory | Defined |
| REQ-AMG-001 | Missing optional identity values limit scope; Save high-signal session learnings; Metadata filters constrain recall | Defined |
| REQ-AMG-002 | Save high-signal session learnings | Defined |
| REQ-AMG-003 | Invalid container tag is rejected | Defined |
| REQ-AMG-004 | Save high-signal session learnings; Save derived learning from completed work | Defined |
| REQ-AMG-005 | Save high-signal session learnings; Do not save low-signal or forbidden content | Defined |
| REQ-AMG-006 | Save high-signal session learnings | Defined |
| REQ-AMG-007 | Do not save low-signal or forbidden content; Save derived learning from completed work | Defined |
| REQ-AMG-008 | Team convention remains candidate | Defined |
| REQ-AMG-009 | Optional teamId and orgId omitted; Load phase-relevant advisory context; Missing optional identity values limit scope; Metadata filters constrain recall | Defined |
| REQ-AMG-010 | Audit automatic commit decision | Defined |
| REQ-OAA-001 | Provider can be switched for rollback; Adaptive memory conflicts with OpenSpec; Do not save low-signal or forbidden content; Memory cannot modify OpenSpec alone | Defined |
| REQ-OAA-002 | Adaptive memory conflicts with OpenSpec; Memory cannot modify OpenSpec alone | Defined |
| REQ-OAA-003 | Save derived learning from completed work | Defined |
| REQ-OAA-004 | Do not save low-signal or forbidden content; No Engram migration occurs | Defined |
| REQ-SW-001 | Workflow sequence remains unchanged | Defined |
| REQ-SW-002 | Invalid Supermemory credential blocks provider availability only; Provider health failure is non-blocking; Prompt without adaptive memory; Workflow sequence remains unchanged | Defined |
