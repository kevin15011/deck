# Review Report: Dashboard por capacidades para Pi Runner — Final Review

## Summary

**Overall Rating**: REQUEST CHANGES  
**Scope**: completo (`general`, `backend`, `frontend`, `integration`)  
**Files Reviewed**: 28 archivos de cambio + artefactos OpenSpec/registry (`spec.md`, `tasks.md`, `design.md`, `apply-progress.md`, `state.yaml`, `events.yaml`)  
**Registry Mode**: deferred — se leyó `state.yaml`/`events.yaml` y no se modificó registry.

La implementación está bien encaminada: el catálogo capability-first separa Mermaid global de `pi-mermaid`, el plan evita paquetes excluidos, los builders puros reducen acoplamiento, la UI ya es dashboard por secciones, y las regresiones de modelo/thinking/Supermemory mejoraron mucho después de los fixes previos.

Sin embargo, queda un problema central antes de marcar el cambio como completo: el flujo de Supermemory cruza la frontera de Review & Install. El setup del dashboard escribe credenciales persistentes en `~/.pi/agent/mcp.json` antes de que el usuario ejecute el plan, y el proveedor se resuelve antes de ejecutar la acción `write-pi-mcp-config`. Eso debilita seguridad, UX de consentimiento y la arquitectura del Review Plan.

## Ratings by Dimension

| Dimension | Rating | Notes |
|---|---|---|
| Architecture | ❌ Weak | Buen núcleo capability-first, pero la frontera setup/review/install queda rota para Supermemory y `app.tsx` sigue siendo un controlador monolítico. |
| Security | ❌ Weak | Tokens no se guardan en Deck config y se redactan, pero la escritura persistente del credential ocurre antes del Review & Install. |
| Scalability | ⚠️ Adequate | Builders puros y baratos; sin preocupación de carga relevante para TUI. |
| Maintainability | ❌ Weak | `app.tsx` mantiene demasiadas responsabilidades y contratos duplicados elevan riesgo de drift. |
| Code Quality | ⚠️ Adequate | Nombres y módulos nuevos son claros; quedan props muertas y zonas difíciles de razonar. |
| Backend | ✅ Strong | Catálogo/inventory/plan están bien separados; Supermemory resolver fail-closed mejoró. |
| Frontend | ⚠️ Adequate | Dashboard renderiza estados textuales y navegación; app/controller necesita extracción. |
| Integration | ❌ Weak | El orden Supermemory setup → provider resolution → action runner no respeta el contrato Review Plan. |

## Findings

### BLOCKER

- **Security / Architecture**: El setup de Supermemory escribe credenciales persistentes antes de `Review & Install`, y el provider se resuelve antes de ejecutar la acción que supuestamente escribe Pi MCP config.
  - **File**: `apps/cli/src/tui/app.tsx` — líneas 1000-1034, 411-418, 1051-1073
  - **File**: `apps/cli/src/tui/pi-runner-dashboard/action-runner.ts` — líneas 217-230, 55-84
  - **Evidence**: `persistDashboardSupermemorySelection()` llama `handOffSupermemoryCredentialToPiMcp()` durante el subflujo de setup (líneas 1013-1034), antes de que el usuario ejecute el plan. Luego `runDashboardInstall()` pasa `memoryProvider: resolveDashboardMemoryProvider().provider` antes de correr `runPiRunnerReviewPlan()` (líneas 411-418). La acción `write-pi-mcp-config` también existe y vuelve a escribir con `writeSupermemoryPiMcpConfig({ token })` (action-runner líneas 217-230), pero el resolver ya dependía de que el MCP config existiera.
  - **Impact**: El dashboard deja de ser “revisar primero, ejecutar después”; se modifica un archivo global con secreto antes del consentimiento final. Además, la inyección de Supermemory depende de una escritura temprana fuera del plan, no de la acción agrupada que el usuario ve en Review & Install.
  - **Recommendation**: No escribir `~/.pi/agent/mcp.json` durante el setup. Guardar el token solo como estado efímero/redactado hasta Run, ejecutar `write-pi-mcp-config` dentro del action runner, validar después de esa escritura, resolver/construir el provider después de config/validation y antes de `apply-team-bundle`, y limpiar el token de memoria tras uso/cancelación. Agregar una prueba app/controller que confirme que seleccionar/configurar Supermemory no llama al writer antes de Run.

### MAJOR

- **Maintainability / Architecture**: `app.tsx` no quedó reducido a shell/router; sigue concentrando estado, side effects y reglas de dashboard/legacy/modelos/memoria.
  - **File**: `apps/cli/src/tui/app.tsx` — 1708 líneas; estado en líneas 197-243; lógica dashboard/Supermemory en líneas 850-1074
  - **Evidence**: El componente mantiene estado de runtime, legacy wizard, dashboard, model config, Supermemory token, provider resolution, install effects y navegación multi-env en un solo archivo.
  - **Recommendation**: Extraer un `usePiRunnerDashboardController` o módulo controller para preflight/inventory, Supermemory setup, run-plan, provider resolution y post-dashboard navigation. Dejar `DeckApp` como router/top-level shell y mantener legacy screens aisladas hasta su retiro.

- **Integration / Tests**: La cobertura modular es amplia, pero no protege el boundary que falló: flujo real app/controller de Supermemory antes/después de Review & Install.
  - **File**: `apps/cli/src/tui/pi-runner-dashboard/action-runner.test.ts` — líneas 50+ cubren action-runner con mocks
  - **File**: `apps/cli/src/tui/pi-runner-dashboard/input-handler.test.ts` — líneas 18+ cubren mapping puro
  - **Evidence**: Hay buenas pruebas de reducer/render/action-runner/input-handler, pero no una prueba del flujo que combine `persistDashboardSupermemorySelection`, writer MCP, `canRunDashboardPlan`, provider resolver y `runPiRunnerReviewPlan`.
  - **Recommendation**: Añadir test de integración de controller/app extraído: configurar Supermemory no debe escribir archivo hasta Run; Run debe escribir Pi MCP config, validar, resolver provider y aplicar Developer Team con memoria; cancel/escape debe limpiar token y no persistir cambios.

### MINOR

- **Maintainability**: `PiRunnerAction`, `PiRunnerReviewPlan` y diagnósticos están duplicados entre adapter y TUI.
  - **File**: `packages/adapter-pi/src/capability-plan.ts` — líneas 18-49
  - **File**: `apps/cli/src/tui/pi-runner-dashboard/state.ts` — líneas 89-119
  - **Evidence**: Los tipos se mantienen manualmente en dos paquetes; ya hubo fixes previos para sincronizar campos como `dependencies`/`unresolvedCapabilities`.
  - **Recommendation**: Importar/re-exportar los tipos del adapter en TUI, o agregar type-level assertions que fallen si los contratos divergen.

- **Frontend / UX**: El resumen del dashboard mezcla estados de availability de capabilities no seleccionadas con readiness de la decisión actual.
  - **File**: `apps/cli/src/tui/pi-runner-dashboard/selectors.ts` — líneas 131-151
  - **Evidence**: `runnerSignals` evalúa siempre `rtk`, `context-mode` y `codebase-memory` aunque el usuario no los haya seleccionado; un entorno con RTK no instalado puede marcar attention/pending aunque no haya acción derivada.
  - **Recommendation**: Separar “estado de disponibilidad observable” de “readiness del plan seleccionado”, o etiquetar explícitamente que esos contadores son availability, no bloqueos de instalación.

- **Observability / UX**: La pantalla complete del dashboard pierde mensajes/diagnósticos que sí se mostraron en progreso.
  - **File**: `apps/cli/src/tui/screens/pi-runner-dashboard-screens.tsx` — líneas 273-281
  - **Evidence**: `DashboardCompleteScreen` renderiza solo `status` y `actionId`, no `message` ni diagnostics redactados.
  - **Recommendation**: Mostrar mensajes y diagnósticos redactados en complete, especialmente para manual/pending/skipped/failed, para que el usuario conserve follow-ups accionables.

### NIT

- **Code Quality**: Prop `dispatch` no se usa en `PiRunnerDashboardScreens`.
  - **File**: `apps/cli/src/tui/screens/pi-runner-dashboard-screens.tsx` — líneas 18-28
  - **Recommendation**: Eliminar la prop o usarla dentro de screens si se decide mover interacción fuera de `app.tsx`.

## Design Fidelity

Does the implementation match the Design artifact?
- **Aligned**: Partially
- **Aligned areas**:
  - Catálogo capability-first claro: `rtk`, `context-mode`, `codebase-memory`, `pi-hud`, `runner-mermaid`.
  - Mermaid global obligatorio separado de implementación Pi `pi-mermaid`.
  - `pi-hud` opcional Pi-only y pending-source.
  - Engram solo aparece cuando Adaptive Memory = Engram.
  - Supermemory no genera package install y Deck config permanece no secreta.
  - Dashboard por secciones reemplaza el wizard principal de Pi; multi-env continuation fue corregida.
  - Model provider/model/thinking se preserva con regresiones relevantes.
- **Deviations**:
  - Supermemory credential handoff ocurre durante setup, no como acción de Review & Install.
  - Provider resolution ocurre antes de ejecutar configWrites del plan, acoplando inyección a una escritura previa fuera del plan.
  - `app.tsx` sigue lejos del shell/router propuesto y concentra demasiados flujos.
  - Contratos plan/action están duplicados entre adapter y TUI.

## Open Questions

- ¿El producto permite escribir Pi MCP credentials durante el subflujo de setup? Si sí, la UI debe tratarlo como acción persistente explícita; si no, debe moverse estrictamente a Review & Install.
- ¿El resumen por sección debe comunicar readiness del plan seleccionado o disponibilidad completa del entorno para capabilities no seleccionadas?

## Registry Intent

- **Registry Write**: deferred
- **Intended phase**: `review`
- **Intended status**: `changes_requested`
- **Intended event**: `review.final.changes_requested`
- **Artifact**: `review-final-output.md`
- **Registry Blocker**: none (deferred by instruction)
