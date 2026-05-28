# Review Report: Mejoras de Arquitectura del Developer Team v2 — Rerun After Fixes

## Summary

**Overall Rating**: APPROVE WITH CHANGES
**Scope**: general (backend + integration)
**Files Reviewed**: 13

## Ratings by Dimension

| Dimension | Rating | Notes |
|---|---|---|
| Architecture | ⚠️ Adequate | #2 and #9 are well-structured; #1 is deferred (conscious decision); #7 validation is now robust |
| Security | ✅ Strong | No new attack surfaces; no user input parsing beyond existing agentId strings |
| Scalability | ✅ Strong | Pure functions, lightweight Result wrapper, no performance regressions |
| Maintainability | ⚠️ Adequate | #2 and #9 add good structure; #1 deferred creates mild dead-code risk; #7 validation is now sound |
| Code Quality | ✅ Strong | Good naming and comments; critical bugs fixed; remaining issues are minor |
| Backend | ⚠️ Adequate | Result pattern and validation are solid; fallback logic is now correct; minor algorithm and semantic nits remain |
| Frontend | N/A | No frontend changes |
| Integration | ✅ Strong | Legacy wrappers preserve compatibility; adapters correctly isolated |

## Previous Findings — Resolved

The following findings from the initial review have been verified as fixed:

1. **#2 Fallback returns generic content for unknown agents (MAJOR)** — ✅ RESOLVED
   - `content-registry.ts` lines 278–302: Fallback branch now guarded by `if (catalogAgent)`. Agents not in the catalog correctly receive `fallbackAvailable: false` even when `fallback: true`.

2. **#3 Strict mode placeholder detection misses manifest-built placeholders (MAJOR)** — ✅ RESOLVED
   - `manifest.ts` lines 109–118: `usedPlaceholder = true` is now set unconditionally in the `else` branch when `contentResult.ok` is false, ensuring strict mode correctly reports placeholder agents.

3. **#4 Memory/capability conflict is global, not per-agent/per-surface (MAJOR)** — ✅ RESOLVED
   - `manifest.ts` lines 174–207: Conflict detection now builds a `Map<agentId:surface, isGlobal>` for memory bundle targets and checks against capability instruction surfaces on a per-target basis. Warnings are emitted per `(agentId, surface)` pair.

4. **#5 TypeScript errors: vitest → bun:test, Result narrowing (MINOR)** — ✅ RESOLVED
   - `content-registry.test.ts` and `manifest.test.ts` both use `bun:test` imports.
   - Result narrowing uses proper `if (result.ok)` / `if (!result.ok)` guards with no type assertions needed.

## Findings — Remaining

### MINOR
- **Backend**: Fallback content semantics are misleading for catalog agents without real content
  - **File**: `packages/core/src/teams/developer/content-registry.ts` — lines 280–298, 389–421
  - **Evidence**: When `options.fallback` is true and `catalogAgent` exists but lacks `REAL_CONTENT`, the code calls `getUnknownAgentContent(agentId, [])`. That function generates content saying "This agent is not recognized by the Developer Team content registry." This is semantically incorrect — the agent IS recognized (it's in the catalog), it merely lacks detailed content. This contradicts the intent of REQ-REG-007 which says fallback content "DEBERÍA ser un prompt genérico que identifique al agente por agentId y su displayName del catálogo."
  - **Recommendation**: Pass `catalogAgent.displayName` into `getUnknownAgentContent` (or a new `getFallbackAgentContent` function) and generate content that says the agent is recognized but content is pending, rather than "not recognized."

- **Backend**: Suggestions algorithm has a counterintuitive prefix condition
  - **File**: `packages/core/src/teams/developer/content-registry.ts` — line 343
  - **Evidence**: `if (id.startsWith(query) || query.startsWith(id))` — the second clause (`query.startsWith(id)`) means a short candidate ID that is a prefix of the query gets score 0. This can rank very short IDs (e.g., `deck`) above closer Levenshtein matches for long queries.
  - **Recommendation**: Remove `query.startsWith(id)` from the prefix-match condition, or cap the length ratio (e.g., only score 0 if `id.startsWith(query)` or if the query is at least 80% of the candidate length).

### NIT
- **Code Quality**: `getUnknownAgentContent` parameter `_suggestions` is unused and misleading
  - **File**: `packages/core/src/teams/developer/content-registry.ts` — line 389
  - **Recommendation**: Remove the unused parameter, or use it to populate a "Did you mean?" section in the fallback content.

- **Code Quality**: `runner-capability-validation.ts` could use `keyof RunnerCapabilities` instead of `string[]` for constants
  - **File**: `packages/core/src/runner-capability-validation.ts` — lines 4–21
  - **Recommendation**: Type `REQUIRED_CAPABILITIES` and `OPTIONAL_CAPABILITIES` as `readonly (keyof RunnerCapabilities)[]` for stronger compile-time safety.

## Findings — New (none introduced by fixes)

No new issues were introduced by the four fixes applied. The code changes are clean, well-scoped, and preserve existing behavior.

## Design Fidelity

Does the implementation match the Design artifact?
- **Aligned**: Partially
- **Deviations**:
  1. **#1 Common Fragments deferred**: `common-fragments.ts` exists but no builder consumes it, and it only covers `adaptive-memory`. This is a conscious deferral of REQ-FRAG-002 ("Cada builder existente DEBE consumir fragments del módulo common-fragments"). The justification is that builder refactoring was deemed higher-risk than the value gained in this SDD cycle, and the module remains available for a follow-up refactor. This deviation is noted and accepted as deferred, but an explicit follow-up task or ADR should be created to prevent the module from becoming permanent dead code.
  2. **Design specified `buildBaseFragment(packageId, surface)`** as a single function. Implementation has per-package, per-surface arrays (`adaptiveMemoryAgentCommonFragments()`). This is a justified granularity shift (per Design tradeoff discussion), but the resulting module is package-specific and only covers adaptive-memory.
  3. **Design said adapters must be updated** for `ManifestBuildResult`. Apply progress discovered adapters have separate manifest implementations and no changes were needed. This deviation is justified and actually reduces risk.
  4. **Design specified `ManifestBuildResult` return type** and legacy wrapper. Implemented correctly.
  5. **Design specified `Result<T,E>` local to content-registry**. Implemented correctly.
  6. **Design specified Levenshtein ≤ 3 + prefix match, cap 3**. Implemented correctly (with the minor prefix clause caveat noted above).

## Open Questions

1. Is there a tracked follow-up task for completing the `common-fragments` integration into all four builders? If not, should one be created before this SDD is archived?
2. Should `getUnknownAgentContent` be renamed to better reflect its dual use (completely unknown agents vs. catalog agents without real content)?

> If none, write "None."
