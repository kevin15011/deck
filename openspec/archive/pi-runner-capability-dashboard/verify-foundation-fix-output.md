# Verify Report: pi-runner-capability-dashboard — Foundation Fix Tasks 1-2

## Summary

**Overall Result**: PASS WITH WARNINGS  
**Scope**: Re-check del Apply Fix para Foundation Tasks 1-2 únicamente.  
**Tasks Complete**: 2 / 2 en scope  
**Tests**: 716 / 716 passed  
**Build**: N/A / warning (`bun run build` no existe en el workspace)  
**Typecheck**: pass (`bunx tsc --noEmit --pretty false`)  
**Registry Write**: deferred; `state.yaml` y `events.yaml` fueron leídos, no modificados.

## Task Completion

| Task | Status | Owner | Notes |
|---|---|---|---|
| Task 1: Capability Catalog | ✅ Complete | General Apply | Apply progress marca complete y el código contiene catálogo/mapping corregido. |
| Task 2: Dashboard State | ✅ Complete | General Apply | Apply progress marca complete y el estado contiene contratos corregidos. |

> Tareas 3-19 permanecen pendientes por diseño y fuera del scope de este re-check.

## Test Results

| Test Suite | Pass | Fail | Skip | Command |
|---|---:|---:|---:|---|
| Workspace tests | 716 | 0 | 0 | `bun test` |
| Foundation-specific tests | 0 | 0 | 0 | No existen tests dedicados todavía para Task 1-2. |

## Build / Typecheck

| Check | Result | Details |
|---|---|---|
| Typecheck | ✅ PASS | `bunx tsc --noEmit --pretty false` finalizó sin output ni error. |
| Tests | ✅ PASS | `bun test`: 716 pass, 0 fail. |
| Build | ⚠️ WARN | `bun run build` devolvió `error: Script not found "build"`; el `package.json` raíz solo define `deck` y `test`. |

## Compliance Matrix

| Requirement / Finding | Method | Result | Notes |
|---|---|---|---|
| Task 1: catálogo exporta tipos y constante sin errores | Typecheck + inspección | ✅ PASS | `capability-catalog.ts` compila y `@deck/adapter-pi` re-exporta `./capability-catalog`. |
| Task 1: `runner-mermaid` required/pending/TBD | Inspección | ✅ PASS | `runner-mermaid` tiene `requirementLevel: "required"`, `source: "TBD"`, `installKind: "pending"`. |
| Task 1: Mermaid global separado de implementación Pi `pi-mermaid` con mapping por runner | Inspección | ✅ PASS | No hay `detector.implementation` global; usa `implementations.pi.id = "pi-mermaid"` y `implementations.opencode.id = "TBD"`. |
| Task 1: OpenCode no usa `pi-mermaid` por accidente | Inspección | ✅ PASS | Mapping OpenCode separado con `id: "TBD"`; nota explícita indica que `pi-mermaid` no aplica a OpenCode. |
| Task 1: `pi-hud` opcional y Pi-only | Inspección | ✅ PASS | `pi-hud` usa `runnerScope: "pi"`, `requirementLevel: "optional"`, `installKind: "pending"`. |
| Task 1: excluir rpiv todo/ask, context7 y engram-memory del catálogo dashboard | Grep + inspección | ✅ PASS | No aparecen `rpiv-todo`, `rpiv-ask-user-question`, `context7` ni `engram-memory` en `capability-catalog.ts`/`state.ts`. |
| Task 2: Adaptive Memory acepta `none | engram | supermemory` y default `none` | Inspección | ✅ PASS | `AdaptiveMemoryProviderChoice` está limitado a esas tres opciones y default `provider: "none"`. |
| Task 2: 9 pantallas del diseño | Inspección | ✅ PASS | `PI_RUNNER_DASHBOARD_SCREENS` contiene las 9 pantallas solicitadas. |
| Review finding: `runner-mermaid` no está en `selectedCapabilities`; queda requerido/derivado | Inspección + grep | ✅ PASS | `selectedCapabilities` usa `UserSelectableCapabilityId = Exclude<CapabilityId, "runner-mermaid">`; default pone `runner-mermaid` solo en `requiredCapabilities`. |
| Review finding: tipos de modelos/thinking reutilizados | Inspección | ✅ PASS | `PiRunnerTeamState` usa `DeveloperTeamModelAssignments` y `DeveloperTeamThinkingAssignments`. |
| Review finding: `toolId` tipado e `implementationId` separado | Inspección | ✅ PASS | `PiRunnerAction.toolId?: InstallablePiToolId`; `implementationId?: CapabilityImplementationId`. |
| Review finding: imports type-only consolidados | Inspección | ✅ PASS | `state.ts` usa un único bloque `import type` desde `@deck/adapter-pi`. |
| Typecheck/tests apropiados | Ejecución | ✅ PASS | Typecheck y suite completa pasaron. |
| Build disponible | Ejecución | ⚠️ WARN | No hay script `build`; se registra como warning de proyecto, no incumplimiento funcional del fix. |
| Tests dedicados Task 1-2 | Inspección suite | ⚠️ WARN | No hay cobertura dedicada para los nuevos contratos foundation; la validación fue por typecheck, tests existentes e inspección. |

## Findings

### CRITICAL

None.

### WARNING

- No hay script de build en el workspace (`bun run build` falla con `Script not found "build"`).
- No existen tests dedicados para los contratos de `capability-catalog.ts` y `pi-runner-dashboard/state.ts`; el fix fue validado con typecheck, suite existente e inspección directa.

### SUGGESTION

- Agregar tests unitarios de Foundation para bloquear regresiones en: mapping Mermaid por runner, exclusión de `runner-mermaid` de `selectedCapabilities`, y separación `toolId`/`implementationId`.

## Open Questions

None.

## Registry Intent

```yaml
registry_intent:
  phase: verify
  status: passed_with_warnings
  artifact: verify-foundation-fix-output.md
  event: verify.foundation_fix.passed_with_warnings
  note: "Foundation fix re-check for Tasks 1-2 passed: Review findings resolved; typecheck and workspace tests passed. Warnings remain for absent build script and lack of dedicated Foundation tests. Registry update deferred by request."
  timestamp: "2026-05-20T00:00:00Z"
```

## Registry Mode

- **Registry Write**: deferred
- **Registry State Path**: `openspec/changes/pi-runner-capability-dashboard/state.yaml`
- **Registry Events Path**: `openspec/changes/pi-runner-capability-dashboard/events.yaml`
- **Registry Blocker**: none
