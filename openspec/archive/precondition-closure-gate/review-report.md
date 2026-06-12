# Review Report: Precondition Closure Gate (Re-run)

## Summary

**Overall Rating**: APPROVE
**Scope**: general
**Files Reviewed**: 16
**Re-run Purpose**: Confirm fixes for previous MAJOR (test failure) and MINOR (frontend apply context missing), plus verify type/rule-code issues from verify report.

## Previous Findings — Fix Assessment

| # | Previous Finding | Severity | Status | Assessment |
|---|---|---|---|---|
| 1 | Test failure: "TODO" in Step 7 triggered anti-placeholder test | MAJOR | ✅ Fixed | `task-content.ts` line 194 rephrased to "a preapproved approach". Test updated with allowlist for `allowed-with-placeholder` status name. 42/42 tests pass. |
| 2 | Missing `apply-frontend-content.ts` modification | MINOR | ✅ Fixed | "Preconditions Context (read-only)" section added. All three apply agents (general, backend, frontend) now consistent. |
| 3 | Validator empty `if` block (lines 478-479) | MINOR | Not addressed | Was not in Required Fixes. Logic is correct; cosmetic only. Acceptable to defer. |
| 4 | Step renumbering comment suggestion | MINOR | Not addressed | Was optional. Acceptable to defer. |

## Verify Report Issues — Fix Assessment

| # | Verify Issue | Status | Assessment |
|---|---|---|---|
| 1 | Missing rule codes in `ValidationRuleCode` type | ✅ Fixed | `preconditions.artifact.missing` and `preconditions.artifact.not_referenced` added to both type union (schema.ts:194-195) and runtime array (schema.ts:241-242). |
| 2 | `file` field type missing `"preconditions.md"` | ✅ Fixed | `types.ts:232` now includes `"preconditions.md"` in the file union type. |

## Ratings by Dimension

| Dimension | Rating | Notes |
|---|---|---|
| Architecture | ✅ Strong | Gate design is minimal and correct. Orchestrator owns gate; Apply agents read-only. Validator warns but doesn't block. Clean separation. |
| Security | ✅ Strong | No input handling, secrets, or external integrations. Prompt content only. |
| Scalability | ✅ Strong | Gate is designed to be fast (spec: "faster than resolving simplest blocking precondition"). No performance concerns. |
| Maintainability | ✅ Strong | Consistent patterns across apply agents. Rule codes properly typed. Test coverage adequate (42 task-content + 14 validator tests). |
| Code Quality | ✅ Strong | "TODO" rephrased cleanly. Test allowlist is well-documented. Type unions in sync with runtime arrays. |
| Backend | N/A | No backend code changes. |
| Frontend | ✅ Strong | `apply-frontend-content.ts` now consistent with general and backend apply agents. |
| Integration | ✅ Strong | Orchestrator gate → events.yaml → verify optional check chain is coherent. Validator warning semantics correct (first iteration: warn, don't block). |

## Findings

### BLOCKER
None.

### MAJOR
None.

### MINOR
None new. Previous MINORs #3 and #4 remain unaddressed but were not in Required Fixes and are cosmetic.

### NIT
- **Code Quality**: Validator `if` block at lines 478-479 has an empty true-branch with a comment. Logic is correct but slightly confusing. Could simplify to inverted condition.
  - **File**: `packages/core/src/spec-registry/validator.ts` — lines 478-479
  - **Recommendation**: Defer to next touch. Not blocking.

## Test Results

| Suite | Result |
|---|---|
| task-content.test.ts | 42/42 pass ✅ |
| validator.test.ts | 14/14 pass ✅ |
| Full core suite | 1358/1359 pass ✅ |
| TypeScript (modified files) | 0 errors ✅ |
| TypeScript (full project) | Pre-existing errors in `apps/cli/` — unrelated to this change |

**Note**: The 1 core test failure (`core purity audit > non-test core source files do not contain concrete runner or provider string literals`) is pre-existing. None of the flagged files (`runner-capability-parity.ts`, `runner-adapter.ts`, `adaptive-memory.ts`) were modified by this change.

## Design Fidelity

**Aligned**: Yes
- `preconditions.md` template matches Design artifact specification.
- Orchestrator gate logic follows the data flow diagram (Task Agent → preconditions.md → Orchestrator gate → events.yaml → Apply).
- Validator existence check matches "existence only" dashed line in architecture diagram.
- Apply agents have read-only context section as designed.
- Anti-bureaucracy rules respected: no new lifecycle state, no retroactive requirements, minimal state.yaml expansion.

## Anti-Bureaucracy Assessment

- ✅ No new lifecycle phase added.
- ✅ No new state.yaml status values.
- ✅ Exploration-only changes exempt.
- ✅ `None` accepted as complete artifact.
- ✅ Validator warns, doesn't block (first iteration).
- ✅ Apply agents read-only — no re-adjudication.
- ✅ preconditions.md explicitly must NOT duplicate tasks.md.

## Open Questions

None.

## Recommendation

**APPROVE** — All MAJOR and Required Fixes from the previous review are resolved. No new blockers or majors found. Tests pass. Types clean in modified files. Design fidelity confirmed. The change is ready to proceed to Archive.
