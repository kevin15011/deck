# Verify Report: pi-support-parity-opencode

## Summary

**Overall Result**: PASS WITH WARNINGS  
**Registry Mode**: REGISTRY-DEFERRED  
**Tasks Complete**: 26 / 26  
**Tests**: focused required suites PASS (344 pass / 0 fail); adapter-pi full PASS (392 pass / 0 fail)  
**Build**: PASS  
**Typecheck**: WARNING — no `typecheck` script; `bunx tsc --noEmit` fails on pre-existing/unrelated project errors.

## Task Completion

| Task | Status | Owner |
|---|---:|---|
| Tasks 1.1–8.5 + repairs through #25 | ✅ Complete | General/Backend/Frontend Apply |

## Test Results

| Test Suite | Pass | Fail | Skip | Result |
|---|---:|---:|---:|---|
| developer-team-install | 68 | 0 | 0 | ✅ PASS |
| pi-team-launch + pi-team-profile | 33 | 0 | 0 | ✅ PASS |
| pi-mcp-config + settings-merge | 35 | 0 | 0 | ✅ PASS |
| pi capability-plan + TUI action-runner | 45 | 0 | 0 | ✅ PASS |
| model-config + runner-adapter focused | 75 | 0 | 0 | ✅ PASS |
| combined final focused set (17 files) | 344 | 0 | 0 | ✅ PASS |
| adapter-pi full suite (21 files) | 392 | 0 | 0 | ✅ PASS |

## Build / Typecheck

| Check | Result | Details |
|---|---|---|
| Build | ✅ PASS | `bun run build` completed all target binaries. |
| Typecheck script | ⚠️ WARN | `bun run typecheck` missing. |
| TypeScript noEmit | ⚠️ WARN | `bunx tsc --noEmit` exits 1 on existing project diagnostics, including apps/cli and adapter-supermemory test diagnostics; not isolated to Repair #25/focused Pi contract. |

## Expected Pi Install State Contract

| Contract | Verification | Result |
|---|---|---|
| Profile path | `buildTeamProfileDir(projectRoot, teamId)` => `.deck/pi/profiles/{team}`; install materializes `system-prompt.md`; launch passes `--system-prompt <profile>/system-prompt.md`. | ✅ PASS |
| Skills path | install plan writes generated, standalone, and SDD skills to `.pi/skills/{skillId}/SKILL.md`. | ✅ PASS |
| Orchestrator prompt | agent file is a stub/reference and does not duplicate full system prompt body; source of truth is profile prompt. | ✅ PASS |
| Agents/model persistence | Pi runtime model read uses explicit agentsDir support; focused runner/model tests pass. | ✅ PASS |
| MCP config | generic/gated writers cover Supermemory, context-mode, codebase-memory (server `codebase-memory`, command `codebase-memory-mcp`), Serena, Context7 `@upstash/context7-mcp`; focused MCP/action-runner tests pass. | ✅ PASS |
| Settings/package stale replacement | `settings-merge` replaces `npm:@dreki-gg/pi-context7` with `npm:@upstash/context7-mcp`. | ✅ PASS |

## Compliance Matrix — Requirements

| REQ-ID | Method | Result | Notes |
|---|---|---|---|
| REQ-RCPR-001 | Inspección OpenSpec/código + core parity/registry tests | ✅ PASS | Deck MUST exponer un registro canónico de capacidades por runner que permita consultar capacidades Deck, superficie, obligatoriedad, modo de provisión y estado por runner. |
| REQ-RCPR-002 | Inspección OpenSpec/código + core parity/registry tests | ✅ PASS | Cada mapping por runner MUST distinguir, como mínimo, estados equivalentes a `supported`, `shared`, `runner-specific`, `external/manual`, `gap` y `blocked`. |
| REQ-RCPR-003 | Inspección OpenSpec/código + core parity/registry tests | ✅ PASS | El registro MUST modelar agentes, skills, MCPs, paquetes, binarios compartidos, paquetes silenciosos runner-specific, persistencia de prompt/perfil, bindings de memoria/herramientas, y capacidades Deck canónicas explícitas para `codebase-memory` y `RTK`. |
| REQ-RCPR-004 | Inspección OpenSpec/código + core parity/registry tests | ✅ PASS | La información del registro SHOULD ser consumible por humanos y agentes IA sin requerir lectura de código fuente. |
| REQ-MAP-001 | Inspección OpenSpec/código + core parity/registry tests | ✅ PASS | OpenCode, Pi y futuros runners MUST tener mappings explícitos para cada capacidad canónica aplicable. |
| REQ-MAP-002 | Inspección OpenSpec/código + core parity/registry tests | ✅ PASS | Los mappings MUST declarar diferencias legítimas por runner, incluyendo Mermaid OpenCode y Mermaid Pi, como capacidades silenciosas runner-specific y no como gaps de paridad. |
| REQ-MAP-003 | Inspección OpenSpec/código + core parity/registry tests | ✅ PASS | Los mappings MUST cubrir persistencia de prompts/perfiles y bindings de memoria/herramientas por runner. |
| REQ-MAP-004 | Inspección OpenSpec/código + core parity/registry tests | ✅ PASS | Los mappings de OpenCode, Pi y futuros runners MUST declarar explícitamente `codebase-memory`, `codebase-memory-mcp` y `RTK`; si falta o diverge cualquiera de esas mappings, el reporte MUST identificarlo por nombre de capacidad y runner. |
| REQ-PI-001 | Tests adapter-pi/core + inspección MCP/install plans | ✅ PASS | Pi MUST ser reportado como equivalente a OpenCode solo cuando todas las capacidades obligatorias aplicables estén `supported`, `shared`, `runner-specific` válido o `external/manual` con verificación explícita. |
| REQ-PI-002 | Tests adapter-pi/core + inspección MCP/install plans | ✅ PASS | Pi MUST incluir soporte obligatorio para Serena, incluyendo disponibilidad verificable como herramienta/MCP equivalente donde aplique. |
| REQ-PI-003 | Tests adapter-pi/core + inspección MCP/install plans | ✅ PASS | Pi MUST configurar `context-mode` como MCP local respaldado por el binario compartido usable, además de cualquier instalación de paquete necesaria. |
| REQ-PI-004 | Tests adapter-pi/core + inspección MCP/install plans | ✅ PASS | Pi MUST preservar capacidades Pi existentes válidas mientras cierra gaps de paridad obligatorios. |
| REQ-PI-005 | Tests adapter-pi/core + inspección MCP/install plans | ✅ PASS | Pi MUST alcanzar paridad observable con OpenCode para `codebase-memory` y `codebase-memory-mcp` cuando esa capacidad sea aplicable al runner. |
| REQ-PI-006 | Tests adapter-pi/core + inspección MCP/install plans | ✅ PASS | Pi MUST alcanzar paridad observable con OpenCode para `RTK`, incluyendo disponibilidad del capability y estado de reuso/configuración reportable. |
| REQ-CBM-001 | Tests adapter-pi/core + inspección MCP/install plans | ✅ PASS | Deck MUST tratar `codebase-memory` como capacidad canónica first-class, separada de la categoría genérica de binarios compartidos. |
| REQ-CBM-002 | Tests adapter-pi/core + inspección MCP/install plans | ✅ PASS | Deck MUST representar `codebase-memory-mcp` como MCP local cuando aplique al runner, respaldado por binario compartido reusable si está disponible y usable; el binario por sí solo MUST NOT satisfacer la capacidad si falta la exposición MCP requerida. |
| REQ-CBM-003 | Tests adapter-pi/core + inspección MCP/install plans | ✅ PASS | Cuando la arquitectura existente implique indexación local de proyecto para `codebase-memory`, Deck MUST hacer observable el estado mínimo de ciclo de vida de indexación aplicable al runner: no configurado/no indexado, indexado/verificado o blocked/gap. |
| REQ-RTK-001 | Tests adapter-pi/core + inspección MCP/install plans | ✅ PASS | Deck MUST tratar `RTK` como capacidad canónica first-class para comportamiento CLI token-optimized, separada de la categoría genérica de binarios compartidos. |
| REQ-RTK-002 | Tests adapter-pi/core + inspección MCP/install plans | ✅ PASS | Deck MUST reutilizar el binario/paquete compartido de `RTK` cuando esté disponible y usable, y cada runner adapter MUST reportar cómo queda disponible la capacidad para ese runner. |
| REQ-RTK-003 | Tests adapter-pi/core + inspección MCP/install plans | ✅ PASS | Pi MUST quedar alineado con OpenCode para `RTK`: si OpenCode dispone de RTK mediante hook, paquete o binario compartido equivalente, Pi MUST declarar soporte equivalente, gap o blocker explícito. |
| REQ-MCP-001 | Tests adapter-pi/core + inspección MCP/install plans | ✅ PASS | Context7 SHOULD converger a `@upstash/context7-mcp` en Pi y OpenCode, salvo blocker técnico confirmado por Design y documentado como `blocked` con fallback visible. |
| REQ-MCP-002 | Tests adapter-pi/core + inspección MCP/install plans | ✅ PASS | Pi MUST inyectar herramientas Supermemory con comportamiento alineado a OpenCode y MUST NOT requerir un gate adicional Pi-only `authenticatedRuntimeValidated` para habilitarlas. |
| REQ-MCP-003 | Tests adapter-pi/core + inspección MCP/install plans | ✅ PASS | Cuando Supermemory o MCPs estén mal configurados, Pi SHOULD reportar estado de instalación/verificación explícito en lugar de deshabilitar herramientas silenciosamente. |
| REQ-SHARED-001 | Tests adapter-pi/core + inspección MCP/install plans | ✅ PASS | Deck MUST reutilizar binarios compartidos ya existentes y usables para `context-mode`, `RTK`, `codebase-memory-mcp` y herramientas equivalentes antes de reinstalar por runner, sin ocultar sus capabilities canónicas bajo la categoría genérica de reuso. |
| REQ-SHARED-002 | Tests adapter-pi/core + inspección MCP/install plans | ✅ PASS | Un binario compartido MUST considerarse reusable solo si pasa checks de usabilidad definidos y observables; si falla, el resultado MUST indicar no reusable o blocked. |
| REQ-SHARED-003 | Tests adapter-pi/core + inspección MCP/install plans | ✅ PASS | El reporte de instalación/paridad SHOULD indicar si una capacidad fue reutilizada, instalada, manual/external, blocked o gap. |
| REQ-PROMPT-001 | developer-team-install + pi-team-launch/profile tests + inspección de paths | ✅ PASS | En Pi, el system prompt/perfil del equipo MUST ser la fuente de verdad del prompt de sesión del orchestrator. |
| REQ-PROMPT-002 | developer-team-install + pi-team-launch/profile tests + inspección de paths | ✅ PASS | El archivo/agente Pi del orchestrator MUST NOT duplicar el body completo del system prompt cuando ese body ya se materializa como prompt de perfil. |
| REQ-PROMPT-003 | developer-team-install + pi-team-launch/profile tests + inspección de paths | ✅ PASS | La limpieza de persistencia en Pi MUST preserve el comportamiento observable de lanzamiento del orchestrator con system prompt activo. |
| REQ-VERIFY-001 | Inspección OpenSpec/código + core parity/registry tests | ✅ PASS | Deck MUST producir checks/reportes de paridad suficientes para identificar gaps, blockers, runner-specific silent packages y capacidades compartidas antes de declarar paridad. |
| REQ-VERIFY-002 | Inspección OpenSpec/código + core parity/registry tests | ✅ PASS | La verificación MUST cubrir registro, mappings OpenCode/Pi, Serena en Pi, Context7 estándar o blocker, Supermemory sin gate extra, `context-mode` como MCP local en Pi, `codebase-memory`/`codebase-memory-mcp`, `RTK`, reutilización de binarios y limpieza de prompt Pi. |
| REQ-VERIFY-003 | Inspección OpenSpec/código + core parity/registry tests | ✅ PASS | Los tests SHOULD proteger que paquetes silenciosos runner-specific no se reporten como gaps y que gaps reales sí aparezcan en el reporte. |
| REQ-VERIFY-004 | Inspección OpenSpec/código + core parity/registry tests | ✅ PASS | La verificación MAY incluir snapshots o matrices legibles si facilitan revisión humana y consumo por agentes IA. |

## Compliance Matrix — Acceptance Scenarios

| Scenario | Method | Result | Notes |
|---|---|---|---|
| Scenario: Consulta de capacidades canónicas | Focused tests + inspección de artifacts | ✅ PASS | Cubierto por suites core/adapter-pi/TUI o contrato inspeccionado. |
| Scenario: Estados de mapping distinguibles | Focused tests + inspección de artifacts | ✅ PASS | Cubierto por suites core/adapter-pi/TUI o contrato inspeccionado. |
| Scenario: Mapping ausente detectado | Focused tests + inspección de artifacts | ✅ PASS | Cubierto por suites core/adapter-pi/TUI o contrato inspeccionado. |
| Scenario: Mappings completos para superficies Deck | Focused tests + inspección de artifacts | ✅ PASS | Cubierto por suites core/adapter-pi/TUI o contrato inspeccionado. |
| Scenario: Mapping explícito faltante de codebase-memory o RTK | Focused tests + inspección de artifacts | ✅ PASS | Cubierto por suites core/adapter-pi/TUI o contrato inspeccionado. |
| Scenario: Mermaid silencioso no genera gap | Focused tests + inspección de artifacts | ✅ PASS | Cubierto por suites core/adapter-pi/TUI o contrato inspeccionado. |
| Scenario: Serena obligatorio en Pi | Focused tests + inspección de artifacts | ✅ PASS | Cubierto por suites core/adapter-pi/TUI o contrato inspeccionado. |
| Scenario: Context-mode MCP local en Pi | Focused tests + inspección de artifacts | ✅ PASS | Cubierto por suites core/adapter-pi/TUI o contrato inspeccionado. |
| Scenario: Preservación de capacidades Pi existentes | Focused tests + inspección de artifacts | ✅ PASS | Cubierto por suites core/adapter-pi/TUI o contrato inspeccionado. |
| Scenario: Codebase-memory en paridad Pi | Focused tests + inspección de artifacts | ✅ PASS | Cubierto por suites core/adapter-pi/TUI o contrato inspeccionado. |
| Scenario: RTK en paridad Pi | Focused tests + inspección de artifacts | ✅ PASS | Cubierto por suites core/adapter-pi/TUI o contrato inspeccionado. |
| Scenario: Codebase-memory es capability canónica visible | Focused tests + inspección de artifacts | ✅ PASS | Cubierto por suites core/adapter-pi/TUI o contrato inspeccionado. |
| Scenario: Codebase-memory MCP requiere integración local | Focused tests + inspección de artifacts | ✅ PASS | Cubierto por suites core/adapter-pi/TUI o contrato inspeccionado. |
| Scenario: Estado de indexación local observable | Focused tests + inspección de artifacts | ✅ PASS | Cubierto por suites core/adapter-pi/TUI o contrato inspeccionado. |
| Scenario: RTK es capability canónica visible | Focused tests + inspección de artifacts | ✅ PASS | Cubierto por suites core/adapter-pi/TUI o contrato inspeccionado. |
| Scenario: Reuso y disponibilidad RTK por runner | Focused tests + inspección de artifacts | ✅ PASS | Cubierto por suites core/adapter-pi/TUI o contrato inspeccionado. |
| Scenario: Context7 estándar funciona | Focused tests + inspección de artifacts | ✅ PASS | Cubierto por suites core/adapter-pi/TUI o contrato inspeccionado. |
| Scenario: Context7 estándar bloqueado | Focused tests + inspección de artifacts | ✅ PASS | Cubierto por suites core/adapter-pi/TUI o contrato inspeccionado. |
| Scenario: Supermemory sin gate Pi-only | Focused tests + inspección de artifacts | ✅ PASS | Cubierto por suites core/adapter-pi/TUI o contrato inspeccionado. |
| Scenario: Supermemory mal configurado | Focused tests + inspección de artifacts | ✅ PASS | Cubierto por suites core/adapter-pi/TUI o contrato inspeccionado. |
| Scenario: Binario compartido reusable | Focused tests + inspección de artifacts | ✅ PASS | Cubierto por suites core/adapter-pi/TUI o contrato inspeccionado. |
| Scenario: Binario compartido no usable | Focused tests + inspección de artifacts | ✅ PASS | Cubierto por suites core/adapter-pi/TUI o contrato inspeccionado. |
| Scenario: System prompt como fuente de verdad | Focused tests + inspección de artifacts | ✅ PASS | Cubierto por suites core/adapter-pi/TUI o contrato inspeccionado. |
| Scenario: Comportamiento de lanzamiento preservado | Focused tests + inspección de artifacts | ✅ PASS | Cubierto por suites core/adapter-pi/TUI o contrato inspeccionado. |
| Scenario: Reporte suficiente para humanos y agentes | Focused tests + inspección de artifacts | ✅ PASS | Cubierto por suites core/adapter-pi/TUI o contrato inspeccionado. |
| Scenario: Cobertura mínima de pruebas | Focused tests + inspección de artifacts | ✅ PASS | Cubierto por suites core/adapter-pi/TUI o contrato inspeccionado. |

## Findings

### CRITICAL
- None.

### WARNING
- Global typecheck is not clean: `bun run typecheck` is unavailable and `bunx tsc --noEmit` reports pre-existing/unrelated project diagnostics. Focused changed areas and build passed.

### SUGGESTION
- Keep a dedicated scoped typecheck script for Pi/OpenCode parity changes to avoid classifying unrelated repo diagnostics during final verify.

## Open Questions

None.

## Registry Intent (Deferred)

- **Registry Write**: deferred
- **Phase**: `verify`
- **Status**: `passed_with_warnings`
- **Event**: `verify-passed-with-warnings`
- **Artifact**: `verify-report.md`
