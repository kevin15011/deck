# Apply Progress: consolidate-code-review-quality

## Completed Tasks

### Task 1: Add code-review-and-quality reference in REVIEW_AGENT_BODY Instructions
**Status**: ✅ Complete
**Files Changed**
- `packages/core/src/teams/developer/review-content.ts` — modify

**Description**: Added reference to code-review-and-quality for five-axis criteria in Instructions line.

### Task 2: Add code-review-and-quality reference in REVIEW_SKILL_BODY Step 3 preamble
**Status**: ✅ Complete
**Files Changed**
- `packages/core/src/teams/developer/review-content.ts` — modify

**Description**: Added reference to code-review-and-quality at Step 3 preamble.

### Task 3: Add code-review-and-quality reference in REVIEW_SKILL_BODY Rules
**Status**: ✅ Complete
**Files Changed**
- `packages/core/src/teams/developer/review-content.ts` — modify

**Description**: Added reference to code-review-and-quality for five-axis methodology, severity classification, and honesty in evidence-based assessments.

### Task 4: Update review-content.test.ts with code-review-and-quality assertions
**Status**: ✅ Complete
**Files Changed**
- `packages/core/src/teams/developer/review-content.test.ts` — modify

**Verification**
- Tests: pass (20 tests, 0 fail)
- Build: pass
- Typecheck: N/A (single tsconfig)

## Notes
- Parser issue was caused by inserting raw backticks inside template literal strings — avoided by using plain text references without raw backticks.
- All three target locations updated with code-review-and-quality references.
- Tests expanded to verify references exist.