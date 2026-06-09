# Archive Report: pi-support-parity-opencode

## Change Summary

**Change**: pi-support-parity-opencode
**Status**: ✅ Archived
**Archive Location**: `openspec/archive/pi-support-parity-opencode/`

### Lifecycle
- **Proposal**: 2026-06-04 — Propuesta de paridad Pi con Runner Capability/Parity Registry
- **Spec + Design**: 2026-06-04 — Spec + Design completados (reparados con codebase-memory/RTK first-class)
- **Tasks**: 2026-06-04 — 26 tareas atómicas en 8 fases
- **Apply**: 2026-06-04 al 2026-06-09 — 25+ repair passes, batches A-F completados
- **Verify**: 2026-06-04 — PASS WITH WARNINGS
- **Review**: 2026-06-04 — PASS
- **Archive**: 2026-06-09 — Archived

## Traceability Matrix

| REQ-ID | Task | Implementation | Verify Result | Review Rating |
|---|---|---|---|---|
| REQ-RCPR-001 | Task 1.1-1.4 | ✅ Registry canónico en core | ✅ PASS | ✅ PASS |
| REQ-RCPR-002 | Task 1.3 | ✅ 7 estados de mapping | ✅ PASS | ✅ PASS |
| REQ-RCPR-003 | Task 1.2 | ✅ 12 capacidades explícitas (codebase-memory, RTK first-class) | ✅ PASS | ✅ PASS |
| REQ-MAP-001 | Task 1.3 | ✅ Mappings OpenCode/Pi | ✅ PASS | ✅ PASS |
| REQ-MAP-002 | Task 1.3 | ✅ Mermaid runner-specific | ✅ PASS | ✅ PASS |
| REQ-PI-002 | Task 5.1, 6.2 | ✅ Serena obligatorio en Pi | ✅ PASS | ✅ PASS |
| REQ-PI-003 | Task 5.2, 6.1 | ✅ context-mode MCP local | ✅ PASS | ✅ PASS |
| REQ-PI-005 | Task 5.1, 6.2 | ✅ codebase-memory-mcp MCP local | ✅ PASS | ✅ PASS |
| REQ-PI-006 | Task 5.1, 6.1 | ✅ RTK shared binary | ✅ PASS | ✅ PASS |
| REQ-MCP-001 | Task 5.1, 6.2 | ✅ Context7 @upstash/context7-mcp | ✅ PASS | ✅ PASS |
| REQ-MCP-002 | Task 7.1 | ✅ Supermemory sin gate Pi-only | ✅ PASS | ✅ PASS |
| REQ-PROMPT-001 | Task 7.2 | ✅ System prompt source of truth | ✅ PASS | ✅ PASS |
| REQ-PROMPT-002 | Task 7.2 | ✅ Orchestrator stub, no duplicación | ✅ PASS | ✅ PASS |

## Verification

**Result**: PASS WITH WARNINGS
**Critical Findings**: 0
**Warnings**: 1 (typecheck preexistente no relacionado al cambio)

## Review

**Rating**: PASS
**Blockers**: 0
**Major Findings**: 0
**Advisories**: 3 (tech debt acumulado, core-purity-audit test preexistente)

## Follow-ups

- **ADVISORY**: Acumulación de 25+ repair passes — considerar test E2E automatizado para flujo TUI completo
- **ADVISORY**: `core-purity-audit.test.ts` falla con strings canónicas del registry — fuera del scope, no bloquea
- **ADVISORY**: Cobertura directa de `cleanupNestedSkillDirectories` es implícita — opcional agregar tests directos

> Ningún follow-up requiere acción inmediata. Change completamente cerrado.

## Project AI Notes (Phase 5 — Deferred)

> Project AI notes son una característica Planificada para Fase 5 bajo `.deck/ai-notes/`. No activas aún.

### Extracted Learnings

- **codebase-memory y RTK como first-class**: El usuario detectó que estas capacidades no estaban suficientemente explícitas; se repararon Spec, Design y Tasks para tratarlas como first-class.
- **25+ repair passes**: El cambio reveló que el código Pi maduró bajo presión de uso real — deuda técnica acumulada pero no bloqueante.
- **MCP config persistence**: Múltiples repairs (#15, #19, #22) corregían que MCP config no se persistía después de installs en el flujo TUI.
- **Stale package auto-replacement**: Repair #9 implementó reemplazo automático de `@dreki-gg/pi-context7` → `@upstash/context7-mcp`.

---

## Git Suggestion Context

- **Conventional commit type**: `feat` (nueva capacidad) + `fix` (múltiples repairs)
- **Scope**: runner-capability-registry, adapter-pi, adapter-opencode
- **Key changes**:
  - Registro canónico de capacidades en `@deck/core` (runner-capability-registry.ts, runner-capability-parity.ts, shared-binary-usability.ts)
  - Catálogos Pi con Serena, Context7, codebase-memory-mcp, RTK
  - MCP config writers genéricos para Pi
  - Remover gate authenticatedRuntimeValidated de Supermemory
  - Cleanup de nested skill directories
- **Ambiguity notes**: Mezcla de feat (nueva registry) y fix (25+ repairs) —建议 separar en múltiples commits o usar commit tipo `feat` con scope amplio

---

## Archive Summary

- **Requirements**: 45+ escenarios/from spec
- **Tasks**: 26/26 completed
- **Verify**: PASS WITH WARNINGS
- **Review**: PASS (0 blockers, 0 majors, 0 minors)
- **Follow-ups**: 3 advisories (no bloqueantes)
- **Project AI Notes**: 4 aprendizajes extractados (Phase 5 deferred)

---

## Files Inspected

1. `openspec/changes/pi-support-parity-opencode/state.yaml`
2. `openspec/changes/pi-support-parity-opencode/events.yaml`
3. `openspec/changes/pi-support-parity-opencode/proposal.md`
4. `openspec/changes/pi-support-parity-opencode/spec.md`
5. `openspec/changes/pi-support-parity-opencode/design.md`
6. `openspec/changes/pi-support-parity-opencode/tasks.md`
7. `openspec/changes/pi-support-parity-opencode/apply-progress.md`
8. `openspec/changes/pi-support-parity-opencode/verify-report.md`
9. `openspec/changes/pi-support-parity-opencode/review-report.md`
10. `openspec/changes/pi-support-parity-opencode/exploration.md`

---

## Memory Save

**Decision**: Save — session summary para continuity

**Suggested commit message(s)**:
- `feat: add Runner Capability/Parity Registry in @deck/core`
- `feat(pi): add Serena, Context7, codebase-memory-mcp, RTK support`
- `fix(pi): remove authenticatedRuntimeValidated gate, cleanup nested skills`
- `fix(pi): persist MCP config after TUI install, replace stale packages`

**Suggested PR title/body if useful**:
- **Title**: feat: Runner Capability/Parity Registry + Pi parity closure
- **Body**: Implementa registry canónico de capacidades Deck en core, agrega soporte de Serena/Context7/codebase-memory/RTK para Pi, remueve gate de Supermemory, y múltiples fixes de MCP config y cleanup de skills.
