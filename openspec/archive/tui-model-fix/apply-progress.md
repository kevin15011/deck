# Apply Progress: Fix TUI Developer Team Model Assignment Persistence

## Completed Tasks

### Task SDD-MINOR-1: Type cleanup in installTeamBundle closure
**Status**: ✅ Complete
**Files Changed**
- `apps/cli/src/tui/app.tsx` — modify (lines 563, 571, 586, 590)

**Changes**
- OpenCode closure: `Record<string, string>` → `DeveloperTeamModelAssignments` / `DeveloperTeamThinkingAssignments` (imported from `@deck/adapter-pi`)
- Pi closure: same type upgrade, removed `as any` cast on `thinkingAssignments` option
- OpenCode `reasoningEffortOverrides` still requires cast since `DeveloperTeamThinkingAssignments` uses `PiThinkingLevel` but OpenCode expects `OpenCodeThinkingLevel` — cast to `Record<string, OpenCodeThinkingLevel>` inline

**Verification**
- Typecheck: ✅ pass (app.tsx has no errors; pre-existing test errors unrelated)
- Tests: ⚠️ 10 pre-existing test failures in action-runner.test.ts (unrelated to this change)

### Task SDD-MINOR-2: Add try/catch/rollback to Pi installTeamBundle
**Status**: ✅ Complete
**Files Changed**
- `apps/cli/src/tui/app.tsx` — modify (lines 594-605)

**Changes**
- Pi closure now wraps `applyDeveloperTeamInstall` / `verifyDeveloperTeamInstall` in try/catch
- On error or verify failure: `rollbackDeveloperTeamFiles(backup)` called before re-throwing
- Error is normalized to `Error` instance before re-throwing

**Verification**
- Typecheck: ✅ pass
- Tests: ⚠️ same pre-existing failures

## In-Progress Tasks
None — both MINOR issues resolved.

## Blocked Tasks
None.

## Remaining Tasks
- NIT (stale alias type in action-runner.ts line 76) — not assigned to General Apply; deferred.

## Notes
- OpenCode path does NOT get try/catch/rollback per review recommendation ("consider" — not required)
- Pre-existing test failures in action-runner.test.ts relate to `pi-mermaid` internal package routing, not this change
- The `as any` casts on lines 571, 590 were in the original; only the Pi path `as any` cast was removable since `thinkingAssignments` is now properly typed