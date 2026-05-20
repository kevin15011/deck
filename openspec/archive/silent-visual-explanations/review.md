# Review Report: Silent Visual Explanations

## Summary

**Overall Rating**: APPROVE (PASS)  
**Scope**: general / backend / frontend / integration  
**Files Reviewed**: 16  
**Registry Write**: deferred per launch instruction

Re-review confirms the previous quality findings are resolved. The internal visual support path now carries `internalPackageId` from plan to runner, dashboard user-facing text no longer exposes Mermaid/pi-mermaid in normal setup/review copy, the public install catalog boundary assertion was corrected, and absent review data now surfaces neutral validation feedback instead of scheduling an evidence-free install.

Independent verification noted by the Orchestrator: `bun test` 1103 pass / 0 fail and `bunx tsc --noEmit` exit 0 after fixes.

## Ratings by Dimension

| Dimension | Rating | Notes |
|---|---|---|
| Architecture | ✅ Strong | Internal package metadata is now explicit across plan/state/action-runner boundaries. |
| Security | ✅ Strong | No new secret exposure found; existing redaction remains in display paths. |
| Scalability | ✅ Strong | Narrow validation/install path; no material performance risk. |
| Maintainability | ✅ Strong | Boundary assertion and internal package status semantics are clearer. |
| Code Quality | ✅ Strong | Fixes are readable and supported by targeted tests. |
| Backend | ✅ Strong | Internal catalog, detection, and install executor are wired end-to-end. |
| Frontend | ✅ Strong | Dashboard copy and action rendering use neutral visual-support wording. |
| Integration | ✅ Strong | Plan action metadata aligns with action-runner execution. |

## Previous Findings Confirmation

- **BLOCKER fixed**: `packages/adapter-pi/src/capability-plan.ts:228-239` sets `internalPackageId`, and `apps/cli/src/tui/pi-runner-dashboard/action-runner.ts:169-173` routes those actions to `runInternalPackageInstall()` before the public `toolId` path.
- **MAJOR fixed**: dashboard overview/package/review rendering uses neutral copy (`apps/cli/src/tui/screens/pi-runner-dashboard-screens.tsx:65-93`, `283-317`); validation action omits `implementationId` while retaining `source` only as metadata (`packages/adapter-pi/src/capability-plan.ts:212-220`).
- **MINOR fixed**: public install catalog boundary assertion now uses `Extract<..., "pi-mermaid"> extends never` (`packages/adapter-pi/src/installation-plan.ts:64`).
- **Absent review behavior acceptable**: `detectInternalRunnerPackageStatus()` returns `not-checked` for absent review data and no install action is generated (`packages/adapter-pi/src/internal-runner-packages.ts:172-178`, `203-210`).

## Findings

None.

## Design Fidelity

- **Aligned**: Yes
- **Deviations**: None requiring changes.

## Open Questions

None.
