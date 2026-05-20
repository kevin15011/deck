# Review Report: pi-runner-capability-dashboard — Contract Sync PiRunnerAction

## Summary

**Overall Rating**: APPROVE  
**Scope**: integration  
**Files Reviewed**: 9

Revisión limitada al sync del contrato `PiRunnerAction` entre el estado TUI y el backend. El hallazgo menor previo quedó resuelto: `apps/cli/src/tui/pi-runner-dashboard/state.ts` ahora expone `dependencies?: CapabilityId[]` y `unresolvedCapabilities?: CapabilityId[]`, alineado con `packages/adapter-pi/src/capability-plan.ts` y con la acción backend `team.developer-team.apply`.

El contrato ya es seguro para que Frontend renderice readiness/avisos de dependencias sin casts ni campos ocultos. No se observa nuevo acoplamiento indebido: el TUI sigue dependiendo de tipos de dominio compartidos (`CapabilityId`, `CapabilityImplementationId`, `TechnicalActionKind`, etc.) desde `@deck/adapter-pi`, y el cambio agrega campos de payload tipados con `CapabilityId[]` sin introducir llamadas backend ni lógica de plan en el estado.

Adaptive context no fue consultado mediante adaptador de memoria; revisión basada en artefactos oficiales, registry y código local.

## Ratings by Dimension

| Dimension | Rating | Notes |
|---|---|---|
| Architecture | ✅ Strong | El contrato TUI refleja los campos backend necesarios; la duplicación estructural queda aceptable para este sync acotado. |
| Security | ✅ Strong | Los campos nuevos son IDs de capabilities, no secretos ni comandos ejecutables. |
| Scalability | ✅ Strong | Sin impacto de performance; son arrays opcionales pequeños en el plan. |
| Maintainability | ⚠️ Adequate | El drift inmediato está corregido; conviene considerar import/re-export del tipo compartido cuando se implementen reducer/action-runner. |
| Code Quality | ✅ Strong | Nombres claros y consistentes con backend. |
| Backend | ✅ Strong | Backend ya emite `dependencies`/`unresolvedCapabilities` y mantiene readiness no engañoso. |
| Frontend | ✅ Strong | El estado TUI puede tipar y renderizar dependencias no satisfechas. |
| Integration | ✅ Strong | Contratos `PiRunnerAction` TUI/backend están sincronizados en los campos relevantes. |

## Findings

### BLOCKER
- Ninguno.

### MAJOR
- Ninguno.

### MINOR
- Ninguno.

### NIT
- **Maintainability**: La duplicación de `PiRunnerAction`/`PiRunnerReviewPlan` entre adapter y TUI sigue siendo un punto de drift futuro, aunque el sync actual está correcto.
  - **File**: `apps/cli/src/tui/pi-runner-dashboard/state.ts` — tipo `PiRunnerAction` líneas 88-101; `packages/adapter-pi/src/capability-plan.ts` — tipo `PiRunnerAction` líneas 21-34
  - **Evidence**: Ambos tipos contienen los mismos campos de contrato relevantes, incluidos `dependencies?: CapabilityId[]` y `unresolvedCapabilities?: CapabilityId[]`.
  - **Recommendation**: No bloquear este cambio. En la fase de Frontend/action-runner, evaluar importar/re-exportar `PiRunnerReviewPlan` desde `@deck/adapter-pi` o agregar una prueba de compatibilidad de tipos para evitar drift futuro.

## Contract Sync Assessment

- **Finding previo resuelto**: `review-backend-fix-output.md` líneas 37-40 pedía sincronizar el contrato TUI con `dependencies` y `unresolvedCapabilities`. `state.ts` líneas 88-101 ahora incluye ambos campos.
- **Backend source of truth actual**: `capability-plan.ts` líneas 21-34 define los mismos campos; `addTeamActions()` líneas 294-309 rellena `dependencies: ["runner-mermaid"]` y `unresolvedCapabilities` cuando Developer Team depende de Mermaid no satisfecha.
- **Frontend safety**: el TUI puede renderizar advertencias de `TEAM_CAPABILITY_UNSATISFIED` y explicar dependencias sin casts. Los campos usan `CapabilityId[]`, alineados con el catálogo (`capability-catalog.ts` línea 3).
- **Acoplamiento**: no se agregó coupling indebido a lógica backend. El TUI conserva tipos de estado propios y solo comparte identificadores/contratos de dominio desde `@deck/adapter-pi`, dependencia ya existente y apropiada para este dashboard.
- **Política Mermaid/pi-mermaid**: se mantiene la separación correcta: `runner-mermaid` es capability global y `pi-mermaid` es implementación Pi (`capability-catalog.ts` líneas 93-113). El sync no reintroduce `pi-mermaid` como capability seleccionable.

## Design Fidelity

Does the implementation match the Design artifact?
- **Aligned**: Yes
- **Deviations**: Ninguna relevante para este sync. La implementación cumple la intención de que `PiRunnerReviewPlan` sea consumible por Frontend para renderizar acciones agrupadas, readiness y condiciones no satisfechas. La decisión de reflejar campos en el tipo TUI, en vez de importar el tipo backend completo, es aceptable para este ajuste acotado porque el contrato quedó estructuralmente alineado.

## Open Questions

None.

## Registry Intent

- **Registry Write**: deferred
- **Intended Phase**: `review`
- **Intended Status**: `approved`
- **Intended Event**: `review.contract_sync.approved`
- **Artifact**: `review-contract-sync-output.md`
- **Registry Blocker**: none
