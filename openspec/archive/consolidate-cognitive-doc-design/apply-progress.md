# Apply Progress: Consolidate Cognitive Doc Design Guidance

## Completed Tasks

### Task 1: Add canonical line to 6 prose-shape SKILL_BODY modules
**Status**: ✅ Complete
**Files Changed**
- `packages/core/src/teams/developer/proposal-content.ts` — modify
- `packages/core/src/teams/developer/spec-content.ts` — modify
- `packages/core/src/teams/developer/design-content.ts` — modify
- `packages/core/src/teams/developer/task-content.ts` — modify
- `packages/core/src/teams/developer/review-content.ts` — modify
- `packages/core/src/teams/developer/verify-content.ts` — modify

**Verification**
- Tests: pass
- Build: pass
- Typecheck: pass

**Notes**
Added canonical line `Follow the cognitive-doc-design skill for artifact structure and documentation patterns.` as second prose line under `## Rules` after existing `using-agent-skills` line.

### Task 2: Add canonical line to explorer SKILL_BODY module
**Status**: ✅ Complete
**Files Changed**
- `packages/core/src/teams/developer/explorer-content.ts` — modify

**Verification**
- Tests: pass
- Build: pass
- Typecheck: pass

**Notes**
Added canonical line as 10th bullet in `## Rules` section.

### Task 3: Add cognitive-doc-design canonical-line assertions to 6 prose-shape test files
**Status**: ✅ Complete
**Files Changed**
- `packages/core/src/teams/developer/proposal-content.test.ts` — modify
- `packages/core/src/teams/developer/spec-content.test.ts` — modify
- `packages/core/src/teams/developer/design-content.test.ts` — modify
- `packages/core/src/teams/developer/task-content.test.ts` — modify
- `packages/core/src/teams/developer/review-content.test.ts` — modify
- `packages/core/src/teams/developer/verify-content.test.ts` — modify

**Verification**
- Tests: pass
- Build: pass
- Typecheck: pass

**Notes**
Extended existing `describe("Canonical line replacement")` with parallel assertions for cognitive-doc-design line. Used exact pattern: CDD_CANONICAL_LINE constant, 4 assertions (exact count, no bullet variant, AGENT immutability, Rules preserved).

### Task 4: Add cognitive-doc-design canonical-line assertions to explorer test file
**Status**: ✅ Complete
**Files Changed**
- `packages/core/src/teams/developer/explorer-content.test.ts` — modify

**Verification**
- Tests: pass
- Build: pass
- Typecheck: pass

**Notes**
Added new `describe("Cognitive doc design canonical line")` block. 3 assertions (exact count, AGENT immutability, Rules preserved). No bullet-variant negation since explorer uses bullet form by design.

### Task 5: Run full test suite and verify no regression
**Status**: ✅ Complete
**Verification**
- Tests: pass
- Build: pass
- Typecheck: pass

**Notes**
`bun test` passes 239 tests across 7 files. No regressions. No snapshot updates needed.

## In-Progress Tasks

None.

## Blocked Tasks

None.

## Remaining Tasks

None — all 5 tasks complete.