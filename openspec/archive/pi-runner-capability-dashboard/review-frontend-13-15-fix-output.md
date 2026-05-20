# Review Report: pi-runner-capability-dashboard — Frontend Tasks 13-15 Fix

## Summary

**Overall Rating**: REQUEST CHANGES  
**Scope**: frontend  
**Files Reviewed**: 17  
**Registry Mode**: deferred; `state.yaml` y `events.yaml` fueron leídos pero no modificados.  
**Adaptive Context**: no se cargó memoria adaptativa externa; la revisión usa OpenSpec/Registry y código como contexto oficial.

La mayor parte de los findings previos quedó resuelta: Adaptive Memory del dashboard ahora usa el resolver compartido, Supermemory tiene handoff de token a Pi MCP y config no secreta, la vuelta desde Developer Team usa `back`, la acción de modelos actuales/defaults tiene efecto observable, y el complete screen ya no recibe un `onDone` inerte. No vi scope creep hacia paquetes excluidos ni exposición directa de secretos.

Pero queda un problema importante en la continuidad post-dashboard: al completar el dashboard Pi se llama al helper legacy de “después de instalar herramientas Pi”, que vuelve a `team-selection` cuando Pi está seleccionado. Eso contradice el texto de complete, puede reabrir el flujo legacy de teams después de haber usado el dashboard y no garantiza continuar a OpenCode.

## Ratings by Dimension

| Dimension | Rating | Notes |
|---|---|---|
| Architecture | ⚠️ Adequate | Los fixes conectan el dashboard con contratos reales, pero se reutiliza un helper legacy con semántica incorrecta para post-dashboard. |
| Security | ✅ Strong | Token Supermemory se redacta y se entrega por Pi MCP; `.deck/config.json` recibe solo config no secreta. |
| Scalability | ✅ Strong | Sin preocupación de carga para TUI; builders/handlers siguen baratos. |
| Maintainability | ⚠️ Adequate | Persiste acoplamiento en `app.tsx`; el bug surge de reutilizar navegación legacy en contexto nuevo. |
| Code Quality | ⚠️ Adequate | Código legible; quedan detalles de consistencia entre predicados UI y handler. |
| Backend | N/A | Scope frontend; backend revisado solo como contrato de integración. |
| Frontend | ⚠️ Adequate | BackStack/defaults/complete text mejoraron, pero el complete action navega mal. |
| Integration | ❌ Weak | La continuidad multi-entorno/post-dashboard sigue rota por el helper usado. |

## Findings

### BLOCKER
- Ninguno.

### MAJOR
- **Integration**: El complete del dashboard Pi puede navegar al flujo legacy `team-selection` en vez de finalizar o continuar con OpenCode.
  - **File**: `apps/cli/src/tui/app.tsx` — líneas 422-425, 964-965, 1238-1245; `apps/cli/src/developer-team-flow.ts` — líneas 30-35.
  - **Evidence**: El texto se setea como “Enter para continuar con OpenCode” o “Enter para finalizar y volver a Home”, pero `current.screen === "complete"` ejecuta `goToNextEnvironmentOrComplete()`. Ese helper llama a `getNextScreenAfterPiToolInstall(...)`; cuando Pi está seleccionado y hay comando Pi, `getNextScreenAfterPiToolInstall` retorna siempre `"team-selection"` antes de considerar OpenCode.
  - **Recommendation**: Usar un helper específico post-dashboard que no pase por `team-selection` (por ejemplo: si `hasOpenCodeNext`, `opencode-preflight-checking`; si no, Home o top-level `complete` según UX). Agregar una regresión para: Pi-only complete no reabre team-selection; Pi+OpenCode complete continúa a OpenCode.

### MINOR
- **Frontend**: La UI del botón de Review & Install no usa la misma validación que el handler para Supermemory.
  - **File**: `apps/cli/src/tui/screens/pi-runner-dashboard-screens.tsx` — línea 240; `apps/cli/src/tui/app.tsx` — líneas 949-956, 1102-1107.
  - **Evidence**: `ReviewPlanScreen` usa `canRunPlan(state)`, que solo mira `configured/hasToken/userId`; el handler usa `canRunDashboardPlan`, que además consulta `resolveDashboardMemoryProvider(state).diagnostics`. Si la config Pi MCP queda inválida tras el setup, la pantalla puede mostrar “Run executable actions” y recién bloquear al presionar Enter.
  - **Recommendation**: Compartir el mismo estado/predicado de ejecución entre UI y handler, o materializar diagnósticos del resolver en `dashboardState`/plan para que el bloqueo sea visible antes de Enter.

### NIT
- Ninguno.

## Checks de los findings previos

- **Adaptive Memory provider real**: Resuelto en lo principal. `runDashboardInstall` pasa `memoryProvider: resolveDashboardMemoryProvider().provider`, y `applyTeamBundleAction` lo entrega a `buildDeveloperTeamInstallPlan`.
- **Supermemory config/token**: Resuelto en lo principal. El setup exige token/userId, escribe credenciales vía Pi MCP, guarda en dashboard solo `hasToken`/identidad no secreta, y el runner redacta diagnostics/raw.
- **BackStack**: Resuelto. `Developer Team detail` → “Volver a Teams” ahora despacha `back`, por lo que `Esc` desde Teams vuelve al dashboard.
- **Multi-env continuation**: No resuelto; ver finding MAJOR.
- **Defaults action**: Resuelto. “Usar modelos actuales/defaults” carga assignments actuales/default y muestra status.
- **Complete onDone/text**: Parcial. Ya no hay `onDone` inerte y el texto es dinámico, pero el handler conectado al texto navega mal.
- **No scope creep/security regression**: OK. No se encontraron referencias a `context7`, `rpiv-todo` o `ask-user-question` en el dashboard/wiring revisado; no se observó persistencia de tokens en Deck config.

## Design Fidelity

Does the implementation match the Design artifact?
- **Aligned**: Partially
- **Deviations**:
  - Alineado: dashboard capability-first, Supermemory seguro/no secreto, provider real para instalación, backStack corregido, defaults observable, Developer Team sigue reutilizando provider/model/thinking.
  - Desviado: la continuación post-dashboard reutiliza semántica de instalación legacy por paquetes y puede reabrir `team-selection`, contrario al dashboard como flujo principal y a la continuidad multi-entorno esperada.

## Open Questions

- Para Pi-only, ¿Enter en `Pi Runner dashboard complete` debe ir directo a Home o al top-level `complete` legacy antes de Home? Cualquiera es aceptable si no reabre `team-selection`.
