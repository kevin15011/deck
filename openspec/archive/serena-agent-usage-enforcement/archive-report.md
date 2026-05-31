# Archive Report: Serena Agent Usage Enforcement

## Change Summary

**Change**: serena-agent-usage-enforcement
**Status**: ✅ Archived
**Archive Location**: `openspec/archive/serena-agent-usage-enforcement/`

### Lifecycle
- **Proposal**: 2026-05-30 — Propagar capacidades Serena a subagentes
- **Spec + Design**: 2026-05-30 — Ambos completados
- **Tasks**: 2026-05-30 — 8 tareas (original), 2026-05-31 — 11 tareas (enmienda #2)
- **Apply**: 2026-05-31 — 11 tareas completadas
- **Verify**: 2026-05-31 — PASS (216/216 tests)
- **Review**: 2026-05-31 — APPROVE (86 pass, 0 fail)
- **Archive**: 2026-05-31 — archived

## Traceability Matrix

| REQ-ID | Task | Implementation | Verify Result | Review Rating |
|---|---|---|---|---|
| REQ-SCP-001 | Task 9-10 | ✅ | ✅ PASS | ✅ Strong |
| REQ-SCP-002 | Task 12 | ✅ | ✅ PASS | ✅ Strong |
| REQ-SCP-005 | Task 11 | ✅ | ✅ PASS | ✅ Strong |
| REQ-STC-001 | Task 10 | ✅ | ✅ PASS | ✅ Strong |
| REQ-STC-002 | Task 12 | ✅ | ✅ PASS | ✅ Strong |
| REQ-STC-003 | Task 14 | ✅ | ✅ PASS | ✅ Strong |
| REQ-STC-004 | Task 14 | ✅ | ✅ PASS | ✅ Strong |
| REQ-SROP-001 | Task 14 | ✅ | ✅ PASS | ✅ Strong |
| REQ-SROP-004 | Task 12 | ✅ | ✅ PASS | ✅ Strong |
| REQ-SROP-005 | Task 12 | ✅ | ✅ PASS | ✅ Strong |
| REQ-SAE-001 | Task 13 | ✅ | ✅ PASS | ✅ Strong |
| REQ-SAE-006 | Task 14 | ✅ | ✅ PASS | ✅ Strong |
| REQ-OSDG-001 | Task 11 | ✅ | ✅ PASS | ✅ Strong |
| REQ-OSDG-005 | Task 11 | ✅ | ✅ PASS | ✅ Strong |
| REQ-DTI-001 | Task 14 | ✅ | ✅ PASS | ✅ Strong |
| REQ-DTI-002 | Task 14 | ✅ | ✅ PASS | ✅ Strong |
| REQ-DPG-001 | Task 15 | ✅ | ✅ PASS | ✅ Strong |
| REQ-DPG-003 | Task 15 | ✅ | ✅ PASS | ✅ Strong |
| REQ-NFR-001 | Tasks 16-17 | ✅ | ✅ PASS | ✅ Strong |
| REQ-NFR-003 | Task 12 | ✅ | ✅ PASS | ✅ Strong |

## Verification

**Result**: PASS
**Critical Findings**: 0
**Warnings**: 0

## Review

**Rating**: APPROVE
**Blockers**: 0
**Major Findings**: 0

## Follow-ups

None — change is fully closed.

## Project AI Notes (Phase 5 — Deferred)

> Project AI notes are a planned Phase 5 feature under `.deck/ai-notes/`. Not yet active.

### Extracted Learnings

- **Role-based tool scoping**: La separación readOnlyTools/writeTools por rol de agente es el patrón correcto para seguridad. Apply agents reciben todas; non-apply reciben solo read-only.
- **Session fragment guidance**: El fragmento `surface: "session"` sin `agentIds` filter es necesario para que el Orchestrator reciba delegation guidance.
- **Install-time vs runtime**: Las instrucciones no deben contener condiciones "if selected" — la selección ocurre en install-time, no runtime.
- **Policy as source of truth**: Los tests deben consumir la policy como fuente de verdad, no hardcoded counts.

## Files Changed Summary

| File | Action |
|------|--------|
| `packages/core/src/teams/developer/instruction-bundles/index.ts` | modify |
| `packages/core/src/teams/developer/instruction-bundles/serena.ts` | modify |
| `packages/adapter-opencode/src/developer-team-install.ts` | modify |
| `packages/adapter-opencode/src/developer-team-install.test.ts` | modify |
| `packages/core/src/teams/developer/instruction-bundles/serena.test.ts` | modify |
| `packages/core/src/teams/developer/instruction-bundles/index.test.ts` | modify |
| `packages/core/src/teams/developer/apply-backend-content.ts` | modify |
| `packages/core/src/teams/developer/apply-frontend-content.ts` | modify |
| `packages/core/src/teams/developer/apply-general-content.ts` | modify |

## Git Suggestion Context

- **Conventional commit type**: feat
- **Scope**: developer-team, serena-integration
- **Key changes**:
  - Agregar role-based tool scoping (read-only vs write-capable) para subagentes
  - Session fragment de delegation guidance para Orchestrator
  - Dynamic tool resolution en adapter por rol de agente
  - Tests de paridad policy vs guidance
- **Ambiguity notes**: Ninguna — el cambio es netamente una feature de integración

## Advisory Commit Message

```
feat(developer-team): agregar role-based Serena tool scoping para subagentes

- Agregar readOnlyTools/writeTools separados en CapabilityToolPolicy
- Agregar session fragment para Orchestrator delegation guidance
- Non-apply agents reciben solo read-only tools
- Apply agents reciben todas las herramientas (read + write)
- Tests de paridad policy vs guidance
```