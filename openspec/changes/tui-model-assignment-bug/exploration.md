# Exploration: TUI Model Assignment Bug

## Goal
Investigate why model assignments selected in the Developer Team TUI dashboard are not being applied during installation.

## Current State

The Deck CLI TUI (`apps/cli/src/tui/app.tsx`) has a dashboard flow (`pi-runner-dashboard`) where users can select the Developer Team and configure per-agent model assignments. The model configuration updates local React state (`modelAssignments`, `thinkingAssignments`) and is synced into the dashboard state via `syncDashboardDeveloperTeamModelConfig()`. When the user proceeds to Review & Install, `buildPiRunnerReviewPlan` (or `buildOpenCodeRunnerReviewPlan`) generates an `apply-team-bundle` action. The action runner (`action-runner.ts`) handles this action via `applyTeamBundleAction`, which delegates to an adapter-specific `installTeamBundle` function.

## Root Cause

The bug is a **systematic omission** in the action-runner's team-bundle interface: `TeamBundleInstallerFn` does not accept `modelAssignments` or `thinkingAssignments`, and `applyTeamBundleAction` never passes them. This causes model assignments to be lost at the boundary between the TUI state and the adapter install functions.

There are **three related defects**:

### Defect 1 — Pi path: `installTeamBundle` is `undefined`
**File**: `apps/cli/src/tui/app.tsx`  
**Lines**: 561–575

In the dashboard install effect, the `installTeamBundle` dependency is only provided for OpenCode:
```typescript
installTeamBundle: isOpenCode ? async (...) => { ... } : undefined,
```
For Pi, it is `undefined`. When `runRunnerReviewPlan` executes the `apply-team-bundle` action, `applyTeamBundleAction` finds `installer` is missing and returns a **skipped** result. The Developer Team bundle is never installed at all during Pi dashboard Review & Install.

### Defect 2 — `TeamBundleInstallerFn` type lacks model assignment parameters
**File**: `apps/cli/src/tui/pi-runner-dashboard/action-runner.ts`  
**Lines**: 34–37

The type signature only accepts `projectRoot` and an optional `memoryProvider`:
```typescript
export type TeamBundleInstallerFn = (
  projectRoot: string,
  options?: { memoryProvider?: AdaptiveMemoryProvider },
) => Promise<{ results: Array<{ agentId: string; kind: string; status: string }> }>;
```
There is no `modelAssignments` or `thinkingAssignments` parameter. Even if an `installTeamBundle` were provided (as it is for OpenCode), the assignments cannot be forwarded.

### Defect 3 — OpenCode `installTeamBundle` ignores dashboard model assignments
**File**: `apps/cli/src/tui/app.tsx`  
**Lines**: 561–575

The OpenCode lambda builds the install plan but does **not** pass the dashboard's `modelAssignments` or `thinkingAssignments`:
```typescript
const plan = buildOpenCodeDeveloperTeamInstallPlan(projectRoot, {
  ...(options?.memoryProvider ? { memoryProvider: options.memoryProvider } : {}),
  capabilityInstructions,
  standaloneSkills,
});
```
It should include `configModelOverrides: modelAssignments` and `reasoningEffortOverrides: thinkingAssignments`, but these are omitted.

### Additional related issue — Pi model config finish does not persist to disk
**File**: `apps/cli/src/tui/app.tsx`  
**Lines**: 1098–1101

When finishing model configuration from the dashboard (`modelConfigSource === "dashboard"`), the code explicitly calls `applyDeveloperTeamModelConfig()` only for OpenCode:
```typescript
if (modelConfigRuntime === "opencode") {
  applyDeveloperTeamModelConfig();
}
syncDashboardDeveloperTeamModelConfig();
```
For Pi, only `syncDashboardDeveloperTeamModelConfig()` runs, which updates dashboard state but does **not** write the assignments to disk. The comment even notes that OpenCode needs immediate persistence because "the dashboard plan builder has no team-application actions" — yet the Pi path also cannot rely on the review-plan team action because `installTeamBundle` is missing.

## Relevant Files

- `apps/cli/src/tui/app.tsx` — Main TUI app; wires `installTeamBundle` for dashboard install effect and handles model config finish
- `apps/cli/src/tui/pi-runner-dashboard/action-runner.ts` — Action runner; defines `TeamBundleInstallerFn` and `applyTeamBundleAction`
- `packages/adapter-pi/src/runner-capabilities.ts` — Pi runner capabilities; `buildTeamInstallPlanFromInput` accepts model assignments but the dashboard path never reaches it
- `packages/adapter-pi/src/developer-team-install.ts` — `buildDeveloperTeamInstallPlan` correctly consumes `modelAssignments`/`thinkingAssignments` when provided
- `packages/adapter-opencode/src/developer-team-install.ts` — `buildOpenCodeDeveloperTeamInstallPlan` accepts `configModelOverrides`/`reasoningEffortOverrides` when provided
- `packages/adapter-pi/src/capability-plan.ts` — `buildPiRunnerReviewPlan` generates the `apply-team-bundle` action but carries no model payload

## Constraints

- The fix must keep the runtime-agnostic design of `action-runner.ts` (works for Pi, OpenCode, and future runners).
- The `RunnerActionRunnerDependencies` interface includes backward-compatible aliases (`buildDeveloperTeamInstallPlan`, `applyDeveloperTeamInstall`) that are currently unused by `applyTeamBundleAction`; any refactor should decide whether to use these or remove them.
- OpenCode's `buildOpenCodeDeveloperTeamInstallPlan` expects `configModelOverrides` and `reasoningEffortOverrides`; Pi's `buildDeveloperTeamInstallPlan` expects `modelAssignments` and `thinkingAssignments`. The dashboard runner must map correctly.

## Risks

- **Risk**: Changing `TeamBundleInstallerFn` is a breaking type change. All test mocks that implement this type will need updating.
- **Risk**: The Pi dashboard path currently skips team installation entirely. Fixing it by adding an `installTeamBundle` implementation means the Pi dashboard will now actually install Developer Team files, which could surprise users who expected it to be a no-op.
- **Risk**: There are tests in `action-runner.test.ts` that pass `buildDeveloperTeamInstallPlan`/`applyDeveloperTeamInstall` as dependencies and expect them to be called (lines 163–170). If these tests are passing, there may be another call path not visible in the current source, or the tests may be relying on mock behavior that doesn't match production.

## Options and Tradeoffs

### Option A — Add model parameters to `TeamBundleInstallerFn` and implement Pi `installTeamBundle`
- **Description**: Expand `TeamBundleInstallerFn` to accept `modelAssignments` and `thinkingAssignments`. Implement a Pi lambda in `app.tsx` that calls `buildDeveloperTeamInstallPlan` + `applyDeveloperTeamInstall` with the assignments.
- **Pros**: Keeps the abstraction layer clean; both runners use the same action-runner path.
- **Cons**: Requires updating the type, the action runner, and both OpenCode/Pi lambdas in `app.tsx`.
- **Effort**: Medium

### Option B — Use `buildDeveloperTeamInstallPlan`/`applyDeveloperTeamInstall` fallback in `applyTeamBundleAction`
- **Description**: When `installTeamBundle` is missing, fall back to the existing `buildDeveloperTeamInstallPlan` and `applyDeveloperTeamInstall` dependencies. Update their dependency type signatures to accept model assignments.
- **Pros**: Minimal changes to `app.tsx`; leverages existing backward-compatible dependency aliases.
- **Cons**: The fallback logic is implicit and could be confusing. Still requires type updates.
- **Effort**: Low-Medium

### Option C — Persist Pi models immediately on finish (like OpenCode)
- **Description**: In `app.tsx`, call `applyDeveloperTeamModelConfig()` for Pi too when `modelConfigSource === "dashboard"`, instead of relying on the review-plan team action.
- **Pros**: Very small change; mirrors the existing OpenCode workaround.
- **Cons**: Diverges from the intended "review plan" architecture. Models would be written before the user clicks "Run install", which could be unexpected.
- **Effort**: Low

## Recommendation

**Recommended: Option A** with a hybrid of Option C as a short-term mitigation.

- **Short-term**: Apply Option C (call `applyDeveloperTeamModelConfig()` for Pi on finish) to immediately unblock users. This is a one-line change in `app.tsx`.
- **Medium-term**: Implement Option A fully:
  1. Update `TeamBundleInstallerFn` to accept `{ memoryProvider?, modelAssignments?, thinkingAssignments? }`.
  2. Update `applyTeamBundleAction` to pass these options.
  3. Implement Pi `installTeamBundle` in `app.tsx` (or extract a shared helper).
  4. Update OpenCode `installTeamBundle` to pass the assignments.
  5. Remove or repurpose the unused `buildDeveloperTeamInstallPlan`/`applyDeveloperTeamInstall` dependency aliases.

This fixes the structural bug while unblocking users immediately.

## Open Questions

1. Why do the `action-runner.test.ts` tests (lines 146–183) expect `buildDeveloperTeamInstallPlan` and `applyDeveloperTeamInstall` to be called when `applyTeamBundleAction` does not use them? Are these tests currently passing or failing?
2. Should the `buildDeveloperTeamInstallPlan`/`applyDeveloperTeamInstall` backward-compatible aliases in `RunnerActionRunnerDependencies` be removed, or should `applyTeamBundleAction` be refactored to use them as a fallback?

## Ready for Proposal
**Yes** — the root cause is well understood and the fix path is clear. A proposal should scope the short-term mitigation (Option C) and the proper structural fix (Option A).
