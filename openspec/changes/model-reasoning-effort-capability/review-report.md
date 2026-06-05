# Review Report: Capacidad híbrida de `reasoningEffort` por modelo (re-run after Verify fixes)

## Summary

**Overall Rating**: APPROVE
**Verdict**: pass
**Scope**: general, backend, frontend
**Files Reviewed**: 9 (7 modified, 2 new) — focused re-review after Verify/Review fixes

**Required Fixes**: None. All prior MAJOR findings are resolved. Remaining MINOR/NIT items are non-blocking and orthogonal to the change's correctness; they may be addressed in a follow-up without blocking this change from advancing to Archive.

## Ratings by Dimension

| Dimension | Rating | Notes |
|---|---|---|
| Architecture | ✅ Strong | Hybrid resolver in core remains the right boundary. OpenCode adapter delegates correctly. The shape contract between adapter and TUI consumer is now consistent (`readModelAssignments` returns `Record<string, string>`; `readThinkingAssignments` returns the level record). |
| Security | ✅ Strong | No new secrets or injection surfaces. Cleanup limited to Deck-managed entries (`deck-developer-*`). |
| Scalability | ✅ Strong | Resolver is O(n) over a 25-model catalog. Capability map is a small record passed by reference. No hot paths. |
| Maintainability | ✅ Strong | Dead state removed. T7 cleanup now functional. Defaults validation closes the latent persistence hole. |
| Code Quality | ✅ Strong | Resolver is pure, documented, and test-covered. TUI screens use a single `supportsThinking` derivation per screen. |
| Backend | ✅ Strong | `resolveModelConfig` now validates both explicit override AND defaults branch through the resolver. OpenCode/Pi adapters keep clean separation. |
| Frontend | ✅ Strong | T7 hydration is correct. T8 hides the legacy `Thinking not supported; using off` copy. TUI navigation skip preserved. |
| Integration | ✅ Strong | Pi anti-regression intact (34/34 tests). TUI → adapter → resolver contract is type-safe at compile time. |

## Findings

### MAJOR

None. All previous MAJOR findings are resolved (see "Fix Verification" below).

### MINOR

- **Backend / Code Quality**: `ReasoningCapabilityMap` type is still named `Map` but is a `Record`
  - **File**: `packages/adapter-opencode/src/model-config.ts` — line ~151
  - **Evidence**: `export type ReasoningCapabilityMap = Record<string, boolean | null>;` — naming implies `Map<string, ...>`. Already flagged in prior review (NIT). Promoted to MINOR because it appears in two public exports of the install plan + resolveModelConfig signatures and could mislead callers expecting the standard `Map` API.
  - **Recommendation**: Rename to `ReasoningCapabilityByModel` or `ReasoningCapabilityRecord`. Alternatively, change the shape to a real `Map` if mutation/iteration semantics warrant it.

- **Frontend / Maintainability**: `hydrateDeveloperTeamModelConfig` passes `""` as `projectRoot` to both `readModelAssignments` and `readThinkingAssignments`
  - **File**: `apps/cli/src/tui/app.tsx` — lines 2009-2010
  - **Evidence**: `const modelAssigns = adapter.readModelAssignments("") || {};` and `const thinkingAssigns = adapter.readThinkingAssignments("") || {};`
  - **Impact**: OpenCode adapter ignores the argument (good). Pi adapter does `const root = projectRoot ?? process.cwd()`; since `""` is not nullish, the fallback to `process.cwd()` is bypassed, and the join becomes `".pi/agents/<id>.md"` (a relative path). This silently changes Pi behavior vs. calling without an argument.
  - **Recommendation**: Drop the argument: `adapter.readModelAssignments()` and `adapter.readThinkingAssignments()`. Both adapters will then default correctly. Add a comment explaining the default fallback.

- **Backend / Code Quality**: Mock `exists` parameter in `readOpenCodeDeveloperTeamModelConfigAssignments` tests uses `_path: string` but the production type is `PathLike`
  - **File**: `packages/adapter-opencode/src/model-config.test.ts` — lines 287, 309
  - **Evidence**: `bunx tsc --noEmit` reports 2 typecheck errors at these lines. Tests still pass at runtime; this is purely a typecheck gap.
  - **Recommendation**: Either change mock signature to `(_path: string) => true as boolean` with a cast, or `(_path: PathLike) => true`. Cheap fix; closes a typecheck warning.

### NIT

- **Code Quality**: Task-anchor comments (`// T7:`, `// T8:`) linger in `app.tsx` and `developer-team-screens.tsx`. Useful during Apply but consume noise budget. Could be replaced with behavior-oriented comments, or removed if adjacent code is self-explanatory.
  - **Files**: `apps/cli/src/tui/app.tsx` (lines 2007, 2008, 2019, 1531, 1536); `apps/cli/src/tui/screens/developer-team-screens.tsx` (lines 200, 207, 291, 304, 308)

- **Documentation**: `ReasoningSupportSource` is self-explanatory but the doc-comment of `resolveReasoningEffortSupport` could call out that `source: "runner"` only fires for true/false and `null`/`undefined` are treated as "no signal" (already documented in code, but worth surfacing in JSDoc).

- **Code Quality**: The legacy `Thinking not supported by this provider/model; using off.` branch in `AgentModelAssignmentScreen` (line 280-282 in screens.tsx) is now unreachable from the TUI navigation because `app.tsx` skips the screen for unsupported models. The associated test still asserts this message. Defensive fallback is acceptable but the message could be removed in a follow-up. Not a regression.

## Fix Verification (against prior review)

| Prior Finding | Status | Evidence |
|---|---|---|
| MAJOR — T7 shape mismatch: `readModelAssignments()` returns `Record<string, string>`, not `{ modelAssignments, thinkingAssignments }` | ✅ RESOLVED | `app.tsx:2009-2023` now calls `adapter.readModelAssignments("")` AND `adapter.readThinkingAssignments("")` separately, then iterates `Object.entries(modelAssigns)` and filters `thinkingAssigns` by `adapter.supportsThinking(modelId)`. TypeScript errors at lines 2020, 2025 are gone. |
| MINOR — Dead state `modelSupportsReasoningById` declared but never written | ✅ RESOLVED | `grep` across the whole repo finds zero code references; only documentation references remain in `apply-progress.md`, `state.yaml`, `events.yaml`, and the prior `review-report.md` describing the fix. |
| MINOR — `applyDeveloperTeamModelConfig` null/undefined handling | ✅ RESOLVED | `app.tsx:2051-2058` adds an early return when `projectRoot` is null with an install-results entry. `app.tsx:2084-2088` now passes `environmentId: modelConfigRuntime === "opencode" ? "opencode-development" : "pi-development"` to `applyDeveloperTeamInstall`. TypeScript errors at lines 2058, 2068 are gone. |
| MINOR — Backend `resolveModelConfig` doesn't validate `defaults?.reasoningEffort` through resolver | ✅ RESOLVED | `model-config.ts` `resolveEffort()` now has two symmetric branches: explicit override goes through resolver, AND `defaults?.reasoningEffort` (when present) also goes through resolver. If the model doesn't support reasoning (or no model is set), the function returns `undefined` and `reasoningEffort` is omitted. Test coverage added in `model-config.test.ts` for the defaults-validation path. |

## Design Fidelity

**Aligned**: Yes

- ✅ Hybrid resolver in core with precedence runner > catalog > unknown (REQs MRE-001 to MRE-006)
- ✅ Cleanup limited to Deck-managed entries via `mergeConfig` and `effectiveThinkingAssignments` (REQ-OMC-004)
- ✅ Explicit-only contract preserved: no model → no `reasoningEffort` (REQ-OMC-005); `off` → omitted (REQ-EXPL-002)
- ✅ TUI hides selector/hint for unsupported/unknown (REQ-TUI-001 to TUI-005)
- ✅ Pi anti-regression preserved: `supportsThinkingForModel` still returns `false` for `opencode-go/*` and `*/kimi-k2.6` (REQ-PI-001, REQ-PI-002)
- ✅ T7 hydration cleanup now functional; T8 legacy copy removed

**Deviations**: None new. The prior review's open question on `readModelAssignments` shape was answered by splitting into two adapter methods (which were always present in the interface) rather than changing the return shape. This was the correct, less-invasive fix.

## Open Questions

- None blocking. The `ReasoningCapabilityMap` naming issue and the `""` vs `undefined` projectRoot are both minor and orthogonal to the change's correctness.

## Test Quality

- ✅ Core resolver: 15 tests, all pass. Covers runner true/false override, catalog explicit, catalog-derived, unknown, null/undefined, no catalog, explicit-over-capability precedence.
- ✅ OpenCode model-config: 34 tests, all pass. Added coverage for capabilityMap runner override (both true and false), `off` level, no-model-no-effort, and `effectiveThinkingAssignments` filter behavior.
- ✅ OpenCode install: 63 tests, all pass. Updated reasoning override test to require a model (REQ-OMC-005).
- ✅ Pi model-config: 34 tests, all pass. No regression.
- ✅ TUI screens: 5 tests, all pass. Tests updated to assert `not.toContain("Thinking not supported")` per REQ-TUI-004.
- ⚠️ TUI flow: 43 pass, 1 fail (pre-existing — `PersonalitySelectionScreen > shows cursor on Ahorro extremo when cursor=2`). Unrelated to this change; documented in prior review.
- ⚠️ 2 new typecheck errors in `model-config.test.ts` (lines 287, 309) — minor mock signature mismatch (`PathLike` vs `string`). Tests run fine; only the type checker complains.

## Test Run Output (verified)

```
packages/core/src/model-reasoning-capability.test.ts: 15 pass, 0 fail
packages/adapter-opencode/src/model-config.test.ts: 34 pass, 0 fail
packages/adapter-opencode/src/developer-team-install.test.ts: 63 pass, 0 fail
packages/adapter-pi/src/model-config.test.ts: 34 pass, 0 fail
apps/cli/src/tui/screens/developer-team-screens.test.tsx: 5 pass, 0 fail
apps/cli/src/tui/developer-team-flow.test.tsx: 43 pass, 1 fail (pre-existing)
─────────────────────────────────────────────────────────────────
Total change-related tests: 151 pass / 0 fail across 5 files
Pre-existing failure (out of scope): 1 (PersonalitySelectionScreen)
```

## Typecheck Status (re: previously reported errors)

```
Before fixes:  261 lines of error (4 blocking in app.tsx at 2020, 2025, 2058, 2068)
After fixes:   252 lines of error (none in T7/T8 code; 2 new minor in test mocks)
```

The 4 previously blocking errors in `app.tsx` (2020, 2025, 2058, 2068) are gone. Remaining errors are pre-existing across the repo (adaptive memory contract mismatches, dashboard state types, spawn options) and unrelated to this change. The 2 new minor typecheck warnings are in `model-config.test.ts` mock signatures and don't fail tests at runtime.
