# Preconditions: Enforce English Agent Artifacts

| ID | Precondition | Source | Status | Evidence | Blocks Apply |
|---|---|---|---|---|---|
| PCG-001 | User correction preserved: orchestrator-to-user MUST use user's language; orchestrator-to-sub-agent MUST be English only; sub-agent returns and generated OpenSpec artifacts MUST be English only. | User correction | satisfied | `spec.md` REQ-LANG-001, REQ-ORCH-001, REQ-ORCH-002, REQ-ORCH-003; `design.md` Central Language Policy Composition + Orchestrator Prompt Reinforcement; `proposal.md` (repaired) Acceptance Direction | No |
| PCG-002 | Spec artifact completed and reviewed. | Spec Agent | satisfied | `openspec/changes/enforce-english-agent-artifacts/spec.md` (285 lines, all REQ-IDs Defined in Compliance Matrix) | No |
| PCG-003 | Design artifact completed and reconciled with Spec. | Design Agent | satisfied | `openspec/changes/enforce-english-agent-artifacts/design.md` (265 lines; Component / Module Boundaries, File Impact Estimate, Testing Strategy, Implementation Sequencing all present) | No |
| PCG-004 | Change scope remains Deck-owned source behavior; no direct edits to installed local runner files outside the Deck repository. | REQ-LANG-003, REQ-ADAPT-003 | satisfied | `design.md` Migration / Backward Compatibility explicitly forbids direct edits to local OpenCode/Pi/runner files outside Deck repo; all impacted file paths in `design.md` File Impact Estimate live under `packages/core/` and `packages/adapter-*/` | No |
| PCG-005 | Known non-English leak `herramienta` confirmed and located in Deck-owned sources. | REQ-LEAK-001, Exploration artifact | satisfied | `exploration.md` identifies `herramienta` in `serena.ts` + apply-agent content files; `spec.md` REQ-LEAK-001 names it explicitly | No |
| PCG-006 | Existing core Developer Team APIs (`getAgentContent`, `getAgentContentResult`, `getTeamSessionInstructions`) and adapter install-plan builders remain backward compatible. | REQ-LANG-003, Design API Contract Implications | satisfied | `design.md` API / Contract Implications table marks all five interfaces as backward compatible (no shape change) | No |
| PCG-007 | Existing Developer Team agent catalog available for enumeration in regression tests. | Design Testing Strategy | satisfied | Catalog referenced by `content-registry.ts` and exercised by existing `content-registry.test.ts`; Apply will iterate the same enumeration | No |
| PCG-008 | Deny-list scope limited to confirmed leak terms (`herramienta`) per Design tradeoffs. | REQ-TEST-003, Design Tradeoffs | allowed-with-placeholder | `design.md` Tradeoffs row "Leak detection" chooses curated deny-list over broad detection; Apply may add additional confirmed leak terms without changing architecture if discovered | No |

## Closure Decision

- Ready for Apply: Yes with conditions
- Notes:
  - All Must requirements in the Spec have a Defined scenario in the Compliance Matrix; Apply may proceed.
  - Condition: Apply must run the focused Bun tests listed in Tasks 8-13 and confirm all pass before declaring the change ready for Verify; if any new confirmed non-English leak term is discovered during Apply, extend the deny-list under the `allowed-with-placeholder` precondition above without altering the architecture.
