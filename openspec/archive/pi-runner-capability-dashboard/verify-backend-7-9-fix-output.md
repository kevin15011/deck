# Verify Report: pi-runner-capability-dashboard — Backend Tasks 7-9 Fix

## Summary

**Overall Result**: PASS WITH WARNINGS  
**Scope**: Backend Tasks 7-9 fix re-check  
**Registry Mode**: deferred; `state.yaml` and `events.yaml` were read and not modified.  
**Tasks Complete**: 3 / 3 in scope  
**Tests**: 720 / 720 workspace tests passed; targeted Backend 7-9 subset 70 / 70 passed  
**Build**: ⚠️ WARN — root `build` script is absent (`error: Script not found "build"`)  
**Typecheck**: ✅ PASS — `bunx tsc --noEmit --pretty false`

## Task Completion

| Task | Status | Owner |
|---|---|---|
| Task 7: Modificar install-tools.ts — alinear acciones manuales con semántica del Review Plan | ✅ Complete | Backend Apply |
| Task 8: Modificar developer-team-install.ts — consumir provider de Adaptive Memory desde dashboard | ✅ Complete | Backend Apply |
| Task 9: Modificar pi-launch-command.ts — compartir resolución de provider con TUI | ✅ Complete | Backend Apply |

Out of scope: Tasks 13-19 remain pending in `apply-progress.md` and are not counted for this Backend Tasks 7-9 fix re-check.

## Test Results

| Test Suite | Pass | Fail | Skip | Command / Details |
|---|---:|---:|---:|---|
| Targeted Backend 7-9 tests | 70 | 0 | 0 | `bun test packages/adapter-pi/src/install-tools.test.ts packages/adapter-pi/src/developer-team-install.test.ts apps/cli/src/pi-launch-command.test.ts apps/cli/src/pi-launch-command.supermemory.test.ts apps/cli/src/pi-launch-command.direct-supermemory.test.ts packages/adapter-supermemory/src/index.test.ts` |
| Workspace tests | 720 | 0 | 0 | `bun test` |

## Build / Typecheck

| Check | Result | Details |
|---|---|---|
| Build | ⚠️ WARN | `bun run build` exits with `error: Script not found "build"`; `package.json` has `deck` and `test` scripts only. This matches prior verification warnings and is not a scoped implementation regression. |
| Typecheck | ✅ PASS | `bunx tsc --noEmit --pretty false` completed with no output/errors. |

## Compliance Matrix

| Requirement / Scenario / Fix | Method | Result | Notes |
|---|---|---|---|
| Review MAJOR: direct dashboard `activeProvider: "supermemory"` must use safe validation and reject secret-shaped fields | Code inspection + targeted tests | ✅ PASS | `resolveActiveProviderInput` wraps direct dashboard input in `validateDeckConfig`; direct test rejects `apiKey` and confirms diagnostic does not leak the sentinel token. |
| Review MAJOR: direct dashboard `activeProvider: "supermemory"` must reject unknown fields | Code inspection + targeted tests | ✅ PASS | Direct test rejects `extraField` with `Unknown Deck config field: adaptiveMemory.supermemory.extraField` and avoids memory injection. |
| Review MAJOR: invalid Supermemory tags must not crash; fail closed without adaptive-memory injection | Code inspection + targeted tests | ✅ PASS | `createSupermemoryMemoryProvider(...)` is inside `try/catch`; direct invalid tag test returns `ready` with `memory_provider_unavailable`, no Supermemory prompt/agent injection. |
| Review MAJOR: unavailable/fail-closed diagnostics must be redacted | Targeted tests | ✅ PASS | Direct and existing Supermemory tests assert sentinel token and `x-supermemory-api-key` are absent from diagnostics/materialized files. |
| Review MAJOR: Engram/Supermemory provider construction protected by `try/catch` | Code inspection | ✅ PASS | `activeProvider === "engram"` and `activeProvider === "supermemory"` construction branches both catch and return `memory_provider_unavailable`. |
| Review NIT: direct resolver regression tests added | File inspection + targeted tests | ✅ PASS | `apps/cli/src/pi-launch-command.direct-supermemory.test.ts` covers invalid tags, secret fields, and unknown fields; targeted suite passes. |
| Review MINOR: external tools in `installPiTools` return manual even when `command` is undefined | Code inspection + targeted tests | ✅ PASS | External branch runs before the missing-command guard; test `returns manual external result when install command is unavailable` passes. |
| Review MINOR: pi-package command guard remains correct | Code inspection + targeted tests | ✅ PASS | For `pi-package` with undefined command, result is `status: "failed"`, `actionKind: "install-pi-package"`, message `Pi install command is unavailable.` |
| Task 7 verification: external tools produce `manual-external-install`, not generic failed installs | Targeted tests | ✅ PASS | `install-tools.test.ts` verifies RTK manual result and no `pi install` execution. |
| Task 8 verification: dashboard/resolved provider can be consumed by Developer Team install while preserving model/thinking behavior | Targeted tests | ✅ PASS | `developer-team-install.test.ts` and `pi-launch-command.test.ts` pass; existing model/thinking preservation tests pass. |
| Task 9 verification: shared provider resolver supports launch/TUI Supermemory validation and construction consistently | Code inspection + targeted tests | ✅ PASS | `resolvePiAdaptiveMemoryProvider` is exported and used by `runPiLaunch`; Supermemory `.deck/config.json` and direct dashboard paths are covered. |
| REQ-MEM-006: Supermemory config remains non-secret in Deck/dashboard path | Code inspection + targeted tests | ✅ PASS | `validateDeckConfig` rejects secret-shaped keys recursively; diagnostics and materialized files are redacted in tests. |
| REQ-GCAP-004 / Review Plan manual semantics: non-automatic external capability steps are manual | Code inspection + targeted tests | ✅ PASS | `installPiTools` returns `status: "manual"` for external tools and does not require `piCommand`. |

## Findings

### CRITICAL

None.

### WARNING

- Root build check cannot pass because the workspace has no `build` script. Reproduction: run `bun run build`; output: `error: Script not found "build"`. This is a project-script availability warning, not a Backend Tasks 7-9 fix failure.

### SUGGESTION

None.

## Open Questions

None.

## Registry Intent (Deferred)

- **Registry Write**: deferred
- **Intended phase**: `verify`
- **Intended status**: `passed_with_warnings`
- **Intended event**: `verify.backend_tasks_7_9_fix.passed_with_warnings`
- **Intended artifact**: `verify-backend-7-9-fix-output.md`
- **Registry Blocker**: none
