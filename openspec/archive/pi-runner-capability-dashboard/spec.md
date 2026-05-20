# Spec: Dashboard por capacidades para Pi Runner

## Source

- Proposal: `pi-runner-capability-dashboard` proposal artifact
- Exploration: `pi-runner-capability-dashboard` exploration artifact
- Capabilities affected: `pi-runner-capability-dashboard`, `pi-runner-global-capabilities`, `pi-runner-adaptive-memory-selection`, `pi-runner-ui-visual-helpers`, `pi-runner-team-configuration`, `pi-runner-install-review-plan`, `pi-runner-installation-flow`, `developer-team-installation`, `developer-team-model-configuration`, `adaptive-memory-configuration`

## Requirements

### Capability: `pi-runner-capability-dashboard`

REQ-DASH-001: El flujo de instalación/configuración del Pi Runner MUST presentarse como un dashboard por secciones, no como un wizard lineal de preguntas yes/no.
  Priority: MUST
  Surface: UI
  Rationale: El objetivo aprobado es que el usuario explore y confirme cobertura por capacidades antes de ejecutar cambios.

REQ-DASH-002: El dashboard MUST incluir las secciones user-facing: Runner Capabilities globales, Adaptive Memory global, Runner UI/visual helpers, Teams, y Review & Install.
  Priority: MUST
  Surface: UI
  Rationale: La separación de decisiones evita mezclar capacidades globales, memoria adaptativa, helpers visuales, teams y revisión final.

REQ-DASH-003: El dashboard MUST permitir entrar y salir de cada sección sin perder selecciones ya realizadas, y MUST mostrar un resumen observable del estado de cada sección.
  Priority: MUST
  Surface: UI
  Rationale: El usuario necesita revisar cobertura y ajustar decisiones antes del plan final.

REQ-DASH-004: El dashboard MUST preguntar por capacidades, memoria y teams; no MUST pedir decisiones primarias por paquete individual.
  Priority: MUST
  Surface: UI
  Rationale: El nuevo modelo aprobado es capability-first; los paquetes son acciones derivadas, no la unidad primaria de decisión.

### Capability: `pi-runner-global-capabilities`

REQ-GCAP-001: Runner Capabilities MUST presentar RTK, context-mode y codebase-memory como capacidades configurables por el usuario; MUST presentar Mermaid como capacidad obligatoria de runner con implementación específica por runner; MUST mapear Pi a `pi-mermaid`; y MUST presentar pi-hud como helper opcional limitado a Pi.
  Priority: MUST
  Surface: UI
  Rationale: El usuario confirmó que el concepto obligatorio es Mermaid para runners, no `pi-mermaid` como concepto global; `pi-mermaid` es la implementación de Pi. pi-hud es opcional y solo aplica a Pi.

REQ-GCAP-002: Cada capability global MUST mostrar estado observable de disponibilidad/acción, incluyendo cuando esté lista, falte, requiera instalación manual o tenga fuente/detección pendiente/desconocida.
  Priority: MUST
  Surface: UI
  Rationale: Las capabilities mezclan paquetes instalables, herramientas externas y elementos aún no confirmados.

REQ-GCAP-003: El dashboard MUST NOT ofrecer `@juicesharp/rpiv-todo` ni `@juicesharp/rpiv-ask-user-question` como capabilities seleccionables ni como acciones derivadas del plan por capacidades globales.
  Priority: MUST
  Surface: UI
  Rationale: El usuario confirmó explícitamente que esos paquetes quedan excluidos del dashboard.

REQ-GCAP-004: Cuando una capability seleccionada o requerida no tenga instalación automática disponible, el sistema MUST representarla como paso manual, pendiente o bloqueante según corresponda, en vez de presentarla como instalación automática lista.
  Priority: MUST
  Surface: UI
  Rationale: RTK/codebase-memory y otras herramientas externas no deben verse como fallos confusos ni como promesas de instalación automática; Mermaid puede ser obligatorio aunque su implementación/source esté pendiente.

REQ-GCAP-005: El Review Plan para Pi y OpenCode MUST incluir Mermaid como requisito obligatorio del runner, aunque no sea una opción seleccionable por el usuario; para Pi, la acción técnica MUST mapearse a `pi-mermaid`.
  Priority: MUST
  Surface: Data
  Rationale: El usuario confirmó que Mermaid será necesario para los runners por una funcionalidad futura, y que `pi-mermaid` es solo la implementación para Pi.

### Capability: `pi-runner-adaptive-memory-selection`

REQ-MEM-001: Adaptive Memory MUST ser una selección única global con exactamente estas opciones user-facing: `None`, `Engram`, `Supermemory`.
  Priority: MUST
  Surface: UI
  Rationale: La decisión de producto confirmó memoria adaptativa single-choice.

REQ-MEM-002: La opción default de Adaptive Memory MUST ser `None`, sin provider de memoria adaptativa activo por default.
  Priority: MUST
  Surface: State
  Rationale: La propuesta excluye activar memoria adaptativa por defecto.

REQ-MEM-003: Cuando Adaptive Memory sea `None`, el plan final MUST NOT incluir instalación, configuración o acción técnica específica de Engram o Supermemory.
  Priority: MUST
  Surface: Data
  Rationale: `None` significa que no hay provider activo ni acciones de memoria adaptativa.

REQ-MEM-004: Engram/`engram-memory` MUST aparecer como opción instalable o acción técnica solo cuando Adaptive Memory = `Engram` esté seleccionado.
  Priority: MUST
  Surface: UI
  Rationale: Esta regla de installability fue confirmada explícitamente por el usuario y registrada en el cambio.

REQ-MEM-005: Al cambiar entre `None`, `Engram` y `Supermemory`, el sistema MUST mantener una sola memoria adaptativa activa y MUST actualizar el plan para remover acciones del provider previamente seleccionado.
  Priority: MUST
  Surface: State
  Rationale: La memoria adaptativa es global y single-choice; no deben coexistir Engram y Supermemory como providers activos.

REQ-MEM-006: Cuando Adaptive Memory = `Supermemory`, el dashboard MUST representar la configuración requerida de Supermemory y MUST preservar la regla de que secretos/tokens no se guardan en configuración no secreta de Deck.
  Priority: MUST
  Surface: Security
  Rationale: Supermemory ya existe como provider soportado y su manejo de secretos es una capacidad unchanged.

REQ-MEM-007: Adaptive Memory MUST presentarse como auxiliar; OpenSpec y Spec Registry MUST seguir siendo la autoridad oficial del cambio.
  Priority: MUST
  Surface: General
  Rationale: La autoridad oficial frente a memoria adaptativa es una restricción unchanged.

### Capability: `pi-runner-ui-visual-helpers`

REQ-UI-001: La sección Runner UI/visual helpers MUST mostrar pi-hud como helper opcional dentro de Pi y MUST mostrar Mermaid como requisito obligatorio de documentación visual del runner; cuando el runner sea Pi, MUST mostrar `pi-mermaid` como implementación técnica de ese requisito.
  Priority: MUST
  Surface: UI
  Rationale: La propuesta exige una sección propia para helpers visuales, y el usuario aclaró que Mermaid no es opcional mientras que pi-hud sí lo es; `pi-mermaid` no debe confundirse con el concepto global Mermaid.

REQ-UI-002: Si pi-hud, Mermaid o su implementación técnica para el runner no tienen source, detección o instalación canónica confirmada, el dashboard MUST marcarlos como desconocidos, pendientes o manuales, y MUST NOT afirmar que pueden instalarse automáticamente.
  Priority: MUST
  Surface: UI
  Rationale: La exploración identificó que pi-hud y pi-mermaid no tienen source/detección/plan confirmados; Mermaid debe quedar pendiente/bloqueante como requisito obligatorio, con `pi-mermaid` como implementación Pi, y pi-hud pendiente opcional.

REQ-UI-003: pi-hud MUST NOT aparecer como requisito para OpenCode ni como capability obligatoria global; debe ser opcional y Pi-only.
  Priority: MUST
  Surface: UI
  Rationale: El usuario confirmó que pi-hud es opcional dentro de Pi únicamente.

### Capability: `pi-runner-team-configuration`

REQ-TEAM-001: Teams MUST tener una sección propia separada de Runner Capabilities globales y Adaptive Memory.
  Priority: MUST
  Surface: UI
  Rationale: La propuesta separa instalación/configuración de teams de capacidades globales.

REQ-TEAM-002: Developer Team MUST ser seleccionable desde la sección Teams.
  Priority: MUST
  Surface: UI
  Rationale: Developer Team es el team user-facing confirmado para la primera versión del dashboard.

REQ-TEAM-003: Si Developer Team está seleccionado, el usuario MUST poder abrir una pantalla o flujo propio de configuración de modelos por agente.
  Priority: MUST
  Surface: UI
  Rationale: La propuesta exige acceso a configuración de modelos por agente desde Developer Team.

REQ-TEAM-004: La configuración de modelos por agente MUST preservar el comportamiento actual de provider/model/thinking, incluyendo compatibilidad y defaults existentes.
  Priority: MUST
  Surface: UI
  Rationale: El cambio de UX no debe cambiar la semántica actual de modelos por agente.

REQ-TEAM-005: Cada team mostrado MUST indicar qué capabilities globales hereda o consume y MUST mostrar compatibilidad, faltantes o consumo no satisfecho de forma explícita.
  Priority: MUST
  Surface: UI
  Rationale: Los teams pueden heredar capabilities globales; el usuario debe entender impacto y readiness.

REQ-TEAM-006: Cuando un team seleccionado requiera o consuma una capability no seleccionada, faltante, manual o desconocida, el dashboard MUST mostrar un aviso accionable y el Review Plan MUST reflejar la condición.
  Priority: MUST
  Surface: UI
  Rationale: Un team no debe parecer listo si depende de capacidades no satisfechas.

REQ-TEAM-007: La ruta existente de configuración de modelos por agente SHOULD seguir ofreciendo el mismo resultado observable que antes del dashboard.
  Priority: SHOULD
  Surface: UI
  Rationale: El proposal requiere preservar comportamiento actual de configuración de modelos por agente.

### Capability: `pi-runner-install-review-plan`

REQ-PLAN-001: Review & Install MUST generar un plan final agrupado por instalaciones automáticas, pasos manuales, escritura de configuración, aplicación de team y validación.
  Priority: MUST
  Surface: UI
  Rationale: El usuario necesita revisar acciones listas antes de ejecutar cambios.

REQ-PLAN-002: El plan final MUST reflejar únicamente las capabilities, Adaptive Memory y teams seleccionados, más sus acciones derivadas obligatorias.
  Priority: MUST
  Surface: Data
  Rationale: El plan debe ser trazable a decisiones user-facing y no incluir paquetes excluidos o providers no seleccionados.

REQ-PLAN-003: El plan final MUST separar acciones listas, faltantes, manuales y pendientes/desconocidas, y MUST NOT presentar un plan con pendientes/desconocidas como completamente listo.
  Priority: MUST
  Surface: UI
  Rationale: Esto evita falsas garantías para herramientas externas o capabilities sin source confirmado.

REQ-PLAN-004: Desde Review & Install, el usuario MUST poder volver a secciones previas, cambiar decisiones y regenerar un plan coherente con el nuevo estado.
  Priority: MUST
  Surface: UI
  Rationale: El dashboard se basa en revisión iterativa antes de instalar.

REQ-PLAN-005: Review & Install SHOULD incluir una sección de validación esperada posterior a la instalación/aplicación.
  Priority: SHOULD
  Surface: UI
  Rationale: La propuesta pide agrupar validación como parte del plan final.

## Acceptance Scenarios

### Capability: `pi-runner-capability-dashboard`

#### Scenario: Dashboard inicial por secciones
**Given** el usuario inicia instalación/configuración del Pi Runner
**When** se presenta la experiencia principal
**Then** ve un dashboard con las secciones Runner Capabilities globales, Adaptive Memory global, Runner UI/visual helpers, Teams, y Review & Install, sin una secuencia lineal de preguntas yes/no
> Covers: REQ-DASH-001, REQ-DASH-002

#### Scenario: Navegación conserva estado
**Given** el usuario seleccionó RTK en Runner Capabilities globales y Developer Team en Teams
**When** entra a Adaptive Memory y luego vuelve al dashboard
**Then** el dashboard conserva RTK y Developer Team como seleccionados y muestra un resumen de estado por sección
> Covers: REQ-DASH-003

#### Scenario: Decisión primaria por capacidad
**Given** el usuario está en Runner Capabilities globales
**When** revisa las opciones disponibles
**Then** toma decisiones sobre RTK, context-mode, codebase-memory y pi-hud como capabilities configurables, y ve Mermaid como requisito obligatorio del runner con implementación técnica por runner (`pi-mermaid` para Pi), no como paquete individual ni opción opcional
> Covers: REQ-DASH-004, REQ-GCAP-001, REQ-GCAP-005

### Capability: `pi-runner-global-capabilities`

#### Scenario: Capabilities globales confirmadas
**Given** el usuario abre Runner Capabilities globales
**When** se listan capabilities y requisitos del runner
**Then** aparecen RTK, context-mode y codebase-memory como configurables, pi-hud como opcional Pi-only, Mermaid como requisito obligatorio del runner, `pi-mermaid` como implementación técnica solo para Pi, y no aparecen `@juicesharp/rpiv-todo` ni `@juicesharp/rpiv-ask-user-question`
> Covers: REQ-GCAP-001, REQ-GCAP-003, REQ-GCAP-005, REQ-UI-003

#### Scenario: Tool externa o faltante se muestra como manual
**Given** el usuario selecciona una capability cuya instalación automática no está disponible
**When** el dashboard calcula el estado de esa capability
**Then** la capability se muestra como manual, faltante o pendiente, y el usuario ve una acción o diagnóstico claro en vez de una instalación automática lista
> Covers: REQ-GCAP-002, REQ-GCAP-004

#### Scenario: Capability lista no genera paso manual innecesario
**Given** una capability seleccionada ya está disponible en el entorno
**When** el usuario revisa el estado de Runner Capabilities globales
**Then** la capability se muestra como lista y el plan no agrega un paso manual para instalarla
> Covers: REQ-GCAP-002, REQ-PLAN-002

### Capability: `pi-runner-adaptive-memory-selection`

#### Scenario: Default None sin acciones de memoria
**Given** el usuario abre el dashboard por primera vez
**When** revisa Adaptive Memory
**Then** `None` está seleccionado por default y no hay provider de memoria adaptativa activo ni acciones técnicas de Engram o Supermemory en el plan
> Covers: REQ-MEM-001, REQ-MEM-002, REQ-MEM-003

#### Scenario: Engram habilita installability de Engram
**Given** Adaptive Memory está en `None`
**When** el usuario selecciona `Engram`
**Then** Engram queda como único provider activo y Engram/`engram-memory` aparece como acción técnica o instalable derivada
> Covers: REQ-MEM-001, REQ-MEM-004, REQ-MEM-005

#### Scenario: Engram desaparece al cambiar de provider
**Given** Adaptive Memory = `Engram` y el plan incluye acción técnica de Engram/`engram-memory`
**When** el usuario cambia Adaptive Memory a `Supermemory` o `None`
**Then** el plan elimina las acciones de Engram/`engram-memory` y mantiene solo la selección activa correspondiente
> Covers: REQ-MEM-004, REQ-MEM-005

#### Scenario: Supermemory requiere configuración segura
**Given** el usuario selecciona Adaptive Memory = `Supermemory`
**When** revisa la configuración y el plan final
**Then** el dashboard muestra la configuración requerida de Supermemory, separa secretos de configuración no secreta y no propone guardar tokens en configuración no secreta de Deck
> Covers: REQ-MEM-006

#### Scenario: Memoria adaptativa sigue siendo auxiliar
**Given** Adaptive Memory está configurada como Engram o Supermemory
**When** el usuario revisa información de memoria adaptativa
**Then** el dashboard comunica que la memoria es auxiliar y que OpenSpec/Spec Registry siguen siendo autoridad oficial
> Covers: REQ-MEM-007

### Capability: `pi-runner-ui-visual-helpers`

#### Scenario: Helpers visuales agrupados
**Given** el usuario abre Runner UI/visual helpers
**When** se muestra la sección
**Then** pi-hud aparece como helper opcional Pi-only, Mermaid aparece como requisito obligatorio de documentación visual del runner y `pi-mermaid` aparece solo como implementación técnica para Pi
> Covers: REQ-UI-001, REQ-UI-003

#### Scenario: pi-hud o Mermaid/implementación técnica desconocidos
**Given** pi-hud, Mermaid o la implementación técnica del runner no tienen source, detección o instalación canónica confirmada
**When** el usuario revisa helpers visuales o el Review Plan
**Then** el dashboard marca Mermaid como requisito obligatorio pendiente/bloqueante o manual, muestra `pi-mermaid` como implementación pendiente solo cuando el runner es Pi, marca pi-hud como opcional pendiente/manual, y no los presenta como instalación automática lista
> Covers: REQ-UI-002, REQ-PLAN-003, REQ-GCAP-005

### Capability: `pi-runner-team-configuration`

#### Scenario: Developer Team seleccionable desde Teams
**Given** el usuario abre la sección Teams
**When** revisa teams disponibles
**Then** Developer Team aparece como seleccionable dentro de Teams, separado de capacidades globales y memoria adaptativa
> Covers: REQ-TEAM-001, REQ-TEAM-002

#### Scenario: Configuración de modelos por agente desde Developer Team
**Given** Developer Team está seleccionado
**When** el usuario abre la configuración del Developer Team
**Then** puede configurar modelos por agente usando el comportamiento existente de provider/model/thinking
> Covers: REQ-TEAM-003, REQ-TEAM-004

#### Scenario: Compatibilidad de thinking preservada
**Given** el usuario configura un modelo por agente
**When** selecciona provider/model/thinking
**Then** las opciones y resultados respetan la compatibilidad y defaults existentes, sin introducir nueva semántica de thinking
> Covers: REQ-TEAM-004, REQ-TEAM-007

#### Scenario: Team sin capability requerida o consumida
**Given** Developer Team está seleccionado y consume una capability global que no está seleccionada, está faltante, requiere paso manual o es desconocida
**When** el usuario revisa Teams o Review & Install
**Then** el dashboard muestra el consumo/compatibilidad afectado y el plan refleja una advertencia o acción necesaria antes de considerarlo completamente listo
> Covers: REQ-TEAM-005, REQ-TEAM-006, REQ-PLAN-003

### Capability: `pi-runner-install-review-plan`

#### Scenario: Plan final agrupado
**Given** el usuario seleccionó capabilities globales, Adaptive Memory y Developer Team
**When** abre Review & Install
**Then** ve un plan agrupado por instalaciones automáticas, pasos manuales, escritura de configuración, aplicación de team y validación
> Covers: REQ-PLAN-001, REQ-PLAN-005

#### Scenario: Plan no incluye acciones excluidas o no seleccionadas
**Given** Adaptive Memory = `None` y solo algunas capabilities globales están seleccionadas
**When** el usuario genera el plan final
**Then** el plan no incluye Engram, Supermemory, `@juicesharp/rpiv-todo`, `@juicesharp/rpiv-ask-user-question` ni acciones para capabilities no seleccionadas
> Covers: REQ-PLAN-002, REQ-GCAP-003, REQ-MEM-003

#### Scenario: Plan con acciones manuales o pendientes no se declara listo
**Given** el plan contiene una herramienta manual, una capability faltante o un helper visual con source desconocido
**When** el usuario revisa Review & Install
**Then** el plan separa esa condición de las acciones listas y no presenta el conjunto como completamente listo hasta que se resuelva o se confirme como paso manual
> Covers: REQ-PLAN-003, REQ-GCAP-004, REQ-UI-002

#### Scenario: Regeneración del plan después de cambios
**Given** el usuario está en Review & Install con Supermemory seleccionado
**When** vuelve a Adaptive Memory, cambia la selección a Engram y regresa a Review & Install
**Then** el plan se regenera para mostrar acciones de Engram y remover acciones de Supermemory
> Covers: REQ-PLAN-004, REQ-MEM-005

## Validation Rules

| Field / Input | Rule | Error Message | REQ-ID |
|---|---|---|---|
| Adaptive Memory | Debe ser exactamente una de `None`, `Engram`, `Supermemory`. | Seleccioná una única opción de Adaptive Memory: None, Engram o Supermemory. | REQ-MEM-001 |
| Adaptive Memory default | La selección inicial debe ser `None`. | Adaptive Memory debe iniciar en None. | REQ-MEM-002 |
| Engram action/installability | Engram/`engram-memory` solo puede aparecer si Adaptive Memory = `Engram`. | Engram solo está disponible cuando Adaptive Memory está en Engram. | REQ-MEM-004 |
| Provider switch | Cambiar provider debe remover acciones/configuración activa del provider anterior. | Solo puede haber un provider de Adaptive Memory activo. | REQ-MEM-005 |
| Supermemory secrets | Secretos/tokens no pueden guardarse en configuración no secreta de Deck. | El token de Supermemory debe configurarse fuera de la configuración no secreta de Deck. | REQ-MEM-006 |
| Runner capability/requisito | Solo RTK, context-mode y codebase-memory son configurables como runner capabilities; Mermaid es obligatorio por runner; `pi-mermaid` es la implementación técnica para Pi; pi-hud es opcional Pi-only. | Capability o requisito no reconocido para este dashboard. | REQ-GCAP-001 |
| Excluded packages | `@juicesharp/rpiv-todo` y `@juicesharp/rpiv-ask-user-question` no son capabilities seleccionables ni acciones derivadas del plan por capacidades globales. | Este paquete no forma parte de las capabilities del dashboard. | REQ-GCAP-003 |
| Unknown install source | Una capability sin source/detección canónica no puede marcarse como instalación automática lista. | No hay instalación automática confirmada; revisá el paso manual o pendiente. | REQ-GCAP-004, REQ-UI-002 |
| Team model configuration | Provider/model/thinking debe respetar compatibilidad y defaults existentes. | La combinación provider/model/thinking no es compatible según la configuración actual. | REQ-TEAM-004 |
| Team compatibility | Un team seleccionado con capability consumida faltante/manual/desconocida debe mostrar advertencia y reflejarla en el plan. | El team seleccionado consume capabilities que aún no están listas. | REQ-TEAM-006 |

## Error Contracts

| Condition | Error Code | Message | Status |
|---|---|---|---|
| Adaptive Memory inválida o múltiple | `INVALID_ADAPTIVE_MEMORY_SELECTION` | Seleccioná una única opción: None, Engram o Supermemory. | N/A (TUI validation) |
| Engram aparece sin provider Engram seleccionado | `ENGRAM_NOT_INSTALLABLE_FOR_PROVIDER` | Engram solo puede instalarse/configurarse cuando Adaptive Memory = Engram. | N/A (TUI validation) |
| Supermemory token/configuración secreta enviada a configuración no secreta | `SUPERMEMORY_SECRET_NOT_ALLOWED_IN_DECK_CONFIG` | El token de Supermemory no puede guardarse en configuración no secreta de Deck. | N/A (TUI validation) |
| Capability desconocida seleccionada | `UNKNOWN_RUNNER_CAPABILITY` | Esta capability no está soportada por el dashboard. | N/A (TUI validation) |
| Package excluido intentado como capability | `EXCLUDED_PACKAGE_NOT_CAPABILITY` | Este paquete no forma parte de las capabilities seleccionables. | N/A (TUI validation) |
| Tool externa faltante sin instalación automática | `MANUAL_TOOL_REQUIRED` | Esta capability requiere instalación o verificación manual. | N/A (TUI status) |
| pi-hud/Mermaid/implementación técnica sin source/detección confirmada | `CAPABILITY_SOURCE_UNKNOWN` | No hay source o detección canónica confirmada para esta capability; Mermaid es requerido por runner, `pi-mermaid` aplica como implementación Pi, y pi-hud es opcional Pi-only. | N/A (TUI status) |
| Team seleccionado consume capability no satisfecha | `TEAM_CAPABILITY_UNSATISFIED` | El team seleccionado consume capabilities que no están listas o requieren acción. | N/A (TUI status) |
| Plan contiene pendientes/desconocidos | `PLAN_HAS_UNRESOLVED_ACTIONS` | El plan contiene acciones pendientes, manuales o desconocidas; revisalas antes de instalar. | N/A (TUI status) |

## States and Transitions

### States

| State | Description | Entry Criteria |
|---|---|---|
| Dashboard Ready | Vista principal con resumen por secciones. | El usuario inicia configuración/instalación de Pi Runner. |
| Section Editing | El usuario edita una sección específica. | El usuario abre Runner Capabilities, Adaptive Memory, Runner UI/visual helpers o Teams. |
| Capability Ready | Capability seleccionada ya disponible o instalable automáticamente. | Detección/plan confirma disponibilidad o acción automática. |
| Capability Manual | Capability seleccionada requiere intervención manual. | No existe instalación automática disponible o es tool externa/manual. |
| Capability Unknown | Capability seleccionada no tiene source/detección/instalación canónica confirmada. | La capability existe en el dashboard pero no puede validarse como lista. |
| Adaptive Memory None | Sin provider de memoria adaptativa activo. | Selección inicial o cambio explícito a `None`. |
| Adaptive Memory Engram | Engram es el único provider activo. | El usuario selecciona `Engram`. |
| Adaptive Memory Supermemory | Supermemory es el único provider activo. | El usuario selecciona `Supermemory`. |
| Team Selected | Un team, como Developer Team, está seleccionado. | El usuario selecciona el team en Teams. |
| Review Plan Ready | Plan generado sin acciones desconocidas y con manuales claramente separados/aceptables. | El usuario abre Review & Install después de resolver o aceptar condiciones. |
| Review Plan Unresolved | Plan generado con faltantes, manuales no resueltos o unknowns. | El usuario abre Review & Install con acciones pendientes/desconocidas. |

### Transitions

| From | To | Trigger | Side Effects |
|---|---|---|---|
| Dashboard Ready | Section Editing | Abrir una sección | Muestra controles y detalle de esa sección sin borrar estado previo. |
| Section Editing | Dashboard Ready | Volver al dashboard | Actualiza resumen de sección y conserva selecciones. |
| Adaptive Memory None | Adaptive Memory Engram | Seleccionar `Engram` | Engram queda activo y aparecen acciones técnicas de Engram/`engram-memory`. |
| Adaptive Memory Engram | Adaptive Memory None | Seleccionar `None` | Se remueven acciones/configuración activa de Engram. |
| Adaptive Memory Engram | Adaptive Memory Supermemory | Seleccionar `Supermemory` | Se remueven acciones de Engram y aparecen requisitos de Supermemory. |
| Adaptive Memory Supermemory | Adaptive Memory Engram | Seleccionar `Engram` | Se remueven acciones de Supermemory y aparecen acciones de Engram. |
| Section Editing | Team Selected | Seleccionar Developer Team | Se habilita acceso a configuración de modelos por agente y compatibilidad/consumo de capabilities. |
| Team Selected | Section Editing | Deseleccionar Developer Team | El plan deja de incluir aplicación/configuración de Developer Team. |
| Dashboard Ready | Review Plan Ready | Abrir Review & Install sin unresolveds bloqueantes | Muestra plan agrupado listo/manual/config/team/validación. |
| Dashboard Ready | Review Plan Unresolved | Abrir Review & Install con manuales, faltantes o unknowns | Muestra advertencias y separa acciones no listas. |
| Review Plan Ready / Review Plan Unresolved | Section Editing | Volver a una sección | Permite modificar decisiones; el plan debe regenerarse al regresar a Review & Install. |

## Open Questions

- ¿Cuáles son los package sources y comandos de detección/instalación canónicos para la capacidad Mermaid por runner —`pi-mermaid` en Pi y la implementación correspondiente en OpenCode— y para pi-hud opcional Pi-only?
- ¿Qué ocurre con Context7 en la nueva taxonomía: queda fuera, advanced, o se mapea a otra capability futura?
- ¿La instalación global del Pi Runner debe distinguir explícitamente setup global de aplicación project-local del Developer Team?

## Compliance Matrix

| REQ-ID | Scenario(s) | Status |
|---|---|---|
| REQ-DASH-001 | Dashboard inicial por secciones | Defined |
| REQ-DASH-002 | Dashboard inicial por secciones | Defined |
| REQ-DASH-003 | Navegación conserva estado | Defined |
| REQ-DASH-004 | Decisión primaria por capacidad | Defined |
| REQ-GCAP-001 | Decisión primaria por capacidad; Capabilities globales confirmadas | Defined |
| REQ-GCAP-002 | Tool externa o faltante se muestra como manual; Capability lista no genera paso manual innecesario | Defined |
| REQ-GCAP-003 | Capabilities globales confirmadas; Plan no incluye acciones excluidas o no seleccionadas | Defined |
| REQ-GCAP-004 | Tool externa o faltante se muestra como manual; Plan con acciones manuales o pendientes no se declara listo | Defined |
| REQ-MEM-001 | Default None sin acciones de memoria; Engram habilita installability de Engram | Defined |
| REQ-MEM-002 | Default None sin acciones de memoria | Defined |
| REQ-MEM-003 | Default None sin acciones de memoria; Plan no incluye acciones excluidas o no seleccionadas | Defined |
| REQ-MEM-004 | Engram habilita installability de Engram; Engram desaparece al cambiar de provider | Defined |
| REQ-MEM-005 | Engram habilita installability de Engram; Engram desaparece al cambiar de provider; Regeneración del plan después de cambios | Defined |
| REQ-MEM-006 | Supermemory requiere configuración segura | Defined |
| REQ-MEM-007 | Memoria adaptativa sigue siendo auxiliar | Defined |
| REQ-UI-001 | Helpers visuales agrupados | Defined |
| REQ-UI-002 | pi-hud o Mermaid/implementación técnica desconocidos; Plan con acciones manuales o pendientes no se declara listo | Defined |
| REQ-TEAM-001 | Developer Team seleccionable desde Teams | Defined |
| REQ-TEAM-002 | Developer Team seleccionable desde Teams | Defined |
| REQ-TEAM-003 | Configuración de modelos por agente desde Developer Team | Defined |
| REQ-TEAM-004 | Configuración de modelos por agente desde Developer Team; Compatibilidad de thinking preservada | Defined |
| REQ-TEAM-005 | Team sin capability requerida o consumida | Defined |
| REQ-TEAM-006 | Team sin capability requerida o consumida | Defined |
| REQ-TEAM-007 | Compatibilidad de thinking preservada | Defined |
| REQ-PLAN-001 | Plan final agrupado | Defined |
| REQ-PLAN-002 | Capability lista no genera paso manual innecesario; Plan no incluye acciones excluidas o no seleccionadas | Defined |
| REQ-PLAN-003 | pi-hud o Mermaid/implementación técnica desconocidos; Team sin capability requerida o consumida; Plan con acciones manuales o pendientes no se declara listo | Defined |
| REQ-PLAN-004 | Regeneración del plan después de cambios | Defined |
| REQ-PLAN-005 | Plan final agrupado | Defined |
