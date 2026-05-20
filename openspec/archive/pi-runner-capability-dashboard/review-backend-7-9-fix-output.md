# Review Report: pi-runner-capability-dashboard — Backend Tasks 7-9 Fix

## Summary

**Overall Rating**: APPROVE  
**Scope**: backend  
**Files Reviewed**: 16

Re-check limitado al fix de Backend Tasks 7-9 en modo registry-deferred. Se leyeron `state.yaml` y `events.yaml` para contexto, pero no se modificó el registry. Los findings previos quedaron resueltos: el path directo de Supermemory para dashboard/TUI ahora valida con la normalización de Deck config, rechaza campos secretos/desconocidos, falla cerrado con diagnostics redacted cuando la construcción del provider arroja error, y `installPiTools` emite resultados manuales para tools externos aun sin comando Pi disponible.

## Ratings by Dimension

| Dimension | Rating | Notes |
|---|---|---|
| Architecture | ✅ Strong | La resolución de provider está centralizada en `resolvePiAdaptiveMemoryProvider` y se reutiliza para launch/TUI sin duplicar paths inseguros. |
| Security | ✅ Strong | Supermemory direct config pasa por `validateDeckConfig`, rechaza secret-shaped/unknown fields y envuelve construcción de providers en fail-closed diagnostics. |
| Scalability | ✅ Strong | Cambios sin loops costosos ni I/O adicional fuera de validaciones existentes de config/MCP. |
| Maintainability | ✅ Strong | Separación clara entre manual external actions y package installs; tests específicos cubren regresiones relevantes. |
| Code Quality | ✅ Strong | Código legible, ramas explícitas y mensajes diagnósticos consistentes con el contrato previo. |
| Backend | ✅ Strong | Semántica manual externa y provider resolution quedan alineadas con el Review Plan. |
| Frontend | N/A | Fuera de scope. |
| Integration | ✅ Strong | Contrato compartido launch/TUI conserva fail-closed behavior y evita persistir/incluir secretos en Deck config. |

## Findings

### BLOCKER
- None.

### MAJOR
- None.

### MINOR
- None.

### NIT
- None.

## Previous Findings Re-check

- **Security / Backend — Supermemory direct dashboard path**: Resuelto.
  - **Evidence**: `apps/cli/src/pi-launch-command.ts:260-283` normaliza `activeProvider + supermemory` mediante `validateDeckConfig` y convierte errores en `memory_provider_unavailable`; `apps/cli/src/pi-launch-command.ts:213-218` y `240-253` envuelven la construcción de Engram/Supermemory en `try/catch`; `apps/cli/src/pi-launch-command.ts:227-237` mantiene validación MCP antes de inyectar Supermemory.
  - **Tests reviewed**: `apps/cli/src/pi-launch-command.direct-supermemory.test.ts:35-147` cubre container tags inválidos sin crash/inyección, rechazo de `apiKey` sin filtrar token, y rechazo de campos extra.

- **Backend / Maintainability — external installs sin comando**: Resuelto.
  - **Evidence**: `packages/adapter-pi/src/install-tools.ts:32-44` procesa `installKind === "external"` antes del guard de `command`; `packages/adapter-pi/src/install-tools.ts:46-56` conserva fallo explícito solo para `pi-package` sin comando.
  - **Tests reviewed**: `packages/adapter-pi/src/install-tools.test.ts:74-104` cubre external manual sin comando y paquete Pi fallido explícito.

## Design Fidelity

Does the implementation match the Design artifact?
- **Aligned**: Yes
- **Deviations**: None. El fix se limita a endurecer la resolución directa de Supermemory y corregir la semántica manual externa sin introducir nuevas capabilities, sources o wiring fuera de scope.

## Open Questions

None.

## Registry Intent

- **Registry Write**: deferred
- **Registry State Path**: `openspec/changes/pi-runner-capability-dashboard/state.yaml`
- **Registry Events Path**: `openspec/changes/pi-runner-capability-dashboard/events.yaml`
- **Registry Recorded**: not written by this agent due to registry-deferred mode
- **Registry Intent**: artifact `review-backend-7-9-fix-output.md`, phase `review`, status `approved`, event `review.backend_tasks_7_9_fix.approved`
- **Registry Blocker**: none
