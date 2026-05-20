# Review Report: pi-runner-capability-dashboard — Frontend Tasks 13-15

## Summary

**Overall Rating**: REQUEST CHANGES  
**Scope**: frontend  
**Files Reviewed**: 16  
**Registry Mode**: deferred; `state.yaml` y `events.yaml` fueron leídos pero no modificados.

El dashboard ya se presenta por capacidades, separa Mermaid como concepto requerido de `pi-mermaid` como implementación Pi, conserva textos de estado accesibles y no expone tokens en las pantallas revisadas. Sin embargo, hay riesgos importantes de wiring: la selección de Adaptive Memory del dashboard no está conectada a la resolución/inyección real de provider, la navegación de Teams puede corromper el back stack, y el flujo multi-entorno queda truncado después del dashboard Pi.

## Ratings by Dimension

| Dimension | Rating | Notes |
|---|---|---|
| Architecture | ⚠️ Adequate | La UI está capability-first, pero `app.tsx` sigue acoplando routing, input, ejecución y legacy wizard. |
| Security | ⚠️ Adequate | No vi exposición directa de secretos; Supermemory mantiene mensajes de redacción, pero el flujo de configuración desde dashboard está incompleto. |
| Scalability | ⚠️ Adequate | La carga es baja para TUI; el riesgo principal es complejidad de estado. |
| Maintainability | ⚠️ Adequate | Hay duplicación/estado paralelo entre dashboard y flujo legacy de memoria/modelos. |
| Code Quality | ⚠️ Adequate | Código legible, pero algunas opciones no tienen handler y hay props no usadas. |
| Backend | N/A | Scope frontend; contratos backend revisados solo para integración. |
| Frontend | ❌ Weak | Hay bugs de navegación y wiring de acciones/estado que afectan UX principal. |
| Integration | ❌ Weak | Adaptive Memory y continuidad multi-entorno no están correctamente integradas con el dashboard. |

## Findings

### BLOCKER
- Ninguno.

### MAJOR
- **Integration**: La selección de Adaptive Memory en el dashboard no se conecta a la resolución/inyección real del provider ni a la configuración requerida de Supermemory.
  - **File**: `apps/cli/src/tui/app.tsx` — líneas 401-407, 876-880; `apps/cli/src/tui/pi-runner-dashboard/reducer.ts` — líneas 130-136, 219-223; `apps/cli/src/tui/pi-runner-dashboard/action-runner.ts` — líneas 223-227.
  - **Evidence**: El dashboard solo despacha `select-adaptive-memory`; Supermemory crea un estado vacío (`configured: false`, `hasToken: false`). Al ejecutar el plan, `runPiRunnerReviewPlan` recibe `memoryProvider` y `supermemorySetup.token` del flujo legacy, no derivados de `dashboardState.adaptiveMemory`. Luego `applyTeamBundleAction` pasa `dependencies.memoryProvider` a `buildDeveloperTeamInstallPlan`.
  - **Recommendation**: Derivar el provider desde `dashboardState.adaptiveMemory` usando el helper compartido de resolución/validación, conectar Supermemory a un subflujo de configuración que actualice `dashboardState.adaptiveMemory.supermemory`, pasar el token por dependencia segura, y no permitir que el plan aparente estar accionable si falta configuración requerida.

- **Frontend**: La navegación desde `Developer Team detail` hacia Teams usa `navigate` y contamina el back stack.
  - **File**: `apps/cli/src/tui/app.tsx` — líneas 893-905; `apps/cli/src/tui/pi-runner-dashboard/reducer.ts` — líneas 87-105.
  - **Evidence**: La opción “Volver a Teams” ejecuta `navigate(..., "teams-detail")`; `navigate` siempre agrega la pantalla actual al `backStack`. Después de volver a Teams, `Esc` puede regresar a `developer-team-detail` en vez de salir al dashboard.
  - **Recommendation**: Usar `back` para esta acción, o agregar una transición `replace`/`go-teams` que no empuje el stack. Añadir una prueba de navegación Teams → Developer Team detail → Volver → Esc.

- **Integration**: El flujo multi-entorno puede quedar truncado después del dashboard Pi.
  - **File**: `apps/cli/src/tui/app.tsx` — líneas 644-647, 412-415, 914-915.
  - **Evidence**: `environment-check` prioriza Pi cuando Pi y OpenCode están seleccionados, pero al terminar el dashboard Pi solo cambia el dashboard interno a `complete`; al presionar Enter se vuelve a Home. No hay continuación equivalente a `goToNextEnvironmentOrComplete()` hacia OpenCode.
  - **Recommendation**: Definir un `next screen` post-dashboard que respete `selectedEnvironments`; si OpenCode está seleccionado y disponible, continuar a `opencode-preflight-checking` o mostrar una acción explícita de continuación.

### MINOR
- **Frontend**: La opción “Usar modelos actuales/defaults” no tiene comportamiento observable.
  - **File**: `apps/cli/src/tui/screens/pi-runner-dashboard-screens.tsx` — líneas 201-203; `apps/cli/src/tui/app.tsx` — líneas 893-905.
  - **Evidence**: La pantalla renderiza la opción `defaults`, pero el handler solo maneja cursor `0` y `2`; cursor `1` hace return sin feedback ni cambio de estado.
  - **Recommendation**: Implementar la acción como confirmación explícita de defaults/current assignments, o eliminar la opción hasta que tenga semántica real.

- **Architecture**: `app.tsx` aún concentra demasiado detalle del dashboard.
  - **File**: `apps/cli/src/tui/app.tsx` — pantalla de 1595 líneas; handlers de dashboard en líneas 818-912.
  - **Evidence**: El input por pantalla, ejecución del plan, preflight, estado legacy de memoria y sincronización de modelos viven juntos en `DeckApp`, pese a que el diseño busca que `DeckApp` sea shell/router.
  - **Recommendation**: Extraer un adapter/controller del dashboard para IO y navegación externa; dejar `app.tsx` como composición de rutas y dependencias.

### NIT
- **Code Quality**: `DashboardCompleteScreen` recibe `onDone` pero no lo usa, y el texto dice “volver al dashboard” mientras el handler vuelve a Home.
  - **File**: `apps/cli/src/tui/screens/pi-runner-dashboard-screens.tsx` — líneas 253-261; `apps/cli/src/tui/app.tsx` — líneas 914-915.
  - **Recommendation**: Usar la callback o ajustar texto/comportamiento para que coincidan.

## Design Fidelity

Does the implementation match the Design artifact?
- **Aligned**: Partially
- **Deviations**:
  - Alineado: dashboard por secciones, decisiones por capacidad, Mermaid required/no toggleable con `pi-mermaid` como implementación Pi, pi-hud opcional Pi-only, Review Plan agrupado y textos de estado no solo por color.
  - Desviado: Supermemory no tiene subflujo de configuración conectado al dashboard; Engram/Supermemory no se resuelven desde el dashboard para inyección inmediata en Developer Team.
  - Desviado: `DeckApp` no quedó como shell/router liviano; mantiene lógica detallada de navegación y ejecución del dashboard.
  - Desviado: el flujo posterior al dashboard Pi no conserva claramente la continuidad multi-entorno.

## Open Questions

- ¿El dashboard debe reutilizar las pantallas legacy de Supermemory (`supermemory-token/user-id/team-id/org-id`) o incorporar configuración inline dentro de Adaptive Memory?
- Si el usuario selecciona Pi y OpenCode en Start installation, ¿el dashboard Pi debe continuar automáticamente a OpenCode o mostrar una acción explícita de “Continuar con OpenCode”?
