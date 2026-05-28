# Review Report: Orchestrator Personality Selector

## Summary

**Overall Rating**: APPROVE WITH CHANGES
**Scope**: general, backend, frontend, integration
**Files Reviewed**: 10

## Ratings by Dimension

| Dimension | Rating | Notes |
|---|---|---|
| Architecture | Strong | Clean formatter boundary, structured facts in/out, machine-readable fields preserved. One drift risk from type duplication. |
| Security | Strong | Non-sensitive enum, strict validation, no secrets introduced. Existing secret rejection still applies. |
| Scalability | Strong | Negligible perf impact; transversal across runners. |
| Maintainability | Adequate | Formatter is clean and well-tested. Type duplication across packages creates drift risk. TUI file is already large; additions are small and focused. |
| Code Quality | Strong | Good naming, appropriate comments, defensive normalization of unknown personalities. Minor formatting edge case and dead prop. |
| Backend | Adequate | Formatter module is excellent. Pipeline integration has one significant bug: override context is lost in skipReason formatting. |
| Frontend | Strong | Follows existing TUI patterns, MenuList integration is consistent, disclaimer is persistent, default cursor position correct. |
| Integration | Adequate | Backend/frontend contracts align. Config merge-before-write preserves existing fields. Override info loss in pipeline is the main cross-layer concern. |

## Findings

### BLOCKER
None.

### MAJOR
- **Backend — Pipeline drops quality override context from skipReason**: `runOrchestratorPipeline` replaces the quality router's `skipReason` with a personality-formatted version, but the `skipReasonFacts` it constructs (lines 150–154) never includes `overrideName` or `overrideExpiresAt` from `riskResult.overrides`. When `routeQuality` returns a critical-tier override skipReason (e.g., `"Critical tier overridden by 'X' expiring 2025-12-31"`), the pipeline overwrites it with a non-override personality message that omits the override entirely. The formatter's override branch (lines 124–128, 131–133 in `personality-output.ts`) is therefore unreachable in production.
  - **File**: `packages/sdd-runtime/src/orchestrator/orchestrator-pipeline.ts` — lines 148–159
  - **Evidence**: `skipReasonFacts` is built from `riskResult.score`, `config.routerConfig.standardThreshold`, and `riskResult.tier` only. `riskResult.overrides` is never inspected. `quality-router.ts` lines 72–79 produce override skipReasons that are discarded.
  - **Recommendation**: Inspect `riskResult.overrides` for an active `quality-only` scope override in the pipeline; if present, pass `overrideName` and `overrideExpiresAt` into `skipReasonFacts` before calling `formatSkipReason`. Add a pipeline test covering the critical-tier override path for all three personalities.

### MINOR
- **Backend — Type duplication across packages**: `packages/sdd-runtime/src/orchestrator/personality-output.ts` re-declares `OrchestratorPersonality`, `ORCHESTRATOR_PERSONALITIES`, and `DEFAULT_ORCHESTRATOR_PERSONALITY` instead of importing from `@deck/core`. `packages/sdd-runtime/package.json` has no dependency on `@deck/core`. If personalities are extended in the future, both files must be updated independently.
  - **File**: `packages/sdd-runtime/src/orchestrator/personality-output.ts` — lines 17–19 (duplicates `packages/core/src/config/deck-config.ts` lines 34–36)
  - **Recommendation**: Add an explicit `@deck/core` dependency to `packages/sdd-runtime/package.json` and import the shared type/constants from core. Alternatively, accept the duplication and document it in a code comment.

- **Backend — Empty fields produce trailing colon in blockReason**: When both `missingFields` and `invalidFields` are empty arrays, `formatBlockReason` for `pragmatica` and `ahorro-extremo` produces `"Self-audit invalid in {mode}: "` with a trailing space and colon. No test asserts the exact string in this edge case.
  - **File**: `packages/sdd-runtime/src/orchestrator/personality-output.ts` — lines 77, 109
  - **Recommendation**: Handle empty `parts` gracefully, e.g., by conditionally omitting the colon suffix or providing a fallback message like `"Self-audit invalid in {mode}: no details provided"`.

- **Frontend — PersonalitySelectionScreen `selected` prop is unused**: The component receives a `selected` prop indicating the currently persisted personality, but only `cursor` is used for visual highlighting. The prop is dead code in the render output.
  - **File**: `apps/cli/src/tui/app.tsx` — lines 1986, 2012–2013
  - **Recommendation**: Either render a visual indicator for the persisted selection (e.g., a checkmark or dim label), or remove the prop if the cursor is the sole source of visual state.

- **General — Config test comment is misleading**: The test "writing personality does not erase existing adaptiveMemory field" includes `adaptiveMemory` in the write input object, so it does not actually validate merge behavior when the field is omitted.
  - **File**: `packages/core/src/config/deck-config.test.ts` — lines 580–600
  - **Recommendation**: Correct the comment to match the test, or change the test to omit `adaptiveMemory` from the input and verify the existing value is preserved by the write-then-read cycle.

### NIT
- **Test duplication in config tests**: "round-trip preserves each valid personality value" (lines 565–578) and "write-then-read round-trip preserves personality for each valid value" (lines 602–615) are identical.
  - **File**: `packages/core/src/config/deck-config.test.ts`
  - **Recommendation**: Remove one duplicate test.

## Design Fidelity

Does the implementation match the Design artifact?
- **Aligned**: Yes
- **Deviations**:
  1. The design suggested Spanish hints ("Explicaciones completas y educativas") in the TUI screen design section, but the Spec's screen specification table requires English hints ("Full explanations with educational context"). The implementation follows the Spec, which is correct per the authority rules.
  2. The design recommended importing shared personality types from `@deck/core` into sdd-runtime; the implementation duplicated them locally. This is a deviation from the preferred approach, acknowledged as a non-blocking implementation detail in the Tasks artifact.

## Open Questions

1. **Task 9 completeness**: The apply-progress notes Task 9 (TUI routing and integration tests) as pending. The existing `developer-team-flow.test.tsx` covers component rendering but not navigation routing, config write verification, or back-navigation behavior. Should Task 9 be completed before this change is considered fully implemented, or is the current test coverage acceptable for the scope claimed?

2. **Override skipReason regression**: The pipeline's override-context loss means the existing quality-router override message is a regression in the personality-aware path. Was this behavior intentionally deferred, or should it be fixed as part of this change?

3. **Rollback compatibility**: The design notes that older code will reject unknown top-level fields. If a user rolls back Deck while `.deck/config.json` still contains `orchestratorPersonality`, the old validator will throw. Is a compatibility shim needed, or is manual field removal the accepted rollback procedure?
