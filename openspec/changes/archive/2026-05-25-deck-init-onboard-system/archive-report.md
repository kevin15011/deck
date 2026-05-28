# Archive Report: deck-init-onboard-system

## Change Summary

**Change**: deck-init-onboard-system
**Status**: ✅ Archived
**Archive Location**: `openspec/changes/archive/2026-05-25-deck-init-onboard-system/`

### Lifecycle
- **Proposal**: 2026-05-25 — Add deck-init and deck-onboard bootstrap skills with orchestrator init gate
- **Spec + Design**: 2026-05-25 — Parallel completion, 22 requirements defined
- **Tasks**: 2026-05-25 — 9 tasks created across 4 waves
- **Apply**: 2026-05-25 — All 9 tasks completed
- **Verify**: 2026-05-25 — FAIL (1 test failure, build check failure)
- **Review**: N/A — No review report
- **Archive**: 2026-05-25 — Archived with verification issues documented

## Traceability Matrix

| REQ-ID | Task | Implementation | Verify Result | Review Rating |
|---|---|---|---|---|
| REQ-init-001..012 | Tasks 1-6 | ✅ Implemented | ✅ PASS | N/A |
| REQ-onboard-001..007 | Tasks 7 | ✅ Implemented | ❌ FAIL | N/A |
| REQ-triage-001..004 | Task 5, 8 | ✅ Implemented | ✅ PASS | N/A |

## Verification

**Result**: FAIL
**Critical Findings**: 1 (Core purity audit failure)
**Warnings**: 1 (Build check failure - missing entrypoints)
**Tests**: 1171 / 1172 passed

### Critical Issues
- `bun test packages/core/` fails: core purity audit reports forbidden concrete provider/runner string literals in non-test core source
  - `skills/bootstrap/deck-init-content.ts:31` contains `engram`
  - `skills/bootstrap/deck-init-content.ts:108` contains `opencode`
- Build check fails: `bun build --no-typecheck` exits 1 (no entrypoints)

## Review

**Rating**: N/A — No review phase completed

## Follow-ups

- **HIGH**: Fix core purity audit failures in `deck-init-content.ts` (remove forbidden string literals)
- **HIGH**: Resolve build entrypoints issue or document expected build command
- **MEDIUM**: Complete review phase if required before production use

> Follow-ups require attention before this change is production-ready.

## Project AI Notes (Phase 5 — Deferred)

Project AI notes are a planned Phase 5 feature under `.deck/ai-notes/`. Not yet active.

### Extracted Learnings

- Core package purity audit requires skill content to avoid concrete provider/runner string literals
- Build checks need valid entrypoints or should be skipped for non-buildable packages
- Verify phase should distinguish between functional test failures and build configuration issues

## Artifacts Archived

| Artifact | Path |
|---|---|
| Proposal | `proposal.md` |
| Spec | `spec.md` |
| Design | `design.md` |
| Tasks | `tasks.md` |
| Verify Report | `verify-report.md` |
| Archive Report | `archive-report.md` |
| State | `state.yaml` |
| Events | `events.yaml` |

## Compliance Summary

| Requirement Type | Count | Status |
|---|---|---|
| Must | 15 | 14 PASS, 1 FAIL |
| Should | 7 | 6 PASS, 1 SKIP |

## Notes

This change was archived with verification failures documented. The functional implementation is complete (all 9 tasks, 1171/1172 tests passing), but two issues prevent full compliance:
1. Core purity audit violations in skill content
2. Build configuration issue

These are fixable in a follow-up change or should be addressed before marking complete.
