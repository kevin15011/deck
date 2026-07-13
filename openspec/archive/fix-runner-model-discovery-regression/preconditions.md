# Preconditions: Runner-Resolved OpenCode Model and Variant Discovery

**Change ID**: `fix-runner-model-discovery-regression`

## Proposal-Phase Decision

- Proposal-specific Apply blockers: **None identified**.
- Normal SDD sequencing still applies: Spec, Design, Tasks, and implementation authorization must complete before Apply.
- The corrected `exploration-corrected` event is the official exploration basis; the earlier stale-installed-binary diagnosis is superseded.

## Preconditions Table

| ID | Precondition | Source | Status | Evidence | Blocks Apply |
|---|---|---|---|---|---|
| PC-PROP-001 | Use corrected exploration findings and do not reuse the stale-binary diagnosis | `events.yaml` `exploration-corrected`; `exploration.md` "User Runtime Correction" | satisfied | Proposal references runner/cache source-of-truth mismatch and excludes stale-binary diagnosis | No |
| PC-PROP-002 | No proposal-specific external service, credential, or network precondition is required | Proposal scope and acceptance direction | satisfied | Tests are required to use injected fixtures/mocks with no network calls | No |
| PC-PROP-003 | Spec, Design, and Task phases must close any new blockers they introduce before Apply | SDD workflow | satisfied | Spec, Design, and Tasks artifacts are completed; Tasks found no new Apply blocker | No |
| PC-DES-001 | Resolve the OpenCode discovery timeout budget and align Spec/Design/Tasks with the selected value | `design.md` measured runtime evidence and user decision | satisfied | User selected the more tolerant 15-second deadline; Spec and Design now consistently use 15,000 ms with zero unresolved timeout blockers | No |

## Notes for Later Phases

- If Spec or Design introduces a concrete pre-Apply condition, update this file instead of creating a separate precondition record.
- `None` here means no additional Proposal-discovered blockers beyond the standard SDD phase gate.
- `PC-DES-001` was resolved before Tasks with a user-selected 15-second deadline.

## Closure Decision

- Ready for Apply: Yes
- Notes: Tasks completed with no new preconditions. The 15,000 ms hard deadline remains resolved and is not subject to reopening.
