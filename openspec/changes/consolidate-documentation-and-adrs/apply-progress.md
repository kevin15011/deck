# Apply Progress: Consolidate Documentation and ADR Guidance

## Completed Tasks

### Task 4: Fix documentation-and-adrs placement in explorer-content.ts
**Status**: ✅ Complete
**Files Changed**
- `packages/core/src/teams/developer/explorer-content.ts` — modify Rule line insertion to match established pattern (preceded by cognitive-doc-design and using-agent-skills references)

**Verification**
- Tests: pass (32 tests in explorer-content.test.ts)
- Build: pass
- Typecheck: n/a (single file test)

**Notes**
Fixed verify finding: REQ-prompt-001 placement. Added three new lines to `## Rules` section to match established ordering pattern:
1. cognitive-doc-design (preserved existing)
2. using-agent-skills (added - was missing)
3. documentation-and-adrs (exists, fixed escape)

Before fix: only had cognitive-doc-design bullet + documentation-and-adrs (broken backtick).
After fix: all three prose lines without bullets, backticks properly escaped.

## Remaining Tasks

All 9 tasks completed in previous session. This fix addresses verify finding Task 4.