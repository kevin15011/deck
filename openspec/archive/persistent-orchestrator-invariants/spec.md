# Spec: Persistent Orchestrator Invariants

## Source

- Proposal: `persistent-orchestrator-invariants` proposal artifact
- Exploration: `persistent-orchestrator-invariants` exploration artifact
- Capabilities affected: `orchestrator-invariant-system` (new), `prompt-module-documentation` (new), `orchestrator-content` (modified), `instruction-bundle-composition` (modified)

## Requirements

### Capability: orchestrator-invariant-system

REQ-OIS-001: The system MUST define a typed schema for orchestrator invariants including: unique rule ID, priority tier (`critical` | `high` | `standard`), applicable surfaces (`session` | `agent` | `skill`), condition text, required action text, rationale, and violation consequence.
  Priority: MUST
  Surface: Data
  Rationale: Without a schema, invariants remain unstructured prose and cannot be programmatically verified, ordered, or versioned.

REQ-OIS-002: The system MUST define at least five critical-tier invariants extracted from the existing orchestrator prompt: (1) ask Automatic vs Interactive on first SDD run per session, (2) pure delegator — never execute specialist work, (3) SDD Initialization Gate — check `openspec/config.yaml`, (4) SDD Triage Gate — classify before asking execution mode, (5) registry-deferred mode for parallel phases.
  Priority: MUST
  Surface: General
  Rationale: These five rules were identified as the highest-risk behavioral rules currently buried in prose; extracting them is the core deliverable.

REQ-OIS-003: The system MUST define a canonical invariant ordering such that `critical`-tier invariants appear before `high`-tier, and `high` before `standard` within any composed output.
  Priority: MUST
  Surface: General
  Rationale: Priority ordering ensures the most important rules are never deprioritized by other content.

REQ-OIS-004: Invariants MUST be injected into the composed output at a position that precedes all capability instruction bundles (`PACKAGE_ORDER` content) AND before context-authority guidance, at the very start of the output for maximum visibility.
  Priority: MUST
  Surface: General
  Rationale: Invariants are authoritative behavioral rules and must have maximum visibility — they must not be overridden or pushed below context-authority or capability bundles. This ordering aligns with user/explorer preference for top-level placement.

REQ-OIS-005: The system MUST inject invariants into all three surfaces: `session` (orchestrator system prompt), `agent` (orchestrator agent body), and `skill` (orchestrator skill body).
  Priority: MUST
  Surface: Integration
  Rationale: The orchestrator content is consumed through different surfaces by different adapters; invariants must be present regardless of which surface an adapter reads.

REQ-OIS-006: Invariant injection MUST be idempotent — composing the same invariant set multiple times MUST NOT produce duplicate content in the output.
  Priority: MUST
  Surface: Data
  Rationale: Adapters may re-compose content on session recovery or config reload; duplicate invariants would inflate token usage and cause confusion.

REQ-OIS-007: The composed orchestrator output MUST include a recognizable, parseable section header (e.g., `## Orchestrator Invariants`) that encloses all injected invariants.
  Priority: MUST
  Surface: Integration
  Rationale: A discoverable section header is required for both human readability and programmatic verification.

REQ-OIS-008: The system MUST provide a verification function that, given composed orchestrator output, confirms all critical-tier invariants are present via normalized substring search on rule IDs or section headers.
  Priority: MUST
  Surface: API
  Rationale: Without verification, invariant extraction could silently regress. Verification must be lightweight and deterministic.

REQ-OIS-009: The verification function MUST return a structured result indicating pass/fail and listing any missing invariant IDs.
  Priority: MUST
  Surface: API
  Rationale: A boolean result is insufficient for debugging; the missing IDs enable targeted fixes.

REQ-OIS-010: The system SHOULD support an `high`-tier invariant category for rules that are important but not session-breaking (e.g., recovery rule, post-archive git suggestions).
  Priority: SHOULD
  Surface: Data
  Rationale: Not all behavioral rules are equally critical; a tier system allows future extraction without polluting the critical tier.

REQ-OIS-011: Invariant records MUST include a trace reference to the source paragraph or section in `orchestrator-content.ts` from which the rule was extracted.
  Priority: MUST
  Surface: Data
  Rationale: Prevents semantic drift during extraction; each invariant must be traceable to its prose origin.

REQ-OIS-012: The invariant schema MUST NOT reference runtime-specific launcher behavior (Pi, OpenCode, or any specific adapter).
  Priority: MUST
  Surface: General
  Rationale: Invariants are runner-agnostic behavioral rules, just like the rest of the content registry.

### Capability: instruction-bundle-composition (modified)

REQ-IBC-001: The composition pipeline in `content-registry.ts` MUST be extended to include an invariant composition step that executes at the VERY START, before all other content including context-authority guidance.
  Priority: MUST
  Surface: Integration
  Rationale: This is the insertion point defined by REQ-OIS-004 (updated to match user preference for maximum visibility). The pipeline has a documented step order that must be preserved.

REQ-IBC-002: The composition pipeline for `getTeamSessionInstructions` MUST include invariant injection at the VERY START, before capability instruction fragments and context-authority guidance.
  Priority: MUST
  Surface: Integration
  Rationale: Session instructions follow the same ordering constraint as agent/skill bodies — maximum visibility for authoritative rules.

REQ-IBC-003: Existing `PACKAGE_ORDER` behavior for capability instruction bundles MUST remain unchanged — invariants are a separate layer, not a new entry in `PACKAGE_ORDER`.
  Priority: MUST
  Surface: General
  Rationale: Invariants are not a capability package; they are behavioral rules with a different composition contract. Mixing them would violate the existing abstraction.

REQ-IBC-004: The `CapabilityInstructionFragment` type and `composeCapabilityInstructions` function MUST NOT be modified to carry invariant data.
  Priority: MUST
  Surface: General
  Rationale: Invariants have a different schema and composition contract; reusing the fragment type would create a leaky abstraction.

### Capability: prompt-module-documentation

REQ-PMD-001: A documentation artifact MUST be created that catalogues all existing prompt/methodology modules in the Developer Team, organized by conceptual module (not by source file).
  Priority: MUST
  Surface: General
  Rationale: Currently 15+ modules exist only as embedded prose; external documentation enables team onboarding, cross-referencing, and maintenance.

REQ-PMD-002: The documentation MUST include the SDD Triage Gate as a module — NOT a separate "documentation triage" concept.
  Priority: MUST
  Surface: General
  Rationale: Explicit user correction. The SDD Triage Gate is an existing Orchestrator behavioral gate that must be documented as-is.

REQ-PMD-003: Each documented module MUST include: module name, what it governs, source file reference, key rules summary, and composition context (which surfaces it affects).
  Priority: MUST
  Surface: General
  Rationale: Consistent structure enables quick lookup and prevents documentation drift from code.

REQ-PMD-004: The documentation MUST cover at minimum the following module categories: gatekeepers (SDD Triage, SDD Init, Execution Mode), delegation rules, quality/self-verification patterns, return contracts, task/apply contracts, registry rules, context/injection protocols, and instruction bundles.
  Priority: MUST
  Surface: General
  Rationale: These are the conceptual modules identified in the exploration; omitting any leaves the documentation incomplete.

REQ-PMD-005: The documentation SHOULD include Orchestrator Invariants as a module category, referencing the new invariant system once implemented.
  Priority: SHOULD
  Surface: General
  Rationale: Invariants are a new module category; documenting them alongside existing modules provides a complete inventory.

REQ-PMD-006: The documentation MUST NOT duplicate content already present in `docs/developer-team.md` — it MUST complement it by covering methodology internals not documented there.
  Priority: MUST
  Surface: General
  Rationale: The existing doc covers roster, dependency graph, and agent/skill model; the new doc covers internal behavioral methodology.

### Capability: backward-compatibility

REQ-BC-001: The extraction of invariants from `orchestrator-content.ts` MUST NOT change the observable behavior of the orchestrator prompt when invariants are composed back into the output.
  Priority: MUST
  Surface: General
  Rationale: This is a structural refactoring, not a behavioral change. If the composed output differs semantically, the extraction introduced drift.

REQ-BC-002: All existing tests in the project MUST continue to pass after invariant extraction and injection are implemented.
  Priority: MUST
  Surface: General
  Rationale: Regressions indicate broken contracts; the change must be transparent to existing consumers.

REQ-BC-003: Adapters (`adapter-opencode`, `adapter-pi`) MUST NOT require code changes to consume invariant-enriched output — they receive the same `AgentContent` and session string types.
  Priority: MUST
  Surface: Integration
  Rationale: The content registry API (`getAgentContentResult`, `getTeamSessionInstructions`) returns the same types; adapters are consumers, not participants in invariant composition.

REQ-BC-004: The `orchestrator-content.ts` source prompts MAY retain the original prose rules alongside extracted invariants during a transition period, provided the composed output does not duplicate content.
  Priority: MAY
  Surface: General
  Rationale: Allows incremental migration; prose can be removed in a follow-up once invariants are verified in production.

## Acceptance Scenarios

### Capability: orchestrator-invariant-system

#### Scenario: Schema defines invariant type
**Given** the invariant module is loaded
**When** a developer creates an invariant record
**Then** the record must include fields: `id`, `tier`, `surfaces`, `condition`, `action`, `rationale`, `violationConsequence`, and `sourceTrace`
> Covers: REQ-OIS-001

#### Scenario: Five critical invariants exist
**Given** the invariant module is loaded
**When** all critical-tier invariants are queried
**Then** at least five invariants are returned with IDs corresponding to: execution-mode-ask, pure-delegator, sdd-init-gate, sdd-triage-gate, registry-deferred-mode
**And** each has `tier: "critical"`
> Covers: REQ-OIS-002

#### Scenario: Critical invariants appear before high-tier in composed output
**Given** critical-tier and high-tier invariants are defined
**When** invariants are composed into output
**Then** all critical-tier invariant text appears before any high-tier invariant text in the composed string
> Covers: REQ-OIS-003

#### Scenario: Invariants injected at the very start for maximum visibility
**Given** a full composition is performed for the orchestrator agent
**When** the composed output is examined
**Then** the `## Orchestrator Invariants` section appears FIRST (at very start), then context-authority guidance, then capability instruction bundle content
> Covers: REQ-OIS-004, REQ-IBC-001 (updated to match user preference)

#### Scenario: Invariants present on all surfaces
**Given** the orchestrator agent content is composed with invariants
**When** `getAgentContentResult("deck-developer-orchestrator", opts)` is called
**Then** both `agentBody` and `skillBody` contain the `## Orchestrator Invariants` section
**And** `getTeamSessionInstructions("developer-team", opts)` also contains the section
> Covers: REQ-OIS-005

#### Scenario: Idempotent injection — no duplicates on double-compose
**Given** invariants are composed into orchestrator content
**When** the same invariant set is composed again into the already-composed output
**Then** each invariant rule ID appears exactly once in the output string
> Covers: REQ-OIS-006

#### Scenario: Recognizable section header in output
**Given** invariants are composed into any surface
**When** the composed output is searched for `## Orchestrator Invariants`
**Then** exactly one match is found
> Covers: REQ-OIS-007

#### Scenario: Verification passes for complete output
**Given** the orchestrator output is fully composed with all critical invariants
**When** the verification function is called
**Then** the result is `{ pass: true, missing: [] }`
> Covers: REQ-OIS-008, REQ-OIS-009

#### Scenario: Verification reports missing invariants
**Given** an orchestrator output string that is missing the `sdd-triage-gate` invariant
**When** the verification function is called
**Then** the result is `{ pass: false, missing: ["sdd-triage-gate"] }`
> Covers: REQ-OIS-008, REQ-OIS-009

#### Scenario: Each invariant traces to source prose
**Given** any defined invariant record
**When** the `sourceTrace` field is examined
**Then** it references a specific section or paragraph in `orchestrator-content.ts`
> Covers: REQ-OIS-011

#### Scenario: Invariant schema is runner-agnostic
**Given** any invariant record
**When** the invariant text is examined
**Then** it contains no reference to "Pi", "OpenCode", or any specific adapter/runner name
> Covers: REQ-OIS-012

#### Scenario: High-tier invariant support
**Given** an invariant with `tier: "high"` is defined
**When** invariants are composed
**Then** the high-tier invariant appears after all critical-tier invariants
**And** the composed output includes the high-tier invariant text
> Covers: REQ-OIS-010

### Capability: instruction-bundle-composition (modified)

#### Scenario: Session instructions include invariants before capability bundles
**Given** `getTeamSessionInstructions("developer-team", opts)` is called with capability instructions enabled
**When** the returned string is examined
**Then** the `## Orchestrator Invariants` section appears FIRST (at very start), BEFORE context-authority guidance, and before any adaptive-memory/codebase-memory/context-mode/rtk fragments
> Covers: REQ-IBC-002

#### Scenario: PACKAGE_ORDER unchanged
**Given** the invariant system is implemented
**When** `PACKAGE_ORDER` is inspected
**Then** it contains exactly `["codebase-memory", "context-mode", "rtk", "adaptive-memory"]` — no invariant entries
> Covers: REQ-IBC-003

#### Scenario: CapabilityInstructionFragment type not modified
**Given** the invariant system is implemented
**When** `CapabilityInstructionFragment` type is inspected
**Then** its fields remain: `packageId`, `surface`, `markdown`, `teamId?`, `agentIds?`, `skillIds?` — no invariant-specific fields
> Covers: REQ-IBC-004

### Capability: prompt-module-documentation

#### Scenario: Documentation artifact exists
**Given** the change is implemented
**When** the documentation file is checked
**Then** a single documentation file exists in the `docs/` directory covering all prompt/methodology modules
> Covers: REQ-PMD-001

#### Scenario: SDD Triage Gate documented as module, not "documentation triage"
**Given** the documentation artifact is read
**When** the table of contents or module list is examined
**Then** "SDD Triage Gate" appears as a module
**And** no module named "documentation triage" exists
> Covers: REQ-PMD-002

#### Scenario: Each module has required structure
**Given** the documentation artifact is read
**When** any module section is examined
**Then** it includes: module name, what it governs, source file reference, key rules summary, composition context
> Covers: REQ-PMD-003

#### Scenario: All required module categories covered
**Given** the documentation artifact is read
**When** the list of modules is examined
**Then** it includes modules covering: gatekeepers (SDD Triage, SDD Init, Execution Mode), delegation rules, quality/self-verification, return contracts, task/apply contracts, registry rules, context/injection protocols, and instruction bundles
> Covers: REQ-PMD-004

#### Scenario: Documentation complements developer-team.md
**Given** both `docs/developer-team.md` and the new documentation artifact exist
**When** their content is compared
**Then** the new doc does not duplicate the roster table, dependency graph, or agent/skill model descriptions from developer-team.md
> Covers: REQ-PMD-006

### Capability: backward-compatibility

#### Scenario: Composed output preserves behavioral semantics
**Given** the invariant extraction is complete
**When** the composed orchestrator output (with invariants injected) is compared to the original full-text prompt
**Then** all behavioral rules from the original prompt are semantically preserved in the composed output
> Covers: REQ-BC-001

#### Scenario: All existing tests pass
**Given** the invariant system is implemented
**When** `bun test` is run
**Then** all previously passing tests continue to pass
> Covers: REQ-BC-002

#### Scenario: Adapters consume unchanged API types
**Given** the invariant system is implemented
**When** `getAgentContentResult()` and `getTeamSessionInstructions()` are called
**Then** they return the same types (`AgentContent` with `agentBody`/`skillBody` strings, and `string | undefined`) without type changes
> Covers: REQ-BC-003

#### Scenario: Gradual prose migration allowed
**Given** the invariant extraction is implemented with prose retained in source
**When** the composed output is generated
**Then** invariant text from the invariant module appears exactly once (no duplication from retained prose)
> Covers: REQ-BC-004

## Validation Rules

| Field / Input | Rule | Error Condition | REQ-ID |
|---|---|---|---|
| Invariant `id` | Non-empty, unique across all invariants | Duplicate or empty ID | REQ-OIS-001 |
| Invariant `tier` | One of `"critical"`, `"high"`, `"standard"` | Invalid tier value | REQ-OIS-001 |
| Invariant `surfaces` | Non-empty array of `"session"`, `"agent"`, `"skill"` | Empty or invalid surface | REQ-OIS-001 |
| Invariant `sourceTrace` | Non-empty string referencing orchestrator-content.ts | Empty or null trace | REQ-OIS-011 |
| Composed output | Contains `## Orchestrator Invariants` section header | Header missing | REQ-OIS-007 |
| Verification result | `missing` array is empty for fully composed output | Any critical ID missing | REQ-OIS-008 |
| Documentation file | Exists in `docs/` with non-zero byte count | File missing or empty | REQ-PMD-001 |

## Error Contracts

| Condition | Error Type | Message Pattern | Surface |
|---|---|---|---|
| Duplicate invariant ID detected at build time | Build-time error | `Duplicate invariant ID: {id}` | Data |
| Verification detects missing critical invariant | Verification warning/error | `Missing critical invariant: {id}` | API |
| Composition produces no invariant section | Verification failure | `Orchestrator Invariants section not found in composed output` | Integration |
| Source trace references non-existent section | Build-time warning | `Source trace for {id} references non-existent section` | Data |

## States and Transitions

### Invariant Lifecycle

| State | Description | Entry Criteria |
|---|---|---|
| `defined` | Invariant record exists in schema with all required fields | Schema validation passes |
| `active` | Invariant is included in composition and injected into output | Tier matches enabled tiers, surfaces match target |
| `verified` | Invariant presence confirmed in composed output via verification function | Verification function finds invariant ID/section |

| From | To | Trigger | Side Effects |
|---|---|---|---|
| `defined` | `active` | Composition pipeline invoked | Invariant text injected into target surfaces |
| `active` | `verified` | Verification function called on composed output | Pass/fail result with missing IDs |
| `verified` | `active` | Re-composition after invariant change | New composed output must be re-verified |

## Non-Functional Requirements

| Category | Requirement | REQ-ID |
|---|---|---|
| Performance | Invariant composition MUST add < 1ms to total composition time (invariants are static data, no I/O) | REQ-OIS-001 |
| Performance | Verification MUST complete in < 5ms for a fully composed output string (substring search on ~100KB text) | REQ-OIS-008 |
| Maintainability | Adding a new invariant MUST require editing only the invariant module, not the composition pipeline or content registry | REQ-OIS-001 |
| Token efficiency | Invariant section MUST use concise language; total invariant text for critical tier SHOULD be < 2KB to minimize token overhead | REQ-OIS-002 |
| Testability | Every critical-tier invariant MUST be independently testable via the verification function | REQ-OIS-008 |

## Out of Scope

- Rewriting all agent prompts into a structured DSL or template language.
- Changing runtime adapter serialization logic beyond consuming new invariant content.
- Modifying the self-audit contract schema (`self-audit.ts`).
- Implementing automated prompt regression testing or A/B testing.
- Changing enforcement mode behavior or risk scorer thresholds.
- Creating a separate "documentation triage" concept (SDD Triage Gate is the existing concept to document).
- Versioning invariants independently (rule ID + git history is sufficient initially).

## Open Questions

1. Should invariants be versioned independently (e.g., `INV-001-v1`) to support safe evolution, or is the rule ID sufficient with git history?
2. Should the verification step be a unit test in `orchestrator-content.test.ts`, a runtime check in the adapter install pipeline, or both?
3. Does the user prefer the documentation artifact as a single file (`docs/prompt-methodology-modules.md`) or split per module category?
4. Are there additional critical rules beyond the five identified that should be in the initial critical tier?
5. Should the prose rules in `orchestrator-content.ts` be removed after extraction, or retained for backward compatibility during a transition period?

## Compliance Matrix

| REQ-ID | Scenario(s) | Status |
|---|---|---|
| REQ-OIS-001 | Schema defines invariant type | Defined |
| REQ-OIS-002 | Five critical invariants exist | Defined |
| REQ-OIS-003 | Critical invariants appear before high-tier | Defined |
| REQ-OIS-004 | Invariants injected at very start, before context-authority and bundles | Defined |
| REQ-OIS-005 | Invariants present on all surfaces | Defined |
| REQ-OIS-006 | Idempotent injection — no duplicates | Defined |
| REQ-OIS-007 | Recognizable section header | Defined |
| REQ-OIS-008 | Verification passes/fails correctly | Defined |
| REQ-OIS-009 | Verification reports missing invariants | Defined |
| REQ-OIS-010 | High-tier invariant support | Defined |
| REQ-OIS-011 | Each invariant traces to source | Defined |
| REQ-OIS-012 | Invariant schema runner-agnostic | Defined |
| REQ-IBC-001 | Invariants at very start, before authority and bundles | Defined |
| REQ-IBC-002 | Session instructions ordering | Defined |
| REQ-IBC-003 | PACKAGE_ORDER unchanged | Defined |
| REQ-IBC-004 | Fragment type not modified | Defined |
| REQ-PMD-001 | Documentation artifact exists | Defined |
| REQ-PMD-002 | SDD Triage Gate as module, no "documentation triage" | Defined |
| REQ-PMD-003 | Each module has required structure | Defined |
| REQ-PMD-004 | All required categories covered | Defined |
| REQ-PMD-005 | Orchestrator Invariants in docs | Defined |
| REQ-PMD-006 | Complements developer-team.md | Defined |
| REQ-BC-001 | Behavioral semantics preserved | Defined |
| REQ-BC-002 | All tests pass | Defined |
| REQ-BC-003 | Adapter API types unchanged | Defined |
| REQ-BC-004 | Gradual prose migration | Defined |

## Mermaid Summary Source

```mermaid
graph TD
    subgraph Schema["Invariant Schema"]
        S1[OrchestratorInvariant type]
        S2[Tier: critical | high | standard]
        S3[Source trace to orchestrator-content.ts]
    end

    subgraph Critical["Critical-Tier Invariants (P0)"]
        I1[INV: Execution Mode Ask]
        I2[INV: Pure Delegator]
        I3[INV: SDD Init Gate]
        I4[INV: SDD Triage Gate]
        I5[INV: Registry-Deferred Mode]
    end

    subgraph Pipeline["Composition Pipeline"]
        P1[1. Context Authority Guidance]
        P2[2. Orchestrator Invariants — NEW]
        P3[3. Capability Instruction Bundles]
    end

    subgraph Surfaces["Target Surfaces"]
        T1[Session prompt]
        T2[Agent body]
        T3[Skill body]
    end

    subgraph Verify["Verification"]
        V1[Verify critical invariants present]
        V2[Report missing IDs]
    end

    subgraph Docs["Documentation"]
        D1[SDD Triage Gate module]
        D2[Gatekeepers]
        D3[Delegation Rules]
        D4[Quality / Self-Verification]
        D5[Return Contracts]
        D6[Task / Apply Contracts]
        D7[Registry Rules]
        D8[Context / Injection Protocols]
        D9[Instruction Bundles]
        D10[Orchestrator Invariants — NEW]
    end

    Schema --> Critical
    Critical --> Pipeline
    P1 --> P2 --> P3
    Pipeline --> Surfaces
    Surfaces --> Verify
    Critical --> Docs
    Docs --> D1 & D2 & D3 & D4 & D5 & D6 & D7 & D8 & D9 & D10
```
