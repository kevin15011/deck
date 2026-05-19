# Prompt temporal: UX de instalación del Pi Runner

Usá este prompt en una sesión futura para diseñar e implementar la UX de instalación global del Pi Runner. Este archivo es temporal y se puede borrar después de usarlo.

```txt
Quiero diseñar e implementar la nueva UX de instalación global del Pi Runner en Deck.

Importante:
- Respondé en español.
- Primero explorá y diseñá; no implementes de una.
- Antes de tocar código, proponé una arquitectura concreta de pantallas, estado y plan de instalación.

Contexto:
- No estamos instalando herramientas para un proyecto específico; es una instalación/configuración global del runner Pi.
- La UX actual se siente demasiado secuencial, como un wizard largo con demasiados pasos.
- Queremos una experiencia tipo dashboard por secciones, donde el usuario vea capacidades agrupadas y pueda entrar solo a configurar lo necesario.
- Deck debe mantener separación clara entre:
  1. Runner Capabilities globales
  2. Adaptive Memory global
  3. Runner UI / visual helpers
  4. Team installation/configuration
  5. Review Plan final

Decisiones ya tomadas:
- Incluir como capacidades globales:
  - RTK
  - context-mode
  - codebase-memory
  - pi-hud
  - pi-mermaid
- Excluir:
  - @juicesharp/rpiv-todo
  - @juicesharp/rpiv-ask-user-question
- Adaptive Memory debe ser una sección single-choice:
  - None
  - Engram
- Engram NO debe activarse automáticamente por default; debe quedar configurable.
- Los teams deben tener su propia sección.
- Developer Team debe poder seleccionarse desde Teams.
- Si un team está seleccionado, puede abrir una pantalla propia para configurar modelos por agente, aunque eso agregue pasos, porque son pasos contextuales y necesarios.
- Los teams pueden heredar capabilities globales, pero deben mostrar compatibilidad/consumo explícito.

UX objetivo aproximada:

Configure Pi Runner

Runner Capabilities
  Context Efficiency
    ✓ RTK
    ✓ context-mode
    ✓ codebase-memory

Adaptive Memory
  ○ None
  ○ Engram

Runner UI
  ✓ pi-hud

Visual Documentation
  ✓ pi-mermaid

Teams
  ✓ Developer Team
  ○ Reviewer Team
  ○ Product Team

Review & Install
  12 actions ready

Pantalla de detalle del Developer Team:

Developer Team

Install: enabled

Model Configuration
  Orchestrator: gpt-5.5 / high
  Explorer: ...
  Proposal: ...
  Spec: ...
  Design: ...
  Task: ...
  Apply General: ...
  Apply Backend: ...
  Apply Frontend: ...
  Verify: ...
  Review: ...
  Archive: ...

Actions
  Configure models
  Use recommended model profile
  Reset to defaults

Objetivos:
1. Auditar el código actual de TUI/install.
2. Proponer una arquitectura concreta de pantallas y estado para este flujo tipo dashboard.
3. Preservar el comportamiento actual de configuración de modelos.
4. Evitar un wizard lineal de yes/no.
5. Separar herramientas globales del runner de instalación/configuración específica de teams.
6. Producir tareas de implementación antes de escribir código.
7. Agregar tests para navegación, estado y generación del plan de instalación.

Principio de diseño importante:
Preguntar por capacidad, no por paquete individual. El usuario debe sentir que está configurando un entorno, no instalando herramientas sueltas una por una.

Áreas sugeridas para inspeccionar:
- apps/cli/src/tui/app.tsx
- apps/cli/src/tui/screens/*
- apps/cli/src/menu-options.ts
- packages/adapter-pi/src/installation-plan.ts
- packages/adapter-pi/src/required-tools.ts
- packages/adapter-pi/src/developer-team-install.ts
- packages/adapter-pi/src/model-config.ts
- docs/developer-team.md
- docs/pi-agent-installation.md

Empezá con exploración/diseño, no con implementación.
```
