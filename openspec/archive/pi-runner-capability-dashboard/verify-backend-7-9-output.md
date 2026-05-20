# Verify Report: pi-runner-capability-dashboard — Backend Tasks 7-9

## Summary

**Overall Result**: PASS WITH WARNINGS  
**Scope**: Backend Apply Tasks 7-9 only  
**Tasks Complete**: 3 / 3 scoped tasks  
**Tests**: 716 / 716 workspace tests passed; 61 / 61 relevant tests passed  
**Build**: WARN / unavailable (`bun run build` exits 1 because root package has no `build` script)  
**Typecheck**: PASS (`bunx tsc --noEmit --pretty false`, exit 0)  
**Registry Write**: deferred per instruction; `state.yaml` and `events.yaml` were read, not modified.

## Task Completion

| Task | Status | Owner | Notes |
|---|---|---|---|
| Task 7: install-tools manual semantics | ✅ Complete | Backend Apply | `installPiTools` returns `actionKind: "manual-external-install"`, `status: "manual"` for external tools; Pi-package path still executes `pi install <source>`. |
| Task 8: developer-team-install dashboard memory provider | ✅ Complete | Backend Apply | `DeveloperTeamInstallOptions` accepts `dashboardMemoryProvider`; effective precedence verified as `memoryInjection` > `memoryProvider` > `dashboardMemoryProvider`; model/thinking tests pass. |
| Task 9: pi-launch-command shared provider resolution | ✅ Complete | Backend Apply | `resolvePiAdaptiveMemoryProvider` is exported and used by `runPiLaunch`; manual checks confirmed Engram/Supermemory construction via dashboard-style inputs, with Pi MCP validation for Supermemory. |

## Test Results

| Test Suite | Pass | Fail | Skip | Command |
|---|---:|---:|---:|---|
| Relevant backend/CLI tests | 61 | 0 | 0 | `bun test packages/adapter-pi/src/install-tools.test.ts packages/adapter-pi/src/developer-team-install.test.ts apps/cli/src/pi-launch-command.test.ts apps/cli/src/pi-launch-command.supermemory.test.ts` |
| Workspace tests | 716 | 0 | 0 | `bun test` |
| Manual helper smoke: Supermemory dashboard-style provider | 1 | 0 | 0 | `resolvePiAdaptiveMemoryProvider({ activeProvider: "supermemory", supermemory, piMcpConfigPath, unavailableContext: "install" })` |
| Manual helper smoke: Engram dashboard-style provider | 1 | 0 | 0 | `resolvePiAdaptiveMemoryProvider({ activeProvider: "engram", unavailableContext: "install" })` |
| Manual precedence smoke: dashboardMemoryProvider | 3 | 0 | 0 | `buildDeveloperTeamInstallPlan` with `dashboardMemoryProvider`, `memoryProvider`, and `memoryInjection` combinations |

## Build / Typecheck

| Check | Result | Details |
|---|---|---|
| Build | ⚠️ WARN | `bun run build` exits `1`: `error: Script not found "build"`. Root `package.json` only defines `deck` and `test`; this matches prior verify warnings and is not a scoped Tasks 7-9 implementation failure. |
| Typecheck | ✅ PASS | `bunx tsc --noEmit --pretty false` exits `0`. |

## Compliance Matrix

| REQ-ID / Scenario / Task | Method | Result | Notes |
|---|---|---|---|
| Task 7 — external tools return manual result, not generic install error | Code inspection + `install-tools.test.ts` + workspace tests | ✅ PASS | External `installKind: "external"` returns `actionKind: "manual-external-install"`, `status: "manual"`, `success: true`, and does not call runner command. Applies to RTK/codebase-memory via shared external branch. |
| Task 7 — Pi package install behavior unchanged | Code inspection + `install-tools.test.ts` | ✅ PASS | Non-external path still calls `runInstallCommand(command, ["install", tool.source])`; success/failure behavior preserved with `actionKind: "install-pi-package"`. |
| REQ-GCAP-004 / Scenario: Tool externa o faltante se muestra como manual | Code inspection + tests | ✅ PASS | External tools are represented as manual review-plan results rather than failed automatic installs. |
| Task 8 — accepts dashboard/resolved memory provider | Code inspection + manual smoke | ✅ PASS | `dashboardMemoryProvider?: AdaptiveMemoryProvider` exists and is consumed by `buildDeveloperTeamInstallPlan`. |
| Task 8 — preserve precedence | Code inspection + existing tests + manual smoke | ✅ PASS | `memoryInjection` still wins through `resolveMemoryInjection`; `memoryProvider` wins over `dashboardMemoryProvider`; dashboard provider used when no higher-precedence provider exists. |
| Task 8 — preserve model/thinking behavior | Existing `developer-team-install.test.ts` + typecheck | ✅ PASS | Model and thinking tests pass, including unsupported thinking forced off and existing assignment readers. No changes detected to `supportsThinkingForModel` / `supportsDeveloperTeamModel` semantics. |
| REQ-TEAM-004 / Scenario: Compatibilidad de thinking preservada | Existing tests + typecheck | ✅ PASS | Existing observable provider/model/thinking behavior remains covered and passing. |
| Task 9 — shared helper exported/equivalent | Code inspection + manual smoke | ✅ PASS | `resolvePiAdaptiveMemoryProvider` exported from `apps/cli/src/pi-launch-command.ts`. |
| Task 9 — launch path uses helper | Code inspection + `pi-launch-command*.test.ts` | ✅ PASS | `runPiLaunch` calls `resolvePiAdaptiveMemoryProvider(options)`; existing launch tests pass. |
| Task 9 — TUI can construct Engram/Supermemory consistently | Code inspection + manual smoke | ✅ PASS | Helper accepts dashboard-style `activeProvider` and non-secret `supermemory` options; manual checks returned provider IDs `engram` and `supermemory`. |
| REQ-MEM-006 / Scenario: Supermemory requiere configuración segura | Code inspection + Supermemory tests | ✅ PASS | Helper validates Pi MCP config and Deck config remains non-secret; Supermemory tests verify no token/header leakage. |
| Supermemory token not persisted in Deck config | Code inspection + existing config/tests | ✅ PASS | Helper accepts `DeckSupermemoryConfig` only; tests and config schema reject token/apiKey-like fields in Deck config. |
| No Mermaid/pi-hud source changes | `git status`/path checks | ✅ PASS | No scoped changes detected under Mermaid/pi-hud source paths. Existing pending-source policy unaffected. |
| No frontend/screens outside Backend Tasks 7-9 scope | `git status`/path checks | ✅ PASS | No changes detected in `apps/cli/src/tui/screens` or `apps/cli/src/tui/app.tsx` for this backend slice. |
| Typecheck/tests appropriate | Commands executed | ✅ PASS | Relevant and workspace tests pass; typecheck passes. |
| Build command | `bun run build` | ⚠️ WARN | Root build script absent, not a scoped implementation regression. |

## Findings

### CRITICAL

None.

### WARNING

- Root build is unavailable: `bun run build` exits with `error: Script not found "build"`. This prevents a true build gate, but appears to be a repository-level script gap already seen by previous verify phases, not a Tasks 7-9 regression.

### SUGGESTION

- Add dedicated regression tests for `resolvePiAdaptiveMemoryProvider` direct dashboard-style inputs and `dashboardMemoryProvider` precedence. Current compliance is supported by code inspection, existing launch/developer-team tests, and manual smoke checks; direct tests would improve future coverage.

## Open Questions

None.

## Registry Intent (deferred)

- **Registry Write**: deferred
- **Registry State Path**: `openspec/changes/pi-runner-capability-dashboard/state.yaml`
- **Registry Events Path**: `openspec/changes/pi-runner-capability-dashboard/events.yaml`
- **Intended phase**: `verify`
- **Intended status**: `passed_with_warnings`
- **Intended artifact**: `verify-backend-7-9-output.md`
- **Intended event**: `verify.backend_tasks_7_9.passed_with_warnings`
- **Registry blocker**: none
