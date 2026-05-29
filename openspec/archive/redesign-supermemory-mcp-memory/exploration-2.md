# Exploration: TUI "Review & Install blocked" after token-only repair

## Goal

Find why TUI still blocks Review & Install with "Supermemory setup is complete" after R3/R10 token-only repair.

## Root Cause

**3 separate guards still require `userId`** in `action-runner.ts` and `runner-dashboard-screens.tsx`, but `buildDashboardSupermemorySetupUpdate()` (app.tsx:273-296) no longer writes `userId` to state.

### Guard 1 (BLOCKING — direct cause of the error)
- **File**: `apps/cli/src/tui/runner-dashboard/action-runner.ts:110`
- **Condition**: `if (!setup?.userId) diagnostics.push("Supermemory userId is required before Review & Install.")`
- **Path**: `runRunnerReviewPlan()` → `getRunnerReviewPlanRunBlockDiagnostics()` → blocks with `"Review & Install is blocked until Supermemory setup is complete."`
- **Current behavior**: `buildDashboardSupermemorySetupUpdate` returns `{ configured: true, hasToken: true, diagnostics: [...] }` with NO `userId` field → guard fails.

### Guard 2 (BLOCKING — team bundle resolution)
- **File**: `apps/cli/src/tui/runner-dashboard/action-runner.ts:683`
- **Condition**: `if (!setup?.configured || !setup?.userId)`
- **Effect**: Returns `blocker: { status: "failed", message: "Supermemory userId and configuration are required before team bundle installation." }`

### Guard 3 (BLOCKING — canRunPlanFromState in screens)
- **File**: `apps/cli/src/tui/screens/runner-dashboard-screens.tsx:77`
- **Condition**: `return Boolean(setup?.configured && setup?.userId && setup?.hasToken)`
- **Effect**: Review Plan screen disables the "Run" button.

### Guard 4 (stale message in input-handler)
- **File**: `apps/cli/src/tui/runner-dashboard/input-handler.ts:114`
- **Message**: `"Supermemory requires userId and ephemeral token captured before executing Review & Install."`
- **Effect**: Stale wording — says "userId" which contradicts token-only contract.

### Guard 5 (config write still passes userId)
- **File**: `apps/cli/src/tui/runner-dashboard/action-runner.ts:412-414`
- **Code**: `userId: supermemory?.userId, teamId: supermemory?.teamId, orgId: supermemory?.organizationId`
- **Effect**: Config written with `undefined` values for userId/teamId/orgId.

## Type Divergence

Two DIFFERENT `SupermemorySetupValues` types coexist:

| File | Definition |
|------|-----------|
| `screens/developer-team-screens.tsx:92-101` | `{ token: string; userId?: never; teamId?: never; orgId?: never }` — token-only |
| `runner-dashboard/state.ts:32-37` | `{ userId?: string; teamId?: string; organizationId?: string; hasToken?: boolean }` — old |

The `state.ts` type is what `action-runner.ts`, `reducer.ts`, and selectors use. The screens type is only used by `app.tsx` UI. They are structurally incompatible.

## State Flow (current, broken)

1. User enters token in TUI
2. `app.tsx:persistDashboardSupermemorySelection()` calls `buildDashboardSupermemorySetupUpdate(values)`
3. Returns `{ configured: true, hasToken: true, diagnostics: [...] }` — **NO userId**
4. Reducer merges into state: `SupermemorySetupState = { configured: true, hasToken: true, userId: undefined, ... }`
5. User clicks Review & Install
6. `getRunnerReviewPlanRunBlockDiagnostics()` checks `!setup?.userId` → **FAIL**
7. Returns `"Review & Install is blocked until Supermemory setup is complete."`

## Minimal Fix

### Fix 1: Remove userId guard in `action-runner.ts:110`
```
// REMOVE this line:
if (!setup?.userId) diagnostics.push("Supermemory userId is required before Review & Install.");
```

### Fix 2: Remove userId check in `action-runner.ts:683`
```typescript
// BEFORE:
if (!setup?.configured || !setup?.userId) {
// AFTER:
if (!setup?.configured) {
```

### Fix 3: Remove userId from `runner-dashboard-screens.tsx:77`
```typescript
// BEFORE:
return Boolean(setup?.configured && setup?.userId && setup?.hasToken);
// AFTER:
return Boolean(setup?.configured && setup?.hasToken);
```

### Fix 4: Update message in `input-handler.ts:114`
```typescript
// BEFORE:
"Supermemory requires userId and ephemeral token captured before executing Review & Install."
// AFTER:
"Supermemory requires token before executing Review & Install."
```

### Fix 5: Update `state.ts:32-37` SupermemorySetupValues
```typescript
// Remove userId, teamId, organizationId or mark them optional/deprecated
export type SupermemorySetupValues = {
  /** @deprecated - derived from token */
  userId?: string;
  /** @deprecated - not used */
  teamId?: string;
  /** @deprecated - not used */
  organizationId?: string;
  hasToken?: boolean;
};
```

### Fix 6: Remove userId/teamId/orgId from config write `action-runner.ts:412-414`
```typescript
supermemory: {
  // userId/teamId/orgId no longer written — scoping is automatic
},
```

## Tests Requiring Update

| File | Line(s) | Issue |
|------|---------|-------|
| `action-runner.test.ts:65` | Expects `diagnostics.join(" ").toContain("userId")` | Must NOT expect userId diagnostic |
| `action-runner.test.ts:89-101` | Passes `userId: "user-1"` to `buildDashboardSupermemorySetupUpdate` | Type allows it (old state.ts) but screen type forbids it (never) |
| `action-runner.test.ts:111-113` | Passes `userId/teamId/orgId` | Same type divergence |
| `action-runner.test.ts:189,254,322,339` | State includes `userId: "user-1"` | Must remove userId from test fixtures |
| `reducer.test.ts:155,158` | Passes/asserts `userId: "user-1"` | Must remove userId |
| `input-handler.test.ts:67` | Expects stale message mentioning "userId" | Update expected message |

## Risks

1. **Config backward compat**: Existing `.deck/config.json` files with `userId` field → config validator in `deck-config.ts` still validates `userId` fields. Removal from config write may cause warnings on existing configs.
2. **Type divergence**: Two `SupermemorySetupValues` types with different semantics. Tests may pass because TypeScript allows the intersection, but runtime behavior differs.
3. **`canRunPlanFromState` vs `canRunDashboardPlan`**: Two different canRun checks. `app.tsx:1582` delegates to `getDashboardRunBlockDiagnostics` (already fixed), but `runner-dashboard-screens.tsx:77` has its own independent check (still broken). Both must be fixed.

## Open Questions

- Should `state.ts:SupermemorySetupValues` be unified with `screens/developer-team-screens.tsx:SupermemorySetupValues`?
- Should `deck-config.ts` validation (lines 532, 546, 553) remove userId/teamId/orgId as known fields?
