# Verify Report: Runner Model Recognition and Model-Aware Effort Levels

## Summary

**Change ID**: `runner-model-recognition-effort-levels`  
**Overall Result**: PASS WITH WARNINGS  
**Registry Mode**: deferred; Verify updated only this `verify-report.md`.  
**Tasks Complete**: 15 / 15 original tasks complete; bounded backend/frontend salvage and final blocker repair events complete.  
**Tests**: Change-focused suites pass; full TUI suite has unrelated/pre-existing failures.  
**Build**: PASS (`bun run build:dry-run`)  
**Typecheck**: WARN (`bunx tsc --noEmit` reports 93 workspace diagnostics; verified final blocker/change-surface ranges have 0 diagnostics)

Latest apply-progress events verified:

- `pi-detector-restored`: restored `detectPiModelInventoryForTui()`, added regression coverage, focused TUI tests pass.
- `opencode-variant-persistence-fixed`: OpenCode variant write validation now accepts runner-owned inventory-confirmed variants or Deck-owned cache-confirmed variants, fails closed otherwise, and does not write legacy `reasoningEffort`.

## Task Completion

| Task / Salvage Area | Status | Evidence |
|---|---:|---|
| T1-T3 Shared / contracts and dependency guard | ✅ Complete | `tasks.md`, `apply-progress.md`, focused core tests pass |
| T4-T11 Backend / OpenCode adapter | ✅ Complete | `apply-progress.md`; adapter-opencode suite passes |
| T12 Backend / Pi compatibility | ✅ Complete | adapter-pi suite passes |
| T13-T14 Frontend / TUI | ✅ Complete | focused TUI suite passes, including Pi detector regression tests |
| T15 Cross-cutting fixture suite | ✅ Complete | `opencode-cross-cutting.test.ts` included in adapter-opencode suite |
| Bounded backend salvage | ✅ Complete | catalog fallback removed; touched backend files have 0 `require(` calls; cross-cutting variant cache behavior verified |
| Bounded frontend salvage/triage | ✅ Complete | Pi detector restored; focused/full-surface diagnostics in restored ranges are 0 |
| Final blocker: OpenCode variant persistence | ✅ Complete | inventory-confirmed, cache-confirmed, unconfirmed/fail-closed, and no-legacy-write tests pass |

## Test Results

| Check | Result | Details |
|---|---:|---|
| `bun test packages/adapter-opencode/src` | ✅ PASS | 336 pass, 0 fail, 21 files |
| Core focused tests: `model-reasoning-capability.test.ts` + `runner-adapter-contract.test.ts` | ✅ PASS | 22 pass, 0 fail, 2 files |
| `bun test packages/adapter-pi/src` | ✅ PASS | 403 pass, 0 fail, 21 files |
| `bun test tests/deps/no-gentle-ai-dependency.test.ts` | ✅ PASS | 3 pass, 0 fail, 1 file |
| Focused TUI: `bun test apps/cli/src/tui/__tests__/developer-team-screens-effort.test.tsx` | ✅ PASS | 26 pass, 0 fail, 1 file; includes Pi detector regression tests |
| Full TUI: `bun test apps/cli/src/tui` | ⚠️ WARN | 187 pass, 11 fail, 16 files; failures are outside the runner model recognition / variant persistence surface |
| `bun run build:dry-run` | ✅ PASS | linux-x64 dry-run completed; `deck` binary build step reached Build Complete |
| `bunx tsc --noEmit` | ⚠️ WARN | exit 2 with 93 workspace diagnostics; 0 diagnostics in final blocker ranges |

### Full TUI Warning Evidence

The full TUI failures are not in the model inventory, thinking-level, Pi detector, or OpenCode variant persistence tests. They are:

- `Developer Team TUI screens > PersonalitySelectionScreen > shows cursor on Ahorro extremo when cursor=2`
- 7 `Pi Runner dashboard action runner Supermemory safety` tests in `apps/cli/src/tui/runner-dashboard/action-runner.test.ts`
- 1 `Pi Runner dashboard action runner Developer Team model preservation` test in `apps/cli/src/tui/runner-dashboard/action-runner.test.ts`
- 3 `Fix #1: internal package install action routing` tests in `apps/cli/src/tui/runner-dashboard/action-runner.test.ts`

Diff evidence: the current change diff in `apps/cli/src/tui/app.tsx` is limited to model inventory/thinking-level handling around `detectPiModelInventoryForTui`, `detectOpenCodeModelInventoryForTui`, and variant preselection; it does not touch `PersonalitySelectionScreen` or the runner-dashboard action-runner tests.

## Build / Typecheck

| Check | Result | Details |
|---|---:|---|
| Build dry-run | ✅ PASS | `bun run build:dry-run` completed successfully |
| Workspace typecheck | ⚠️ WARN | `bunx tsc --noEmit` exited 2 with 93 diagnostics |
| Final blocker/change-surface ranges | ✅ PASS | 0 diagnostics in `app.tsx:2329-2377` (Pi detector), `app.tsx:2379-2445` (OpenCode detector variant preselection), `developer-team-install.ts:365-465` (variant writer), and `model-config.ts:323-428` (variant reader) |

Typecheck diagnostic distribution from this rerun:

- `apps/cli/src/tui/app.tsx`: 31 diagnostics, all outside the final blocker ranges.
- `packages/adapter-opencode/src/install-tools.ts`: 20 diagnostics, outside this change's final blocker surface.
- `packages/adapter-supermemory/src/index.test.ts`: 7 diagnostics.
- `apps/cli/src/tui/developer-team-flow.test.tsx`: 6 diagnostics.
- Additional diagnostics are distributed across existing CLI/core/adapter test/runtime files.

## Compliance Matrix

| Requirement / Scenario | Method | Result | Notes |
|---|---|---:|---|
| Pi detector blocker fixed | Code inspection + focused TUI test | ✅ PASS | `detectPiModelInventoryForTui()` exists and uses `getAdapter("pi").getModelInventory()` first, then Pi fallback. Focused TUI suite passes 26/26. |
| OpenCode native variant persistence accepts inventory-confirmed variants | Adapter tests + code inspection | ✅ PASS | `buildAgentEntry()` checks runner-owned inventory first and writes `entry.variant` when the selected variant is present. |
| OpenCode native variant persistence accepts cache-confirmed variants | Adapter tests + code inspection | ✅ PASS | Writer falls back to `variantLookup` / `isVariantSupportedForModel`; cache-confirmed test passes. |
| OpenCode variant persistence fails closed otherwise | Adapter tests + code inspection | ✅ PASS | Unconfirmed variants are omitted; no unsupported/stale variant is written. |
| OpenCode writer emits no legacy `reasoningEffort` | Adapter tests + source scan | ✅ PASS | `developer-team-install.ts` has 0 direct `.reasoningEffort =` assignments; tests assert no legacy field on new entries. |
| OpenCode writer emits no empty `variant` | Code inspection + tests | ✅ PASS | Writer assigns `entry.variant = candidateVariant` only when confirmed and truthy; empty variant mentions are comments warning not to emit it. |
| Catalog fallback remains removed for OpenCode reasoning confirmation | Code inspection + tests | ✅ PASS | `supportsThinkingForOpenCodeModel()` and `resolveModelConfig()` require runner signal, inventory, or variant cache and return false/undefined otherwise. |
| Variant cache remains consumed | Code inspection + cross-cutting tests | ✅ PASS | `variantsFor()` and injected `variantLookup` are used by support/read/write paths; cross-cutting fixture tests pass in adapter-opencode suite. |
| No dynamic `require()` in touched backend files | Source scan | ✅ PASS | 0 `require(` calls in touched backend files: model-config, developer-team-install, runner-adapter, capability-inventory, internal-opencode-packages, model-inventory, model-variants, and related core files. |
| No `gentle-ai` / non-runner dependency | Guard test + source scan | ✅ PASS | no-gentle-ai guard passes 3/3; touched backend source scan found no forbidden refs. |
| REQ-EFFORT-005 native OpenCode `variant` boundary | Code inspection + tests | ✅ PASS | Read path prefers `variant ?? reasoningEffort` for compatibility; write path emits native `variant` only. |
| REQ-EFFORT-001/002 model-aware variants | TUI/adapter tests | ✅ PASS | Focused TUI tests assert model-specific `getThinkingLevels(modelId)`, per-model differences, unsupported model hiding, and Pi/OpenCode separation. |
| REQ-COMPAT-001 Pi compatibility | adapter-pi + focused TUI tests | ✅ PASS | adapter-pi suite passes 403/403; focused TUI Pi regression tests pass. |
| Scenario: unknown/unconfirmed model has no variant signal | Adapter tests + code inspection | ✅ PASS | Unknown/unconfirmed models fail closed and omit thinking assignment / variant. |
| Scenario: existing confirmed config is preserved | Cross-cutting tests | ✅ PASS | Confirmed variant preservation and stale variant clearing are asserted in adapter-opencode suite. |
| Scenario: tests run without external services | Test design inspection + guard | ✅ PASS | Relevant tests use fixtures/injection/mocks; no live runner/network/OAuth service dependency observed. |

## Findings

### CRITICAL

None for the change surface.

### WARNING

- Full TUI suite still fails 11 unrelated tests. Evidence: failing tests are in personality selection expectations and Pi runner-dashboard Supermemory/package-install action routing, not the runner model recognition / Pi detector / OpenCode variant persistence surface; focused TUI model-effort suite passes.
- Workspace typecheck still fails with 93 diagnostics. Evidence: final blocker ranges have 0 diagnostics; diagnostics are concentrated in pre-existing app/dashboard/install-tools/supermemory surfaces.

### SUGGESTION

- Clean up stale comments in `model-config.ts` that say “fall through to catalog”; implementation correctly returns false, but the comment can confuse future verification.
- Consider fixing global TUI/typecheck debt before requiring full-suite green for archival on future changes.

## Files Inspected

- `openspec/changes/runner-model-recognition-effort-levels/spec.md`
- `openspec/changes/runner-model-recognition-effort-levels/tasks.md`
- `openspec/changes/runner-model-recognition-effort-levels/apply-progress.md`
- `openspec/changes/runner-model-recognition-effort-levels/verify-report.md`
- `packages/adapter-opencode/src/developer-team-install.ts`
- `packages/adapter-opencode/src/developer-team-install.test.ts`
- `packages/adapter-opencode/src/model-config.ts`
- `packages/adapter-opencode/src/model-config.test.ts`
- `packages/adapter-opencode/src/model-inventory.ts`
- `packages/adapter-opencode/src/model-variants.ts`
- `packages/adapter-opencode/src/runner-adapter.ts`
- `packages/adapter-opencode/src/__tests__/opencode-cross-cutting.test.ts`
- `apps/cli/src/tui/app.tsx`
- `apps/cli/src/tui/__tests__/developer-team-screens-effort.test.tsx`
- `apps/cli/src/tui/developer-team-flow.test.tsx`
- `apps/cli/src/tui/runner-dashboard/action-runner.test.ts`
- `tests/deps/no-gentle-ai-dependency.test.ts`

## Open Questions

None.

## Registry Intent

- **Registry Write**: deferred
- **Phase**: `verify`
- **Status**: `passed_with_warnings`
- **Event**: `verify-passed-with-warnings`
- **Artifact**: `openspec/changes/runner-model-recognition-effort-levels/verify-report.md`

## Notes for Orchestrator

Archive can proceed from the verification perspective if the Orchestrator accepts the documented unrelated/pre-existing full TUI and workspace typecheck warnings as non-blocking. The final Pi detector and OpenCode variant persistence blockers are fixed and verified.
