# Preconditions: Improve User Phase Communication

## Resolved External Conditions

### PC-1: Overlapping ownership — SATISFIED by explicit non-destructive handoff

- **Original condition**: `developer-team-execution-convergence` remained active at Apply phase (`passed_with_warnings`) and owned overlapping Developer Team prompt/profile targets in `packages/core/src/teams/developer/`.
- **Resolution**: The user prioritized this change and authorized a non-destructive handoff/rebase from `developer-team-execution-convergence` to the current change. The Orchestrator selected and communicated the safe interpretation: explicit target handoff/rebase to current HEAD as the implementation baseline, preserving all older change artifacts and history untouched. No discard, reset, or delete operation is authorized or performed.
- **Evidence**: Central registry event `tasks.approved` (timestamp `2026-07-22T16:21:35.953Z`, intent `registry-intent:v1:2f7750eb15273dda906eebec70377d40`) records the human approval and non-destructive handoff authorization.
- **Readiness**: Apply is ready against current HEAD. Implementation tasks T2–T15 may proceed. Apply must not edit `developer-team-execution-convergence` artifacts/history and must not perform any `git reset`, `git checkout --`, `git clean`, `git stash drop`, or other destructive discard operation without the protected confirmation flow.

## Active Preconditions

### PC-2: Protected-scope exclusion — ACTIVE

- **Condition**: Any newly discovered intersection with `runner-capability-standardization` (WIP, branch, commit, active files, artifacts, or registry history) blocks that operation and returns to scope review without modification.
- **Readiness**: Excluded. No target in this change intersects `runner-capability-standardization`.
- **Impact**: If an intersection is discovered during Apply, the affected operation is rejected as `excluded-scope`.

## No Other Preconditions

No database, registry, state, feature-flag, environment, or external-service precondition exists. No generated file, adapter implementation, runtime contract, or CLI/TUI change is required.
