# PRD: Supermemory MCP como provider de memoria adaptativa

## 1. Resumen

Agregar **Supermemory MCP** como una nueva opción de memoria adaptativa junto a las opciones existentes, incluyendo **Engram**. Durante la instalación solo se podrá escoger **un provider de memoria adaptativa activo**; ese provider quedará configurado para el runner y deberá comportarse bajo una interfaz común.

Principio rector:

> **OpenSpec manda. Supermemory aconseja.**

Supermemory debe mejorar la colaboración del agente recordando preferencias, correcciones, patrones del proyecto y contexto reciente entre dispositivos, pero **nunca** debe decidir requisitos, reemplazar specs ni modificar OpenSpec a partir de memoria inferida.

Supermemory aporta dos mecanismos complementarios: perfiles de usuario autoactualizados y búsqueda de memoria. Los perfiles combinan facts estáticos —preferencias estables, nivel técnico, estilo de trabajo— con facts dinámicos —contexto reciente como cambios o depuraciones activas—. El perfil sirve para contexto amplio; la búsqueda sirve para recuperar detalles específicos.

## 2. Problema

El sistema ya contempla memoria adaptativa, pero necesita soportar múltiples providers con comportamiento uniforme. En particular, Supermemory ofrece capacidades útiles para persistencia cross-device, perfiles de usuario autoactualizados, herramientas MCP (`memory`, `recall`, `context`) y separación por `container tags`.

Sin una política clara, la memoria adaptativa puede causar drift:

- Convertir preferencias personales en requisitos.
- Mezclar contexto de proyecto, equipo y usuario.
- Repetir ruido de conversaciones pasadas.
- Contradecir OpenSpec.
- Tratar inferencias como autoridad.

## 3. Objetivos

- Permitir seleccionar **Supermemory MCP** como provider de memoria adaptativa durante instalación.
- Mantener una interfaz común para todas las memorias adaptativas.
- Usar Supermemory para contexto asesor antes y durante fases SDD.
- Separar memoria personal, de proyecto, de equipo y organizacional mediante `container tags`.
- Guardar solo aprendizajes de alta señal, con metadata estricta.
- Preservar OpenSpec como fuente oficial de producto, requisitos, diseño aprobado y tasks.
- Soportar continuidad cross-device cuando distintos clientes usen el mismo space/container de Supermemory.

## 4. No objetivos

- No reemplazar OpenSpec con Supermemory.
- No guardar specs oficiales completos como memoria adaptativa.
- No guardar tasks activas como recuerdos.
- No permitir que Supermemory modifique OpenSpec sin acción explícita.
- No guardar secretos, tokens, claves ni código sensible.
- No guardar todo el chat crudo.
- No convertir reglas de negocio inferidas en verdad oficial.
- No permitir múltiples providers activos simultáneamente en el runner.

## 5. Usuarios y casos principales

### Usuario principal

Desarrollador o equipo que usa agentes con SDD/OpenSpec y quiere continuidad adaptativa entre sesiones, máquinas o clientes.

### Casos de uso

1. **Perfil adaptativo del desarrollador**
   - Recordar cómo prefiere que razone el agente.
   - Recordar errores que el agente no debe repetir.
   - Recordar formatos de output aceptados/rechazados.
   - Recordar preferencias de planificación, diseño, implementación y verificación.

2. **Memoria adaptativa por proyecto**
   - Recordar patrones técnicos repetidos.
   - Recordar anti-patterns del repo.
   - Recordar heurísticas de implementación no normativas.
   - Recordar convenciones candidatas sin tratarlas como reglas oficiales.

3. **Memoria reciente cross-device**
   - Compartir contexto reciente entre portátil, desktop y otros agentes compatibles.
   - Mantener preferencias y correcciones cuando el usuario cambia de cliente.

## 6. Principios de autoridad

Jerarquía de prioridad contextual:

1. Instrucciones explícitas del usuario en la sesión actual.
2. OpenSpec activo del change actual.
3. OpenSpec specs aprobados.
4. Código y tests reales.
5. Memoria de proyecto aceptada.
6. Memoria personal del usuario.
7. Memoria de equipo candidata.
8. Inferencias del agente.

Reglas obligatorias:

- La memoria adaptativa es **advisory**, no autoritativa.
- OpenSpec es la fuente oficial para requisitos, diseño aprobado y tasks.
- Una memoria puede sugerir: “históricamente el usuario prefiere X”.
- Una memoria no puede justificar: “modificaré el spec para X” sin aprobación.
- Las decisiones de producto viven en OpenSpec, no en memoria.

## 7. Requisitos funcionales

### FR1. Selección de provider durante instalación

- El instalador debe ofrecer Supermemory MCP como opción de memoria adaptativa.
- Si existen otras opciones como Engram, el usuario debe escoger solo una.
- El provider seleccionado debe quedar persistido en configuración.
- El runner debe cargar únicamente el provider activo.
- Todas las opciones deben exponer el mismo contrato de comportamiento.

### FR2. Adapter propio de memoria

- El sistema debe implementar un adapter propio para Supermemory.
- El runner no debe depender directamente de detalles específicos de Supermemory MCP.
- El adapter debe encapsular operaciones como:
  - cargar perfil/contexto adaptativo;
  - buscar memorias relevantes;
  - guardar aprendizajes seleccionados;
  - aplicar metadata;
  - filtrar por scope/container;
  - respetar umbrales y modo de búsqueda.
- MCP puede usarse como canal/herramienta, pero no debe ser el contrato interno principal.
- El adapter debe mapear las herramientas MCP de Supermemory detrás del contrato interno:
  - `context`: obtener perfil/contexto amplio del usuario o container.
  - `recall`: recuperar memorias relevantes por query, scope y metadata.
  - `memory`: crear o actualizar unidades de memoria aprobadas por la política de commit.

### FR3. Interfaz común de memoria adaptativa

Todos los providers deben comportarse igual desde la perspectiva del runner:

- `loadAdaptiveContext(input)`
- `searchMemories(query, filters)`
- `commitMemories(candidates)`
- `summarizeSession(input)`
- `configureProvider(config)`
- `healthCheck()`

La diferencia entre providers debe limitarse a implementación interna, autenticación, transporte y capacidades específicas.

### FR4. Contexto antes de cada fase SDD

Al iniciar una fase SDD, el sistema debe:

1. Detectar `userId`, `projectId`, `changeId` y fase.
2. Cargar artefactos oficiales desde OpenSpec.
3. Pedir perfil/contexto adaptativo al provider activo.
4. Buscar memorias relevantes por fase.
5. Ensamblar prompt con separación explícita:
   - `OFFICIAL CONTEXT`
   - `ADAPTIVE CONTEXT`
   - reglas de autoridad.

El prompt debe incluir siempre:

```text
RULE:
- OpenSpec is authoritative.
- Adaptive memory is advisory.
- Do not modify specs based only on memory.
```

### FR5. Usos permitidos de Supermemory

Supermemory debe aportar:

- Preferencias de razonamiento del usuario.
- Errores que el agente no debe repetir.
- Outputs que el usuario acepta o rechaza.
- Patrones técnicos repetidos en el proyecto.
- Convenciones personales o de equipo que conviene recordar.
- Contexto reciente entre dispositivos.

### FR6. Usos prohibidos de Supermemory

Supermemory no debe:

- Decidir requisitos.
- Reemplazar specs.
- Modificar OpenSpec por memoria inferida.
- Promover reglas de negocio inferidas.
- Tratar ideas no aprobadas como verdad.
- Mezclar preferencias personales con reglas de equipo.

### FR7. Container tags y scopes

El sistema debe usar `container tags` cortos y aislados:

| Scope | Container tag | Uso |
|---|---|---|
| Personal global | `u:{userId}` | Preferencias estables del desarrollador |
| Personal por proyecto | `u:{userId}:p:{projectId}` | Preferencias del usuario dentro del proyecto |
| Proyecto | `p:{projectId}` | Patrones y heurísticas del repo |
| Equipo por proyecto | `team:{teamId}:p:{projectId}` | Convenciones de equipo candidatas o aprobadas |
| Organización | `org:{orgId}` | Reglas generales de organización, futuro |

Restricciones:

- Los IDs deben ser cortos.
- `containerTag` debe respetar límite de 100 caracteres.
- Caracteres permitidos esperados: letras, números, `_`, `:`, `-`.
- No se debe usar un único contenedor global para todo.

### FR8. Metadata obligatoria

Cada memoria guardada debe incluir metadata.

```ts
type MemoryMetadata = {
  source: "session" | "openspec" | "user_feedback" | "agent_error" | "retrospective";
  scope: "personal" | "project" | "team" | "org";
  type:
    | "preference"
    | "correction"
    | "rejected_approach"
    | "accepted_pattern"
    | "project_heuristic"
    | "team_convention_candidate"
    | "workflow_rule"
    | "anti_pattern";
  projectId?: string;
  changeId?: string;
  openspecArtifact?: "proposal" | "specs" | "design" | "tasks";
  phase?: "explore" | "proposal" | "spec" | "design" | "tasks" | "implement" | "verify" | "archive";
  confidence: number;
  promotionStatus?: "candidate" | "accepted" | "rejected" | "superseded";
  createdBy: "user" | "agent" | "system";
  evidence?: string;
};
```

El adapter debe aprovechar metadata filtering cuando esté disponible, incluyendo AND/OR, equality, string contains, numeric filters y array contains.

### FR9. Qué guardar

Guardar solo señales fuertes:

1. Correcciones explícitas del usuario.
   - “No hagas X”.
   - “Prefiero Y”.
   - “Esto está mal por Z”.
2. Rechazos repetidos.
3. Preferencias de trabajo.
4. Patrones de proyecto repetidos.
5. Convenciones candidatas.
6. Resúmenes post-sesión con 3-7 aprendizajes máximo.

Ejemplos válidos:

- “El usuario prefiere que antes de implementar se actualice `tasks.md`.”
- “El usuario rechaza propuestas que mezclan diseño técnico con reglas de negocio sin separarlas.”
- “El usuario prefiere respuestas críticas con tradeoffs, no validación complaciente.”
- “Cuando trabaja con SDD, quiere que el agente valide OpenSpec antes de tocar código.”
- “El usuario suele preferir TypeScript estricto y APIs explícitas.”
- “En este proyecto, los cambios de auth suelen requerir revisar middleware, session store y tests e2e.”
- “En este repo, las migraciones deben separarse de cambios de lógica de dominio.”
- “El equipo suele rechazar helpers demasiado genéricos si no hay dos o más casos de uso.”
- “Las decisiones de producto se documentan en OpenSpec, no en comentarios sueltos.”

### FR10. Qué no guardar

No guardar:

1. Specs oficiales completos.
2. Tasks exactas activas.
3. Reglas de negocio inferidas.
4. Código sensible.
5. Tokens, claves o secretos.
6. Todo el chat crudo.
7. Ideas descartadas sin contexto.
8. Propuestas no aprobadas como verdad.
9. Deltas experimentales.

Además, el sistema debe distinguir entre documentos/raw input y memorias inteligentes extraídas. Que Supermemory pueda recibir documentos o chunks no significa que todo deba convertirse en memoria adaptativa. La ingesta debe controlar cuidadosamente la materia prima para evitar ruido y falsas asociaciones.

### FR11. Captura de eventos candidatos durante sesión

La herramienta debe detectar o permitir registrar eventos candidatos:

- `UserCorrection`
- `AgentMistake`
- `RejectedApproach`
- `AcceptedPattern`
- `PreferenceSignal`
- `WorkflowFriction`
- `ProjectHeuristicCandidate`
- `TeamConventionCandidate`

Ejemplo:

```json
{
  "event": "UserCorrection",
  "content": "El usuario corrigió al agente porque quiso implementar antes de cerrar design.md.",
  "scope": "personal",
  "type": "correction",
  "phase": "design",
  "changeId": "add-adaptive-memory",
  "confidence": 0.95
}
```

### FR12. Memory commit al cerrar sesión

Al cerrar una sesión relevante, el sistema debe ejecutar una fase de commit de memoria:

1. Resumir la sesión.
2. Extraer máximo 3-7 aprendizajes.
3. Clasificar por scope: personal, project, team u org.
4. Descartar ruido.
5. Guardar en Supermemory si corresponde.
6. Actualizar OpenSpec solo si corresponde y con acción explícita.

Política por scope:

- Personal: guardado automático permitido si el usuario fue explícito.
- Project: guardado automático permitido si es heurística técnica no normativa.
- Team: guardar como `candidate`, salvo aprobación humana explícita.
- Official spec: solo vía OpenSpec.

### FR13. Prompts por container

El sistema debe configurar o recomendar prompts de extracción por container cuando Supermemory lo soporte.

#### Personal

```text
Extrae únicamente preferencias, correcciones, patrones de colaboración,
errores recurrentes del agente y señales de estilo de trabajo del usuario.
No conviertas requisitos de producto en preferencias personales.
No guardes secretos, tokens, claves o datos sensibles.
No trates propuestas no aprobadas como verdad.
```

#### Proyecto

```text
Extrae heurísticas técnicas, patrones de implementación, anti-patterns,
riesgos recurrentes y convenciones observadas del proyecto.
No guardes requisitos oficiales; esos viven en OpenSpec.
No promociones reglas de negocio inferidas.
Marca como candidate cualquier convención no aprobada.
```

#### Equipo

```text
Extrae únicamente convenciones de equipo explícitas o repetidas.
Marca todo como candidate salvo aprobación humana explícita.
No mezcles preferencias personales con reglas del equipo.
```

### FR14. Query strategy por fase SDD

El adapter debe usar queries específicas por fase.

| Fase | Query base | Scopes recomendados | Buscar |
|---|---|---|---|
| Proposal / Explore | `preferences and past corrections for planning new changes in this project` | `u:{userId}`, `u:{userId}:p:{projectId}`, `p:{projectId}` | preferencias de planificación, errores de scope, formatos, patrones rechazados |
| Spec | `how this user prefers requirements, acceptance criteria, business rules and OpenSpec specs` | personal + proyecto | separación requisitos/diseño, nivel de detalle, errores previos al definir specs |
| Design | `technical design preferences, rejected approaches, project heuristics, architecture constraints` | personal + proyecto + equipo candidato | enfoques rechazados, patrones del proyecto, estilo técnico |
| Implement | `implementation preferences, coding style, tests, mistakes to avoid in this repo` | proyecto aceptado + personal relevante | estilo de código, testing, anti-patterns |
| Verify / Archive | `verification preferences, review checklist, archive and retrospective learnings` | personal + proyecto | validación, cierre, errores pasados |

Modo de búsqueda:

- `searchMode: "memories"` para preferencias, correcciones y facts extraídos.
- `searchMode: "hybrid"` cuando también se indexen documentos o resúmenes.

Threshold sugerido:

- Exploración/planificación: `0.55-0.65`.
- Implementación/verificación: `0.70-0.80`.

Usar rerank cuando se necesite mayor precisión y la latencia adicional sea aceptable.

### FR15. Ingesta de OpenSpec en Supermemory

Sí se puede ingerir información derivada de OpenSpec, con cuidado.

Permitido:

- Resúmenes de cambios archivados.
- Retrospectivas.
- Decisiones aprendidas durante implementación.
- Heurísticas derivadas de cambios completados.
- Correcciones del usuario relacionadas con el flujo.

No permitido como memoria adaptativa:

- Specs activos completos.
- Tasks activas.
- Requisitos no aprobados.
- Deltas experimentales.

OpenSpec sigue siendo el store oficial; Supermemory consume resúmenes/eventos derivados para asesorar.

### FR16. Política de promoción

- Personal memory:
  - Guardado automático permitido si el usuario fue explícito.
- Project memory:
  - Guardado automático permitido si es heurística técnica no normativa.
- Team memory:
  - Guardar como `candidate`.
  - Promover solo con aprobación humana o repetición fuerte.
- Official spec:
  - Solo vía OpenSpec.

Ejemplo:

Usuario dice: “No me gusta que implementes sin cerrar design.”

Guardar:

```json
{
  "scope": "personal",
  "type": "correction",
  "confidence": 0.95
}
```

No guardar como:

```json
{
  "scope": "team",
  "type": "workflow_rule"
}
```

Salvo que el equipo lo apruebe, aparezca repetidamente o se formalice.

## 8. Requisitos no funcionales

### Seguridad y privacidad

- Nunca guardar secretos, tokens, claves o credenciales.
- Permitir filtros/redacción antes de guardar.
- Evitar almacenar chat crudo.
- Separar memoria por containers para evitar contaminación.

### Confiabilidad

- Si Supermemory no está disponible, el runner debe continuar sin memoria adaptativa o con fallback seguro.
- Fallos de memoria no deben bloquear lectura de OpenSpec ni ejecución principal.
- El prompt debe marcar claramente cuando no se cargó memoria adaptativa.

### Portabilidad

- El contrato interno debe permitir cambiar entre Engram, Supermemory u otros providers.
- La selección de provider debe ser configurable sin cambios de código del runner.

### Control de ruido

- Máximo 3-7 memorias guardadas por sesión.
- No guardar conversaciones triviales.
- Requerir metadata y confidence.
- Usar `promotionStatus` para candidates.

### Observabilidad

- Registrar provider activo.
- Registrar consultas ejecutadas sin exponer contenido sensible.
- Registrar conteo de memorias recuperadas por scope/fase.
- Registrar memorias candidatas descartadas y motivo, cuando sea útil.

## 9. Experiencia de instalación

Durante instalación/configuración:

1. Mostrar opciones de memoria adaptativa disponibles.
2. Explicar que solo una quedará activa.
3. Si se elige Supermemory:
   - solicitar credenciales/configuración necesaria;
   - configurar `userId`, `projectId` y opcionalmente `teamId`/`orgId`;
   - validar conexión;
   - configurar containers base;
   - guardar provider activo.
4. Si se elige Engram u otro provider:
   - aplicar el mismo contrato general.
5. Confirmar qué provider quedó activo.

Ejemplo conceptual:

```text
Adaptive memory provider:
[1] None
[2] Engram
[3] Supermemory MCP

Only one provider can be active for the runner.
```

## 10. Contrato conceptual del prompt

Cada fase debe recibir contexto separado:

```text
OFFICIAL CONTEXT:
- OpenSpec proposal/specs/design/tasks relevant to the phase.

ADAPTIVE CONTEXT:
- Relevant personal preferences.
- Agent mistakes to avoid.
- Learned project patterns.
- Accepted/candidate conventions.

RULE:
- OpenSpec is authoritative.
- Adaptive memory is advisory.
- Do not modify specs based only on memory.
```

## 11. Riesgos y mitigaciones

| Riesgo | Impacto | Mitigación |
|---|---:|---|
| Dependencia cloud de Supermemory | Medio/Alto | Adapter propio, fallback sin memoria, health checks, configuración explícita. Documentar que el uso normal depende de la API/plataforma de Supermemory y que self-host puede depender de tiers superiores como Scale. |
| Drift de memoria | Alto | Metadata estricta, scopes separados, `promotionStatus`, OpenSpec manda |
| Sobrepersonalización | Medio | Presentar preferencias como preferencias, no requisitos; priorizar proyecto/OpenSpec |
| Memoria basura | Alto | Máximo 3-7 memorias por sesión, guardar solo señales fuertes, filtros por metadata |
| Mezcla de scopes | Alto | Container tags separados y prompts por container |
| Inferencias tratadas como reglas | Alto | Team memory como candidate; reglas oficiales solo vía OpenSpec |
| Latencia por rerank/hybrid | Medio | Thresholds por fase, rerank solo cuando aporte precisión |

## 12. Criterios de aceptación

- [ ] El instalador ofrece Supermemory MCP como provider de memoria adaptativa.
- [ ] Solo un provider puede quedar activo en el runner.
- [ ] El runner usa una interfaz común para Engram, Supermemory y futuros providers.
- [ ] Supermemory puede cargar perfil/contexto adaptativo antes de fases SDD.
- [ ] El prompt separa `OFFICIAL CONTEXT` y `ADAPTIVE CONTEXT`.
- [ ] El prompt declara que OpenSpec es autoritativo y la memoria es asesora.
- [ ] Las memorias guardadas incluyen metadata obligatoria.
- [ ] Las búsquedas usan container tags por usuario/proyecto/equipo/org.
- [ ] La sesión guarda máximo 3-7 aprendizajes relevantes.
- [ ] No se guardan specs activos completos, tasks activas, secretos ni chat crudo.
- [ ] Team memory se guarda como candidate salvo aprobación explícita.
- [ ] Fallos de Supermemory no bloquean OpenSpec ni el flujo principal.
- [ ] La implementación permite cambiar provider sin modificar lógica SDD central.

## 13. Métricas de éxito

- Reducción de correcciones repetidas del usuario.
- Menos errores de workflow SDD, especialmente implementar antes de cerrar diseño/tasks.
- Mayor precisión de outputs según preferencias históricas.
- Bajo número de memorias descartadas por ruido.
- Cero incidentes donde memoria contradiga o modifique OpenSpec sin aprobación.
- Recuperación consistente de contexto entre dispositivos/clientes.

## 14. Preguntas abiertas

- ¿Cuál será el formato exacto de configuración del provider activo?
- ¿Cómo se obtendrá `userId`, `projectId`, `teamId` y `orgId` en cada entorno?
- ¿El instalador debe crear/configurar prompts por container automáticamente o solo documentarlos?
- ¿Qué UI/comando permitirá revisar, promover o rechazar candidates?
- ¿Qué fallback exacto se usará cuando Supermemory esté caído o sin credenciales?
- ¿Se requiere migración desde memorias existentes de Engram hacia Supermemory?
- ¿Qué nivel de auditoría se necesita para memorias guardadas automáticamente?

## 15. Decisión central

Agregar Supermemory MCP como provider de memoria adaptativa seleccionable, manteniendo una abstracción común y una política estricta de autoridad:

> Supermemory mejora la adaptación del agente; OpenSpec preserva la verdad oficial del cambio.
