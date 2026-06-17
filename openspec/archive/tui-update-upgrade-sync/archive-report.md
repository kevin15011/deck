# Archive Report: Sincronizar update/upgrade desde la TUI y CLI

## Change Summary

**Change**: tui-update-upgrade-sync
**Status**: ✅ Archived
**Archive Location**: `openspec/archive/tui-update-upgrade-sync/`

### Lifecycle
- **Proposal**: 2026-06-16 — Unificar update/upgrade TUI+CLI con self-upgrade workflow, replaceBinary, sync por runner, backups
- **Spec + Design**: 2026-06-16 — Parallel, both completed
- **Tasks**: 2026-06-16 — 17 tasks created (Shared/Backend/Frontend/Tests)
- **Apply**: 2026-06-16 — 17 tasks completed across multiple fix batches
- **Verify**: 2026-06-17 — PASS WITH WARNINGS (111/111 focused tests pass)
- **Review**: 2026-06-17 — APPROVE (no blockers)
- **Archive**: 2026-06-17 — archived

## Traceability Matrix

| REQ-ID | Task | Implementation | Verify Result | Review Rating |
|---|---|---|---|---|
| REQ-UAR-001 | T9, T16 | ✅ Implemented | ✅ PASS | ✅ Strong |
| REQ-UAR-002 | T9, T16 | ✅ Implemented | ✅ PASS | ✅ Strong |
| REQ-BIN-001 | T4, T13 | ✅ Implemented | ✅ PASS | ✅ Strong |
| REQ-BIN-002 | T4, T13 | ✅ Implemented | ✅ PASS | ✅ Strong |
| REQ-BIN-003 | T4, T13 | ✅ Implemented | ✅ PASS | ✅ Strong |
| REQ-TUI-001 | T11, T17 | ✅ Implemented | ✅ PASS | ✅ Strong |
| REQ-TUI-002 | T12, T17 | ✅ Implemented | ✅ PASS | ✅ Strong |
| REQ-CLI-001 | T8, T15 | ✅ Implemented | ✅ PASS | ✅ Strong |
| REQ-CLI-002 | T8, T15 | ✅ Implemented | ✅ PASS | ✅ Strong |
| REQ-BCU-001 | T3, T5, T13 | ✅ Implemented | ✅ PASS | ✅ Strong |
| REQ-BCU-002 | T3, T5, T13 | ✅ Implemented | ✅ PASS | ✅ Strong |
| REQ-BCU-003 | T4, T5, T13 | ✅ Implemented | ✅ PASS | ✅ Strong |
| REQ-SRS-001 | T3, T4, T14 | ✅ Implemented | ✅ PASS | ✅ Strong |
| REQ-SRS-002 | T3, T4, T14 | ✅ Implemented | ✅ PASS | ✅ Strong |
| REQ-SRS-003 | T3, T14 | ✅ Implemented | ✅ PASS | ✅ Strong |
| REQ-SRS-004 | T3, T14 | ✅ Implemented | ✅ PASS | ✅ Strong |
| REQ-SRS-005 | T3, T14 | ✅ Implemented | ✅ PASS | ✅ Strong |
| REQ-ROL-001 | T7, T13 | ✅ Implemented | ✅ PASS | ✅ Strong |
| REQ-ROL-002 | T7, T13 | ✅ Implemented | ✅ PASS | ✅ Strong |
| REQ-ROL-003 | T7, T13 | ✅ Implemented | ✅ PASS | ✅ Strong |
| REQ-TST-001 | T13-T17 | ✅ Implemented | ✅ PASS | ✅ Strong |
| REQ-TST-002 | T13-T17 | ✅ Implemented | ✅ PASS | ✅ Strong |

## Verification

**Result**: PASS WITH WARNINGS
**Critical Findings**: 0
**Warnings**: 1 — 99 TypeScript global errors classified as baseline_structural (not introduced by change)

### Tests Summary

| Suite | Pass | Fail |
|---|---|---|
| orchestrator.test.ts | 19 | 0 |
| runner-sync.test.ts | 10 | 0 |
| index.test.ts | 9 | 0 |
| doctor-diagnostics.test.ts | 13 | 0 |
| github-release.test.ts | 36 | 0 |
| tui-integration.test.tsx | 24 | 0 |

**Total**: 111/111 focused tests pass

## Review

**Rating**: APPROVE
**Blockers**: 0
**Major Findings**: 0 (all previous major issues resolved)

## Follow-ups

- **LOW**: Añadir `partial_failure` al terminal Enter handler en TUI — una línea de fix en `app.tsx` líneas 1824-1827
- **LOW**: Limpiar inconsistencia de tipos en dual-call `runUpgrade` — signature programática no utilizada, considerar simplificar
- **ADVISORY**: Resolver baseline structural TypeScript en follow-up dedicado — 99 errores globales preexistentes

> Ningún follow-up bloquea el cierre del cambio.

## Project AI Notes (Phase 5 — Deferred)

> Project AI notes are a planned Phase 5 feature under `.deck/ai-notes/`. Not yet active.

### Extracted Learnings

- La firma dual de `runUpgrade` (array vs 3 params) es funcional pero type-inconsistente — la rama programática nunca se usa en producción
- Los errores TypeScript baseline en `app.tsx` (35 errores) son incompatibilidades de tipos preexistentes entre paquetes (ReviewPlan vs RunnerReviewPlan)
- El workflow compartido entre TUI y CLI requiere `buildDefaultOrchestratorDeps` con registry/config reales — no placeholders
- El estado `partial_failure` diferenciado de `rolled_back` es importante para UX — binario actualizado + runners parciales ≠ rollback total

## Risks Residuales

- **Ninguno bloqueante**: Los riesgos residuales fueron mitigados durante Apply:
  - Sync accidental en runners no instalados → `detectDeckInstall` obligatorio
  - Serena no seleccionada → config real + `packageInstructions` gating
  - Reemplazo binario deja Deck inutilizable → checksum + atomic replace + rollback
  - Backup incompleto → targets de runners incluidos en backup global

## Rollback Notes

El cambio es fully reversible mediante:
1. **Binario**: `backup-store.ts` con `rollbackLatest(backupId)` restaura binario anterior
2. **Runners**: `collectRunnerBackupTargets` + `adapter.rollbackDeveloperTeamFiles` para cada runner
3. **Total**: El workflow ejecuta rollback total en verificación final fallida

**Nota**: No se requiere rollback para este archive — el cambio está aprobado.

## Git Advisory

### Conventional Commit Type
`feat` — nueva funcionalidad de upgrade sync

### Scope
`upgrade-command`, `tui`, `doctor`

### Key Changes
- Workflow compartido TUI/CLI con `runSelfUpgradeWorkflow`
- Reemplazo atómico de binario (`replaceBinary`)
- Sync de runners con `packageInstructions` filtering
- Backup global incluye targets de runners
- `DoctorBinaryResult.upgradeAvailable` poblado
- `partial_failure` estado diferenciado en TUI

### PR Title Suggestion
```
feat(upgrade): sync runners on TUI/CLI upgrade with real registry/config
```

### PR Body Suggestion
```
Implementa sincronización de runners durante upgrade:

- TUI y CLI comparten `runSelfUpgradeWorkflow`
- Reemplazo atómico de binario con checksum SHA-256
- Sync solo en runners detectados con packageInstructions filtering
- Backup global incluye binario + archivos de runners
- Doctor/TUI reportan upgradeAvailable correctamente
- Estado `partial_failure` diferenciado de `rolled_back`

Cierra #tui-update-upgrade-sync
```

---

**Archive**: Completado el 2026-06-17
**Artifact**: `openspec/changes/tui-update-upgrade-sync/archive-report.md`
**Registry**: phase `archive`, status `archived`, event `archive-complete`