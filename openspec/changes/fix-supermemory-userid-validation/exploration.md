# Exploration: Supermemory userId validation contradicts token-only contract

## Goal
Identify why `Supermemory configuration requires an explicit userId.` persists after token-only contract changes, and trace the exact code path.

## Outcome
**Root cause found.** Two validation guards in `packages/core/src/config/deck-config.ts` were never updated to match the token-only contract. The type definition says `userId?: never` (deprecated) but the validation still REQUIRES it.

## Evidence

### Error literal locations (exact)
1. `packages/core/src/config/deck-config.ts:488` — `normalizeAdaptiveMemoryConfig()`
2. `packages/core/src/config/deck-config.ts:454` — `buildResolution()`
3. `packages/core/src/config/deck-config.ts:820` — `normalizeOptionalString()` (only when userId is explicitly invalid, e.g. `""` or `123`)

### Error code: `SUPERMEMORY_USER_ID_REQUIRED`
Defined at `deck-config.ts:155`. Referenced 7 times (2 throw sites, 3 test assertions, 1 field-path branch, 1 type union).

### Type definition contradicts validation
```typescript
// deck-config.ts:30-43 — DeckSupermemoryConfig
userId?: never;    // @deprecated - user identity derived from token automatically
projectId?: never;
teamId?: never;
orgId?: never;
```
But validation at line 486:
```typescript
if (activeProvider === "supermemory" && !hasNonEmptyString(supermemory?.userId)) {
  throw new DeckConfigError("SUPERMEMORY_USER_ID_REQUIRED", ...);
}
```

### TUI Install Call Path (confirmed by `/tmp/deck-tui.log` line 84)
```
TUI install-progress screen
  → runDashboardInstall()
    → runRunnerReviewPlan()                           [action-runner.ts:116]
      → runAndRecord(adaptive-memory.supermemory.deck-config)
        → runRunnerAction(action, kind="write-deck-config")  [action-runner.ts:188]
          → writeDeckConfigAction(action, deps)              [action-runner.ts:360]
            → constructs config with userId: supermemory?.userId  [line 411]
               (undefined for token-only flow)
            → writer(projectRoot, config)                     [line 426]
              → writeDeckConfig()                             [deck-config.ts:355]
                → validateDeckConfig(config)                  [line 357]
                  → normalizeAdaptiveMemoryConfig()           [line 384]
                    → THROWS SUPERMEMORY_USER_ID_REQUIRED     [line 486]
          → catch block returns { status: "failed" }          [action-runner.ts:221]
```

TUI log confirms:
```
19:25:47.430 [action-runner] runRunnerAction: adaptive-memory.supermemory.deck-config kind=write-deck-config status=ready
19:25:47.433 [action-runner] runRunnerReviewPlan: configWrite adaptive-memory.supermemory.deck-config result=failed
```

### Secondary path (PI/OpenCode launch — not yet triggered but would also fail)
```
pi-launch-command.ts / opencode-launch-command.ts
  → resolveActiveMemoryProvider()                     [deck-config.ts:417]
    → buildResolution()                               [deck-config.ts:444]
      → THROWS SUPERMEMORY_USER_ID_REQUIRED           [line 452]
```

### Previously fixed guards (confirmed working)
- R11: `getRunnerReviewPlanRunBlockDiagnostics()` in action-runner.ts — removed `!setup?.userId` check
- R14: `capability-plan.ts` (opencode) — removed `supermemory.userId` check
- R15: `capability-plan.ts` (pi) — removed `supermemory.userId` check
- R16: `pi-launch-command.ts` — guards changed from `!supermemory?.userId` to `!supermemory?.configured`

### What was missed
The core config validation layer in `packages/core/src/config/deck-config.ts` was never updated. Both `normalizeAdaptiveMemoryConfig()` and `buildResolution()` still enforce userId.

## Root Cause (file/function/line)

| # | File | Function | Line | Issue |
|---|------|----------|------|-------|
| 1 | `packages/core/src/config/deck-config.ts` | `normalizeAdaptiveMemoryConfig()` | 486-491 | Requires `hasNonEmptyString(supermemory?.userId)` for supermemory provider |
| 2 | `packages/core/src/config/deck-config.ts` | `buildResolution()` | 452-457 | Same guard, same error code |
| 3 | `packages/core/src/config/deck-config.ts` | `normalizeOptionalString()` | 820 | Special-cases userId fieldPath to SUPERMEMORY_USER_ID_REQUIRED |
| 4 | `packages/core/src/config/deck-config.ts` | `SUPERMEMORY_FIELDS` | 190-198 | Still lists userId, projectId, teamId, orgId as known fields (type says `never`) |
| 5 | `packages/core/src/config/deck-config.ts` | `normalizeSupermemoryConfig()` | 530-556 | Still normalizes deprecated fields |
| 6 | `apps/cli/src/tui/runner-dashboard/action-runner.ts` | `writeDeckConfigAction()` | 410-413 | Passes userId/teamId/orgId to config |
| 7 | `packages/adapter-opencode/src/runner-adapter.ts` | `buildReviewPlan()` | 254-256 | Passes userId/teamId/organizationId to state |

## Minimal Fix

### Core changes (packages/core/src/config/deck-config.ts)

1. **Remove guard in `normalizeAdaptiveMemoryConfig()`** (lines 486-492):
   Delete the `if (activeProvider === "supermemory" && !hasNonEmptyString(supermemory?.userId))` block entirely.

2. **Remove guard in `buildResolution()`** (lines 452-458):
   Delete the `if (!hasNonEmptyString(supermemory?.userId))` block entirely.

3. **Remove `SUPERMEMORY_USER_ID_REQUIRED` from error code union** (line 155).

4. **Remove special-case in `normalizeOptionalString()`** (line 820):
   Change to always use `"SUPERMEMORY_CONFIG_INVALID"` (or remove since these fields are `never`).

5. **Clean `SUPERMEMORY_FIELDS`** (line 190):
   Remove `userId`, `projectId`, `teamId`, `orgId` from the set.

6. **Remove normalization of deprecated fields** in `normalizeSupermemoryConfig()` (lines 530-556):
   Remove the userId, projectId, teamId, orgId normalization blocks.

### Downstream changes

7. **action-runner.ts** (line 410-413): Remove `userId`, `teamId`, `orgId` from config construction.

8. **runner-adapter.ts** (line 254-256): Remove `userId`, `teamId`, `organizationId` from state mapping.

## Tests to Update

| Test File | Line(s) | Current | Change |
|-----------|---------|---------|--------|
| `deck-config.test.ts` | 313-325 | `"requires userId when Supermemory is active"` — expects SUPERMEMORY_USER_ID_REQUIRED | Remove or invert: supermemory without userId should succeed |
| `deck-config.test.ts` | 327-339 | `"rejects empty userId when provided"` — expects SUPERMEMORY_USER_ID_REQUIRED | Remove: userId is `never`, providing it should error with UNKNOWN_FIELD |
| `deck-config.test.ts` | 687-702 | `"resolves CLI Supermemory only when non-secret config contains userId"` | Rewrite: supermemory should resolve WITHOUT userId |
| `deck-config.test.ts` | 308-310 | Expects userId/teamId/orgId in normalized config | Remove these assertions |
| `deck-config.test.ts` | 693 | Expects `valid.supermemory?.userId` to be "user-123" | Remove |
| `action-runner.test.ts` | 108, 186, 251, 319, 336 | Pass userId: "user-1" in test state | Remove userId from test fixtures |
| `capability-plan.test.ts` (pi) | 70, 86, 428, 450 | Reference userId in supermemory state | Remove userId from test fixtures |

### New tests to add

1. `validateDeckConfig({ activeProvider: "supermemory", supermemory: {} })` — should succeed (no userId required)
2. `validateDeckConfig({ activeProvider: "supermemory", supermemory: { userId: "u" } })` — should fail (userId is `never`, UNKNOWN_FIELD)
3. `resolveActiveMemoryProvider({ cliProvider: "supermemory", config: { version: 1, adaptiveMemory: { supermemory: {} } } })` — should succeed
4. `writeDeckConfigAction` with token-only supermemory state — should succeed, config should not contain userId
5. Verify config file written to disk does NOT contain userId/teamId/orgId fields

## Confidence Level
**HIGH (95%)**

- Literal found in exact locations, confirmed by logs
- Type says `never`, validation requires non-empty — direct contradiction
- Previously fixed guards (R11-R16) followed the same pattern
- The missed guards are in the core validation layer, not the TUI/adapter layers

## Blockers
None. All code is readable, tests are present, fix is mechanical.
