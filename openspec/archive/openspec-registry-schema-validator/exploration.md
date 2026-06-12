# OpenSpec Registry Schema Canonical + Validator — Exploration

> Exploración de schema drift, registry alignment, y diseño de validator read-only para `state.yaml`, `events.yaml` y artifact alignment.

## 1. Resumen Ejecutivo

El registro OpenSpec (`openspec/changes/*/state.yaml`, `events.yaml` y `archive/*`) sufre de **schema drift severo** (≥10 dialectos), **eventos incompletos** (~43 % de cambios activos sin `events.yaml`), **artefactos no registrados** en cambios archivados, y **inconsistencias de fase/estado** que dificultan la auditoría automática y el recovery. La auditoría retrospectiva (2026-06-12) ya identificó esto como P2/P3 con recomendación de SDD. Este SDD debe definir un **schema canónico mínimo** y un **validator read-only** que funcione sin modificar archivos existentes.

## 2. Evidencia de Problemas Actuales o Históricos

### 2.1 Inconsistencia currentPhase/status/archive
- **`openspec/changes/fix-install-upgrade-regressions/state.yaml`**: `currentPhase: review`, `status: completed`, pero el bloque `archive` dice `status: archived`. La fase actual no refleja el estado real archivado.
- **`openspec/changes/fix-supermemory-userid-validation/state.yaml`**: `status: exploring`, `current_phase: explore`, `phases.explore.status: completed`. Triple representación de la misma fase con estados contradictorios.
- **`openspec/changes/fix-adaptive-memory-heading-duplication/state.yaml`**: usa `state: explore` en lugar de `phase`.

### 2.2 Artefactos no registrados (registry/artifact alignment)
- **`openspec/changes/consolidate-documentation-and-adrs/state.yaml`**: lista `artifacts` de tipo `exploration`, `proposal`, `spec`, `design`, `tasks`, `archive-report`. No registra `apply-progress`, `verify-report`, ni `review-report`, aunque los archivos existen en disco (`apply-progress.md`, `verify-report.md`, `review-report.md`). Esto trunca el lineage.

### 2.3 YAML malformado
- **`openspec/changes/supermemory-mcp-integration/state.yaml`**: línea 3 contiene `note: Model corrected — ...` con caracteres `:` en valor sin quotes, lo que genera error de parse YAML (`bad indentation of a mapping entry`). Esto bloquea cualquier tooling automático.

### 2.4 Eventos faltantes
- De 30 entradas en `openspec/changes/`, solo 17 tienen `events.yaml` (~43 % sin log de eventos). En `openspec/archive/`, 35 de 35 tienen `events.yaml`, pero con formatos heterogéneos.

### 2.5 Explorations sin lifecycle
- **`fix-provider-engram-leak`**: `phase: explore`, `status: completed`, `artifact: exploration.md`. No hay campo `next_action` ni `diagnosed`.
- **`fix-adaptive-memory-heading-duplication`**: idem.
- **`fix-supermemory-userid-validation`**: `status: exploring` aunque la exploración está completada. El sistema no distingue “exploración cerrada como diagnóstico” vs “cambio pendiente de implementación”.

## 3. Mapa de Formatos/Dialectos Actuales de Registry

### `state.yaml` — Identificados ≥10 dialectos

| Dialecto | Campos clave | Ejemplo concreto | Característica |
|---|---|---|---|
| **A. Legacy dual** | `previous_phases`, `current_phase`, `current_status`, `artifacts` (lista de objetos con `phase`) | `archive/add-critical-git-safety-rule` | Duplicidad: lista previa + snapshot actual. |
| **B. Modern flat** | `changeId`, `currentPhase`, `status`, `artifacts` (mapa string→string) | `archive/runner-install-preflight-tdd-quality` | Más completo: `apply_batches`, `apply_fixes`, `verify`, `review`. |
| **C. Moderno incompleto** | `changeId`, `currentPhase`, `status`, `artifacts` (mapa string→string), `provenance` con `registryWrite` | `changes/fix-install-upgrade-regressions` | Faltan `apply_batches`; solo `provenance` por fase. |
| **D. Nested phases** | `change`, `status`, `current_phase`, `phases` (mapa de objetos) | `changes/fix-supermemory-userid-validation` | `phases` contiene `status`, `artifact`, `completed_at`. |
| **E. Minimal single** | `phase`, `status`, `artifact` (singular) | `changes/fix-provider-engram-leak` | Solo exploración, sin `artifacts` plural. |
| **F. Minimal state** | `state`, `status`, `artifacts` (mapa string→string) | `changes/fix-adaptive-memory-heading-duplication` | `state` en lugar de `phase`. |
| **G. List objects** | `change-name`, `phase`, `status`, `artifacts` (lista de objetos con `type`, `path`, `purpose`) | `changes/consolidate-documentation-and-adrs` | Más descriptivo pero más verboso. |
| **H. Meta/header** | `meta`, `changeId`, comentarios YAML | `changes/developer-team-architecture-v2` | Estructura en `meta` + notas. |
| **I. Closed/abandoned** | `current_phase: closed`, `closure_reason`, `closed_at` | `changes/adaptive-memory-protocol-exploration` | Lifecycle de cierre explícito. |
| **J. Archive minimal** | `phase: archive`, `status: archived`, `artifact: archive-report.md` | `changes/hexagonal-architecture-memory-refactor` | Solo fase final. |
| **K. Mixed provenance** | `provenance` como array de objetos con `type`, `source`, `date` | `changes/consolidate-documentation-and-adrs` | Diferente de `provenance` objeto. |

### `events.yaml` — Identificados 4 formatos

| Formato | Estructura | Ejemplo | Notas |
|---|---|---|---|
| **1. Flat list** | `[- phase: explore, status: completed, ...]` | `changes/orchestrator-invariant-persistence` | Sin wrapper `events`. |
| **2. Wrapped list** | `change: X \n events: [ ... ]` | `changes/optimize-sdd-v2-core-implementation` | Wrapper `change` + `events`. |
| **3. Named events** | `phase`, `status`, `event`, `artifact`, `date` | `changes/reuse-opencode-install-plan-for-verify` | Campo `event` con nombre. |
| **4. Rich batch** | `events:`, `phase`, `status`, `artifact`, `timestamp`, `agent`, `batch`, `notes`, `registry_write` | `archive/runner-install-preflight-tdd-quality` | Más completo, con `batch`, `tasks_completed`, `fix_batch`. |

## 4. Recomendación de Schema Canónico Mínimo

### 4.1 `state.yaml` — Schema Canónico Mínimo

```yaml
schema: spec-registry-v1        # REQUIRED — version del schema
changeId: string                # REQUIRED — kebab-case
name: string                    # OPTIONAL — human-readable
currentPhase: enum              # REQUIRED
  # [explore, proposal, spec, design, tasks, apply, verify, review, archive, closed]
status: enum                    # REQUIRED
  # [in_progress, completed, passed, passed_with_warnings, failed,
  #  approved, archived, abandoned, incomplete]
artifacts:                      # REQUIRED — mapa de fase a archivo
  exploration: string           # REQUIRED
  proposal: string              # OPTIONAL — required si currentPhase > explore
  spec: string                  # OPTIONAL
  design: string                # OPTIONAL
  tasks: string                 # OPTIONAL
  apply_progress: string        # OPTIONAL
  verify_report: string         # OPTIONAL
  review_report: string         # OPTIONAL
  archive_report: string        # OPTIONAL
provenance:                     # REQUIRED — array de eventos
  - phase: string
    agent: string
    model: string
    timestamp: string           # ISO 8601
    registryWrite: string       # [deferred-reconciled, non-deferred, task-agent]
    note: string                # OPTIONAL
# Campos adicionales opcionales (para compatibilidad):
apply_batches: []               # OPTIONAL
apply_fixes: []                 # OPTIONAL
baseline_health: {}             # OPTIONAL
closure_reason: string          # OPTIONAL — required si status: abandoned/incomplete
closed_at: string               # OPTIONAL
```

### 4.2 Reglas de Validación Read-Only

1. **YAML well-formed**: parseable sin errores críticos.
2. **Required fields**: `schema`, `changeId`, `currentPhase`, `status`, `artifacts` (al menos `exploration`), `provenance` (al menos 1 entrada para exploración).
3. **Phase/Status consistency**:
   - Si `currentPhase == archive`, `status` DEBE ser `archived`.
   - Si `currentPhase == closed`, `status` DEBE ser `abandoned` o `incomplete`.
   - Si `currentPhase > explore`, `artifacts` DEBE contener la fase previa.
4. **Artifact alignment**: para cada key en `artifacts` (excepto `exploration` si `currentPhase == explore`), el archivo DEBE existir en disco.
5. **No duplicate keys**: detectar keys YAML duplicadas en el mismo nivel.
6. **Events.yaml presence**: si `currentPhase > explore`, `events.yaml` DEBE existir.
7. **Preservation**: no modificar archivos; solo reportar.

### 4.3 `events.yaml` — Schema Canónico Mínimo

```yaml
schema: spec-registry-events-v1
events:
  - phase: string
    status: string
    event: string          # nombre del evento, ej: explore.completed
    artifact: string
    timestamp: string      # ISO 8601
    actor: string          # agent/model
    notes: [string]        # opcional
```

## 5. Opciones de Ubicación/Implementación del Validator

| Opción | Ubicación | Pros | Cons | Esfuerzo |
|---|---|---|---|---|
| **A. Script CLI** | `apps/cli/src/commands/validate-registry.ts` | Accesible al usuario (`deck validate-registry`), integra con TUI/CLI. | Depende de build del CLI; más complejo. | Medio |
| **B. Package core** | `packages/core/src/openspec/registry-validator.ts` | Reusable, testable, runner-agnostic, puede importarse en CLI. | Requiere integración explícita en CLI. | Medio |
| **C. Script standalone** | `scripts/validate-registry.ts` | Corre con `bun run`, sin build, rápido. | No es parte del codebase estructurado; no tiene tests unitarios formales. | Bajo |
| **D. Test suite** | `packages/core/src/openspec/__tests__/registry-validator.test.ts` | TDD, CI, contrato vívido. | Solo corre en CI; no es utilidad manual. | Medio |

**Recomendación**: **Opción B + A + D** (triple):
- Librería en `packages/core` (lógica pura, schema, tests).
- Comando CLI (`deck validate-registry`) que consuma la librería.
- Tests de contrato en el mismo package que validan el schema contra ejemplos reales de `changes/` y `archive/`.

## 6. Riesgos y Mitigaciones

| Riesgo | Impacto | Mitigación |
|---|---|---|
| **Normalización retroactiva** | Alto costo de refactor de 30+ cambios. | Validator solo valida *nuevos* cambios; para históricos emite `warning` sin bloquear. |
| **Rigidez de schema** | Puede romper flujos de exploración rápida. | Schema relajado para `currentPhase: explore` (menos campos requeridos). |
| **YAML malformado** | Archivos existentes no parseables. | Usar parser tolerante (`yaml.parse` con `onWarning`); reportar como `error` pero no crash. |
| **Duplicación state/events** | Mantener `state.yaml` y `events.yaml` sincronizados. | `state.yaml` es *snapshot*; `events.yaml` es *log*. Validator cross-check: `currentPhase` en `state` debe coincidir con el último evento en `events`. |
| **Scope creep** | El validator se convierte en migrador. | **Out-of-scope**: no modificar archivos. Solo reportar. |
| **Performance** | Validar 65+ archivos YAML + eventos + existencia de artefactos. | Eficiente: lectura lazy, async, <100ms total. |

## 7. Scope Recomendado vs Follow-ups

### In-Scope
- Definir schema canónico mínimo (`spec-registry-v1`) para `state.yaml` y `events.yaml`.
- Implementar `RegistryValidator` en `packages/core` (read-only, no modifica archivos).
- Implementar `deck validate-registry` en CLI que consuma la librería.
- Tests de contrato (≥3) que validen ejemplos reales de `changes/` y `archive/`.
- Validar al menos 1 cambio nuevo como piloto (ej: este mismo SDD).
- Documento de schema (`openspec/registry-schema.md`).

### Out-of-Scope
- Normalización retroactiva de 30+ cambios históricos.
- Migración automática de dialectos antiguos a canónico.
- Modificar el workflow de los agentes para forzar schema (es un follow-up del orchestrator).
- Baseline health ledger (ya existe `openspec/baseline-health.yaml` como SDD separado).

### Follow-ups
- **Integrar validator en `deck doctor`** (SDD separado o extensión de este).
- **Auto-reconciliation de registry**: agente que actualice `state.yaml` cuando `events.yaml` tenga nuevos eventos.
- **Validator en CI**: gate de pull request que corra `bun run validate-registry`.
- **Exploration lifecycle states**: añadir `diagnosed`, `deferred`, `converted-to-change` (recomendado en auditoría P2).

## 8. Open Questions / Blockers

1. ¿Debe el schema canónico requerir `events.yaml` para **todos** los cambios, o solo para `currentPhase > explore`?
   - **Recomendación**: solo para `currentPhase > explore`.
2. ¿Cómo manejamos los cambios `abandoned`/`incomplete` en `changes/`? ¿Deberían moverse a `archive/`?
   - **Recomendación**: El validator solo reporta; el movimiento a `archive/` es responsabilidad del agente `archive`.
3. ¿Debe el schema incluir `apply_batches` y `apply_fixes` como opcionales, o normalizarlos dentro de `events.yaml`?
   - **Recomendación**: Opcionales en `state.yaml` para compatibilidad con SDD anteriores (ej: `runner-install-preflight-tdd-quality`).
4. ¿Debe el validator reportar `warning` o `error` cuando un artifact listado no existe en disco?
   - **Recomendación**: `error` para fases completadas (ej: `apply_progress` si `currentPhase >= apply`), `warning` para fases futuras.
5. ¿El schema debe versionarse (`spec-registry-v1`) para permitir evolución sin breaking changes?
   - **Recomendación**: Sí, campo `schema` obligatorio en `state.yaml`.
6. ¿Debe `provenance` ser un objeto (con keys por fase) o un array (lista de eventos)?
   - **Recomendación**: Array de objetos, más consistente con `events.yaml` y permite múltiples entradas por fase (ej: repairs, fixups).

## 9. Propuesta para Proposal

**Título**: `Registry schema canonical + validator read-only`

**Intent**: Eliminar schema drift y registry fragility mediante un schema canónico mínimo y un validador read-only que opere sobre `state.yaml`, `events.yaml` y artifact alignment sin modificar archivos existentes.

**Scope propuesto**:
1. Definir schema canónico `spec-registry-v1` para `state.yaml` y `events.yaml`.
2. Implementar `RegistryValidator` en `packages/core` (librería TypeScript, read-only, sin side effects).
3. Exponer comando CLI `deck validate-registry` (o script) que consuma la librería.
4. Tests de contrato en `packages/core` contra ejemplos reales de `changes/` y `archive/`.
5. Documentar schema en `openspec/registry-schema.md`.
6. Validar este SDD como piloto.

**Rollback**: Si el schema es demasiado rígido, se puede añadir `schema: spec-registry-v1-relaxed` o ajustar las reglas de required fields sin cambiar la implementación.

**Riesgos principales**: Normalización retroactiva (out-of-scope), rigidez para exploraciones (mitigada con schema relajado para `explore`), YAML malformado (parser tolerante).

**Acceptance criteria**:
- `bun run validate-registry` (o `deck validate-registry`) corre sin errores y reporta ≥0 issues.
- Todos los cambios con `currentPhase > explore` en `changes/` y `archive/` son validados.
- Tests de contrato pasan para al menos 3 ejemplos reales de cada dialecto principal.
- Documento de schema publicado en `openspec/registry-schema.md`.

---

**Exploración completada**: 2026-06-12
**Agent**: deck-developer-explorer
**Model**: kimi-k2.6
