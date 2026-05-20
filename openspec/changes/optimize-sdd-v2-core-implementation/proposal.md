# Proposal: Optimize SDD v2 Core Implementation

## Intent

The prior implementation cycle (`optimize-sdd-apply-and-commit-suggestions`) failed because changes were applied to `.pi/` — gitignored adapter-generated output — instead of the canonical source in `packages/core/`. This v2 cycle targets the correct source layer. The underlying problems remain the same: seven orchestration gaps in the Deck Developer Team SDD workflow that affect Apply dispatch efficiency, post-Archive Git guidance, Explorer triage coverage, delegation clarity, artifact persistence reliability, execution config respect, and Mermaid-backed phase summaries.

## Goal

Implement the same 7 orchestration improvements from the prior proposal, but in the correct source layer (`packages/core/src/teams/developer/` and `packages/sdd-runtime/`), so that changes persist across adapter rebuilds and are testable at the source level.

## Scope

### In Scope
- Update `packages/core/src/teams/developer/orchestrator-content.ts` — all 7 needs touch this file (ORCHESTRATOR_SYSTEM_PROMPT and ORCHESTRATOR_SKILL_BODY)
- Update `packages/core/src/teams/developer/visual-explanations-content.ts` — Need 7 (Mermaid phase-summary guidance)
- Update `packages/core/src/teams/developer/archive-content.ts` — Need 2 (post-Archive Git suggestion preparation)
- Update `packages/core/src/teams/developer/proposal-content.ts` — Need 7 (Mermaid source in proposals)
- Update `packages/core/src/teams/developer/spec-content.ts` — Need 7 (Mermaid source in specs)
- Update `packages/core/src/teams/developer/design-content.ts` — Need 7 (Mermaid source in designs)
- Update `packages/core/src/teams/developer/task-content.ts` — Need 7 (Mermaid source in tasks)
- Evaluate `packages/sdd-runtime/src/artifact-state/artifact-state-manager.ts` for persistence hardening gaps (Need 5)
- Update corresponding test files for all modified content files
- Verify adapter (`packages/adapter-pi/`) requires no changes

### Out of Scope
- Modifying `.pi/` output directly (that is adapter-generated)
- Changing `packages/adapter-pi/` adapter code (adapter only materializes core content)
- Implementing product code beyond agent content files
- Automatically committing, pushing, or creating PRs (Need 2 is advisory only)
- Deep launcher/runtime redesign beyond prompt guidance and artifact-state-manager evaluation
- Modifying the formal SDD phase sequence (unchanged; this proposal changes guidance within phases)

## Affected Capabilities

> This section is the contract between Proposal and Spec/Design phases.

### New Capabilities
- `sdd-post-archive-git-suggestions`: After Archive completes, the Orchestrator suggests conventional commit message(s) and optional PR title/body from the completed change/diff, without automatic commit behavior.
- `sdd-phase-artifact-verification`: Phase agents verify required artifacts and registry writes or registry intent before claiming completion, and the Orchestrator verifies official artifact/registry state before phase advancement.
- `orchestrator-agent-config-respect`: Orchestrator uses registered agent configuration by default and avoids overriding execution settings unless explicitly requested or required by documented workflow rules.
- `sdd-phase-mermaid-summaries`: Orchestrator summaries after Proposal, Spec, Design, and Task include concise Mermaid diagrams for user comprehension across runners, with phase agents supplying diagram source or diagram-ready data when useful.

### Modified Capabilities
- `sdd-apply-orchestration`: Change Apply dispatch guidance from task-level agent decomposition to owner/context-based batching with explicit criteria for safe parallel fanout.
- `sdd-explorer-triage`: Expand Explorer-before-Proposal triggers to include codebase, architecture, agent config, prompt, workflow internals, OpenSpec/routing implications, and broad project impact.
- `orchestrator-role-based-delegation`: Clarify that specialized role delegation applies outside formal SDD/direct workflows when delegation rules trigger, while SDD remains the formal pipeline.

### Unchanged Capabilities
- `sdd-phase-sequence`: The formal SDD pipeline (proposal → spec/design → task → apply → verify/review → archive) remains unchanged.
- `human-git-control`: Git suggestions remain advisory; no commits, pushes, branch changes, or PR creation.
- `adapter-materialization`: `packages/adapter-pi/` behavior is unchanged; it continues to materialize core content into `.pi/`.

## Approach

All 7 needs are implemented as **content updates** in `packages/core/src/teams/developer/` source files. The three-layer architecture is:

```
Source (packages/core/) → Adapter (packages/adapter-pi/) → Output (.pi/)
```

The adapter contributes no behavioral logic — it adds YAML frontmatter and writes files. Changing source content and running the adapter produces updated `.pi/` output automatically.

### Source File Map

| Need | Primary Source File(s) | Section(s) to Modify |
|---|---|---|
| 1. Apply batching | `orchestrator-content.ts` | Apply Routing section in SYSTEM_PROMPT and SKILL_BODY |
| 2. Post-Archive Git suggestions | `orchestrator-content.ts` + `archive-content.ts` | New post-Archive section; Archive SKILL_BODY diff-context prep |
| 3. Explorer-before-Proposal triage | `orchestrator-content.ts` | SDD Triage Gate section |
| 4. Role-based delegation | `orchestrator-content.ts` | Delegation Rules and Sub-Agent Context Protocol sections |
| 5. Persistence hardening | `orchestrator-content.ts` + all phase `*-content.ts` files + possibly `artifact-state-manager.ts` | Artifact Persistence Policy; phase SKILL_BODY self-verification steps |
| 6. Execution config respect | `orchestrator-content.ts` | Agent launch/delegation guidance |
| 7. Mermaid-backed summaries | `visual-explanations-content.ts` + `orchestrator-content.ts` + `proposal-content.ts` + `spec-content.ts` + `design-content.ts` + `task-content.ts` | VISUAL_EXPLANATIONS_SKILL_FRAGMENT; Orchestrator summary guidance; phase return contracts |

### Prior Artifacts Reused

The prior change's `proposal.md` and `spec.md` define valid requirements (27 REQs across 7 capabilities). This v2 proposal reuses their scope, requirements, acceptance scenarios, and validation rules. The only change is the **implementation target** — source files instead of adapter output.

## Alternatives and Tradeoffs

| Alternative | Why Considered | Why Not Chosen |
|---|---|---|
| Modify `.pi/` files directly (prior approach) | Fastest path to visible change | Gitignored; lost on rebuild. Root cause of prior failure. |
| Modify adapter (`packages/adapter-pi/`) | Controls what gets written to `.pi/` | Adapter is a passthrough; behavioral content comes from core. No adapter changes needed. |
| Only update `orchestrator-content.ts` | Centralizes most changes | Needs 2, 5, and 7 also require changes to other content files for self-verification and Mermaid data. |
| Add code-level phase enforcement in `sdd-runtime` | Stronger guarantees | Phase sequence is guidance-text-driven by design; all 7 needs are addressable via content updates. |
| Extend `artifact-state-manager.ts` with verification helpers | Provides programmatic verification | Exploration flagged this as an open question; Design phase should confirm whether text guidance suffices or code helpers are needed. |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Content changes are too large for single review cycle | Medium | Each need maps to a distinct section; can be implemented incrementally per need. |
| `artifact-state-manager.ts` needs code changes beyond text guidance | Low–Medium | Design phase evaluates; if needed, scope is narrow (CAS/idempotency helpers). |
| Mermaid guidance conflicts with existing "avoid Mermaid" rules in Orchestrator | Medium | Explicit reconciliation guidance in Need 7; existing rule must be narrowed, not contradicted. |
| Over-grouping Apply tasks broadens context too much | Medium | Owner/context grouping + explicit multi-agent criteria for independent work. |
| Commit suggestion type/scope is ambiguous | Medium | Advisory labeling, multiple candidates when ambiguous. |
| Tests need expansion for new content sections | Low | Test files exist for all content files; add assertions for new guidance sections. |

## Rollback Plan

Revert changes in `packages/core/src/teams/developer/` content files to prior versions. Re-run adapter to regenerate `.pi/` output. No Git state, configuration files, or database records are modified by this change, so rollback requires only source revert and adapter rebuild.

## Dependencies

- Confirmation from Design phase whether `artifact-state-manager.ts` needs code changes or text guidance suffices (Need 5).
- Confirmation that no runtime launcher overrides agent config independently of the Orchestrator's guidance (Need 6).
- Mermaid-compatible markdown rendering in supported runners; diagrams must remain readable as fenced source when not rendered (Need 7).

## Open Questions

- Does `packages/sdd-runtime/src/artifact-state/artifact-state-manager.ts` need new verification helper functions, or is Orchestrator text guidance sufficient for persistence hardening?
- Is there a runtime launcher (separate from the adapter) that overrides agent model/context/thinking/tools independently of Orchestrator guidance?
- Should the existing Orchestrator "avoid Mermaid" guidance be narrowed to non-SDD conversational summaries, or replaced entirely?
- Should Mermaid diagrams be required in both phase-agent artifacts and Orchestrator summaries, or should agents provide only diagram-ready structure?

## Acceptance Direction

- [ ] `orchestrator-content.ts` updated with Apply batching, triage expansion, delegation clarification, persistence policy, config respect, and Mermaid summary guidance
- [ ] `archive-content.ts` updated with diff-context preparation for post-Archive Git suggestions
- [ ] `visual-explanations-content.ts` updated with phase-summary Mermaid guidance
- [ ] Phase content files (`proposal-content.ts`, `spec-content.ts`, `design-content.ts`, `task-content.ts`) updated with self-verification steps and Mermaid source guidance
- [ ] All content tests pass: `bun test packages/core/src/teams/developer/`
- [ ] Adapter rebuild produces updated `.pi/` output without errors
- [ ] No changes to `packages/adapter-pi/` source code (adapter is passthrough)

## Next Steps

Ready for Spec (`deck-developer-spec`) and Design (`deck-developer-design`) in parallel. Prior spec artifact from `optimize-sdd-apply-and-commit-suggestions/spec.md` is valid and should be reused with updated source file references.
