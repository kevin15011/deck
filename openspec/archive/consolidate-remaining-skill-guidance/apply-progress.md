# Apply Progress: Consolidate Remaining Skill Guidance

## Completed Tasks

### Task 1: Apply Backend — add TDD reference + structural tests
**Status**: ✅ Complete
**Files Changed**
- `packages/core/src/teams/developer/apply-backend-content.ts` — modify (add TDD canonical line in `## Rules` after documentation-and-adrs)
- `packages/core/src/teams/developer/apply-backend-content.test.ts` — modify (add TDD canonical line test block)

**Verification**
- Tests: pass (42 pass / 0 fail in `apply-backend-content.test.ts`)
- Build: n/a (test command covers it)
- Typecheck: pass (no new errors in affected files)

**Notes**
Added exact canonical line after `documentation-and-adrs` line. New `Test-driven-development canonical line` describe block asserts exact-once, no-bullet-variants, AGENT_BODY immutability, ## Rules preservation.

---

### Task 2: Apply Frontend — add frontend-ui-engineering + TDD references + structural tests
**Status**: ✅ Complete
**Files Changed**
- `packages/core/src/teams/developer/apply-frontend-content.ts` — modify (add frontend-ui-engineering and TDD canonical lines)
- `packages/core/src/teams/developer/apply-frontend-content.test.ts` — modify (add 2 canonical line test blocks)

**Verification**
- Tests: pass (61 pass / 0 fail)
- Typecheck: pass

**Notes**
Added 2 lines in order: `frontend-ui-engineering` then `test-driven-development`. TDD placement test asserts TDD line is after the FEUI line via indexOf ordering check.

---

### Task 3: Apply General — add TDD reference + structural tests
**Status**: ✅ Complete
**Files Changed**
- `packages/core/src/teams/developer/apply-general-content.ts` — modify
- `packages/core/src/teams/developer/apply-general-content.test.ts` — modify

**Verification**
- Tests: pass (41 pass / 0 fail)
- Typecheck: pass

**Notes**
Added TDD canonical line after documentation-and-adrs. Standard test block.

---

### Task 4: Review — add frontend-ui + security + performance references + structural tests
**Status**: ✅ Complete
**Files Changed**
- `packages/core/src/teams/developer/review-content.ts` — modify (add 3 canonical lines)
- `packages/core/src/teams/developer/review-content.test.ts` — modify (add 3 canonical line test blocks)

**Verification**
- Tests: pass (52 pass / 0 fail)
- Typecheck: pass
- Existing `code-review-and-quality` reference preserved and tested

**Notes**
Added `frontend-ui-engineering`, `security-and-hardening`, `performance-optimization` in order. Each has its own describe block. No bullet variants asserted for any of the 3.

---

### Task 5: Design — add deprecation-and-migration reference + structural tests
**Status**: ✅ Complete
**Files Changed**
- `packages/core/src/teams/developer/design-content.ts` — modify
- `packages/core/src/teams/developer/design-content.test.ts` — modify

**Verification**
- Tests: pass (57 pass / 0 fail)
- Typecheck: pass

**Notes**
Added deprecation-and-migration canonical line after documentation-and-adrs.

---

### Task 6: Proposal — add conditional deprecation-and-migration reference + structural tests
**Status**: ✅ Complete
**Files Changed**
- `packages/core/src/teams/developer/proposal-content.ts` — modify
- `packages/core/src/teams/developer/proposal-content.test.ts` — modify

**Verification**
- Tests: pass (45 pass / 0 fail)
- Typecheck: pass

**Notes**
Added conditional line: "For proposals involving replacement, removal, or migration of existing systems, follow the deprecation-and-migration skill for deprecation strategy and migration planning." Conditional qualifier preserved per REQ-sel-009.

---

### Task 7: Roadmap no-op rationale + absence verification tests
**Status**: ✅ Complete
**Files Changed**
- `docs/skills-integration-roadmap.md` — modify (added "Phase 3F selective no-op decisions" section)
- `packages/core/src/teams/developer/no-op-skill-absence.test.ts` — create (shared absence test file)

**Verification**
- Tests: pass (124 pass / 0 fail)
- Full developer-team suite: 948 pass / 0 fail
- Typecheck: pass

**Notes**
- Added no-op rationale table to roadmap under Phase 3F with all 10 excluded skills classified as interactive / phase-mismatch / negligible-overlap.
- Created new shared test file `no-op-skill-absence.test.ts` (allowed by spec — "may live in a shared test file or be distributed across individual test files"). Per-surface × per-skill cross-product tests (10 skills × 12 surfaces = 120 absence assertions) plus 4 classification coverage tests = 124 total.
- The shared test file approach was chosen over distributing to all 6 individual test files because it avoids duplication and gives a single auditable home for the no-op absence guarantees (REQ-noop-001, REQ-noop-002, REQ-ver-003).

---

## In-Progress Tasks

None — all 7 tasks complete.

## Blocked Tasks

None.

## Remaining Tasks

None — all 7 tasks complete.

## Verification Summary

| Suite | Result |
|---|---|
| `apply-backend-content.test.ts` | 42 pass / 0 fail |
| `apply-frontend-content.test.ts` | 61 pass / 0 fail |
| `apply-general-content.test.ts` | 41 pass / 0 fail |
| `review-content.test.ts` | 52 pass / 0 fail |
| `design-content.test.ts` | 57 pass / 0 fail |
| `proposal-content.test.ts` | 45 pass / 0 fail |
| `no-op-skill-absence.test.ts` (new) | 124 pass / 0 fail |
| **Full `packages/core/src/teams/developer/`** | **948 pass / 0 fail / 3164 expects / 24 files** |
| Typecheck on affected files | clean (no new errors) |

## Coverage Matrix

| REQ-ID | Task(s) | Status |
|---|---|---|
| REQ-sel-001 | Task 2 | ✅ |
| REQ-sel-002 | Task 4 | ✅ |
| REQ-sel-003 | Task 1 | ✅ |
| REQ-sel-004 | Task 2 | ✅ |
| REQ-sel-005 | Task 3 | ✅ |
| REQ-sel-006 | Task 4 | ✅ |
| REQ-sel-007 | Task 4 | ✅ |
| REQ-sel-008 | Task 5 | ✅ |
| REQ-sel-009 | Task 6 | ✅ |
| REQ-noop-001 | Task 7 | ✅ |
| REQ-noop-002 | Task 7 | ✅ |
| REQ-con-001 | Tasks 1-6 | ✅ (AGENT_BODY immutability asserted per file) |
| REQ-con-002 | Tasks 1-6 | ✅ (artifact templates, return formats, registry instructions byte-identical — only `## Rules` lines added) |
| REQ-con-003 | Tasks 1-6 | ✅ (prior Phase 3A-3E references preserved: using-agent-skills, cognitive-doc-design, code-review-and-quality, api-and-interface-design, documentation-and-adrs all still tested) |
| REQ-con-004 | n/a | ✅ (no changes to git-safety.ts; GIT_SAFETY_SENTINEL still asserted in every AGENT_BODY/SKILL_BODY test) |
| REQ-ver-001 | Tasks 1-6 | ✅ |
| REQ-ver-002 | Tasks 1-6 | ✅ |
| REQ-ver-003 | Task 7 | ✅ |
| REQ-ver-004 | All | ✅ (full developer-team suite 948/948 pass) |
