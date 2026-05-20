# Review Report: pi-runner-capability-dashboard — Backend Fix Tasks 3-6

## Summary

**Overall Rating**: APPROVE WITH CHANGES  
**Scope**: backend  
**Files Reviewed**: 14

Re-check limitado a los fixes solicitados por Review Backend para Tasks 3-6. Los tres hallazgos funcionales previos quedaron resueltos en `packages/adapter-pi/src/capability-plan.ts`: la acción de Developer Team ya no se marca lista si Mermaid requerido está unresolved; `runner-mermaid` puede quedar future-ready sin generar `pending-source`; y las acciones instalables seleccionadas toman metadata desde `getCapabilityInstallableToolMappings()`.

El contrato backend ya es razonablemente seguro para que Frontend renderice readiness con `status` y `diagnostics`. Queda un ajuste menor de integración: el tipo duplicado de `PiRunnerAction` en el estado TUI no refleja los nuevos campos `dependencies`/`unresolvedCapabilities`, por lo que Frontend puede perder tipado para explicar dependencias no satisfechas aunque el backend las emita.

Adaptive context no fue cargado; revisión basada en artefactos oficiales y código local.

## Ratings by Dimension

| Dimension | Rating | Notes |
|---|---|---|
| Architecture | ⚠️ Adequate | Buen fix en el builder; persiste duplicación de contrato plan/action entre adapter y TUI state. |
| Security | ✅ Strong | No se exponen secretos; Supermemory sigue usando acciones de config/validación sin token en Deck config. |
| Scalability | ✅ Strong | Builders puros y baratos; sin I/O adicional ni detección repetida. |
| Maintainability | ⚠️ Adequate | Metadata de acciones instalables se centralizó para el plan; conviene sincronizar tipos y evitar filtros silenciosos. |
| Code Quality | ⚠️ Adequate | Código claro; el filtro final de exclusiones sigue siendo una defensa silenciosa. |
| Backend | ✅ Strong | Los cambios backend solicitados quedaron aplicados con contratos explícitos de status/dependencias. |
| Frontend | N/A | Scope limitado a backend; se revisó el contrato TUI solo por integración. |
| Integration | ⚠️ Adequate | El plan es consumible por status/diagnostics, pero el tipo frontend duplicado aún no expone todos los campos nuevos. |

## Findings

### BLOCKER
- Ninguno.

### MAJOR
- Ninguno.

### MINOR
- **Integration**: El contrato TUI duplicado no incluye los nuevos campos de dependencia emitidos por el backend.
  - **File**: `apps/cli/src/tui/pi-runner-dashboard/state.ts` — tipo `PiRunnerAction`; `packages/adapter-pi/src/capability-plan.ts` — tipo `PiRunnerAction` y función `addTeamActions`
  - **Evidence**: El backend ahora emite `dependencies` y `unresolvedCapabilities` en `team.developer-team.apply`, pero el tipo TUI `PiRunnerAction` solo define `id/kind/title/description/capabilityId/toolId/implementationId/source/status/required/diagnostics`.
  - **Recommendation**: Antes de que Frontend implemente reducer/screens, importar/re-exportar `PiRunnerReviewPlan` desde `@deck/adapter-pi` o reflejar `dependencies?: CapabilityId[]` y `unresolvedCapabilities?: CapabilityId[]` en el tipo TUI para que el render pueda mostrar dependencias no satisfechas sin casts ni pérdida de contrato.

### NIT
- **Code Quality**: El filtrado final de acciones excluidas sigue siendo silencioso.
  - **File**: `packages/adapter-pi/src/capability-plan.ts` — `removeExcludedActions()` / `containsExcludedTerm()`
  - **Recommendation**: Mantenerlo como defensa secundaria está bien, pero en una iteración posterior preferir construir el plan sin acciones excluidas desde el origen o emitir un diagnóstico/assert de desarrollo si alguna aparece.

## Fix Re-check Notes

- **Readiness de team action con required capabilities**: Resuelto. `addTeamActions()` calcula `unresolvedCapabilities` con `runner-mermaid`; marca `team.developer-team.apply` como `pending` o `blocked` cuando Mermaid no está `ready`; agrega `dependencies`, `unresolvedCapabilities` y diagnóstico `TEAM_CAPABILITY_UNSATISFIED`.
- **Future-ready `runner-mermaid`**: Resuelto. En `addCapabilityActions()`, si `inventory["runner-mermaid"].status === "ready"`, el plan agrega `capability.runner-mermaid.validate` y no crea `capability.runner-mermaid.pending-source`.
- **Metadata drift**: Mejorado. Las capabilities instalables seleccionadas resuelven `toolId/source/installKind` con `getCapabilityInstallableToolMappings()` y solo caen al catálogo como fallback.
- **No sources inventadas**: Resuelto. Mermaid/pi-hud permanecen con `TBD`/`pending-source`; no se agregaron detectores ni sources canónicas no confirmadas.
- **Clean integration**: Adecuado con una salvedad menor: status/diagnostics son suficientes para no mostrar readiness falsa, pero los campos de dependency nuevos deben sincronizarse con el contrato TUI.

## Design Fidelity

Does the implementation match the Design artifact?
- **Aligned**: Partially
- **Deviations**:
  - Positivas/alineadas: el builder conserva pureza, no inventa sources, trata Mermaid como capability requerida con implementación Pi `pi-mermaid`, separa Supermemory de instalación de paquetes, y refleja unresolveds de Developer Team en el plan.
  - A ajustar: el diseño posiciona `PiRunnerReviewPlan` como contrato consumido por Frontend; hoy hay tipos duplicados entre adapter y TUI state que pueden driftar.

## Open Questions

None.

## Registry Intent

- **Registry Write**: deferred
- **Intended Phase**: `review`
- **Intended Status**: `approved_with_changes`
- **Intended Event**: `review.backend_fix.approved_with_changes`
- **Artifact**: `review-backend-fix-output.md`
- **Registry Blocker**: none
