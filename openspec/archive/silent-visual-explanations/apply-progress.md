# Apply Progress: Silent Visual Explanations

## Verify/Review Fixes (General Apply — post-verify)

This section documents fixes applied in response to the Verify Report (`verify-report.md`) and Review Report (`review.md`).

---

## Completed Fixes

### Fix #1: BLOCKER — Internal package install action routing

**Problem**: The plan emitted `internal.pi-mermaid.install` as `kind: "install-pi-package"` with `source: "npm:pi-mermaid"` but no `toolId`. The action-runner's `buildInstallableTool()` returned `undefined` when `toolId` was absent, producing a failed action. `installInternalRunnerPackages()` existed but was not connected.

**Solution**:
1. Added `internalPackageId: InternalRunnerPackageId | undefined` field to `PiRunnerAction` in both `capability-plan.ts` and `state.ts`.
2. Moved the `internalPackageId` check in `runPiPackageInstall()` to execute **before** the `piCommand` guard — internal actions must be routed through `installInternalRunnerPackages()` regardless of whether `piCommand` was provided.
3. Created `runInternalPackageInstall()` that calls `installInternalRunnerPackages()` with correctly constructed `InternalRunnerPackageInstallAction` objects. The result preserves `visual_support_install_failed` error code on failure.
4. Exported `InternalRunnerPackageInstallAction` from `index.ts` by adding `export * from "./internal-runner-packages"`.

**Files Changed**
- `packages/adapter-pi/src/capability-plan.ts` — added `internalPackageId` field to `PiRunnerAction`; plan sets `internalPackageId: "pi-mermaid"` on the automatic install action
- `packages/adapter-pi/src/internal-runner-packages.ts` — `isInstallableStatus("not-checked")` now returns `false` (Fix #4); `getInternalRunnerPackageInstallAction` skips `not-checked` status
- `packages/adapter-pi/src/index.ts` — added `export * from "./internal-runner-packages"` for CLI/frontend access
- `apps/cli/src/tui/pi-runner-dashboard/action-runner.ts` — added `runInternalPackageInstall()`; moved `internalPackageId` check before `piCommand` guard; imported `installInternalRunnerPackages`, `InternalRunnerInstallResult`, `InternalRunnerPackageInstallAction`
- `apps/cli/src/tui/pi-runner-dashboard/state.ts` — added `internalPackageId: InternalRunnerPackageId | undefined` field to `PiRunnerAction`
- `apps/cli/src/tui/pi-runner-dashboard/action-runner.test.ts` — added 3 tests: successful install via `pi install npm:pi-mermaid`, failure with `visual_support_install_failed` error code, and graceful handling of unavailable piCommand

**Tests Added**
- `missing pi-mermaid plan action executes pi install npm:pi-mermaid via installInternalRunnerPackages` — verifies command dispatch and success result
- `missing pi-mermaid install failure surfaces visual_support_install_failed error code` — verifies error code preservation
- `missing pi-mermaid install with no piCommand reports failure gracefully` — verifies the fix works even when piCommand is unavailable (internal actions bypass the piCommand check)

---

### Fix #2: MAJOR — Remove Mermaid/pi-mermaid from user-facing dashboard copy

**Problem**: Dashboard overview said "Mermaid is installed automatically when required"; Packages detail said "Mermaid support is automatic"; validation title said "Validate Mermaid runner capability"; `ActionGroup` rendered `implementationId` as `(pi-mermaid)` for internal actions.

**Solution**:
1. Dashboard overview text changed to neutral: "Configure runner packages, Adaptive Memory, Teams and Review & Install."
2. Packages detail text changed: removed "Mermaid support is automatic."
3. `capability-plan.ts` `addInternalRunnerSupportActions()` validation action now uses neutral title "Validate visual explanation support" and neutral description "Visual explanation support is required and already satisfied." / "Could not verify visual explanation support — review data is not available."
4. `capability-plan.ts` validation action no longer sets `implementationId: "pi-mermaid"` (field is absent on the action, not just hidden in rendering).
5. `ActionGroup` in `pi-runner-dashboard-screens.tsx` now checks `isInternalAction()` to hide `implementationId` for internal actions (those with `internalPackageId`, or id starting with `internal.` or `capability.runner-mermaid`).
6. `npm:pi-mermaid` remains in the action's `source` field and in diagnostics for technical troubleshooting purposes — it does not appear in rendered user-facing text.

**Files Changed**
- `apps/cli/src/tui/screens/pi-runner-dashboard-screens.tsx` — neutral overview and packages text; `ActionGroup` hides `implementationId` for internal actions
- `packages/adapter-pi/src/capability-plan.ts` — validation action uses neutral title/description; `implementationId` not set; install action has `internalPackageId`
- `apps/cli/src/tui/pi-runner-dashboard/render.test.tsx` — updated assertions for neutral copy

---

### Fix #3: MINOR — Fixed `PI_INSTALLABLE_TOOLS` boundary type assertion

**Problem**: The original type assertion `typeof PI_INSTALLABLE_TOOLS[number]["id"] extends "pi-mermaid" ? never : true` remains `true` for a union containing both existing IDs and `pi-mermaid` — it only fails if the entire union extends `pi-mermaid`.

**Solution**: Changed to `Extract<(typeof PI_INSTALLABLE_TOOLS)[number]["id"], "pi-mermaid"> extends never ? true : never`. This correctly extracts whether `"pi-mermaid"` is a member of the union. If `pi-mermaid` is ever added to `PI_INSTALLABLE_TOOLS`, the compile-time type check will fail, producing a TypeScript error that prevents the build.

**Files Changed**
- `packages/adapter-pi/src/installation-plan.ts` — updated `_AssertInternalBoundary` type assertion

---

### Fix #4: (deferred-feasible) — Absent review data → not-checked instead of missing

**Problem**: When `review` was `undefined`, `detectInternalRunnerPackageStatus` returned `status: "missing"`, causing an automatic install action to be planned without evidence. Review data being absent should surface validation feedback, not assume the package is missing.

**Solution**:
1. `detectInternalRunnerPackageStatus` now returns `status: "not-checked"` with diagnostic `"${pkg.name} could not be verified — review data is not available."` when `review === undefined`.
2. `isInstallableStatus("not-checked")` returns `false` — absent review data is not treated as installable.
3. `getInternalRunnerPackageInstallAction` returns `undefined` for `"not-checked"` status (no install action scheduled).
4. `getInternalPackageStatusFeedback("not-checked")` returns `"Visual explanation support: could not verify"`.
5. `addInternalRunnerSupportActions` generates a validation feedback action (no install action) for `not-checked` status.

**Files Changed**
- `packages/adapter-pi/src/internal-runner-packages.ts` — `detectInternalRunnerPackageStatus`, `isInstallableStatus`, `getInternalRunnerPackageInstallAction`, `getInternalPackageStatusFeedback` updated
- `packages/adapter-pi/src/capability-plan.ts` — `addInternalRunnerSupportActions` handles `not-checked` via the same branch as `ready` (validation feedback only)
- `packages/adapter-pi/src/internal-runner-packages.test.ts` — updated test to assert `not-checked` for undefined review; updated `isInstallableStatus` test case; updated feedback test

---

## Original Task Completion Summary (Tasks 1–10)

### Task 1: Create visual explanations skill content
- **Owner**: General Apply
- **Status**: ✅ Complete
- **Files**: `packages/core/src/teams/developer/visual-explanations-content.ts` — created

### Task 2: Compose visual skill into Orchestrator content registry
- **Owner**: General Apply
- **Status**: ✅ Complete
- **Files**: `packages/core/src/teams/developer/content-registry.ts`, `content-registry.test.ts`, `developer-team-install.test.ts` — modified

### Task 3: Create internal runner packages module
- **Owner**: Backend Apply
- **Status**: ✅ Complete
- **Files**: `packages/adapter-pi/src/internal-runner-packages.ts`, `internal-runner-packages.test.ts` — created

### Task 4: Update capability-catalog and capability-inventory
- **Owner**: Backend Apply
- **Status**: ✅ Complete
- **Files**: `packages/adapter-pi/src/capability-catalog.ts`, `capability-inventory.ts`, `.test.ts` files — modified

### Task 5: Update capability-plan for silent internal support
- **Owner**: Backend Apply
- **Status**: ✅ Complete
- **Files**: `packages/adapter-pi/src/capability-plan.ts`, `capability-plan.test.ts` — modified

### Task 6: Update installation-plan, install-tools, and adapter-pi exports
- **Owner**: Backend Apply
- **Status**: ✅ Complete
- **Files**: `packages/adapter-pi/src/installation-plan.ts`, `install-tools.ts`, `index.ts`, `.test.ts` files — modified

### Task 7: Backend adapter-pi and opencode developer-team install tests
- **Owner**: Frontend Apply
- **Status**: ✅ Complete
- **Files**: `packages/adapter-opencode/src/developer-team-install.test.ts` — modified

### Task 8: Restructure dashboard state and selectors
- **Owner**: Frontend Apply
- **Status**: ✅ Complete
- **Files**: `apps/cli/src/tui/pi-runner-dashboard/state.ts`, `selectors.ts`, `input-handler.test.ts`, `reducer.test.ts` — modified

### Task 9: Update dashboard screens and action runner
- **Owner**: Frontend Apply
- **Status**: ✅ Complete
- **Files**: `apps/cli/src/tui/screens/pi-runner-dashboard-screens.tsx`, `render.test.tsx`, `app.tsx` — modified

### Task 10: Frontend dashboard integration tests
- **Owner**: Frontend Apply
- **Status**: ✅ Complete
- **Files**: `apps/cli/src/tui/pi-runner-dashboard/render.test.tsx`, `input-handler.test.ts`, `reducer.test.ts` — modified

---

## Verification

### Targeted and Relevant Tests
- `bun test packages/adapter-pi/src/ apps/cli/src/tui/pi-runner-dashboard/ apps/cli/src/tui/screens/pi-runner-dashboard-screens.tsx packages/core/src/teams/developer/content-registry.test.ts packages/adapter-opencode/src/developer-team-install.test.ts` — **395 pass, 0 fail, 2026 assertions** across 24 files.

### Full Suite and Typecheck
- `bunx tsc --noEmit` — **PASS** (no errors).

---

## Blockers

None. All verify/review findings are resolved.

---

## Registry Updates

- `state.yaml`: Updated `apply` phase provenance with General Apply fix entry.
- `events.yaml`: Appended `apply.general.verify-review-fixes.completed` event with fix details and test results.