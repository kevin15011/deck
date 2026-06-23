---
name: openspec-retrospective-audit
description: "Audita sesiones OpenSpec del proyecto Deck como registro de auditoría para detectar mejoras en metodología, agentes, prompts, tooling, registry y compatibilidad runner-agnostic."
disable-model-invocation: true
user-invocable: true
license: MIT
metadata:
  author: deck-internal
  version: "1.1"
  scope: local-project
  warning: Esta skill es LOCAL del proyecto Deck. No es una skill distribuible del sistema Deck.
---

# OpenSpec Retrospective Audit

> Skill local del proyecto Deck para auditar retrospectivamente sesiones OpenSpec. Trata `openspec/` como registro oficial de auditoría, prioriza cambios recientes, detecta patrones de mejora y produce recomendaciones accionables sin modificar archivos.

## Propósito

Auditar cambios OpenSpec del propio proyecto Deck —Deck trabajando sobre Deck— para encontrar oportunidades de mejora en:

- sistema SDD y metodología
- coordinación de agentes
- prompts e instrucciones
- Spec Registry (`state.yaml` / `events.yaml`)
- tooling y fricción operativa
- verificación, revisión y tests
- documentación, ADRs y aprendizaje institucional
- compatibilidad transversal entre runners

**Scope obligatorio**: esta skill es LOCAL del proyecto Deck. No es una skill distribuible ni una feature del sistema Deck core.

## Triggers

Usar cuando el usuario pida:

- "auditar openspec"
- "revisar sesiones de openspec"
- "retrospective audit"
- "analizar cambios recientes"
- "encontrar mejoras en Deck usando OpenSpec"
- "qué aprendemos de los últimos cambios"

## Entradas Esperadas

El usuario puede indicar:

- **Modo**: `recent`, `change`, `trend`, `failure-focused`
- **Rango**: cantidad de cambios o fecha aproximada
- **Change específico**: `openspec/changes/{change-name}`
- **Foco**: registry, prompts, agentes, runners, verificación, metodología, tooling

Si no indica modo, usar `recent` con los 10 cambios más recientes.

## Modos de Auditoría

| Modo | Uso | Alcance |
|---|---|---|
| `recent` | Auditoría recurrente normal | Últimos N cambios activos, por defecto 10 |
| `change` | Auditoría dirigida | Un cambio específico |
| `trend` | Patrones históricos | Recientes vs archivados/históricos |
| `failure-focused` | Aprender de fallos | FAIL, blockers, repairs, rework, verify/review failures |

## Fuentes Oficiales

Tratar como **OFFICIAL CONTEXT**:

- `openspec/changes/*/state.yaml`
- `openspec/changes/*/events.yaml`
- `openspec/changes/*/proposal.md`
- `openspec/changes/*/spec.md`
- `openspec/changes/*/design.md`
- `openspec/changes/*/tasks.md`
- `openspec/changes/*/apply-progress.md`
- `openspec/changes/*/verify-report.md`
- `openspec/changes/*/review-report.md`
- `openspec/changes/*/archive-report.md`
- `openspec/archive/*` cuando exista

La memoria adaptativa puede usarse sólo como **pista** o contexto auxiliar. Nunca cuenta como evidencia primaria ni puede contradecir OpenSpec.

## Reglas de Seguridad

Durante la auditoría:

- No modificar archivos OpenSpec.
- No modificar código fuente.
- No editar prompts, skills, agentes, configuración ni adapters.
- No convertir recomendaciones en cambios sin confirmación explícita.
- No inferir bugs del sistema sin evidencia trazable.
- Distinguir siempre **evidencia** de **inferencia**.

Si una recomendación afecta prompts, agentes, metodología, registry, adapters o comportamiento transversal de Deck, clasificarla como **candidata a SDD** antes de implementarla.

## Flujo de Auditoría

### 1. Determinar Alcance

Seleccionar cambios según el modo:

1. `change`: usar el change solicitado.
2. `failure-focused`: priorizar cambios con FAIL, blockers, repair loops o verify/review negativos.
3. `trend`: comparar cambios recientes contra archivados/históricos.
4. `recent`: seleccionar los N cambios más recientes.

### 2. Determinar Recencia

Ordenar cambios usando, en este orden:

1. timestamps o eventos en `events.yaml`
2. phase/provenance/status en `state.yaml`
3. fechas en `archive-report.md` o artifacts
4. mtime del filesystem sólo como fallback

Evitar depender exclusivamente de comandos o comportamiento específico de un runner.

### 3. Leer Evidencia por Cambio

Para cada cambio seleccionado, leer sólo los artifacts necesarios para responder el foco de auditoría.

Mínimo recomendado:

- `state.yaml`
- `events.yaml`
- `tasks.md`
- `apply-progress.md`
- `verify-report.md`
- `review-report.md`

Leer `proposal.md`, `spec.md` y `design.md` cuando el hallazgo dependa de intención, requisitos o arquitectura.

### 4. Checklist de Integridad OpenSpec

Para cada cambio, verificar:

- `state.yaml` existe y refleja fase/status actuales.
- `events.yaml` existe y conserva historial de eventos.
- Cada fase registrada tiene artifact correspondiente.
- Cada artifact crítico tiene evento o referencia en registry.
- No hay artifacts huérfanos sin registry cuando deberían estar registrados.
- No hay registry apuntando a artifacts ausentes.
- `state.yaml` no parece haber perdido fases/artifacts previos.
- `events.yaml` no parece haber sido sobrescrito o truncado.
- `tasks.md` clasifica blockers/open questions cuando aplica.
- `apply-progress.md` corresponde con tasks ejecutadas.
- `verify-report.md` y `review-report.md` concuerdan con estado final.
- Los failures incluyen causa, evidencia y siguiente acción.

### 5. Evaluar Dogfooding de Deck

Buscar señales de Deck fallando o mejorando al usarse sobre sí mismo:

- fases demasiado pesadas, ambiguas o repetitivas
- agentes que incumplen contratos de salida
- prompts que permiten errores repetidos
- registry updates incompletos o frágiles
- blockers detectados tarde por Verify/Review
- tareas que mezclan decisiones abiertas con implementación
- Apply ejecutado con blockers reales no resueltos
- dependencia accidental de OpenCode donde debería ser runner-agnostic
- fricción recurrente de tooling, tests o entorno
- falta de automatización para checks repetidos

### 6. Categorizar Hallazgos

| Categoría | Buscar |
|---|---|
| **Workflow Bug** | Fases mal coordinadas, avances prematuros, loops de repair evitables |
| **Methodology Gap** | Criterios vagos, blockers mal tratados, handoffs insuficientes |
| **Tooling Friction** | Comandos frágiles, outputs ambiguos, setup faltante, checks manuales repetidos |
| **Prompt/Agent Issue** | Contratos incumplidos, formato inconsistente, agentes que omiten evidencia |
| **Registry Issue** | `state.yaml`/`events.yaml` incompletos, inconsistentes o desalineados |
| **Runner-Specific Leakage** | Supuestos de OpenCode/Pi/otro runner donde debería haber abstracción |
| **Testing/Verification Gap** | Tests insuficientes, verify tardío, assertions débiles, build no ejecutable |
| **Documentation/ADR Opportunity** | Decisiones importantes sin registro estable |
| **Automation Opportunity** | Revisión repetible que podría automatizarse o validarse por script |

### 7. Clasificar Severidad

| Severidad | Criterio |
|---|---|
| **P0** | Puede corromper registry/artifacts, ocultar fallos críticos o romper flujo SDD recurrentemente |
| **P1** | Produce rework alto, falsas aprobaciones, pérdida de trazabilidad o errores repetidos |
| **P2** | Fricción significativa, ambigüedad metodológica o cobertura insuficiente sin impacto inmediato |
| **P3** | Mejora menor, limpieza, documentación o ergonomía |

No asignar P0/P1 sin evidencia concreta.

### 8. Distinguir Evidencia vs Inferencia

Cada hallazgo debe separar:

- **Evidencia**: hecho verificable desde un artifact.
- **Inferencia**: interpretación razonada del impacto o causa.

Formato mínimo de evidencia:

```md
- Archivo: `openspec/changes/{change}/verify-report.md`
- Sección/línea: `{sección o línea si está disponible}`
- Hecho observado: `{hecho verificable}`
```

Ejemplos:

- Evidencia: `state.yaml` marca `verify: completed`, pero `events.yaml` no contiene evento equivalente.
- Inferencia: El registry puede haber sido actualizado de forma incompleta.

Evitar afirmaciones psicológicas o no verificables como "el agente no entendió". Reescribir como: "`spec.md` no cubre el alcance declarado en `proposal.md`".

### 9. Identificar Patrones

Buscar repetición entre cambios:

- mismos tipos de blockers
- mismos gaps de registry
- mismas fallas de verify/review
- mismas dependencias faltantes de entorno
- mismos problemas de contrato entre artifacts
- mismos puntos donde el Orchestrator tuvo que reparar manualmente
- mismas recomendaciones que reaparecen sin convertirse en mejora sistémica

### 10. Clasificar Acción Recomendada

Cada recomendación debe terminar en una de estas acciones:

| Acción | Cuándo usar |
|---|---|
| **fix directo** | Cambio pequeño, localizado, bajo riesgo |
| **requiere SDD** | Afecta prompts, agentes, metodología, registry, adapters o cross-runner behavior |
| **requiere investigación** | Evidencia insuficiente o causa no clara |
| **documentar/no actuar** | Hallazgo menor o decisión consciente aceptable |

## Formato de Salida

Responder en español, conciso, con este formato:

```markdown
# OpenSpec Retrospective Audit — {fecha}

## Resumen Ejecutivo

- **Modo**: {recent/change/trend/failure-focused}
- **Cambios auditados**: {N}
- **Hallazgos**: {total} — P0:{n} P1:{n} P2:{n} P3:{n}
- **Patrón principal**: {1 línea}
- **Recomendación principal**: {1 línea}

## Cambios Revisados

| Cambio | Estado | Fases/artifacts clave | Señales relevantes |
|---|---|---|---|
| `{change}` | {status} | {artifacts} | {failures/blockers/rework/etc.} |

## Hallazgos Priorizados

### P0/P1

1. **{Título}** [{categoría}] — {acción recomendada}
   - **Evidencia**: `{archivo}` → {sección/línea}: {hecho}
   - **Inferencia**: {interpretación separada}
   - **Impacto**: {impacto}
   - **Recomendación**: {qué hacer}

### P2/P3

1. **{Título}** [{categoría}] — {acción recomendada}
   - **Evidencia**: ...

## Patrones Recurrentes

| Patrón | Frecuencia | Cambios afectados | Implicación |
|---|---:|---|---|
| {patrón} | {n} | {lista} | {implicación} |

## Quick Wins

- **{Título}** — {impacto}; acción: {fix directo / doc / script}

## Cambios Candidatos a SDD

| Propuesta | Por qué requiere SDD | Prioridad |
|---|---|---|
| {mejora} | {impacto transversal} | {alta/media/baja} |

## Preguntas Abiertas

- {pregunta}
```

## Estilo

- Español técnico, directo y breve.
- Tablas sobre prosa cuando ahorren lectura.
- No repetir contenido de artifacts; citarlo.
- Priorizar hallazgos accionables sobre observaciones triviales.
- Si no hay evidencia suficiente, decirlo y clasificar como pregunta abierta.

## Notas

- **Scope**: local del proyecto Deck.
- **Runner stance**: las recomendaciones deben ser runner-agnostic salvo que el hallazgo sea específicamente sobre un adapter.
- **Fecha de creación**: 2026-06-12.
- **Última revisión**: 2026-06-12.
