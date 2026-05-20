## Spec Created

**Change**: optimize-sdd-v2-core-implementation
**Artifact Path**: `openspec/changes/optimize-sdd-v2-core-implementation/spec.md`
**Registry State Path**: `openspec/changes/optimize-sdd-v2-core-implementation/state.yaml`
**Registry Events Path**: `openspec/changes/optimize-sdd-v2-core-implementation/events.yaml`
**Registry Write**: deferred
**Registry Recorded**: not written (deferred)
**Registry Intent**: artifact `spec.md`, phase `spec`, status `completed`, event `spec.completed`
**Registry Blocker**: none

### Summary
- **Capabilities Specified**: 7 capabilities
- **Total Requirements**: 27 requirements (21 MUST, 4 SHOULD, 0 MAY)
- **Acceptance Scenarios**: 17 scenarios (with variants)
- **Open Questions**: 6 questions remaining

### Key Requirements
- REQ-APPLY-001: No one-task-one-agent default for related tasks (MUST)
- REQ-APPLY-002: Group related Apply work by owner/context (MUST)
- REQ-APPLY-003: Multi-agent Apply only when independent (MUST)
- REQ-APPLY-004: Dependency-aware Apply ordering (MUST)
- REQ-APPLY-005: Task groups as primary batching source (SHOULD)
- REQ-GIT-001: Advisory commit suggestions after Archive (MUST)
- REQ-GIT-002: No automatic Git mutation (MUST)
- REQ-GIT-003: Optional PR title/body suggestions (SHOULD)
- REQ-GIT-004: Label ambiguous commit suggestions (SHOULD)
- REQ-TRIAGE-001: Explorer-before-Proposal for broad-impact changes (MUST)
- REQ-TRIAGE-002: Internal workflow changes are triage-eligible (MUST)
- REQ-DELEGATION-001: Role-based delegation outside SDD (MUST)
- REQ-DELEGATION-002: SDD sequence stays authoritative (MUST)
- REQ-VERIFY-001: Self-verify artifact on disk (MUST)
- REQ-VERIFY-002: Verify registry in non-deferred mode (MUST)
- REQ-VERIFY-003: Return intent in deferred mode (MUST)
- REQ-VERIFY-004: Orchestrator gates phase advancement (MUST)
- REQ-VERIFY-005: Completion evidence format (SHOULD)
- REQ-CONFIG-001: Use registered config by default (MUST)
- REQ-CONFIG-002: No undocumented overrides (MUST)
- REQ-CONFIG-003: Identify override basis (SHOULD)
- REQ-MERMAID-001: Mermaid in phase summaries (MUST)
- REQ-MERMAID-002: Agents provide diagram source/data (SHOULD)
- REQ-MERMAID-003: Diagrams are non-authoritative (MUST)
- REQ-MERMAID-004: Runner-agnostic fenced source (MUST)
- REQ-MERMAID-005: Reconcile conflicting Mermaid guidance (MUST)

### Source File Map (v2 update from prior spec)

| Need | Primary Source | Files |
|---|---|---|
| 1. Apply batching | `orchestrator-content.ts` | Apply Routing section |
| 2. Post-Archive Git | `orchestrator-content.ts` + `archive-content.ts` | Post-Archive section + ARCHIVE_SKILL_BODY |
| 3. Explorer triage | `orchestrator-content.ts` | SDD Triage Gate section |
| 4. Role delegation | `orchestrator-content.ts` | Delegation Rules section |
| 5. Persistence hardening | `orchestrator-content.ts` + all phase `*-content.ts` + possibly `artifact-state-manager.ts` | Persistence Policy + per-phase self-verification |
| 6. Config respect | `orchestrator-content.ts` | Agent Launch/Delegation Guidance |
| 7. Mermaid summaries | `visual-explanations-content.ts` + `orchestrator-content.ts` + `proposal-content.ts` + `spec-content.ts` + `design-content.ts` + `task-content.ts` | VISUAL_EXPLANATIONS_SKILL_FRAGMENT + summary guidance + phase return contracts |

### Self-Verification Evidence
- Artifact path: `openspec/changes/optimize-sdd-v2-core-implementation/spec.md`
- exists=true
- Byte count: 32197
- Registry mode: deferred (parallel with Design)

### Next Step
Ready for Design (`deck-developer-design`) and Task (`deck-developer-task`) consumption.