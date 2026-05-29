# Archive Report: redesign-supermemory-mcp-memory

## Change Summary

**Change**: redesign-supermemory-mcp-memory
**Status**: ✅ Archived
**Archive Location**: `openspec/archive/redesign-supermemory-mcp-memory/`

### Lifecycle
- **Proposal**: 2026-05-29 — Rediseñar Supermemory como memoria adaptativa MCP-only
- **Spec + Design**: 2026-05-29 — Paralelos, ambos completados tras repair
- **Tasks**: 2026-05-29 — 10 tasks originales + 32 repair tasks (R1-R32)
- **Apply**: 2026-05-30 — Múltiples waves completadas
- **Verify**: 2026-05-30 — PASS WITH WARNINGS
- **Review**: 2026-05-30 — APPROVE
- **Archive**: 2026-05-30 — ✅ Archived

## Traceability Matrix

| REQ-ID | Task | Implementation | Verify Result | Review Rating |
|---|---|---|---|---|
| REQ-SMO-001 | Task 1, R2 | ✅ MCP-only adapter con tools memory/recall/whoAmI | ✅ PASS | ✅ Strong |
| REQ-SMO-002 | Task 5, R4 | ✅ URL https://mcp.supermemory.ai/mcp | ✅ PASS | ✅ Strong |
| REQ-SMO-003 | Task 1, R2 | ✅ Sin REST fallback | ✅ PASS | ✅ Strong |
| REQ-SMO-005 | Task 5, R4 | ✅ Authorization Bearer env interpolation | ✅ PASS | ✅ Strong |
| REQ-SMO-006 | Task 6 | ✅ Validate tools via install | ✅ PASS | ✅ Strong |
| REQ-SPM-001 | R1, R2, R4 | ✅ Automatic scoping: token + x-sm-project | ✅ PASS | ✅ Strong |
| REQ-SPM-002 | R4 | ✅ x-sm-project header obligatorio | ✅ PASS | ✅ Strong |
| REQ-SPM-003 | R1, R2, R3 | ✅ User identity from token | ✅ PASS | ✅ Strong |
| REQ-SPM-004 | R3, R5 | ✅ TUI token-only, no userId/teamId/orgId | ✅ PASS | ✅ Strong |
| REQ-SPM-005 | R4 | ✅ deriveSmProjectIdentifier via git remote | ✅ PASS | ✅ Strong |
| REQ-SPM-006 | R1, R29, R30 | ✅ No container tags u:/p:/t:/o: | ✅ PASS | ✅ Strong |
| REQ-SPM-007 | R3 | ✅ TUI solo token | ✅ PASS | ✅ Strong |
| REQ-APS-001 | Task 3 | ✅ Provider selection from config | ✅ PASS | ✅ Strong |
| REQ-APS-002 | Task 3 | ✅ Launch accepts supermemory | ✅ PASS | ✅ Strong |
| REQ-APS-003 | Task 3 | ✅ Consistencia install/launch IDs | ✅ PASS | ✅ Strong |
| REQ-APS-004 | Task 3 | ✅ Fail-open implemented | ✅ PASS | ✅ Strong |
| REQ-APB-001 | Task 2, R1 | ✅ Tools memory/recall en prompts | ✅ PASS | ✅ Strong |
| REQ-APB-002 | Task 2, R1 | ✅ OFFICIAL/ADAPTIVE hierarchy | ✅ PASS | ✅ Strong |
| REQ-APB-003 | Task 2, R1 | ✅ Fail-open instruction | ✅ PASS | ✅ Strong |
| REQ-APB-005 | Task 2, R1 | ✅ No execute/search_docs | ✅ PASS | ✅ Strong |
| REQ-APB-006 | R1, R29, R30 | ✅ No container tag instructions | ✅ PASS | ✅ Strong |
| REQ-OMC-001 | Task 5, R4 | ✅ MCP config correct | ✅ PASS | ✅ Strong |
| REQ-OMC-002 | Task 5, R4 | ✅ Env interpolation | ✅ PASS | ✅ Strong |
| REQ-OMC-004 | verify_fix | ✅ URL validation accepts mcp.supermemory.ai/mcp | ✅ PASS | ✅ Strong |
| REQ-OMC-006 | R4 | ✅ x-sm-project always present | ✅ PASS | ✅ Strong |
| REQ-ASR-001 | Task 1 | ✅ MCP-only sin REST | ✅ PASS | ✅ Strong |
| REQ-ASR-002 | Task 1 | ✅ Sin searchMode | ✅ PASS | ✅ Strong |
| REQ-ASR-004 | R2 | ✅ No containerTag passthrough | ✅ PASS | ✅ Strong |
| REQ-EC-001 | Task 3 | ✅ Engram coexistente | ✅ PASS | ✅ Strong |
| REQ-EC-002 | Task 3 | ✅ Provider-neutral selection | ✅ PASS | ✅ Strong |
| REQ-R25 | R25 | ✅ Detect provider from MCP config | ✅ PASS | ✅ Strong |
| REQ-R26 | R26 | ✅ sm_project_ prefix (no p:) | ✅ PASS | ✅ Strong |
| REQ-R27 | R27 | ✅ Regex /[^a-z0-9_-]/g | ✅ PASS | ✅ Strong |
| REQ-R31 | R31 | ✅ Auto-inject bundle when provider active | ✅ PASS | ✅ Strong |
| REQ-R32 | R32 | ✅ Exact backticks, single heading | ✅ PASS | ✅ Strong |

Total REQs: 34+

## Verification

**Result**: PASS WITH WARNINGS
**Critical Findings**: 0
**Warnings**: 1 (global typecheck out-of-scope baseline)

## Review

**Rating**: APPROVE
**Blockers**: 0
**Major Findings**: 0

## Follow-ups

NONE — Change is fully closed.

> **Nota de follow-up para el usuario**: Durante el proceso de repair se descubrieron y corrigieron múltiples gaps de implementación entre el kontrakto original y las necesidades del mundo real. El cambio final es robusto con 537+ tests pasando. No hay tareas pendientes.

## Project AI Notes (Phase 5 — Deferred)

Project AI notes are a planned Phase 5 feature under `.deck/ai-notes/`. Not yet active.

### Extracted Learnings

- **Multiple repair cycles showed robustness**: El cambio requirió múltiples ciclos de repair (R1-R32 + hotfixes) debido a gaps de implementación heredados del diseño original. Esto demuestra la importancia de definir контракт clearly y validar incrementally.
- **Token-only model eliminates complexity**: El modelo final token-only (sin userId/teamId/orgId) simplifica significativamente el code y reduce surface área de errores. La decisión de cambiar de container tags a scoping automático fue correcta.
- **Provider detection from MCP config**: Detectar el provider activo desde la configuración MCP (en lugar de memoryBundle) previene leaks de prompts entre providers.

## Advisory Commit Messages

Dado que el usuario pidió NO executar git commit/push, 以下 son sugerencias advisory:

### Conventional Commit Suggestions

```
feat(memory): redesign Supermemory as MCP-only adaptive memory provider
- Removed REST fallback, added MCP-only adapter with memory/recall/whoAmI tools
- Updated URL to https://mcp.supermemory.ai/mcp
- Implemented token-only TUI (no userId/teamId/orgId)
- Automatic scoping via token (user) and x-sm-project header (project)
- No manual container tags u:/p:/t:/o:
- Provider detection from MCP config
- Fail-open diagnostics
```

**Tipo**: `feat` (nueva funcionalidad mayor)
**Scope areas**: `packages/adapter-supermemory`, `packages/adapter-opencode`, `packages/core`, `apps/cli`

### Alternativas (si aplica)

- `refactor(memory)`: Si considera que es refactorización del existente
- `fix(memory)`: Si considera que es fix de bugs anteriores

### PR Title/Body Sugerido

**PR Title**: `feat(memory): redesign Supermemory as MCP-only adaptive memory provider`

**PR Body**:

```markdown
## Summary

Redesigns Supermemory as an MCP-only adaptive memory provider for Deck/OpenCode,
eliminating the previous REST-based integration and container tag model.

## Changes

- **Adapter**: Rewrote to MCP-only with tools `memory`, `recall`, `whoAmI`
- **Config**: Updated URL to `https://mcp.supermemory.ai/mcp`
- **TUI**: Simplified to token-only (no userId/teamId/orgId)
- **Scoping**: Automatic via token (user) and `x-sm-project` header (project)
- **Prompts**: Removed container tag instructions, added fail-open
- **Provider selection**: Now derives from MCP config

## Tests

537+ tests passing across developer components.

## Breaking Changes

- TUI no longer asks for userId/teamId/orgId
- Adapter no longer passes containerTag to MCP tools

See `openspec/changes/redesign-supermemory-mcp-memory/` for full traceability.
```

---

**Archive completed**: 2026-05-30
**Artifacts moved to**: `openspec/archive/redesign-supermemory-mcp-memory/`