# Archive Report: Capacidad híbrida de reasoning effort por modelo

## Change Summary

**Change**: model-reasoning-effort-capability
**Status**: ✅ Archived
**Archive Location**: `openspec/archive/model-reasoning-effort-capability/`

### Lifecycle
- **Proposal**: 2026-06-04 — Propuesta de fuente híbrida runner > catálogo > unknown
- **Spec + Design**: 2026-06-04 — Paralelo, ambos completados
- **Tasks**: 2026-06-04 — 9 tareas creadas (T1-T9)
- **Apply**: 2026-06-04 — 9 tareas completadas + 4 fixes post-verify
- **Verify**: 2026-06-04 — PASS WITH WARNINGS
- **Review**: 2026-06-04 — APPROVE
- **Archive**: 2026-06-04 — archived

## Traceability Matrix

| REQ-ID | Task | Implementation | Verify Result | Review Rating |
|---|---|---|---|---|
| REQ-MRE-001 | T1-T2 | ✅ Core resolver híbrido runner>catalog>unknown | ✅ PASS | ✅ Strong |
| REQ-MRE-002 | T1-T2 | ✅ Runner true gana a catálogo false | ✅ PASS | ✅ Strong |
| REQ-MRE-003 | T1-T2 | ✅ Runner false gana a catálogo true | ✅ PASS | ✅ Strong |
| REQ-MRE-004 | T1-T2 | ✅ Fallback a catálogo | ✅ PASS | ✅ Strong |
| REQ-MRE-005 | T1-T2, T7-T8 | ✅ Unknown = sin reasoning | ✅ PASS | ✅ Strong |
| REQ-MRE-006 | T1-T2 | ✅ null/undefined no cuentan | ✅ PASS | ✅ Strong |
| REQ-OMC-001 | T3-T4 | ✅ Solo escribe effort con soporte | ✅ PASS | ✅ Strong |
| REQ-OMC-002 | T4 | ✅ Limpia effort inválido | ✅ PASS | ✅ Strong |
| REQ-OMC-003 | T4 | ✅ Cleanup idempotente | ✅ PASS | ✅ Strong |
| REQ-OMC-004 | T4 | ✅ Solo entradas Deck | ✅ PASS | ✅ Strong |
| REQ-OMC-005 | T4 | ✅ Sin modelo no effort | ✅ PASS | ✅ Strong |
| REQ-OMC-006 | T4 | ✅ Preserva effort válido | ✅ PASS | ✅ Strong |
| REQ-TUI-001 | T7-T8 | ✅ Selector solo modelos compatibles | ✅ PASS | ✅ Strong |
| REQ-TUI-002 | T7 | ✅ Limpia stale en hidratación | ✅ PASS | ✅ Strong |
| REQ-TUI-003 | T8 | ✅ Oculta hint para unsupported | ✅ PASS | ✅ Strong |
| REQ-TUI-004 | T8 | ✅ Sin copy extra "unsupported" | ✅ PASS | ✅ Strong |
| REQ-TUI-005 | T8 | ✅ Modelos compatibles preservados | ✅ PASS | ✅ Strong |
| REQ-PI-001 | T6 | ✅ Workaround Pi preservado | ✅ PASS | ✅ Strong |
| REQ-PI-002 | T6 | ✅ Anti-regresión intacta | ✅ PASS | ✅ Strong |
| REQ-EXPL-001 | T3-T4 | ✅ Sin presets implícitos | ✅ PASS | ✅ Strong |
| REQ-EXPL-002 | T3-T4 | ✅ "off" no persiste | ✅ PASS | ✅ Strong |

## Verification

**Result**: PASS WITH WARNINGS
**Critical Findings**: 0
**Warnings**: 4 (pre-existing repository-level debt)
- Global typecheck mantiene ~250 errores no relacionados a este cambio
- Full test suite tiene 50 fallas preexistentes (Supermemory, Pi, runtime, skills)
- 1 test preexistente falla en PersonalitySelectionScreen
- T5 desvío: helper getRunnerReasoningCapabilityByModel no implementado (capabilityMap ya soportado)

## Review

**Rating**: APPROVE
**Blockers**: 0
**Major Findings**: 0 (todos resueltos)
**Minor Findings**: 3 (no bloqueantes)
- ReasoningCapabilityMap naming (Record vs Map)
- projectRoot "" vs undefined en adapters
- Typecheck gaps en mock de test (PathLike vs string)

## Follow-ups

- **LOW**: Renombrar `ReasoningCapabilityMap` a `ReasoningCapabilityByModel` — sugirido por Review MINOR
- **LOW**: Usar `readModelAssignments()` sin argumento vs "" — MINOR documentado
- **LOW**: Corregir mock signatures en model-config.test.ts líneas 287, 309 — MINOR typecheck gap

> Ninguno bloquea el cierre del cambio.

## Project AI Notes (Phase 5 — Deferred)

> Project AI notes son una característica planeada para Phase 5 bajo `.deck/ai-notes/`. No activas aún.

### Extracted Learnings

- El resolver híbrido runner>catalog>unknown funciona correctamente como fuente de capacidad de reasoning.
- El cleanup de reasoningEffort es idempotente cuando se limita a entradas `deck-developer-*`.
- Unificar el check de soporte entre OpenCode y Pi en la TUI reduce código duplicado.
- El contrato explicit-only se preserva: sin modelo explícito no se escribe reasoningEffort.
- La TUI debe ocultar reasoning para modelos sin soporte confirmado, sin copy extra.

> No hay nueva información que requiera actualización de AI notes existente.

## Diff Context / Git Advisory

### Conventional Commit Type
- **Tipo**: `feat` (nueva funcionalidad de capacidad híbrida de reasoning)
- **Scope**: `model-reasoning`, `adapter-opencode`, `tui`

### Archivos Modificados Clave
- `packages/core/src/model-reasoning-capability.ts` — nuevo módulo core
- `packages/core/src/index.ts` — export del resolver
- `packages/adapter-opencode/src/model-config.ts` — delegación al resolver
- `packages/adapter-opencode/src/developer-team-install.ts` — cleanup capabilityMap
- `apps/cli/src/tui/app.tsx` — limpieza stale thinking
- `apps/cli/src/tui/screens/developer-team-screens.tsx` — ocultar hints

### Cambios Principales
- Resolver híbrido runner>catalog>unknown implementado en core
- OpenCode ahora filtra reasoningEffort por capacidad verificada
- TUI oculta niveles de reasoning para modelos unsupported/unknown
- Cleanup limitado a entradas Deck (deck-developer-*)
- Anti-regresión Pi intacta

### Notas de Ambigüedad
- Ninguna. El tipo de commit es claro (feat) y el scope cubre las áreas afectadas.

## Rollback Notes

- Para rollback completo: revertir cambios en los 6 archivos clave listados arriba.
- Restaurar `supportsThinkingForOpenCodeModel` permisivo previo.
- No hay migración irreversible: `reasoningEffort` removido puede reconfigurarse manualmente.
- Entradas no-Deck preservadas intactas (cleanup limitado a Deck-managed).

## Shipped Behavior

- **OpenCode**: Solo escribe/preserva `reasoningEffort` para modelos con soporte confirmado por runner o catálogo.
- **TUI**: Oculta selector y hint de reasoning para modelos sin soporte confirmado.
- **Cleanup**: Elimina `reasoningEffort` de configuraciones existentes para modelos unsupported/unknown.
- **Pi**: Sin cambio funcional; workaround histórico preservado.
- **Contrato**: explicit-only mantenido (sin modelo no se escribe effort).
