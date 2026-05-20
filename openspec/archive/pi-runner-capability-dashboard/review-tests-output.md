# Review Report: pi-runner-capability-dashboard — Tests Tasks 16-19

## Summary

**Overall Rating**: REQUEST CHANGES  
**Scope**: tests / backend / frontend / integration  
**Files Reviewed**: 25

Los tests agregados cubren muchas decisiones clave de forma útil: catálogo/exclusiones, Mermaid vs `pi-mermaid`, `pi-hud` Pi-only, Engram condicional, plan no-ready con manual/pending, reducer con navegación/back/cursor/provider switch, render de secciones principales y regresiones básicas de contexto del Developer Team.

Sin embargo, hay dos brechas importantes para una suite que debe proteger las decisiones de mayor riesgo: Supermemory no queda cubierto en modo fail-closed/seguro completo, y la regresión de preservación de configuración de modelos desde el dashboard es mayormente de render, no de equivalencia de frontmatter/flujo. Recomiendo cambios antes de cerrar Tasks 16-19 como quality gate.

## Ratings by Dimension

| Dimension | Rating | Notes |
|---|---|---|
| Architecture | ⚠️ Adequate | Buena separación por módulo, pero faltan pruebas de integración entre render/input/router y builder. |
| Security | ❌ Weak | La cobertura de Supermemory valida que no haya package install, pero no prueba fail-closed por `userId` faltante ni ausencia de secretos/token en plan/render/dashboard. |
| Scalability | ⚠️ Adequate | Tests unitarios baratos; no hay señales de suites pesadas. |
| Maintainability | ⚠️ Adequate | Cobertura amplia, pero varias aserciones negativas usan `JSON.stringify`/substring y pueden ser frágiles. |
| Code Quality | ⚠️ Adequate | Tests legibles; algunos helpers son útiles, aunque hay fixtures sintéticas que no siempre prueban contratos reales. |
| Backend | ⚠️ Adequate | Buenas pruebas de catálogo/inventory/plan; brecha en Supermemory seguro. |
| Frontend | ⚠️ Adequate | Reducer/render cubiertos; preservación de modelos y wiring de input quedan superficiales. |
| Integration | ❌ Weak | No hay prueba que conecte dashboard state → app handler/action runner/model config/frontmatter de punta a punta. |

## Findings

### BLOCKER

None.

### MAJOR

- **Security / Backend**: La cobertura de Supermemory no valida configuración completa ni fail-closed cuando falta `userId`; incluso hay un caso que construye Supermemory con `configured: true` y `hasToken: true` sin `userId` y no espera estado pendiente/bloqueado.
  - **File**: `packages/adapter-pi/src/capability-plan.test.ts` — líneas 65-78, 81-92
  - **Evidence**: El test principal de Supermemory solo espera config writes/validation y ausencia de package install; el test de switch usa `supermemory: { configured: true, hasToken: true }` sin `userId`. En `packages/adapter-pi/src/capability-plan.ts` líneas 250-276, los statuses `ready` dependen de `configured`/`hasToken`, no de `userId`.
  - **Recommendation**: Agregar tests que cubran `provider: "supermemory"` con `hasToken=true` pero sin `userId` y esperen validación/config pending o diagnóstico warning/error y `plan.ready === false`. Agregar una regresión con token sentinela en el flujo dashboard/action-runner/render para confirmar que no aparece en plan, diagnostics, render ni Deck config no secreta.

- **Maintainability / Frontend**: La regresión de preservación de configuración de modelos desde Developer Team detail no demuestra equivalencia real de provider/model/thinking/frontmatter entre la ruta Home `Configure models` y la ruta dashboard.
  - **File**: `apps/cli/src/tui/screens/developer-team-screens.test.tsx` — líneas 13-95; `packages/adapter-pi/src/capability-plan.test.ts` — líneas 223-243
  - **Evidence**: Los tests frontend son `renderToString` y verifican textos de contexto; no ejercitan escritura/lectura de frontmatter ni el path dashboard state → install plan. El backend compara `dashboardMemoryProvider` vs `memoryProvider` para un assignment, pero no prueba que las asignaciones seleccionadas desde el dashboard produzcan el mismo frontmatter observable que Home.
  - **Recommendation**: Agregar una regresión que construya un estado/dashboard route con `modelAssignments` y `thinkingAssignments`, genere/aplique el plan del Developer Team por el mismo camino que usa Review & Install, y compare el frontmatter resultante contra el camino existente de `Configure models`. Incluir al menos un modelo con thinking explícito y un modelo sin thinking soportado (`opencode-go/kimi-k2.6` → `thinking: off`).

### MINOR

- **Integration / Frontend**: Los render tests usan estados/planes sintéticos y `dispatch={() => {}}`; no protegen la correspondencia entre menú, cursor y handlers reales del dashboard.
  - **File**: `apps/cli/src/tui/pi-runner-dashboard/render.test.tsx` — líneas 80-182; `apps/cli/src/tui/app.tsx` — líneas 824-959
  - **Evidence**: `render.test.tsx` prueba snapshots de texto con estados construidos manualmente. La lógica crítica de Enter/Space/Esc y cursor vive en `handleDashboardInput`, `toggleDashboardCurrent` y `continueDashboardCurrent`, pero no está cubierta por estos tests.
  - **Recommendation**: Extraer la tabla/función pura de input del dashboard o agregar un test de integración TUI con handlers mockeados que cubra navegación dashboard → secciones, toggle `pi-hud`, selección Supermemory que abre setup, Developer Team detail/back, y Review & Install run blocked/unblocked.

- **Maintainability / Code Quality**: Varias aserciones críticas de exclusiones/proveedores usan `JSON.stringify` + `contains/not.toContain`, lo que puede ocultar errores estructurales o fallar por cambios inocuos de texto.
  - **File**: `packages/adapter-pi/src/capability-catalog.test.ts` — líneas 18-22; `packages/adapter-pi/src/capability-plan.test.ts` — líneas 40-50, 189-206
  - **Evidence**: Las exclusiones y ausencia de Engram/Supermemory se validan sobre texto serializado del catálogo/plan.
  - **Recommendation**: Mantener las aserciones de texto como defensa adicional, pero agregar aserciones estructurales sobre `capabilityId`, `toolId`, `kind`, `source`, `groups.*` y `diagnostics.*` para todos los actions generados.

### NIT

None.

## Design Fidelity

Does the implementation match the Design artifact?
- **Aligned**: Partially
- **Deviations**:
  - La estrategia de tests backend/frontend está mayormente alineada con el diseño para catálogo, inventory, plan, reducer y render.
  - La cobertura de Supermemory no alcanza la intención de seguridad del diseño: configuración segura, secretos redactados y validación fail-closed antes de provider injection.
  - La cobertura de preservación de Developer Team/model config no prueba suficientemente el resultado observable de provider/model/thinking/frontmatter desde la ruta dashboard.
  - La navegación/render se prueba por reducer y texto estático, pero no por integración con el router/handler real donde están los riesgos de cursor y acciones.

## Open Questions

- ¿La cobertura de Supermemory/token redaction debe vivir en Tasks 16-19 o se considera cubierta por tests existentes del subflujo legacy? Si se considera cubierta, falta al menos una prueba dashboard-specific de que el estado/render/plan no reintroduce secretos.
- ¿La equivalencia de model config desde dashboard debe probarse como unit test de builder/action-runner o como integración TUI/app? Recomiendo extraer un helper testeable si montar `app.tsx` completo es costoso.

## Registry Intent (deferred)

- **Registry Write**: deferred
- **Phase**: `review`
- **Status**: `changes_requested`
- **Event**: `review.tests.changes_requested`
- **Artifact**: `review-tests-output.md`
- **Provenance**: `deck-developer-review`, scope `tests/backend/frontend/integration`, registry-deferred mode
