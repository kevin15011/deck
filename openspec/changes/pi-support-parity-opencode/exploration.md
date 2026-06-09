# Exploración: Soporte de Paridad Pi ↔ OpenCode

## Objetivo

Evaluar el estado actual del soporte de Pi en el monorepo Deck: paquetes/capacidades soportadas, modelo de arquitectura de agentes/prompts, persistencia de system prompt del orchestrator, y gaps vs OpenCode. Producir insumos para que Orchestrator y usuario definan alcance antes de Proposal.

## Estado Actual

### Arquitectura de adaptadores

Ambos adaptadores (`adapter-opencode`, `adapter-pi`) comparten la capa `@deck/core` (content-registry, instruction-bundles, adaptive-memory, orchestrator-invariants). Las diferencias están en la capa de instalación/configuración específica de cada runner.

**OpenCode** persiste agentes en `~/.config/opencode/opencode.json` con `mode: "primary"` para el orchestrator y referencias `{file:/path}` a archivos de prompt. Las skills se escriben en `~/.config/opencode/skills/<skillId>/SKILL.md`.

**Pi** persiste agentes en `.pi/agents/<agent-id>.md` con frontmatter YAML (model, tools, thinking, systemPromptMode). El orchestrator NO es un agente con `mode: primary`; en su lugar, el system prompt se materializa en `.deck/pi/profiles/<team>/system-prompt.md` y se pasa vía `pi --system-prompt <path>`.

### Catálogo de capacidades (user-facing)

| Capacidad | OpenCode | Pi | Binario compartido |
|---|---|---|---|
| `context-mode` | npm-package-plus-mcp + MCP config en opencode.json | pi-package `npm:context-mode` vía `pi install` | ✅ Mismo binario npm |
| `codebase-memory` | shell-script (install.sh) + MCP config | external (manual, mismo repo) | ✅ Mismo binario |
| `rtk` | shell-script-plus-mcp con `rtk init -g --opencode` | external (manual) | ✅ Mismo binario, post-install distinto |
| `serena` | python-tool (uv/pipx) + MCP config | ❌ No soportado | N/A |
| `context7` | mcp-server (`@upstash/context7-mcp`) | pi-package (`@dreki-gg/pi-context7`) | ❌ Wrapper Pi distinto |
| `opencode-mermaid` | plugin interno (`opencode-mermaid-renderer`) | pi-mermaid (npm package, interno) | ❌ Diferente implementación |
| `supermemory` | MCP en opencode.json con `{env:SUPERMEMORY_API_KEY}` | MCP en `~/.pi/agent/mcp.json` con header directo | ✅ Mismo backend, config distinta |

### Paquetes internos/obligatorios

- **OpenCode**: `opencode-mermaid-renderer` (plugin interno, silencioso)
- **Pi**: `pi-mermaid` (npm package, interno), `sub-agents` (`npm:pi-subagents`), `mcp-packages` (`npm:pi-mcp-adapter`)

### Instruction bundles (core, compartidos)

El core define 5 bundles canónicos: `codebase-memory`, `context-mode`, `rtk`, `adaptive-memory`, `serena`. Cada uno produce fragments para superficies `agent` y `skill` (y `session` para adaptive-memory). Los adaptadores leen la config de `packageInstructions` por runner (`opencode`/`pi`) y componen los bundles habilitados.

**Gap**: Serena no tiene entrada en el catálogo de Pi. Los bundles de core son runner-neutral, pero el catálogo de Pi (`capability-catalog.ts`) solo tiene 4 entradas user-facing: `context-mode`, `codebase-memory`, `rtk`, `pi-hud`.

### Persistencia de prompts del orchestrator

**OpenCode**: 
- `buildAgentEntry()` asigna `mode: "primary"` al orchestrator con tools de delegación.
- Prompt files en `~/.config/opencode/prompts/deck-developer/` referenciados por `{file:/path}`.
- `prompt-generation.ts` genera prompts por agente con inyección de capability instructions + adaptive memory.

**Pi**:
- NO tiene concepto de `mode: primary` ni agente principal.
- `pi-team-profile.ts`: `buildTeamSystemPrompt()` compone instrucciones de sesión desde `getTeamSessionInstructions()` + adaptive memory, escribe a `.deck/pi/profiles/developer-team/system-prompt.md`.
- `pi-team-launch.ts`: pasa `--system-prompt` al CLI de Pi con la ruta del archivo.
- El prompt del orchestrator también se persiste como agente `.md` (frontmatter + body) igual que los demás agentes, con `systemPromptMode: replace`.

**Riesgo arquitectónico**: Pi no tiene un "main agent" canónico; el system prompt del orchestrator existe en DOS lugares: como archivo de perfil de equipo (vía `--system-prompt`) y como archivo de agente (`.pi/agents/deck-developer-orchestrator.md`). No hay una separación clara entre "instrucciones de sesión" y "definición de agente principal".

### Modelo de instalación de paquetes

**OpenCode** (`install-tools.ts`): Soporta `npm-package`, `npm-package-plus-mcp`, `shell-script`, `shell-script-plus-mcp`, `python-tool`, `opencode-plugin`, `mcp-server`. Usa `commandExistsInPath()` para detectar binarios ya instalados y evitar reinstalación.

**Pi** (`install-tools.ts`): Solo dos modos: `pi-package` (usa `pi install <source>`) y `external` (manual). No tiene detección de binarios compartidos ya instalados. Delega la detección a `pi install` (el CLI de Pi maneja idempotencia internamente).

**Riesgo de reinstalación**: Si un binario ya fue instalado por OpenCode (ej. `rtk`, `codebase-memory-mcp`), Pi lo cataloga como `external` y no intenta instalarlo, lo cual es correcto. Pero si Pi tiene su propia ruta de instalación (`pi-package`), podría reinstalar un paquete npm como `context-mode` sin verificar si ya existe globalmente.

### Memoria adaptativa

Ambos adaptadores soportan `engram` y `supermemory` como providers. La validación MCP de Supermemory difiere:
- OpenCode valida contra `~/.config/opencode/opencode.json` con `{env:SUPERMEMORY_API_KEY}`.
- Pi valida contra `~/.pi/agent/mcp.json` con header `x-supermemory-api-key` directo (token en el archivo, redactado en logs).

Pi además requiere `authenticatedRuntimeValidated === true` para inyectar herramientas de Supermemory en agentes (función `hasAuthenticatedSupermemoryToolBindings` en `developer-team-install.ts`). OpenCode no tiene esta restricción.

## Archivos Relevantes

- `packages/adapter-opencode/src/developer-team-install.ts` — Plan/apply/verify del developer team para OpenCode (957 líneas). Incluye `buildAgentEntry` con `mode: "primary"`, config merge, generación de prompts/commands.
- `packages/adapter-pi/src/developer-team-install.ts` — Plan/apply/verify del developer team para Pi (811 líneas). Sin config merge, escribe agentes `.md` con frontmatter.
- `packages/adapter-opencode/src/opencode-mcp-config.ts` — Config MCP en opencode.json (generic + Supermemory).
- `packages/adapter-pi/src/pi-mcp-config.ts` — Config MCP en `~/.pi/agent/mcp.json` (solo Supermemory, con `redact()`).
- `packages/adapter-pi/src/pi-team-profile.ts` — Materializa system prompt de equipo en `.deck/pi/profiles/`.
- `packages/adapter-pi/src/pi-team-launch.ts` — Plan de lanzamiento de Pi con `--system-prompt`.
- `packages/adapter-opencode/src/capability-catalog.ts` — 6 capacidades (rtk, context-mode, codebase-memory, context7, serena, opencode-mermaid).
- `packages/adapter-pi/src/capability-catalog.ts` — 4 capacidades user-facing (rtk, context-mode, codebase-memory, pi-hud) + 1 interna (runner-mermaid).
- `packages/adapter-opencode/src/installation-plan.ts` — 5 herramientas instalables (rtk, context-mode, codebase-memory, context7, serena).
- `packages/adapter-pi/src/installation-plan.ts` — 7 herramientas (sub-agents, mcp-packages, context-mode, codebase-memory, rtk, context7, engram-memory).
- `packages/core/src/teams/developer/instruction-bundles/index.ts` — Core de bundles: 5 packages (codebase-memory, context-mode, rtk, adaptive-memory, serena). `buildCapabilityInstructionBundle()` y `composeCapabilityInstructions()`.
- `packages/adapter-pi/src/runner-capabilities.ts` — Factory de RunnerCapabilities para Pi.
- `packages/adapter-opencode/src/runner-capabilities.ts` — Factory de RunnerCapabilities para OpenCode.
- `packages/adapter-opencode/src/config-merge.ts` — Merge atómico de opencode.json (backup + write + validate).
- `openspec/changes/model-reasoning-effort-capability/state.yaml` — Cambio reciente que explícitamente difirió workaround de Pi.

## Restricciones

- **Regla del usuario**: si un binario/paquete ya existe y es compartido entre OpenCode y Pi, NO reinstalarlo; reutilizar/verificar como OpenCode.
- Pi NO tiene main agent; el orchestrator se persiste vía system prompt (`--system-prompt`).
- `supportsThinkingForModel` en Pi deshabilita thinking para OpenCode-go y kimi-k2.6 por bug histórico (ver `model-reasoning-effort-capability`).
- Los bundles de instruction del core son runner-neutral; el catálogo de capacidades del adaptador determina qué se expone al usuario.
- `bundle-parity.test.ts` tiene hashes baseline para verificar consistencia de bundles; cualquier cambio requiere actualizar hashes con justificación.

## Riesgos

1. **Reinstalación innecesaria**: Si Pi instala `context-mode` vía `pi install npm:context-mode` y ya existe globalmente (instalado por OpenCode), puede haber conflicto de versiones o reinstalación redundante. La detección `pi-package` no verifica PATH global.
2. **Prompt del orchestrator fragmentado**: El system prompt existe en archivo de perfil Y como agente `.md`, sin garantía de consistencia entre ambos.
3. **Falta de Serena**: Serena está en los bundles del core y en el catálogo de OpenCode, pero no en Pi. Si se habilita `serena` en `packageInstructions.pi`, el bundle se compondría pero no habría instalación/configuración MCP correspondiente.
4. **Context7 divergente**: Pi usa `@dreki-gg/pi-context7` (wrapper específico) vs OpenCode que usa `@upstash/context7-mcp` directo. No hay garantía de paridad de funcionalidad.
5. **MCP config formatos distintos**: OpenCode usa `{env:SUPERMEMORY_API_KEY}` (indirección), Pi usa token directo en `mcp.json`. Si un usuario migra entre runners, la configuración no es portable.
6. **Validación authenticatedRuntimeValidated**: Pi requiere validación adicional que OpenCode no tiene. Si la validación falla, Pi omite herramientas de memoria sin degradación elegante visible.

## Opciones Arquitectónicas

### Opción A: Main agent en Pi — Agregar `mode: primary` al orchestrator

Crear un mecanismo en Pi equivalente al `mode: "primary"` de OpenCode, donde el orchestrator tenga tools de delegación y sea el entry point. El system prompt actual se movería al agente principal.

- **Pros**: Paridad arquitectónica con OpenCode. Separación clara entre system prompt de sesión y prompt de agente. Menos fragmentación.
- **Contras**: Requiere cambios en el runtime de Pi (no controlado por Deck). Puede no ser factible si Pi no soporta agentes primarios. Effort alto.
- **Esfuerzo**: Alto (cambios en Pi runtime + adapter)

### Opción B: Perfeccionar el modelo actual — System prompt como fuente canónica

Mantener el modelo actual de Pi (system prompt vía `--system-prompt`) pero eliminar la duplicación: el archivo de agente del orchestrator (`.md`) NO debe contener el system prompt completo, solo metadatos (model, tools, thinking) y una referencia al archivo de perfil.

- **Pros**: No requiere cambios en Pi runtime. Consistente con el modelo actual de Pi. Bajo riesgo.
- **Contras**: Asimetría permanente con OpenCode. El orchestrator "agente" es un cascarón sin contenido real.
- **Esfuerzo**: Bajo (cambios en adapter Pi solamente)

### Opción C: Unificar en instruction bundle de sesión

Tratar el prompt del orchestrator como un `CapabilityInstructionFragment` con superficie `session`, inyectado por el core en ambos runners. Pi lo recibe vía system prompt, OpenCode lo recibe vía prompt de agente principal.

- **Pros**: Máxima reutilización de core. Un solo source of truth para el prompt del orchestrator.
- **Contras**: Requiere refactor del content-registry para que `getTeamSessionInstructions()` sea parte del sistema de bundles. Cambios en ambos adaptadores.
- **Esfuerzo**: Medio

### Opción D: Sistema híbrido — Perfil de equipo + agente delegador

El system prompt de sesión (vía perfil) contiene filosofía, reglas SDD, contexto de proyecto. El agente orchestrator contiene solo su definición operativa: tools, modelo, delegación. Ambos son complementarios, no redundantes.

- **Pros**: Separación clara de concerns. Modelo consistente con cómo Pi ya funciona (hereda project context). Fácil de implementar.
- **Contras**: Sigue habiendo dos fuentes (perfil + agente), pero con responsabilidades distintas.
- **Esfuerzo**: Bajo-Medio

## Recomendación

**Fase 1 (bajo riesgo, alto valor)**: Opción B para la arquitectura de prompts — limpiar la duplicación manteniendo el modelo actual de Pi. Paralelamente, agregar las capacidades faltantes al catálogo de Pi (Serena, alinear Context7) y hardening de detección de binarios compartidos.

**Fase 2 (decisión de arquitectura)**: Evaluar Opción A o D si el usuario quiere paridad completa de arquitectura de agentes. Esto requiere discusión con el equipo de Pi runtime.

## Preguntas Abiertas

- ¿Pi runtime soportará `mode: primary` en el futuro cercano? Esto determina si la Opción A es viable.
- ¿El wrapper `@dreki-gg/pi-context7` es funcionalmente equivalente a `@upstash/context7-mcp`? Si no, ¿migrar al MCP estándar?
- ¿Serena debe ser soportada en Pi? Si sí, ¿el MCP de Serena (`serena start-mcp-server`) funciona con Pi?
- ¿La regla de "no reinstalar binarios compartidos" aplica también a paquetes npm globales como `context-mode`?
- ¿Pi debe tener su propio `opencode.json`-equivalente o seguir usando `.pi/agent/` + `mcp.json`?

## Listo para Proposal

No — el Orchestrator debe discutir con el usuario:
1. Confirmar scope: ¿solo capacidades/paquetes o también arquitectura de agentes?
2. Decidir approach para prompt del orchestrator (Opción B recomendada para empezar).
3. Priorizar capacidades faltantes: ¿Serena y Context7 son prioridad?
4. Definir criterios de "no reinstalación" para binarios compartidos.
