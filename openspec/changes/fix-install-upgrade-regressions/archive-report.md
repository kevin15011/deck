# Archive Report: Fix Install & Upgrade Regressions

## Change Summary

**Change**: fix-install-upgrade-regressions
**Status**: ✅ Archived
**Archive Location**: `openspec/archive/fix-install-upgrade-regressions/`

### Lifecycle
- **Proposal**: 2026-06-03 — Fixed install regression (source≠id lookup) and upgrade regression (descriptor/tag validation)
- **Spec + Design**: 2026-06-03 — Parallel, both completed
- **Tasks**: 2026-06-03 — 6 tasks created (2 groups: Install Path, Upgrade Path)
- **Apply**: 2026-06-03 — 6 tasks completed with 2 fix-ups
- **Verify**: 2026-06-03 — PASS (39/39 targeted tests, build passes)
- **Review**: 2026-06-03 — APPROVE (no blockers, 5 minor follow-ups)
- **Archive**: 2026-06-03 — archived

## Traceability Matrix

| REQ-ID | Task | Implementation | Verify Result | Review Rating |
|---|---|---|---|---|
| REQ-INSTALL-001 | Task 1 | ✅ | ✅ PASS | ✅ Strong |
| REQ-INSTALL-002 | Task 2 | ✅ | ✅ PASS | ✅ Strong |
| REQ-INSTALL-003 | Task 2 | ✅ | ✅ PASS | ✅ Strong |
| REQ-INSTALL-004 | Task 1 | ✅ | ✅ PASS | ✅ Strong |
| REQ-UPGRADE-001 | Task 4 | ✅ | ✅ PASS | ✅ Strong |
| REQ-UPGRADE-002 | Task 4 | ✅ | ✅ PASS | ✅ Strong |
| REQ-UPGRADE-003 | Task 4 (fix-up) | ✅ | ✅ PASS | ✅ Strong |
| REQ-MCP-001 | Task 3 | ✅ | ✅ PASS | ✅ Strong |
| REQ-MCP-002 | Task 3 | ✅ | ✅ PASS | ✅ Strong |
| REQ-EXE-001 | Task 3 | ✅ | ✅ PASS | ✅ Strong |

## Verification

**Result**: PASS
**Critical Findings**: 0
**Warnings**: 0

- Targeted install/upgrade regression tests: 39/39 pass
- Build: PASS (dry-run)
- TypeScript: Prior error at app.tsx(798,33) fixed via explicit `Set<string>` typing

## Review

**Rating**: APPROVE
**Blockers**: 0
**Major Findings**: 0

- All 6 tasks complete with passing targeted regression tests
- Two prior MAJOR blockers (REQ-UPGRADE-003, `which` portability) correctly fixed
- Original BLOCKER (TypeScript error) fixed in final fix-up
- 5 minor + 5 nit findings carried as follow-ups

## Follow-ups

- **MINOR**: Add dependency-injection tests for `runRunnerReviewPlan` (install success → MCP write; install failure → MCP skip)
- **MINOR**: Add `release-check.test.ts` direct test for `legacyToState` with three cases
- **MINOR**: Add `binary?: string` field to `InstallableOpenCodeTool` in `@deck/adapter-opencode` to eliminate hardcoded map
- **MINOR**: Extract shared `version-validation.ts` helper (currently `isSemverLike` in github-release.ts and `isLegacyVersionValid` in release-check.ts)
- **MINOR**: Resolve capabilityId-vs-id dual-derivation risk in action-runner.ts (use single source of truth)
- **NIT**: Remove unused imports in action-runner.test.ts (beforeEach, vi)
- **NIT**: Restore `name` in install log output
- **NIT**: Deduplicate diagnostic info in failure result

> If none, write "None — change is fully closed."

## Project AI Notes (Phase 5 — Deferred)

> Project AI notes are a planned Phase 5 feature under `.deck/ai-notes/`. Not yet active.

### Extracted Learnings

- **Bug class discovered**: Any OpenCode tool where `source != id` was silently failing install (serena, context7). Fixed contract-level so all future tools work correctly.
- **Data validation**: GitHub release `release.json` version can diverge from `tag_name`. Added cross-validation and legacy fallback.
- **Cross-platform**: Unix `which` command is not available on Windows. Implemented native PATH walking with `existsSync`/`statSync`.

## Git Suggestion Context

- **Conventional commit type**: `fix` — addresses two regressions in user-facing functionality
- **Scope**: `cli/tui` (install and upgrade paths)
- **Key changes**:
  - Extended `PackageInstallerFn` contract with separate `id` (lookup) and `source` fields
  - Fixed `installPackages` callback to use catalog id for lookup, return honest failure for no-match
  - Added MCP write gating after failed install prerequisites
  - Added descriptor/tag version cross-validation with legacy fallback
  - Added cross-platform executable validation (replaced `which`)
- **Ambiguity notes**: None — both changes are bug fixes with clear `fix` classification

## Rollback Notes

- **Install path**: Revert `action-runner.ts` + `app.tsx` together for installer contract issues
- **Upgrade path**: Revert `github-release.ts` validation independently; separable from install fix
- **Tests**: Keep or remove tests aligned with active behavior

## Files Changed

```
apps/cli/src/runtime/build-info.generated.ts       |   2 +-
apps/cli/src/tui/app.tsx                           |  45 ++++++-
apps/cli/src/tui/release-check.ts                  |  20 ++-
apps/cli/src/tui/runner-dashboard/action-runner.ts | 140 +++++++++++++++++++--
.../__tests__/github-release.test.ts               |  44 +++++++
apps/cli/src/upgrade-command/github-release.ts     |  44 +++++++
6 files changed, 276 insertions(+), 19 deletions(-)
```

## Registry Update

- **Phase**: archive
- **Status**: archived
- **Event**: archive_completed
- **Artifact**: archive-report.md

---

> Change is closed. Ready for next change or session end. Orchestrator will present advisory Git suggestions based on this context.
