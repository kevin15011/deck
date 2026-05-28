# Archive Report: Sincronizar skills OpenCode desde el instalador

## Change Summary

**Change**: installer-sync-opencode-skills
**Status**: ✅ Archived
**Archive Location**: `openspec/changes/installer-sync-opencode-skills/`

### Lifecycle

- **Proposal**: 2026-05-28 — Proposal to make OpenCode installer synchronize deck-developer-orchestrator SKILL.md from source and prevent prompt/skill drift
- **Spec + Design**: 2026-05-28 — parallel, both completed
- **Tasks**: 2026-05-28 — 4 tasks created
- **Apply**: 2026-05-28 — All 4 tasks completed
- **Verify**: 2026-05-28 — PASS WITH WARNINGS
- **Review**: 2026-05-28 — APPROVED
- **Archive**: 2026-05-28 — archived

## Traceability Matrix

| REQ-ID | Task | Implementation | Verify Result | Review Rating |
|---|---|---|---|---|
| REQ-INST-001 | Task 1 | ✅ | ⚠️ WARN | ✅ |
| REQ-INST-002 | Task 2 | ✅ | ✅ | ✅ |
| REQ-INST-003 | Task 2 | ✅ | ⚠️ WARN | ✅ |
| REQ-INST-004 | Task 2 | ✅ | ✅ | ✅ |
| REQ-INST-005 | Task 2 | ✅ | ✅ | ✅ |
| REQ-INST-006 | Task 1 | ✅ | ✅ | ✅ |
| REQ-VAL-001 | Task 3 | ✅ | ✅ | ✅ |
| REQ-VAL-002 | Task 3 | ✅ | ✅ | ✅ |
| REQ-VAL-003 | Task 3 | ✅ | ✅ | ✅ |
| REQ-VAL-004 | Task 3 | ✅ | ✅ | ✅ |

## Verification

**Result**: PASS WITH WARNINGS
**Critical Findings**: 0
**Warnings**: 3

- Typecheck baseline failures (unrelated to change)
- Missing explicit test for absent canonical source variant
- Idempotency test does not assert mtime

## Review

**Rating**: APPROVED
**Blockers**: 0
**Major Findings**: 0
**Minor Findings**: 2

1. Missing explicit test for REQ-INST-001 variant (absent canonical source)
2. Dead initialMtimes Map in idempotency test

## Follow-ups

- **Medium**: Address remaining minor findings (dead code, missing test) — General Apply en siguiente sesión

## Files Changed

| File | Action |
|---|---|
| `packages/adapter-opencode/src/developer-team-install.ts` | modify |
| `packages/adapter-opencode/src/developer-team-install.test.ts` | modify |

## Tests Run/Results

| Suite | Pass | Fail |
|---|---|---|
| `developer-team-install.test.ts` | 55 | 0 |
| `prompt-generation.test.ts` | 20 | 0 |
| `orchestrator-content.test.ts` | 56 | 0 |

## Known Warnings/Minors

- Typecheck baseline failures pre-existentes a este cambio
- Test explícito para fuente canónica ausente pendiente
- Código muerto (Map de mtimes sin usar) en test de idempotencia

## Rollback Plan

Para revertir:

1. Revertir cambios en `packages/adapter-opencode/src/developer-team-install.ts` y `packages/adapter-opencode/src/developer-team-install.test.ts`
2. Re-ejecutar instalador OpenCode anterior si es necesario restaurar comportamiento previo

## Advisory Note

⚠️ **No editar manualmente archivos globales `~/.config/opencode`** como solución al drift. El instalador es el responsable de la sincronización. Si el usuario tiene drift tras actualizar, debe:

1. Commit/Reinstalar: `git pull` + reinstall o re-ejecutar el instalador Deck
2. Restart: Reiniciar OpenCode (`opencode restart` o restart del IDE/CLI)

El hotfix manual es estado temporal — el instalador converge al contenido correcto al re-ejecutarse.

## Project AI Notes (Phase 5 — Deferred)

> Project AI notes are a planned Phase 5 feature under `.deck/ai-notes/`. Not yet active.

### Extracted Learnings

- La fuente canónica definitiva del skill es `orchestrator-content.ts` vía `content-registry.getAgentContent()`
- El verify endurecido (exact-match) es suficiente para detectar drift
- Los tests CI-compatibles usan `configDir` temporal — no requieren `~/.config/opencode`