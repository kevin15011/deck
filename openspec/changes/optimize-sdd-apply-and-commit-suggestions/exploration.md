# Exploration: optimize-sdd-apply-and-commit-suggestions

## Goal

Investigate where to update SDD workflow guidance for Apply batching, post-Archive commit suggestions, Explorer triage, and role-based delegation outside SDD.

## Current State

- **Apply routing** exists in the Orchestrator skill but has no explicit batching criteria; current behavior can be interpreted as one task per Apply-agent launch.
- **Task skill** already produces grouped output such as Shared/Backend/Frontend with parallelization guidance; this should become the authoritative source for Apply batch grouping.
- **Archive skill** is traceability-focused and does not currently own commit/PR suggestion behavior.
- **Explorer triage** in the Orchestrator triage gate does not explicitly cover internal workflow changes such as prompts, agent configs, SDD internals, routing, or OpenSpec behavior.
- **Agent models** are registered in agent configs via `model:` fields and should not be overridden by Orchestrator launches unless explicitly requested/approved.
- **Phase artifact persistence is unreliable in observed runs**: Proposal and Explorer agents both reported successful OpenSpec artifact/registry writes while the expected files were initially missing. The workflow needs an explicit fix so phase agents self-verify persisted artifacts before claiming success, and the Orchestrator verifies official artifacts/registry before phase advancement.
- **Mermaid usage is installed but not phase-enforced**: `pi-mermaid` is installed as a Pi render extension, but no dedicated Mermaid skill was found. Current Orchestrator visual guidance only covers optional visual explanations and says to avoid Mermaid syntax in user-facing copy. The desired behavior is phase-specific and runner-agnostic: the Orchestrator's user-facing summaries after Proposal, Spec, Design, and Task should always include concise Mermaid diagrams to improve user comprehension, regardless of whether the runner renders Mermaid or displays fenced source. Phase agents may provide Mermaid source or diagram-ready structure, but the Orchestrator owns user-facing presentation.

## Relevant Files

| File | Role |
| --- | --- |
| `.pi/skills/deck-developer-orchestrator/SKILL.md` | Primary target: Apply batching, Explorer triage, post-Archive behavior, role-based delegation outside SDD |
| `.pi/skills/deck-developer-task/SKILL.md` | Reference/target: execution-group output format, parallelization guidance, and Mermaid source/diagram-ready dependency data for Orchestrator summaries |
| `.pi/skills/deck-developer-apply-general/SKILL.md` | Target: clarify Apply agents may receive ordered groups of related tasks |
| `.pi/skills/deck-developer-apply-backend/SKILL.md` | Target: clarify Apply agents may receive ordered groups of related tasks |
| `.pi/skills/deck-developer-apply-frontend/SKILL.md` | Target: clarify Apply agents may receive ordered groups of related tasks |
| `.pi/skills/deck-developer-archive/SKILL.md` | Likely no direct change for commit suggestion; may need the same artifact self-verification rule as other phase agents |
| `.pi/skills/deck-developer-proposal/SKILL.md` | Target: phase artifact/registry self-verification before claiming success and Mermaid source/diagram-ready proposal summary data |
| `.pi/skills/deck-developer-explorer/SKILL.md` | Target: phase artifact/registry self-verification before claiming success |
| `.pi/skills/deck-developer-spec/SKILL.md` | Target: phase artifact/registry self-verification before claiming success and Mermaid source/diagram-ready requirements/acceptance data |
| `.pi/skills/deck-developer-design/SKILL.md` | Target: phase artifact/registry self-verification before claiming success and Mermaid source/diagram-ready architecture/routing/lifecycle data |
| `.pi/skills/deck-developer-verify/SKILL.md` | Target: phase artifact/registry self-verification before claiming success |
| `.pi/skills/deck-developer-review/SKILL.md` | Target: phase artifact/registry self-verification before claiming success |
| `.pi/agents/deck-developer-*.md` | Agent configs; registered model/settings should be respected |

## Constraints

- Agent model/tool/thinking/context configuration is owned by agent configs; Orchestrator should not override execution settings unless a documented workflow rule or explicit user instruction requires it.
- Changes appear to be prompt/configuration guidance changes, not product-code changes.
- Apply agents are terminal implementation agents; batching decisions must be made by Orchestrator using Task artifact guidance.
- Archive should remain focused on traceability; Git suggestions are better as Orchestrator post-Archive behavior.
- Phase agents must not report `completed` unless they have verified their required artifact path(s) and registry updates exist on disk. In registry-deferred parallel phases, agents must verify the phase artifact and return registry intent instead of claiming registry writes.
- Mermaid diagrams shown by the Orchestrator after Proposal, Spec, Design, and Task are explanatory aids only. They must not replace authoritative OpenSpec text/registry entries, and the same information must remain available in text for accessibility and runners without Mermaid rendering.

## Risks

1. **Launcher coupling unknown**: prompt-only changes may not affect launcher behavior if another runtime layer enforces sequencing.
2. **Over-grouping**: batching too much into one Apply agent can broaden context and reduce quality.
3. **Under-parallelization**: overly conservative grouping can leave independent work sequential.
4. **Commit suggestion ambiguity**: conventional commit type/scope and file grouping may be unclear without diff inspection.
5. **Registry/artifact false-positive completion**: phase agents may claim artifact writes without persisting files; Orchestrator must verify before phase advancement, and phase-agent skills should require self-verification before returning success.

## Options and Tradeoffs

### Option 1: Orchestrator skill only

Low effort and centralizes behavior, but leaves Task/Apply skill contracts under-specified.

### Option 2: Distributed changes

Update Orchestrator, Task, and Apply skills. This has medium effort but cleanly separates responsibilities:

- Orchestrator decides delegation, batching, fanout, and post-Archive Git suggestions.
- Task Agent emits execution groups and parallelization guidance.
- Apply agents explicitly accept ordered groups of related tasks.

### Option 3: Minimal Apply-only improvement

Low effort but incomplete; does not address Explorer triage, role-based delegation outside SDD, post-Archive Git suggestions, or artifact persistence reliability.

### Option 4: Add artifact persistence hardening only

Fixes the immediate false-positive completion problem, but leaves Apply performance and role-routing issues unresolved.

## Recommendation

Use **Option 2 — Distributed changes**.

The Orchestrator skill is the primary target for explicit Apply batching criteria, fanout conditions, Explorer triage triggers for internal workflow changes, role-based delegation outside formal SDD, post-Archive commit suggestion behavior, and mandatory artifact/registry verification before phase advancement. The Task skill should clarify execution-group guidance, Apply skills should clarify that each Apply agent can receive a coherent ordered task group rather than only one task, and all phase-agent skills should require self-verification of persisted artifacts/registry intent before claiming completion.

## Open Questions

- Is launcher behavior fully prompt-driven, or is there separate runtime/configuration logic that also needs modification?
- Should post-Archive PR title/body suggestions be always shown or conditional on detecting a PR workflow?
- Should Git suggestions be generated directly by Orchestrator or delegated to a future/dedicated git workflow role when diffs are complex?
- How strict should the Explorer-before-Proposal trigger be for internal workflow changes?
- Should artifact self-verification be repeated in every phase-agent skill, centralized in shared Developer Team guidance, or both?
- Should agents be required to return verification evidence such as `exists=true`, byte count, and registry event keys for each required artifact?

## Ready for Proposal

Yes. Affected files are identified, model configuration handling is clarified, and the recommended scope is clear enough for Proposal.

## Provenance

This artifact was mechanically repaired by the Orchestrator from the Explorer Agent's returned contract because the Explorer Agent reported successful persistence but verification found the official OpenSpec files missing.
