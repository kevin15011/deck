# Proposal: consolidate-code-review-quality

## Summary

**Change ID**: consolidate-code-review-quality  
**Type**: Refactoring / Code Quality Integration  
**Scope**: General Apply (deck-developer-apply-general)

## Intent

Partial canonicalization of the Deck Review Agent to use the external `code-review-and-quality` skill for five-axis review criteria, while preserving the Deck SDD contract for review roles, scopes, artifact handling, and output templates.

## Problem Statement

The Deck Review Agent (`review-content.ts`) currently defines five-axis review criteria inline. This creates maintenance duplication with the canonical `code-review-and-quality` skill, which provides the same multi-axis quality model (architecture, security, scalability, maintainability, code quality).

## Proposed Approach

Add explicit references to `code-review-and-quality` in the Deck Review Agent body to canonicalize the criteria source while preserving Deck-specific SDD requirements:

1. **REVIEW_AGENT_BODY**: Reference `code-review-and-quality` in Instructions section for five-axis criteria
2. **REVIEW_SKILL_BODY**: Reference `code-review-and-quality` in Step 3 preamble and Rules for five-axis methodology
3. **Preserve Deck SDD contract**:
   - Scopes: `general`, `backend`, `frontend`, `integration`
   - Registry persistence/deferred-mode instructions
   - `review-report.md` artifact path and persistence
   - Output templates (review report, return summary)
   - Severity labels: BLOCKER/MAJOR/MINOR/NIT

## Scope

### In Scope
- `packages/core/src/teams/developer/review-content.ts` — add references to `code-review-and-quality`
- `packages/core/src/teams/developer/review-content.test.ts` — add assertions for new references
- Verification: focused tests, build, typecheck

### Out of Scope
- Modifying actual review behavior or logic
- Changes to skill implementation
- Changes to other artifacts or agents

## Risks

- **Low**: Static content changes with tests; no runtime behavior modification
- **Mitigation**: Ensure no raw backticks in template literals; verify tests pass

## Rollback Plan

1. Revert changes to `packages/core/src/teams/developer/review-content.ts`
2. Revert changes to `packages/core/src/teams/developer/review-content.test.ts`
3. Run tests to verify original state

## Success Criteria

- [ ] `REVIEW_AGENT_BODY` references `code-review-and-quality` for five-axis criteria
- [ ] `REVIEW_SKILL_BODY` references `code-review-and-quality` in Step 3 preamble
- [ ] `REVIEW_SKILL_BODY` references `code-review-and-quality` in Rules
- [ ] Deck SDD contract preserved (scopes, registry, artifacts, templates, severity labels)
- [ ] Tests pass (focused + developer-team suite)
- [ ] Build passes
