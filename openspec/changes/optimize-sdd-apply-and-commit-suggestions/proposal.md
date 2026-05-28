# Proposal: Optimize SDD Apply Dispatch and Commit Suggestions

## Intent

Improve Deck Developer Team workflow reliability and efficiency by addressing seven orchestration gaps:
- Apply dispatch can be interpreted as one task per Apply agent, causing unnecessary fanout and latency for related work.
- Archive completion lacks advisory conventional commit and optional PR metadata suggestions based on the completed change/diff.
- Explorer triage does not explicitly cover codebase, architecture, agent config, prompt, SDD workflow, routing, OpenSpec, or broad-impact changes before Proposal.
- Non-SDD/direct workflows need role-based delegation when specialized agent rules trigger, even though SDD remains the formal pipeline.
- Phase agents have reported successful OpenSpec artifact/registry writes before official files were verified on disk.
- Orchestrator launches risk overriding registered agent execution configuration unless explicit user or documented workflow rules require it.
- Interactive SDD phase summaries shown by the Orchestrator after Proposal, Spec, Design, and Task should consistently include Mermaid diagrams so users can quickly understand phase outputs across runners. Because the Orchestrator is the user-facing communicator, phase agents should provide Mermaid source or diagram-ready structure in their artifact/return contract, and the Orchestrator should decide how to present it.

## Goal

Make SDD orchestration faster, safer, and more reliable by batching Apply work by coherent context, adding advisory post-Archive Git suggestions, improving triage/delegation rules, hardening artifact verification, respecting registered agent configuration by default, and requiring Mermaid-backed Orchestrator summaries after Proposal, Spec, Design, and Task for faster user comprehension across runners.

## Scope

### In Scope
- Define Apply orchestration guidance that groups tasks into coherent Apply-agent batches by owner/context instead of defaulting to one task per agent.
- Define criteria for launching multiple frontend, backend, or general Apply agents: independent areas, non-overlapping files/components/services, no ordering dependency, low conflict risk, and independent verification.
- Preserve dependency-aware Apply ordering: shared/contracts first; backend/frontend parallel only when dependencies are clear.
- Add post-Archive Orchestrator guidance to suggest conventional commit message(s) and optional PR title/body from the completed change/diff; advisory only, with no automatic commit.
- Expand Explorer-before-Proposal triage triggers for work requiring codebase, architecture, agent config, prompt, workflow-internal, OpenSpec/routing, or broad-impact understanding.
- Clarify role-based delegation outside formal SDD/direct workflows when specialized agent delegation rules trigger.
- Add artifact/registry persistence hardening: phase agents self-verify required artifacts/registry or registry intent before claiming completion; Orchestrator verifies official artifact and registry before phase advancement.
- Clarify that Orchestrator should use registered agent configuration by default and must not override `model`, `context`, `thinking`, `tools`, or similar settings unless explicitly requested or required by documented workflow rules.
- Add Mermaid phase-summary guidance: after Proposal, Spec, Design, and Task, the Orchestrator must include concise Mermaid diagrams in its user-facing phase summaries only when they explain the phase output itself: proposed scope/decision structure, requirements relationships, technical architecture/flows, or task dependencies/execution groups. Do not use Mermaid merely to show SDD progress or phase status. Phase agents should provide either Mermaid source or diagram-ready structure in their artifacts/return contracts so the Orchestrator can present it consistently. This must work across runners that render Mermaid differently; diagrams remain explanatory and non-authoritative, while OpenSpec artifacts and registry remain authoritative.

### Out of Scope
- Implementing product code changes in the Proposal phase.
- Automatically committing, pushing, opening PRs, or otherwise mutating Git state after Archive.
- Replacing human review/approval of commit messages or PR content.
- Deep launcher/runtime redesign unless later Design confirms prompt/configuration changes are insufficient.
- Reworking unrelated SDD phases beyond the orchestration, delegation, persistence-hardening, and Mermaid-backed Orchestrator phase-summary behavior described above.

## Affected Capabilities

> This section is the contract between Proposal and Spec/Design phases.

### New Capabilities
- `sdd-post-archive-git-suggestions`: After Archive completes, the Orchestrator suggests conventional commit message(s) and optional PR title/body from the completed change/diff, without automatic commit behavior.
- `sdd-phase-artifact-verification`: Phase agents verify required artifacts and registry writes or registry intent before claiming completion, and the Orchestrator verifies official artifact/registry state before phase advancement.
- `orchestrator-agent-config-respect`: Orchestrator uses registered agent configuration by default and avoids overriding execution settings unless explicitly requested or required by documented workflow rules.
- `sdd-phase-mermaid-summaries`: Orchestrator summaries after Proposal, Spec, Design, and Task include concise Mermaid diagrams for user comprehension across runners, with phase agents supplying diagram source or diagram-ready data when useful, without making diagrams authoritative.

### Modified Capabilities
- `sdd-apply-orchestration`: Change Apply dispatch guidance from task-level agent decomposition to owner/context-based batching with explicit criteria for safe parallel fanout.
- `sdd-explorer-triage`: Expand Explorer-before-Proposal triggers to include codebase, architecture, agent config, prompt, workflow internals, OpenSpec/routing implications, and broad project impact.
- `orchestrator-role-based-delegation`: Clarify that specialized role delegation applies outside formal SDD/direct workflows when delegation rules trigger, while SDD remains the formal pipeline.

### Unchanged Capabilities
- `sdd-phase-sequence`: The formal SDD pipeline remains unchanged; this proposal changes orchestration guidance within and around phases.
- `human-git-control`: Git suggestions remain advisory and do not perform commits, pushes, branch changes, or PR creation automatically.

## Approach

Update workflow guidance in the Orchestrator-centered SDD instructions, with supporting updates to Task, Apply, and phase-agent skills. Likely affected official guidance files include `.pi/skills/deck-developer-orchestrator/SKILL.md`, `.pi/skills/deck-developer-proposal/SKILL.md`, `.pi/skills/deck-developer-spec/SKILL.md`, `.pi/skills/deck-developer-design/SKILL.md`, `.pi/skills/deck-developer-task/SKILL.md`, `.pi/skills/deck-developer-apply-general/SKILL.md`, `.pi/skills/deck-developer-apply-backend/SKILL.md`, `.pi/skills/deck-developer-apply-frontend/SKILL.md`, and phase-agent skills that persist OpenSpec artifacts/registry state.

Task output should remain the source for execution groups and parallelization guidance. The Orchestrator should convert those groups into coherent Apply-agent batches, generally assigning an ordered list of related tasks to one appropriately specialized Apply agent when work shares owner/context or dependencies. Multiple Apply agents should be used only for independent, non-overlapping, low-conflict, independently verifiable areas. After Archive, the Orchestrator should inspect completed change/diff context and provide advisory conventional commit and optional PR metadata suggestions. Phase-agent and Orchestrator guidance should require verification of official artifacts/registry state before reporting or advancing completion. Agent launch guidance should preserve registered execution configuration by default. Proposal, Spec, Design, and Task should provide compact Mermaid source or diagram-ready structure to support Orchestrator summaries: Proposal for scope/problem/decision structure, Spec for requirements/acceptance relationships, Design for architecture/routing/lifecycle decisions, and Task for dependency/execution group flow. The Orchestrator, as the user-facing communicator, is responsible for including fenced `mermaid` blocks in the phase summary shown to the user only when the diagram explains the substantive output of that phase, not the already-known SDD workflow progress.

## Alternatives and Tradeoffs

| Alternative | Why Considered | Why Not Chosen |
|---|---|---|
| Orchestrator-only guidance update | Centralizes orchestration behavior in the primary decision-maker | Leaves Task/Apply/phase-agent contracts ambiguous and may not fix self-verification expectations. |
| Distributed skill guidance updates | Aligns Orchestrator, Task, Apply, and phase-agent responsibilities | More files and coordination, but best matches the explored workflow gaps. |
| Keep one task per Apply agent | Simple mapping from task list to agent launches | Causes avoidable orchestration overhead and weakens context continuity for related work. |
| Always parallelize all Apply tasks | Maximizes apparent concurrency | Raises conflict, dependency, duplicate-context, and verification risks. |
| Generate commit suggestions before Archive | Provides earlier feedback | Archive has the completed change/diff context and is the safer point for advisory Git output. |
| Rely only on Orchestrator verification for persistence | Avoids repeating verification rules across phase agents | Does not prevent false-positive phase-agent completion reports before Orchestrator review. |
| Keep Mermaid only as optional Orchestrator visual summaries | Avoids adding diagram expectations to phase handoffs | Does not satisfy the cross-runner need for Proposal, Spec, Design, and Task phase summaries to be quickly understandable through consistent diagrams. |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Prompt/config guidance may not control runtime launcher behavior | Medium | Design should identify whether runtime/configuration layers also enforce dispatch or overrides. |
| Over-grouping Apply tasks broadens context too much | Medium | Use owner/context grouping and preserve parallel fanout for independent, non-overlapping areas. |
| Under-parallelization slows independent work | Medium | Include explicit multi-agent criteria and independent verification guidance. |
| Parallel Apply agents conflict on shared contracts or files | Medium | Require shared/contracts work first and parallelize backend/frontend only after dependencies are clear. |
| Commit/PR suggestions infer the wrong conventional type or scope | Medium | Present suggestions as advisory, allow alternatives, and flag ambiguity. |
| Verification guidance becomes duplicated or inconsistent across phase skills | Medium | Prefer shared wording where available, plus phase-specific required artifact/registry evidence. |
| Execution configuration exceptions are unclear | Low | Limit overrides to explicit user request or documented workflow rules and require provenance when used. |
| Mermaid diagrams drift from authoritative text/artifacts | Medium | State that diagrams are explanatory only, keep them concise, and require equivalent textual content in the artifact/summary. |
| Runner support for Mermaid differs | Medium | Use standard fenced `mermaid` blocks that remain readable as source when not rendered; do not depend on pi-mermaid specifically. |

## Rollback Plan

Revert the workflow guidance changes in the affected SDD/agent skill files to the previous versions. This restores prior Apply dispatch behavior, removes post-Archive Git suggestions, reverts triage/delegation/configuration guidance, returns persistence verification to the prior process, and removes mandatory Mermaid phase summaries. Because Git suggestions are advisory only, rollback does not require reversing commits or repository state changes created by this proposal.

## Dependencies

- Authoritative Deck Developer Team skill files for Orchestrator, Task, Apply, phase-agent, and Archive guidance.
- Access to completed change/diff context at or after Archive for Git suggestion generation.
- Confirmation during Design whether launcher/runtime behavior is prompt-driven or requires non-prompt configuration changes.
- Mermaid-compatible markdown rendering expectations across supported runners; diagrams must remain useful as fenced source when a runner does not render Mermaid.

## Open Questions

- Is launcher behavior fully prompt-driven, or is there separate runtime/configuration logic that also needs modification?
- Should post-Archive PR title/body suggestions always be shown, or only when a PR workflow is detected or requested?
- Should commit suggestions provide one best recommendation or multiple candidates when conventional commit type/scope is ambiguous?
- Should artifact self-verification wording be repeated in every phase-agent skill, centralized in shared Developer Team guidance, or both?
- What exact verification evidence should each phase return: `exists=true`, byte count, registry phase status, registry event type, or another minimal set?
- Should Mermaid diagrams be required in both the official artifact/agent return contract and the Orchestrator's user-facing phase summary, or should agents provide diagram-ready structure while only the Orchestrator renders Mermaid to the user?
- Should the existing Orchestrator rule that says to avoid Mermaid syntax in user-facing copy be replaced entirely or narrowed to non-SDD conversational summaries?

## Acceptance Direction

- [ ] Apply orchestration guidance no longer defaults to one Apply agent per task.
- [ ] Apply batching guidance groups related tasks by coherent owner/context and ordered task lists.
- [ ] Multi-agent Apply criteria cover independent areas, non-overlapping files/components/services, no ordering dependency, low conflict risk, and independent verification.
- [ ] Shared/contracts-first ordering is explicit, with backend/frontend parallelism only when dependencies are clear.
- [ ] Post-Archive behavior suggests advisory conventional commit message(s) and optional PR title/body from completed change/diff context, with no automatic commit.
- [ ] Explorer-before-Proposal triage explicitly covers codebase, architecture, agent config, prompts, workflow internals, OpenSpec/routing implications, and broad project impact.
- [ ] Role-based delegation outside SDD/direct workflows is preserved when specialized agent rules trigger.
- [ ] Phase agents self-verify required artifacts/registry or registry intent before claiming completion.
- [ ] Orchestrator verifies official artifact and registry state before advancing phases.
- [ ] Orchestrator respects registered agent execution configuration by default and documents any allowed override basis.
- [ ] Orchestrator summaries after Proposal, Spec, Design, and Task include concise Mermaid diagrams in fenced `mermaid` blocks that explain the substantive phase output, not merely SDD progress/status.
- [ ] Mermaid diagrams are explicitly non-authoritative and have equivalent textual content in the official artifact/Orchestrator summary.
- [ ] Existing visual guidance that discourages Mermaid syntax is reconciled with the new phase-specific Mermaid requirement.

## Next Steps

Ready for Spec (`deck-developer-spec`) and Design (`deck-developer-design`) in parallel.
