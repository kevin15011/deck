# Review Report: Fix TUI Developer Team Model Assignment Persistence

## Summary

**Overall Rating**: APPROVE WITH CHANGES
**Scope**: general (backend + frontend integration)
**Files Reviewed**: 3

## Ratings by Dimension

| Dimension | Rating | Notes |
|---|---|---|
| Architecture | Strong | Two-layer fix aligns with Design. Type extension is backward-compatible. Pi closure follows existing plan/apply/verify/rollback pattern. |
| Security | Adequate | Model assignments originate from TUI React state, not untrusted external input. No injection vectors. No runtime validation of model IDs, but this matches existing behavior and `buildDeveloperTeamInstallPlan` falls back gracefully. |
| Scalability | Strong | Negligible performance impact. One extra plan/apply/verify only on explicit dashboard Finish. |
| Maintainability | Adequate | Minor type-debt from `as any` casts. Closure lacks try/catch/rollback on write errors, unlike `applyDeveloperTeamModelConfig`. |
| Code Quality | Adequate | Closure parameter types should use imported branded types instead of `Record<string, string>`. |
| Backend | Strong | Adapter functions (`buildDeveloperTeamInstallPlan`, `applyDeveloperTeamInstall`, etc.) are unchanged. Contracts are clean. |
| Frontend | Strong | React state handling is consistent. Dashboard sync remains correct. |
| Integration | Strong | Assignment forwarding from dashboard state → action runner → installer is coherent and backward-compatible. |

## Findings

### MINOR
- **Code Quality**: `installTeamBundle` closure parameter uses `Record<string, string>` instead of already-imported `DeveloperTeamModelAssignments` / `DeveloperTeamThinkingAssignments`
  - **File**: `apps/cli/src/tui/app.tsx` — lines 563, 586
  - **Evidence**:
    ```tsx
    options?: { memoryProvider?: AdaptiveMemoryProvider; modelAssignments?: Record<string, string>; thinkingAssignments?: Record<string, string> }
    ```
    This forces three `as any` casts on lines 571, 590, and 592.
  - **Recommendation**: Change closure parameter to use `DeveloperTeamModelAssignments` and `DeveloperTeamThinkingAssignments` (already imported from `@deck/adapter-pi` at lines 61–62). This removes all three `as any` casts.

- **Maintainability**: Pi `installTeamBundle` closure does not wrap `applyDeveloperTeamInstall` / `verifyDeveloperTeamInstall` in try/catch, so disk-write errors do not trigger rollback
  - **File**: `apps/cli/src/tui/app.tsx` — lines 586–601
  - **Evidence**: The closure calls `backupDeveloperTeamFiles(plan)` but never rolls back inside a catch block. If `applyDeveloperTeamInstall` throws, `runRunnerAction` catches it at action-runner.ts:186, yet files may remain partially written. The OpenCode closure has the same pre-existing limitation.
  - **Recommendation**: Add a `try { ... } catch { rollbackDeveloperTeamFiles(backup); throw; }` wrapper inside the Pi closure to match `applyDeveloperTeamModelConfig`'s behavior. Consider the same for the OpenCode closure.

### NIT
- **Code Quality**: `RunnerActionRunnerDependencies.buildDeveloperTeamInstallPlan` alias type is stale
  - **File**: `apps/cli/src/tui/pi-runner-dashboard/action-runner.ts` — line 76
  - **Evidence**: Alias still reads `options?: { memoryProvider?: AdaptiveMemoryProvider }` and omits the new optional assignment fields.
  - **Recommendation**: Widen the alias to `options?: { memoryProvider?: AdaptiveMemoryProvider; modelAssignments?: DeveloperTeamModelAssignments; thinkingAssignments?: DeveloperTeamThinkingAssignments }` so test doubles are fully typed.

## Design Fidelity

Does the implementation match the Design artifact?
- **Aligned**: Yes
- **Deviations**: None significant. The implementation follows the two-layer fix exactly as specified. The IIFE pattern for `installTeamBundle` in `app.tsx` is a sensible implementation detail to capture `isOpenCode` at closure creation time and is consistent with the design's intent to keep the action runner runtime-agnostic.

## Open Questions

None.
