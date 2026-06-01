# Exploration: Sistema de Personalidad — Rediseño para Capas de Comunicación

## Goal

Investigar la arquitectura actual del sistema de personalidad del Orchestrator para preparar un rediseño donde la personalidad afecta SOLO el estilo de comunicación hacia el usuario, no las reglas operacionales.

## Estado Actual

### Arquitectura de Personalidades

| Constante | Líneas | Contenido |
|---|---|---|
| `ORCHESTRATOR_SYSTEM_PROMPT` | ~258 líneas (39-296) | Base pragmática — operativa completa |
| `ORCHESTRATOR_PROMPT_GUIDA` | ~326 líneas (306-631) | Versión expandida con explicaciones |
| `ORCHESTRATOR_PROMPT_PRAGMATICA` | = `ORCHESTRATOR_SYSTEM_PROMPT` | Alias directo |

**Problema identificado:** Guia duplica ~631 líneas del contenido operacional con explicaciones redundantes que el modelo ya conoce. Pragmatica tiene cero instrucciones de comunicación — depende del comportamiento default del modelo.

### Flujo de Personalidad

```
.deck/config.json (orchestratorPersonality)
  → developer-team-install.ts (resolvedPersonality)
  → content-registry.ts (getTeamSessionInstructions)
  → getOrchestratorSystemPrompt(personality)
  → prompt-generation.ts → session prompt
```

### Archivos Clave

| Archivo | Rol |
|---|---|
| `packages/core/src/teams/developer/orchestrator-content.ts` | Definiciones de prompts (líneas 306-657) |
| `packages/core/src/teams/developer/content-registry.ts` | getTeamSessionInstructions usa personality (líneas 514-537) |
| `packages/core/src/config/deck-config.ts` | Tipos y validación (líneas 54-56, 609-634) |
| `packages/adapter-opencode/src/developer-team-install.ts` | Consume personality en plan building |
| `packages/adapter-opencode/src/prompt-generation.ts` | Fluje hacia prompts generados |

## Tests que Referencian Personalidad

| Test File | Qué Verifica |
|---|---|
| `orchestrator-content.test.ts` | GUIDA contiene triage, Pragmatica = SYSTEM_PROMPT, exports |
| `content-registry.test.ts` (línea 792+) | guia/pragmatica variants, default backward compat |
| `deck-config.test.ts` | Validación de valores válidos ("guia", "pragmatica") |
| `developer-team-install.test.ts` | personality option fluye a generated content |
| `runner-capabilities.test.ts` | buildInstallPlan con non-default personality |

## Riesgos y Restricciones

### Riesgos Identificados

1. **Snapshot tests:** No hay snapshot tests explícitos, pero tests en `orchestrator-content.test.ts` verifican contenido específico (líneas 343-352)
2. **Backward compatibility:** `ORCHESTRATOR_PROMPT_PRAGMATICA` es alias directo de `ORCHESTRATOR_SYSTEM_PROMPT` — cualquier cambio debe mantener esta equivalencia
3. **Invariants referencing:** `orchestrator-invariants.ts` referencia secciones específicas de GUIDA (líneas 74, 100, 126, 153, 180) — cambiar estructura puede romper referencias

### Restricciones

- Nombres de exports (`ORCHESTRATOR_PROMPT_GUIDA`, `ORCHESTRATOR_PROMPT_PRAGMATICA`, `getOrchestratorSystemPrompt`) deben mantenerse para backward compat
- Tipos en `deck-config.ts` (`ORCHESTRATOR_PERSONALITIES`, `OrchestratorPersonality`) deben mantenerse

## Recomendaciones para Rediseño

### Enfoque Propuesto: Capas de Comunicación

1. **Core operacional compartido** — extraer reglas operacionales a constants separados de la personalidad
2. **Capas de comunicación delgadas** — agregar fragmentos de comunicación que se prepend/append al core
3. **getOrchestratorSystemPrompt** — sigue devolviendo el prompt completo pero compuesto

### Beneficios

- DRY: operacional en un solo lugar
- Extensibilidad: nueva personalidad = nueva capa de comunicación
- Tests existentes se adaptan verificando composición

### Lo Que Puede Necesitar Actualización

- Tests en `orchestrator-content.test.ts` que verifican contenido específico de GUIDA
- Referencias en `orchestrator-invariants.ts` a secciones por número de línea
- Documentación que menciona las personalidades actuales

## Preguntas Abiertas

1. ¿Cuántas instrucciones de comunicación quiere el usuario por personalidad?
2. ¿La estructura de capas debe ser prepend o append?
3. ¿Se mantienen los nombres de exports actuales?

## Listo para Proposal

**Sí.** La investigación revela una arquitectura clara con tests existentes que cubrirán el cambio. El riesgo principal es adaptar tests de contenido específico y referencias de invariantes.