# Exploration: Configure Packages Toggle — Conditional Instruction Injection

## Goal
Understand the current agent prompt/instruction generation architecture in the Deck project, identify how adapters communicate configuration, find any existing conditional instruction patterns, and map the gaps needed for a "Configure Packages" toggle system that conditionally injects tool-specific instructions into agent prompts.

## Current State

### 1. Prompt/Instruction Injection Architecture

The Deck project has a **three-layer architecture** for agent content:

**Layer 1 — Core Content Registry (`packages/core/src/teams/developer/`)**
- `content-registry.ts` is the canonical source of truth. It exports `getAgentContent(agentId)` and `getTeamSessionInstructions(teamId)`.
- Agent content is stored as **static string constants** in individual files (`orchestrator-content.ts`, `explorer-content.ts`, etc.).
- The `REAL_CONTENT` map in `content-registry.ts` statically maps every `DEVELOPER_TEAM_AGENTS` ID to its `{ agentBody, skillBody }`.
- **Context Authority Guidance** is appended to ALL agent/skill bodies unconditionally via `withContextAuthorityGuidance()`.
- **Visual Explanations** are composed into the Orchestrator skill only: `ORCHESTRATOR_SKILL_BODY + VISUAL_EXPLANATIONS_SKILL_FRAGMENT`. This is the only existing conditional composition in the core.
- `manifest.ts` builds a `DeveloperTeamManifest` from the catalog + optional `modelAssignments` + optional `memoryBundle`. It does NOT conditionally alter prompt content based on tools.

**Layer 2 — Adapter Serializers (`packages/adapter-pi/`, `packages/adapter-opencode/`)**
- Both adapters consume `getAgentContent()` from the core registry.
- **Pi adapter** (`developer-team-install.ts`): `buildAgentFileContent()` and `buildSkillFileContent()` read core content, apply optional `memoryBundle` via `composeAdaptiveMemory()`, and wrap in Pi frontmatter (tools, model, thinking).
- **OpenCode adapter** (`developer-team-install.ts`): `buildSkillFileContent()` does the same. `prompt-generation.ts` builds prompt files with `ORCHESTRATOR_SYSTEM_PROMPT` for the orchestrator and `content.agentBody` for others.
- Neither adapter modifies the body content based on installed/selected tools or capabilities.

**Layer 3 — Runtime Injection (Adaptive Memory)**
- `packages/core/src/memory/adaptive-memory.ts` provides `composeAdaptiveMemory(base, bundle, context)`.
- `MemoryInjectionBundle` contains `instructions: MemoryInstructionFragment[]` and `toolBindings: MemoryToolBinding[]`.
- Fragments are matched by `surface` (session/agent/skill), `teamId`, `agentIds`, and `skillIds`.
- This is the **only existing conditional instruction injection mechanism** in the entire system. It is currently used only for memory providers (Engram, Supermemory), not for general tool/capability instructions.

### 2. User Configuration Storage and Sharing

**Deck Config (`packages/core/src/config/deck-config.ts`)**
- Stored at `.deck/config.json`.
- Currently only holds `adaptiveMemory` config (`activeProvider`, `supermemory` settings).
- There is **no field for selected capabilities, optional tools, or plugin instructions**.
- Both adapters read/write this config via `writeDeckConfig()` / `readDeckConfig()`.

**Adapter-Specific Config**
- **Pi**: Reads model assignments from `.pi/agents/*.md` frontmatter. Reads MCP config from `~/.pi/agent/mcp.json`.
- **OpenCode**: Reads/writes `~/.config/opencode/opencode.json` for agent entries and plugins.
- There is **no shared config file** that both adapters read for tool/capability selection state.

**Dashboard State (Ephemeral)**
- `apps/cli/src/tui/pi-runner-dashboard/state.ts` defines `RunnerDashboardState`.
- `selectedCapabilities: Partial<Record<CapabilityId, boolean>>` is the runtime toggle state.
- This state is **never persisted to disk**. It lives only in the TUI session and is used to build the install plan.

### 3. Existing Conditional Instruction Patterns

**Pattern A: Static Conditional Composition in Core**
- Visual explanations are appended to the Orchestrator skill only (`REQ-VISUAL-002`).
- This is hardcoded in `content-registry.ts`, not driven by external configuration.

**Pattern B: Adaptive Memory Injection**
- `composeAdaptiveMemory()` conditionally appends instruction fragments based on `surface`, `agentId`, and `skillId`.
- Used for Engram/Supermemory memory instructions and tool bindings.
- The matching is runtime-driven by the `MemoryInjectionBundle` provided by the adapter.

**Pattern C: Tool Line in Pi Frontmatter**
- `buildAgentFileContent()` in the Pi adapter appends memory tool bindings to the `tools:` frontmatter line.
- Example: `baseTools = "read,write,bash"` → adds `supermemory.execute`, `supermemory.search_docs` if memory bindings exist.
- This is the only place where tool availability affects the generated agent file, and it only affects the frontmatter, not the body content.

**Pattern D: Internal Runner Packages (Silent Install)**
- `pi-mermaid` is installed silently without user toggle. The plan builder (`capability-plan.ts`) automatically adds an install action if the package is missing.
- This is not conditional instruction injection; it is silent package installation.

### 4. Capability/Tool Selection in Adapters

**Pi Adapter**
- `capability-catalog.ts`: Defines user-facing capabilities (`context-mode`, `codebase-memory`, `rtk`, `pi-hud`).
- `installation-plan.ts`: Defines `PI_INSTALLABLE_TOOLS` with `required: true/false`.
- `runner-capabilities.ts`: `getOptionalTools()` returns optional tools. `buildInstallationPlan()` takes `selectedOptionalToolIds`.
- `capability-plan.ts`: `buildPiRunnerReviewPlan()` translates selected capabilities into `RunnerAction` groups (automatic, manual, config, team, validation).

**OpenCode Adapter**
- Same structure: `capability-catalog.ts`, `installation-plan.ts`, `capability-plan.ts`.
- Capabilities: `context-mode`, `codebase-memory`, `rtk`.
- `buildOpenCodeRunnerReviewPlan()` does the same translation.

**Key Observation**: The capability/plan system is **purely about installation orchestration**. It decides WHICH packages to install, but it never feeds back into prompt content generation. There is **zero coupling** between the capability selection system and the content registry.

### 5. CLI TUI Screens

**Existing Screens in `apps/cli/src/tui/`:**
- `home-screen.tsx` — Start installation, Configure models, Exit.
- `pi-runner-dashboard-screens.tsx` — Runtime-agnostic dashboard with sections: Packages, Adaptive Memory, Teams, Review & Install.
- `developer-team-screens.tsx` — Model configuration, memory provider selection, supermemory setup.

**No existing screen** for "Configure Packages" beyond the Packages section of the runner dashboard. The dashboard already has a `PackagesDetail` screen that lists toggleable capabilities.

## Relevant Files

| File | Role |
|------|------|
| `packages/core/src/teams/developer/content-registry.ts` | Canonical agent/skill content registry; static `REAL_CONTENT` map |
| `packages/core/src/teams/developer/manifest.ts` | Builds `DeveloperTeamManifest` from catalog + model assignments + memory bundle |
| `packages/core/src/memory/adaptive-memory.ts` | `composeAdaptiveMemory()` — only conditional instruction injection mechanism |
| `packages/core/src/memory/adaptive-context-renderer.ts` | Renders `## OFFICIAL CONTEXT` / `## ADAPTIVE CONTEXT` sections |
| `packages/core/src/config/deck-config.ts` | `.deck/config.json` schema — only adaptiveMemory today |
| `packages/adapter-pi/src/developer-team-install.ts` | Pi agent/skill file builders; applies memory bundle to frontmatter + body |
| `packages/adapter-pi/src/capability-plan.ts` | Translates selected capabilities into install actions |
| `packages/adapter-opencode/src/developer-team-install.ts` | OpenCode skill file builder; applies memory bundle |
| `packages/adapter-opencode/src/prompt-generation.ts` | OpenCode prompt file generation |
| `packages/adapter-opencode/src/capability-plan.ts` | OpenCode capability → install action translation |
| `apps/cli/src/tui/pi-runner-dashboard/state.ts` | Dashboard state — `selectedCapabilities` is ephemeral |
| `apps/cli/src/tui/pi-runner-dashboard/reducer.ts` | Dashboard reducer — toggles capabilities, invalidates plan |
| `apps/cli/src/tui/screens/pi-runner-dashboard-screens.tsx` | Dashboard UI — Packages, Adaptive Memory, Teams, Review & Install |
| `apps/cli/src/tui/app.tsx` | Main TUI app — orchestrates install flow, no package→prompt coupling |

## Constraints

- Core content registry is **static and runner-neutral**. Adding dynamic composition would require extending the registry interface.
- Adapters currently consume content in a **one-way flow**: core → adapter → disk files. There is no feedback loop from adapter capability state back to core content.
- `.deck/config.json` has a strict schema with `unknown field` rejection. Adding new fields requires a config version migration or careful extension.
- Both Pi and OpenCode adapters maintain **separate capability catalogs** (`PI_INSTALLABLE_TOOLS` vs `OPENCODE_INSTALLABLE_TOOLS`). Any conditional instruction system would need to work across both or be abstracted.
- The existing `MemoryInjectionBundle` / `composeAdaptiveMemory` mechanism is provider-specific and uses `surface`, `agentIds`, `skillIds` matching. It could be generalized, but that would expand its scope beyond "adaptive memory."

## Risks

1. **Scope Creep**: A "Configure Packages" toggle system could easily grow into a full plugin architecture. Need to bound it to instruction injection only.
2. **Adapter Divergence**: Pi and OpenCode have different file formats (Pi: agent/skill MD with frontmatter; OpenCode: prompt files + opencode.json + skill MD). Any conditional content must be serializable to both formats.
3. **Config Drift**: If selected packages are persisted in `.deck/config.json`, but the user later installs packages manually, the config and reality could diverge.
4. **Orchestrator Complexity**: The Orchestrator agent's system prompt is the longest and most complex. Adding conditional sections to it increases the risk of exceeding context windows or diluting core instructions.
5. **Testing Surface**: The content registry has snapshot tests for every agent. Adding dynamic composition would require new test patterns for conditional content.

## Options and Tradeoffs

### Option A: Extend `MemoryInjectionBundle` to Support Capability Instructions
Reuse the existing `composeAdaptiveMemory()` mechanism but generalize it to accept capability-driven instruction fragments.

- **Pros**: Minimal new infrastructure; leverages existing `surface`/`agentId`/`skillId` matching; adapters already know how to apply bundles.
- **Cons**: Overloads the "adaptive memory" concept; name and semantics would need refactoring; still requires a new source of fragments beyond memory providers.
- **Effort**: Medium

### Option B: Add a New `PluginInstructionBundle` Parallel to `MemoryInjectionBundle`
Create a new core type (e.g., `PluginInstructionBundle` with `PluginInstructionFragment[]`) and a new composer function (e.g., `composePluginInstructions(base, bundle, context)`). Adapters would build this bundle from selected capabilities and pass it to agent/skill builders.

- **Pros**: Clean separation from adaptive memory; explicit semantics; easy to test in isolation.
- **Cons**: New core abstraction to maintain; adapters need to be updated to build and apply the bundle.
- **Effort**: Medium-High

### Option C: Extend the Content Registry with Conditional Sections
Modify `content-registry.ts` to support conditional sections within agent/skill bodies. For example, define `OPTIONAL_CONTENT` maps keyed by capability ID, and the registry appends matching sections based on a `enabledCapabilities` parameter.

- **Pros**: Centralized in core; all adapters benefit automatically; easy to see what content is conditional.
- **Cons**: Core becomes less "runner-neutral" if it knows about specific tools; registry interface changes break existing consumers.
- **Effort**: Medium

### Option D: Persist `selectedCapabilities` to `.deck/config.json` and Let Adapters Inject at Build Time
Add a `selectedCapabilities` or `enabledPlugins` field to `DeckConfig`. Adapters read this config during `buildDeveloperTeamInstallPlan` and append tool-specific instruction paragraphs to the body content before writing files.

- **Pros**: Simple and direct; config is the single source of truth; no new core abstractions needed.
- **Cons**: Duplicated logic in both adapters; not truly runner-neutral; harder to test because injection is spread across adapters.
- **Effort**: Low-Medium

## Recommendation

**Option B (new `PluginInstructionBundle`) or a hybrid of B + C**.

The cleanest architecture is to introduce a new core concept: **runner-neutral capability instruction fragments** that are separate from adaptive memory. The core should define:
1. A new type `CapabilityInstructionBundle` with fragments matched by `capabilityId`, `surface`, `agentIds`, `skillIds`.
2. A new composer `composeCapabilityInstructions(base, bundle, context)`.
3. Extend `getAgentContent()` to optionally accept an `enabledCapabilities` list and append matching fragments.

Adapters would:
1. Read selected capabilities from dashboard state or `.deck/config.json`.
2. Build a `CapabilityInstructionBundle` from a catalog of capability-specific instructions (stored in core or adapter).
3. Pass the bundle to the install plan builders, which apply it alongside (or merged with) the adaptive memory bundle.

This preserves runner-neutrality, keeps conditional logic testable in core, and avoids overloading the memory system.

## Open Questions

1. **Where do capability-specific instructions live?** In core (runner-neutral) or in each adapter (runner-specific)? The existing pattern for visual explanations is core-owned, but tool-specific instructions might need runner-specific nuances.
2. **Should the Orchestrator receive ALL capability instructions, or only those relevant to its delegation targets?** The Orchestrator skill is already the longest; adding more conditional sections increases size.
3. **How does this interact with the existing `optional-tools` screen in the install flow?** The install flow already has an `optional-tools` screen that toggles packages for installation. Is the new system a replacement, an extension, or a separate "post-install configuration" step?
4. **Should `.deck/config.json` be extended, or should selected capabilities be inferred from the runner environment (e.g., checking what Pi packages are installed)?** Inferring avoids config drift but is less deterministic.

## Ready for Proposal

**Yes**, with the following prerequisites for the Proposal agent:
- Decide whether capability instructions are core-owned or adapter-owned.
- Decide whether to extend `.deck/config.json` or infer from environment.
- Clarify whether this replaces the existing `optional-tools` install flow or adds a new persistent configuration layer on top of it.

## Registry

- **Artifact Path**: `openspec/changes/configure-packages-toggle/exploration.md`
- **State Path**: `openspec/changes/configure-packages-toggle/state.yaml`
- **Events Path**: `openspec/changes/configure-packages-toggle/events.yaml`
- **Recorded**: phase `explore`, status `completed`, event `exploration-completed`
- **Registry Blocker**: none
