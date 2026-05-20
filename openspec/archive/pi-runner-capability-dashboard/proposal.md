# Propuesta: Dashboard por capacidades para Pi Runner

## Intent

Rediseñar la UX global de instalación/configuración del Pi Runner en Deck desde un wizard lineal orientado a paquetes hacia un dashboard orientado a capacidades. El usuario necesita explorar y confirmar la cobertura antes de tocar código, configurando un entorno completo en vez de instalar herramientas sueltas una por una.

## Goal

Entregar una experiencia TUI de Pi Runner que permita seleccionar capacidades globales, memoria adaptativa, helpers visuales, teams y un plan final de instalación/revisión con acciones claras antes de ejecutar cambios.

## Scope

### In Scope
- Dashboard global de Pi Runner con secciones separadas para:
  - Runner Capabilities globales.
  - Adaptive Memory global.
  - Runner UI / visual helpers.
  - Team installation/configuration.
  - Review Plan final.
- Runner Capabilities globales orientadas por capacidad: RTK, context-mode y codebase-memory como capacidades configurables; Mermaid como capacidad obligatoria para los runners, con implementación Pi vía `pi-mermaid`; `pi-hud` como helper opcional solo dentro de Pi.
- Adaptive Memory como selección única: `None`, `Engram`, `Supermemory`; ninguna memoria activa por default.
- Engram/`engram-memory` solo debe aparecer como opción instalable/acción técnica cuando el usuario seleccione Adaptive Memory = `Engram`.
- Sección propia de Teams, con Developer Team seleccionable desde Teams.
- Pantalla propia de Developer Team para configurar modelos por agente cuando Developer Team esté seleccionado.
- Preservar el comportamiento actual de configuración de modelos por agente, incluyendo provider/model/thinking y compatibilidad existente.
- Mostrar explícitamente qué capabilities globales hereda/consume cada team y su compatibilidad.
- Generar un Review Plan final agrupado por acciones listas: instalaciones automáticas, pasos manuales, escritura de configuración, aplicación de team y validación.
- Cobertura futura esperada en tests de navegación, estado y generación del plan de instalación.

### Out of Scope
- Implementar código de producto en esta fase de Proposal.
- Mantener el wizard lineal como modelo principal de UX una vez aprobado el dashboard, salvo como rollback/transición si Design lo recomienda.
- Tratar `@juicesharp/rpiv-todo` o `@juicesharp/rpiv-ask-user-question` como capabilities del dashboard.
- Activar memoria adaptativa por defecto.
- Cambiar la semántica actual de modelos por agente o de `thinking` salvo lo necesario para integrarla en el dashboard.
- Migrar datos de Engram/Supermemory o redefinir la autoridad OpenSpec/Spec Registry frente a memoria adaptativa.

## Affected Capabilities

> Esta sección es el contrato entre Proposal y las fases de Spec/Design.

### New Capabilities
- `pi-runner-capability-dashboard`: dashboard TUI que organiza la instalación/configuración por capacidades y secciones de decisión.
- `pi-runner-global-capabilities`: configuración global de RTK, context-mode y codebase-memory como capacidades, más Mermaid obligatorio para runners y mapeado a implementación concreta por runner, no como paquete individual.
- `pi-runner-adaptive-memory-selection`: selección única global entre None, Engram y Supermemory, con default None.
- `pi-runner-ui-visual-helpers`: agrupación de helpers visuales/runner UI, con `pi-hud` opcional y limitado a Pi; Mermaid se trata como capacidad obligatoria de documentación visual para runners, donde Pi usa `pi-mermaid` como implementación.
- `pi-runner-team-configuration`: sección de Teams con Developer Team seleccionable y compatibilidad/consumo explícito de capabilities globales.
- `pi-runner-install-review-plan`: plan final de instalación/review con acciones listas antes de ejecutar cambios.

### Modified Capabilities
- `pi-runner-installation-flow`: cambia de wizard lineal orientado a paquetes a dashboard orientado a capacidades.
- `developer-team-installation`: pasa a configurarse desde Teams y debe exponer qué hereda/consume de capabilities globales.
- `developer-team-model-configuration`: se preserva el comportamiento actual, pero se vuelve accesible como pantalla propia dentro del Developer Team seleccionado.
- `adaptive-memory-configuration`: se formaliza como single-choice global `None`/`Engram`/`Supermemory`, sin memoria por default.

### Unchanged Capabilities
- `developer-team-model-assignments`: provider/model/thinking por agente se mantiene como comportamiento existente.
- `supermemory-secret-handling`: el token de Supermemory no debe guardarse en `.deck/config.json`; se mantiene la separación de configuración no secreta y Pi MCP config.
- `openspec-registry-authority`: OpenSpec y Spec Registry siguen siendo la autoridad; adaptive memory es auxiliar.

## Approach

Adoptar el enfoque recomendado por la exploración: extraer primero un modelo puro de inventario de capacidades y plan de instalación del Pi Runner, y construir el dashboard encima reutilizando subflujos existentes de modelos y memoria. La UX debe preguntar por capacidad, mapear internamente capability → tool/action, y presentar estados `ready`/`missing`/`manual`/`pending` sin exponer paquetes como unidad principal de decisión.

## Alternatives and Tradeoffs

| Alternative | Why Considered | Why Not Chosen |
|---|---|---|
| Refactor incremental dentro de `apps/cli/src/tui/app.tsx` | Menor cambio inicial y reutiliza pantallas existentes. | Aumenta el acoplamiento ya detectado y dificulta tests de estado/plan por capacidades. |
| Extraer inventario/plan por capacidades antes de conectar TUI | Mejora testabilidad, separa capability de paquete y reduce regresiones. | Requiere más trabajo inicial; recomendado por balance de riesgo/cobertura. |
| Dashboard paralelo al wizard actual | Rollback simple y comparación directa. | Duplica lógica, puede confundir el menú y mantener dos UX de instalación. |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Regresión de navegación/back/cursor por la máquina de estados manual actual. | Medium | Diseñar estado/transiciones testeables y cubrir navegación antes de tocar ejecución de instalación. |
| Mezclar adaptive memory con tools de memoria/código como codebase-memory o Engram externo. | Medium | Mantener secciones separadas: Adaptive Memory single-choice vs Runner Capabilities globales. |
| Mermaid y `pi-hud` no tienen source/detección/instalación confirmados en la exploración; Mermaid es requisito obligatorio de runner y en Pi se implementa vía `pi-mermaid`. | High | Mermaid debe mostrarse como requisito obligatorio pendiente/bloqueante o manual hasta confirmar implementación por runner; para Pi, esa implementación es `pi-mermaid`; `pi-hud` puede quedar opcional y Pi-only. |
| Supermemory puede quedar configurado pero no inyectado durante instalación TUI inmediata si se conserva la brecha detectada. | Medium | Spec/Design deben definir el comportamiento esperado y alinear configuración con instalación/lanzamiento. |
| Tools externas como RTK/codebase-memory pueden parecer fallos si no se presentan como acciones manuales. | Medium | Review Plan debe separar acciones automáticas de manuales y mostrar diagnósticos claros. |

## Rollback Plan

Si el dashboard introduce regresiones, revertir la entrada/flujo de instalación del Pi Runner al wizard lineal actual y conservar la ruta existente de `Configure models`. No se requieren migraciones de datos para volver atrás; las configuraciones ya escritas en Deck/Pi MCP deben seguir siendo legibles por los flujos actuales. Las capacidades nuevas sin source confirmado pueden deshabilitarse u ocultarse hasta completar detección/plan.

## Dependencies

- Confirmación de paquetes/comandos canónicos y detección para Mermaid obligatorio por runner; para Pi, confirmar `pi-mermaid`; para OpenCode, confirmar la implementación correspondiente; `pi-hud` queda opcional Pi-only.
- Estado actual de `packages/adapter-pi/src/installation-plan.ts` y `packages/adapter-pi/src/required-tools.ts` para mapear capabilities a tools/actions.
- Subflujo existente de modelos por agente en `packages/adapter-pi/src/model-config.ts` y Developer Team install.
- Configuración existente de Engram/Supermemory y manejo de secretos de Supermemory.
- Cobertura de tests posterior para navegación, estado e instalación/review plan.

## Open Questions

- ¿Cuáles son los package sources y comandos de detección/instalación canónicos para la capacidad Mermaid por runner —`pi-mermaid` en Pi y la implementación correspondiente en OpenCode— y para `pi-hud` opcional Pi-only?
- ¿Qué ocurre con Context7 en la nueva taxonomía: queda fuera, advanced, o se mapea a otra capability futura?
- ¿La instalación global del Pi Runner debe distinguir explícitamente setup global de aplicación project-local del Developer Team?

## Acceptance Direction

- [ ] El flujo de instalación/configuración del Pi Runner presenta un dashboard por secciones, no un wizard lineal de paquetes.
- [ ] Las capacidades RTK, context-mode y codebase-memory se configuran por capacidad; Mermaid aparece como requisito obligatorio del runner con implementación específica por runner (`pi-mermaid` en Pi); `pi-hud` aparece como opcional solo dentro de Pi.
- [ ] Adaptive Memory permite exactamente una opción activa entre None, Engram y Supermemory, con None por default.
- [ ] Developer Team se selecciona desde Teams y permite abrir configuración de modelos por agente sin cambiar el comportamiento actual.
- [ ] Cada team muestra compatibilidad/consumo de capabilities globales.
- [ ] El Review Plan final muestra acciones listas, separando instalación automática, pasos manuales, config, aplicación de team y validación.
- [ ] Tests futuros cubren navegación del dashboard, estado de selección y generación del plan de instalación.

## Contradicciones o cambios frente a la exploración

- No se detectan contradicciones bloqueantes.
- La exploración dejó abierta la duda sobre Supermemory; el usuario la resolvió confirmando que Adaptive Memory debe ser single-choice con `None`, `Engram` y `Supermemory`.
- La exploración dejó abierta la duda sobre `engram-memory`; el usuario la resolvió confirmando que Engram solo saldrá como opción instalable si se selecciona Adaptive Memory = `Engram`.
- La exclusión de `@juicesharp/rpiv-todo` y `@juicesharp/rpiv-ask-user-question` queda agregada como decisión explícita del usuario.

## Next Steps

Ready for Spec (`deck-developer-spec`) and Design (`deck-developer-design`) in parallel.
