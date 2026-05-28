# Exploration: Módulos de Prompt/Metodología del Developer Team

## Goal
Inventariar los módulos conceptuales de prompt/metodología existentes en el Developer Team, identificar qué está documentado vs qué está solo embebido en prompts, y proponer una estructura para `docs/prompt-methodology-modules.md`.

## Current State

El Developer Team tiene **14 agentes** definidos en `catalog.ts`, cada uno con Agent Body + Skill Body en archivos `*-content.ts`. La metodología SDD está **distribuida** en:

1. **Orchestrator** (`orchestrator-content.ts`): Contiene el system prompt completo con gates (SDD Triage, Initialization, Execution Mode), reglas de delegación, dependency graph, artifact store, apply routing, post-archive git suggestions.
2. **Phase agents** (12 archivos `*-content.ts`): Cada fase tiene su metodología embebida en el Skill Body (pasos, templates, reglas de persistencia, return contracts).
3. **Instruction bundles** (`instruction-bundles/`): 4 paquetes configurables (adaptive-memory, codebase-memory, context-mode, rtk) con fragments por superficie (agent/skill/session).
4. **Content registry** (`content-registry.ts`): Orquesta la composición de todo el contenido con context-authority guidance y capability instructions.
5. **Docs existentes**: `docs/developer-team.md` describe el roster y workflow a alto nivel, pero NO documenta la metodología interna de cada fase.

### Lo que YA está documentado externamente
| Módulo | Dónde | Cobertura |
|---|---|---|
| Roster de agentes | `docs/developer-team.md` | ✅ Completo (tabla + descripciones) |
| Dependency graph | `docs/developer-team.md` | ✅ Diagrama ASCII |
| Agent/skill model | `docs/developer-team.md` | ✅ Separación agent vs skill |
| Skill injection | `docs/developer-team.md` | ✅ Concepto explicado |
| Project AI notes | `docs/developer-team.md` | ✅ Diseño Phase 5 |
| Artifact policy | `docs/developer-team.md` | ✅ OpenSpec + Registry + Memory |
| Orchestrator adaptations | `docs/developer-team.md` | ✅ Lista de adaptaciones |
| OpenSpec Registry roadmap | `docs/openspec-registry-roadmap.md` | ✅ Fases planificadas |

### Lo que está SOLO embebido en prompts (NO documentado externamente)
| Módulo Conceptual | Dónde vive | Complejidad |
|---|---|---|
| **SDD Triage Gate** | Orchestrator system prompt + skill | Alta — 4 niveles (Direct, Specialist, Recommend SDD, Run SDD) con reglas de clasificación |
| **Delegation Rules** | Orchestrator system prompt | Alta — 5 triggers obligatorios + tabla inline/delegate |
| **SDD vs Role-Based Delegation** | Orchestrator system prompt | Media — cuándo aplica cada modo |
| **Artifact Store / Spec Registry** | Orchestrator + cada phase skill | Alta — registry-deferred mode, parallel batch reconciliation, rejection rules |
| **Apply Routing + Blocker Classification** | Orchestrator + Task skill | Media — unblocked/blocked/allowed-with-placeholder |
| **Apply Batching** | Orchestrator + Task skill | Media — grouping, ordering, parallelization rules |
| **Self-Verification** | Proposal, Spec, Design, Task, Archive skills | Media — patrón repetido en 5 fases |
| **Return Contracts** | Cada phase skill | Alta — formato fijo de retorno por fase |
| **Registry-Deferred Mode** | Orchestrator skill + Spec/Design/Verify/Review skills | Alta — patrón de parallel batch safety |
| **Execution Mode** | Orchestrator system prompt | Baja — Automatic vs Interactive |
| **Recovery Rule** | Orchestrator system prompt | Baja — cómo resumir sesión interrumpida |
| **Post-Archive Git Suggestions** | Orchestrator system prompt | Baja — advisory commit/PR metadata |
| **Skill Resolution** | Orchestrator system prompt | Media — cómo se resuelven e inyectan skills |
| **Sub-Agent Context Protocol** | Orchestrator system prompt | Media — cómo fluye contexto SDD vs non-SDD |
| **Adaptive Memory Protocol** | instruction-bundles/adaptive-memory.ts | Alta — container tags, save triggers, topic keys, authority rule |
| **Codebase Memory Protocol** | instruction-bundles/codebase-memory.ts | Media — tool priority, graph schema, fallback |
| **Context Authority Guidance** | content-registry.ts (rendered) | Baja — official vs adaptive context |
| **SDD Initialization Gate** | Orchestrator system prompt | Baja — check openspec/config.yaml |

## Constraints

- **No modificar código** en esta exploración.
- **No avanzar Spec/Design** — solo recomendaciones.
- **SDD Triage ya existe** — documentarlo como módulo, NO crear "documentation triage" separado.
- Los prompts actuales son **runtime-agnostic** (no referencian Pi/OpenCode específicamente).
- La documentación externa debe ser **complementaria**, no duplicar lo que ya está en `docs/developer-team.md`.

## Risks

1. **Duplicación**: Si se documenta lo que ya está en prompts, hay riesgo de drift entre código y docs.
2. **Sobredocumentación**: Documentar cada patrón menor (ej. Recovery Rule) puede inflar el doc sin valor proporcional.
3. **Mantenimiento**: Cada cambio en un prompt requeriría actualizar la doc externa.
4. **Confusión de conceptos**: El usuario corrigió explícitamente NO crear "documentation triage" — SDD Triage es el concepto correcto.

## Options and Tradeoffs

### Opción 1: Documento único `docs/prompt-methodology-modules.md`
- **Pros**: Un solo archivo de referencia, fácil de encontrar, cubre todos los módulos.
- **Cons**: Puede crecer mucho, hard de mantener actualizado.
- **Esfuerzo**: Medio

### Opción 2: Doc por módulo bajo `docs/methodology/`
- **Pros**: Cada módulo tiene su archivo, más fácil de mantener y versionar.
- **Cons**: Más archivos que navegar, puede ser overkill para módulos pequeños.
- **Esfuerzo**: Alto

### Opción 3: Sección ampliada en `docs/developer-team.md` + doc separado solo para gates críticos
- **Pros**: Mantiene doc existente como hub, agrega profundidad solo donde importa.
- **Cons**: `developer-team.md` ya tiene 624 líneas — puede volverse pesado.
- **Esfuerzo**: Bajo-Medio

### Recomendación: Opción 1 con estructura modular interna
Un archivo `docs/prompt-methodology-modules.md` con secciones claramente separadas por módulo conceptual. Cada sección incluye: nombre, qué resuelve, dónde vive el código, reglas clave, y ejemplos de uso. Esto permite referencia cruzada fácil sin fragmentar en muchos archivos.

## Propuesta de Estructura para `docs/prompt-methodology-modules.md`

```markdown
# Prompt & Methodology Modules — Deck Developer Team

## 1. SDD Triage Gate
- Qué es, 4 niveles, reglas de clasificación, ejemplos
- Source: orchestrator-content.ts, orchestrator skill

## 2. Delegation Rules
- 5 mandatory triggers, tabla inline vs delegate, SDD vs role-based
- Source: orchestrator-content.ts

## 3. Artifact Store & Spec Registry
- OpenSpec layout, state.yaml, events.yaml, registry-deferred mode,
  parallel batch reconciliation, rejection rules
- Source: orchestrator + cada phase skill

## 4. Apply Routing & Blocker Classification
- Unblocked/blocked/allowed-with-placeholder, apply batching rules
- Source: orchestrator + task-content.ts

## 5. Self-Verification Pattern
- Patrón compartido por 5 fases (Proposal, Spec, Design, Task, Archive)
- Source: cada phase skill

## 6. Return Contracts
- Formato fijo de retorno por fase, campos requeridos
- Source: cada phase skill

## 7. Execution Mode
- Automatic vs Interactive, caching por sesión
- Source: orchestrator-content.ts

## 8. Recovery Rule
- Cómo resumir sesión interrumpida, state.yaml recovery
- Source: orchestrator-content.ts

## 9. Skill Resolution & Injection
- Cómo se resuelven skills, registry, project standards injection
- Source: orchestrator-content.ts

## 10. Sub-Agent Context Protocol
- SDD vs non-SDD context flow
- Source: orchestrator-content.ts

## 11. Adaptive Memory Protocol
- Container tags, save triggers, topic keys, authority rule, fail-open
- Source: instruction-bundles/adaptive-memory.ts

## 12. Codebase Memory Protocol
- Tool priority, graph schema, fallback order
- Source: instruction-bundles/codebase-memory.ts

## 13. Context Authority Guidance
- Official vs adaptive context, hierarchy
- Source: content-registry.ts

## 14. SDD Initialization Gate
- openspec/config.yaml check, deck-init delegation
- Source: orchestrator-content.ts

## 15. Post-Archive Git Suggestions
- Advisory commit/PR metadata, archive agent diff context
- Source: orchestrator-content.ts
```

## Recomendaciones para Ajustar la Proposal Existente

1. **Incluir SDD Triage como módulo #1** de la documentación — ya existe como gate en el Orchestrator, debe documentarse como concepto metodológico central.
2. **NO crear "documentation triage"** — el usuario corrigió explícitamente esto. SDD Triage es el módulo correcto.
3. **Priorizar módulos por criticidad**: Los gates (Triage, Delegation, Artifact Store) son los más importantes porque definen el comportamiento del Orchestrator.
4. **Agrupar patrones repetidos**: Self-Verification y Return Contracts son patrones compartidos — documentarlos una vez como patrones, no por fase.
5. **Mantener referencia al código**: Cada módulo debe incluir `Source:` apuntando al archivo `.ts` canónico para evitar drift.
6. **No documentar lo trivial**: Execution Mode, Recovery Rule, Post-Archive Git Suggestions son breves — pueden ser sub-secciones o anexos.

## Open Questions

- ¿El usuario prefiere un solo archivo o múltiples docs por módulo?
- ¿Se debe incluir la metodología de cada phase agent (Explorer, Proposal, Spec, etc.) como módulos separados, o solo los módulos transversales del Orchestrator?
- ¿La documentación debe ser legible por humanos, por agentes, o ambos?
- ¿Se necesita un índice/glosario de términos SDD?

## Ready for Proposal

**Yes** — hay suficiente información para proponer la estructura de documentación de módulos. La exploración identificó 15 módulos conceptuales, su ubicación en código, y una estructura propuesta para el documento.

## Registry

- **Artifact Path**: `openspec/changes/persistent-orchestrator-invariants/exploration.md`
- **State Path**: `openspec/changes/persistent-orchestrator-invariants/state.yaml`
- **Events Path**: `openspec/changes/persistent-orchestrator-invariants/events.yaml`
- **Recorded**: phase `explore`, status `completed`, event `exploration-completed`
- **Registry Blocker**: none
