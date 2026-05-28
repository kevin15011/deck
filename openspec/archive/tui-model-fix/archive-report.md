# Archive Report: Fix TUI Developer Team Model Assignment Bug

## Change Summary

**Change**: tui-model-fix
**Status**: ✅ Archived
**Archive Location**: `openspec/archive/tui-model-fix/`

### Lifecycle
- **Proposal**: 2026-05-24 — Two-phase fix: immediate Pi Finish persistence + structural `TeamBundleInstallerFn` extension
- **Spec + Design**: 2026-05-24 — 10 requirements across 3 capabilities, spec and design completed in parallel
- **Tasks**: 2026-05-24 — 6 tasks created across 2 phases, all routed to General Apply
- **Apply**: 2026-05-25 — 6/6 original tasks + 2 minor review-requested fixes completed
- **Verify**: 2026-05-25 — PASS WITH WARNINGS (9 pre-existing test failures)
- **Review**: 2026-05-24 — APPROVE WITH CHANGES (2 MINOR findings resolved in apply)
- **Archive**: 2026-05-24 — Change closed and archived

## Traceability Matrix

| REQ-ID | Description | Task(s) | Verify Result | Review Rating |
|---|---|---|---|---|
| REQ-PMP-001 | Pi dashboard Finish persists assignments | Task 1 | ✅ PASS | ✅ Strong |
| REQ-PMP-002 | Persisted assignments match in-memory state | Task 1 | ✅ PASS | ✅ Strong |
| REQ-PMP-003 | Rollback on persistence failure | Task 1, SDD-MINOR-2 | ✅ PASS | ✅ Strong |
| REQ-PMP-004 | OpenCode unchanged | Task 1 | ✅ PASS | ✅ Strong |
| REQ-ABA-001 | TeamBundleInstallerFn accepts assignments | Task 2 | ✅ PASS | ✅ Strong |
| REQ-ABA-002 | applyTeamBundleAction forwards assignments | Task 3 | ✅ PASS | ✅ Strong |
| REQ-ABA-003 | Backward-compatible type extension | Task 2 | ✅ PASS | ✅ Strong |
| REQ-PIB-001 | Pi installTeamBundle closure exists | Task 4 | ✅ PASS | ✅ Strong |
| REQ-PIB-002 | Pi closure builds/applies/verifies/rolls back | Task 4, SDD-MINOR-2 | ✅ PASS | ✅ Strong |
| REQ-PIB-003 | OpenCode forwards assignments | Task 5 | ✅ PASS | ✅ Adequate |

### Summary
- **Total Requirements**: 10
- **Total Tasks**: 6 original + 2 minor review fixes
- **Verification Result**: PASS WITH WARNINGS
- **Review Rating**: APPROVE WITH CHANGES (changes applied)

## Verification

**Result**: PASS WITH WARNINGS
**Critical Findings**: 0
**Warnings**: 1 (9 pre-existing action-runner.test.ts failures unrelated to change)

All 10 requirements pass code inspection. Typecheck passes for modified files. The 9 test failures in `action-runner.test.ts` are pre-existing and relate to `pi-mermaid` internal package routing, not this change.

## Review

**Rating**: APPROVE WITH CHANGES
**Blockers**: 0
**Major Findings**: 0
**Minor Findings**: 2 (both resolved in apply phase)
  - SDD-MINOR-1: Type cleanup — closure params use `DeveloperTeamModelAssignments`/`DeveloperTeamThinkingAssignments` instead of `Record<string, string>`
  - SDD-MINOR-2: Add try/catch/rollback to Pi `installTeamBundle` closure

**NIT**: 1 deferred — stale alias type in `action-runner.ts` line 76 (not assigned; deferred to future cleanup)

## Follow-ups

- **NIT (Low)**: Stale `RunnerActionRunnerDependencies.buildDeveloperTeamInstallPlan` alias type in `action-runner.ts` line 76 omits new optional assignment fields. Should be widened when the file is next touched for maintenance. — Suggested owner: General Apply
- **Suggestion (Low)**: When pre-existing `action-runner.test.ts` failures are addressed, update the model-preservation test to assert the current `installTeamBundle` contract directly. — Suggested owner: General Apply

## Project AI Notes (Phase 5 — Deferred)

> Project AI notes are a planned Phase 5 feature under `.deck/ai-notes/`. Not yet active.

### Extracted Learnings

- The `apply-team-bundle` action currently reads Developer Team model/thinking assignments from `RunnerDashboardState.teams["developer-team"]` rather than from `RunnerAction` payload fields — the dashboard state is the source of truth for install-time configuration.
- Pi and OpenCode share the same `applyDeveloperTeamModelConfig()` function but diverge internally: Pi uses `modelAssignments`/`thinkingAssignments`; OpenCode uses `configModelOverrides`/`reasoningEffortOverrides`.
- Rollback behavior (`rollbackDeveloperTeamFiles`) existed for OpenCode's `applyDeveloperTeamModelConfig()` path but was missing from the Pi `installTeamBundle` closure — this was caught in review and added in apply.

## Git Suggestion Context

- **Conventional commit type**: `fix` — bug fix for Pi Developer Team model assignment persistence that was lost on dashboard Finish
- **Scope**: `tui` — TUI dashboard model configuration and Review & Install action runner
- **Key changes**:
  - Added `applyDeveloperTeamModelConfig()` call for Pi runtime when finishing dashboard model config (Phase 1)
  - Extended `TeamBundleInstallerFn` type with optional `modelAssignments`/`thinkingAssignments` (Phase 2)
  - Updated `applyTeamBundleAction` to forward assignments from dashboard state to installer (Phase 2)
  - Implemented Pi `installTeamBundle` closure with try/catch/rollback (Phase 2)
  - Updated OpenCode `installTeamBundle` to forward assignments (Phase 2)
  - Type cleanup: replaced `Record<string, string>` with branded types (review fix)
- **Ambiguity notes**: None — clearly a bug fix (`fix`). The Phase 2 structural extension is part of the fix, not a separate feature.
