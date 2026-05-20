# Review Report: pi-runner-capability-dashboard — Frontend Tasks 13-15 Fix 2

## Summary

**Overall Rating**: APPROVE  
**Scope**: frontend  
**Files Reviewed**: 9  
**Registry Mode**: deferred; `state.yaml` y `events.yaml` fueron leídos pero no modificados.  
**Adaptive Context**: no se cargó memoria adaptativa externa; la revisión usa OpenSpec/Registry y código como contexto oficial.

Los dos findings restantes quedaron resueltos. El complete del dashboard Pi ya no reutiliza `getNextScreenAfterPiToolInstall` ni puede reabrir el flujo legacy de `team-selection`; ahora usa un helper post-dashboard que continúa a OpenCode cuando corresponde o vuelve a Home. La pantalla Review & Install recibe desde `app.tsx` el mismo predicado/diagnósticos que usa el handler antes de ejecutar, por lo que la affordance “Run executable actions” queda alineada con los bloqueos reales de Supermemory. No observé regresiones nuevas de seguridad ni exposición de secretos en los archivos revisados.

## Ratings by Dimension

| Dimension | Rating | Notes |
|---|---|---|
| Architecture | ✅ Strong | El fix separa correctamente la navegación post-dashboard del helper legacy paquete/team-oriented. |
| Security | ✅ Strong | Supermemory sigue mostrando token como redactado y el run gate valida configuración antes de ejecutar. |
| Scalability | ✅ Strong | Sin cambios que afecten carga; lógica TUI local y barata. |
| Maintainability | ⚠️ Adequate | `app.tsx` sigue concentrando mucho wiring, pero el cambio reduce el acoplamiento crítico con el flujo legacy. |
| Code Quality | ✅ Strong | Nombres claros (`getNextScreenAfterDashboardComplete`, `goToNextEnvironmentAfterDashboardComplete`) y predicados compartidos desde el shell. |
| Backend | N/A | Scope frontend. |
| Frontend | ✅ Strong | El handler y la UI de Review & Install ahora usan el mismo estado efectivo de ejecución. |
| Integration | ✅ Strong | La transición Pi → OpenCode/Home está alineada con el dashboard y ya no pasa por selección legacy de teams. |

## Findings

### BLOCKER
- Ninguno.

### MAJOR
- Ninguno.

### MINOR
- Ninguno.

### NIT
- Ninguno.

## Checks de follow-up

- **Post-dashboard continuation sin `team-selection` legacy**: Resuelto.
  - **Evidencia**: `apps/cli/src/tui/app.tsx:962` ejecuta `goToNextEnvironmentAfterDashboardComplete()` cuando `dashboardState.screen === "complete"`; `apps/cli/src/tui/app.tsx:1253-1267` define `getNextScreenAfterDashboardComplete()` como `opencode-preflight-checking` si OpenCode está seleccionado y disponible, o `home` en caso contrario. El helper legacy `goToNextEnvironmentOrComplete()` sigue existiendo en `apps/cli/src/tui/app.tsx:1243` pero sus usos visibles (`apps/cli/src/tui/app.tsx:391`, `apps/cli/src/tui/app.tsx:668`) pertenecen al flujo legacy de instalación, no al complete del dashboard.
- **Review & Install UI predicate alineado con handler/resolver diagnostics**: Resuelto.
  - **Evidencia**: el handler bloquea con `canRunDashboardPlan(current)` en `apps/cli/src/tui/app.tsx:947-957`; ese predicado deriva de `getDashboardRunBlockDiagnostics()` en `apps/cli/src/tui/app.tsx:1100-1112`, que incluye diagnósticos de `resolveDashboardMemoryProvider(state)`. La UI recibe exactamente `canRunPlan={canRunDashboardPlan(dashboardState)}` y `runBlockDiagnostics={getDashboardRunBlockDiagnostics(dashboardState)}` en `apps/cli/src/tui/app.tsx:1337`; `ReviewPlanScreen` usa ese prop para el label/bloqueos en `apps/cli/src/tui/screens/pi-runner-dashboard-screens.tsx:221-251`.
- **Sin nueva regresión de seguridad**: OK.
  - **Evidencia**: la UI sigue mostrando token Pi MCP como `recibido/redactado` (`apps/cli/src/tui/screens/pi-runner-dashboard-screens.tsx:128`) y status con `Token: [redacted]` (`apps/cli/src/tui/app.tsx:1074`). No se observó persistencia nueva del token en config no secreta dentro de los archivos revisados.

## Design Fidelity

Does the implementation match the Design artifact?
- **Aligned**: Yes
- **Deviations**: Ninguna relevante en este fix. La navegación post-dashboard ahora respeta el dashboard como flujo principal y preserva la continuidad multi-entorno hacia OpenCode sin reabrir selección legacy de teams.

## Open Questions

None.

## Registry Intent

- **Registry Write**: deferred
- **State Path**: `openspec/changes/pi-runner-capability-dashboard/state.yaml`
- **Events Path**: `openspec/changes/pi-runner-capability-dashboard/events.yaml`
- **Intended phase**: `review`
- **Intended status**: `approved`
- **Intended artifact key**: `review_frontend_13_15_fix_2`
- **Intended artifact**: `review-frontend-13-15-fix-2-output.md`
- **Intended event**: `review.frontend_tasks_13_15_fix_2.approved`
- **Registry Blocker**: none
