# Review Report: pi-runner-capability-dashboard — Frontend Fix Tasks 10-12

## Summary

**Overall Rating**: APPROVE  
**Scope**: frontend  
**Files Reviewed**: 11  
**Registry Mode**: deferred — se leyó `state.yaml`/`events.yaml` y no se modificaron.

Re-check limitado a los fixes de los findings previos de Frontend para Tasks 10-12. Los findings **MAJOR** y **MINOR** reportados en `review-frontend-output.md` quedaron resueltos en los contratos revisados para reducer, selectors, action-runner y state. No se identifican nuevos riesgos bloqueantes o mayores dentro del alcance asignado.

## Ratings by Dimension

| Dimension | Rating | Notes |
|---|---|---|
| Architecture | ✅ Strong | `planRevision`/`planGeneratedForRevision` establecen una invariante clara de plan vigente; `start-install` queda protegido por pantalla y plan actual. |
| Security | ✅ Strong | Resultados y diagnósticos pasan por redacción profunda antes de exponerse; Supermemory mantiene separación de token vs config no secreta. |
| Scalability | ✅ Strong | Cambios puros y baratos; no hay trabajo adicional en cursor/navegación ni efectos al import. |
| Maintainability | ✅ Strong | Fronteras reducer/selectors/action-runner se mantienen claras; fallos de metadata son explícitos. |
| Code Quality | ✅ Strong | Código legible, nombres claros y defaults peligrosos eliminados. |
| Backend | N/A | Scope frontend; solo se revisaron contratos consumidos por frontend. |
| Frontend | ✅ Strong | Summaries, navegación y ejecución quedaron más defensivos para futura integración con screens/app. |
| Integration | ✅ Strong | `install-pi-package` ya no puede declarar éxito sin `piCommand`, sin `toolId`, ni con resultados vacíos del installer. |

## Re-check de Findings Previos

- **MAJOR — Integration / missing `piCommand`**: Resuelto.
  - **File**: `apps/cli/src/tui/pi-runner-dashboard/action-runner.ts` — lines 102-145
  - **Evidence**: `runPiPackageInstall()` retorna `skipped` si falta `dependencies.piCommand` (lines 106-108), falla si falta metadata de tool (lines 110-117), y trata `installResults.length === 0` como `failed` (lines 127-134).

- **MAJOR — Frontend / summaries con manual/pending/unknown ocultos**: Resuelto para el contrato revisado.
  - **File**: `apps/cli/src/tui/pi-runner-dashboard/selectors.ts` — lines 131-171, 270-325
  - **Evidence**: Los summaries derivan señales por sección (`runnerSignals`, `adaptiveSignals`, `visualSignals`, `teamSignals`) y `readinessFromSignals()` prioriza `blocked`, `pending`/`unknown`, y `manual` antes de `ready`. Mermaid requerido con status `undefined` entra como `unknown`, no como `ready`.

- **MAJOR — Architecture / stale plan**: Resuelto.
  - **File**: `apps/cli/src/tui/pi-runner-dashboard/reducer.ts` — lines 50-75, 191-210
  - **Evidence**: Cambios determinantes invalidan plan vía `invalidatePlan()`; el plan registra `planGeneratedForRevision`; `start-install` solo navega cuando `hasCurrentPlan(state)` y `state.screen === "review-plan"`.

- **MINOR — Security / Supermemory `raw` sin sanitización**: Resuelto.
  - **File**: `apps/cli/src/tui/pi-runner-dashboard/action-runner.ts` — lines 180-207, 242-252, 302-324
  - **Evidence**: `raw` usa `redactRaw(...)`; la redacción recorre arrays/objetos, redacta claves sensibles y patrones de token/API key/Bearer.

- **MINOR — Code Quality / fallback `toolId: "context-mode"`**: Resuelto.
  - **File**: `apps/cli/src/tui/pi-runner-dashboard/action-runner.ts` — lines 110-117, 263-277
  - **Evidence**: `buildInstallableTool()` retorna `undefined` si falta `toolId`; el runner devuelve `failed` con mensaje explícito en vez de fabricar un ID ficticio.

## Findings

### BLOCKER
- Ninguno.

### MAJOR
- Ninguno.

### MINOR
- Ninguno.

### NIT
- Ninguno.

## Design Fidelity

Does the implementation match the Design artifact?
- **Aligned**: Yes, dentro del scope de Frontend Fix para Tasks 10-12.
- **Deviations**: Ninguna relevante en los fixes revisados. Screens/app wiring, render tests y pruebas dedicadas permanecen fuera de este scope según `apply-progress.md`.

## Registry Intent

- **Registry Write**: deferred
- **Intended Phase**: `review`
- **Intended Status**: `approved`
- **Intended Event**: `review.frontend_fix.approved`
- **Artifact**: `review-frontend-fix-output.md`

## Open Questions

None.
