# Archive Report: Fix Update/Upgrade Detection and Orchestrator Invariants

## Change Summary

**Change**: fix-update-upgrade-and-orchestrator-invariants
**Status**: ✅ Archived
**Archive Location**: `openspec/archive/fix-update-upgrade-and-orchestrator-invariants/`

### Lifecycle
- **Proposal**: 2026-06-04 — Fix same-version/different-commit upgrade detection and enforce Orchestrator SDD invariants
- **Spec + Design**: 2026-06-04 — Parallel, both completed
- **Tasks**: 2026-06-04 — 10 tasks created
- **Apply**: 2026-06-04 — 10 tasks completed + 5 repair cycles
- **Verify**: 2026-06-04 — PASS WITH WARNINGS
- **Review**: 2026-06-04 — APPROVE WITH CHANGES
- **Archive**: 2026-06-04 — Archived

## Traceability Matrix

| REQ-ID | Task | Implementation | Verify Result | Review Rating |
|---|---|---|---|---|
| REQ-UD-001 | T3 | ✅ | ✅ PASS | ✅ Adequate |
| REQ-UD-002 | T3 | ✅ | ✅ PASS | ✅ Adequate |
| REQ-UD-003 | T3 | ✅ | ✅ PASS | ✅ Adequate |
| REQ-UD-004 | T3 | ✅ | ✅ PASS | ✅ Adequate |
| REQ-UD-005 | T5/T6 | ✅ | ✅ PASS | ✅ Adequate |
| REQ-UD-006 | T2 | ✅ | ✅ PASS | ✅ Adequate |
| REQ-UD-007 | T6 | ✅ | ✅ PASS | ✅ Adequate |
| REQ-UD-008 | T3 | ✅ | ✅ PASS | ✅ Adequate |
| REQ-UD-009 | T3 | ✅ | ✅ PASS | ✅ Adequate |
| REQ-RM-001 | T2 | ✅ | ✅ PASS | ✅ Adequate |
| REQ-RM-002 | T2 | ✅ | ✅ PASS | ✅ Adequate |
| REQ-RM-003 | T2 | ✅ | ✅ PASS | ✅ Adequate |
| REQ-RM-004 | T4 | ✅ | ✅ PASS | ✅ Adequate |
| REQ-RM-005 | T4 | ✅ | ✅ PASS | ⚠️ MINOR (no direct test) |
| REQ-OA-001 | T7/T8 | ✅ | ✅ PASS | ✅ Adequate |
| REQ-OA-002 | T7/T8 | ✅ | ✅ PASS | ✅ Adequate |
| REQ-OA-003 | T7 | ✅ | ✅ PASS | ✅ Adequate |
| REQ-OA-004 | T7/T8 | ✅ | ✅ PASS | ✅ Adequate |
| REQ-OA-005 | T7/T9 | ✅ | ✅ PASS | ⚠️ MINOR (no install-time e2e test) |
| REQ-OA-006 | T8 | ✅ | ✅ PASS | ✅ Adequate |
| REQ-OA-007 | T7/T8 | ✅ | ✅ PASS | ✅ Adequate |
| REQ-OA-008 | T10 | ✅ | ✅ PASS | ✅ Adequate |
| REQ-OA-009 | T9/T10 | ✅ | ✅ PASS | ⚠️ MINOR (install-time e2e gap) |
| REQ-OA-010 | T1 | ✅ | ✅ PASS | ✅ Adequate |

## Verification

**Result**: PASS WITH WARNINGS
**Critical Findings**: 0
**Warnings**: 1 (pre-existing repo-wide typecheck errors, not change-related)

## Review

**Rating**: APPROVE WITH CHANGES
**Blockers**: 0
**Major Findings**: 0 (M1 downgraded from MAJOR to MINOR post-Repair #5)

## Follow-ups

- **MINOR**: Add end-to-end integration test for authorization option in `developer-team-install.test.ts` — `packages/adapter-opencode/src/developer-team-install.test.ts` — Suggested owner: General Apply
- **MINOR**: Export `validateBuildInfoStaleness` with dedicated unit test for short/full SHA mismatch path — `scripts/prepare-release.ts` — Suggested owner: General Apply
- **MINOR**: Expand dev-build detection heuristic to cover `/-/` pre-release identifiers — `apps/cli/src/upgrade-command/github-release.ts` — Suggested owner: General Apply
- **MINOR**: Remove schema cast in descriptor commit; use `descriptor.commit ?? remoteCommit` directly — `apps/cli/src/upgrade-command/github-release.ts:301` — Suggested owner: General Apply
- **MINOR**: Replace type cast in `release-check.ts:213` with exhaustive switch — `apps/cli/src/tui/release-check.ts` — Suggested owner: General Apply
- **MINOR**: Drop explicit `===` in prefix-match or add comment explaining intent — `apps/cli/src/upgrade-command/github-release.ts:566` — Suggested owner: General Apply

> All follow-ups can be batched into a single follow-up change.

## Project AI Notes (Phase 5 — Deferred)

> Project AI notes are a planned Phase 5 feature under `.deck/ai-notes/`. Not yet active.

### Extracted Learnings

- Track A: Same-version/different-commit detection requires both local and remote commit metadata to be reliable before claiming availability
- Track B: Defense-in-depth requires (1) pre-delegation gate in orchestrator, (2) authorization card in apply-agent prompts, (3) static semantic tests — prompt text alone was bypassed in the incident
- Track B: The self-rejection paradox is resolved when authorization cards are injected at runtime; static placeholder always triggers "always refuse"
- Track A: Dev builds (`*-dev`) should skip commit-based comparison to avoid false positives

---

## Git Suggestion Context

- **Conventional commit type**: `feat` (new capability: commit-aware upgrade detection + orchestrator authorization gates)
- **Scope**: `apps/cli/`, `packages/core/`, `packages/adapter-opencode/`, `scripts/`
- **Key changes**:
  - Added `commit` field to `ReleaseInfo` with population from `target_commitish` and descriptor
  - Added `decideReleaseAvailability()` decision helper for same-version/different-commit detection
  - Added `ModificationAuthorization` type, `renderDelegationGate()`, `renderApplyAuthorizationCard()` in orchestrator-invariants.ts
  - Added Pre-Delegation Checklist and automatic-mode non-bypass text in orchestrator-content.ts
  - Added authorization card injection in adapter prompt-generation layer
  - Added staleness validation in prepare-release.ts with `--commit` override
- **Ambiguity notes**: Change spans both Track A (release detection) and Track B (orchestrator hardening), but primary value is orchestrator security fix — `feat` is appropriate. Could also be `fix` for the upgrade detection bug, but `feat` captures the new authorization system better.

---

*Archive completed 2026-06-04*
