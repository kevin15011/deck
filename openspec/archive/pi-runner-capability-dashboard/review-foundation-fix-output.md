# Review Report: pi-runner-capability-dashboard — Foundation Fix Tasks 1-2

## Summary

**Overall Rating**: APPROVE  
**Scope**: general / integration (re-check del Apply Fix de Foundation Tasks 1-2)  
**Files Reviewed**: 10

Se re-revisaron los artefactos oficiales, el registry solo para contexto en modo registry-deferred, y los contratos corregidos en `capability-catalog.ts` y `state.ts`. Contexto adaptativo: no cargado/no usado; OpenSpec y Spec Registry se mantienen como fuente autoritativa.

Los cambios solicitados en `review-foundation-output.md` quedaron resueltos:

- Mermaid queda como capability global requerida con mapping explícito por runner; `pi-mermaid` ya no aparece como implementación global aplicable a cualquier runner.
- `runner-mermaid` ya no está en `selectedCapabilities`; ahora se modela como `requiredCapabilities`.
- `modelAssignments` y `thinkingAssignments` reutilizan tipos existentes de `@deck/adapter-pi`.
- `PiRunnerAction.toolId` quedó restringido a `InstallablePiToolId`, y los IDs de implementación como `pi-mermaid` quedan separados en `implementationId`.
- El acoplamiento se mantiene bajo para esta etapa: el catálogo solo referencia tipos de herramientas instalables y no consume lógica legacy; el estado TUI importa tipos compartidos sin introducir efectos.

## Ratings by Dimension

| Dimension | Rating | Notes |
|---|---|---|
| Architecture | ✅ Strong | Las fronteras capability global vs implementación por runner y selección user-facing vs requisito derivado están explícitas. |
| Security | ✅ Strong | No se agregan secretos; Supermemory mantiene `hasToken` sin token en estado y Adaptive Memory default `none`. |
| Scalability | ✅ Strong | Son contratos puros y baratos; no agregan efectos ni detecciones costosas. |
| Maintainability | ✅ Strong | Los tipos compartidos reducen estados inválidos y evitan duplicar semántica de modelos/thinking/tools. |
| Code Quality | ✅ Strong | Código legible, nombres claros, imports type-only consolidados. |
| Backend | ✅ Strong | El plan/inventory backend puede distinguir tool instalable (`toolId`) de implementación pendiente (`implementationId`). |
| Frontend | ✅ Strong | El estado evita toggles para capabilities obligatorias y mantiene defaults seguros. |
| Integration | ✅ Strong | Los contratos son suficientemente seguros para que Backend/Frontend consuman la taxonomía sin conflar Mermaid/pi-mermaid ni selected/required. |

## Findings

### BLOCKER

None.

### MAJOR

None.

### MINOR

None.

### NIT

None.

## Fix Verification Notes

- **Mermaid capability vs implementation mapping**: Resuelto. `packages/adapter-pi/src/capability-catalog.ts` define `runner-mermaid` con `runnerScope: "all"`, `requirementLevel: "required"`, `installKind: "pending"` y `implementations.pi.id: "pi-mermaid"` más `implementations.opencode.id: "TBD"` (líneas 93-116). El `detector` global queda como nota, no como implementación Pi global.
- **Required vs selected capabilities**: Resuelto. `apps/cli/src/tui/pi-runner-dashboard/state.ts` separa `UserSelectableCapabilityId = Exclude<CapabilityId, "runner-mermaid">` y `RequiredRunnerCapabilityId = Extract<CapabilityId, "runner-mermaid">` (líneas 39-41). El default incluye solo `context-mode`, `codebase-memory`, `rtk`, `pi-hud` en `selectedCapabilities`, y `runner-mermaid` en `requiredCapabilities` (líneas 156-163).
- **Model/thinking types**: Resuelto. `PiRunnerTeamState` usa `DeveloperTeamModelAssignments` y `DeveloperTeamThinkingAssignments` (líneas 59-60), preservando contratos existentes.
- **Action `toolId` vs `implementationId`**: Resuelto. `PiRunnerAction.toolId` usa `InstallablePiToolId` y `implementationId` usa `CapabilityImplementationId` (líneas 94-95), evitando tratar `pi-mermaid`/`TBD` como herramientas instalables.
- **Acoplamiento mínimo**: Aceptable. `capability-catalog.ts` solo importa el tipo `InstallablePiToolId` desde `installation-plan` y no depende de datos o funciones legacy; `state.ts` consume tipos exportados por `@deck/adapter-pi` para evitar duplicación de contratos.

## Design Fidelity

Does the implementation match the Design artifact?
- **Aligned**: Yes, para el alcance Foundation Tasks 1-2.
- **Deviations**: None within this limited re-check scope.

## Open Questions

None.

## Registry Intent

```yaml
registry_intent:
  phase: review
  status: approved
  artifact: review-foundation-fix-output.md
  event: review.foundation_fix.approved
  note: "Foundation fix re-check approved for Tasks 1-2; previous review findings are resolved and registry update is deferred."
  timestamp: "2026-05-19T00:00:00Z"
```

## Registry Mode

- **Registry Write**: deferred
- **Registry State Path**: `openspec/changes/pi-runner-capability-dashboard/state.yaml`
- **Registry Events Path**: `openspec/changes/pi-runner-capability-dashboard/events.yaml`
- **Registry Blocker**: none
