# Verify Report: pi-runner-capability-dashboard — Backend Fix Tasks 3-6

## Summary

**Overall Result**: PASS WITH WARNINGS  
**Scope**: Re-check de Backend Fix para Tasks 3-6 únicamente  
**Tasks Complete**: 4 / 4 tareas backend en scope, más 1 / 1 fix backend de review  
**Tests**: 3 / 3 suites/checks ejecutados pasaron  
**Build**: ⚠️ WARN — no existe script `build` en el workspace  
**Typecheck**: ✅ PASS — `bunx tsc --noEmit --pretty false`

Registro leído en modo **registry-deferred**. No se modificaron `state.yaml` ni `events.yaml`.

## Task Completion

| Task | Status | Owner | Notes |
|---|---|---|---|
| Task 3: Capability Inventory Builder | ✅ Complete | Backend Apply | Marcada completa en `apply-progress.md`. |
| Task 4: Capability Plan Builder | ✅ Complete | Backend Apply | Marcada completa; incluye fixes de readiness Mermaid/team. |
| Task 5: installation-plan metadata helpers | ✅ Complete | Backend Apply | Marcada completa; helper `getCapabilityInstallableToolMappings()` presente. |
| Task 6: required-tools detector mappings | ✅ Complete | Backend Apply | Marcada completa; no agrega detectores no confirmados para `pi-mermaid`/`pi-hud`. |
| Review Backend fixes for Tasks 3-6 | ✅ Complete | Backend Apply | Marcado completo en `apply-progress.md`. |

## Test Results

| Test / Check | Pass | Fail | Skip | Details |
|---|---:|---:|---:|---|
| Workspace tests: `bun test` | 716 | 0 | 0 | Ran 716 tests across 52 files. |
| Adapter tests: `bun test packages/adapter-pi/src` | 171 | 0 | 0 | Ran 171 tests across 13 files. |
| Manual backend fix assertions: `bun -e` | 1 | 0 | 0 | Verificó team pending/blocked/ready y Mermaid ready sin pending-source. |

## Build / Typecheck

| Check | Result | Details |
|---|---|---|
| Build: `bun run build` | ⚠️ WARN | Falla con `error: Script not found "build"`; el workspace solo define `test`. |
| Typecheck: `bunx tsc --noEmit --pretty false` | ✅ PASS | Sin output de error. |

## Compliance Matrix

| REQ-ID / Scenario | Method | Result | Notes |
|---|---|---|---|
| REQ-TEAM-005 / REQ-TEAM-006 — team muestra consumo/faltantes y el plan refleja condición | Código + manual assertion | ✅ PASS | `team.developer-team.apply` expone `dependencies: ["runner-mermaid"]`, `unresolvedCapabilities` y status `pending`/`blocked` cuando Mermaid no está `ready`. |
| Scenario: Team sin capability requerida o consumida | Código + manual assertion | ✅ PASS | Con `runner-mermaid: pending-source`, acción de team queda `pending`, plan `ready: false`, diagnóstico `TEAM_CAPABILITY_UNSATISFIED` warning. Con `blocked`, queda `blocked` y diagnóstico error. |
| REQ-PLAN-003 — plan con pendientes/desconocidas no se declara listo | Código + manual assertion | ✅ PASS | Acciones `pending`, `blocked`, `manual` y `pending-source` mantienen `ready: false`. |
| REQ-GCAP-002 / Scenario: Capability lista no genera paso manual innecesario | Código + manual assertion | ✅ PASS | Si inventory reporta `runner-mermaid: ready`, no se genera `capability.runner-mermaid.pending-source`; se agrega `capability.runner-mermaid.validate`. |
| REQ-GCAP-004 / REQ-GCAP-005 / REQ-UI-002 — Mermaid requerida pendiente/bloqueante, Pi mapea a `pi-mermaid` | Código | ✅ PASS | Si no está ready, `runner-mermaid` genera acción `pending-source`/bloqueante con implementación `pi-mermaid` para Pi y source `TBD`. |
| Task 5 / metadata tool↔capability reduce drift | Código | ✅ PASS | Acciones para capabilities seleccionables resuelven `installKind`, `toolId` y `source` vía `getCapabilityInstallableToolMappings()`, con fallback al catálogo. |
| Scope guard — no frontend screens/reducer fuera de scope | Git/file check | ✅ PASS | En `apps/cli/src/tui/pi-runner-dashboard/` solo existe `state.ts`; no aparecen reducer/screens/action-runner nuevos en este fix. |
| Typecheck/tests apropiados | Commands | ✅ PASS | Typecheck, workspace tests, adapter tests y assertions manuales pasaron. |
| Build disponible | Command | ⚠️ WARN | No hay script `build`; no es una falla del fix, pero impide validar build formal. |
| Cobertura dedicada de fix | Test inventory | ⚠️ WARN | No se agregaron tests dedicados versionados para estos fixes; la verificación específica fue por assertions manuales. Task 16 sigue pendiente según plan. |

## Findings

### CRITICAL

None.

### WARNING

- No existe script `build` en el workspace, por lo que no se pudo ejecutar una validación formal de build (`bun run build` → `Script not found "build"`).
- Los fixes de backend se verificaron con assertions manuales y tests existentes, pero no hay tests dedicados versionados para estos casos; Task 16 sigue pendiente.

### SUGGESTION

- Cuando Task 16 se implemente, agregar casos unitarios para: team pending/blocked por `runner-mermaid`, `runner-mermaid` ready sin pending-source, y uso de metadata helper para capabilities instalables.

## Open Questions

None.

## Registry Intent

- **Registry Write**: deferred
- **Intended Phase**: `verify`
- **Intended Status**: `passed_with_warnings`
- **Intended Event**: `verify.backend_fix.passed_with_warnings`
- **Artifact**: `verify-backend-fix-output.md`
- **Registry Blocker**: none
