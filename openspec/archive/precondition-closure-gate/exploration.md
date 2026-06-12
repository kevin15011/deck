# Exploration: Precondition Closure Gate

## Goal
Investigar cómo se expresan hoy blockers, preconditions y open questions en artifacts y prompts del Developer Team, y definir un artifact/fase gate formal para que riesgos detectados en Explorer/Design/Tasks no lleguen tarde a Apply/Verify.

## Current State

### Cómo se expresan hoy preconditions y blockers

#### 1. En `exploration.md`
- Explorer detecta riesgos y los reporta en secciones **Risks** y **Open Questions**.
- Ejemplo: `consolidate-documentation-and-adrs/exploration.md:48-73` — Phase 1 puede no estar completa; riesgo de parsing por backticks.
- No hay campo obligatorio ni artifact que force el cierre de estas precondiciones antes de avanzar.
- El return contract del Explorer dice `Ready for Proposal: Yes/No`, pero no hay tabla de preconditions con status.

#### 2. En `tasks.md`
- Task Agent ya clasifica Open Questions / Blockers:
  - `blocked` — impide Apply.
  - `allowed-with-stub` — Apply puede proceder con placeholder/TODO.
  - `non-blocking` — no afecta implementación.
  - `unblocked` — previamente bloqueado, ahora resuelto.
- Ejemplo: `consolidate-documentation-and-adrs/tasks.md:241-252` — OQ-1: Canonical Sentence Conflict (`allowed-with-stub`), OQ-2: Spec/Design Registry Not Updated (`non-blocking`).
- **Problema**: estas clasificaciones existen en Tasks pero no se propagan como gate antes de Apply. El Orchestrator dice "Do not launch Apply for blocked tasks", pero no hay artifact dedicado que obligue a revisarlas.

#### 3. En `apply-progress.md`
- Apply reporta blockers encontrados durante implementación, pero estos son **reactive**, no **preventive**.
- Ejemplo: `consolidate-documentation-and-adrs/apply-progress.md:18-22` — se corrigió `using-agent-skills` missing y escaping. Esto era una precondición que el Explorer había detectado pero no se cerró antes de Apply.

#### 4. En Orchestrator routing rules
- `deck-developer-orchestrator/SKILL.md:95-101` — Apply Routing:
  > "Before Apply, inspect the Tasks workload forecast and `Open Questions / Blockers`; classify tasks as unblocked, blocked, or allowed-with-placeholder. Do not launch Apply for blocked tasks."
- **Problema**: esta regla es textual en el skill, no hay artifact canónico que el Orchestrator valide sistemáticamente, ni registro en state/events de que el gate se ejecutó.

#### 5. En Apply agent prompts
- Los 3 Apply agents (backend, frontend, general) tienen la frase:
  > "If a task cannot be implemented as specified, report the blocker immediately."
  > "If the registry update fails, report it as a blocker and do not silently continue."
- Esto es **reporting de Apply**, no **gating previo**.

#### 6. En `verify-report.md` y `review-report.md`
- Verify y Review también reportan blockers, pero ya es tarde en el pipeline.
- `runner-install-preflight-tdd-quality/verify-report.md:137` — "Open Questions" aparecen post-Apply.
- `runner-install-preflight-tdd-quality/review-report.md:52` — "Open Questions" aparecen post-Apply.

### Evidencia de auditoría
- **Audit 2026-06-12, Hallazgo #6**: "Precondiciones conocidas llegan hasta Apply/Verify".
  - Evidencia: `consolidate-documentation-and-adrs/exploration.md:48-73` (Phase 1 incompleta), `tasks.md:250` (registry fases missing), `apply-progress.md:18-22` (corrección de `using-agent-skills` missing).
  - Inferencia: "Explorer detecta riesgos útiles, pero no siempre se convierten en gates duros antes de Apply."
  - Recomendación: "checklist formal 'precondition closure' entre Exploration→Proposal/Tasks."
- **Audit, Patrones Recurrentes**: "Rework/repairs por preconditions o contracts — 3/10 — gates tempranos insuficientes."

### Registry validator existente
- `openspec-registry-schema-validator` está archivado y funciona. Valida schema de `state.yaml` y alineación de artifacts.
- **Integración propuesta**: el validator puede verificar que `preconditions.md` exista cuando el change state indica que hay blockers/precodiciones registradas. No es dependencia principal, es apoyo estructural.

## Relevant Files
- `docs/openspec-retrospective-audit-2026-06-12.md` — Hallazgo #6 y follow-up recomendado.
- `openspec/archive/consolidate-documentation-and-adrs/exploration.md` — Caso con precondiciones detectadas pero no cerradas.
- `openspec/archive/consolidate-documentation-and-adrs/tasks.md` — Ejemplo de clasificación de blockers existente.
- `openspec/archive/consolidate-documentation-and-adrs/apply-progress.md` — Evidencia de rework por precondición no cerrada.
- `openspec/archive/runner-install-preflight-tdd-quality/proposal.md` — Menciona `precondition-closure-gate` como follow-up explícito.
- `.config/opencode/skills/deck-developer-orchestrator/SKILL.md` — Apply Routing rules actuales.
- `packages/core/src/teams/developer/apply-*-content.ts` — Prompts de Apply agents con blocker reporting.
- `openspec/config.yaml` — `testing.strict_tdd: true`, `strict_tdd_gates` definidos. Precondition gate puede integrarse como gate adicional.

## Constraints
- No modificar el código producto ni prompts de agentes en esta fase (solo artifacts OpenSpec).
- El gate debe ser **opt-in para exploraciones diagnósticas** — no debe bloquear exploraciones que no tienen intención de Apply.
- Debe integrarse con el workflow actual sin romper el SDD pipeline existente.
- Debe ser compatible con el registry validator existente como apoyo, no dependencia.
- El usuario pidió explícitamente: "No tocar cambios generados no commiteados `.codebase-memory/*` ni `apps/cli/src/runtime/build-info.generated.ts`".

## Options and Tradeoffs

### Option A: Nuevo artifact `preconditions.md` entre Tasks y Apply
- **Descripción**: Crear un artifact formal `preconditions.md` (o `precondition-closure.md`) que sea obligatorio antes de Apply. Contiene una tabla de preconditions con status y evidencia de cierre.
- **Pros**:
  - Artifact canónico, versionable, auditable.
  - El Orchestrator puede validar su existencia antes de lanzar Apply.
  - El registry validator puede verificar que exista cuando hay blockers registrados.
  - Se preserva flexibilidad: exploraciones sin Apply no necesitan este artifact.
- **Cons**:
  - Añade un artifact más al pipeline (aunque es pequeño).
  - Requiere actualizar el Orchestrator skill para reconocerlo.
- **Effort**: Low-Medium

### Option B: Sección obligatoria en `tasks.md` + Orchestrator gate
- **Descripción**: Extender el formato actual de `tasks.md` para incluir una sección formal `Precondition Closure Table` con status y cierre. El Orchestrator la inspecciona antes de Apply.
- **Pros**:
  - Reutiliza el artifact existente (`tasks.md`).
  - No introduce nuevo archivo.
- **Cons**:
  - Tasks.md ya es largo y denso; añadir una tabla formal puede hacerlo más difícil de mantener.
  - Menos visible para auditoría que un artifact separado.
  - Difícil para el registry validator validar una sección dentro de un markdown grande.
- **Effort**: Low

### Option C: Campo en `state.yaml` + Orchestrator validación programática
- **Descripción**: Añadir un campo `preconditions` en `state.yaml` con array de {id, status, artifactRef}. El Orchestrator valida este campo antes de Apply.
- **Pros**:
  - Máquina-legible, fácil de validar con el registry validator.
  - Integra bien con el Spec Registry.
- **Cons**:
  - Menos legible para humanos en revisiones.
  - Aumenta el schema drift que ya es un problema (hallazgo #4 del audit).
  - Requiere cambiar el schema canónico del registry.
- **Effort**: Medium

### Option D: No cambiar artifacts, solo mejorar prompts del Orchestrator
- **Descripción**: Refinar el texto del Orchestrator skill para que inspeccione más agresivamente `Open Questions / Blockers` en Tasks.
- **Pros**:
  - Sin cambios de estructura.
  - Rápido de implementar.
- **Cons**:
  - No resuelve el problema de fondo: sigue sin haber artifact canónico ni registro.
  - No auditable.
  - Depende de que el Orchestrator "recuerde" hacerlo cada vez.
- **Effort**: Low

## Recommendation

**Elegir Option A: Nuevo artifact `preconditions.md` entre Tasks y Apply.**

Razonamiento:
1. El audit identifica específicamente la falta de un "checklist formal" como causa de rework.
2. Un artifact separado es más visible, auditable y versionable que una sección dentro de Tasks.
3. No afecta exploraciones diagnósticas (sin intención de Apply) — solo se requiere cuando el change avanzará a Apply.
4. El registry validator existente puede extenderse fácilmente para validar la existencia de `preconditions.md` cuando el state indica blockers.
5. La carga cognitiva es baja: el artifact es una tabla compacta con status y evidencia.

Estructura propuesta del artifact `preconditions.md`:

```markdown
# Precondition Closure: {change-name}

## Preconditions Table

| ID | Precondition | Source Phase | Status | Evidence | Blocker for Apply |
|---|---|---|---|---|---|
| PC-1 | Phase 1 external skills instalados | exploration | satisfied | `ls packages/core/src/skills/external/documentation-and-adrs/SKILL.md` exists | No |
| PC-2 | Canonical sentence conflict resuelto | tasks | allowed-with-placeholder | Usar Spec REQ-prompt-002; Design versión diferida | No |
| PC-3 | MCP config persistence verificada | exploration | blocked | Sin test de preflight; requiere `runner-install-preflight` | Sí |

## Closure Decision
- **Status**: {closed | blocked | partial}
- **Ready for Apply**: {Yes / No — with conditions / No}
- **Conditions**: {lista si aplica}
- **Deferred to**: {change-id si aplica}
```

Statuses:
- `satisfied` — precondición verificada con evidencia concreta.
- `blocked` — precondición no satisfecha; bloquea Apply.
- `allowed-with-placeholder` — precondición no satisfecha pero Apply puede proceder con stub/TODO/documentado.
- `deferred` — precondición reconocida, pospuesta a otro change o follow-up.

## Fase de Cierre

**El gate debe ejecutarse en el Orchestrator, entre Tasks y Apply.**

- El Task Agent crea el artifact `preconditions.md` como parte de su output (o el Orchestrator lo deriva de `tasks.md`).
- El Orchestrator valida:
  1. ¿Existe `preconditions.md`?
  2. ¿Hay algún PC con status `blocked` y `Blocker for Apply: Sí`?
  3. Si hay bloqueos, NO lanzar Apply. Reportar al usuario con la tabla.
  4. Si todos están `satisfied` o `allowed-with-placeholder`, registrar en state/events y avanzar a Apply.

## Integración con Registry Validator

- El registry validator (existente, archivado) puede añadir una regla:
  > "Si `state.yaml` indica que el change tiene `blockers` o `open_questions` en su historia, debe existir `preconditions.md` antes de que `phase` avance a `apply`."
- Esta regla es **apoyo**, no dependencia principal del gate.
- El gate principal es el Orchestrator; el validator es un check de sanidad adicional.

## Qué debe bloquear Apply

- Cualquier precondition con status `blocked` y `Blocker for Apply: Sí`.
- Ejemplos típicos:
  - Dependencia externa no instalada/verificada.
  - Contrato con otro change no resuelto.
  - Datos/artifact requerido ausente (ej: baseline ledger sin fingerprint).
  - Riesgo de parsing o breaking change no mitigado.

## Flexibilidad para Exploraciones/Diagnósticos

- **Exploraciones puras** (sin intención de Apply): no requieren `preconditions.md`.
- El Orchestrator debe detectar si el change es "exploration-only" o "diagnóstico" y saltar el gate.
- Esto se puede inferir de: (a) user intent explícita, (b) `Ready for Proposal: No` en exploration, o (c) un nuevo status `diagnosed` en state (relacionado con exploration-lifecycle follow-up).
- **Exploraciones que evolucionan a cambio**: cuando el usuario decide implementar, el Orchestrator exige crear `preconditions.md` antes de Tasks o junto con Tasks.

## Open Questions

1. **¿El Task Agent debe crear `preconditions.md` o el Orchestrator lo deriva de `tasks.md`?**
   - Recomendación: Task Agent lo crea, ya que es quien clasifica blockers. El Orchestrator solo valida.
2. **¿Debe `preconditions.md` ser un artifact separado o una sección de `tasks.md`?**
   - Recomendación: artifact separado (Option A) para mayor visibilidad y auditabilidad.
3. **¿El registry validator debe validar contenido de la tabla o solo existencia del artifact?**
   - Recomendación: solo existencia en primera iteración; contenido puede ser validado en segunda iteración (post-SDD).
4. **¿Cómo se integra con el `strict_tdd_gates` de `openspec/config.yaml`?**
   - Recomendación: añadir `precondition_closure` como gate opcional en `strict_tdd_gates`, activo por defecto cuando `strict_tdd: true`.
5. **¿Las exploraciones que encuentran precondiciones bloqueantes deben archivarse como `blocked` o `deferred`?**
   - Recomendación: usar `deferred` en `preconditions.md` y explorar un estado `diagnosed` en el follow-up de exploration-lifecycle.

## Ready for Proposal

**Yes.**

El Explorer ha identificado:
- Dónde y cómo se expresan preconditions hoy (exploration, tasks, apply, orchestrator).
- Caso concreto de rework por precondición no cerrada (`consolidate-documentation-and-adrs`).
- Artifact, fase, statuses y reglas de bloqueo recomendadas.
- Integración con registry validator como apoyo.
- Mecanismo para preservar flexibilidad de exploraciones.

## Registry

- **Artifact Path**: `openspec/changes/precondition-closure-gate/exploration.md`
- **State Path**: `openspec/changes/precondition-closure-gate/state.yaml`
- **Events Path**: `openspec/changes/precondition-closure-gate/events.yaml`
- **Recorded**: phase `explore`, status `completed`, event `precondition-closure-gate-explored`
- **Registry Blocker**: none
