# Review Report: pi-runner-capability-dashboard — Foundation Tasks 1-2

## Summary

**Overall Rating**: REQUEST CHANGES  
**Scope**: general / integration (Foundation Tasks 1-2 only)  
**Files Reviewed**: 11

Se revisaron los artefactos oficiales (`spec.md`, `design.md`, `tasks.md`, `apply-progress.md`), el registry solo para contexto (`state.yaml`, `events.yaml`) y los contratos implementados en `capability-catalog.ts`, `index.ts` y `state.ts`.

La base es razonable: el catálogo excluye paquetes no deseados, no expone `engram-memory` como capability global, exporta el nuevo módulo desde `@deck/adapter-pi` y el estado inicia Adaptive Memory en `none` sin campos de token. Sin embargo, hay dos riesgos contractuales importantes antes de que Backend/Frontend consuman estos tipos: `runner-mermaid` queda con implementación `pi-mermaid` no scopeada pese a `runnerScope: "all"`, y el estado modela la capability obligatoria `runner-mermaid` dentro de `selectedCapabilities`, lo que puede convertir un requisito derivado en toggle/decisión de usuario.

## Ratings by Dimension

| Dimension | Rating | Notes |
|---|---|---|
| Architecture | ⚠️ Adequate | Buen corte inicial en módulos, pero la frontera capability global vs implementación de runner todavía es ambigua. |
| Security | ✅ Strong | No se introducen secretos; Supermemory usa `hasToken` y no un token persistido en estado. |
| Scalability | ✅ Strong | Solo contratos/tipos; no hay rutas costosas ni efectos. |
| Maintainability | ⚠️ Adequate | Tipos útiles, pero algunos contratos son demasiado permisivos y pueden propagar semánticas incorrectas. |
| Code Quality | ⚠️ Adequate | Código legible y pequeño; hay imports duplicados y oportunidades de reutilizar tipos existentes. |
| Backend | ⚠️ Adequate | El catálogo sirve como base, pero `runner-mermaid` necesita mapping por runner antes del inventory/plan builder. |
| Frontend | ⚠️ Adequate | El estado cubre pantallas/defaults, pero no separa capabilities seleccionables de requeridas. |
| Integration | ❌ Weak | Los contratos compartidos todavía pueden inducir consumo incorrecto por Backend y Frontend. |

## Findings

### BLOCKER

None.

### MAJOR

- **Integration / Architecture**: `runner-mermaid` mezcla capability global con implementación Pi en un campo genérico.
  - **File**: `packages/adapter-pi/src/capability-catalog.ts` — líneas 82-94
  - **Evidence**: La entrada define `runnerScope: "all"` (línea 87), pero el detector genérico contiene `implementation: "pi-mermaid"` (línea 92). Esto deja a los próximos consumidores sin una frontera tipada entre el concepto global Mermaid y su implementación específica de Pi.
  - **Risk**: El inventory/plan builder puede aplicar `pi-mermaid` a OpenCode o a cualquier runner futuro, justo el acoplamiento que el diseño intenta evitar.
  - **Recommendation**: Modelar implementación por runner de forma explícita, por ejemplo `implementations: { pi: { id: "pi-mermaid", source: "TBD", installKind: "pending" }, opencode: { id: "TBD", ... } }`, o al menos renombrar/aislar el campo como `piImplementation` y obligar a los consumidores a gatear por runner. Evitar un `detector.implementation` global para una capability con `runnerScope: "all"`.

- **Frontend / Integration**: `runner-mermaid` aparece en `selectedCapabilities`, aunque es una capability requerida y derivada, no una decisión del usuario.
  - **File**: `apps/cli/src/tui/pi-runner-dashboard/state.ts` — líneas 60 y 145-151
  - **Evidence**: `selectedCapabilities` acepta cualquier `CapabilityId` (línea 60) y el default incluye `"runner-mermaid": true` (línea 150). El diseño indica que las capabilities requeridas como `runner-mermaid` deben derivarse al plan, no tratarse como toggles.
  - **Risk**: Reducers/selectors/screens pueden iterar `selectedCapabilities` y terminar permitiendo deseleccionar Mermaid o interpretarlo como opción seleccionada por el usuario. También complica el plan builder, que debería agregar Mermaid por política de runner, no por selección.
  - **Recommendation**: Separar `UserSelectableCapabilityId`/`ConfigurableCapabilityId` (`rtk`, `context-mode`, `codebase-memory`, `pi-hud`) de capabilities requeridas. Remover `runner-mermaid` de `selectedCapabilities` y derivarlo desde `PI_RUNNER_CAPABILITY_CATALOG["runner-mermaid"].requirementLevel === "required"`, con status/diagnostics en `capabilityStatuses` o en el plan.

### MINOR

- **Maintainability**: Las asignaciones de modelos/thinking pierden tipos existentes y permiten valores inválidos.
  - **File**: `apps/cli/src/tui/pi-runner-dashboard/state.ts` — líneas 50-51; `packages/adapter-pi/src/model-config.ts` — líneas 22-27
  - **Evidence**: `thinkingAssignments?: Record<string, string>` no reutiliza `DeveloperTeamThinkingAssignments` / `PiThinkingLevel`, aunque esos tipos ya limitan thinking a `off|minimal|low|medium|high|xhigh`.
  - **Recommendation**: Reutilizar `DeveloperTeamModelAssignments` y `DeveloperTeamThinkingAssignments` desde `@deck/adapter-pi` para preservar la semántica actual y evitar que el reducer o screens creen estados imposibles.

- **Maintainability / Backend**: `PiRunnerAction.toolId` es `string`, lo que debilita el contrato con el action runner.
  - **File**: `apps/cli/src/tui/pi-runner-dashboard/state.ts` — línea 84
  - **Evidence**: `toolId?: string` no aprovecha `InstallablePiToolId` para herramientas instalables existentes ni distingue placeholders de implementación como `pi-mermaid`.
  - **Recommendation**: Tipar `toolId?: InstallablePiToolId` para acciones de herramientas conocidas y usar un campo separado (`implementationId`, `capabilityImplementation`, etc.) para mappings pendientes/no instalables. Esto evita que el action runner reciba IDs arbitrarios como si fueran instalables.

### NIT

- **Code Quality**: Imports duplicados desde `@deck/adapter-pi`.
  - **File**: `apps/cli/src/tui/pi-runner-dashboard/state.ts` — líneas 1-7
  - **Recommendation**: Combinar los imports type-only en un único bloque para mantener el archivo limpio.

## Design Fidelity

Does the implementation match the Design artifact?
- **Aligned**: Partially
- **Aligned areas**:
  - `capability-catalog.ts` contiene las cinco capabilities esperadas y excluye `context7`, `@juicesharp/rpiv-todo`, `@juicesharp/rpiv-ask-user-question` y `engram-memory` como capabilities user-facing.
  - `runner-mermaid` queda `required`, `pending`, con `source: "TBD"`.
  - `pi-hud` queda opcional y Pi-only.
  - `index.ts` exporta el nuevo catálogo sin romper exports existentes.
  - `state.ts` define las nueve pantallas y default `adaptiveMemory.provider: "none"`.
- **Deviations / risks**:
  - `pi-mermaid` se modela como implementación genérica de `runner-mermaid` en vez de mapping por runner.
  - `runner-mermaid` se incluye como `selectedCapabilities`, lo que no respeta la separación entre decisiones user-facing y requisitos obligatorios derivados.
  - Algunos tipos del estado duplican o debilitan contratos ya existentes (`thinkingAssignments`, `toolId`).

## Open Questions

None.

## Registry Intent

```yaml
registry_intent:
  phase: review
  status: changes_requested
  artifact: review-foundation-output.md
  event: review.foundation.changes_requested
  note: "Foundation review for Tasks 1-2 requested changes before Backend/Frontend consume shared contracts; registry update deferred by parallel execution mode."
  timestamp: "2026-05-20T01:17:20Z"
```

## Registry Mode

- **Registry Write**: deferred
- **Registry State Path**: `openspec/changes/pi-runner-capability-dashboard/state.yaml`
- **Registry Events Path**: `openspec/changes/pi-runner-capability-dashboard/events.yaml`
- **Registry Blocker**: none
