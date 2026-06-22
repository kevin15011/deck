# Prompt/Methodology Modules

This document provides a single human-readable inventory of all prompt/methodology modules in the Developer Team. It documents existing behavioral gates, delegation rules, and protocol patterns that govern orchestrator and phase agent behavior.

**Constraint**: This document does NOT create a separate "documentation triage" concept. The SDD Triage Gate is an existing orchestrator module documented here alongside others.

## Summary Table

| Module | Category | Source File(s) | Surfaces |
|---|---|---|---|
| SDD Triage Gate | Gatekeeper | `orchestrator-content.ts` | session, agent, skill |
| SDD Initialization Gate | Gatekeeper | `orchestrator-content.ts` | session, agent, skill |
| Execution Mode Gate | Gatekeeper | `orchestrator-content.ts` | session, agent, skill |
| Delegation Rules | Rule Set | `orchestrator-content.ts` | session, agent, skill |
| Artifact Store & Spec Registry | Storage | `orchestrator-content.ts` | session, agent, skill |
| Registry-Deferred Mode | Parallelism | `orchestrator-content.ts` | session, agent, skill |
| Bounded Repair Loop | Repair Protocol | Repair incident contract, registry schema, Developer Team phase content | session, agent, skill |
| Apply Routing & Blocker Classification | Routing | `orchestrator-content.ts` | session, agent, skill |
| Self-Verification Pattern | Pattern | Phase content (`*-content.ts`) | skill |
| Return Contracts | Contract | Phase content (`*-content.ts`) | skill |
| Skill Resolution & Injection | Protocol | `orchestrator-content.ts` | session |
| Sub-Agent Context Protocol | Protocol | `orchestrator-content.ts` | session |
| Adaptive Memory Protocol | Protocol | `instruction-bundles/adaptive-memory.ts` | session, agent, skill |
| Codebase Memory Protocol | Protocol | `instruction-bundles/codebase-memory.ts` | session, agent, skill |
| Context Authority Guidance | Protocol | `adaptive-context-renderer.ts` | agent, skill |
| Instruction Bundles | Composition | `instruction-bundles/index.ts` | session, agent, skill |
| Orchestrator Invariants | Invariants | `orchestrator-invariants.ts` | session, agent, skill, manifest |

---

## 1. SDD Triage Gate

### What it governs

Classifies user requests into appropriate workflows BEFORE launching SDD phases. Prevents unnecessary SDD pipeline overhead for simple requests.

### Source file(s)

- `packages/core/src/teams/developer/orchestrator-content.ts` (lines 146-159, 432-452)

### Key rules

- **Direct**: answer, inspect, or edit inline when request is local, low-risk, already clear.
- **Specialist only**: delegate one narrow role for bounded artifacts or analysis.
- **Recommend SDD**: suggest SDD for ambiguous scope, product requirements, architecture decisions, multi-file impact.
- **Run SDD**: start full pipeline when user explicitly requests or accepts recommendation.
- Do NOT infer full SDD from keywords like "OpenSpec", "PRD", "requirements".
- Do NOT ask for Automatic vs Interactive until triage says **Run SDD**.

### Surfaces

- session: ✓
- agent: ✓
- skill: ✓

---

## 2. SDD Initialization Gate

### What it governs

Ensures the project is initialized before any SDD work begins. Delegates to `deck-init` when not initialized.

### Source file(s)

- `packages/core/src/teams/developer/orchestrator-content.ts` (lines 133-144, 417-428)

### Key rules

- Read `openspec/config.yaml` and check `initialized` field before SDD work.
- If `initialized: false` or file does not exist → MUST delegate to `deck-init`.
- Re-check the flag after `deck-init` completes.
- Proceed with SDD triage only if init succeeds.

### Surfaces

- session: ✓
- agent: ✓
- skill: ✓

---

## 3. Execution Mode Gate

### What it governs

Determines how phases execute: Automatic (back-to-back) vs Interactive (pause after each phase).

### Source file(s)

- `packages/core/src/teams/developer/orchestrator-content.ts` (lines 161-168, 458-463)

### Key rules

- Ask user on FIRST change request per session: Automatic or Interactive?
- **Automatic**: run all phases back-to-back without pausing.
- **Interactive** (default): after each phase, show summary and ask before proceeding.
- Cache the mode for the session.
- INV-001 in `orchestrator-invariants.ts`.

### Surfaces

- session: ✓
- agent: ✓
- skill: ✓

---

## 4. Delegation Rules

### What it governs

When the orchestrator should delegate vs handle inline. Core principle: protect context by delegating specialist work.

### Source file(s)

- `packages/core/src/teams/developer/orchestrator-content.ts` (lines 81-116, 341-379)

### Key rules

- **Core principle**: if it can be delegated, it SHOULD be delegated.
- **Inline vs delegate table**:
  - Read 1-3 files to decide/verify → inline
  - Read 4+ files → delegate exploration
  - Write atomic (one file) → inline
  - Write with analysis (2+ files) → delegate
  - Bash for state (git, gh) → inline
  - Bash for execution (test, build) → delegate
- **5 Mandatory Delegation Triggers**:
  1. 4-file rule
  2. Multi-file write rule
  3. PR rule
  4. Incident rule
  5. Long-session rule

### Surfaces

- session: ✓
- agent: ✓
- skill: ✓

---

## 5. Artifact Store & Spec Registry

### What it governs

How SDD artifacts are persisted and tracked. Mandates OpenSpec directory structure.

### Source file(s)

- `packages/core/src/teams/developer/orchestrator-content.ts` (lines 170-185, 467-510)

### Key rules

- All artifacts go in `openspec/changes/{change-name}/`.
- **Required artifacts**: `proposal.md`, `spec.md`, `design.md`, `tasks.md`, `apply-progress.md`, `verify-report.md`, `review-report.md`, `archive-report.md`.
- **Spec Registry required**:
  - `state.yaml`: phase, status, artifact references, provenance
  - `events.yaml`: phase events
- Phase not complete without artifact + registry entries.
- Read existing registry before writing; merge without dropping prior state.

### Surfaces

- session: ✓
- agent: ✓
- skill: ✓

---

## 6. Registry-Deferred Mode

### What it governs

Safe parallelism for Spec+Design and Verify+Review batches by deferring registry writes.

### Source file(s)

- `packages/core/src/teams/developer/orchestrator-content.ts` (lines 181-182, 493-502)

### Key rules

- Parallel phase agents write only their artifact (no `state.yaml`/`events.yaml`).
- Each agent reports registry intent/status/event in return contract.
- Orchestrator serializes registry updates after all agents complete.
- Prevents race conditions on shared registry files.
- INV-005 in `orchestrator-invariants.ts`.

### Surfaces

- session: ✓
- agent: ✓
- skill: ✓

---

## 7. Bounded Repair Loop

### What it governs

Controls retry behavior after Verify or Apply failures so repairs stay bounded, evidence-preserving, and registry-visible instead of becoming untracked repeated attempts.

### Source file(s)

- `packages/sdd-runtime/src/contracts/repair-incident.ts`
- `packages/sdd-runtime/src/orchestrator/repair-loop-governance.ts`
- `packages/core/src/spec-registry/schema.ts`
- Developer Team phase content modules that consume or produce repair incidents

### Key rules

- **Budget declaration**: a repair loop records operating mode, incident budget, fingerprint budget, verification-cycle limits, retry counts, and the initial outcome before retrying.
- **Repair manifest**: repair handoff uses `repair-incident.md` with schema `repair-incident-v1`, failed contract evidence, normalized fingerprint, generated-artifact classification, and the next verification stage.
- **Staged verification**: run targeted checks first, then affected-area checks, then broad gate only after narrower checks pass or with recorded rationale.
- **Generated-artifact policy**: classify touched or suspected generated files as `not_generated`, `checked_in_deterministic`, `checked_in_environment_sensitive`, `untracked_build_output`, or `unknown`; preserve regeneration evidence when required.
- **Apply/Verify handoff quality**: Apply preserves prior Verify evidence, updates retry accounting and next verification stage, and refuses underspecified repair manifests with a recorded blocked/replan/clarification result.
- **Registry telemetry**: when a repair loop starts, state may reference `artifacts.repair_incident: repair-incident.md`; events use auxiliary `repair.*` names and must not advance `currentPhase` by themselves.
- **Warning-first rollout**: existing changes without repair telemetry remain valid. Missing `artifacts.repair_incident` with repair events is a validator warning unless the artifact is explicitly referenced and absent during Apply/Verify.

### Related modules

- Artifact Store & Spec Registry — records `repair-incident.md` and auxiliary repair lifecycle events.
- Registry-Deferred Mode — Orchestrator reconciles repair telemetry when parallel agents cannot safely write registry files directly.
- Apply Routing & Blocker Classification — repair failures may route to owner-specific Apply agents or back to Task/Design when replan is required.
- Self-Verification Pattern — repair attempts must report targeted evidence before returning to Verify.

### Surfaces

- session: ✓
- agent: ✓
- skill: ✓

---

## 8. Apply Routing & Blocker Classification

### What it governs

How tasks are classified and dispatched to Apply agents. Controls batching and owner assignment.

### Source file(s)

- `packages/core/src/teams/developer/orchestrator-content.ts` (lines 188-214, 736-756)

### Key rules

- Inspect Tasks artifact `Open Questions / Blockers` section.
- **Classification**:
  - **Unblocked**: implement now.
  - **Blocked**: ask user or request Task repair before Apply.
  - **Allowed-with-placeholder**: implement with explicit placeholder/stub.
- **Apply Batching**:
  - Group by owner, context, dependency chain.
  - Do NOT default to one agent per task.
  - Respect dependency ordering (shared/contracts before backend/frontend).
- **Owner routing**:
  - General → small, shared, cross-cutting, config, scripts, docs
  - Backend → APIs, services, database, auth, server-side
  - Frontend → UI, components, state, accessibility

### Surfaces

- session: ���
- agent: ✓
- skill: ✓

---

## 8. Self-Verification Pattern

### What it governs

Each phase agent verifies its own output before returning. Shared across all SDD phases.

### Source file(s)

- Phase content files:
  - `packages/core/src/teams/developer/proposal-content.ts`
  - `packages/core/src/teams/developer/spec-content.ts`
  - `packages/core/src/teams/developer/design-content.ts`
  - `packages/core/src/teams/developer/task-content.ts`
  - `packages/core/src/teams/developer/apply-general-content.ts`
  - `packages/core/src/teams/developer/apply-backend-content.ts`
  - `packages/core/src/teams/developer/apply-frontend-content.ts`
  - `packages/core/src/teams/developer/verify-content.ts`
  - `packages/core/src/teams/developer/review-content.ts`
  - `packages/core/src/teams/developer/archive-content.ts`

### Key rules

- Each phase agent must verify its own output before returning.
- Checks: artifact exists, required sections present, return contract fields satisfied.
- Self-verification catches issues before passing to downstream.

### Surfaces

- session: —
- agent: —
- skill: ✓

---

## 9. Return Contracts

### What it governs

Standard output format for each phase agent. Ensures downstream can parse results.

### Source file(s)

- Phase content files — each has `## Return Contract` section:
  - `packages/core/src/teams/developer/proposal-content.ts` (line 62+)
  - `packages/core/src/teams/developer/spec-content.ts` (line 67+)
  - `packages/core/src/teams/developer/design-content.ts` (line 74+)
  - `packages/core/src/teams/developer/task-content.ts` (line 69+)
  - `packages/core/src/teams/developer/explorer-content.ts` (line 62+)
  - `packages/core/src/teams/developer/apply-general-content.ts` (line 75+)
  - `packages/core/src/teams/developer/apply-backend-content.ts` (line 76+)
  - `packages/core/src/teams/developer/apply-frontend-content.ts` (line 77+)
  - `packages/core/src/teams/developer/verify-content.ts` (line 66+)
  - `packages/core/src/teams/developer/review-content.ts` (line 77+)
  - `packages/core/src/teams/developer/archive-content.ts` (line 73+)

### Key rules

- Each phase has a fixed return format (per the skill).
- Required fields vary by phase but always include: artifact path, phase status, registry status.
- For registry-deferred mode: include `Registry Write: deferred` and intended status.
- Violation of return contract is grounds for rejection.

### Surfaces

- session: —
- agent: —
- skill: ✓

---

## 10. Skill Resolution & Injection

### What it governs

How project-specific skills are resolved and injected at session start.

### Source file(s)

- `packages/core/src/teams/developer/orchestrator-content.ts` (lines 238-247)

### Key rules

- Resolve relevant skills once per session.
- Search for skill registry (project memory or `.atl/skill-registry.md`).
- Cache compact rules from registry.
- Match skills by code context (file extensions/paths) and task context.
- Inject matching rules under `## Project Standards (auto-resolved)`.
- Warn user if no registry exists and proceed without project-specific standards.

### Surfaces

- session: ✓
- agent: —
- skill: —

---

## 11. Sub-Agent Context Protocol

### What it governs

How context flows to sub-agents. Handles SDD phase flow vs ad-hoc delegation differently.

### Source file(s)

- `packages/core/src/teams/developer/orchestrator-content.ts` (lines 249-261)

### Key rules

- **Non-SDD tasks**:
  - Search memory for relevant context.
  - Pass context in agent prompt.
  - Agent saves discoveries/decisions before returning.
  - Orchestrator injects compact rules; agents do NOT read registry.
- **SDD phases**:
  - Each phase has explicit read/write rules.
  - Orchestrator passes artifact file paths, NOT content.
  - Apply reads tasks + spec + design + apply-progress.
  - Verify reads spec + tasks + apply-progress.
  - Archive reads all artifacts.

### Surfaces

- session: ✓
- agent: ✓
- skill: —

---

## 12. Adaptive Memory Protocol

### What it governs

How agents save and retrieve cross-session context via memory. Memory is auxiliary, never authoritative.

### Source file(s)

- `packages/core/src/teams/developer/instruction-bundles/adaptive-memory.ts`

### Key rules

- Memory adapter provides save/recall tools.
- **Container tags**: `u:` (user), `t:` (team), `o:` (org), `p:` (project).
- **Save triggers**: architecture decisions, bug fixes, non-obvious discoveries, config changes, patterns, preferences.
- **Save format**: What/Why/Where/Learned.
- **Authority rule**: OpenSpec artifacts are authoritative; memory is advisory.
- Never store invariants in memory — they must be source-controlled in core.

### Surfaces

- session: ✓
- agent: ✓
- skill: ✓

---

## 13. Codebase Memory Protocol

### What it governs

Structural code queries via knowledge graph. Provides function/class/route discovery and tracing.

### Source file(s)

- `packages/core/src/teams/developer/instruction-bundles/codebase-memory.ts`

### Key rules

- **Tool priority**:
  1. `search_graph` — find functions, classes, routes
  2. `trace_path` — trace callers/callees
  3. `get_code_snippet` — read source
  4. `query_graph` — Cypher queries
- **Fallback**: grep/glob only for string literals, non-code files, when graph insufficient.
- Graph schema: nodes (Project, Package, File, Module, Class, Function...) + edges (CALLS, IMPORTS, DEFINES...).
- Index repository with `index_repository` for fresh graph.

### Surfaces

- session: ✓
- agent: ✓
- skill: ✓

---

## 14. Context Authority Guidance

### What it governs

Hierarchy of what information is authoritative vs advisory. Injected at composition time.

### Source file(s)

- `packages/core/src/teams/developer/memory/adaptive-context-renderer.ts`

### Key rules

- **OFFICIAL CONTEXT**: OpenSpec artifacts, Spec Registry entries, code, tests.
- **ADAPTIVE CONTEXT**: Memory provider content — advisory only.
- OpenSpec/Workspace MUST NOT be overwritten or modified by memory.
- Guidance injected before capability instruction bundles.
- Rendered via `renderDeveloperTeamContextAuthorityGuidance()`.

### Surfaces

- session: —
- agent: ✓
- skill: ✓

---

## 15. Instruction Bundles

### What it governs

Composable package instructions from capability packages. Injected after context authority.

### Source file(s)

- `packages/core/src/teams/developer/instruction-bundles/index.ts`

### Key rules

- **Package order** (canonical): codebase-memory → context-mode → rtk → adaptive-memory.
- Packages: config-enabled set from `normalizedConfig.packageInstructions`.
- Composition in content registry appends bundles after context authority.
- Surface-specific: session, agent, skill.
- Bundle built via `buildCapabilityInstructionBundle()`.

### Surfaces

- session: ✓
- agent: ✓
- skill: ✓

---

## 16. Orchestrator Invariants (NEW)

### What it governs

Non-negotiable behavioral rules extracted from orchestrator content. Five critical-tier invariants.

### Source file(s)

- `packages/core/src/teams/developer/orchestrator-invariants.ts`

### Key rules

- **Five critical invariants**:
  - **INV-001**: Execution Mode Gate — ask Automatic vs Interactive on first SDD run.
  - **INV-002**: Pure Delegator — never execute specialist work.
  - **INV-003**: SDD Initialization Gate — check `openspec/config.yaml` before SDD work.
  - **INV-004**: SDD Triage Gate — classify request before execution mode.
  - **INV-005**: Registry-Deferred Parallelism — parallel agents write artifacts only; orchestrator serializes registry.
- **Surfaces**: session, agent, skill, manifest.
- **Verification**: `verifyOrchestratorInvariantPresence()` checks for presence by ID.
- **Tiers**: critical (P0), high (P1), standard (P2).

### Surfaces

- session: ✓
- agent: ✓
- skill: ✓
- manifest: ✓

---

## Related Documentation

- `docs/developer-team.md`: Agent roster, workflow graph, installation — does NOT duplicate this module inventory.
- `packages/core/src/teams/developer/orchestrator-invariants.ts`: Canonical invariant records.
- `packages/core/src/teams/developer/content-registry.ts`: Composition pipeline.

---

*Last updated: 2026-05-28*
