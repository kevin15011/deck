# Spec: Supermemory Runtime Validation

## Source

- Proposal: `supermemory-runtime-validation` proposal artifact
- Capabilities affected: `supermemory-authenticated-runtime-validation`, `supermemory-pi-runtime-integration`, `adaptive-memory-provider`, `supermemory-adaptive-context`

## Requirements

### Capability: supermemory-authenticated-runtime-validation

REQ-SARV-001: The system MUST validate the configured Supermemory Pi MCP server with authenticated runtime health/capability checks before treating Supermemory as available.
  Priority: MUST
  Surface: Integration
  Rationale: Static configuration alone cannot prove credentials, reachability, or expected MCP capability availability.

REQ-SARV-002: The system MUST treat runtime validation as unsuccessful unless credential acceptance and expected Supermemory MCP capability availability are both confirmed.
  Priority: MUST
  Surface: Security
  Rationale: Supermemory must remain fail-closed unless authenticated runtime readiness is proven.

REQ-SARV-003: The system MUST keep Supermemory memory injection disabled when validation is missing, fails, times out, or is indeterminate.
  Priority: MUST
  Surface: General
  Rationale: Failure to prove authenticated runtime health must not enable adaptive memory injection.

REQ-SARV-004: The system MUST perform validation without exposing Supermemory credential values, tokens, authorization header values, or equivalent secrets in diagnostics or logs.
  Priority: MUST
  Surface: Security
  Rationale: Runtime validation errors must remain safe to show to users and logs.

REQ-SARV-005: The system MUST NOT create, modify, or delete user memory data as part of runtime validation.
  Priority: MUST
  Surface: Data
  Rationale: Validation should prove availability without causing memory side effects.

### Capability: supermemory-pi-runtime-integration

REQ-SPRI-001: During Pi startup, the system MUST enable Supermemory MCP-backed adaptive memory injection only when both static Pi MCP configuration validation and authenticated runtime validation succeed.
  Priority: MUST
  Surface: Integration
  Rationale: Injection should be available for correctly configured authenticated Pi runtimes and unavailable otherwise.

REQ-SPRI-002: During Pi startup, the system MUST continue the OpenSpec workflow without Supermemory adaptive memory when Supermemory configuration is missing, incomplete, invalid, unauthenticated, unreachable, or unhealthy.
  Priority: MUST
  Surface: General
  Rationale: Adaptive memory failure must not block the primary OpenSpec workflow.

REQ-SPRI-003: The system MUST emit a redacted, actionable diagnostic for Supermemory-unavailable startup conditions, identifying the known failure category and remediation direction where determinable.
  Priority: MUST
  Surface: UI
  Rationale: Users need useful remediation guidance without secret exposure.

REQ-SPRI-004: Runtime validation SHOULD be bounded so transient network or runtime issues degrade to a Supermemory-unavailable diagnostic rather than indefinitely delaying startup.
  Priority: SHOULD
  Surface: General
  Rationale: Validation should improve correctness without making startup hang on external dependency failures.

REQ-SPRI-005: This change MUST NOT introduce non-Pi Supermemory runtime support or alter non-Pi Supermemory behavior.
  Priority: MUST
  Surface: General
  Rationale: Non-Pi runtime support is explicitly out of scope.

### Capability: adaptive-memory-provider

REQ-AMP-001: Provider availability status and diagnostics MUST distinguish static/local configuration validity from authenticated runtime availability.
  Priority: MUST
  Surface: General
  Rationale: Users and tests must be able to tell whether failure is due to local configuration or runtime authentication/health.

REQ-AMP-002: The Supermemory provider MUST preserve fail-closed behavior unless authenticated runtime validation has succeeded.
  Priority: MUST
  Surface: Security
  Rationale: Existing safety gates must not be bypassed merely because credentials are present.

REQ-AMP-003: Equivalent Supermemory-unavailable diagnostics from startup memory resolution MUST be reduced to no more than one warning per startup condition.
  Priority: MUST
  Surface: UI
  Rationale: Duplicate startup warnings are noisy and obscure the actionable failure.

REQ-AMP-004: The system MUST NOT write Supermemory secrets to non-secret provider settings or expose secret values through provider diagnostics.
  Priority: MUST
  Surface: Security
  Rationale: Credential storage and redaction boundaries remain unchanged.

### Capability: supermemory-adaptive-context

REQ-SAC-001: Supermemory adaptive context MUST be injected or used only after authenticated runtime validation succeeds.
  Priority: MUST
  Surface: Data
  Rationale: Adaptive context should be available only when the authenticated MCP-backed provider is proven ready.

REQ-SAC-002: When Supermemory validation or configuration fails, adaptive context unavailability MUST remain explicit to the user or caller.
  Priority: MUST
  Surface: UI
  Rationale: Silent absence of memory would make diagnosis difficult and hide fail-closed behavior.

REQ-SAC-003: Engram and other non-Supermemory memory provider behavior MUST remain unchanged by this change.
  Priority: MUST
  Surface: General
  Rationale: The proposal limits scope to Supermemory validation and injection behavior.

## Acceptance Scenarios

### Capability: supermemory-authenticated-runtime-validation

#### Scenario: Successful authenticated validation proves readiness without data side effects
**Given** Supermemory is the active adaptive-memory provider, the Pi MCP Supermemory configuration is structurally valid, the runtime accepts the configured credentials, the expected Supermemory MCP capabilities are available, and the user's memory data has a known baseline
**When** startup performs Supermemory runtime validation
**Then** validation succeeds, Supermemory may be treated as runtime-available, no Supermemory-unavailable diagnostic is emitted for validation, and no user memory item is created, modified, or deleted by validation
> Covers: REQ-SARV-001, REQ-SARV-002, REQ-SARV-005

#### Scenario: Authentication or capability cannot be confirmed
**Given** Supermemory is active and the Pi MCP Supermemory configuration is structurally valid
**When** runtime validation cannot confirm credential acceptance or cannot confirm expected Supermemory MCP capability availability
**Then** validation is unsuccessful and Supermemory memory injection remains disabled
> Covers: REQ-SARV-002, REQ-SARV-003

#### Scenario: Validation timeout or indeterminate result fails closed
**Given** Supermemory is active and runtime validation is attempted
**When** validation times out or produces an indeterminate result
**Then** Supermemory is treated as unavailable for that startup and startup proceeds without enabling Supermemory memory injection
> Covers: REQ-SARV-003, REQ-SPRI-004

#### Scenario: Validation diagnostics redact credentials
**Given** the Supermemory MCP configuration contains credential material
**When** validation fails and emits diagnostics or logs
**Then** the diagnostic output does not include credential values, token values, authorization header values, or equivalent secrets
> Covers: REQ-SARV-004, REQ-AMP-004

### Capability: supermemory-pi-runtime-integration

#### Scenario: Pi startup enables Supermemory injection after successful validation
**Given** Supermemory is active, the Pi MCP Supermemory configuration is valid, and authenticated runtime validation succeeds
**When** Pi startup prepares adaptive memory injection
**Then** Supermemory MCP-backed adaptive memory injection is enabled and startup does not emit `memory_provider_unavailable` for Supermemory
> Covers: REQ-SPRI-001, REQ-SAC-001

#### Scenario: Missing or malformed Pi MCP configuration fails closed with guidance
**Given** Supermemory is active and the Pi MCP Supermemory configuration is missing, incomplete, or malformed
**When** Pi startup prepares adaptive memory injection
**Then** startup continues the OpenSpec workflow without Supermemory adaptive memory and emits one redacted diagnostic identifying the local configuration problem and remediation direction
> Covers: REQ-SPRI-002, REQ-SPRI-003, REQ-AMP-001

#### Scenario: Unauthenticated runtime fails closed with guidance
**Given** Supermemory is active and the Pi MCP Supermemory configuration is structurally valid
**When** authenticated runtime validation determines the configured credentials are not accepted
**Then** startup continues the OpenSpec workflow without Supermemory adaptive memory and emits one redacted diagnostic identifying an authentication failure without exposing secrets
> Covers: REQ-SPRI-002, REQ-SPRI-003, REQ-AMP-001

#### Scenario: Unreachable or unhealthy runtime fails closed with bounded delay
**Given** Supermemory is active and the Pi MCP Supermemory configuration is structurally valid
**When** the Supermemory runtime is unreachable, unhealthy, or unable to complete validation within the validation bound
**Then** startup continues the OpenSpec workflow without Supermemory adaptive memory and emits one redacted diagnostic identifying the runtime health or reachability condition where determinable
> Covers: REQ-SPRI-002, REQ-SPRI-003, REQ-SPRI-004, REQ-AMP-001

### Capability: adaptive-memory-provider

#### Scenario: Provider status distinguishes configuration validity from runtime availability
**Given** Supermemory is active and local configuration validation has a known result
**When** provider availability is reported after runtime validation is attempted or skipped
**Then** the reported availability distinguishes local configuration invalidity from authenticated runtime unavailability
> Covers: REQ-AMP-001

#### Scenario: Provider remains fail-closed before successful validation
**Given** Supermemory credentials are present but authenticated runtime validation has not succeeded
**When** Supermemory provider availability or injection is requested
**Then** the provider reports unavailable and does not enable injection
> Covers: REQ-AMP-002, REQ-SARV-003

#### Scenario: Duplicate Supermemory unavailable warnings are deduplicated
**Given** a single startup condition causes multiple startup memory-resolution paths to encounter the same Supermemory-unavailable result
**When** startup diagnostics are presented
**Then** no more than one equivalent Supermemory-unavailable warning is shown for that condition
> Covers: REQ-AMP-003

#### Scenario: Credential storage boundaries remain unchanged
**Given** Supermemory validation runs during Pi startup
**When** non-secret provider settings and diagnostics are inspected after startup
**Then** Supermemory credential values are not written to non-secret provider settings and are not exposed in diagnostics
> Covers: REQ-AMP-004, REQ-SARV-004

### Capability: supermemory-adaptive-context

#### Scenario: Adaptive context is available after validated Supermemory startup
**Given** Supermemory is active and authenticated runtime validation succeeds
**When** adaptive context is requested during the startup session
**Then** Supermemory-backed adaptive context may be injected or used for that session
> Covers: REQ-SAC-001

#### Scenario: Adaptive context unavailability is explicit after validation failure
**Given** Supermemory is active and validation or configuration fails
**When** adaptive context would otherwise be injected or used
**Then** no Supermemory adaptive context is injected and the unavailable state is explicit through the startup/provider diagnostic surface
> Covers: REQ-SAC-002

#### Scenario: Non-Supermemory provider behavior is unchanged
**Given** Engram or another non-Supermemory memory provider is active, or a non-Pi Supermemory runtime is in use
**When** startup prepares adaptive memory behavior
**Then** behavior remains consistent with the pre-change provider behavior and does not depend on the new Supermemory Pi runtime validation
> Covers: REQ-SAC-003, REQ-SPRI-005

## Validation Rules

| Field / Input | Rule | Error Message | REQ-ID |
|---|---|---|---|
| Active provider | Runtime validation applies when Supermemory is active for the Pi runtime; other providers and non-Pi behavior are unchanged | Not applicable | REQ-SPRI-005, REQ-SAC-003 |
| Pi MCP Supermemory configuration | Must be present and structurally valid before runtime validation can succeed | `memory_provider_unavailable`: Supermemory MCP configuration is missing or invalid; diagnostic must be redacted and actionable | REQ-SPRI-002, REQ-SPRI-003, REQ-AMP-001 |
| Supermemory credentials | Must be accepted by the configured runtime before provider availability can be true | `memory_provider_unavailable`: Supermemory authentication failed; diagnostic must be redacted and actionable | REQ-SARV-002, REQ-SPRI-003 |
| Runtime health/reachability | Runtime must be reachable and healthy enough to complete validation | `memory_provider_unavailable`: Supermemory runtime is unreachable or unhealthy; diagnostic must be redacted and actionable | REQ-SARV-003, REQ-SPRI-002 |
| Expected MCP capabilities | Expected Supermemory MCP capabilities must be confirmed before injection is enabled | `memory_provider_unavailable`: Supermemory runtime did not expose expected capabilities | REQ-SARV-001, REQ-SARV-002 |
| Validation side effects | Validation must not create, modify, or delete user memory data | Validation failure or test failure if memory data changes due to validation | REQ-SARV-005 |
| Diagnostic content | Diagnostics and logs must not include credential values, tokens, authorization header values, or equivalent secrets | Redacted diagnostic required; secret-bearing output is invalid | REQ-SARV-004, REQ-AMP-004 |

## Error Contracts

| Condition | Error Code | Message | Status |
|---|---|---|---|
| Pi MCP Supermemory configuration missing | `memory_provider_unavailable` | Redacted actionable diagnostic identifying missing Supermemory MCP configuration | Startup diagnostic; HTTP status not applicable |
| Pi MCP Supermemory configuration incomplete or malformed | `memory_provider_unavailable` | Redacted actionable diagnostic identifying invalid Supermemory MCP configuration | Startup diagnostic; HTTP status not applicable |
| Supermemory credentials rejected or unauthenticated | `memory_provider_unavailable` | Redacted actionable diagnostic identifying authentication failure without secret values | Startup diagnostic; HTTP status not applicable |
| Supermemory runtime unreachable, unhealthy, timed out, or indeterminate | `memory_provider_unavailable` | Redacted actionable diagnostic identifying runtime health/reachability issue where determinable | Startup diagnostic; HTTP status not applicable |
| Expected Supermemory MCP capabilities unavailable | `memory_provider_unavailable` | Redacted actionable diagnostic identifying missing expected Supermemory MCP capabilities | Startup diagnostic; HTTP status not applicable |
| Equivalent unavailable condition encountered by multiple startup paths | `memory_provider_unavailable` | At most one equivalent redacted actionable diagnostic for the startup condition | Startup diagnostic; HTTP status not applicable |

## States and Transitions

| State | Description | Entry Criteria |
|---|---|---|
| Not applicable | Supermemory Pi runtime validation is not applicable | Supermemory is not the active provider, or runtime is outside the scoped Pi behavior |
| Static configuration invalid | Local Pi MCP Supermemory configuration is missing, incomplete, or malformed | Static configuration validation fails |
| Runtime validation pending | Static Pi MCP configuration is valid, but authenticated runtime validation has not completed successfully | Startup attempts Supermemory availability resolution |
| Runtime available | Supermemory has passed authenticated runtime validation | Credential acceptance and expected MCP capabilities are confirmed |
| Runtime unavailable | Supermemory cannot be treated as available | Validation fails, times out, is indeterminate, or expected capabilities are unavailable |

| From | To | Trigger | Side Effects |
|---|---|---|---|
| Not applicable | Not applicable | Non-Supermemory provider or non-Pi behavior remains active | Existing provider behavior remains unchanged |
| Runtime validation pending | Runtime available | Authenticated runtime validation succeeds | Supermemory adaptive memory injection may be enabled; no unavailable diagnostic for Supermemory validation |
| Runtime validation pending | Runtime unavailable | Validation fails, times out, or is indeterminate | Supermemory injection remains disabled; startup continues with redacted actionable diagnostic |
| Static configuration invalid | Runtime unavailable | Startup resolves Supermemory availability | Supermemory injection remains disabled; startup continues with redacted actionable configuration diagnostic |
| Runtime unavailable | Runtime validation pending | A later startup/session retries validation with current configuration | Availability is re-evaluated for that startup/session |

## Open Questions

- What exact probe sequence should be considered sufficient: `initialize` plus `tools/list`, or also a safe read-only `execute`/search operation?
- Should validation results be cached only within a single launch, or persisted as non-secret health metadata with an expiry?
- Which component should own diagnostic deduplication: the CLI launch path, core memory-injection resolution, or the Pi adapter call sites?

## Compliance Matrix

| REQ-ID | Scenario(s) | Status |
|---|---|---|
| REQ-SARV-001 | Successful authenticated validation proves readiness without data side effects | Defined |
| REQ-SARV-002 | Successful authenticated validation proves readiness without data side effects; Authentication or capability cannot be confirmed | Defined |
| REQ-SARV-003 | Authentication or capability cannot be confirmed; Validation timeout or indeterminate result fails closed; Provider remains fail-closed before successful validation | Defined |
| REQ-SARV-004 | Validation diagnostics redact credentials; Credential storage boundaries remain unchanged | Defined |
| REQ-SARV-005 | Successful authenticated validation proves readiness without data side effects | Defined |
| REQ-SPRI-001 | Pi startup enables Supermemory injection after successful validation | Defined |
| REQ-SPRI-002 | Missing or malformed Pi MCP configuration fails closed with guidance; Unauthenticated runtime fails closed with guidance; Unreachable or unhealthy runtime fails closed with bounded delay | Defined |
| REQ-SPRI-003 | Missing or malformed Pi MCP configuration fails closed with guidance; Unauthenticated runtime fails closed with guidance; Unreachable or unhealthy runtime fails closed with bounded delay | Defined |
| REQ-SPRI-004 | Validation timeout or indeterminate result fails closed; Unreachable or unhealthy runtime fails closed with bounded delay | Defined |
| REQ-SPRI-005 | Non-Supermemory provider behavior is unchanged | Defined |
| REQ-AMP-001 | Missing or malformed Pi MCP configuration fails closed with guidance; Unauthenticated runtime fails closed with guidance; Unreachable or unhealthy runtime fails closed with bounded delay; Provider status distinguishes configuration validity from runtime availability | Defined |
| REQ-AMP-002 | Provider remains fail-closed before successful validation | Defined |
| REQ-AMP-003 | Duplicate Supermemory unavailable warnings are deduplicated | Defined |
| REQ-AMP-004 | Validation diagnostics redact credentials; Credential storage boundaries remain unchanged | Defined |
| REQ-SAC-001 | Pi startup enables Supermemory injection after successful validation; Adaptive context is available after validated Supermemory startup | Defined |
| REQ-SAC-002 | Adaptive context unavailability is explicit after validation failure | Defined |
| REQ-SAC-003 | Non-Supermemory provider behavior is unchanged | Defined |
