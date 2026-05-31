# Proposal: Metodología de Equipo de Especialistas

## Intent

Deck debe presentarse y operar como un **equipo de especialistas coordinado por el Orchestrator**, no como una secuencia SDD por defecto. SDD sigue siendo un flujo formal disponible cuando el triage lo recomienda o el usuario lo elige; una vez elegido, sus fases no deben saltarse y Explorer debe ejecutarse antes de Proposal.

## Goal

Alinear prompts/skills del Orchestrator y subagentes para que el triage pueda usar Direct, uno o más especialistas, Recommend SDD o Run SDD, preservando invariantes y comportamiento existente valioso.

## Scope

### In Scope
- Reencuadrar identidad base: Developer Team = equipo de especialistas.
- Definir Orchestrator como coordinador/router/sintetizador con conocimiento explícito del roster.
- Preservar triage: `Direct / Specialist(s) / Recommend SDD / Run SDD`.
- Explicitar que `Specialist(s)` puede lanzar uno o más especialistas según necesidad.
- Explicitar paralelismo seguro: múltiples especialistas en paralelo cuando no haya dependencia ni riesgo de conflicto.
- Codificar que `Run SDD` exige flujo formal con Explorer antes de Proposal y fases posteriores en orden.
- Mantener invariantes, registry OpenSpec, execution modes, apply routing, registry-deferred parallelism, verify/review, archive y preservación de configuración de modelos.
- Preparar cambios esperados en tests afectados por wording.

### Out of Scope
- Implementar cambios en prompts/skills o tests durante esta fase.
- Rediseñar el sistema de agentes o el catálogo.
- Cambiar requisitos de producto ajenos a metodología Developer Team.
- Eliminar SDD o convertirlo en flujo único/default.
- Cambiar configuración de modelos o rutas de ejecución.

## Affected Capabilities

### New Capabilities
- `specialist-team-methodology`: El Developer Team se define como equipo de especialistas coordinado por Orchestrator.
- `safe-parallel-specialist-routing`: El Orchestrator puede lanzar uno o más especialistas en paralelo cuando sea seguro.
- `sdd-explorer-first-flow`: Cuando SDD se ejecuta, Explorer es la primera fase obligatoria antes de Proposal.

### Modified Capabilities
- `developer-team-triage`: Cambia el encuadre de “specialist only” a `Specialist(s)` sin predisponer a un único especialista.
- `orchestrator-routing`: Refuerza coordinación, síntesis y conciencia explícita del roster.
- `sdd-workflow-selection`: SDD queda como flujo formal invocado por triage, no identidad primaria del equipo.

### Unchanged Capabilities
- `openspec-registry`: Sigue siendo contexto oficial y fuente de estado/eventos.
- `execution-modes`: Interactive/Non-interactive no cambian.
- `apply-routing`: Backend/frontend/general routing permanece.
- `registry-deferred-parallelism`: Spec+Design y Verify+Review conservan escritura diferida cuando aplique.
- `verify-review-archive`: Fases y responsabilidades permanecen.
- `model-config-preservation`: Configuración registrada por defecto no cambia.

## Approach

- Usar la recomendación Explorer: cambios textuales/metodológicos, no estructurales.
- Actualizar principalmente `packages/core/src/teams/developer/orchestrator-content.ts` para:
  - presentar el roster como equipo base;
  - cambiar lenguaje a “uno o más especialistas”;
  - declarar reglas de paralelismo seguro;
  - corregir `Run SDD` para incluir Explorer antes de Proposal.
- Revisar subagent skill/content files para ajustar identidad y límites sin alterar responsabilidades buenas.
- Preservar `packages/core/src/teams/developer/orchestrator-invariants.ts` salvo que Spec/Design justifique una adición mínima para Explorer-first.
- Actualizar tests de snapshots/wording donde corresponda.

## Alternatives and Tradeoffs

| Alternative | Why Considered | Why Not Chosen |
|---|---|---|
| Solo documentar metodología | Menor riesgo y menos tests | No asegura que el Orchestrator cambie su comportamiento textual efectivo |
| Cambiar wording clave sin nueva invariant | Balance entre claridad y bajo riesgo | Puede necesitar test coverage explícita para Explorer-first |
| Agregar nueva invariant Explorer-first | Máxima protección para SDD | Mayor impacto y riesgo de regresión; debe validarse en Design/Spec |
| Convertir todo a SDD por defecto | Flujo formal uniforme | Contradice intención: equipo especialista primero, SDD solo cuando triage lo requiere |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Regresión de triage por wording ambiguo | Medium | Mantener categorías existentes y cambiar solo “Specialist only” a `Specialist(s)` con definición clara |
| Orchestrator use solo un especialista por sesgo textual | Medium | Usar lenguaje explícito “uno o más” y regla de paralelismo seguro |
| SDD vuelva a saltar Explorer | High | Codificar `Run SDD = Explorer → Proposal → Spec/Design → Tasks → Apply → Verify/Review → Archive` |
| Tests fallen por snapshots/contenido exacto | Medium | Actualizar tests junto con prompts afectados |
| Cambios excesivos alteren buen comportamiento actual | Medium | Limitar a metodología/wording y preservar invariantes/configuración |

## Rollback Plan

Revertir los cambios de prompts/skills/tests asociados al cambio `specialist-team-methodology` y restaurar los textos previos desde control de versiones. Si se agrega una invariant nueva y causa regresión, retirarla o degradarla a guía textual manteniendo el triage existente.

## Dependencies

- `openspec/changes/specialist-team-methodology/exploration.md` como contexto oficial previo.
- Revisión de `orchestrator-content.ts`, `catalog.ts`, `orchestrator-invariants.ts` y skill/content files de subagentes.
- Tests existentes de orchestrator/subagents que validan wording.

## Open Questions

- ¿Explorer-first debe ser una invariant formal nueva o una regla explícita dentro del flujo `Run SDD`?
- ¿Qué tests exactos fallan por snapshots/wording tras ajustar prompts?

## Acceptance Direction

- [ ] El Orchestrator describe al Developer Team como equipo de especialistas y no como SDD primero.
- [ ] Triage conserva Direct / Specialist(s) / Recommend SDD / Run SDD.
- [ ] Specialist(s) permite uno o más especialistas y paralelismo seguro cuando no haya dependencia/conflicto.
- [ ] `Run SDD` documenta y aplica Explorer antes de Proposal.
- [ ] Invariantes, registry, execution modes, apply routing, registry-deferred parallelism, verify/review, archive y model config preservation siguen cubiertos.
- [ ] Tests relevantes se actualizan y `bun test` pasa en fases de implementación/verificación.

## Next Steps

Ready for Spec (`deck-developer-spec`) and Design (`deck-developer-design`) in parallel.

## Mermaid Summary Source

```mermaid
flowchart TD
  A[Orchestrator: coordinator/router/synthesizer] --> B{Triage}
  B --> C[Direct]
  B --> D[Specialist(s)]
  D --> E[One specialist]
  D --> F[Multiple specialists in safe parallel]
  B --> G[Recommend SDD]
  B --> H[Run SDD]
  H --> I[Explorer]
  I --> J[Proposal]
  J --> K[Spec + Design]
  K --> L[Tasks]
  L --> M[Apply]
  M --> N[Verify + Review]
  N --> O[Archive]
```
