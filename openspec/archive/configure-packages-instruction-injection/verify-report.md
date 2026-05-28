# Verify Report: configure-packages-instruction-injection

## Summary

**Overall Result**: FAIL  
**Tasks Complete**: 0 / 11 recorded complete; `apply-progress.md` is missing, so completion status is not recorded.  
**Tests**: 596 / 605 passed across affected test commands  
**Build**: FAIL — root `bun run build` has no `build` script  
**Typecheck**: PASS — `bunx tsc --noEmit`

Adaptive context: no relevant adaptive memory was found; verification used official OpenSpec artifacts, code, and tests.

## Task Completion

| Task | Status | Owner | Notes |
|---|---|---|---|
| Task 1: Extend DeckConfig types and validation | Not recorded complete | General Apply | Code present; tests pass. |
| Task 2: Create CapabilityInstructionBundle types and helpers | Not recorded complete | General Apply | Code present; tests pass. |
| Task 3: Create canonical builders | Not recorded complete | General Apply | Code present; tests pass. |
| Task 4: Extend content-registry | Not recorded complete | General Apply | Code present; tests pass. |
| Task 5: Extend manifest builder | Not recorded complete | General Apply | Code present; tests pass. |
| Task 6: Pi adapter integration | Not recorded complete | General Apply | Partial: facade reads config, direct install-plan path only uses explicit option. |
| Task 7: OpenCode adapter integration | Not recorded complete | General Apply | Partial: facade reads config, direct install-plan path only uses explicit option. |
| Task 8: Dashboard state/reducer | Not recorded complete | Frontend Apply | Code present; test command fails in affected dashboard suite. |
| Task 9: Dashboard input handling | Not recorded complete | Frontend Apply | Code present; affected dashboard suite fails. |
| Task 10: Dashboard screen rendering | Not recorded complete | Frontend Apply | Code present; affected dashboard suite fails. |
| Task 11: Dashboard persistence | Not recorded complete | Frontend Apply | Non-compliant: review-plan shape mismatch prevents config-write action; OpenCode runner persistence writes wrong scope. |

## Test Results

| Test Suite | Pass | Fail | Skip | Command |
|---|---:|---:|---:|---|
| Core affected tests | 112 | 0 | 0 | `bun test packages/core/src/config/deck-config.test.ts packages/core/src/teams/developer/instruction-bundles packages/core/src/teams/developer/content-registry.test.ts packages/core/src/teams/developer/manifest.test.ts` |
| Pi adapter package tests | 337 | 0 | 0 | `bun test packages/adapter-pi` |
| OpenCode adapter package tests | 114 | 0 | 0 | `bun test packages/adapter-opencode` |
| CLI dashboard/screen tests | 33 | 9 | 0 | `bun test apps/cli/src/tui/pi-runner-dashboard apps/cli/src/tui/screens` |

## Build / Typecheck

| Check | Result | Details |
|---|---|---|
| Build | FAIL | `bun run build` exits 1: `error: Script not found "build"`. |
| Typecheck | PASS | `bunx tsc --noEmit` exits 0. |

## Compliance Matrix

| REQ-ID / Scenario | Method | Result | Notes |
|---|---|---|---|
| REQ-PIC-001..007 | Code inspection + core tests | PASS | `DeckConfig` includes `packageInstructions`; defaults all false; unknown runner/package and non-boolean validation implemented. |
| Config scenarios | Core tests + code inspection | PASS | Missing/null config defaults to disabled; write/read round-trip covered by tests. |
| REQ-CII-001 | Code inspection | PASS | `CapabilityInstructionBundle` and `CapabilityInstructionFragment` are defined. |
| REQ-CII-002..004 | Code inspection + core tests | PASS | Builders exist for `codebase-memory`, `context-mode`, `rtk`; aggregate builder filters enabled package IDs. |
| REQ-CII-005 / agent-skill composition | Code inspection + core tests | PASS | `composeCapabilityInstructions()` filters by surface/agent/skill and appends labeled sections through content registry. |
| REQ-CII-006 | Core tests | PASS | Memory bundle path remains separate; manifest tests pass. |
| REQ-CII-007 | Code inspection + tests | PASS | Appends `## Package Instructions (configured)`. |
| REQ-DTM-001..003 | Code inspection + manifest tests | PASS | `BuildManifestOptions.capabilityInstructions` is present and passed to registry; no-bundle behavior covered by tests. |
| REQ-DC-001..003 | Code inspection + core tests | PASS | Normalized config includes defaults and `writeDeckConfig` persists normalized output. |
| Adapter config resolution | Code inspection | FAIL | `runner-capabilities.ts` resolves config, but direct `buildDeveloperTeamInstallPlan()` / `buildOpenCodeDeveloperTeamInstallPlan()` do not read config when no explicit bundle is passed. This misses configured package instructions on direct install-plan paths. |
| Adapter no recomposition | Code inspection | PASS | Adapters pass bundle to registry/content paths and do not call `composeCapabilityInstructions()` directly. |
| REQ-DASH-001..002 | Code inspection + render tests | PASS | Dashboard has separate `Configure Packages` section and instruction-only hint. |
| REQ-DASH-003 | Code inspection | FAIL | Dashboard plan/action path is inconsistent: adapter review-plan types expect `packageInstructions` as runner-scoped bundles, while dashboard state stores per-package booleans. Enabled toggles do not reliably produce a `write-deck-config` action. OpenCode persistence also writes the active toggles to `pi` and leaves `opencode` false. |
| REQ-DASH-004 | Code inspection | FAIL | Dashboard initialization in `apps/cli/src/tui/app.tsx` creates default state without reading `.deck/config.json`; existing `packageInstructions` toggles are not reflected on load. |

## Findings

### CRITICAL

- CLI dashboard affected tests fail: `bun test apps/cli/src/tui/pi-runner-dashboard apps/cli/src/tui/screens` reports 33 pass / 9 fail. Failures are in `action-runner.test.ts` around Supermemory action ordering, token redaction, team bundle execution, and internal package install routing.
- Dashboard persistence is not compliant with REQ-DASH-003. `RunnerDashboardState.packageInstructions` stores booleans keyed by package ID, but `packages/adapter-pi/src/capability-plan.ts` and `packages/adapter-opencode/src/capability-plan.ts` expect runner-scoped `CapabilityInstructionBundle` values, so enabled toggles may not create a config-write action.
- OpenCode dashboard config writes are not compliant with REQ-DASH-003. In `action-runner.ts`, when `runnerScope === "opencode"`, active toggles are written to `packageInstructions.pi` while `packageInstructions.opencode` remains false.
- Dashboard load is not compliant with REQ-DASH-004. `app.tsx` initializes default dashboard state without reading `.deck/config.json`, so existing package instruction toggles are not reflected.
- Adapter direct install-plan paths are not fully compliant with the design requirement to read config during install-plan/manifest generation. The runner facade resolves config, but direct `buildDeveloperTeamInstallPlan()` and `buildOpenCodeDeveloperTeamInstallPlan()` only use an explicit `capabilityInstructions` option.
- Build gate failed because the repository root has no `build` script for `bun run build`.

### WARNING

- `apply-progress.md` is missing, so no task is recorded as complete even though much of the implementation is present.

### SUGGESTION

- Add direct tests for dashboard load-from-config and OpenCode `packageInstructions.opencode` persistence; current dashboard tests cover rendering/reducer behavior but not the full persistence path.

## Open Questions

None.

## Intended Registry Update

Registry write was explicitly deferred by the orchestrator. Intended registry record:

- phase: `verify`
- status: `failed`
- artifact: `verify-report.md`
- event: `verify.failed`
