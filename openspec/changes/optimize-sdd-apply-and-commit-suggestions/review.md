# Review Report: Optimize SDD Apply Dispatch and Commit Suggestions

## Summary

**Overall Rating**: REQUEST CHANGES  
**Scope**: general / integration  
**Files Reviewed**: 18 (12 skill files + 6 OpenSpec/registry inputs)

The guidance updates are directionally strong: Orchestrator now owns user-facing Mermaid summaries and post-Archive Git suggestions, Task provides execution-group data, and Apply agents accept ordered groups rather than defaulting to one-task-one-agent dispatch. However, there are workflow-safety issues that should be fixed before Archive. The most serious is an impossible Archive self-verification/archive path sequence, plus unresolved shared-write hazards for parallel Apply fanout.

## Ratings by Dimension

| Dimension | Rating | Notes |
|---|---|---|
| Architecture | ❌ Weak | Core boundaries are improved, but Archive flow is internally contradictory and parallel Apply writes lack serialization/deferred handling. |
| Security | ⚠️ Adequate | Git suggestions are advisory/no-mutation and config overrides require provenance, but override exceptions should be narrowed. |
| Scalability | ⚠️ Adequate | Apply batching reduces launch overhead; parallel fanout still risks shared artifact/registry contention. |
| Maintainability | ❌ Weak | Self-verification contract drift and contradictory return fields will be hard to operate reliably. |
| Code Quality | ⚠️ Adequate | Text is generally clear, but invalid Mermaid templates and ambiguous deferred registry fields reduce quality. |
| Backend | N/A | Prompt/guidance-only change. |
| Frontend | N/A | Prompt/guidance-only change. |
| Integration | ❌ Weak | Phase handoffs improve in many places, but Apply fanout and Archive handoff semantics remain unsafe. |

## Findings

### BLOCKER

- **Architecture / Maintainability**: Archive self-verification is internally impossible and the step order can never produce trustworthy completion evidence.
  - **File**: `.pi/skills/deck-developer-archive/SKILL.md` — lines 67-75, 99-120, 131-144, 207-214
  - **Evidence**: Step 4 says the archive target must include `archive-report.md` and then the source change directory is removed; Step 7 requires `openspec/changes/{change-name}/archive-report.md` to exist while also requiring `openspec/changes/{change-name}/` to be removed; Step 8 writes the archive report after self-verification; the return summary still reports registry/artifact paths under `openspec/changes/...` after archive.
  - **Recommendation**: Reorder and normalize Archive flow: write `archive-report.md` and update registry while the change directory exists, move the complete directory to `openspec/archive/{change-name}/`, then self-verify archive paths (`openspec/archive/{change-name}/archive-report.md`, archived `state.yaml`, archived `events.yaml`) and source cleanup. Return archive-located artifact/registry paths, or explicitly document a different persistence model.

### MAJOR

- **Architecture / Integration**: Parallel Apply fanout can cause concurrent writes to shared `apply-progress.md`, `state.yaml`, and `events.yaml`.
  - **File**: `.pi/skills/deck-developer-orchestrator/SKILL.md` — lines 138-145; `.pi/skills/deck-developer-apply-general/SKILL.md` — lines 73-85 (same pattern applies to Backend/Frontend Apply)
  - **Evidence**: Orchestrator may launch multiple Apply agents when fanout criteria hold, while each Apply agent is instructed to update the same `apply-progress.md` and Spec Registry files. There is no registry-deferred mode, per-group progress artifact, or Orchestrator-owned serialized merge for parallel Apply.
  - **Recommendation**: Add an explicit safe-write strategy for Apply fanout: either make parallel Apply agents registry-deferred and return per-group deltas for Orchestrator serialization, write per-group artifacts such as `apply-progress-{group}.md` and merge later, or require one Orchestrator-owned writer for shared apply progress/registry state.

- **Maintainability / Integration**: Deferred phase return templates still include `Registry Recorded`, which conflicts with “return intent only” guidance.
  - **File**: `.pi/skills/deck-developer-spec/SKILL.md` — lines 297-299; `.pi/skills/deck-developer-design/SKILL.md` — lines 254-256; `.pi/skills/deck-developer-verify/SKILL.md` — lines 205-207; `.pi/skills/deck-developer-review/SKILL.md` — lines 227-229
  - **Evidence**: Each deferred-capable phase includes `Registry Write: performed | deferred`, but also requires a `Registry Recorded` line even when write mode is deferred. This invites agents to claim a registry write that did not happen.
  - **Recommendation**: Split the return contract by mode or change the field to `Registry Recorded: not written (deferred)` when deferred. Make `Registry Intent` the only positive registry claim in deferred mode, and keep `Registry Recorded` only for non-deferred mode.

### MINOR

- **Code Quality / UI**: Task skill Mermaid templates contain invalid Mermaid syntax.
  - **File**: `.pi/skills/deck-developer-task/SKILL.md` — lines 134-142 and 247-253
  - **Evidence**: The template uses `subgraph G{A["Group Label"]`, which is not valid Mermaid subgraph syntax and may produce non-rendering phase-summary diagrams.
  - **Recommendation**: Replace with valid syntax, e.g. `subgraph G["Group Label"]` followed by task nodes inside the subgraph, or `subgraph G["Group Label"]\n  T1[...]\nend`.

- **Security / Maintainability**: Execution configuration override exceptions are directionally safe but still broad.
  - **File**: `.pi/skills/deck-developer-orchestrator/SKILL.md` — lines 123-130
  - **Evidence**: Overrides are allowed for an explicit user request or “documented workflow rule,” but the guidance does not require identifying the rule source/ID, the exact overridden fields, or why the registered config is insufficient.
  - **Recommendation**: Require override provenance to include source (`user request` or rule ID/path), exact fields overridden, reason, and scope. Prefer forbidding tool-permission expansion unless explicitly authorized.

### NIT

None.

## Design Fidelity

Does the implementation match the Design artifact?
- **Aligned**: Partially
- **Deviations**:
  - Orchestrator ownership of Mermaid summaries is correctly represented; diagrams are required to explain substantive Proposal/Spec/Design/Task outputs, not just SDD progress/status.
  - Archive remains traceability-focused and explicitly says Git suggestions are Orchestrator-owned.
  - Apply grouping/fanout rules avoid one-task-one-agent by default and preserve dependency-aware batching.
  - The design did not adequately resolve shared writes during parallel Apply fanout; implementation also leaves this gap.
  - Archive self-verification implementation deviates from a workable archive lifecycle by checking source paths after source cleanup and by placing self-verification before report writing.

## Open Questions

- Should Apply fanout use registry-deferred semantics like Spec/Design and Verify/Review, or should all parallel Apply agents write per-group progress artifacts for Orchestrator merge?
- Should archived registry/artifact paths in Archive return contracts point to `openspec/archive/{change-name}/...` after move, rather than `openspec/changes/{change-name}/...`?

## Completion Evidence

- **Artifact Path**: `openspec/changes/optimize-sdd-apply-and-commit-suggestions/review.md`
- **Artifact Exists**: true
- **Artifact Byte Count**: 7791
- **Registry Mode**: deferred
- **Registry Intent**: artifact `openspec/changes/optimize-sdd-apply-and-commit-suggestions/review.md`, phase `review`, status `changes_requested`, event `review.failed`
- **Phase Status**: failed
- **Registry Blocker**: none; registry write intentionally deferred
