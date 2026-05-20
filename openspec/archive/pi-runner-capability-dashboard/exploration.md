# Exploración: Dashboard por capacidades para instalación global del Pi Runner

## Goal
Explorar el flujo actual de TUI/instalación de Deck para rediseñar la instalación/configuración global del Pi Runner como dashboard por capacidades, preservando configuración de modelos y memoria adaptativa reciente.

## Current State

### Flujo TUI actual
- `apps/cli/src/tui/app.tsx` implementa un wizard lineal con un `Screen` union grande y estado local en `DeckApp`.
- Home ofrece: `Start installation`, `Upgrade tools` placeholder, `Configure models`, `Management / uninstall` placeholder, `Doctor` placeholder, `Exit`.
- `Start installation` sigue esta ruta principal:
  1. `environment-selection`: selección multi-entorno (`pi-development`, `opencode-development`, placeholders Claude/Codex).
  2. `environment-check`: detecta runtimes con `detectSelectedRuntimes`.
  3. `pi-preflight-checking` → `pi-preflight`: inspecciona Pi y paquetes.
  4. `required-tools`: muestra estado de herramientas.
  5. `optional-tools`: selección por herramienta opcional.
  6. `installation-review`: lista comandos a ejecutar.
  7. `installing`: ejecuta `installPiTools`.
  8. `team-selection`: selección de teams, actualmente Developer Team.
  9. Configuración de modelos por agente si Developer Team está seleccionado.
  10. `memory-provider-selection` y pantallas de Supermemory si aplica.
  11. `developer-team-review` → `developer-team-installing`.
  12. Flujo OpenCode si fue seleccionado.
  13. `complete`.
- `Configure models` desde Home reutiliza el subflujo Pi → Developer Team → agente → provider → modelo → thinking y luego aplica el bundle para actualizar frontmatter.
- La navegación está codificada por `continueFromCurrent`, `goBack`, `getCursorLimit`, `toggleCurrent` y helpers en `apps/cli/src/developer-team-flow.ts`.

### Acoplamientos principales
- `DeckApp` está fuertemente acoplado a:
  - detección de runtimes;
  - inspección/preflight Pi/OpenCode;
  - instalación de tools;
  - selección de teams;
  - configuración de modelos;
  - configuración de memoria;
  - escritura de config Deck;
  - aplicación/verificación/rollback del Developer Team.
- Las pantallas de Developer Team están separadas en `apps/cli/src/tui/screens/developer-team-screens.tsx`, pero el estado y los transitions siguen centralizados en `app.tsx`.
- El modelo actual pregunta por paquetes/herramientas individuales, no por capacidades agregadas.

## Plan/tools actuales
- `packages/adapter-pi/src/installation-plan.ts` define `PI_INSTALLABLE_TOOLS`:
  - requeridos: `sub-agents` (`npm:pi-subagents`), `mcp-packages` (`npm:pi-mcp-adapter`);
  - opcionales: `context-mode`, `codebase-memory`, `rtk`, `context7`, `engram-memory`.
- `buildPiInstallationPlan()` filtra tools ya instaladas según `requiredTools` y agrega opcionales seleccionadas.
- `packages/adapter-pi/src/required-tools.ts` revisa `pi list` y binarios en PATH para RTK, codebase-memory y Engram; devuelve `PiRequiredToolsReview` con `EnvironmentToolStatus`.
- `packages/adapter-pi/src/install-tools.ts` instala `installKind: "pi-package"` con `pi install <source>`; tools `external` quedan como resultado fallido/manual.
- `pi-hud` y `pi-mermaid` no aparecen en `PI_INSTALLABLE_TOOLS` ni `REQUIRED_TOOLS`; solo están mencionados en `docs/prompts/pi-runner-install-ux.md` como objetivo de UX futura.

## Configuración de modelos a preservar
- `packages/adapter-pi/src/model-config.ts` detecta providers por `~/.pi/agent/settings.json`, `pi --list-models` y variables de entorno.
- Providers soportados hoy: `opencode-go`, `openai-codex`, `anthropic`, `openai`, `google`, `groq`, `ollama`, `mistral`.
- El inventario prefiere `pi --list-models`; si falla usa defaults por provider.
- Por agente se persiste `model: provider/model` y `thinking: off|minimal|low|medium|high|xhigh` en frontmatter de `.pi/agents/deck-developer-*.md`.
- `supportsThinkingForModel()` fuerza `thinking: off` para `opencode-go` y Kimi K2.6 por compatibilidad.
- `buildDeveloperTeamInstallPlan()` lee `modelAssignments`/`thinkingAssignments`, compone contenido y mantiene default seguro (`low` o `off` según modelo).
- Cualquier dashboard debe mantener el subflujo contextual de modelos por agente y la ruta `Configure models` del menú principal.

## Estado de memoria/adaptive memory/Engram/codebase-memory
- Core define `AdaptiveMemoryProvider`, `MemoryInjectionBundle`, composición por superficies (`session`, `agent`, `skill`) y política: memoria auxiliar; OpenSpec/Spec Registry son autoridad.
- Providers soportados en contratos/config: `none`, `engram`, `supermemory`.
- Engram:
  - `createEngramMemoryProvider()` existe y `DeckApp` lo usa para inyectar memoria en instalación Developer Team.
  - También se detecta binario `engram` como tool externa.
- Supermemory:
  - Existe `packages/adapter-supermemory` con `createSupermemoryMemoryProvider(config)`, herramientas MCP validadas `execute` y `search_docs`, container tags y governance.
  - `DeckApp` permite elegir `Supermemory MCP`, solicita token/userId/teamId/orgId, escribe token en `~/.pi/agent/mcp.json` vía `writeSupermemoryPiMcpConfig`, y guarda config no secreta en `.deck/config.json`.
  - Riesgo detectado: `createMemoryProviderForSelection()` en `app.tsx` devuelve provider solo para Engram; para `supermemory` devuelve `undefined`. La instalación inmediata desde TUI guarda config/MCP pero no parece inyectar Supermemory en los agentes durante ese install. En cambio, `apps/cli/src/pi-launch-command.ts` sí resuelve `.deck/config.json`, valida Pi MCP config y crea `createSupermemoryMemoryProvider()` para profile/session y materialización de agentes/skills.
  - El prompt/contexto reciente sí contempla lo implementado de memoria: autoridad oficial/adaptiva, Supermemory MCP, herramientas reales, no guardar token en Deck config, Engram sin migración automática.
- codebase-memory:
  - Es tool opcional externa (`DeusData/codebase-memory-mcp`) y se detecta por binario `codebase-memory-mcp`.
  - No se ve como provider de adaptive memory de Deck; debe modelarse como capability de codebase intelligence/global runner, no como provider single-choice.

## Estado de RTK/context-mode/pi-hud/pi-mermaid
- RTK: opcional externa, detectada por binario `rtk`, no instalable automáticamente por `pi install`.
- context-mode: opcional `pi-package` (`npm:context-mode`) y detectable en `pi list`.
- codebase-memory: opcional externa, detectable por binario.
- pi-hud: no está implementado en plan ni detección actual.
- pi-mermaid: no está implementado en plan ni detección actual.
- Context7 y Engram memory existen en el plan actual aunque el prompt objetivo del dashboard no los lista como capacidades globales principales; Context7 podría quedar fuera, quedar como advanced, o mapearse a otra capability si se decide.

## Relevant Files
- `apps/cli/src/tui/app.tsx` — máquina de pantallas/estado actual, instalación Pi/OpenCode, modelos, memoria, team install.
- `apps/cli/src/tui/screens/developer-team-screens.tsx` — pantallas separadas para Developer Team, modelos, memoria y Supermemory.
- `apps/cli/src/menu-options.ts` — menú principal y opciones de entorno; todavía orientado a wizard.
- `apps/cli/src/developer-team-flow.ts` — helpers de transición post-install/team/review.
- `packages/adapter-pi/src/installation-plan.ts` — catálogo de tools instalables Pi y plan actual por paquetes.
- `packages/adapter-pi/src/required-tools.ts` — detección de paquetes/binarios requeridos/opcionales.
- `packages/adapter-pi/src/install-tools.ts` — ejecución de `pi install` y manejo de tools externas/manuales.
- `packages/adapter-pi/src/developer-team-install.ts` — plan/aplicación/verificación/backup/rollback del Developer Team; composición de memoria y modelos.
- `packages/adapter-pi/src/model-config.ts` — providers, modelos, thinking y parsing de `pi --list-models`.
- `apps/cli/src/pi-launch-command.ts` — resolución de memoria para lanzamiento Pi, incluyendo Supermemory real.
- `packages/adapter-supermemory/src/index.ts` — provider Supermemory MCP y tool bindings `execute`/`search_docs`.
- `packages/adapter-engram/src/index.ts` — provider Engram.
- `packages/core/src/memory/adaptive-memory.ts` — contrato/composición de adaptive memory.
- `docs/developer-team.md` — decisiones de team como unidad, separación agent/skill y workflow.
- `docs/pi-agent-installation.md` — arquitectura direct-files/deck-pi, modelo, memoria, launch y checklist.
- `docs/prompts/pi-runner-install-ux.md` — prompt temporal del dashboard objetivo.
- Tests: `apps/cli/src/tui/developer-team-flow.test.tsx`, `apps/cli/src/tui/render-screen.test.tsx`, `packages/adapter-pi/src/*.{test}.ts`, `packages/adapter-supermemory/src/index.test.ts`.

## Constraints
- No romper la separación entre global runner capabilities, adaptive memory, UI/visual helpers, teams y review plan.
- Developer Team debe seguir siendo una unidad user-facing; agent/skill sigue siendo detalle interno.
- La configuración de modelos por agente es comportamiento existente y debe preservarse.
- Solo un provider de adaptive memory activo a la vez.
- Supermemory token nunca debe guardarse en `.deck/config.json`; se entrega a Pi MCP config global con diagnósticos redactados.
- OpenSpec/Spec Registry siguen siendo autoridad; memoria es auxiliar.
- Tools externas no se instalan automáticamente hoy: se reportan como manual install required.
- `pi-hud`/`pi-mermaid` requieren decisión de package source, detección e instalación; hoy solo están en prompt.

## Risks
- `app.tsx` ya concentra demasiadas responsabilidades; agregar dashboard sin extraer estado/plan puede aumentar fragilidad.
- Riesgo de regresión en navegación/back/cursor por la máquina de estados manual.
- Riesgo de mezclar conceptos: `engram-memory` como tool externa vs Engram como provider single-choice.
- Riesgo de que Supermemory quede configurado pero no inyectado durante install TUI por provider no construido en `DeckApp`.
- External tools (`RTK`, `codebase-memory`, `Engram`) hoy producen fallos/manual install en resultados; un dashboard debe representar eso como acción pendiente/manual, no error confuso.
- Agregar `pi-hud` y `pi-mermaid` sin detección/plan claro puede crear affordances falsas.

## Architecture Sketch: dashboard por capacidades

### Pantallas sugeridas
1. `pi-runner-dashboard`
   - Secciones con estado resumido y acción: Runner Capabilities, Adaptive Memory, Runner UI, Visual Documentation, Teams, Review & Install.
   - Cada sección muestra ready/missing/configured/manual/pending y cantidad de acciones.
2. `capability-group-detail`
   - Context Efficiency: RTK, context-mode, codebase-memory como capabilities con tool mapping explícito.
   - Permite toggle por capacidad, muestra install kind (`pi-package`, external/manual), readiness y compatibilidad.
3. `adaptive-memory-detail`
   - Single-choice: None, Engram, Supermemory si se mantiene soporte reciente; si el producto quiere el prompt original estricto, confirmar si Supermemory debe quedar visible.
   - Para Supermemory, reutilizar pantallas token/userId/teamId/orgId o subform equivalente.
4. `runner-ui-detail`
   - pi-hud capability, estado y source pendiente.
5. `visual-docs-detail`
   - pi-mermaid capability, estado y source pendiente.
6. `teams-detail`
   - Developer Team selectable, futuros Reviewer/Product Team disabled/placeholder.
   - Muestra capabilities consumidas/heredadas: subagents, MCP, context, memory provider, codebase intelligence.
7. `developer-team-detail`
   - Install enabled, resumen de modelos por agente, acciones: Configure models, Use recommended profile, Reset defaults.
   - Reutiliza pantallas existentes de provider/model/thinking.
8. `review-plan`
   - Plan final agrupado por acciones: instalar paquetes Pi, manual external steps, escribir Deck config, escribir Pi MCP config, aplicar Developer Team, validar.
9. `install-progress` / `complete`
   - Progreso por acción/capability, no solo por paquete.

### Estado sugerido
- `PiRunnerDashboardState` con:
  - `capabilities: Record<CapabilityId, {selected, status, sourceTools[], installKind, diagnostics}>`
  - `adaptiveMemory: {activeProvider, supermemorySetup?, diagnostics}`
  - `teams: Record<TeamId, {selected, modelAssignments, thinkingAssignments, compatibility}>`
  - `plan: PiRunnerInstallAction[]`
  - `runtime: {piCommand?, preflight?, toolsReview?}`
- Separar builder puro de plan del componente Ink:
  - `buildPiRunnerCapabilityInventory(review, config, runtime)`
  - `buildPiRunnerInstallPlan(state)`
  - `summarizePiRunnerPlan(plan)`
- Mantener `DeckApp` como shell o router; mover reducer/transiciones a módulo testeable.

## Options and Tradeoffs
1. **Refactor incremental dentro del TUI actual** — Agregar nuevas pantallas dashboard manteniendo `DeckApp` y funciones actuales.
   - Pros: menor cambio inicial; reutiliza pantallas/model config existentes; menor riesgo de bloquear release.
   - Cons: aumenta tamaño/acoplamiento de `app.tsx`; tests de navegación siguen difíciles; plan por capacidades puede mezclarse con plan por tools.
   - Effort: Medium.

2. **Extraer estado/plan de Pi Runner antes de cambiar UX** — Crear módulos puros para inventory/capabilities/plan y luego conectar TUI dashboard.
   - Pros: mejor testabilidad; separa capacidad de paquete; facilita `pi-hud`/`pi-mermaid`; reduce riesgo de regressions.
   - Cons: más trabajo previo; requiere adaptar varias rutas del wizard actual.
   - Effort: Medium/High.

3. **Nuevo flujo dashboard paralelo al wizard existente** — Mantener wizard viejo y agregar entrada experimental para dashboard.
   - Pros: rollback simple; comparación A/B; reduce riesgo operativo.
   - Cons: duplicación de lógica; dos UX que mantener; puede confundir el menú.
   - Effort: High.

## Recommendation
Recomiendo la opción 2: primero extraer un modelo puro de `Pi Runner Capability Inventory` y `Pi Runner Install Plan`, luego construir el dashboard encima reutilizando subflujos existentes de modelos y memoria. Esto alinea el producto con “preguntar por capacidad, no por paquete”, permite tests de navegación/plan sin Ink pesado y deja explícito qué capabilities son globales vs qué consume Developer Team.

Antes de implementación, confirmar si Adaptive Memory en el dashboard debe mostrar solo `None/Engram` como dice el prompt temporal original o si debe incluir `Supermemory MCP` porque ya fue implementado recientemente y el usuario quiere preservarlo/confirmarlo.

## Gaps
- Falta source/detección/instalación para `pi-hud` y `pi-mermaid`.
- Falta modelo de capabilities; hoy todo es tool/package-centric.
- Falta provider Supermemory real en `DeckApp` durante instalación inmediata si se espera inyección en ese mismo install.
- Falta health/readiness unificado para config no secreta Deck, Pi MCP config, external binaries y pi packages.
- Falta decisión sobre Context7 y `engram-memory` tool en la nueva taxonomía.
- Falta tests de navegación dashboard/reducer y plan por capacidades.

## Checklist de cobertura de requisitos del prompt
- [x] Auditar TUI/install actual.
- [x] Revisar archivos solicitados.
- [x] Separar global runner capabilities vs teams en hallazgos.
- [x] Preservar comportamiento actual de modelos por agente.
- [x] Verificar memoria/adaptive memory/Engram/Supermemory/codebase-memory.
- [x] Verificar RTK/context-mode/pi-hud/pi-mermaid.
- [x] Identificar riesgos y acoplamientos.
- [x] Proponer arquitectura preliminar de pantallas/estado/plan.
- [ ] Resolver decisión producto: Supermemory visible en dashboard o solo preservado por config/launch.
- [ ] Resolver package sources de pi-hud/pi-mermaid.
- [ ] Resolver taxonomía final de Context7/Engram memory external tool.

## Open Questions
1. ¿El dashboard final debe incluir `Supermemory MCP` en Adaptive Memory junto a None/Engram, o el nuevo UX debe limitarse a None/Engram y dejar Supermemory como feature avanzada/config existente?
2. ¿Cuáles son los paquetes/comandos canónicos para instalar y detectar `pi-hud` y `pi-mermaid`?
3. ¿Context7 continúa como capability visible, se oculta en advanced, o se elimina del plan global?
4. ¿`engram-memory` externa debe seguir en Runner Capabilities si Engram provider es single-choice en Adaptive Memory?
5. ¿La instalación global del Pi Runner debe seguir aplicando Developer Team project-local (`<project>/.pi/...`) o diferenciar claramente global runner setup de team install por proyecto?

## Ready for Proposal
Sí, con aclaraciones de producto sobre Supermemory, pi-hud/pi-mermaid y taxonomía Context7/Engram. La propuesta debería formalizar el dashboard, el modelo capability→tool/action, y el alcance de migración del wizard actual.
