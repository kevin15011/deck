# Exploration lifecycle states — Exploration

## 1. Resumen ejecutivo

El flujo SDD actual registra Explorer como `explore completed`, pero no distingue entre “listo para Proposal” y “diagnóstico suficiente que queda detenido”. La auditoría encontró tres cambios abiertos con causa raíz clara y sin Proposal posterior. La recomendación es añadir un lifecycle mínimo, aplicado sólo cuando Explorer termina y el usuario/Orchestrator no continúa inmediatamente a Proposal.

## 2. Evidencia con paths concretos

- `docs/openspec-retrospective-audit-2026-06-12.md:26-28` lista `fix-provider-engram-leak`, `fix-adaptive-memory-heading-duplication` y `fix-supermemory-userid-validation` como exploration-only con causa raíz clara.
- `docs/openspec-retrospective-audit-2026-06-12.md:59-70` identifica el gap: no existe distinción oficial entre exploración cerrada como diagnóstico y cambio pendiente de implementación; recomienda `diagnosed`, `deferred`, `converted-to-change`, `closed-no-action`.
- `openspec/changes/fix-provider-engram-leak/state.yaml:1-7` sólo contiene `phase: explore`, `status: completed`, `artifact: exploration.md`; no hay decisión posterior.
- `openspec/changes/fix-provider-engram-leak/exploration.md:15,36,162-170` documenta root cause y registra Explorer completado.
- `openspec/changes/fix-adaptive-memory-heading-duplication/state.yaml:1-8` usa `state: explore`, `status: completed`, artifacts mínimos; no hay Proposal.
- `openspec/changes/fix-adaptive-memory-heading-duplication/events.yaml:2-7` resume root cause de duplicación de headings sin lifecycle posterior.
- `openspec/changes/fix-supermemory-userid-validation/state.yaml:2-10` combina `status: exploring` con `phases.explore.status: completed`, un caso de estado contradictorio.
- `openspec/changes/fix-supermemory-userid-validation/state.yaml:11-14` conserva una nota de causa raíz exacta, pero no decisión de cierre/defer/conversión.
- `packages/core/src/teams/developer/orchestrator-content.ts:142-152` define flujo lineal `Explore -> Proposal -> Spec + Design -> Tasks -> Apply -> Verify + Review -> Archive`.
- `packages/core/src/teams/developer/orchestrator-content.ts:184-188` define modo Interactive: después de cada fase se muestra resumen y se pregunta antes de continuar.
- `packages/core/src/teams/developer/orchestrator-content.ts:210-220` exige que `state.yaml` y `events.yaml` registren fase/status/evento y que no se pierda historial.
- `packages/core/src/teams/developer/explorer-content.ts:148-156` limita Explorer a `explore` con status `completed` o `blocked`; no contempla decisión posterior.
- `openspec/registry-schema.md:37-67` define phases/status canónicos, sin estado específico de exploraciones diagnosticadas.
- `openspec/archive/precondition-closure-gate/state.yaml:6-16` demuestra patrón recomendado: estado mínimo con artifacts; detalles ricos en artifact/provenance.
- `openspec/archive/precondition-closure-gate/events.yaml:1-78` demuestra patrón de eventos auditables sin añadir fase nueva para gates auxiliares.

## 3. Mapa de lifecycle actual vs propuesto

| Momento | Actual | Problema | Propuesto |
|---|---|---|---|
| Explorer termina con incertidumbre | `explore blocked` o preguntas abiertas en `exploration.md` | Aceptable; ya hay bloqueo explícito | Sin cambio |
| Explorer termina y sigue a Proposal | `explore completed` → `proposal completed` | Aceptable; el avance queda implícito por Proposal | Registrar `converted-to-change` sólo si hubo pausa/decisión explícita, no en flujo continuo |
| Explorer termina con causa raíz clara y se detiene | `explore completed` | Queda flotando: no se sabe si requiere implementación, cierre o postergación | `exploration_lifecycle: diagnosed` + evento `exploration.diagnosed` |
| Usuario decide no actuar | No existe estado | El change queda abierto aunque no habrá cambio | `closed-no-action` + razón |
| Usuario decide postergar | No existe estado | No hay next review ni owner | `deferred` + razón/condición de reactivación |
| Usuario decide convertir a SDD formal más tarde | Proposal puede aparecer luego, pero no hay puente desde diagnóstico | La transición no queda explícita | `converted-to-change` + referencia a Proposal/change destino |

## 4. Recomendación de estados y semántica

Recomiendo modelar estos valores como lifecycle de exploración, no como nuevas fases SDD:

- `diagnosed`: Explorer encontró causa raíz/diagnóstico accionable, pero el flujo no avanza inmediatamente a Proposal. Es estado transitorio que exige una decisión posterior.
- `deferred`: diagnóstico reconocido, pero se posterga por prioridad, dependencia externa, baseline health u otra condición. Debe incluir motivo y condición de reactivación mínima.
- `closed-no-action`: diagnóstico reconocido, pero se decide no implementar. Debe incluir razón breve para evitar reabrir por ambigüedad.
- `converted-to-change`: diagnóstico usado para continuar a Proposal o para crear/enlazar otro cambio. Debe referenciar `proposal.md` o el change destino.

No recomiendo convertirlos en `currentPhase` porque `openspec/registry-schema.md:37-53` define fases SDD secuenciales y `closed` ya tiene semántica de cierre general. Tampoco recomiendo meterlos como status global hasta que el validator acepte esos enums.

## 5. Dónde registrar lifecycle y por qué

Registro recomendado por capas:

1. `exploration.md`: fuente humana de diagnóstico, recomendación, alternativas y “decisión pendiente”. Es el lugar para explicar por qué aplica el lifecycle.
2. `state.yaml`: puntero mínimo y consultable, por ejemplo `exploration_lifecycle: diagnosed`, `decision_required: true`, `next_action: decide-proposal-defer-or-close`. Mantenerlo liviano para no duplicar el artifact.
3. `events.yaml`: auditoría de transición, por ejemplo `exploration.diagnosed`, `exploration.deferred`, `exploration.closed-no-action`, `exploration.converted-to-change`.

Esta combinación mantiene búsquedas rápidas en registry y trazabilidad temporal sin inflar `state.yaml`.

## 6. Reglas anti-burocracia

- Aplicar sólo si Explorer completó y no se continúa inmediatamente a Proposal en la misma interacción.
- No pedir artifact nuevo adicional; usar `exploration.md`, `state.yaml` y `events.yaml` existentes.
- No exigir tabla extensa: basta estado, razón corta y next action.
- No bloquear cambios que sí avanzan normalmente a Proposal.
- No convertir esto en gate previo a Apply; el gate de precondiciones ya cubre otro problema.
- No intentar clasificar exploraciones históricas automáticamente salvo migración/cleanup separado.
- Si el diagnóstico no es claro, mantener `explore blocked` u open questions; no usar `diagnosed`.

## 7. Scope recomendado vs out-of-scope/follow-ups

### In scope para Proposal

- Actualizar prompts de Explorer para devolver una recomendación explícita cuando `Ready for Proposal: No` pero hay diagnóstico accionable.
- Actualizar prompts de Orchestrator para que, en modo Interactive, después de Explorer decida/solicite una de: continuar a Proposal, defer, cerrar sin acción.
- Definir campos mínimos no invasivos en registry para lifecycle de exploración.
- Definir eventos de lifecycle en `events.yaml`.
- Añadir tests de contenido/prompt que aseguren anti-burocracia y que el flujo normal Explorer → Proposal no cambia.

### Out of scope

- Cambiar semántica global de phases SDD.
- Añadir una nueva fase `diagnosed` al pipeline.
- Migrar todos los cambios históricos.
- Modificar el validator para convertir estos campos en errores estrictos.
- Cambiar el precondition closure gate.

### Follow-ups recomendados

- Cleanup manual de los tres casos históricos detectados por auditoría.
- Extensión warning-only del registry validator para detectar `explore completed` sin Proposal ni lifecycle.
- Comando/doctor que liste exploraciones `diagnosed` o `deferred` pendientes.

## 8. Riesgos y mitigaciones

- **Riesgo: burocracia adicional en cada Explorer.** Mitigar aplicando sólo cuando no se continúa a Proposal.
- **Riesgo: drift con `openspec-registry-schema-validator`.** Mitigar con campos opcionales y warning-only en follow-up, sin romper enums canónicos.
- **Riesgo: mezclar con `precondition-closure-gate`.** Mitigar manteniendo lifecycle antes de Proposal; precondition gate vive después de Tasks y antes de Apply.
- **Riesgo: estados ambiguos (`diagnosed` vs `deferred`).** Mitigar con semántica: `diagnosed` exige decisión; `deferred` ya contiene decisión de postergar.
- **Riesgo: conversiones dobles a Proposal.** Mitigar haciendo `converted-to-change` idempotente y referenciado por artifact/change destino.

## 9. Open questions/blockers

- ¿Debe `exploration_lifecycle` entrar en `openspec/registry-schema.md` como campo opcional formal en el mismo cambio o sólo en prompts primero?
- ¿El Orchestrator debe pedir decisión al usuario siempre que Explorer indique `diagnosed`, o puede elegir `deferred` automáticamente sólo cuando el usuario ya lo pidió explícitamente?
- ¿Se desea cleanup inmediato de los tres históricos o dejarlo como follow-up separado?

No hay blocker técnico para Proposal; el scope puede ser prompt/registry ligero.

## 10. Propuesta para Proposal

Proponer un cambio mínimo: “Exploration lifecycle states” agrega un lifecycle opcional para exploraciones diagnosticadas que no avanzan inmediatamente a Proposal. El Proposal debería comprometer:

- Estados: `diagnosed`, `deferred`, `closed-no-action`, `converted-to-change`.
- Registro: detalle en `exploration.md`, campo mínimo opcional en `state.yaml`, transición auditable en `events.yaml`.
- Orchestrator Interactive: al finalizar Explorer sin continuar, solicitar/registrar decisión.
- Orchestrator Automatic: si el flujo continúa a Proposal, no añadir ceremonia; si se detiene por decisión o blocker, registrar lifecycle.
- Validación inicial: tests de prompts/contenido; validator warning-only como follow-up salvo que se decida incluirlo explícitamente.

## Options and tradeoffs

1. **Sólo artifact (`exploration.md`)**
   - Pros: cero schema drift; mínimo costo.
   - Cons: difícil de consultar; no evita cambios flotantes.
   - Effort: Low.

2. **State + events opcionales (recomendado)**
   - Pros: consultable, auditable, no cambia fases; bajo costo.
   - Cons: requiere prompts/tests y convención nueva.
   - Effort: Medium.

3. **Nueva fase/status canónico estricto**
   - Pros: máxima formalidad.
   - Cons: alto costo; toca validator/pipeline; mezcla lifecycle auxiliar con SDD core.
   - Effort: High.

## Ready for Proposal

Sí. El Proposal debe mantener scope estrecho: lifecycle opcional para exploraciones diagnosticadas detenidas, sin modificar pipeline core ni precondition gate.

## Registry

- **Artifact Path**: `openspec/changes/exploration-lifecycle-states/exploration.md`
- **State Path**: `openspec/changes/exploration-lifecycle-states/state.yaml`
- **Events Path**: `openspec/changes/exploration-lifecycle-states/events.yaml`
- **Recorded**: phase `explore`, status `completed`, event `explore.completed`
- **Registry Blocker**: none
