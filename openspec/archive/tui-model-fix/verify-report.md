# Verify Report: TUI Model Assignment Fix (Re-check)

## Summary

**Overall Result**: PASS WITH WARNINGS  
**Tasks Complete**: 6 / 6 original implementation tasks; 2 / 2 minor apply tasks  
**Tests**: 3 / 12 targeted `action-runner.test.ts` tests passed; 9 failures are the known pre-existing failures called out for this re-check  
**Build**: N/A — no build script is defined  
**Typecheck**: PASS for modified files

## Task Completion

| Task | Status | Owner |
|---|---|---|
| Task 1: Add Pi dashboard Finish persistence | ✅ Complete | General Apply |
| Task 2: Extend `TeamBundleInstallerFn` type | ✅ Complete | General Apply |
| Task 3: Forward assignments in `applyTeamBundleAction` | ✅ Complete | General Apply |
| Task 4: Implement Pi `installTeamBundle` closure | ✅ Complete | General Apply |
| Task 5: Forward OpenCode assignments | ✅ Complete | General Apply |
| Task 6: Update `action-runner.test.ts` coverage | ⚠️ Complete by implementation; targeted suite still has known pre-existing failures | General Apply |
| SDD-MINOR-1: Type cleanup in `installTeamBundle` closure | ✅ Complete | General Apply |
| SDD-MINOR-2: Add try/catch/rollback to Pi `installTeamBundle` | ✅ Complete | General Apply |

## Test Results

| Test Suite | Pass | Fail | Skip |
|---|---:|---:|---:|
| `bun test ./apps/cli/src/tui/pi-runner-dashboard/action-runner.test.ts` | 3 | 9 | 0 |

Known failures observed in the targeted suite include Supermemory safety assertions, the Developer Team model preservation test, and internal `pi-mermaid` package routing tests. These are the pre-existing 9 failures requested to be noted for this re-check.

## Build / Typecheck

| Check | Result | Details |
|---|---|---|
| Build | N/A | Root project does not define a build script for this verification path. |
| Modified-file typecheck | ✅ PASS | `bunx tsc --noEmit --ignoreConfig --target ES2022 --module ESNext --moduleResolution Bundler --jsx react-jsx --strict --skipLibCheck --types bun apps/cli/src/tui/app.tsx apps/cli/src/tui/pi-runner-dashboard/action-runner.ts` exited 0. |
| Targeted tests | ⚠️ WARN | `action-runner.test.ts` still exits 1 with the known 9 failures; no additional failures were observed beyond the expected count. |

## Compliance Matrix

| REQ-ID / Scenario | Method | Result | Notes |
|---|---|---|---|
| REQ-PMP-001 | Code inspection | ✅ PASS | `agent-model-config-list` Finish handler calls `applyDeveloperTeamModelConfig()` for both `opencode` and `pi`. |
| REQ-PMP-002 | Code inspection | ✅ PASS | Pi persistence path uses the current `modelAssignments` and `thinkingAssignments` when building the install plan. |
| REQ-PMP-003 | Code inspection | ✅ PASS | Pi persistence path and Pi `installTeamBundle` path include rollback behavior on failure. |
| REQ-PMP-004 | Code inspection | ✅ PASS | OpenCode dashboard and install-source branches remain present. |
| REQ-ABA-001 | Code inspection + typecheck | ✅ PASS | `TeamBundleInstallerFn` options include optional `modelAssignments?: DeveloperTeamModelAssignments` and `thinkingAssignments?: DeveloperTeamThinkingAssignments`. |
| REQ-ABA-002 | Code inspection | ✅ PASS | `applyTeamBundleAction` reads Developer Team assignments from dashboard state and forwards them to `installTeamBundle`. |
| REQ-ABA-003 | Typecheck + code inspection | ✅ PASS | Options remain optional; no-options and memory-provider-only callers remain compatible. |
| REQ-PIB-001 | Code inspection | ✅ PASS | Pi dashboard now supplies an `installTeamBundle` closure. |
| REQ-PIB-002 | Code inspection | ✅ PASS | Pi closure builds, applies, verifies, and rolls back/throws on failure. |
| REQ-PIB-003 | Code inspection | ✅ PASS | OpenCode closure forwards assignments as model/reasoning overrides. |
| Phase 1 checklist: Pi dashboard model config persists on Finish | Code inspection | ✅ PASS | Finish path invokes Pi persistence before dashboard sync/reset. |
| Phase 2 checklist: type cleanup | Code inspection + typecheck | ✅ PASS | `installTeamBundle` closures use `DeveloperTeamModelAssignments` / `DeveloperTeamThinkingAssignments`. |
| Phase 2 checklist: Pi try/catch/rollback | Code inspection | ✅ PASS | Pi `installTeamBundle` wraps apply/verify in try/catch and calls rollback before rethrow. |

## Findings

### CRITICAL

None.

### WARNING

- The targeted `action-runner.test.ts` suite still fails 9 tests. This matches the pre-existing failure count supplied for the re-check; no new targeted typecheck errors were introduced.
- Build verification was not run because no project build script is defined for this verification path.

### SUGGESTION

- When the pre-existing `action-runner.test.ts` failures are next addressed, update the model-preservation test to assert the current `installTeamBundle` contract directly.

## Open Questions

None.
