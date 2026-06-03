# Apply Progress: Consolidate Using-Agent-Skills Guidance

## Completed Tasks

### Task 1: Replace Rules block bodies in 10 content files
**Status**: ✅ Complete

**Files Changed**
- `packages/core/src/teams/developer/apply-backend-content.ts` — modify
- `packages/core/src/teams/developer/apply-frontend-content.ts` — modify
- `packages/core/src/teams/developer/apply-general-content.ts` — modify
- `packages/core/src/teams/developer/proposal-content.ts` — modify
- `packages/core/src/teams/developer/spec-content.ts` — modify
- `packages/core/src/teams/developer/design-content.ts` — modify
- `packages/core/src/teams/developer/task-content.ts` — modify
- `packages/core/src/teams/developer/review-content.ts` — modify
- `packages/core/src/teams/developer/verify-content.ts` — modify
- `packages/core/src/teams/developer/archive-content.ts` — modify

**Verification**
- Canonical line present exactly once in all 10 files: ✅PASS
- No `- Follow the using-agent-skills` bullet variants: ✅PASS
- `${GIT_DISCARD_PROTECTION_RULE}` preserved in all files: ✅PASS
- ## Serena Enforcement preserved (3 apply files): ✅PASS

### Task 2: Add canonical-line and structural-preservation tests
**Status**: ✅ Complete

**Files Changed**
- `packages/core/src/teams/developer/apply-backend-content.test.ts` — modify (additive)
- `packages/core/src/teams/developer/apply-frontend-content.test.ts` — modify (additive)
- `packages/core/src/teams/developer/apply-general-content.test.ts` — modify (additive)
- `packages/core/src/teams/developer/proposal-content.test.ts` — modify (additive)
- `packages/core/src/teams/developer/spec-content.test.ts` — modify (additive)
- `packages/core/src/teams/developer/design-content.test.ts` — modify (additive)
- `packages/core/src/teams/developer/task-content.test.ts` — modify (additive)
- `packages/core/src/teams/developer/review-content.test.ts` — modify (additive)
- `packages/core/src/teams/developer/verify-content.test.ts` — modify (additive)
- `packages/core/src/teams/developer/archive-content.test.ts` — modify (additive)

**Verification**
- Tests: 711 pass, 0 fail

### Task 3: Full verification pass
**Status**: ✅ Complete

**Verification**
- Tests: ✅ 711 pass
- Excluded files unchanged: ✅ (orchestrator, explorer, visual-explanations)
- TypeScript: Pre-existing errors (unrelated to this change)

## Notes
- Used Serena `replace_content` for content files (fallback to edit tool when regex complex).
- Updated existing tests that asserted OLD Rules bullet text to verify canonical line presence instead.
- All AGENT_BODY exports remain byte-identical (no AGENT_BODY mutations).
- Pre-existing TypeScript errors in codebase are unrelated to this change.

## Remaining Tasks

None — all tasks complete.