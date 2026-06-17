# Review Report: Enforce English Agent Artifacts

## Summary

**Overall Rating**: APPROVE
**Scope**: general (core content composition, orchestrator reinforcement, leak removal, adapter test coverage)
**Files Reviewed**: 13

## Re-review Context

This is a re-review after Apply completed the prior review-requested minor fix. The previous review (APPROVE WITH CHANGES) identified one MINOR finding requiring action:

> `deck-init` and `deck-onboard` agents were missing from the language policy test iteration (`DEVELOPER_AGENT_IDS`), leaving them unverified for policy presence and leak absence despite being catalog members with real content in `REAL_CONTENT`.

**Fix applied**: A new `LANGUAGE_POLICY_TEST_AGENT_IDS` constant was introduced in `content-registry.test.ts` (lines 37-41) that spreads `DEVELOPER_AGENT_IDS` and adds `"deck-init"` and `"deck-onboard"`. The language policy composition tests (lines 875, 889) now iterate over this expanded array, closing the coverage gap for all 14 `REAL_CONTENT` keys.

**Verification**: All 202 core tests pass (963 expect() calls) and all 194 adapter tests pass (1386 expect() calls). The fix is minimal, well-scoped, and correctly resolves the identified gap without affecting other test iterations that use `DEVELOPER_AGENT_IDS` for artifact-writing-agent-specific assertions.

## Ratings by Dimension

| Dimension | Rating | Notes |
|---|---|---|
| Architecture | ✅ Strong | Central policy in `content-registry.ts` is the correct single-authority location. Composition order is well-designed. No adapter changes needed — inheritance through existing paths. |
| Security | ✅ Strong | No new external inputs, auth changes, or injection risks. Literal exceptions are well-scoped. |
| Scalability | ✅ Strong | Single constant + helper pattern scales to future agents automatically. Negligible prompt-size increase. |
| Maintainability | ✅ Strong | One authoritative source, clean helper, uniform composition. Future agents inherit the policy without additional work. Coverage gap from prior review is now closed. |
| Code Quality | ✅ Strong | Well-named exports, good JSDoc, consistent patterns across all composition paths. New `LANGUAGE_POLICY_TEST_AGENT_IDS` constant is clearly documented with its purpose. |
| Backend | ✅ Strong | Adapter tests verify propagation to all planned OpenCode and Pi output surfaces. No adapter API changes. |
| Frontend | N/A | No frontend changes. |
| Integration | ✅ Strong | Orchestrator reinforcement aligns with central policy without duplication. User-facing language requirement preserved. |
| Economy / Critical Judgment | ✅ Strong | Changes are minimal, localized, and necessary. No avoidable abstractions or dependencies. Test coverage is comprehensive and justified by Spec requirements. |

### Economy / Critical Judgment

The implementation is well within the advisory budget (~200-350 lines estimated vs. 400-line threshold). The central policy constant, composition helper, orchestrator reinforcement, and expanded test iteration are the minimum necessary surfaces. Test additions are justified by the Spec's requirement to verify every Developer Team agent and every adapter output surface. No over-engineering detected.

## Findings

### BLOCKER

None.

### MAJOR

None.

### MINOR

- **Maintainability / Deny-list Scope (pre-existing, documented)**: The `prompt-memory-injection.test.ts` file in `adapter-opencode` contains Spanish-language test descriptions using the plural form `herramientas` (e.g., "herramientas reales", "herramientas obsoletas"). These are pre-existing test names, not generated Developer Team content. The current deny-list checks only the singular `herramienta`, so these do not trigger false positives.
  - **File**: `packages/adapter-opencode/src/prompt-memory-injection.test.ts` — multiple lines
  - **Evidence**: Spanish test names like `"prompt NO contiene herramientas obsoletas"` exist in this pre-existing file.
  - **Recommendation**: No action required for this change. Document as a known pre-existing condition for future deny-list expansion decisions.

### NIT

- **Code Quality**: The `appendDeveloperTeamLanguagePolicy` JSDoc could mention the empty-input edge case behavior (returns content unchanged for empty/whitespace-only inputs) for defensive-programming clarity.
  - **File**: `packages/core/src/teams/developer/content-registry.ts` — line 198
  - **Recommendation**: Add a one-line note: "Returns content unchanged if content is empty or whitespace-only."

- **Traceability**: The `DEVELOPER_TEAM_LANGUAGE_POLICY` constant JSDoc could reference the Spec REQ-IDs (REQ-LANG-001, REQ-LANG-002, REQ-LANG-003) for audit traceability.
  - **File**: `packages/core/src/teams/developer/content-registry.ts` — lines 170-177
  - **Recommendation**: Add `Covers: REQ-LANG-001, REQ-LANG-002, REQ-LANG-003` to the JSDoc block.

## Design Fidelity

Does the implementation match the Design artifact?
- **Aligned**: Yes
- **Deviations**: None material. The implementation follows the Design's proposed architecture precisely:
  1. Central policy constant + helper in `content-registry.ts` ✅
  2. Composition order: invariants → base → context-authority → language policy → capability instructions ✅
  3. Orchestrator reinforcement in `orchestrator-content.ts` with `## Language Policy` section ✅
  4. Known leak removal from Serena bundle and all three apply-agent content files ✅
  5. No adapter contract changes — inheritance verified through tests ✅
  6. Fallback path receives the policy ✅
  7. Test coverage includes all 14 `REAL_CONTENT` keys (12 `deck-developer-*` + `deck-init` + `deck-onboard`) ✅

## Test Results

All tests pass:
- `content-registry.test.ts` + `orchestrator-content.test.ts`: 202 pass, 0 fail (963 expect() calls)
- `prompt-generation.test.ts` + `developer-team-install.test.ts` (OpenCode) + `developer-team-install.test.ts` (Pi) + `pi-team-profile.test.ts`: 194 pass, 0 fail (1386 expect() calls)

## Leak Verification

`herramienta` is confirmed absent from all production source files. The term appears only in:
- Test assertion strings (`.not.toContain("herramienta")`) — correct usage as deny-list check
- A comment in `bundle-parity.test.ts` documenting the intentional hash change
- Pre-existing Spanish test names in `prompt-memory-injection.test.ts` (plural form `herramientas`, not in scope)

## Scope Boundary Verification

All changed files are within the Deck repository. No installed runner files outside the Deck repo were modified. This confirms compliance with REQ-LANG-003 and REQ-ADAPT-003.

## Open Questions

- Should the deny-list be expanded beyond `herramienta` in a follow-up change, and if so, should pre-existing Spanish test names in `prompt-memory-injection.test.ts` be addressed first?
