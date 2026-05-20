# Proposal: Silent Visual Explanations

## Intent

Deck should support quick visual explanations without making users learn or choose Mermaid. Today Pi dashboard still exposes Mermaid/`runner-mermaid` as visible runner capability, while the approved direction is for visual rendering support to be internal, silent, and primarily available to the Orchestrator responses users see.

## Goal

Install and use Deck-owned visual explanation support silently for Pi/Orchestrator while simplifying the dashboard around user-facing package, memory, team, and install review choices.

## Scope

### In Scope
- Treat `pi-mermaid` as internal Pi visual support: validate whether it exists and install implicitly when missing.
- Remove Mermaid as an optional/configurable dashboard concept; allow only minimal technical install feedback when needed.
- Create Deck's own visual explanation skill focused on quick user understanding and assign it primarily to Orchestrator.
- Introduce or extend a runner skill/package adapter layer so future internal skills/packages can be added without duplicating installer logic.
- Rework dashboard grouping toward `Packages`, `Adaptive Memory`, `Teams`, with `Review & Install` as the final review/action surface.
- Update affected tests around dashboard rendering, capability/package planning, and idempotent install behavior.

### Out of Scope
- Installing or adopting `softaworks/agent-toolkit/mermaid-diagrams`.
- Presenting Mermaid syntax, Mermaid configuration, or visual-rendering choices to end users.
- Making visual explanations replace OpenSpec artifacts, registry state, or phase handoffs.
- Defining a full visual-rendering implementation for non-Pi runners unless an existing runner path is available.
- Assigning the visual skill to Proposal/Spec/Design/Task agents by default.

## Affected Capabilities

> This section is the contract between Proposal and Spec/Design phases.

### New Capabilities
- `visual-explanations`: Deck-owned Orchestrator skill for brief diagrams or visual summaries that improve quick user understanding.
- `runner-skill-package-adapters`: reusable runner-level installation support for internal packages and skills with idempotent status handling.

### Modified Capabilities
- `pi-runner-dashboard`: hide Mermaid as a user-facing capability and group choices under `Packages`, `Adaptive Memory`, `Teams`, and final `Review & Install` feedback.
- `pi-runner-installation`: validate and install `pi-mermaid` silently as internal Pi support instead of exposing it as a configurable capability.

### Unchanged Capabilities
- `openspec-workflow`: OpenSpec artifacts and Spec Registry remain authoritative; visuals are explanatory only.
- `developer-team-installation`: existing idempotent agent/skill install semantics remain relevant as a pattern, but user-facing requirements do not change.

## Approach

Use a hybrid internal approach: move Mermaid support out of visible runner capabilities and into internal Pi package installation, add a Deck-owned Orchestrator visual explanation skill, and introduce/extend runner adapter plumbing for idempotent internal package/skill installation. Update dashboard copy/selectors/state/tests so users see package, memory, team, and review choices—not Mermaid configuration.

## Alternatives and Tradeoffs

| Alternative | Why Considered | Why Not Chosen |
|---|---|---|
| Keep `runner-mermaid` visible but required | Smallest technical change; reuses current capability model | Still makes Mermaid a user-facing concept and contradicts approved UX direction |
| Remove Mermaid support from planning entirely | Simplifies dashboard and avoids user confusion | Loses install validation, idempotence, and traceability for required Pi support |
| Install external Mermaid diagrams skill | Fast path to diagram behavior | Rejected by user direction; too broad and not optimized for brief Orchestrator explanations |
| Build runner adapter layer now | Supports this change and future internal packages/skills | Adds design work, but avoids duplicating Pi/OpenCode installer patterns |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Dashboard refactor breaks existing selectors/render tests | Medium | Update tests around the new grouping and preserve install-review semantics |
| `pi-mermaid` install detection is unreliable | Medium | Require explicit validation-before-install behavior and idempotent outcomes |
| Adapter layer becomes over-generalized | Medium | Keep adapter scope limited to current internal package/skill installation needs |
| Users still see Mermaid in prominent UI copy | Medium | Treat Mermaid mentions as technical install feedback only; verify dashboard copy/tests |
| Non-Pi runner visual support is ambiguous | Medium | Separate Orchestrator skill behavior from Pi-specific render package support |

## Rollback Plan

Revert the dashboard grouping/copy changes, remove the visual skill from Orchestrator installation catalogs, and restore the previous `runner-mermaid` planning behavior if needed. For environments where `pi-mermaid` was already installed by Deck, leave it installed as harmless internal support unless an explicit uninstall path can verify Deck ownership safely.

## Dependencies

- `pi-mermaid` must be installable for Pi via `pi install npm:pi-mermaid`.
- Existing Pi/OpenCode developer-team installer patterns for idempotent skill installation should inform the adapter layer.

## Open Questions

- For OpenCode, should this phase install only the Orchestrator visual skill and defer renderer support, or block OpenCode visual behavior until an equivalent renderer is defined?
- Should `pi-mermaid` live in `PI_INSTALLABLE_TOOLS` as a required internal package or in a new internal runner package catalog?

## Acceptance Direction

- [ ] Pi dashboard no longer presents Mermaid as an optional/configurable feature.
- [ ] Missing `pi-mermaid` is detected and installed silently; existing installs are treated as unchanged/ready.
- [ ] Deck-owned visual explanation skill is installed for Orchestrator by default, not all SDD subagents.
- [ ] Dashboard grouping presents `Packages`, `Adaptive Memory`, `Teams`, and final `Review & Install` feedback.
- [ ] OpenSpec artifacts and registry remain authoritative; visuals are only explanatory.

## Next Steps

Ready for Spec (`deck-developer-spec`) and Design (`deck-developer-design`) in parallel.
