# Tasks: consolidate-code-review-quality

## Summary

**Change ID**: consolidate-code-review-quality

## Task List

| # | Task | Owner | Status |
|---|---|---|---|
| 1 | Update review-content.ts with code-review-and-quality references | General Apply | Pending |
| 2 | Update review-content.test.ts with assertions | General Apply | Pending |
| 3 | Verify tests pass and build succeeds | Verify | Pending |

---

## Task 1: Update review-content.ts

**Status**: Pending  
**Owner**: deck-developer-apply-general

### Description

Add three references to `code-review-and-quality` in `packages/core/src/teams/developer/review-content.ts`:

1. **REVIEW_AGENT_BODY** — Instructions section: Add reference for five-axis criteria
2. **REVIEW_SKILL_BODY** — Step 3 preamble: Add reference for five-axis methodology
3. **REVIEW_SKILL_BODY** — Rules section: Add reference for five-axis methodology, severity classification, and honesty/evidence-based assessments

### Constraints
- Use plain text references (no raw backticks)
- Preserve all existing Deck SDD contract elements
- Do not modify generated files

### Acceptance Criteria
- [ ] Location 1: REVIEW_AGENT_BODY has code-review-and-quality reference
- [ ] Location 2: REVIEW_SKILL_BODY Step 3 has code-review-and-quality reference
- [ ] Location 3: REVIEW_SKILL_BODY Rules has code-review-and-quality reference
- [ ] All Deck SDD contract elements preserved

---

## Task 2: Update review-content.test.ts

**Status**: Pending  
**Owner**: deck-developer-apply-general

### Description

Add test assertions in `packages/core/src/teams/developer/review-content.test.ts` to verify:
- REVIEW_AGENT_BODY contains "code-review-and-quality"
- REVIEW_SKILL_BODY contains "code-review-and-quality"
- Deck SDD contract preserved (scopes, registry, artifacts, templates, severity labels)

### Acceptance Criteria
- [ ] Tests assert code-review-and-quality references in both bodies
- [ ] Tests assert all Deck SDD contract elements present
- [ ] All 20 tests pass

---

## Task 3: Verify

**Status**: Pending  
**Owner**: deck-developer-verify

### Description

Verify the implementation meets all requirements:
1. Run focused tests: `bun test packages/core/src/teams/developer/review-content.test.ts`
2. Run suite tests: `bun test packages/core/src/teams/developer/`
3. Run build: `bun run build:dry-run`
4. Verify typecheck on affected files
5. Verify compliance matrix against spec

### Acceptance Criteria
- [ ] Focused tests: 20/20 pass
- [ ] Suite tests: pass
- [ ] Build: passes
- [ ] Typecheck: passes on affected files
- [ ] Compliance matrix: all requirements verified
