# Exploration: silent-visual-explanations

## Goal
Explorar cómo convertir Mermaid/visual explanations en soporte interno silencioso del runner y del Orchestrator, quitándolo como opción configurable visible del installer.

## Current State
- El dashboard Pi ya modela `runner-mermaid` como capability requerida y no toggleable, pero todavía la muestra explícitamente como “Mermaid” en `Runner Capabilities` y `Runner UI / visual helpers`.
- `runner-mermaid` existe en el catálogo con implementación Pi `pi-mermaid`, pero hoy está `installKind: pending`, `source: TBD` y genera pasos manuales/pending-source.
- El estado del dashboard mantiene `requiredCapabilities: { "runner-mermaid": true }` y separa capabilities configurables (`rtk`, `context-mode`, `codebase-memory`, `pi-hud`) de required capabilities.
- La UX actual tiene cinco secciones: `Runner Capabilities`, `Adaptive Memory`, `Runner UI / visual helpers`, `Teams`, `Review & Install`.
- Los installers de Developer Team para Pi y OpenCode ya escriben agentes y skills por runner, con semántica idempotente `created | unchanged | updated`; esto sirve como patrón para una capa reusable de instalación de skills.
- El Orchestrator es quien sintetiza respuestas visibles al usuario; los subagentes producen artifacts/handoffs internos.

## Relevant Files
- `packages/adapter-pi/src/capability-catalog.ts` — define capabilities, `runner-mermaid`, secciones y metadata de implementación.
- `packages/adapter-pi/src/capability-inventory.ts` — calcula estado de capabilities; hoy `runner-mermaid` queda pending-source.
- `packages/adapter-pi/src/capability-plan.ts` — convierte required/configurable capabilities en acciones del plan; hoy `runner-mermaid` produce paso manual/pending.
- `packages/adapter-pi/src/installation-plan.ts` — catálogo de paquetes instalables Pi; hoy no incluye `pi-mermaid`.
- `apps/cli/src/tui/pi-runner-dashboard/state.ts` — screens, selected/required capabilities y defaults.
- `apps/cli/src/tui/pi-runner-dashboard/selectors.ts` — resumen de secciones; hoy separa `Runner Capabilities` y `Runner UI / visual helpers`.
- `apps/cli/src/tui/screens/pi-runner-dashboard-screens.tsx` — copy visible del dashboard; hoy menciona Mermaid/pi-mermaid explícitamente.
- `apps/cli/src/tui/pi-runner-dashboard/render.test.tsx` — tests que fijan la UX actual con Mermaid visible y visual helpers.
- `packages/adapter-pi/src/developer-team-install.ts` — patrón Pi para instalar agents/skills idempotentemente.
- `packages/adapter-opencode/src/developer-team-install.ts` — patrón OpenCode para instalar agents/skills idempotentemente.
- `packages/core/src/teams/developer/catalog.ts` — catálogo canónico de agentes/skills Developer Team.
- `packages/core/src/teams/developer/content-registry.ts` — fuente canónica de contenidos de agentes/skills.

## Constraints
- `pi-mermaid` debe instalarse silenciosamente para Pi con `pi install npm:pi-mermaid` si no existe; el usuario no debe decidirlo como opción.
- Debe validarse existencia antes de instalar para conservar idempotencia.
- Mermaid puede aparecer como feedback técnico de instalación, no como feature opcional/configurable ni como requisito que el usuario deba entender.
- La skill externa `softaworks/agent-toolkit/mermaid-diagrams` no debe instalarse; Deck necesita una skill propia orientada a entendimiento rápido del usuario.
- La skill visual debería ser consumida por Orchestrator, no por Proposal/Spec/Design/Task, porque el usuario ve los resúmenes del Orchestrator.
- OpenSpec y Spec Registry siguen siendo autoridad; la visualización no reemplaza artifacts.
- Hubo fallo técnico del provider configurado del Explorer (`messages[*].reasoning` rechazado); esta exploración fue ejecutada inline por el Orchestrator por seguridad.

## Risks
- Cambiar “capabilities” a “packages” puede romper tests/selectors existentes si no se hace como refactor explícito de UX/state.
- Si `runner-mermaid` se mantiene como capability visible, contradice la nueva decisión de UX silenciosa.
- Si se elimina completamente del modelo de plan, se pierde trazabilidad de instalación/validación de `pi-mermaid`.
- Sin capa común de skills, agregar la skill visual puede duplicar lógica entre Pi/OpenCode.
- OpenCode aún no tiene implementación equivalente definida para render visual; hay que separar “skill de comportamiento” de “soporte técnico de render”.

## Options and Tradeoffs
1. **Mantener `runner-mermaid` como capability visible requerida** — Cambiar source/installKind a `pi-mermaid`, pero seguir mostrándolo.
   - Pros: Menor cambio técnico; aprovecha estructura actual.
   - Cons: Mantiene Mermaid como concepto visible y confuso para el usuario.
   - Effort: Low.

2. **Mover Mermaid a package interno silencioso y simplificar dashboard** — Tratar `pi-mermaid` como paquete interno requerido del runner, visible solo en Review/Install como feedback técnico.
   - Pros: Alinea UX con decisión del usuario; conserva instalación/validación; reduce ruido.
   - Cons: Requiere ajustar catálogo, plan, selectors, screens y tests.
   - Effort: Medium.

3. **Crear capa reusable de skill/package adapters por runner** — Separar instalación de soporte técnico (`pi-mermaid`) e instalación de skill propia (`deck-visual-explanations`) con adapters Pi/OpenCode.
   - Pros: Escala para futuras skills; evita duplicación; permite detectar `created | unchanged | updated | conflict`.
   - Cons: Más diseño inicial; debe cuidarse para no sobrearquitecturar.
   - Effort: Medium.

4. **Instalar la skill externa directamente** — Usar `softaworks/agent-toolkit/mermaid-diagrams`.
   - Pros: Rápido; documentación amplia.
   - Cons: Demasiado general, orientada a diagramación profesional, no a comprensión breve del usuario; contradice preferencia explícita.
   - Effort: Low, but rejected.

## Recommendation
Usar un enfoque híbrido interno:
- Reemplazar la UX de `Runner Capabilities`/`Runner UI visual helpers` por una sección `Packages`, más `Adaptive Memory`, `Teams` y `Review & Install` si se mantiene revisión separada.
- Modelar `pi-mermaid` como paquete interno requerido/silencioso del runner Pi, con detección previa e instalación automática cuando falte.
- Crear una skill propia `deck-visual-explanations` enfocada en diagramas simples para comprensión del usuario.
- Instalar esa skill mediante una capa adapter de skills por runner y asignarla al Orchestrator; no instalarla en todos los subagentes SDD salvo que una fase futura lo requiera.
- Mantener feedback técnico mínimo en Review/Install: “visual explanation support: ready/installing”, sin presentar Mermaid como decisión del usuario.

## Open Questions
- ¿La pantalla final debe ser exactamente `Packages`, `Adaptive Memory`, `Teams`, o se conserva `Review & Install` como acción/sección separada?
- Para OpenCode, ¿se instala solo la skill visual del Orchestrator ahora y se deja el render Mermaid/equivalente como TBD, o se bloquea hasta tener implementación visual?
- ¿El paquete interno `pi-mermaid` debe agregarse a `PI_INSTALLABLE_TOOLS` como required o a un nuevo catálogo de internal runner packages?

## Ready for Proposal
Yes — comunicar al usuario que la recomendación es ocultar Mermaid como capability, instalar `pi-mermaid` silenciosamente como package interno Pi, crear skill propia para visual explanations del Orchestrator y refactorizar el dashboard hacia `Packages`, `Adaptive Memory`, `Teams` con feedback técnico mínimo.

## Registry
- **Artifact Path**: `openspec/changes/silent-visual-explanations/exploration.md`
- **State Path**: `openspec/changes/silent-visual-explanations/state.yaml`
- **Events Path**: `openspec/changes/silent-visual-explanations/events.yaml`
- **Recorded**: phase `explore`, status `completed`, event `explore.completed`
- **Registry Blocker**: none
