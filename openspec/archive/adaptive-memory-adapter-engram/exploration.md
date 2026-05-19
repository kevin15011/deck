## Exploration: Adaptive memory adapter with Engram injection

### Goal
Investigate how to add adaptive memory instructions for the Developer Team / SDD flow using Engram as a pluggable adapter while keeping Deck core provider-agnostic and OpenSpec as the source of truth.

### Current State
Deck is a Bun/TypeScript monorepo with runtime-neutral Developer Team definitions in `packages/core` and runtime adapters for Pi/OpenCode. The SDD workflow is implemented as 12 Developer Team agents with thin agent bodies and detailed matching skills under `packages/core/src/teams/developer/`; adapters materialize those bodies into runtime-specific files. OpenSpec artifacts are required and the Spec Registry already has neutral `sync.*` event types and `syncTarget` extension fields for future memory/graph adapters. Memory behavior is currently documented/generic, not implemented as a provider abstraction: prompts say memory is auxiliary and may be used if an adapter is available, while tool installers only detect/install-guide Engram as an external binary. There is no current `MemoryProvider` package, no adaptive memory adapter interface, and no dynamic instruction injection pipeline beyond static content registry strings and Pi session profile generation.

### Relevant Files
- `definition.md` — Product philosophy: environment-first, local-first, adapter-based architecture, provider-based memory, Engram as first candidate provider.
- `docs/technology-decisions.md` — Architecture guardrails: core owns `MemoryProvider` abstraction; Engram is not a hard dependency; adapters/providers replaceable.
- `docs/current-state.md` — Current implementation handoff; confirms OpenSpec required, memory auxiliary, future memory/graph adapters must be event-driven and provenance-aware.
- `docs/developer-team.md` — Developer Team workflow, agent/skill separation, skill injection pattern, artifact/memory policy, Phase 5 AI notes status.
- `docs/openspec-registry-roadmap.md` — Spec Registry sync model with neutral `sync.targeted`, `sync.completed`, `sync.failed` and generic sync targets.
- `docs/pi-agent-installation.md` — Pi materialization strategy, direct-files backend, required tools, and note that Engram/MCP setup should be package/tool-owned.
- `docs/tool-references.md` — Canonical Engram reference as external `engram` tool; warns not to invent Pi package names for Engram.
- `packages/core/src/teams/developer/content-registry.ts` — Runtime-neutral registry returning static agent/skill bodies and team session instructions.
- `packages/core/src/teams/developer/orchestrator-content.ts` — Static session prompt/skill currently contains generic memory and `.deck/ai-notes/` Phase 5 instructions.
- `packages/core/src/teams/developer/*-content.ts` — Agent/skill prompt sources; several include generic optional memory text, and Proposal/Spec/Design/Task return templates still mention `engram topic key`.
- `packages/core/src/spec-registry/types.ts` — Provider-neutral sync fields and event types; no Engram names in core types.
- `packages/core/src/spec-registry/events.ts` — Event factory for neutral provenance events.
- `packages/adapter-pi/src/developer-team-install.ts` — Pi materializer; wraps core bodies with Pi frontmatter and fixed `tools: read,write,bash`.
- `packages/adapter-pi/src/pi-team-profile.ts` — Builds Pi team system prompt from core registry and writes `.deck/pi/profiles/<team>/system-prompt.md`.
- `packages/adapter-pi/src/pi-team-launch.ts` — Launch plan for Pi Developer Team; passes generated system prompt and model/thinking args.
- `packages/adapter-pi/src/installation-plan.ts` and `packages/adapter-pi/src/required-tools.ts` — Current Pi tool detection/plan includes optional external `engram-memory`.
- `packages/adapter-opencode/src/developer-team-install.ts` — OpenCode materializer consumes the same core content, useful for keeping injection runtime-agnostic.
- `apps/cli/src/tui/app.tsx` and `apps/cli/src/menu-options.ts` — Installation flow and menu; memory configuration is currently a placeholder, while Developer Team install is wired for Pi.
- `packages/*/*.test.ts` and `apps/cli/src/**/*.test.tsx` — Existing unit tests assert content registry consumption, no artifact-store mode selection, neutral sync types, and install/profile behavior.

### Constraints
- OpenSpec remains required and authoritative; memory must never replace or overwrite OpenSpec artifacts.
- Core must not hardcode Engram, Engram MCP tool names, Pi-specific MCP setup, or provider-specific prompt instructions.
- Engram must plug in by injection: adapter-supplied instructions/tooling should be composed into runtime materialization or launch context.
- Existing architecture separates core canonical team content from runtime materialization; changes should preserve Pi and OpenCode adapter boundaries.
- Phase 5 `.deck/ai-notes/` is deferred; this change should not activate repo-owned AI notes unless explicitly scoped later.
- Engram is currently treated as an external tool/binary, not a Pi package; installation may need manual guidance or provider-owned init commands.
- Tests currently assert no old `engram | openspec | hybrid | none` artifact-store mode and no adapter-specific names in Spec Registry event types.

### Risks
- Static prompts already contain generic memory language and a few `engram topic key` placeholders; leaving these creates provider leakage and weakens the provider-agnostic requirement.
- Adding Engram instructions directly to agent prompt constants would duplicate provider logic across 12 agents and break the requested injection model.
- Putting Engram logic only in `adapter-pi` is fast but risks coupling memory providers to one runtime and repeating work for OpenCode/Codex/Claude.
- Engram MCP tool names/config schema are not present in this repo; implementing without validating the actual Engram MCP contract could generate unusable instructions.
- If memory write instructions are too strong, agents may treat memory as an artifact store and bypass OpenSpec.
- Runtime tool permissions/frontmatter differ by adapter; injected tool bindings need adapter-specific translation without polluting core types.

### Options and Tradeoffs
1. **Generic instruction bundle in core + Engram provider package** — Add a provider-neutral instruction/tooling contract in core (or a new memory contracts package), and implement Engram as a separate provider that returns injectable markdown/tool bindings consumed by runtime adapters.
   - Pros: Preserves provider agnosticism; aligns with `MemoryProvider` direction; reusable across Pi/OpenCode/future runtimes; allows tests to prove core contains no Engram names; keeps agent prompts thin.
   - Cons: More design work; requires a composition point in content/profile generation; Engram MCP details must be validated before final implementation.
   - Effort: Medium

2. **Pi-only Engram injection in `adapter-pi`** — Keep core unchanged and let Pi adapter append Engram-specific instructions/frontmatter/tools when `engram-memory` is selected.
   - Pros: Fastest path for Pi MVP; minimal package restructuring; fits current Pi direct-files materializer.
   - Cons: Couples memory provider behavior to Pi; hard to reuse for OpenCode; risks scattering provider-specific logic in runtime adapters; does not establish the requested adapter abstraction.
   - Effort: Low/Medium

3. **Static prompt edits for Engram** — Edit Developer Team prompt/skill constants to include Engram instructions directly.
   - Pros: Simple implementation and easy to see in generated agent files.
   - Cons: Violates the request; hardcodes provider behavior in agent prompts; duplicates instructions across agents; conflicts with current architecture and tests guarding provider-neutral core.
   - Effort: Low but not recommended

4. **Spec Registry sync-only integration** — Use existing neutral `sync.*` events to synchronize OpenSpec artifacts to Engram after artifacts are written, without injecting agent memory behavior.
   - Pros: Strong provenance; preserves OpenSpec authority; aligns with roadmap Phase 4.
   - Cons: Does not satisfy adaptive memory instruction/tool usage during agent work; only covers artifact sync, not retrieval/preferences/session learning.
   - Effort: Medium

### Recommendation
Use Option 1 as the main path, with Option 4 as a later extension: introduce a provider-neutral adaptive memory injection contract and implement Engram outside core as the first provider. The contract should let a memory adapter supply concise retrieval/write policies, provider-specific MCP tool instructions, and runtime tool bindings as opaque injectable fragments. Runtime adapters should compose those fragments into session prompts and/or generated agent/skill files at install/launch time. As part of the change, remove the remaining `engram topic key` placeholders from core prompt templates and replace them with provider-neutral language.

### Open Questions
- What are the exact Engram MCP tool names, required MCP configuration, and initialization commands?
- Should adaptive memory be selected during environment installation, Developer Team installation, launch, or via a separate `Configure memory` flow?
- Should memory injection target only the orchestrator session prompt, all agent files/skills, or role-specific subsets?
- Should the first implementation persist only preferences/summaries, or also index OpenSpec artifacts through Spec Registry `sync.*` events?
- Should the provider contract live in `packages/core`, a new `packages/memory`, or a dedicated adapter package such as `packages/memory-engram`?
- How should OpenCode consume injected memory/tool instructions, given the CLI currently materializes OpenCode Developer Team assets in adapter tests but the main TUI Developer Team install flow is Pi-focused?

### Ready for Proposal
Yes — communicate that the proposal should avoid prompt hardcoding, define a provider-neutral injection contract, add Engram as an external provider/adapter, preserve OpenSpec authority, and include tests proving core remains provider-agnostic while Engram instructions appear only when injected.
