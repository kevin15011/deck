# Review Report: Dashboard por capacidades para Pi Runner — Final Fix 2 Re-check

## Summary

**Overall Rating**: APPROVE  
**Scope**: `general`, `frontend`, `integration` — re-check focalizado en Supermemory Review & Install boundary, token lifecycle, diagnósticos y redacción.  
**Files Reviewed**: 19

El Final Fix 2 resuelve el fallo crítico reportado por Verify y los findings del `review-final-fix-output.md`: el diagnóstico informativo del setup real de Supermemory ya no bloquea Run; Run exige el token efímero real además de `hasToken`; la acción `write-pi-mcp-config` falla si falta token; la limpieza/cancelación/salida invalida readiness de Supermemory; los tokens standalone `sk-sm-*` se redactan; y la copia stale de Review & Install fue actualizada.

No encontré BLOCKER ni MAJOR restante para cerrar esta frontera. Queda solo una observación NIT de mantenibilidad sobre el acoplamiento por string/duplicación del predicado de bloqueo, pero el runner queda fail-closed y no bloquea cierre.

## Ratings by Dimension

| Dimension | Rating | Notes |
|---|---|---|
| Architecture | ⚠️ Adequate | La frontera setup → Review/Install quedó corregida; persiste acoplamiento menor entre app/controller y action-runner. |
| Security | ✅ Strong | El token no se persiste antes de Run, se exige token efímero real y se redactan diagnósticos/resultados. |
| Scalability | ✅ Strong | Sin impacto de carga; checks y runners siguen siendo baratos. |
| Maintainability | ⚠️ Adequate | Fix claro y con regresiones; aún hay lógica duplicada de bloqueo y `app.tsx` sigue concentrando mucho control. |
| Code Quality | ✅ Strong | Cambios localizados, nombres claros y pruebas focalizadas sobre el bug real. |
| Backend | N/A | Scope focalizado en TUI/action-runner. |
| Frontend | ⚠️ Adequate | UI/copy y cleanup mejorados; controller sigue grande. |
| Integration | ✅ Strong | Orden observable: config writes → provider resolve → team apply → validation. |

## Resolution Matrix

| Finding previo | Status | Evidence |
|---|---|---|
| Verify CRITICAL: diagnóstico informativo de setup bloqueaba Run y evitaba `write-pi-mcp-config` | ✅ Resuelto | `action-runner.ts` filtra el diagnóstico informativo exacto en `isBlockingSetupDiagnostic()`; `action-runner.test.ts` usa la salida real de `buildDashboardSupermemorySetupUpdate()` y verifica orden `write-deck-config` → `write-pi-mcp-config` → `resolve-provider` → `apply-team-bundle` → `validate`. |
| Review MAJOR: `hasToken` podía quedar desincronizado del token efímero real y `write-pi-mcp-config` se salteaba | ✅ Resuelto | `getPiRunnerReviewPlanRunBlockDiagnostics()` exige `supermemoryToken` cuando `hasToken=true`; `writePiMcpConfigAction()` sin token retorna `failed`; `clearDashboardSupermemoryEphemeralState()` borra token e invalida `configured/hasToken`. |
| Review MINOR: redacción no cubría token standalone `sk-sm-*` | ✅ Resuelto | `redact()` en `action-runner.ts` incluye patrón `sk-sm-[A-Za-z0-9._~+/-]+`; test dedicado verifica que el sentinel no aparece en JSON de resultados. |
| Review NIT: copia stale decía que el token debía estar entregado a Pi MCP antes de ejecutar | ✅ Resuelto | `input-handler.ts` ahora dice que el token se captura efímeramente y Pi MCP config se escribe durante Review & Install. |

## Findings

### BLOCKER

None.

### MAJOR

None.

### MINOR

None.

### NIT

- **Maintainability / Integration**: El filtrado del diagnóstico informativo de Supermemory depende de un string exacto y el predicado de bloqueo está duplicado parcialmente entre `app.tsx` y `action-runner.ts`.
  - **File**: `apps/cli/src/tui/pi-runner-dashboard/action-runner.ts` — `isBlockingSetupDiagnostic()` / `getPiRunnerReviewPlanRunBlockDiagnostics()`.
  - **File**: `apps/cli/src/tui/app.tsx` — `getDashboardRunBlockDiagnostics()` / `canRunDashboardPlan()`.
  - **Evidence**: El runner filtra el mensaje `"Supermemory token captured ephemerally for Review & Install; no Pi MCP config was written yet."` por regex exacta, mientras la UI calcula bloqueos con un predicado separado que no reutiliza la misma función.
  - **Recommendation**: En una limpieza posterior, modelar diagnósticos de setup con código/severidad o exportar un helper compartido para evitar drift. No bloquea cierre porque el action-runner bloquea fail-closed si aparece un diagnóstico no informativo.

## Design Fidelity

Does the implementation match the Design artifact?
- **Aligned**: Yes for Final Fix 2 scope / Partially for overall dashboard architecture.
- **Aligned areas**:
  - Supermemory setup mantiene token solo en estado efímero hasta Run.
  - `write-pi-mcp-config` ocurre dentro del plan visible de Review & Install.
  - Provider resolution ocurre después de config writes y antes de aplicar Developer Team.
  - Falta de token real bloquea antes de escrituras y también falla la acción requerida si se invoca directamente.
  - Diagnósticos y resultados quedan redactados, incluyendo tokens standalone `sk-sm-*`.
- **Residual non-blocking deviation**:
  - `app.tsx` sigue siendo un controller monolítico; esto es deuda de mantenibilidad ya conocida, no un blocker para este cierre.

## Open Questions

None.

## Registry Intent

- **Registry Write**: deferred
- **Intended phase**: `review`
- **Intended status**: `approved`
- **Intended event**: `review.final_fix_2.approved`
- **Artifact**: `review-final-fix-2-output.md`
- **Registry Blocker**: none (deferred by instruction)
