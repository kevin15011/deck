# Proposal: Adaptive Memory Adapter with Engram Injection

## Intent

Enable a full Developer Team / SDD flow test with adaptive memory using Engram, without hardcoding Engram instructions in agent prompts. Deck must remain memory-provider agnostic; OpenSpec stays authoritative and memory auxiliary.

## Goal

Provide injectable memory guidance so Engram MCP usage appears only when an Engram provider is selected.

## Scope

### In Scope
- Provider-neutral adaptive memory injection for Developer Team runtime context.
- Engram as the first injectable memory adapter/provider, outside static core prompts.
- Removal/neutralization of Engram-specific placeholders in core Developer Team content.
- Preservation of OpenSpec and Spec Registry as authoritative SDD records.

### Out of Scope
- Replacing OpenSpec with memory storage.
- Activating `.deck/ai-notes/` / Phase 5 notes.
- Full OpenSpec-to-Engram sync unless separately specified.
- Hardcoding Engram MCP tool names in core prompts.

## Affected Capabilities

### New Capabilities
- `adaptive-memory-injection`: Provider-neutral composition of memory instructions/tool bindings.
- `engram-memory-adapter`: Engram-provided injectable adaptive memory instructions.

### Modified Capabilities
- `developer-team-content`: Replace provider-specific memory wording with injectable guidance.
- `developer-team-runtime-materialization`: Compose optional memory fragments during install/launch/materialization.

### Unchanged Capabilities
- `openspec-artifacts`: Required and authoritative.
- `spec-registry-events`: Provider-neutral provenance/sync model remains unchanged.

## Approach

Define a small provider-neutral injection contract that returns opaque instruction fragments and runtime tool-binding metadata. Runtime adapters compose selected provider fragments into session prompts and/or generated agent assets. Implement Engram outside core prompt constants and test that core remains Engram-free while Engram text appears only through injection.

## Alternatives and Tradeoffs

| Alternative | Why Considered | Why Not Chosen |
|---|---|---|
| Pi-only injection | Fast current-path MVP | Couples memory to one runtime |
| Static prompt edits | Simple | Violates injection and provider-agnostic requirements |
| Registry sync only | Strong provenance | Does not enable in-flow adaptive memory |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Unknown Engram MCP contract | Medium | Validate tool names/config before implementation |
| Memory treated as artifact store | Medium | Keep OpenSpec authority explicit |
| Runtime tool-binding mismatch | Medium | Translate provider metadata per adapter |

## Rollback Plan

Disable provider selection/injection and remove Engram provider registration. Neutral Developer Team prompts and existing OpenSpec artifacts continue to work without memory.

## Dependencies

- Confirmed Engram MCP tool names, config, and initialization.
- Decision on provider selection point in install/launch flow.

## Open Questions

- Should injection target orchestrator, all agents, skills, or role-specific subsets?
- Should provider selection happen during environment install, Developer Team install, launch, or Configure memory?
- Should initial Engram scope include preferences/summaries only, or later Spec Registry sync?

## Acceptance Direction

- [ ] Core Developer Team prompt sources contain no Engram-specific instructions/placeholders.
- [ ] Engram instructions appear only through explicit provider injection.
- [ ] OpenSpec remains required; memory remains auxiliary.

## Next Steps

Ready for Spec (`deck-developer-spec`) and Design (`deck-developer-design`) in parallel.
