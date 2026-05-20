# Tasks: Dashboard por capacidades para Pi Runner

## Source

- Spec: `pi-runner-capability-dashboard` spec artifact
- Design: `pi-runner-capability-dashboard` design artifact
- Capabilities affected: `pi-runner-capability-dashboard`, `pi-runner-global-capabilities`, `pi-runner-adaptive-memory-selection`, `pi-runner-ui-visual-helpers`, `pi-runner-team-configuration`, `pi-runner-install-review-plan`, `pi-runner-installation-flow`, `developer-team-installation`, `developer-team-model-configuration`, `adaptive-memory-configuration`

## Task Groups

### Group: Shared / Contracts

#### Task 1: Capability Catalog — tipos y metadatos de capabilities

**Owner**: General Apply
**Priority**: P0
**Complexity**: Medium
**Parallel**: Yes
**Depends on**: none

**Description**
Crear `packages/adapter-pi/src/capability-catalog.ts` con los tipos y la constante catálogo de capabilities del dashboard. Incluir: `CapabilityId` (`"rtk" | "context-mode" | "codebase-memory" | "pi-hud" | "runner-mermaid"`), `RunnerScope`, `CapabilityRequirementLevel`, `CapabilityStatus`, `TechnicalActionKind`, `CapabilityToolMapping`, y la constante `PI_RUNNER_CAPABILITY_CATALOG` que mapea cada capability a su sección, alcance, nivel de requisito, tool, source, installKind y detector placeholder. Excluir `@juicesharp/rpiv-todo` y `@juicesharp/rpiv-ask-user-question` del catálogo; excluir `context7` del dashboard visible. `runner-mermaid` es `required` con `installKind: "pending"` y `source: "TBD"` (placeholder hasta decisión canónica). `pi-hud` es `optional` con `runnerScope: "pi"` e `installKind: "pending"`. Los pré-requisites `sub-agents` y `mcp-packages` NO son capabilities user-facing pero sí se incluirán como acciones automáticas en el plan.

**Files**
- `packages/adapter-pi/src/capability-catalog.ts` — create

**Verification**
- El catálogo exporta tipos y constante sin errores de compilación.
- `runner-mermaid` aparece con `requirementLevel: "required"` y `installKind: "pending"`.
- `pi-hud` aparece con `runnerScope: "pi"` y `requirementLevel: "optional"`.
- No aparecen rpiv-todo, rpiv-ask-user-question, ni context7 como entries del catálogo.
- `engram-memory` no aparece como capability global; solo como acción técnica cuando Adaptive Memory = Engram.

---

#### Task 2: Dashboard State — tipos de estado y pantallas

**Owner**: General Apply
**Priority**: P0
**Complexity**: Low
**Parallel**: Yes
**Depends on**: none

**Description**
Crear `apps/cli/src/tui/pi-runner-dashboard/state.ts` con los tipos de estado del dashboard: `PiRunnerDashboardScreen` (nombres de pantalla), `AdaptiveMemoryProviderChoice` (`"none" | "engram" | "supermemory"`), `PiRunnerTeamState`, `PiRunnerDashboardState`, `PiRunnerReviewPlan`, `PiRunnerAction`, `PiRunnerPlanDiagnostic`, `TeamCapabilityConsumption`, `TeamCapabilityProfile`, y tipos auxiliares de Supermemory setup. El estado de `adaptiveMemory.provider` default debe ser `"none"`. Las pantallas deben corresponder al diseño: `dashboard`, `runner-capabilities-detail`, `adaptive-memory-detail`, `runner-ui-visual-helpers-detail`, `teams-detail`, `developer-team-detail`, `review-plan`, `install-progress`, `complete`.

**Files**
- `apps/cli/src/tui/pi-runner-dashboard/state.ts` — create

**Verification**
- Los tipos compilan sin errores.
- `AdaptiveMemoryProviderChoice` acepta exactamente `"none" | "engram" | "supermemory"`.
- `PiRunnerDashboardState.adaptiveMemory.provider` es de tipo `AdaptiveMemoryProviderChoice` con default `"none"`.
- Las pantallas incluyen las 9 pantallas del diseño.

---

### Group: Backend

#### Task 3: Capability Inventory Builder

**Owner**: Backend Apply
**Priority**: P1
**Complexity**: Medium
**Parallel**: No — depende de Task 1
**Depends on**: Task 1

**Description**
Crear `packages/adapter-pi/src/capability-inventory.ts` con la función `buildPiRunnerCapabilityInventory(review, preflight, config)` que mapea los resultados de `reviewPiRequiredTools` y el entorno Pi a estados de capability (`ready`, `missing`, `manual`, `pending-source`, `blocked`). `runner-mermaid` debe mapearse a `pending-source` para Pi (con implementación `pi-mermaid` hasta que se confirme source) y a `blocked` para OpenCode (mapping TBD). `pi-hud` debe mapearse a `pending-source` solo para Pi. Las capabilities externas (`rtk`, `codebase-memory`) que no estén instaladas se mapean a `manual`. Las capabilities ya instaladas se mapean a `ready`. `engram-memory` no se incluye como capability global; solo se deriva como acción técnica cuando el provider es `engram`.

**Files**
- `packages/adapter-pi/src/capability-inventory.ts` — create

**Verification**
- Para un review donde `context-mode` está instalado y `rtk` no está instalado, `inventory["context-mode"]` = `"ready"` e `inventory["rtk"]` = `"manual"`.
- `runner-mermaid` retorna `pending-source` para Pi y `blocked` para OpenCode.
- `pi-hud` retorna `pending-source` para Pi y no se incluye para OpenCode.
- Si una capability no tiene detector/source, retorna `pending-source` o `blocked` según corresponda, nunca `ready`.

---

#### Task 4: Capability Plan Builder

**Owner**: Backend Apply
**Priority**: P1
**Complexity**: High
**Parallel**: No — depende de Tasks 1, 2
**Depends on**: Task 1, Task 2

**Description**
Crear `packages/adapter-pi/src/capability-plan.ts` con `buildPiRunnerReviewPlan(state, inventory)` que genera el `PiRunnerReviewPlan` agrupado en: `automaticInstalls`, `manualSteps`, `configWrites`, `teamApplications`, `validations`. Incluir `diagnostics` para capabilities con estado `pending-source`, `blocked`, `manual`. Si `adaptiveMemory.provider === "engram"`, agregar `engram-memory` como acción técnica derivada manual/external. Si `adaptiveMemory.provider === "supermemory"`, generar acciones de escritura de config no-secreta y validación, sin acciones de paquete. Si `adaptiveMemory.provider === "none"`, no generar acciones de Engram ni Supermemory. Incluir `sub-agents` y `mcp-packages` como `automaticInstalls` automáticas de prerequisito. Excluir `@juicesharp/rpiv-todo`, `@juicesharp/rpiv-ask-user-question` y `context7` del plan. `runner-mermaid` genera una acción `pending-source`/bloqueante para Pi (con diagnóstico que nombra `pi-mermaid` como implementación Pi) y una acción `blocked` con diagnóstico TBD para OpenCode. `pi-hud` genera una acción `pending-source` opcional solo para Pi.

**Files**
- `packages/adapter-pi/src/capability-plan.ts` — create

**Verification**
- Plan con `provider === "none"` no incluye acciones de Engram ni Supermemory.
- Plan con `provider === "engram"` incluye `engram-memory` como acción manual.
- Plan con `provider === "supermemory"` incluye acciones de config write y validación, sin package install.
- Cambiar de `engram` a `supermemory` elimina acciones Engram y agrega acciones Supermemory.
- Plan no incluye rpiv-todo, rpiv-ask-user-question, ni context7.
- `runner-mermaid` aparece como acción pending-source/bloqueante con diagnóstico `pi-mermaid` para Pi.
- Plan con actions `pending-source`, `manual` o `blocked` no se declara completamente listo.

---

#### Task 5: Modificar installation-plan.ts — exponer metadatos de tool para el catálogo de capabilities

**Owner**: Backend Apply
**Priority**: P1
**Complexity**: Low
**Parallel**: No — depende de Task 1
**Depends on**: Task 1

**Description**
Modificar `packages/adapter-pi/src/installation-plan.ts` para exponer los metadatos de `PI_INSTALLABLE_TOOLS` de forma que el capability catalog y el plan builder puedan consumirlos sin hacer el dashboard dependiente de la representación por paquetes. Agregar un `CapabilityToolMapping[]` derivado o un helper que mapee las herramientas existentes a capabilities. Mantener la API legacy `buildPiInstallationPlan` sin cambios para backward compatibility. Agregar inline documentation que marque `engram-memory` como legacy tool que ya no es capability global seleccionable.

**Files**
- `packages/adapter-pi/src/installation-plan.ts` — modify

**Verification**
- `buildPiInstallationPlan` existente sigue funcionando con los mismos tests.
- El nuevo helper/mapping permite al plan builder resolving `context-mode`, `codebase-memory`, `rtk`, `sub-agents`, `mcp-packages` desde las herramientas existentes.
- `engram-memory` sigue en el typo `InstallablePiToolId` para backward compat pero está documentado como derivado del provider de memoria.

---

#### Task 6: Modificar required-tools.ts — alimentar inventario de capabilities

**Owner**: Backend Apply
**Priority**: P1
**Complexity**: Low
**Parallel**: No — depende de Task 1
**Depends on**: Task 1

**Description**
Modificar `packages/adapter-pi/src/required-tools.ts` para que el resultado de `reviewPiRequiredTools` pueda ser consumido por el inventory builder sin romper el formato existente. No agregar detectores para `pi-mermaid` ni `pi-hud` todavía; estos quedan con estado `pending-source` en el inventory builder (Task 3) hasta que se confirme fuente/detector canónico. Agregar estructura para futuros detectores respetando: `runner-mermaid` es capability obligatorio del runner y `pi-mermaid` es implementación Pi; `pi-hud` es opcional Pi-only.

**Files**
- `packages/adapter-pi/src/required-tools.ts` — modify

**Verification**
- `reviewPiRequiredTools` existente sigue retornando el mismo formato.
- El inventory builder puede mapear nombres de herramientas instaladas a capabilities.
- No se agregan detectores no confirmados para pi-mermaid o pi-hud.

---

#### Task 7: Modificar install-tools.ts — alinear acciones manuales con semántica del Review Plan

**Owner**: Backend Apply
**Priority**: P2
**Complexity**: Low
**Parallel**: No — depende de Task 4
**Depends on**: Task 4

**Description**
Modificar `packages/adapter-pi/src/install-tools.ts` para que las herramientas externas que no pueden ser instaladas automáticamente produzcan resultados claros de "paso manual" en vez de errores genéricos de instalación. Alinear los tipos de resultado con `TechnicalActionKind` del plan builder. Las herramientas con `installKind: "external"` ya existentes (`rtk`, `codebase-memory`) deben producir resultados `manual-external-install`, no fallidos.

**Files**
- `packages/adapter-pi/src/install-tools.ts` — modify

**Verification**
- Herramientas externas que no se pueden instalar automáticamente retornan resultado `manual` en vez de error.
- Las herramientas Pi-package (`pi install <source>`) siguen funcionando como antes.
- Los tipos de resultado son compatibles con `TechnicalActionKind`.

---

#### Task 8: Modificar developer-team-install.ts — consumir provider de Adaptive Memory desde el dashboard

**Owner**: Backend Apply
**Priority**: P1
**Complexity**: Medium
**Parallel**: No — depende de Task 4
**Depends on**: Task 4

**Description**
Modificar `packages/adapter-pi/src/developer-team-install.ts` para aceptar un `memoryProvider` resuelto desde el dashboard state y no solo desde createMemoryProviderForSelection. Esto permite inyectar Supermemory correctamente durante la instalación del Developer Team cuando el usuario selecciona Supermemory en el dashboard. Preservar el comportamiento existente de provider/model/thinking y de `buildDeveloperTeamInstallPlan`.

**Files**
- `packages/adapter-pi/src/developer-team-install.ts` — modify

**Verification**
- El parámetro `memoryProvider` se puede pasar desde el dashboard state.
- Si no se proporciona, el comportamiento existente se mantiene.
- `supportsThinkingForModel` y `supportsDeveloperTeamModel` no cambian.
- La compatibilidad de modelos por agente se preserva.

---

#### Task 9: Modificar pi-launch-command.ts — compartir resolución de provider con TUI

**Owner**: Backend Apply
**Priority**: P2
**Complexity**: Medium
**Parallel**: No — depende de Task 8
**Depends on**: Task 8

**Description**
Modificar `apps/cli/src/pi-launch-command.ts` para extraer o exponer la lógica de resolución de provider de memoria adaptativa (Engram/Supermemory) de forma que el path de launch y el path de TUI install compartan la misma validación y construcción de provider. Específicamente, cuando Adaptive Memory = Supermemory, la TUI debe poder construir un Supermemory provider para inyección inmediata en el Developer Team, consistente con lo que hace el launch path.

**Files**
- `apps/cli/src/pi-launch-command.ts` — modify

**Verification**
- Existe un helper compartido o una función expuesta que construye providers de memoria desde config del dashboard.
- El launch path existente sigue funcionando.
- Supermemory se valida y construye consistentemente entre TUI install y launch.

---

### Group: Frontend

#### Task 10: Dashboard Reducer — navegación, estado y transiciones

**Owner**: Frontend Apply
**Priority**: P0
**Complexity**: Medium
**Parallel**: No — depende de Task 2
**Depends on**: Task 2

**Description**
Crear `apps/cli/src/tui/pi-runner-dashboard/reducer.ts` con la función `reduce(state, action)` que maneja: navegación entre pantallas del dashboard, cursor por sección, toggles de capabilities, selección single-choice de Adaptive Memory (`none` → `engram`, `engram` → `supermemory`, etc.), selección/deselección de Developer Team, y entrada/salida de Review & Install con regeneración del plan. Al cambiar de provider de Adaptive Memory, el reducer debe limpiar la config del provider previo y preparar la del nuevo provider. Al entrar a Review & Install, debe invocar `buildPiRunnerReviewPlan`. Al volver a una sección desde Review & Install, debe conservar las selecciones no modificadas.

**Files**
- `apps/cli/src/tui/pi-runner-dashboard/reducer.ts` — create

**Verification**
- Navegar de dashboard → sección → dashboard conserva selecciones previas.
- Cambiar Adaptive Memory de `engram` a `supermemory` remueve config de Engram.
- Cambiar Adaptive Memory a `none` remueve todas las acciones de memoria.
- Seleccionar Developer Team habilita acceso a model config.
- Deseleccionar Developer Team elimina team del plan.
- Entrar a Review & Install genera el plan correctamente.
- Volver a una sección desde Review & Install y volver a Review & Install regenera el plan.

---

#### Task 11: Dashboard Selectors — resúmenes de sección, cursor y compatibilidad

**Owner**: Frontend Apply
**Priority**: P1
**Complexity**: Medium
**Parallel**: No — depende de Tasks 1, 2
**Depends on**: Task 1, Task 2

**Description**
Crear `apps/cli/src/tui/pi-runner-dashboard/selectors.ts` con selectores puros que computan: resumen de estado por sección (cuántas capabilities seleccionadas, estado de readiness, cantidad de acciones), límites de cursor por pantalla, resumen de compatibilidad/consumo de capabilities por team (`TeamCapabilityProfile`), y contadores de acciones por grupo en el plan. Los selectores deben ser funciones puras que reciben `PiRunnerDashboardState` e inventory y retornan datos derivados sin efectos secundarios.

**Files**
- `apps/cli/src/tui/pi-runner-dashboard/selectors.ts` — create

**Verification**
- Selector de resumen de Runner Capabilities muestra RTK/context-mode/codebase-memory como configurables, runner-mermaid como required, pi-hud como optional Pi-only.
- Selector de Adaptive Memory muestra el provider seleccionado con default `none`.
- Selector de compatibilidad de team muestra qué capabilities consume directamente y cuáles están disponibles en el runner.
- Selector de plan cuenta acciones por grupo (automatic, manual, config, team, validation).

---

#### Task 12: Action Runner — ejecución del plan de revisión

**Owner**: Frontend Apply
**Priority**: P1
**Complexity**: Medium
**Parallel**: No — depende de Tasks 4, 10
**Depends on**: Task 4, Task 10

**Description**
Crear `apps/cli/src/tui/pi-runner-dashboard/action-runner.ts` con funciones que toman un `PiRunnerReviewPlan` y ejecutan las acciones agrupadas usando los installers/config-writers/team-apply existentes. Las acciones `install-pi-package` llaman a `installPiTools`. Las acciones `manual-external-install` producen resultado informativo sin intentar instalación. Las acciones `write-deck-config` escriben config no-secreta. Las acciones `write-pi-mcp-config` manejan credenciales de Supermemory con redacción. Las acciones `apply-team-bundle` llaman a `applyDeveloperTeamInstall`. Las acciones `validate` verifican resultados post-instalación. Las acciones `noop` o `pending-source` se muestran como información sin ejecución.

**Files**
- `apps/cli/src/tui/pi-runner-dashboard/action-runner.ts` — create

**Verification**
- Acción `install-pi-package` ejecuta `pi install <source>` para sub-agents, mcp-packages, context-mode.
- Acción `manual-external-install` retorna resultado informativo sin ejecutar.
- Acción `write-pi-mcp-config` redact tokens de Supermemory en diagnostics.
- Acción `apply-team-bundle` llama a funciones existentes de Developer Team.
- Acción `pending-source` se presenta como paso pendiente, no como error.

---

#### Task 13: Dashboard Screens — UI Ink para todas las secciones

**Owner**: Frontend Apply
**Priority**: P0
**Complexity**: High
**Parallel**: No — depende de Tasks 10, 11, 3
**Depends on**: Task 3, Task 10, Task 11

**Description**
Crear `apps/cli/src/tui/screens/pi-runner-dashboard-screens.tsx` con las pantallas Ink del dashboard: (1) pantalla principal con resumen por sección y contadores de acción, (2) Runner Capabilities detail con toggles para RTK/context-mode/codebase-memory y estado de Mermaid required y pi-hud optional, (3) Adaptive Memory detail con single-choice None/Engram/Supermemory, (4) Runner UI/visual helpers detail con pi-hud opcional y Mermaid obligatorio con estado pending, (5) Teams detail con Developer Team seleccionable y compatibilidad/consumo de capabilities, (6) Developer Team detail con acceso a model config existente, (7) Review & Install con acciones agrupadas y separación de automáticas/manuales/config/team/validación, (8) install-progress, (9) complete. Cada pantalla debe usar el reducer para manejar acciones y los selectors para obtener datos derivados. Accesibilidad: cada sección debe mostrar estado en texto, no solo color.

**Files**
- `apps/cli/src/tui/screens/pi-runner-dashboard-screens.tsx` — create

**Verification**
- Dashboard principal muestra 5 secciones con estado y contadores.
- Runner Capabilities permite toggle de capabilities configurables (no Mermaid, que es required).
- Adaptive Memory permite exactamente una selección: None/Engram/Supermemory, default None.
- Runner UI/visual helpers muestra Mermaid como required pending y pi-hud como optional Pi-only.
- Teams muestra Developer Team seleccionable con consumo de capabilities.
- Review & Install separa automáticas, manuales, config, team y validación.
- Manuales y pendientes no se presentan como instalación automática lista.
- Mermaid se muestra como concepto obligatorio, no como paquete opcional.

---

#### Task 14: Modificar app.tsx — shell/router para Pi Runner Dashboard

**Owner**: Frontend Apply
**Priority**: P0
**Complexity**: Medium
**Parallel**: No — depende de Task 13
**Depends on**: Task 13

**Description**
Modificar `apps/cli/src/tui/app.tsx` para reducirlo a shell/router: el flujo Pi usa el nuevo dashboard en vez del wizard lineal por paquetes. Preservar la ruta existente `Configure models` desde Home. Pasar IO adapters (detección, preflight, review) al dashboard module. Eliminar el wizard lineal de Pi del flujo principal, pero mantener las funciones/subrutas existentes necesarias para compatibilidad hasta que los tests del dashboard las cubran.

**Files**
- `apps/cli/src/tui/app.tsx` — modify
- `apps/cli/src/menu-options.ts` — modify (si aplica)

**Verification**
- Home menu sigue teniendo `Configure models`.
- `Start installation` → Pi selecciona → navega al dashboard por capabilities.
- El wizard lineal por paquetes ya no es el flujo principal de Pi.
- Las pantallas de model config existentes siguen accesibles desde Developer Team detail y desde Home.

---

#### Task 15: Modificar developer-team-screens.tsx — contexto del dashboard

**Owner**: Frontend Apply
**Priority**: P1
**Complexity**: Medium
**Parallel**: No — depende de Task 13
**Depends on**: Task 13

**Description**
Modificar `apps/cli/src/tui/screens/developer-team-screens.tsx` para aceptar props del contexto del dashboard: estado de Adaptive Memory provider seleccionado, estado de capabilities relevantes al Developer Team, y navegación de vuelta al dashboard. Las pantallas existentes de provider/model/thinking se reutilizan sin cambios de semántica. Solo se agregan props de conexión/sync con el dashboard state.

**Files**
- `apps/cli/src/tui/screens/developer-team-screens.tsx` — modify

**Verification**
- Las pantallas de model config existentes se renderizan igual cuando se accede desde Home `Configure models`.
- Cuando se accede desde Developer Team detail, reciben el provider de Adaptive Memory seleccionado en el dashboard.
- La semántica de provider/model/thinking no cambia.
- El comportamiento de `supportsThinkingForModel` y `supportsDeveloperTeamModel` se preserva.

---

### Group: Tests

#### Task 16: Adapter Unit Tests — catálogo, inventario y plan

**Owner**: Backend Apply
**Priority**: P0
**Complexity**: Medium
**Parallel**: No — depende de Tasks 1, 3, 4
**Depends on**: Task 1, Task 3, Task 4

**Description**
Crear `packages/adapter-pi/src/capability-catalog.test.ts`, `capability-inventory.test.ts`, y `capability-plan.test.ts` con cobertura de: catálogo excluye rpiv-todo/ask-user y context7; default adaptive-memory es `none`; `engram-memory` aparece solo cuando `adaptiveMemory.provider === "engram"`; `runner-mermaid` es required con implementación `pi-mermaid` para Pi y TBD para OpenCode; `pi-hud` es optional Pi-only; herramientas externas producen acciones manuales no fallidas; plan con `provider === "none"` no incluye acciones de Engram ni Supermemory; cambiar de provider remueve acciones del previo; plan no incluye paquetes excluidos; plan con pendientes/manuales no se declara listo.

**Files**
- `packages/adapter-pi/src/capability-catalog.test.ts` — create
- `packages/adapter-pi/src/capability-inventory.test.ts` — create
- `packages/adapter-pi/src/capability-plan.test.ts` — create

**Verification**
- Tests pasan y cubren los escenarios de aceptación del Spec: Default None, Engram habilita installability, Engram desaparece al cambiar de provider, Supermemory requiere configuración segura, Mermaid concept vs pi-mermaid, pi-hud Pi-only, plan no incluye excluidos, plan con manuales no se declara listo.

---

#### Task 17: TUI Reducer Tests — navegación, estado y Adaptive Memory

**Owner**: Frontend Apply
**Priority**: P0
**Complexity**: Medium
**Parallel**: No — depende de Task 10
**Depends on**: Task 10

**Description**
Crear `apps/cli/src/tui/pi-runner-dashboard/reducer.test.ts` con tests de: navegación entre secciones conserva estado; back stack funciona correctamente; cursor se limita por sección; toggle de capabilities RTK/context-mode/codebase-memory; Adaptive Memory single-choice (solo un provider activo); default None; cambiar de provider limpia config previo; selección/deselección de Developer Team; entrada/salida de Review & Install con regeneración de plan.

**Files**
- `apps/cli/src/tui/pi-runner-dashboard/reducer.test.ts` — create

**Verification**
- Navegación dashboard → sección → dashboard conserva selecciones.
- Cambio de Adaptive Memory de Engram a None remueve acciones de Engram.
- Cambio de Adaptive Memory de Engram a Supermemory remueve Engram y prepara Supermemory.
- Developer Team seleccionable y deseleccionable.
- Review & Install regenera plan después de cambios.

---

#### Task 18: TUI Render Tests — pantallas del dashboard

**Owner**: Frontend Apply
**Priority**: P1
**Complexity**: Medium
**Parallel**: No — depende de Task 13
**Depends on**: Task 13

**Description**
Crear `apps/cli/src/tui/pi-runner-dashboard/render.test.tsx` con tests de renderizado de: pantalla principal del dashboard con secciones y contadores; Runner Capabilities con Mermaid mandatory y pi-hud optional Pi-only; Adaptive Memory con None/Engram/Supermemory single-choice; Teams con Developer Team y consumo de capabilities; Review & Install con acciones agrupadas. Verificar que estados manuales y pendientes se muestran en texto (no solo color) y que Mermaid se muestra como concepto obligatorio distinto de pi-mermaid como implementación Pi.

**Files**
- `apps/cli/src/tui/pi-runner-dashboard/render.test.tsx` — create

**Verification**
- Dashboard principal muestra 5 secciones con nombres correctos.
- Runner Capabilities muestra RTK/context-mode/codebase-memory como configurables, Mermaid como required, pi-hud como optional.
- Adaptive Memory muestra 3 opciones con None seleccionado por default.
- Review & Install separa automáticas, manuales, config, team y validación.
- Estados manuales/pendientes se muestran como texto visible.

---

#### Task 19: Preservation Regression Tests — model config y exclusiones

**Owner**: General Apply
**Priority**: P1
**Complexity**: Low
**Parallel**: No — depende de Tasks 4, 15
**Depends on**: Task 4, Task 15

**Description**
Crear tests de regresión que verifiquen: (1) La configuración de modelos por agente desde Developer Team detail produce el mismo frontmatter provider/model/thinking que la ruta existente de `Configure models`. (2) `buildDeveloperTeamInstallPlan` con los mismos model assignments produce el mismo resultado desde el dashboard que desde la ruta existente. (3) El plan del dashboard no incluye rpiv-todo, rpiv-ask-user-question, ni context7. (4) Cuando Adaptive Memory = None, el plan no incluye acciones de Engram ni Supermemory.

**Files**
- `packages/adapter-pi/src/capability-plan.test.ts` — modify (agregar casos de regresión)
- `apps/cli/src/tui/screens/developer-team-screens.test.tsx` — create o modify

**Verification**
- Model config desde dashboard produce el mismo output que desde Home `Configure models`.
- Plan excluye rpiv-todo, rpiv-ask-user-question, context7.
- Adaptive Memory = None → plan sin acciones de Engram ni Supermemory.
- Tests existentes de model config siguen pasando.

---

## Dependency Graph

```
Task 1 (Shared: Capability Catalog)
  → Task 3 (Backend: Capability Inventory)
  → Task 4 (Backend: Capability Plan) → Task 2
  → Task 5 (Backend: Modify installation-plan)
  → Task 6 (Backend: Modify required-tools)
Task 2 (Shared: Dashboard State)
  → Task 10 (Frontend: Dashboard Reducer)
  → Task 11 (Frontend: Dashboard Selectors) → Task 1
Task 3 (Backend: Inventory)
  → Task 13 (Frontend: Dashboard Screens)
Task 4 (Backend: Plan Builder)
  → Task 7 (Backend: Modify install-tools)
  → Task 8 (Backend: Modify developer-team-install)
  → Task 12 (Frontend: Action Runner) → Task 10
Task 8 → Task 9 (Backend: Modify pi-launch-command)
Task 10 → Task 12 → Task 13
Task 11 → Task 13
Task 13 → Task 14 (Frontend: Modify app.tsx)
Task 13 → Task 15 (Frontend: Modify developer-team-screens)
Task 1+3+4 → Task 16 (Tests: Adapter Unit)
Task 10 → Task 17 (Tests: Reducer)
Task 13 → Task 18 (Tests: Render)
Task 4+15 → Task 19 (Tests: Preservation Regression)
```

## Parallelization Plan

| Phase | Tasks | Can Run in Parallel |
|---|---|---|
| Shared | 1, 2 | Yes — tipos y catálogo son independientes |
| Backend Phase 1 | 3, 5, 6 | Partially — Task 3 depends on 1; Tasks 5, 6 depend on 1 and can run in parallel with each other |
| Backend Phase 2 | 4 | No — depends on 1 and 2 |
| Backend Phase 3 | 7, 8 | Partially — Task 7 depends on 4; Task 8 depends on 4; can run in parallel with each other |
| Backend Phase 4 | 9 | No — depends on 8 |
| Frontend Phase 1 | 10, 11 | Partially — Task 10 depends on 2; Task 11 depends on 1 and 2; Task 11 can start after 1+2 but Task 10 only needs 2 |
| Frontend Phase 2 | 12 | No — depends on 4 and 10 |
| Frontend Phase 3 | 13 | No — depends on 3, 10, 11 |
| Frontend Phase 4 | 14, 15 | Partially — depend on 13; can run in parallel with each other |
| Tests Phase 1 | 16, 17 | Partially — Task 16 depends on 1+3+4; Task 17 depends on 10; can run in parallel if dependencies met |
| Tests Phase 2 | 18, 19 | Partially — Task 18 depends on 13; Task 19 depends on 4+15 |

## Responsibility Contracts

| Contract / Boundary | Owner | Consumers | Notes |
|---|---|---|---|
| `CapabilityId`, `CapabilityToolMapping`, catálogo | General Apply (Task 1) | Backend Apply (Tasks 3, 4, 5, 6), Frontend Apply (Tasks 11, 13) | Tipos compartidos; catálogo es contrato entre backend y frontend |
| `PiRunnerDashboardState`, pantallas, `AdaptiveMemoryProviderChoice` | General Apply (Task 2) | Frontend Apply (Tasks 10, 11, 12, 13) | Estado es contrato del dashboard |
| `PiRunnerReviewPlan`, `PiRunnerAction`, `TechnicalActionKind` | Backend Apply (Task 4) | Frontend Apply (Tasks 12, 13, 18) | Plan builder determina estructura del plan de revisión |
| `CapabilityStatus` mapping (inventory → status) | Backend Apply (Task 3) | Frontend Apply (Tasks 11, 13) | Inventory builder mapea detección a status |
| API existente `buildPiInstallationPlan` / `reviewPiRequiredTools` | Backend Apply (Tasks 5, 6) | Frontend Apply (Task 12) | Backward compatible; exponer metadatos adicionales |
| Model config / thinking / Provider behavior | Backend Apply (Task 8) | Frontend Apply (Tasks 13, 15) | Preservar semántica existente; solo conectar provider desde dashboard |
| Supermemory provider resolution | Backend Apply (Task 9) | Frontend Apply (Task 12) | Compartir lógica entre TUI install y launch |

## Complexity Summary

| Complexity | Count | Task Numbers |
|---|---|---|
| Low | 5 | 2, 5, 6, 7, 19 |
| Medium | 12 | 1, 3, 8, 9, 10, 11, 12, 14, 15, 16, 17, 18 |
| High | 2 | 4, 13 |

## Flagged for Splitting

- **Task 4 (Capability Plan Builder)**: High complexity; genera plan agrupado con 5 tipos de acciones, diagnostics, exclusión de paquetes, comportamiento condicional de Engram/Supermemory, y state merging. Considerar dividir en (a) plan builder core con agrupación y exclusiones, y (b) Engram/Supermemory conditional logic si el implementor lo necesita.
- **Task 13 (Dashboard Screens)**: High complexity; 9 pantallas Ink con accesibilidad. Considerar dividir en (a) pantallas principales del dashboard, (b) pantallas de detail/secciones, y (c) Review & Install + progress + complete.

## Review Workload Forecast

| Signal | Value |
|---|---|
| Estimated changed lines | 400-800 |
| 400-line budget risk | Medium |
| Scope reduction recommended | No |
| Sequential work slices recommended | Yes — Shared → Backend → Frontend → Tests |
| Decision needed before Apply | Yes |

**Rationale**: El cambio impacta 8 archivos nuevos y 7 archivos modificados con nueva lógica de estado, reducer, catálogo, inventario, plan builder, pantallas Ink, y 5 archivos de tests. Estimated changed lines 400-800. El riesgo moderado viene de la cantidad de módulos nuevos y la refactorización de app.tsx. No se recomienda reducir scope porque las tareas soná interdependientes por contratos. Se recomienda trabajo secuencial por fase (Shared → Backend → Frontend → Tests). Se necesita decisión sobre fuentes canónicas para `pi-mermaid` y `pi-hud` antes de que esas capabilities puedan tener detección/instalación automática; las tareas usan placeholders `pending-source`/`TBD` permitiendo implementar sin bloquear.

## Open Questions / Blockers

### Implementation-blocking

None — todas las tareas pueden implementarse con los contratos y placeholders actuales.

### Allowed with placeholder/stub

- **pi-mermaid source/detection TBD**: Task 1 incluye `runner-mermaid` con `source: "TBD"` e `installKind: "pending"`. Task 3 la mapea a `pending-source`/`blocked`. Esto permite implementar el dashboard sin bloquear hasta que se confirme la fuente canónica. **Status**: allowed-with-placeholder; tareas pueden proceder con `TBD`/`pending-source`.

- **pi-hud source/detection TBD**: Task 1 incluye `pi-hud` con `installKind: "pending"`. Task 3 la mapea a `pending-source` solo para Pi. **Status**: allowed-with-placeholder; tareas pueden proceder.

- **OpenCode Mermaid mapping TBD**: No se necesita para este cambio que es Pi Runner dashboard. OpenCode queda fuera de scope. **Status**: non-blocking; no afecta tareas actuales.

### Non-blocking

- ¿Dónde persistir preferencias globales de capabilities del Pi Runner? El diseño dice ephemeral hasta Review & Install. **Status**: non-blocking; no se necesita decisión antes de implementar.

- ¿`Start installation` en Home debe saltar directamente al Pi dashboard o mantener selección de entorno? **Status**: non-blocking; Task 14 puede mantener el flujo existente de selección de entorno.

- ¿Context7 se elimina completamente o queda como legacy? **Status**: non-blocking; Task 5 y 6 mantienen `context7` en el catálogo legacy para backward compat pero no se ofrece en el dashboard.