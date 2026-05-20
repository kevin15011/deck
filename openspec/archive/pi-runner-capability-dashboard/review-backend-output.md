# Review Report: pi-runner-capability-dashboard — Backend Tasks 3-6

## Summary

**Overall Rating**: APPROVE WITH CHANGES  
**Scope**: backend  
**Files Reviewed**: 14

La implementación backend está bien encaminada: los builders son puros, no dependen de UI/Ink, preservan los exports legacy, no inventan sources para `pi-mermaid`/`pi-hud`, y el contrato de Supermemory evita serializar tokens en config no secreta. Las observaciones son principalmente de robustez de contrato y mantenibilidad antes de que Frontend consuma el plan.

## Ratings by Dimension

| Dimension | Rating | Notes |
|---|---|---|
| Architecture | ⚠️ Adequate | Buen corte catalog/inventory/plan, pero hay fuentes duplicadas para metadata tool↔capability y contratos de plan duplicados con CLI state. |
| Security | ✅ Strong | Supermemory se modela con `hasToken`/estado y acciones de config; no aparecen secretos ni tokens en el plan. |
| Scalability | ✅ Strong | Builders baratos y determinísticos; no hay I/O ni detección repetida dentro del plan. |
| Maintainability | ⚠️ Adequate | Algunas decisiones futuras (`runner-mermaid` ready, tool metadata) requerirán cambios si no se centraliza el contrato. |
| Code Quality | ⚠️ Adequate | Código legible y funciones pequeñas; el filtro final de exclusiones puede ocultar errores de origen. |
| Backend | ⚠️ Adequate | Cumple la dirección general, con ajustes recomendados en contrato de readiness y metadata. |
| Frontend | N/A | Scope limitado a backend. |
| Integration | ⚠️ Adequate | El plan es consumible por Frontend, pero algunos statuses pueden ser ambiguos para renderizar readiness. |

## Findings

### BLOCKER
- Ninguno.

### MAJOR
- Ninguno.

### MINOR
- **Integration**: La acción `team.developer-team.apply` se marca `ready` aunque exista una capability requerida no satisfecha.
  - **File**: `packages/adapter-pi/src/capability-plan.ts` — función `addTeamActions`
  - **Evidence**: La acción de team se agrega con `status: "ready"`; después se emite `TEAM_CAPABILITY_UNSATISFIED` si `runner-mermaid` no está `ready`, pero el status de la acción no cambia.
  - **Recommendation**: Propagar la dependencia no satisfecha al contrato primario que consumirá Frontend: marcar la acción como `pending`/`blocked`, agregar un campo explícito de dependencies/unresolvedCapabilities, o incluir diagnósticos `error`/`warning` en el cálculo de readiness por grupo.

- **Maintainability**: `runner-mermaid` siempre genera acción `pending-source` aunque el inventario futuro pueda marcarlo `ready`.
  - **File**: `packages/adapter-pi/src/capability-plan.ts` — función `addCapabilityActions`, bloque de `requiredCapabilities["runner-mermaid"]`
  - **Evidence**: El builder llama siempre a `buildPendingSourceAction("runner-mermaid", ...)`; si en el futuro hay detector/source canónico y `inventory["runner-mermaid"].status === "ready"`, el plan seguiría agregando un paso pendiente.
  - **Recommendation**: Antes de crear la acción requerida, respetar `entry.status === "ready"` con `noop`/validación o sin acción manual. Mantener `pending-source`/`blocked` solo para estados realmente no resueltos.

- **Architecture**: Hay dos fuentes de verdad para metadata de herramientas existentes.
  - **File**: `packages/adapter-pi/src/capability-catalog.ts`; `packages/adapter-pi/src/installation-plan.ts`; `packages/adapter-pi/src/capability-plan.ts`
  - **Evidence**: `context-mode`, `codebase-memory` y `rtk` tienen `source/installKind/toolId` hardcodeados en `PI_RUNNER_CAPABILITY_CATALOG`, mientras `installation-plan.ts` expone `getCapabilityInstallableToolMappings()`. El plan usa el catálogo para capabilities y no el helper derivado.
  - **Recommendation**: Centralizar la resolución de tool metadata en `getCapabilityInstallableToolMappings()`/`getPiInstallableTool()` o agregar una aserción/test de consistencia para evitar drift entre legacy install plan y dashboard plan.

### NIT
- **Code Quality**: El filtrado final de acciones excluidas es defensivo pero puede ocultar errores de construcción.
  - **File**: `packages/adapter-pi/src/capability-plan.ts` — `removeExcludedActions()` / `containsExcludedTerm()`
  - **Recommendation**: Preferir no construir acciones excluidas desde el origen y usar el filtro como assert/diagnóstico de desarrollo, no como mecanismo principal de corrección silenciosa.

## Design Fidelity

Does the implementation match the Design artifact?
- **Aligned**: Partially
- **Deviations**:
  - Positivas/alineadas: inventory y plan son puros; no hay acoplamiento con UI; `pi-hud` y `pi-mermaid` quedan en `pending-source`/`TBD`; `engram-memory` solo aparece cuando Adaptive Memory = `engram`; Supermemory no genera acción de paquete ni expone token; `buildPiInstallationPlan` y `reviewPiRequiredTools` preservan formato legacy.
  - A ajustar: el readiness por team y el caso futuro de Mermaid `ready` necesitan un contrato menos ambiguo para que Frontend no renderice estados listos cuando hay dependencias no satisfechas.

## Open Questions

- ¿El contrato de `PiRunnerReviewPlan.ready` debe considerar diagnósticos `severity: "error"` aunque no haya acciones `pending/manual/blocked`?
- ¿`runnerScope` para estos builders debería restringirse a runners concretos (`pi`/`opencode`) y no aceptar `"all"` como input operativo?

## Registry Intent

- **Registry Write**: deferred
- **Intended Phase**: `review`
- **Intended Status**: `approved_with_changes`
- **Intended Event**: `review.backend.approved_with_changes`
- **Artifact**: `review-backend-output.md`
- **Registry Blocker**: none
