# Apply Progress: Dashboard por capacidades para Pi Runner

## Completed Tasks

### Task 1: Capability Catalog — tipos y metadatos de capabilities
**Status**: ✅ Complete
**Files Changed**
- `packages/adapter-pi/src/capability-catalog.ts` — create/modify
- `packages/adapter-pi/src/index.ts` — modify

**Verification**
- Tests: skipped
- Build: skipped/warn (no hay script de build del workspace)
- Typecheck: pass

**Notes**
Catálogo capability-first completado con `rtk`, `context-mode`, `codebase-memory`, `pi-hud` y `runner-mermaid`; exclusions y Mermaid/pi-mermaid preservadas.

### Task 2: Dashboard State — tipos de estado y pantallas
**Status**: ✅ Complete
**Files Changed**
- `apps/cli/src/tui/pi-runner-dashboard/state.ts` — create/modify

**Verification**
- Tests: skipped
- Build: skipped/warn (no hay script de build del workspace)
- Typecheck: pass

**Notes**
Estado de dashboard creado con Adaptive Memory single-choice `none | engram | supermemory`, default `none`, y pantallas requeridas.

### Task 3: Capability Inventory Builder
**Status**: ✅ Complete
**Files Changed**
- `packages/adapter-pi/src/capability-inventory.ts` — create
- `packages/adapter-pi/src/index.ts` — modify

**Verification**
- Backend Tests: pass
- Build: skipped/warn (no hay script de build del workspace)
- Typecheck: pass

**Notes**
Inventario mapea capabilities a `ready`, `missing`, `manual`, `pending-source`, `blocked`; external tools faltantes quedan manuales; Mermaid/pi-hud quedan pendientes sin inventar sources.

### Task 4: Capability Plan Builder
**Status**: ✅ Complete
**Files Changed**
- `packages/adapter-pi/src/capability-plan.ts` — create/modify
- `packages/adapter-pi/src/index.ts` — modify

**Verification**
- Backend Tests: pass
- Build: skipped/warn (no hay script de build del workspace)
- Typecheck: pass

**Notes**
Plan agrupado completado; `engram-memory` solo aparece con provider Engram; Supermemory genera config/validación sin paquete; prerequisites automáticos y readiness con unresolved preservados.

### Task 5: Modificar installation-plan.ts — exponer metadatos de tool para el catálogo de capabilities
**Status**: ✅ Complete
**Files Changed**
- `packages/adapter-pi/src/installation-plan.ts` — modify

**Verification**
- Backend Tests: pass
- Build: skipped/warn (no hay script de build del workspace)
- Typecheck: pass

**Notes**
Helpers de metadata agregados manteniendo `buildPiInstallationPlan` legacy y `engram-memory` como tool técnico legacy.

### Task 6: Modificar required-tools.ts — alimentar inventario de capabilities
**Status**: ✅ Complete
**Files Changed**
- `packages/adapter-pi/src/required-tools.ts` — modify

**Verification**
- Backend Tests: pass
- Build: skipped/warn (no hay script de build del workspace)
- Typecheck: pass

**Notes**
Mappings de detectores existentes agregados sin detectores para `pi-mermaid` ni `pi-hud`.

### Task 7: Modificar install-tools.ts — acciones manuales con semántica Review Plan
**Status**: ✅ Complete
**Files Changed**
- `packages/adapter-pi/src/install-tools.ts` — modify
- `packages/adapter-pi/src/install-tools.test.ts` — modify

**Verification**
- Backend Tests: pass (`bun test 2>&1 | tail -n 20`)
- Build: warn (`bun run build` falla porque no existe script `build`)
- Typecheck: pass (`bunx tsc --noEmit --pretty false`)

**Notes**
- Tools `external` (`rtk`, `codebase-memory` y otros legacy externos) ahora retornan `actionKind: "manual-external-install"` y `status: "manual"` sin ejecutar `pi install` ni reportarse como fallo genérico.
- Pi packages conservan ejecución `pi install <source>` con `actionKind: "install-pi-package"` y status `installed/failed`; si falta el comando para un paquete Pi se emite un resultado `failed` explícito.
- Se extendió `PiToolInstallResult` de forma compatible agregando metadata machine-readable; `success` se conserva para consumidores legacy.
- Fix review Backend 7-9: las herramientas `external` emiten resultado `manual` aunque `command` sea `undefined`; test agregado para external sin comando.

### Task 8: Modificar developer-team-install.ts — consumir provider de Adaptive Memory desde dashboard
**Status**: ✅ Complete
**Files Changed**
- `packages/adapter-pi/src/developer-team-install.ts` — modify

**Verification**
- Backend Tests: pass (`bun test 2>&1 | tail -n 20`)
- Build: warn (`bun run build` falla porque no existe script `build`)
- Typecheck: pass (`bunx tsc --noEmit --pretty false`)

**Notes**
- `buildDeveloperTeamInstallPlan` ahora usa el tipo exportado `DeveloperTeamInstallOptions` y acepta `dashboardMemoryProvider` como alias explícito para providers resueltos por el dashboard/TUI.
- Precedencia preservada: `memoryInjection` > `memoryProvider` > `dashboardMemoryProvider`.
- No se cambió `supportsThinkingForModel`, `supportsDeveloperTeamModel`, ni la semántica de modelos/thinking por agente.

### Task 9: Modificar pi-launch-command.ts — compartir resolución de provider con TUI
**Status**: ✅ Complete
**Files Changed**
- `apps/cli/src/pi-launch-command.ts` — modify
- `apps/cli/src/pi-launch-command.direct-supermemory.test.ts` — create

**Verification**
- Backend Tests: pass (`bun test packages/adapter-pi/src/install-tools.test.ts packages/adapter-pi/src/developer-team-install.test.ts apps/cli/src/pi-launch-command.test.ts apps/cli/src/pi-launch-command.supermemory.test.ts apps/cli/src/pi-launch-command.direct-supermemory.test.ts packages/adapter-supermemory/src/index.test.ts`)
- Build: warn (`bun run build` falla porque no existe script `build`)
- Typecheck: pass (`bunx tsc --noEmit --pretty false`)

**Notes**
- Se exportó `resolvePiAdaptiveMemoryProvider(options)` con soporte para launch (`cliMemoryProvider`/`.deck/config.json`) y para TUI/dashboard (`activeProvider` + config no secreta de Supermemory).
- La resolución construye Engram o Supermemory consistentemente, valida Pi MCP config para Supermemory y no persiste tokens en `.deck/config.json`.
- `runPiLaunch` usa el helper compartido; el path de launch existente queda preservado.
- Fix review Backend 7-9: el path directo `activeProvider: "supermemory"` ahora pasa por `validateDeckConfig`, rechaza campos unknown/secret-shaped, aplica defaults/límites, y falla cerrado con diagnostic redacted si la construcción de Engram/Supermemory arroja error.
- Se agregaron tests directos para container tags inválidos, campos secreto y campos extra, verificando que no crashea ni inyecta memoria.

### Task 10: Dashboard Reducer — navegación, estado y transiciones
**Status**: ✅ Complete
**Files Changed**
- `apps/cli/src/tui/pi-runner-dashboard/reducer.ts` — create/modify
- `apps/cli/src/tui/pi-runner-dashboard/state.ts` — modify

**Verification**
- Frontend Tests: pass
- Build: skipped/warn (no hay script de build del workspace)
- Typecheck: pass

**Notes**
Reducer puro implementado y fixes de review frontend aplicados; no se agregaron tests dedicados por scope.

### Task 11: Dashboard Selectors — resúmenes de sección, cursor y compatibilidad
**Status**: ✅ Complete
**Files Changed**
- `apps/cli/src/tui/pi-runner-dashboard/selectors.ts` — create/modify

**Verification**
- Frontend Tests: pass
- Build: skipped/warn (no hay script de build del workspace)
- Typecheck: pass

**Notes**
Selectores puros implementados y fixes de readiness/manual/pending aplicados.

### Task 12: Action Runner — ejecución del plan de revisión
**Status**: ✅ Complete
**Files Changed**
- `apps/cli/src/tui/pi-runner-dashboard/action-runner.ts` — create/modify

**Verification**
- Frontend Tests: pass
- Build: skipped/warn (no hay script de build del workspace)
- Typecheck: pass

**Notes**
Action runner injectable implementado con redacción Supermemory y validaciones de install-pi-package; sin pantallas/app wiring por scope.


### Task 13: Dashboard Screens — UI Ink para todas las secciones
**Status**: ✅ Complete
**Files Changed**
- `apps/cli/src/tui/screens/pi-runner-dashboard-screens.tsx` — create

**Verification**
- Frontend Tests: pass (`bun test apps/cli/src/tui 2>&1 | tail -40`)
- Build: warn (`bun run build` falla porque no existe script `build`)
- Typecheck: pass (`bunx tsc --noEmit --pretty false`)

**Notes**
Pantallas Ink del dashboard implementadas por secciones: overview, Runner Capabilities, Adaptive Memory single-choice, visual helpers, Teams, Developer Team detail, Review & Install, install-progress y complete. Estados se muestran como texto explícito; Mermaid se muestra required/no toggleable con implementación Pi `pi-mermaid` pendiente; `pi-hud` queda optional Pi-only; Supermemory explicita redacción/no secrets.

### Task 14: Modificar app.tsx — shell/router para Pi Runner Dashboard
**Status**: ✅ Complete
**Files Changed**
- `apps/cli/src/tui/app.tsx` — modify

**Verification**
- Frontend Tests: pass (`bun test apps/cli/src/tui 2>&1 | tail -40`)
- Build: warn (`bun run build` falla porque no existe script `build`)
- Typecheck: pass (`bunx tsc --noEmit --pretty false`)

**Notes**
El flujo Pi de Start installation ahora ejecuta preflight/review y navega al dashboard por capabilities en vez del wizard lineal required/optional packages. Home Configure models se conserva. El wiring pasa preflight/review/inventory/runtime al dashboard y ejecuta el review plan con el action-runner. Se mantuvieron pantallas legacy como compatibilidad interna/no principal.

### Task 15: Modificar developer-team-screens.tsx — contexto del dashboard
**Status**: ✅ Complete
**Files Changed**
- `apps/cli/src/tui/screens/developer-team-screens.tsx` — modify

**Verification**
- Frontend Tests: pass (`bun test apps/cli/src/tui 2>&1 | tail -40`)
- Build: warn (`bun run build` falla porque no existe script `build`)
- Typecheck: pass (`bunx tsc --noEmit --pretty false`)

**Notes**
Se agregaron props opcionales de contexto del dashboard (provider Adaptive Memory, capability statuses y retorno) a pantallas de Developer Team/model config. Cuando se accede desde Home no cambia el render ni la semántica provider/model/thinking; desde Developer Team detail se sincronizan asignaciones al dashboard.


### Task 16: Adapter Unit Tests — catálogo, inventario y plan
**Status**: ✅ Complete
**Files Changed**
- `packages/adapter-pi/src/capability-catalog.test.ts` — create
- `packages/adapter-pi/src/capability-inventory.test.ts` — create
- `packages/adapter-pi/src/capability-plan.test.ts` — create

**Verification**
- Backend Tests: pass (`bun test packages/adapter-pi/src/capability-catalog.test.ts packages/adapter-pi/src/capability-inventory.test.ts packages/adapter-pi/src/capability-plan.test.ts packages/adapter-pi/src/developer-team-install.test.ts`)
- Build: fail/warn (`bun run build` falla porque no existe script `build`)
- Typecheck: pass (`bunx tsc --noEmit --pretty false`)

**Notes**
Cobertura agregada para catálogo/exclusiones, inventory statuses, Mermaid vs `pi-mermaid`, `pi-hud` Pi-only, Adaptive Memory none/engram/supermemory, Engram condicional, readiness manual/pending, prerequisites y excluded packages.

### Task 19: Preservation Regression Tests — model config y exclusiones (backend portion)
**Status**: ✅ Complete (backend portion)
**Files Changed**
- `packages/adapter-pi/src/capability-plan.test.ts` — create/modify

**Verification**
- Backend Tests: pass (targeted adapter tests)
- Build: fail/warn (`bun run build` falla porque no existe script `build`)
- Typecheck: pass (`bunx tsc --noEmit --pretty false`)

**Notes**
Se agregaron regresiones backend para que el plan del dashboard no incluya `rpiv-todo`, `rpiv-ask-user-question` ni `context7`; Adaptive Memory None no genere Engram/Supermemory; y `buildDeveloperTeamInstallPlan` con los mismos assignments y `dashboardMemoryProvider` preserve output comparable al path `memoryProvider`. La parte frontend/render de Task 19 queda fuera de este agente.

## In-Progress Tasks

None.

## Blocked Tasks

None.

## Remaining Tasks

- Task 17: TUI Reducer Tests — pending
- Task 18: TUI Render Tests — pending
- Task 19: Preservation Regression Tests — frontend/render portion pending

## Applied Review / Sync History

- Foundation fixes for Tasks 1-2 completed and approved: Mermaid global vs `pi-mermaid` implementation, selected vs required capabilities, stricter model/thinking/tool ID contracts.
- Backend review fixes for Tasks 3-6 completed: team readiness with unresolved required capabilities, future Mermaid ready state respected, tool metadata drift reduced.
- General contract sync completed: TUI `PiRunnerAction` includes `dependencies` and `unresolvedCapabilities`.
- Frontend review fixes for Tasks 10-12 completed and approved: missing piCommand handling, section summary readiness, stale plan invalidation, Supermemory raw redaction, and missing `toolId` fallback removal.
- Backend review fixes for Tasks 7-9 completed: direct Supermemory dashboard resolver validation/fail-closed diagnostics, provider construction try/catch, direct invalid/secret/extra config tests, and external install manual results without piCommand.
- Frontend Tasks 13-15 completed: dashboard screens, Pi shell/router wiring, and Developer Team dashboard context; dedicated render/regression tests remain deferred to Tasks 18-19.
- Backend tests Task 16 and backend portion of Task 19 completed: adapter catalog/inventory/plan coverage and plan preservation regressions added.

## Frontend Review Fix: Tasks 13-15 Findings

### Task 13-15 Review Fixes: Dashboard wiring, navigation, continuity, and observable actions
**Status**: ✅ Complete
**Files Changed**
- `apps/cli/src/tui/app.tsx` — modify
- `apps/cli/src/tui/screens/pi-runner-dashboard-screens.tsx` — modify
- `apps/cli/src/tui/pi-runner-dashboard/state.ts` — modify

**Verification**
- Frontend Tests: pass (`bun test apps/cli/src/tui`)
- Build: warn/fail (`bun run build` falla porque no existe script `build`)
- Typecheck: pass (`bunx tsc --noEmit --pretty false`)

**Notes**
- Adaptive Memory del dashboard ahora abre el subflujo legacy seguro de Supermemory, entrega token a Pi MCP sin persistirlo en Deck config, actualiza `dashboardState.adaptiveMemory.supermemory`, y Review/Install deriva el provider con `resolvePiAdaptiveMemoryProvider` desde el estado del dashboard.
- Review/Install bloquea la ejecución cuando Supermemory no tiene userId/token Pi MCP configurado, y la UI deja de presentar la acción como lista.
- Developer Team detail → Volver a Teams usa `back`, evitando contaminar `backStack`; Esc desde Teams vuelve al dashboard.
- Al completar Pi dashboard se usa `goToNextEnvironmentOrComplete`, preservando continuidad hacia OpenCode cuando corresponde; el texto de complete refleja la acción real.
- “Usar modelos actuales/defaults” ahora carga las asignaciones actuales/defaults en el estado del dashboard y muestra feedback textual.
- Se mantiene Mermaid vs `pi-mermaid` sin cambios y Supermemory sigue redactado/sin secretos en `.deck/config.json`.

## Frontend Review Fix 2: Tasks 13-15 follow-up findings

### Task 13-15 Review Fix 2: Dashboard complete navigation and Review/Install run validation
**Status**: ✅ Complete
**Files Changed**
- `apps/cli/src/tui/app.tsx` — modify
- `apps/cli/src/tui/screens/pi-runner-dashboard-screens.tsx` — modify

**Verification**
- Frontend Tests: pass (`bun test apps/cli/src/tui`)
- Build: warn/fail (`bun run build` falla porque no existe script `build`)
- Typecheck: pass (`bunx tsc --noEmit --pretty false`)

**Notes**
- El complete del dashboard Pi ahora usa un helper post-dashboard específico: continúa a `opencode-preflight-checking` si OpenCode está seleccionado y disponible; si no, vuelve a `home`. Ya no reutiliza `getNextScreenAfterPiToolInstall`, evitando reabrir `team-selection`.
- El texto de complete se calcula desde el mismo helper post-dashboard, manteniendo consistencia entre “continuar con OpenCode” y “finalizar y volver a Home”.
- Review & Install recibe desde `app.tsx` el mismo predicado/diagnósticos de ejecución que el handler (`canRunDashboardPlan` + `resolveDashboardMemoryProvider`), por lo que no muestra “Run executable actions” cuando Supermemory quedaría bloqueado por configuración o diagnósticos del resolver.
- No se cambiaron semánticas de modelos/thinking, no se tocaron contratos backend y no se agregó cobertura dedicada nueva por alcance del fix.

## Frontend Apply Tests: Tasks 17-18 and frontend portion of Task 19

### Task 17: TUI Reducer Tests — navegación, estado y Adaptive Memory
**Status**: ✅ Complete
**Files Changed**
- `apps/cli/src/tui/pi-runner-dashboard/reducer.test.ts` — create

**Verification**
- Frontend Tests: pass (`bun test apps/cli/src/tui`)
- Build: fail/warn (`bun run build` falla porque no existe script `build`)
- Typecheck: pass (`bunx tsc --noEmit --pretty false`)

**Notes**
Cobertura agregada para navegación/back/cursor, toggles de capabilities, Adaptive Memory single-choice/default None/provider switch cleanup, selección/deselección de Developer Team, generación/regeneración de Review Plan y protección contra plan stale.

### Task 18: TUI Render Tests — pantallas del dashboard
**Status**: ✅ Complete
**Files Changed**
- `apps/cli/src/tui/pi-runner-dashboard/render.test.tsx` — create

**Verification**
- Frontend Tests: pass (`bun test apps/cli/src/tui`)
- Build: fail/warn (`bun run build` falla porque no existe script `build`)
- Typecheck: pass (`bunx tsc --noEmit --pretty false`)

**Notes**
Cobertura agregada para overview con 5 secciones, Runner Capabilities configurables, Mermaid required con implementación Pi `pi-mermaid`, pi-hud optional Pi-only, Adaptive Memory None/Engram/Supermemory, Teams/Developer Team consumption, y Review & Install agrupado con estados manual/pending/blocked visibles en texto.

### Task 19: Preservation Regression Tests — model config y exclusiones (frontend portion)
**Status**: ✅ Complete (frontend portion)
**Files Changed**
- `apps/cli/src/tui/screens/developer-team-screens.test.tsx` — create

**Verification**
- Frontend Tests: pass (`bun test apps/cli/src/tui`)
- Build: fail/warn (`bun run build` falla porque no existe script `build`)
- Typecheck: pass (`bunx tsc --noEmit --pretty false`)

**Notes**
Se agregó regresión frontend para preservar Home Configure models sin contexto de dashboard, y para verificar que el contexto opcional del dashboard solo agrega información de provider/capability/return label sin cambiar el render de provider/model/thinking. No se tocaron tests backend/adapter de Task 19.

## Remaining Tasks Update

- Task 16: Adapter Unit Tests — pending (fuera de este scope frontend)
- Task 19: Preservation Regression Tests — backend/adapter portion pending (fuera de este scope); frontend portion complete


## Backend Tests Review Fix: Tasks 16-19 findings

### Task 16/19: Supermemory security, structural plan assertions, and Developer Team frontmatter preservation
**Status**: ✅ Complete
**Files Changed**
- `packages/adapter-pi/src/capability-plan.ts` — modify
- `packages/adapter-pi/src/capability-catalog.test.ts` — modify
- `packages/adapter-pi/src/capability-plan.test.ts` — modify
- `packages/adapter-pi/src/developer-team-install.test.ts` — modify
- `apps/cli/src/tui/pi-runner-dashboard/action-runner.test.ts` — create

**Verification**
- Backend Tests: pass (`bun test packages/adapter-pi/src/capability-catalog.test.ts packages/adapter-pi/src/capability-inventory.test.ts packages/adapter-pi/src/capability-plan.test.ts packages/adapter-pi/src/developer-team-install.test.ts apps/cli/src/tui/pi-runner-dashboard/action-runner.test.ts`)
- Build: fail/warn (`bun run build` falla porque no existe script `build`)
- Typecheck: pass (`bunx tsc --noEmit --pretty false`)

**Notes**
Se cerraron los findings de `review-tests-output.md`: Supermemory con `hasToken=true` pero sin `userId` queda no listo con config/validación pending y warning; se agregó regresión de token sentinela para Deck config no secreta/Pi MCP redaction en action-runner; se fortalecieron aserciones estructurales de catálogo/plan para `capabilityId`, `toolId`, `kind`, `source`, grupos y diagnósticos; y se agregó regresión backend de preservación de frontmatter modelo/thinking con `openai-codex/gpt-5.5` thinking explícito y `opencode-go/kimi-k2.6` forzado a `thinking: off`.

## Frontend Tests Review Fix: `review-tests-output.md` findings

### Tasks 17-19: Supermemory redaction, model-config preservation, and input/handler mapping coverage
**Status**: ✅ Complete
**Files Changed**
- `apps/cli/src/tui/pi-runner-dashboard/action-runner.ts` — modify
- `apps/cli/src/tui/pi-runner-dashboard/action-runner.test.ts` — modify
- `apps/cli/src/tui/pi-runner-dashboard/input-handler.ts` — create
- `apps/cli/src/tui/pi-runner-dashboard/input-handler.test.ts` — create
- `apps/cli/src/tui/pi-runner-dashboard/render.test.tsx` — modify
- `apps/cli/src/tui/screens/pi-runner-dashboard-screens.tsx` — modify
- `apps/cli/src/tui/screens/developer-team-screens.test.tsx` — modify

**Verification**
- Frontend Tests: pass (`bun test apps/cli/src/tui/pi-runner-dashboard/action-runner.test.ts apps/cli/src/tui/pi-runner-dashboard/input-handler.test.ts apps/cli/src/tui/pi-runner-dashboard/reducer.test.ts apps/cli/src/tui/pi-runner-dashboard/render.test.tsx apps/cli/src/tui/screens/developer-team-screens.test.tsx`)
- Build: fail/warn (`bun run build` falla porque no existe script `build`)
- Typecheck: pass (`bunx tsc --noEmit --pretty false`)

**Notes**
Se cerraron los findings frontend de `review-tests-output.md`: cobertura dashboard-specific para redacción de token sentinela en render/action-runner y bloqueo fail-closed de Review & Install cuando Supermemory carece de `userId`/config/token; regresión más realista de preservación de frontmatter provider/model/thinking desde el dashboard comparada contra Home; y helper/test de input mapping para cursor/handlers críticos: dashboard→sección, toggle `pi-hud`, Supermemory abre setup/bloquea run, Developer Team detail/back, Review & Install blocked/unblocked. No se cambiaron contratos backend ni semánticas de modelo/thinking; los cambios de producto fueron mínimos para testability/redacción/bloqueo seguro.


## Frontend Tests Review Fix 2: `review-tests-fix-output.md` findings

### Tasks 17-19: Real dashboard boundary coverage and app input handler wiring
**Status**: ✅ Complete
**Files Changed**
- `apps/cli/src/tui/app.tsx` — modify
- `apps/cli/src/tui/pi-runner-dashboard/action-runner.test.ts` — modify

**Verification**
- Frontend Tests: pass (`bun test apps/cli/src/tui/pi-runner-dashboard/action-runner.test.ts apps/cli/src/tui/pi-runner-dashboard/input-handler.test.ts apps/cli/src/tui/pi-runner-dashboard/reducer.test.ts apps/cli/src/tui/pi-runner-dashboard/render.test.tsx apps/cli/src/tui/screens/developer-team-screens.test.tsx packages/adapter-pi/src/developer-team-install.test.ts`)
- Workspace Tests: pass (`bun test`)
- Build: fail/warn (`bun run build` falla porque no existe script `build`)
- Typecheck: pass (`bunx tsc --noEmit --pretty false`)

**Notes**
Se cerraron los findings de `review-tests-fix-output.md`: `app.tsx` ahora usa `getPiRunnerDashboardContinueEffect`/`getPiRunnerDashboardToggleAction` como fuente de verdad para el handler real, preservando los efectos especiales de Supermemory setup, Developer Team model config/reuse, bloqueo de Review/Install y complete. Se agregó regresión de `apply-team-bundle` que cruza `dashboardState.teams["developer-team"].modelAssignments/thinkingAssignments` → `runPiRunnerAction` → `buildDeveloperTeamInstallPlan`/apply stub y compara el frontmatter observable contra Home/Configure Models para `openai-codex/gpt-5.5` + `thinking: high` y `opencode-go/kimi-k2.6` + `thinking: off`.

## Final Review Fix: Supermemory Review & Install boundary

### Final Review BLOCKER: Supermemory credential persistence and provider resolution order
**Status**: ✅ Complete
**Files Changed**
- `apps/cli/src/tui/app.tsx` — modify
- `apps/cli/src/tui/pi-runner-dashboard/action-runner.ts` — modify
- `apps/cli/src/tui/screens/pi-runner-dashboard-screens.tsx` — modify
- `apps/cli/src/tui/pi-runner-dashboard/action-runner.test.ts` — modify
- `apps/cli/src/tui/pi-runner-dashboard/render.test.tsx` — modify

**Verification**
- Frontend Tests: pass (`bun test apps/cli/src/tui/pi-runner-dashboard/action-runner.test.ts apps/cli/src/tui/pi-runner-dashboard/render.test.tsx apps/cli/src/tui/pi-runner-dashboard/input-handler.test.ts apps/cli/src/tui/pi-runner-dashboard/reducer.test.ts apps/cli/src/tui/screens/developer-team-screens.test.tsx apps/cli/src/tui/developer-team-flow.test.tsx apps/cli/src/pi-launch-command.direct-supermemory.test.ts apps/cli/src/pi-launch-command.test.ts apps/cli/src/pi-launch-command.supermemory.test.ts packages/adapter-supermemory/src/index.test.ts packages/adapter-pi/src/developer-team-install.test.ts`)
- Workspace Tests: pass (`bun test` — 774 pass)
- Build: fail/warn (`bun run build` falla porque no existe script `build`)
- Typecheck: pass (`bunx tsc --noEmit --pretty false`)

**Notes**
- El setup de Supermemory del dashboard ya no llama `handOffSupermemoryCredentialToPiMcp` ni escribe `~/.pi/agent/mcp.json`; guarda solo estado no secreto/redactado en `dashboardState` y conserva el token únicamente en estado efímero de React hasta Run.
- `runPiRunnerReviewPlan` ahora ejecuta `configWrites` primero, escribe Pi MCP config dentro de la acción visible `write-pi-mcp-config`, resuelve/construye el provider después de esa escritura y antes de `apply-team-bundle`, y bloquea la aplicación del team si el provider no se puede resolver.
- El token efímero se limpia al completar/cancelar el flujo de instalación del dashboard; no se escribe en Deck config ni se renderiza en pantallas/diagnósticos.
- La pantalla complete ahora muestra mensajes y diagnósticos redactados; se eliminó la prop muerta `dispatch` de `PiRunnerDashboardScreens`.
- No se cambiaron decisiones Mermaid/pi-mermaid/pi-hud ni semánticas de modelos/thinking.


## Final Fix 2: Supermemory token lifecycle and informative diagnostics

### Final Fix 2: verify-final-fix failure + review-final-fix major/minor
**Status**: ✅ Complete
**Files Changed**
- `apps/cli/src/tui/app.tsx` — modify
- `apps/cli/src/tui/pi-runner-dashboard/action-runner.ts` — modify
- `apps/cli/src/tui/pi-runner-dashboard/input-handler.ts` — modify
- `apps/cli/src/tui/pi-runner-dashboard/action-runner.test.ts` — modify
- `apps/cli/src/tui/pi-runner-dashboard/input-handler.test.ts` — modify

**Verification**
- Frontend Tests: pass (`bun test apps/cli/src/tui/pi-runner-dashboard/action-runner.test.ts apps/cli/src/tui/pi-runner-dashboard/render.test.tsx apps/cli/src/tui/pi-runner-dashboard/input-handler.test.ts apps/cli/src/tui/pi-runner-dashboard/reducer.test.ts apps/cli/src/tui/screens/developer-team-screens.test.tsx apps/cli/src/tui/developer-team-flow.test.tsx apps/cli/src/pi-launch-command.direct-supermemory.test.ts apps/cli/src/pi-launch-command.test.ts apps/cli/src/pi-launch-command.supermemory.test.ts packages/adapter-supermemory/src/index.test.ts packages/adapter-pi/src/developer-team-install.test.ts`)
- Build: fail/warn (`bun run build` falla porque no existe script `build`)
- Typecheck: pass (`bunx tsc --noEmit --pretty false`)

**Notes**
- `runPiRunnerReviewPlan` ya no trata el diagnóstico informativo exacto de `buildDashboardSupermemorySetupUpdate()` como blocker; la regresión usa esa salida real y verifica orden `write-pi-mcp-config` → resolver provider → aplicar Developer Team.
- El preflight de Run exige token efímero real además de `hasToken`; si `hasToken=true` pero falta `supermemorySetup.token`, bloquea antes de escribir config. La acción `write-pi-mcp-config` sin token ahora falla para el handoff requerido.
- La limpieza/cancelación/salida del dashboard invalida `hasToken/configured` junto con el token efímero para evitar UI lista con token ausente.
- El redactor del action-runner cubre tokens standalone `sk-sm-*` y se agregó regresión.
- El texto stale de bloqueo de Review & Install ahora dice que el token se captura efímeramente y Pi MCP config se escribe durante Review & Install.
- No se reintrodujo persistencia antes de Run; no se cambiaron modelos/thinking ni decisiones Mermaid/pi-hud.
