# Preconditions: Runner Model Recognition and Model-Aware Effort Levels

**Change ID**: `runner-model-recognition-effort-levels`

## Closure Decision

- Ready for Apply: Yes with conditions
- Notes:
  - Apply may proceed; the three `allowed-with-placeholder` items below are resolved at implementation time using the design recommendations already on record (variant source order, Deck-owned cache path, optional inventory method).
  - No blocking preconditions exist; the user constraint that Deck MUST NOT depend on `gentle-ai` or any non-runner external project is enforced as a test guard (Task T3).

## Preconditions Table

| ID | Precondition | Source | Status | Evidence | Blocks Apply |
|---|---|---|---|---|---|
| PCG-001 | User constraint that Deck depends only on the active runner is approved and recorded | proposal.md §"Proposal Approval Constraint"; events.yaml `proposal-completed` summary; user message "Procede, teneindo en cuenta que deck no puede depender de nadie mas que del runner" | satisfied | Explicit user approval in proposal.md; enforcement via spec REQ-INV-005 and REQ-TEST-003; guard implemented as Task T3 | No |
| PCG-002 | OpenSpec change is initialized with proposal, spec, and design artifacts | state.yaml lists exploration, exploration-update, proposal, spec, design artifacts; events.yaml records each phase completion | satisfied | `openspec/changes/runner-model-recognition-effort-levels/state.yaml` and `events.yaml` | No |
| PCG-003 | Confirmed exact OpenCode variant source order to implement | design.md §"Open Decisions" leaves the order to implementation; design.md §"OpenCode cache parser shape" / §"OpenCode variant cache shape" recommend `models.json` `variants` → Deck-owned plugin cache → none | allowed-with-placeholder | Design recommendation accepted as the implementation order (Tasks T5, T8, T9) | No |
| PCG-004 | Confirmed Deck-owned variant cache path | design.md §"Open Decisions" recommends `~/.cache/deck/opencode/model-variants.json` to avoid `gentle-ai` coupling | allowed-with-placeholder | Design recommendation accepted as the implementation default (Tasks T5, T9) | No |
| PCG-005 | Decided whether `RunnerAdapter.getModelInventory()` is required on all adapters now or remains optional for one release | design.md §"Open Decisions" recommends optional for compatibility | allowed-with-placeholder | Design recommendation accepted (Task T1 introduces the method as optional) | No |
| PCG-006 | Determinism: tests must use fixtures/mocks with no live provider/network/OAuth/runner-service calls and no `gentle-ai` dependency | spec.md REQ-TEST-001, REQ-TEST-003; design.md §"Testing Strategy" §"No-network guarantee" | satisfied | REQ-TEST-001/003 in spec.md; design testing strategy explicit; Task T3 implements the dependency guard | No |
| PCG-007 | Pi runner behavior MUST NOT regress under widened contracts | spec.md REQ-COMPAT-001; design.md §"Pi regression tests"; exploration.md §"Contrast with Pi" | satisfied | REQ-COMPAT-001 defined in spec.md; Task T12 enforces six-level regression coverage | No |

## Anti-Bureaucracy Note

The preconditions table captures only closure state, not implementation steps. Implementation work is fully described in `tasks.md` and is not duplicated here.
