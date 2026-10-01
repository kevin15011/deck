# Exploration: Complete Skill Discovery Runtime

## Outcome

Deck's skill registry is structurally sound but currently fails on ordinary skill metadata and does not provide an executable bridge from task-scoped discovery to exact native loading.

## Evidence

- Active OpenCode discovery observed 79 descriptors: 58 accepted and 21 rejected as `unsafe_frontmatter`.
- The rejected descriptors use ordinary nested metadata such as `metadata.author` and `metadata.version`.
- `packages/core/src/skill-discovery/discovery.ts` counts YAML representation nodes instead of logical collection nesting, so benign metadata exceeds the configured depth of three.
- `apps/cli/src/skill-registry-command.ts` correctly refuses persistence after any incomplete source evaluation.
- `packages/core/src/teams/developer/skill-discovery-content.ts` describes specialist discovery behavior, but production composition does not provide a task-scoped candidate search and exact selected-observation loading path.
- OpenCode and Pi expose discovery providers; equivalent Codex runtime support is not currently proven.

## Recommendation

Deliver two ordered slices: repair descriptor compatibility without weakening security, then add an additive runner-neutral search/selection contract with an OpenCode production vertical slice. Preserve the archived `agent-skill-registry-discovery` artifacts unchanged.
