# Preconditions: Bounded Developer Team Repair Loops

| ID | Precondition | Source | Status | Evidence | Blocks Apply |
|---|---|---|---|---|---|
| PCG-001 | User approval to proceed from Spec + Design into Tasks and onward into Apply | User input (interactive SDD mode) | satisfied | User explicitly approved continuing from Spec + Design to Tasks in interactive SDD mode | No |
| PCG-002 | Numeric default budgets for automated mode (time/token/tool) | Spec `Design-Deferred Decisions` and Design `Open Decisions` | allowed-with-placeholder | Use `DEFAULT_BUDGET_CONFIG` from `packages/sdd-runtime/src/orchestrator/budget-watchdog.ts` and `DEFAULT_LOOP_BREAKER_CONFIG` from `loop-breaker.ts` as first implementation defaults; revisit in follow-up change | No |
| PCG-003 | Review findings integrated into `repair-incident.md` for the first implementation | Design `Open Decisions` | deferred | Design supports `sourcePhase: review` without requiring Review integration in this change | No |
| PCG-004 | Validator strictness for `artifacts.repair_incident` when repair events exist | Design `Open Decisions` | satisfied | Design rollout is warning-first in canonical mode, error only when artifact is referenced but missing | No |
| PCG-005 | Spec / Design reconciliation of registry-deferred outputs by Orchestrator | Spec + Design artifacts and registry state/events | satisfied | `state.yaml` and `events.yaml` carry `deferred-reconciled-by-orchestrator` provenance for both phases | No |

## Closure Decision

- Ready for Apply: Yes
- Notes:
  - Default numeric budgets use the existing `budget-watchdog` / `loop-breaker` defaults; Apply may proceed under this placeholder.
  - Review integration into `repair-incident.md` is explicitly follow-up scope and not blocking.
  - All other questions are either satisfied or resolved with placeholders; no Spec/Design conflict blocks Apply.