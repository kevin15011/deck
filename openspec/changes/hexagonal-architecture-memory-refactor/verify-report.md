# Verify Report: Hexagonal Architecture & Memory Refactor

## Summary

**Overall Result**: FAIL  
**Tasks Complete**: 23 / 23 attempted; Tasks 21-22 implemented audit tests; Task 23 executed verification  
**Tests**: 1266 / 1286 passed  
**Build**: fail (`bun run build` script missing)  
**Typecheck**: fail (`bunx tsc --noEmit`)  
**Registry Write**: deferred per instruction not to modify `state.yaml` or `events.yaml`

## Task Completion

| Task | Status | Owner |
|---|---|---|
| Task 21: Core purity audit | ✅ Implemented, ❌ failing | Verify |
| Task 22: TUI boundary audit | ✅ Implemented, ❌ failing | Verify |
| Task 23: E2E verification | ✅ Executed, ❌ failing | Verify |

## Test Results

| Test Suite | Pass | Fail | Skip |
|---|---:|---:|---:|
| Core purity audit | 0 | 1 | 0 |
| TUI boundary audit | 0 | 1 | 0 |
| Full suite (`bun test`) | 1266 | 20 | 0 |

## Build / Typecheck

| Check | Result | Details |
|---|---|---|
| Build (`bun run build`) | ❌ FAIL | Root package has no `build` script: `error: Script not found "build"`. |
| Typecheck (`bunx tsc --noEmit`) | ❌ FAIL | Errors in `apps/cli/src/main.tsx`, `apps/cli/src/tui/pi-runner-dashboard/action-runner.test.ts`, and `packages/adapter-opencode/src/capability-plan.ts`. |

## Compliance Matrix

| REQ-ID / Scenario | Method | Result | Notes |
|---|---|---|---|
| REQ-CRP-001 / Core has no runtime string literals | `core-purity-audit.test.ts` | ❌ FAIL | Found prohibited literals in non-test core source. |
| REQ-AM-005 / Core source is provider-name clean | `core-purity-audit.test.ts` | ❌ FAIL | Found `engram` / `supermemory` literals in core source. |
| REQ-TUI-001 / TUI has no direct adapter imports | `tui-boundary-audit.test.ts` | ❌ FAIL | `app.tsx` is allowed temporarily, but other TUI files still import adapters. |
| REQ-TUI-002 / CLI entry point creates and injects capabilities | Typecheck + source verification | ❌ FAIL | TypeScript rejects `<DeckApp runnerCatalog={runnerCatalog} />`. |
| REQ-TUI-003 / Dashboard helpers use injected capabilities | Audit + tests | ⚠️ WARN | `action-runner.ts` audit is clean, but related tests still import `@deck/adapter-pi` and fail. |
| REQ-TUI-004 / Developer Team screens use normalized models | Audit | ❌ FAIL | `developer-team-screens.tsx` still imports adapter model helpers/types. |
| All other spec scenarios | Existing unit tests + full suite | ⚠️ WARN | Cannot certify final E2E compliance while build, typecheck, and full tests fail. |

## Findings

### CRITICAL

- Core purity audit fails. Examples include `packages/core/src/config/deck-config.ts` containing `supermemory`, `packages/core/src/model-catalog.ts` containing `opencode`, `packages/core/src/runner-capability.ts` containing `pi-package` / `opencode-plugin`, and `packages/core/src/memory/adaptive-memory-governance.ts` containing `Engram migration payloads`.
- TUI boundary audit fails outside the known `app.tsx` exception. Violations remain in `apps/cli/src/tui/screens/developer-team-screens.tsx` and multiple TUI test files.
- Full test suite fails: `1266 pass / 20 fail` across 92 files.
- Typecheck fails. Representative errors: `apps/cli/src/main.tsx(91,19)` rejects the `runnerCatalog` prop; `packages/adapter-opencode/src/capability-plan.ts(274,15)` compares incompatible status types.
- `bun run build` fails because no root `build` script exists.
- `pi developer` and `opencode developer` smoke checks could not be validated as stable output comparisons; both commands were terminated by timeout/SIGTERM in this non-interactive verification run.

### WARNING

- Task 19 remains explicitly partial: `app.tsx` keeps adapter imports as temporary runtime glue. The audit test documents this as a TODO exception, but spec REQ-TUI-001 remains only partially satisfied.

### SUGGESTION

- Add a root build script or document the canonical build command so Task 23 can be verified consistently in CI.

## Open Questions

- What baseline artifact should be used to compare `pi developer` and `opencode developer` output “same as before”?

## Follow-up Required

### TUI Adapter Import Decoupling

The following TUI files still import directly from adapter packages. A future SDD is required to complete the hexagonal architecture decoupling for these files:

1. **`apps/cli/src/tui/screens/developer-team-screens.tsx`** — imports adapter model helpers/types
   - Issue: Uses `buildDeveloperTeamInstallPlan`, `applyDeveloperTeamInstall`, `getTeamsForEnvironment` from `@deck/adapter-pi` and similar from `@deck/adapter-opencode`
   - Required: Normalized model types and factory functions in core that adapters implement

2. **TUI test files** — multiple test files import `@deck/adapter-pi` and `@deck/adapter-opencode`
   - Issue: Tests like `action-runner.test.ts` mock or call adapter functions directly
   - Required: A future SDD to create test-compatible abstractions that tests can use without importing adapters

3. **`apps/cli/src/tui/screens/pi-runner-dashboard-screens.tsx`** — `capabilityResolver` prop type mismatch
   - Issue: TypeScript error `CapabilityResolver | undefined` not assignable to `CapabilityResolver`
   - Required: Make the capability resolver non-optional or handle undefined in the screen component

### TypeScript Errors (Pre-existing)

The following typecheck errors are pre-existing and were NOT introduced by this change:

- `packages/adapter-opencode/src/capability-plan.ts(212,65)`, `(260,13)`, `(274,15)`: Status comparison type errors — the `OpenCodeCapabilityStatus` type doesn't include `"blocked"` but the code compares against it
- `apps/cli/src/tui/pi-runner-dashboard/action-runner.test.ts`: Multiple type mismatches in test file — `results` property missing from `DeveloperTeamInstallPlan` type

These are architectural issues in the adapter and test files, not in core or the CLI entry point.
