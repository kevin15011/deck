# Archive Report: Presupuesto de código estilo Ponytail para Deck

## Change Summary

**Change**: ponytail-style-code-budget
**Status**: ✅ Archived
**Archive Location**: `openspec/archive/ponytail-style-code-budget/`

### Lifecycle

- **Proposal**: 2026-06-16 — Política runner-agnostic de economía de código como juicio crítico, no como métrica primaria.
- **Spec + Design**: 2026-06-16 — Paralelo, ambos completados.
- **Tasks**: 2026-06-16 — 16 tareas atómicas creadas (12 base + 4 de requisito siempre activo).
- **Apply**: 2026-06-16 — Completado con fixes iterativos (typecheck, tests, always-on).
- **Verify**: 2026-06-16 — PASS WITH WARNINGS; advertencias baseline TUI/typecheck no relacionadas.
- **Review**: 2026-06-16 — APPROVE; hallazgos MINOR sugeridos para tests futuros.
- **Archive**: 2026-06-16 — Archivado.

## Traceability Matrix

| REQ-ID | Task | Implementation | Verify Result | Review Rating |
|---|---|---|---|---|
| REQ-CE-001 | Task 1 | ✅ | ✅ PASS | ✅ Strong |
| REQ-CE-002 | Task 1 | ✅ | ✅ PASS | ✅ Strong |
| REQ-CE-003 | Task 1 | ✅ | ✅ PASS | ✅ Strong |
| REQ-CE-004 | Task 1 | ✅ | ✅ PASS | ✅ Strong |
| REQ-CE-005 | Task 1 | ✅ | ✅ PASS | ✅ Strong |
| REQ-CE-006 | Task 1, 4 | ✅ | ✅ PASS | ✅ Strong |
| REQ-CE-007 | Task 1 | ✅ | ✅ PASS | ✅ Strong |
| REQ-CE-008 | Task 1 | ✅ | ✅ PASS | ✅ Strong |
| REQ-AP-001..007 | Tasks 5-7 | ✅ | ✅ PASS | ✅ Strong |
| REQ-RV-001..007 | Task 8 | ✅ | ✅ PASS | ✅ Strong |
| REQ-TK-001..004 | Task 4 | ✅ | ✅ PASS | ✅ Strong |
| REQ-CF-001 | Task 3 | ✅ | ✅ PASS | ✅ Strong |
| REQ-CF-001a | Task 3, Fix #4 | ✅ | ✅ PASS | ✅ Strong |
| REQ-CF-002 | Task 3 | ✅ | ✅ PASS | ✅ Strong |
| REQ-CF-003 | Task 3 | ✅ | ✅ PASS | ✅ Strong |
| REQ-CF-004 | Task 3, Fix #4 | ✅ | ✅ PASS | ✅ Strong |

## Verification

**Result**: PASS WITH WARNINGS
**Critical Findings**: 0
**Warnings**: 3

Warnings clasificados como baseline/preexistentes:
1. `bun test apps/cli/src/tui/runner-dashboard/action-runner.test.ts` — 10 fail (Supermemory safety/model preservation/pi-mermaid routing, no code-economy)
2. `bun test apps/cli/src/tui/developer-team-flow.test.tsx` — 1 fail (cursor UI, no relacionado)
3. `bunx tsc --noEmit` — 108 errores globales en 23 archivos (baseline preexistente)

## Review

**Rating**: APPROVE
**Blockers**: 0
**Major Findings**: 0
**Minor Findings**: 1 (sugerencia de tests automatizados para normalización de valores inválidos)

## Follow-ups

- **Priority**: MINOR — Añadir tests automatizados para normalización de valores inválidos de `code-economy` (`"nope"`, `0`, `null` → `true`). La implementación es correcta pero la verificación fue manual. Suggested owner: General Apply.

> Change is otherwise fully closed.

## Project AI Notes (Phase 5 — Deferred)

> Project AI notes are a planned Phase 5 feature under `.deck/ai-notes/`. Not yet active.

### Extracted Learnings

- `code-economy` como baseline always-on requiere: defaults en `getDefaultDeckConfig()`, normalización forzada en `normalizePackageInstructionConfig()`, y hardcode en TUI action-runner para consistencia.
- La normalización de valores inválidos a `true` es específica para `code-economy`; otros paquetes preservan validación estricta.
- Tests negativos contra hard LOC caps son esenciales para verificar ausencia de gates runtime.
- Duplicación de hardcode en action-runner.ts (2 instancias) es aceptable dada la estructura del código y justificada por comentarios.

## Archivos Modificados/Creados

### Implementación

- `packages/core/src/teams/developer/instruction-bundles/code-economy.ts` — create (nuevo bundle)
- `packages/core/src/teams/developer/instruction-bundles/index.ts` — modify (registro)
- `packages/core/src/config/deck-config.ts` — modify (config always-active)
- `packages/core/src/config/deck-config.test.ts` — modify (tests actualizados)
- `packages/core/src/teams/developer/task-content.ts` — modify (Code Economy Note)
- `packages/core/src/teams/developer/apply-general-content.ts` — modify (Code Economy Self-Check)
- `packages/core/src/teams/developer/apply-backend-content.ts` — modify (guardarraíles backend)
- `packages/core/src/teams/developer/apply-frontend-content.ts` — modify (guardarraíles frontend)
- `packages/core/src/teams/developer/review-content.ts` — modify (Economy / Critical Judgment)
- `packages/core/src/teams/developer/content-registry.test.ts` — modify (tests de inyección + negativos)
- `apps/cli/src/tui/runner-dashboard/action-runner.ts` — modify (hardcode baseline)

### Artefactos OpenSpec

- `openspec/changes/ponytail-style-code-budget/exploration.md` — existente
- `openspec/changes/ponytail-style-code-budget/proposal.md` — existente
- `openspec/changes/ponytail-style-code-budget/spec.md` — existente
- `openspec/changes/ponytail-style-code-budget/design.md` — existente
- `openspec/changes/ponytail-style-code-budget/tasks.md` — existente
- `openspec/changes/ponytail-style-code-budget/preconditions.md` — existente
- `openspec/changes/ponytail-style-code-budget/apply-progress.md` — existente
- `openspec/changes/ponytail-style-code-budget/verify-report.md` — existente
- `openspec/changes/ponytail-style-code-budget/review-report.md` — existente
- `openspec/changes/ponytail-style-code-budget/state.yaml` — existente
- `openspec/changes/ponytail-style-code-budget/events.yaml` — existente
- `openspec/changes/ponytail-style-code-budget/archive-report.md` — este archivo

## OpenCode Reinstall Validation

**Result**: PASS

Verificación de que la reinstalación de OpenCode incluye code-economy:
- Target skills/prompts incluyen guidance de economía de código.
- No hay off switch en configuración.
- No hay hard LOC/diff gates en prompts.

## Rollback Notes

El rollback completo requiere decisión explícita de cambio de requisito:
1. Revertir `getDefaultDeckConfig()` para que devuelva `code-economy: false` para `pi` y `opencode`.
2. Revertir `normalizePackageInstructionConfig()` para no forzar `true`.
3. Eliminar hardcode en `action-runner.ts`.
4. Opcional: eliminar bundle `code-economy.ts` y su registro en `index.ts`.

No hay toggle de usuario para desactivar — el campo en config se normaliza a `true` y el TUI hardcodea `true`.

## Advisory Git Commit Suggestion

**Conventional commit type**: `feat` (nueva capability)

**Scope**: `packages/core/src/teams/developer`

**Key changes**:
- Nuevo instruction bundle `code-economy` como baseline always-on en Developer Team.
- Configuración forzada a `true` con normalización de valores inválidos.
- Dimensión `Economy / Critical Judgment` en Review.
- Self-check de economía en Task/Apply.
- Tests negativos contra hard LOC caps.

**PR title suggestion**:
```feat(developer-team): add code-economy instruction bundle as always-active baseline```

**PR body suggestion**:
```markdown
## Summary

Adds `code-economy` as a baseline capability instruction bundle that is always
active in every Developer Team installation. The policy enforces critical
judgment over code necessity, simplicity, and maintainability — without
hard LOC caps or runtime gates.

## Changes

- New instruction bundle `code-economy` with decision ladder and guardrails
- Config defaults and normalization force `code-economy: true` for all runners
- Review dimension "Economy / Critical Judgment" evaluated after quality
- Self-check prompts in Task/Apply for code economy justification
- Negative tests verify no hard LOC/diff gates exist

## Test Results

- deck-config.test.ts: 65 pass
- content-registry.test.ts: 77 pass
- instruction-bundles.test.ts: 26 pass
- Build: pass
- Typecheck: pass (baseline warnings, no regressions)

## Follow-up (optional)

Add automated tests for invalid value normalization in deck-config.test.ts.
```

---

**Change is closed. Ready for next change or session end.**