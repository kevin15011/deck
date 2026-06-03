# Design: consolidate-code-review-quality

## Summary

**Change ID**: consolidate-code-review-quality  
**Design Owner**: deck-developer-design

## Technical Design

### File Changes

| File | Change Type | Locations |
|---|---|---|
| `packages/core/src/teams/developer/review-content.ts` | Modify | 3 |
| `packages/core/src/teams/developer/review-content.test.ts` | Modify | Test assertions |

### Implementation Details

#### review-content.ts Changes

**Location 1**: `REVIEW_AGENT_BODY` constant — Instructions section
- Add reference to `code-review-and-quality` for five-axis criteria
- Preserve existing terminal role instructions
- Avoid raw backticks inside template literal

**Location 2**: `REVIEW_SKILL_BODY` constant — Step 3 preamble
- Add reference to `code-review-and-quality` for five-axis methodology
- Preserve existing Step 3 instructions

**Location 3**: `REVIEW_SKILL_BODY` constant — Rules section
- Add reference to `code-review-and-quality` for five-axis methodology, severity classification, and honesty/evidence-based assessments
- Preserve existing severity labels (BLOCKER/MAJOR/MINOR/NIT)

#### review-content.test.ts Changes

Add assertions to verify:
1. `REVIEW_AGENT_BODY` contains "code-review-and-quality"
2. `REVIEW_SKILL_BODY` contains "code-review-and-quality"
3. Deck SDD contract elements preserved:
   - Scopes: "general", "backend", "frontend", "integration"
   - Registry reference
   - Artifact path: "review-report.md"
   - Severity labels: "BLOCKER", "MAJOR", "MINOR", "NIT"
   - Output templates

### Constraints

- **No raw backticks**: References must use plain text inside template literals to avoid parser issues
- **No generated file changes**: Do not modify `build-info.generated.ts` or other generated files
- **Preserve Deck contract**: All SDD-specific requirements remain intact

### Testing Strategy

1. **Focused tests**: Run `bun test packages/core/src/teams/developer/review-content.test.ts`
2. **Suite tests**: Run `bun test packages/core/src/teams/developer/`
3. **Build**: Verify `bun run build:dry-run` passes
4. **Typecheck**: Verify affected files compile (repo-wide failures are out of scope)

### Risk Mitigation

- **Parser safety**: Use plain text references without raw backticks
- **Contract preservation**: Test assertions verify all Deck SDD requirements remain
- **Test coverage**: 20 focused tests validate changes
