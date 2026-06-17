# Preconditions: tui-update-upgrade-sync

| ID | Precondition | Source | Status | Evidence | Blocks Apply |
|---|---|---|---|---|---|
| PCG-001 | Spec artifact con requisitos MUST/SHOULD definidos y compliance matrix | `openspec/changes/tui-update-upgrade-sync/spec.md` | satisfied | spec.md cubre REQ-UAR-001..REQ-TST-002 con escenarios y matriz | No |
| PCG-002 | Design artifact con arquitectura, contratos y estrategia de tests | `openspec/changes/tui-update-upgrade-sync/design.md` | satisfied | design.md define `OrchestratorDeps.replaceBinary`, `runSelfUpgradeWorkflow`, backup global con runners, doctor commit-aware | No |
| PCG-003 | Exploración previa identifica wiring gaps (registry/config vacíos, sin replace binario, backup sin runners, doctor sin poblar) | `openspec/changes/tui-update-upgrade-sync/exploration.md` | satisfied | exploration.md lista 5 gaps accionables y recomienda Opción A | No |
| PCG-004 | Registry real de adapters accesible desde TUI/CLI | design.md §"Componentes" (`createDefaultAdapterRegistry` en `apps/cli/src/runner-adapters.ts`) | satisfied | `apps/cli/src/runner-adapters.ts` exporta `createDefaultAdapterRegistry()` con adapters `pi` y `opencode` | No |
| PCG-005 | `getEnabledPackageInstructionIds` y `buildCapabilityInstructionBundle` disponibles | `packages/core/src/teams/developer/instruction-bundles/index.ts` | satisfied | index.ts expone helpers usados en `runner-sync.ts` | No |
| PCG-006 | Primitiva de reemplazo atómico de binario presente o extraíble | `apps/cli/src/upgrade-command/install.ts` | allowed-with-placeholder | `performUpgrade`/`atomicReplace` existen; extraer helper sin red a `replaceBinary` (Task 4) | No |
| PCG-007 | Decisión sobre nombre `runUpgradeOrchestrator` vs `runSelfUpgradeWorkflow` | design.md §"Decisiones abiertas" + Spec OQ | allowed-with-placeholder | Mantener alias + exponer nombre nuevo; ambos coexisten (Task 2) | No |
| PCG-008 | Decisión sobre backup centralizado vs adapter-only | design.md §"Tradeoffs" + Spec OQ | allowed-with-placeholder | Centralizar manifest/metadata en `backup-store.ts`; adapters proveen targets via `collectRunnerBackupTargets` (Task 3) | No |
| PCG-009 | Decisión sobre CLI `deck upgrade` wrapper vs delegación total | design.md §"Tradeoffs" + Spec OQ | allowed-with-placeholder | Wrapper transicional `performUpgrade` + `runRunnerSync` mientras se converge; paridad funcional cubierta (Task 8) | No |
| PCG-010 | Política de retención/limpieza de backups | Spec OQ | deferred | Comportamiento conservador existente + pruning best-effort; limpieza explícita en otro cambio | No |
| PCG-011 | Soporte para archivos ausentes previos en `backup-store.ts` | design.md §"Recolección de archivos de runner" | allowed-with-placeholder | Si no soporta `absentBefore`, diferir a otro cambio; binario+configs existentes sí cubiertos (Task 5) | No |
| PCG-012 | `decideReleaseAvailability` commit-aware disponible | `apps/cli/src/upgrade-command/github-release.ts:534` | satisfied | export existe; doctor/TUI lo consumen (Tasks 9, 10) | No |
| PCG-013 | Cobertura Bun con mocks deterministas (sin red, sin instalaciones reales, sin writes reales) | Spec REQ-TST-001/002, design.md §"Estrategia de testing" | allowed-with-placeholder | Tests existentes usan `bun:test` con mocks; extender con fakes para `replaceBinary`, adapters, backup, fetcher (Tasks 13-17) | No |
| PCG-014 | Aviso en TUI para runner instalado sin capacidades seleccionadas | Spec OQ | deferred | Omitir silenciosamente con log; UI explícita en otro cambio | No |

## Closure Decision

- Ready for Apply: Yes with conditions
- Notes:
  - Las decisiones OQ-1, OQ-4, OQ-6, OQ-10/OQ-11/OQ-14 están diferidas y no bloquean Apply.
  - Las decisiones OQ-2/OQ-3/OQ-5/OQ-7/OQ-8/OQ-9/OQ-11/OQ-13 tienen placeholders aprobados que el Apply puede implementar sin más preguntas.
  - Si durante Apply surge la necesidad de cambiar un placeholder, escalar al Orchestrator antes de desviarse.
