# Review Report: Dashboard por capacidades para Pi Runner — Final Review Fix Re-check

## Summary

**Overall Rating**: APPROVE WITH CHANGES  
**Scope**: final review fix (`general`, `frontend`, `integration`, Supermemory boundary)  
**Files Reviewed**: 13 archivos/artefactos foco (`review-final-output.md`, `apply-progress.md`, `spec.md`, `design.md`, `tasks.md`, `state.yaml`, `events.yaml`, `app.tsx`, `action-runner.ts`, `pi-runner-dashboard-screens.tsx`, `input-handler.ts`, `action-runner.test.ts`, `render.test.tsx`)

La corrección principal del review final quedó resuelta en el flujo normal: el setup del dashboard ya no persiste `~/.pi/agent/mcp.json` antes de `Review & Install`, la escritura Pi MCP ocurre como acción visible `write-pi-mcp-config`, y el provider se resuelve después de las config writes y antes de aplicar Developer Team. También se corrigieron diagnósticos en la pantalla complete y se removió la prop muerta `dispatch`.

No veo BLOCKER restante para cerrar la frontera principal de Review & Install. Sí queda un hardening importante: el estado `hasToken` puede quedar desincronizado del token efímero real, y algunas rutas de cancel/back no limpian o invalidan esa marca; además, si el token real falta, `write-pi-mcp-config` se reporta como `skipped` y el runner continúa hasta resolver provider. Recomiendo corregirlo antes de archivar si se quiere cerrar completamente el riesgo de cleanup/token lifecycle.

## Ratings by Dimension

| Dimension | Rating | Notes |
|---|---|---|
| Architecture | ⚠️ Adequate | La frontera setup → Review/Install mejoró; `app.tsx` sigue concentrando controller/state/side effects. |
| Security | ⚠️ Adequate | No hay persistencia temprana normal ni Deck token persistence; queda riesgo de token lifecycle stale y redacción standalone. |
| Scalability | ✅ Strong | Sin preocupación de carga relevante; plan/action runner son baratos. |
| Maintainability | ⚠️ Adequate | Buen runner injectable, pero app/controller monolítico y duplicación de predicados persisten. |
| Code Quality | ⚠️ Adequate | Cambios claros; quedan mensajes stale y edge cases por sincronización de estado. |
| Backend | N/A | Re-check enfocado en TUI/action-runner final fix. |
| Frontend | ⚠️ Adequate | Complete diagnostics/dispatch prop resueltos; cleanup en navegación necesita hardening. |
| Integration | ⚠️ Adequate | Orden config → provider → team correcto en happy path; faltan guards cuando el token efímero real ya no existe. |

## Findings

### BLOCKER

None.

### MAJOR

- **Security / Integration**: El estado `hasToken` puede quedar desincronizado del token efímero real; si falta el token, `write-pi-mcp-config` se marca `skipped` y el runner no corta inmediatamente.
  - **File**: `apps/cli/src/tui/app.tsx` — líneas 442-447, 455-464, 858-865, 1034-1046
  - **File**: `apps/cli/src/tui/pi-runner-dashboard/action-runner.ts` — líneas 64-89, 246-248, 316-341
  - **Evidence**: `runDashboardInstall()` pasa `supermemoryToken` desde `supermemorySetup.token` solo si `dashboardState.adaptiveMemory.supermemory?.hasToken` es true, pero el predicado de run y el preflight del action-runner solo miran el estado (`hasToken/userId`), no la disponibilidad real del token. Además, la limpieza de token ocurre al completar/cleanup del effect, pero `dashboardState.adaptiveMemory.supermemory.hasToken` no se invalida. `writePiMcpConfigAction()` devuelve `skipped` cuando no recibe token, mientras `runPiRunnerReviewPlan()` solo corta para `write-pi-mcp-config` con status `failed`. Esc desde el dashboard principal vuelve a `environment-check` sin limpiar token ni resetear estado dashboard.
  - **Impact**: Una navegación back/cancel o un rerun desde `complete` puede dejar UI/plan creyendo que Supermemory está listo aunque el token efímero ya fue limpiado. En entornos con Pi MCP config previa, el team podría aplicarse usando credenciales existentes pese a que la acción visible de handoff fue saltada en esta corrida; en entornos sin config, el bloqueo llega tarde por resolución de provider, no por la acción requerida.
  - **Recommendation**: Hacer que la disponibilidad del token efímero real forme parte del guard de ejecución, no solo del estado `hasToken`; tratar `write-pi-mcp-config` sin token como `failed`/blocker para acciones requeridas; al cancelar/salir del dashboard principal o al limpiar el token, invalidar `hasToken/configured` o resetear el setup de Supermemory; agregar regresiones para Esc desde dashboard, back desde complete y run con `hasToken=true` pero `supermemoryToken` ausente.

### MINOR

- **Security / Code Quality**: La redacción del action-runner no cubre tokens Supermemory standalone con forma `sk-sm-*` si aparecen sin prefijo `token`, `api-key`, header o `Bearer`.
  - **File**: `apps/cli/src/tui/pi-runner-dashboard/action-runner.ts` — líneas 397-423
  - **Evidence**: `redact()` cubre `x-supermemory-api-key`, `api-key`, `token` y `Bearer`, mientras la pantalla de render sí agrega un patrón específico para `sk-sm-*`. Un error externo o diagnostic mockeado como texto libre podría atravesar `redactDiagnostics()` sin ser sustituido.
  - **Recommendation**: Alinear el redactor del action-runner con el de screens agregando patrón `sk-sm-[A-Za-z0-9._~+/-]+` y una regresión con token standalone.

### NIT

- **Frontend / UX**: Copia stale en el bloqueo de Review & Install todavía dice que el token debe estar “entregado a Pi MCP antes de ejecutar”.
  - **File**: `apps/cli/src/tui/pi-runner-dashboard/input-handler.ts` — región de `block-review-install`
  - **Recommendation**: Cambiar el texto para reflejar el nuevo contrato: token efímero capturado antes de Run; Pi MCP config se escribe durante Review & Install.

## Design Fidelity

Does the implementation match the Design artifact?
- **Aligned**: Partially
- **Aligned areas**:
  - Setup de dashboard ya no llama al writer Pi MCP antes de Run.
  - `runPiRunnerReviewPlan()` ejecuta config writes antes de resolver provider y aplicar Developer Team.
  - Complete muestra mensajes/diagnósticos redactados.
  - `PiRunnerDashboardScreens` ya no recibe la prop muerta `dispatch`.
- **Deviations / remaining risk**:
  - Token lifecycle no está completamente sincronizado entre estado dashboard (`hasToken`) y token efímero real en React state.
  - `app.tsx` sigue siendo controller monolítico; no es nuevo blocker, pero mantiene riesgo de edge cases de navegación.

## Open Questions

None.

## Registry Intent

- **Registry Write**: deferred
- **Intended phase**: `review`
- **Intended status**: `approved_with_changes`
- **Intended event**: `review.final_fix.approved_with_changes`
- **Artifact**: `review-final-fix-output.md`
- **Registry Blocker**: none (deferred by instruction)
