# Review Report: pi-runner-capability-dashboard — Tests Fix 2 Tasks 16-19

## Summary

**Overall Rating**: APPROVE  
**Scope**: tests / backend / frontend / integration  
**Files Reviewed**: 13

Re-check final limitado a los fixes solicitados sobre `review-tests-fix-output.md`. Los dos findings pendientes quedaron resueltos de forma suficiente: la regresión de model/frontmatter ahora cruza el boundary real `dashboardState.teams["developer-team"]` → `runPiRunnerAction`/`apply-team-bundle` → `buildDeveloperTeamInstallPlan`/apply stub, y `app.tsx` ahora consume `getPiRunnerDashboardContinueEffect`/`getPiRunnerDashboardToggleAction` como fuente compartida para el handler real. No identifiqué nuevas regresiones de scope ni seguridad en los cambios revisados.

No ejecuté tests; esta revisión evalúa calidad, arquitectura, wiring y riesgos de la cobertura aplicada.

## Ratings by Dimension

| Dimension | Rating | Notes |
|---|---|---|
| Architecture | ✅ Strong | El helper de input ya está integrado al handler real de `app.tsx`; el action-runner mantiene el boundary de ejecución inyectable/testeable. |
| Security | ✅ Strong | No se observaron nuevas exposiciones de secretos; se preserva el bloqueo fail-closed/redacción de Supermemory cubierto por la ronda anterior. |
| Scalability | ✅ Strong | Los cambios agregan tests focalizados sin ampliar loops/runtime costosos. |
| Maintainability | ✅ Strong | Se elimina la duplicación más riesgosa entre helper y handler real; la regresión de frontmatter ahora protege un flujo observable. |
| Code Quality | ✅ Strong | Nombres y separación de responsabilidades adecuados para el alcance; tests legibles y con fixtures específicas. |
| Backend | ✅ Strong | La cobertura de Developer Team plan/frontmatter ahora valida el consumo desde el action-runner sin modificar contratos backend. |
| Frontend | ✅ Strong | `app.tsx` delega toggle/continue al helper compartido y solo conserva la interpretación de efectos impuros. |
| Integration | ✅ Strong | El handoff dashboard state → action-runner → Developer Team queda cubierto; handler helper → app queda conectado. |

## Findings

### BLOCKER

None.

### MAJOR

None.

### MINOR

None.

### NIT

None.

## Re-check Results

- **Model/frontmatter preservation boundary**: Resuelto. `apps/cli/src/tui/pi-runner-dashboard/action-runner.test.ts` ahora ejecuta una acción `apply-team-bundle` vía `runPiRunnerAction`, alimentada por `dashboardState.teams["developer-team"].modelAssignments/thinkingAssignments`, y compara el frontmatter observable contra `buildDeveloperTeamInstallPlan` del path Home/Configure Models. La prueba incluye `openai-codex/gpt-5.5` con `thinking: high` y `opencode-go/kimi-k2.6` forzado a `thinking: off`.
  - **Evidence**: `apps/cli/src/tui/pi-runner-dashboard/action-runner.test.ts` líneas 143-201; `apps/cli/src/tui/pi-runner-dashboard/action-runner.ts` líneas 234-250.
- **Input handler helper conectado al app handler real**: Resuelto. `app.tsx` importa el helper compartido, `toggleDashboardCurrent()` usa `getPiRunnerDashboardToggleAction`, `continueDashboardCurrent()` usa `getPiRunnerDashboardContinueEffect`, y `applyDashboardContinueEffect()` centraliza los efectos impuros (Supermemory setup, model config, reuse, block, complete).
  - **Evidence**: `apps/cli/src/tui/app.tsx` líneas 86-87, 828-868, 873-919; `apps/cli/src/tui/pi-runner-dashboard/input-handler.ts` líneas 15-102.
- **Scope/security regressions**: No observadas. Los cambios de fix 2 se limitan a wiring de `app.tsx` y cobertura de action-runner; no introducen persistencia nueva, secretos en config ni relajación del fail-closed de Supermemory.

## Design Fidelity

Does the implementation match the Design artifact?
- **Aligned**: Yes
- **Deviations**: None. La implementación sigue la estrategia del diseño: extraer lógica testeable del dashboard, mantener `DeckApp` como shell/router, preservar semántica de Developer Team model/thinking y cubrir el flujo dashboard → action runner → team apply.

## Open Questions

None.

## Registry Intent (deferred)

- **Registry Write**: deferred
- **Phase**: `review`
- **Status**: `approved`
- **Event**: `review.tests_fix_2.approved`
- **Artifact**: `review-tests-fix-2-output.md`
- **Provenance**: `deck-developer-review`, scope `tests/backend/frontend/integration`, registry-deferred mode
