# Exploration: specialist-team-methodology

## Goal

Analizar cómo modificar los prompts/skills del orchestrator y subagentes para reflejar una metodología de "equipo de especialistas" donde el orquestador organiza y utiliza especialistas, manteniendo el triage que puede invocar SDD como flujo formal cuando es necesario.

## Current State

### Framing Actual

El sistema YA tiene estructura de equipo:
- **catalog.ts**: Define 14 agentes como miembros del equipo (`DEVELOPER_TEAM_AGENTS`)
- **Team Roster** (orchestrator-content.ts líneas 45-62): Tabla con Agent/ID/Role
- **SDD vs Role-Based Delegation** (líneas 112-116): Establece que SDD es el pipeline formal cuando el usuario lo pide o acepta recomendación

### Problema Identificado

1. **Predisposición a especialista único**: Lenguaje como "delegate uno..." en reglas de delegación da a entender un solo especialista
2. **Explorer no запускается automáticamente**: Cuando SDD es seleccionado, el flujo dice "Proposal → Spec/Design → Tasks..." pero no menciona Explorer primero
3. **Paralelismo no explicitado para especialistas**: Las reglas de Apply batching mencionan paralelismo pero el texto general no dice "múltiples especialistas cuando sea seguro"

### archivos a modificar

| Archivo | Relevancia |
|---|---|
| `packages/core/src/teams/developer/orchestrator-content.ts` | System prompt, skill body — главная методологическая superficie |
| `packages/core/src/teams/developer/catalog.ts` | Team roster — уже tiene la estructura de equipo |
| `packages/core/src/teams/developer/orchestrator-invariants.ts` | Invariants — debe preservarse |
| Subagent skills (`explorer-content.ts`, `proposal-content.ts`, etc.) |thin identity + boundaries |

## Constraints

- **Preservar triage gate**: Direct / Specialist only / Recommend SDD / Run SDD (INV-004)
- **Preservar fase SDD**: Proposal → Spec + Design → Tasks → Apply → Verify + Review → Archive
- **Preservar registry deferred parallelism**: Spec+Design y Verify+Review escribir artifact solo
- **Preservar modelo config**: Usar registered configuration por defecto
- **Preservar invariants**: INV-001 a INV-005 no deben cambiarse estructuralmente
- **Preservar artifact persistence**: OpenSpec artifacts obligatorios

## Risks

- **Regresión en invariantes**: Si se cambia la redacción de INV-004 (Triage Gate), podría romperse el comportamiento de clasificación
- ** Pérdida de paralelismo seguro**: Al eliminar lenguaje sobre lanzar múltiples especialistas, el orchestrator podría volverse conservador innecesariamente
- **SDD incompleto sin Explorer**: Si Proposal se lanza antes que Explorer para cambios que necesitan investigación, se pierde calidad
- **Regtests breaking**: Los tests en `orchestrator-*.test.ts` verifican contenido exacto; cualquier cambio de wording necesita actualización de tests

## Options and Tradeoffs

### Opción 1: Redactar metodología sin tocar código

- Agregar nueva sección en orchestrator-content que explique "equipo de especialistas primero" sin modificar существующий текст
- Pros: Mínimo riesgo de regresión, rápido de implementar, preserva tests
- Cons: No cambia comportamiento real, solo documentación

### Opción 2: Modificar wording de delegación (Medium effort)

- Cambiar "delegate uno..." por "delegate uno o más..." en lugares clave
- Agregar explícitamente "lanza múltiples especialistas en paralelo cuando sea seguro"
- Pros: Mayor claridad para el modelo,behavior alineado con lo que el usuario quiere
- Cons: Requiere actualizar varios archivos y sus tests correspondientes

### Opción 3: Nueva invariant para Explorer-first en SDD (High effort)

- Crear INV-006 que establezca "cuando SDD es Run, Explorer debe ejecutarse antes de Proposal"
- Pros: Guaranteey that Explorer runs, no se puede跳过
- Cons: Alta complejidad, posibles efectos secundarios en el flujo, muchos tests a actualizar

## Recommendation

Seguir **Opción 2 con validación de Opción 3**:

1. Modificar wording en orchestrator-content.ts:
   - "Team Roster" → agregar nota "múltiples especialistas cuando sea apropiado"
   - SDD Triage описания → clarificar que "Run SDD" incluye Explorer ANTES de Proposal como primer paso del flujo SDD
   - Agregar sección "Parallel Specialist Launch" que diga cuándo es seguro ejecutar múltiples especialistas

2. Preservar todas las invariants actuales (INV-001 a INV-005)

3. Los cambios son textuales en la metodología, no en la lógica del orchestrator

4. Tests requerirán actualización donde el wording cambie

## Key Findings

| Área | Finding |
|---|---|
| Catalog | Ya define equipo – no necesita cambio estructural |
| Orchestrator system prompt | Tiene SDD vs Role-Based pero no emphasize especialista team como base |
| SDD phase order | Menciona Proposal primero, no Explorer – este debe ser el cambio crítico |
| Triage | Funciona – preservar wording exacto de INV-004 |
| Tests | Verifican contenido exacto – cualquier cambio de wording necesita test update |

## Ready for Proposal

**Sí** – la investigación permite a Proposal definir el wording específico a cambiar, archivos affected, y estrategia de test update.

## Open Questions

- ¿El usuario desea que Explorer sea obligatorio en todos los casos de SDD o solo cuando el tema requiere investigación profunda?
- ¿Cuántos tests esperan actualización? ¿Hay cobertura automática o manual?

## Required Artifact Files

- **exploration.md**: Este archivo
- **state.yaml**: Pendiente de escritura por Orchestrator
- **events.yaml**: Pendiente de escritura por Orchestrator