# Review Report: Dashboard por capacidades para Pi Runner — Frontend Tasks 10-12

## Summary

**Overall Rating**: REQUEST CHANGES  
**Scope**: frontend  
**Files Reviewed**: 15

Se revisó el scope limitado a Tasks 10-12: reducer, selectors y action-runner. La implementación mantiene buenas fronteras generales: reducer/selectors son puros, el action-runner usa inyección de dependencias y no se observaron efectos al import ni scope creep hacia screens/app. También se conserva Mermaid como capability requerida separada de `pi-mermaid` como implementación Pi, y `runner-mermaid` no aparece como capability user-toggleable.

La calidad no está lista para aprobar por tres riesgos: el action-runner puede reportar éxito sin ejecutar instalaciones cuando falta `piCommand`; los summaries pueden mostrar secciones como listas aunque existan manual/pending/unknown importantes; y el reducer deja planes generados potencialmente stale frente a cambios de selección sin invalidación explícita.

## Ratings by Dimension

| Dimension | Rating | Notes |
|---|---|---|
| Architecture | ⚠️ Adequate | Buen módulo por capas, pero falta una invariante fuerte de freshness del plan antes de instalar. |
| Security | ⚠️ Adequate | Diagnósticos Supermemory se redactan; conviene no devolver objetos `raw` no sanitizados en acciones con credenciales. |
| Scalability | ⚠️ Adequate | Complejidad razonable; los errores de estado/ejecución pueden escalar a UX operativa engañosa. |
| Maintainability | ⚠️ Adequate | Reducer/selectors testeables; algunos counts/readiness hardcodeados y acoplamiento implícito a formas de plan. |
| Code Quality | ⚠️ Adequate | Código legible, pero hay defaults peligrosos y summaries no filtrados por sección. |
| Backend | N/A | Scope frontend; solo se revisaron contratos backend necesarios para integración. |
| Frontend | ❌ Weak | Summaries y reducer no protegen suficientes invariantes para pantallas futuras. |
| Integration | ⚠️ Adequate | DI correcta en general, pero la semántica de `installPiTools` se interpreta mal cuando no hay comando Pi. |

## Findings

### BLOCKER
- Ninguno.

### MAJOR
- **Integration**: `install-pi-package` puede reportar éxito aunque no se ejecute nada cuando falta `piCommand`.
  - **File**: `apps/cli/src/tui/pi-runner-dashboard/action-runner.ts` — lines 116-129; `packages/adapter-pi/src/install-tools.ts` — line 23
  - **Evidence**: `runPiPackageInstall()` llama `runner(dependencies.piCommand, ...)`; el installer actual retorna `[]` si `command` es `undefined`; luego `failed = installResults.some(...)` queda `false` y se devuelve `status: "executed"` con mensaje `Installed ...`.
  - **Recommendation**: Validar `dependencies.piCommand` antes de ejecutar acciones `install-pi-package` y devolver `skipped`/`failed` con diagnóstico accionable si falta. Además, tratar un resultado vacío para una lista no vacía como skip/failure, no como éxito.

- **Frontend**: Los section summaries pueden mostrar readiness/counts incorrectos y ocultar manual/pending/unknown relevantes.
  - **File**: `apps/cli/src/tui/pi-runner-dashboard/selectors.ts` — lines 134-147, 154, 257-261
  - **Evidence**: Runner Capabilities calcula readiness solo con `automaticInstalls`, ignorando manual steps de RTK/codebase-memory; Adaptive Memory cuenta solo `configWrites`, por lo que Engram manual no se refleja; Visual Helpers evalúa `undefined` como `ready`, por lo que Mermaid requerido puede aparecer listo antes de tener inventory/status.
  - **Recommendation**: Derivar summaries por sección filtrando acciones por `capabilityId`/prefijo (`adaptive-memory.*`, `team.*`) y considerar estados `manual`, `pending`, `blocked` y `unknown`. Para capabilities requeridas como `runner-mermaid`, `undefined` debe ser `pending`/`attention`, nunca `ready`.

- **Architecture**: El reducer no invalida ni marca stale el plan cuando cambian inputs que lo determinan, y `start-install` no protege contra instalar un plan viejo.
  - **File**: `apps/cli/src/tui/pi-runner-dashboard/reducer.ts` — lines 50-75, 113-188
  - **Evidence**: `toggle-capability`, `select-adaptive-memory`, `update-supermemory` y `set-team-selected` actualizan estado pero preservan `state.plan`; el plan solo se recalcula en `enter-review`/`regenerate-plan`. `start-install` navega a `install-progress` sin verificar que el plan corresponda al estado actual ni que se esté en `review-plan`.
  - **Recommendation**: Al cambiar cualquier input del plan, limpiar `plan`, mantener un `planDirty`/`planRevision`, o regenerar explícitamente con inventory. `start-install` debería requerir un plan actual y/o aceptar una revisión de plan vigente para no depender de que las pantallas futuras respeten una secuencia implícita.

### MINOR
- **Security**: Las acciones de Supermemory redactan `diagnostics`, pero devuelven `raw` sin sanitización.
  - **File**: `apps/cli/src/tui/pi-runner-dashboard/action-runner.ts` — lines 183-191, 229-236, 283-292
  - **Evidence**: `writePiMcpConfigAction()` y `validateAction()` aplican `redactDiagnostics(...)`, pero retornan `raw: result`. El writer actual parece devolver diagnósticos sin token, pero el contrato con DI no impide que un adapter futuro/injectado incluya credenciales o config completa.
  - **Recommendation**: Para acciones con credenciales, no devolver `raw` o aplicar deep-redaction antes de exponerlo a pantallas/logs. Mantener solo campos seguros como `ok`, `action`, `path` y `serverName` si son necesarios.

- **Code Quality**: `buildInstallableTool()` fabrica `toolId: "context-mode"` para acciones con `source` pero sin `toolId`.
  - **File**: `apps/cli/src/tui/pi-runner-dashboard/action-runner.ts` — lines 248-262
  - **Evidence**: El fallback `id: action.toolId ?? "context-mode"` puede etiquetar incorrectamente cualquier acción source-only como context-mode.
  - **Recommendation**: Fallar temprano si falta `toolId` en una acción `install-pi-package`, o extender el contrato de acción para incluir metadata explícita suficiente sin usar un ID ficticio.

### NIT
- **Maintainability**: Los límites de cursor están hardcodeados por pantalla.
  - **File**: `apps/cli/src/tui/pi-runner-dashboard/selectors.ts`
  - **Recommendation**: Cuando se implementen screens, derivar los límites desde las opciones renderizadas para evitar drift entre UI y selector.

## Design Fidelity

Does the implementation match the Design artifact?
- **Aligned**: Partially
- **Deviations**:
  - Alineado: reducer/selectors son puros y testeables; action-runner usa DI; no se introdujeron screens/app fuera de scope; Mermaid se mantiene como capability requerida y `pi-mermaid` como implementación Pi; `runner-mermaid` no es toggleable.
  - Parcial: el dashboard state no mantiene una invariante explícita de plan vigente vs inputs actuales.
  - Parcial: los summaries no representan de forma segura estados manuales/pending/unknown por sección, especialmente Mermaid requerido y Engram manual.
  - Parcial: la ejecución de installs no valida prerequisitos de runtime (`piCommand`) antes de declarar éxito.

## Open Questions

- ¿El contrato del action-runner debería permitir resultados `raw` hacia pantallas, o el output público debe ser siempre sanitizado/serializable sin datos sensibles?
- ¿El reducer debe ser dueño de `planDirty`/`planRevision`, o el inventory + plan deben vivir en una capa superior de screen/controller?
