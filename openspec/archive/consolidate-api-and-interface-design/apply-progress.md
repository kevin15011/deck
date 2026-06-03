# Apply Progress: Consolidate API and Interface Design Guidance

## Completed Tasks

### Task 1: Add canonical line to apply-agent source files
**Status**: ✅ Complete
**Files Changed**
- `packages/core/src/teams/developer/apply-backend-content.ts` — modify
- `packages/core/src/teams/developer/apply-general-content.ts` — modify

**Verification**
- Tests: pass
- Build: n/a
- Typecheck: n/a

**Notes**
Added canonical line after `using-agent-skills` line in both APPLY_BACKEND_SKILL_BODY and APPLY_GENERAL_SKILL_BODY. `GIT_DISCARD_PROTECTION_RULE` import and interpolation preserved. `## Serena Enforcement` heading preserved.

### Task 2: Add canonical line to phase-agent source files
**Status**: ✅ Complete
**Files Changed**
- `packages/core/src/teams/developer/design-content.ts` — modify
- `packages/core/src/teams/developer/spec-content.ts` — modify
- `packages/core/src/teams/developer/review-content.ts` — modify

**Verification**
- Tests: pass
- Build: n/a
- Typecheck: n/a

**Notes**
Added canonical line after `cognitive-doc-design` line in DESIGN_SKILL_BODY, SPEC_SKILL_BODY, and REVIEW_SKILL_BODY. `GIT_SAFETY_SENTINEL` preserved. Inline template sections unchanged.

### Task 3: Add test assertions to apply-agent test files
**Status**: ✅ Complete
**Files Changed**
- `packages/core/src/teams/developer/apply-backend-content.test.ts` — modify
- `packages/core/src/teams/developer/apply-general-content.test.ts` — modify

**Verification**
- Tests: pass
- Build: n/a
- Typecheck: n/a

**Notes**
Added `describe("API and interface design canonical line")` block after existing `Canonical line replacement` block in both test files. Contains 4 assertions per spec. Minor fix: CDD_CANONICAL_LINE reference corrected to inline string in "both canonical lines exist" test.

### Task 4: Add test assertions to phase-agent test files
**Status**: ✅ Complete
**Files Changed**
- `packages/core/src/teams/developer/design-content.test.ts` — modify
- `packages/core/src/teams/developer/spec-content.test.ts` — modify
- `packages/core/src/teams/developer/review-content.test.ts` — modify

**Verification**
- Tests: pass
- Build: n/a
- Typecheck: n/a

**Notes**
Added `describe("API and interface design canonical line")` block after `Cognitive doc design canonical line` block in all 3 test files. Contains 4 assertions. review-content.test.ts includes assertion for distinctness from `code-review-and-quality`. Minor fix: CDD_CANONICAL_LINE reference corrected.

### Task 5: Full integration verification
**Status**: ✅ Complete
**Files Changed**
- Read-only verification

**Verification**
- Tests: pass (199 tests, 0 failures)
- Build: n/a
- Typecheck: n/a

**Notes**
All 5 test files pass. Canonical line appears exactly once in each of 5 SKILL_BODY exports. Canonical line does not appear in any AGENT_BODY export. `GIT_DISCARD_PROTECTION_RULE` and `GIT_SAFETY_SENTINEL` assertions pass. `git diff --stat` shows exactly 10 modified files (5 source + 5 test). Total 130 insertions.

## In-Progress Tasks

None — all tasks complete.

## Blocked Tasks

None — no blockers encountered.

## Remaining Tasks

None — all 5 tasks completed.

## Summary

All 5 tasks implemented and verified. 10 files modified (5 source content files + 5 test files). All tests pass. No regressions. Git safety maintained. Ready for Verify/Review.