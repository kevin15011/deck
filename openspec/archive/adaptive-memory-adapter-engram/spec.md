# Spec: Adaptive Memory Adapter with Engram Injection

## Source

- Proposal: adaptive-memory-adapter-engram proposal artifact
- Capabilities affected: adaptive-memory-injection, engram-memory-adapter, developer-team-content, developer-team-runtime-materialization, openspec-artifacts, spec-registry-events

## Requirements

### Capability: adaptive-memory-injection

REQ-AMI-001: When no memory provider is selected, the Developer Team experience MUST include no adaptive-memory instructions or memory tool bindings and MUST remain usable.
  Priority: MUST
  Surface: General
  Rationale: Memory is optional and auxiliary.

REQ-AMI-002: When a supported memory provider is explicitly selected, the system MUST include only that provider’s injectable instruction fragments and runtime binding metadata.
  Priority: MUST
  Surface: General
  Rationale: Keeps memory provider-neutral and conditional.

REQ-AMI-003: Unknown or unavailable memory providers MUST produce an observable diagnostic and MUST NOT silently inject provider content.
  Priority: MUST
  Surface: Error
  Rationale: Prevents accidental or partial provider coupling.

### Capability: engram-memory-adapter

REQ-ENG-001: Engram MUST be available as the first supported memory provider and MUST contribute Engram-specific guidance only through explicit provider injection.
  Priority: MUST
  Surface: Integration
  Rationale: Enables the target flow without hardcoding Engram.

REQ-ENG-002: Engram guidance MUST describe memory as auxiliary and MUST NOT instruct users or agents to replace OpenSpec or Spec Registry artifacts with memory.
  Priority: MUST
  Surface: Data
  Rationale: OpenSpec remains authoritative.

### Capability: developer-team-content

REQ-DTC-001: Core Developer Team prompt/content sources MUST contain no Engram-specific names, MCP tool names, setup instructions, or placeholders.
  Priority: MUST
  Surface: General
  Rationale: Core content must remain provider agnostic.

### Capability: developer-team-runtime-materialization

REQ-DRM-001: Runtime materialization MUST compose memory guidance only when enabled by the selected provider configuration and MUST preserve existing non-memory Developer Team behavior.
  Priority: MUST
  Surface: General
  Rationale: Injection must be configurable and non-disruptive.

### Capability: openspec-artifacts

REQ-OSA-001: OpenSpec artifacts and Spec Registry entries MUST remain required authoritative SDD records regardless of memory provider selection.
  Priority: MUST
  Surface: Data
  Rationale: Memory must not become the artifact store.

## Acceptance Scenarios

### Capability: adaptive-memory-injection

#### Scenario: Memory disabled by default
**Given** no memory provider is selected
**When** Developer Team content is materialized
**Then** no adaptive-memory provider instructions or memory tool bindings are present, and normal SDD guidance remains present
> Covers: REQ-AMI-001, REQ-DRM-001

#### Scenario: Selected provider is injected
**Given** Engram is explicitly selected as the memory provider
**When** Developer Team content is materialized
**Then** Engram-provided instructions and binding metadata are present through the injection path, and no other provider content is present
> Covers: REQ-AMI-002, REQ-ENG-001, REQ-DRM-001

#### Scenario: Unsupported provider is rejected
**Given** an unsupported memory provider is selected
**When** Developer Team content is materialized
**Then** an unsupported-provider diagnostic is observable and no provider-specific memory content is injected
> Covers: REQ-AMI-003

### Capability: developer-team-content

#### Scenario: Core content remains provider-neutral
**Given** core Developer Team content sources
**When** they are inspected without provider injection
**Then** they contain no Engram names, Engram MCP tool names, Engram setup steps, or Engram placeholders
> Covers: REQ-DTC-001

### Capability: engram-memory-adapter

#### Scenario: Engram remains auxiliary
**Given** Engram memory injection is enabled
**When** Developer Team guidance is presented
**Then** the guidance treats memory as auxiliary and still requires OpenSpec artifacts and Spec Registry records for SDD phases
> Covers: REQ-ENG-002, REQ-OSA-001

### Capability: openspec-artifacts

#### Scenario: Memory cannot replace SDD artifacts
**Given** any memory provider is selected
**When** a proposal, spec, design, or registry update is required by the SDD flow
**Then** the required OpenSpec artifact or registry entry is still required and memory content alone is insufficient
> Covers: REQ-OSA-001

## Validation Rules

| Field / Input | Rule | Error Message | REQ-ID |
|---|---|---|---|
| memory provider selection | Optional; empty selection means memory disabled | None | REQ-AMI-001 |
| memory provider selection | Must match a supported provider before injection | Unsupported memory provider: {provider} | REQ-AMI-003 |
| core Developer Team content | Must not include Engram-specific wording without injection | Provider-specific memory content found in core content | REQ-DTC-001 |

## Error Contracts

| Condition | Error Code | Message | Status |
|---|---|---|---|
| Unsupported provider selected | unsupported_memory_provider | Unsupported memory provider: {provider} | N/A |
| Selected provider unavailable or incomplete | memory_provider_unavailable | Memory provider is unavailable or incomplete: {provider} | N/A |

## States and Transitions

| State | Description | Entry Criteria |
|---|---|---|
| Disabled | No adaptive memory is present | No provider selected |
| Provider Selected | A provider has been explicitly selected | Supported provider configured |
| Injected | Provider guidance/bindings are present in materialized content | Materialization succeeds |
| Error | Provider selection cannot be used | Unsupported or unavailable provider |

| From | To | Trigger | Side Effects |
|---|---|---|---|
| Disabled | Provider Selected | Supported provider selected | Provider becomes eligible for injection |
| Provider Selected | Injected | Content materialized | Provider fragments/bindings become observable |
| Provider Selected | Error | Provider unsupported/unavailable | Diagnostic emitted; no provider content injected |

## Open Questions

- Should injection target orchestrator, all agents, skills, or role-specific subsets?
- Should provider selection happen during environment install, Developer Team install, launch, or Configure memory?
- Should initial Engram scope include preferences/summaries only, or later Spec Registry sync?

## Compliance Matrix

| REQ-ID | Scenario(s) | Status |
|---|---|---|
| REQ-AMI-001 | Memory disabled by default | Defined |
| REQ-AMI-002 | Selected provider is injected | Defined |
| REQ-AMI-003 | Unsupported provider is rejected | Defined |
| REQ-ENG-001 | Selected provider is injected | Defined |
| REQ-ENG-002 | Engram remains auxiliary | Defined |
| REQ-DTC-001 | Core content remains provider-neutral | Defined |
| REQ-DRM-001 | Memory disabled by default; Selected provider is injected | Defined |
| REQ-OSA-001 | Engram remains auxiliary; Memory cannot replace SDD artifacts | Defined |
