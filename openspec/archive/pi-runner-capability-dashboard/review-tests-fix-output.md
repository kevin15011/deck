# Review Report: pi-runner-capability-dashboard — Tests Fix Tasks 16-19

## Summary

**Overall Rating**: REQUEST CHANGES  
**Scope**: tests / backend / frontend / integration  
**Files Reviewed**: 27

Re-check limitado a los fixes sobre `review-tests-output.md`. Se resolvieron bien dos áreas de riesgo: Supermemory ahora tiene cobertura dashboard-specific de fail-closed/redacción, y las exclusiones/proveedores tienen aserciones estructurales adicionales. Sin embargo, dos findings previos no quedaron cerrados de forma robusta: la regresión de frontmatter/model config sigue siendo tautológica y no atraviesa el path real dashboard state → action runner → Developer Team plan, y el nuevo helper de input mapping no está conectado al handler real de `app.tsx`, por lo que la cobertura no protege el flujo que ejecuta el usuario.

No ejecuté tests; esta revisión es de calidad/arquitectura de la cobertura y el wiring.

## Ratings by Dimension

| Dimension | Rating | Notes |
|---|---|---|
| Architecture | ⚠️ Adequate | Buen aislamiento de helpers y tests, pero el helper de input queda desacoplado del handler real. |
| Security | ✅ Strong | Supermemory fail-closed/redaction quedó cubierto en plan, runner y render con token sentinela. |
| Scalability | ✅ Strong | Tests focalizados y baratos; sin señales de suites pesadas. |
| Maintainability | ❌ Weak | La regresión de frontmatter compara la misma función con los mismos argumentos; el helper de input duplica lógica no usada. |
| Code Quality | ⚠️ Adequate | Tests legibles; algunas regresiones dan falsa confianza por no cubrir el boundary real. |
| Backend | ⚠️ Adequate | Cobertura Supermemory/estructural mejoró; frontmatter backend sigue sin representar un path dashboard distinto. |
| Frontend | ⚠️ Adequate | Render/redaction mejoró; input mapping no está integrado con `app.tsx`. |
| Integration | ❌ Weak | Persisten gaps en dashboard state/action-runner/model config y en handler real. |

## Findings

### BLOCKER

None.

### MAJOR

- **Integration / Maintainability**: La regresión de preservación de model config/frontmatter sigue siendo tautológica y no prueba el path real del dashboard hacia la aplicación del Developer Team.
  - **File**: `apps/cli/src/tui/screens/developer-team-screens.test.tsx` — líneas 56-77; `packages/adapter-pi/src/developer-team-install.test.ts` — líneas 873-895; `apps/cli/src/tui/pi-runner-dashboard/action-runner.ts` — líneas 243-250
  - **Evidence**: Los tests “dashboard” construyen `homePlan` y `dashboardPlan` llamando dos veces a `buildDeveloperTeamInstallPlan("/tmp/project", { modelAssignments, thinkingAssignments })` con los mismos argumentos. El boundary real del dashboard está en `applyTeamBundleAction`, que toma `dashboardState.teams["developer-team"].modelAssignments/thinkingAssignments` y los pasa al builder; ese handoff no queda cubierto.
  - **Recommendation**: Agregar una regresión que ejecute `runPiRunnerAction` o `runPiRunnerReviewPlan` con una acción `apply-team-bundle`, `dashboardState.teams["developer-team"].modelAssignments/thinkingAssignments`, y stubs de `buildDeveloperTeamInstallPlan`/`applyDeveloperTeamInstall` o inspección del contenido aplicado. Comparar el frontmatter observable contra el path Home/Configure Models. Mantener los casos `openai-codex/gpt-5.5` + `thinking: high` y `opencode-go/kimi-k2.6` forzado a `thinking: off`.

### MINOR

- **Integration / Maintainability**: La nueva cobertura de input/handler prueba un helper que no está conectado al handler real de `app.tsx`, por lo que el flujo real puede desviarse sin que fallen esos tests.
  - **File**: `apps/cli/src/tui/pi-runner-dashboard/input-handler.test.ts` — líneas 4-7, 18-78; `apps/cli/src/tui/pi-runner-dashboard/input-handler.ts` — líneas 35-104; `apps/cli/src/tui/app.tsx` — líneas 84-88 y 824-959
  - **Evidence**: `input-handler.test.ts` ejercita `getPiRunnerDashboardContinueEffect`/`getPiRunnerDashboardToggleAction`, pero `app.tsx` solo importa `action-runner`, `reducer`, `state`, `selectors` y `PiRunnerDashboardScreens`; luego implementa su propio `toggleDashboardCurrent`/`continueDashboardCurrent` con lógica duplicada. El helper no es la fuente de verdad del handler real.
  - **Recommendation**: O bien refactorizar `app.tsx` para interpretar los efectos de `getPiRunnerDashboardContinueEffect`/`getPiRunnerDashboardToggleAction`, o agregar tests de integración TUI/app que disparen input real sobre `handleDashboardInput`/`continueDashboardCurrent` y verifiquen Supermemory setup, toggles, Developer Team detail/back y Review blocked/unblocked.

### NIT

None.

## Resolved Previous Findings

- **Supermemory security coverage**: Resuelto. `capability-plan.test.ts` cubre `hasToken=true` sin `userId` como no listo/pending/warning, y `action-runner.test.ts` cubre bloqueo de Review & Install, ausencia de escrituras y redacción de token sentinela en raw/diagnostics.
- **Structural assertions**: Resuelto. `capability-catalog.test.ts` y `capability-plan.test.ts` ahora verifican `capabilityId`, `toolId`, `kind`, `source`, grupos y diagnósticos estructuralmente, además de exclusiones legacy.
- **Model config/frontmatter preservation**: Parcial. Cubre contenido de frontmatter, pero no el boundary dashboard/action-runner.
- **Integration handler coverage**: Parcial. Hay helper y tests, pero no está integrado con el handler real.

## Design Fidelity

Does the implementation match the Design artifact?
- **Aligned**: Partially
- **Deviations**:
  - La estrategia de tests de Supermemory y aserciones estructurales está alineada con el diseño.
  - La estrategia de preservación indicada por el diseño (“Dashboard model config writes the same model/thinking frontmatter as current Configure models route”) no se prueba por el flujo dashboard; se compara la misma función con los mismos inputs.
  - El diseño buscaba extraer lógica testeable del dashboard; el helper de input existe, pero `app.tsx` no lo usa, por lo que el boundary real sigue duplicado.

## Open Questions

None.

## Registry Intent (deferred)

- **Registry Write**: deferred
- **Phase**: `review`
- **Status**: `changes_requested`
- **Event**: `review.tests_fix.changes_requested`
- **Artifact**: `review-tests-fix-output.md`
- **Provenance**: `deck-developer-review`, scope `tests/backend/frontend/integration`, registry-deferred mode
