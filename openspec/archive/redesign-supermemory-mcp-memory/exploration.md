# Exploration: Verificación post-instalación Supermemory MCP-only

**Date**: 2026-05-29
**Phase**: explore (post-apply verification)
**Status**: blocked — TUI requires repair

## Goal

Verificar el estado real de la instalación OpenCode tras Apply Tasks 1-10 del change `redesign-supermemory-mcp-memory`, identificar por qué la TUI aún pide `teamId`/`orgId`, y documentar gaps contra Spec/Design.

## Outcome

**Apply Tasks 1-10 funcionaron en backend/adapter/prompt-generation, PERO la TUI (formulario de setup) nunca fue incluida en el scope del cambio.** El resultado es una brecha arquitectónica: el backend ignora `teamId`/`orgId`, pero la TUI sigue pidiéndolos.

## Findings

### 1. OpenCode Config (`~/.config/opencode/opencode.json`)

| Aspecto | Estado | Detalle |
|---------|--------|---------|
| MCP Server URL | ✅ Correcto | `https://mcp.supermemory.ai/mcp` |
| Auth header | ✅ Correcto | `Authorization: Bearer {env:SUPERMEMORY_API_KEY}` |
| `x-sm-project` header | ❌ FALTANTE | No aparece. Debería incluir `x-sm-project: p:<project>` para scoping |
| Agents registrados | ✅ 14 agents | Todos apuntan a `~/.config/opencode/prompts/deck-developer/` |
| MCP server enabled | ✅ `true` | |

### 2. Prompts Instalados (14 archivos `.md`)

| Aspecto | Estado | Detalle |
|---------|--------|---------|
| Herramientas viejas (`supermemory_memory`, `supermemory_recall`) | ✅ AUSENTES | Cero coincidencias |
| Tools deprecados (`execute`, `search_docs`) | ✅ AUSENTES | Cero coincidencias |
| Herramientas Engram (`mem_save`, `mem_recall`) | ✅ AUSENTES | Sin contaminación cruzada |
| Nuevas tools (`memory`, `recall`, `whoAmI`) | ✅ Presentes | Provider Supermemory correcto |
| Container tags | ✅ `u:` / `p:` solo | Sin `t:`/`o:` en tabla de containers |
| Provider sections | ✅ Ambos | Supermemory y Engram como providers separados |
| Topic keys | ⚠️ GAP MENOR | Tabla "Suggested Topic Keys" aún tiene fila `Team` con `team/<topic>` en líneas 139, 223, 332 |

### 3. TUI Root Cause — GAP CRÍTICO

**La TUI fue completamente excluida del scope de Tasks 1-10.**

El `design.md` NO incluye `apps/cli/src/tui/` en su tabla "Component / Module Boundaries". El `tasks.md` NO incluye ningún archivo TUI. Resultado: el formulario Supermemory nunca se tocó.

Evidencia hardcodeada en TUI:

| Archivo | Línea | Problema |
|---------|-------|----------|
| `developer-team-screens.tsx` | 92-96 | `SupermemorySetupValues` type incluye `teamId: string` y `orgId: string` |
| `developer-team-screens.tsx` | 126 | Screen type incluye `"supermemory-team-id"` y `"supermemory-org-id"` |
| `developer-team-screens.tsx` | 132 | Field mapping mapea screens a `teamId`/`orgId` |
| `developer-team-screens.tsx` | 118-123 | `SupermemorySetupScreen` renderiza campos teamId/orgId como "(optional)" |
| `app.tsx` | 142-145 | Screen union incluye `"supermemory-team-id"` y `"supermemory-org-id"` |
| `app.tsx` | 375 | `useState<SupermemorySetupValues>` con `{ teamId: "", orgId: "" }` |
| `app.tsx` | 1544-1548 | Flujo: token → userId → teamId → orgId (4 screens obligatorias) |
| `app.tsx` | 214-223 | `buildSupermemoryDeckConfig()` pasa `teamId`/`orgId` al config |
| `app.tsx` | 236-242 | `createMemoryProviderForSelection()` pasa `teamId`/`orgId` al provider |
| `app.tsx` | 282-303 | `buildDashboardSupermemorySetupUpdate()` incluye `teamId`/`organizationId` |
| `app.tsx` | 2039-2040 | Labels de screen: `"Supermemory teamId"`, `"Supermemory orgId"` |
| `app.tsx` | 1908-1911 | Navegación backward: orgId → teamId → userId → token |

**Flujo actual**: token → userId → **teamId → orgId** → review → install

**Flujo deseado**: token → userId → review → install (2 screens, sin team/org)

### 4. Backend/Adapter — Verificado Correcto

| Componente | Estado | Detalle |
|------------|--------|---------|
| `runner-capability-registry.ts` | ✅ | Description dice "No team/org scopes"; `createProvider()` ignora teamId/orgId |
| `adapter-supermemory/index.ts` | ✅ | Solo userId requerido; teamId/orgId deprecated |
| `adapter-supermemory/index.ts:74` | ⚠️ | `teamId: "developer-team"` aún aparece como default en instruction surfaces |
| `opencode-mcp-config.ts` | ✅ | Soporta `x-sm-project` header; pero TUI no lo invoca |
| `opencode-launch-command.ts` | ✅ | Acepta provider `supermemory` |
| `developer-team-install.ts` | ✅ | Valida tools (`memory`, `recall`, `whoAmI`) |
| `prompt-generation.ts` | ✅ | Provider-specific ordering funciona |
| `instruction-bundles/adaptive-memory.ts` | ✅ | Container tags `u:`/`p:` correctos |
| `instruction-bundles/adaptive-memory.ts` | ⚠️ | Tabla topic keys aún tiene fila `Team` (lines 139, 223, 332) |

### 5. Por qué no se detectó en testing

Los tests cubren:
- Adapter unitario (Task 8)
- Launch + MCP config (Task 9)
- Prompt/instrucciones + regresión Engram (Task 10)

**Ningún test cubre la TUI** — la TUI no tiene tests de integración para el flujo Supermemory. Los tests de `action-runner.test.ts` usan fixtures con `teamId: "team-1"`, perpetuando el patrón viejo.

## Gaps contra Spec/Design

| # | Gap | Severidad | Área |
|---|-----|-----------|------|
| G1 | TUI pide `teamId`/`orgId` que el backend ignora | **CRÍTICO** | TUI |
| G2 | `x-sm-project` header no se escribe en opencode.json | **ALTO** | MCP config / TUI |
| G3 | `SupermemorySetupValues` type tiene campos `teamId`/`orgId` | **ALTO** | TUI |
| G4 | Flujo TUI tiene 4 screens (token, userId, teamId, orgId) en vez de 2 | **ALTO** | TUI |
| G5 | `buildSupermemoryDeckConfig()` pasa teamId/orgId al config | **ALTO** | TUI app.tsx |
| G6 | `adapter-supermemory/index.ts:74` tiene `teamId: "developer-team"` en surfaces | **MEDIO** | Adapter |
| G7 | Instruction bundle topic keys tiene fila `Team` (3 ocurrencias) | **BAJO** | Core |
| G8 | Tests `action-runner.test.ts` usan fixtures con teamId/orgId | **MEDIO** | Tests |

## Recommended Repair Tasks

| Task | Descripción | Esfuerzo | Archivos |
|------|-------------|----------|----------|
| R1 | Eliminar screens `supermemory-team-id` y `supermemory-org-id` de la TUI | Medio | `apps/cli/src/tui/screens/developer-team-screens.tsx`, `apps/cli/src/tui/app.tsx` |
| R2 | Reducir `SupermemorySetupValues` a `{ token, userId }` | Bajo | `apps/cli/src/tui/screens/developer-team-screens.tsx`, `apps/cli/src/tui/app.tsx` |
| R3 | Actualizar flujo TUI: token → userId → review (sin team/org screens) | Medio | `apps/cli/src/tui/app.tsx` (lines 1531-1560, 1908-1911) |
| R4 | Actualizar `buildSupermemoryDeckConfig()` para NO pasar teamId/orgId | Bajo | `apps/cli/src/tui/app.tsx` (lines 214-223) |
| R5 | Actualizar `createMemoryProviderForSelection()` para NO pasar teamId/orgId | Bajo | `apps/cli/src/tui/app.tsx` (lines 236-242) |
| R6 | Actualizar `buildDashboardSupermemorySetupUpdate()` para eliminar team/org | Bajo | `apps/cli/src/tui/app.tsx` (lines 282-303) |
| R7 | Agregar `x-sm-project` header en MCP config generation | Bajo | `apps/cli/src/tui/app.tsx` o `packages/adapter-opencode/src/opencode-mcp-config.ts` |
| R8 | Limpiar `teamId: "developer-team"` en adapter surfaces | Bajo | `packages/adapter-supermemory/src/index.ts:74` |
| R9 | Eliminar fila `Team` de topic keys en instruction bundle (3 ocurrencias) | Bajo | `packages/core/src/teams/developer/instruction-bundles/adaptive-memory.ts` |
| R10 | Actualizar fixtures de tests TUI para no usar teamId/orgId | Bajo | `apps/cli/src/tui/runner-dashboard/action-runner.test.ts` |

## Files to Modify (if repaired)

1. `apps/cli/src/tui/screens/developer-team-screens.tsx` — Tipo, screen component, flujo
2. `apps/cli/src/tui/app.tsx` — Estado, build functions, navegación, screens
3. `packages/adapter-supermemory/src/index.ts` — Limpiar teamId en surfaces
4. `packages/core/src/teams/developer/instruction-bundles/adaptive-memory.ts` — Topic keys
5. `apps/cli/src/tui/runner-dashboard/action-runner.test.ts` — Fixtures
6. `~/.config/opencode/opencode.json` — Agregar `x-sm-project` header (re-run install)

## Blockers

- **B1**: La TUI es un componente React/Ink con estado complejo. Cambios requieren cuidado con navegación backward/forward y estado de formulario.
- **B2**: `x-sm-project` requiere saber el project identifier al momento de instalación. Verificar de dónde viene este valor y si está disponible en el contexto TUI.
- **B3**: Tests de integración TUI inexistentes — cualquier cambio TUI es manualmente verificable solo.

## Open Questions

1. ¿De dónde debería derivarse el valor de `x-sm-project`? ¿Del git repo name? ¿De un campo en `.deck/config.json`?
2. ¿El `teamId: "developer-team"` en adapter surfaces (line 74) es un identifier de equipo de agents o un scoping de memoria? Parece ser de agents (no de Supermemory scoping), pero hay que confirmar.
3. ¿Los fixtures de `action-runner.test.ts` con teamId son tests del dashboard reducer o del flujo Supermemory? Si son del dashboard general, el teamId puede ser legítimo (no relacionado con Supermemory).

## Ready for Proposal

**Sí** — El gap está claramente identificado. El siguiente paso es crear un Proposal + Tasks para las reparaciones R1-R10, con scope limitado a TUI y limpieza residual.
