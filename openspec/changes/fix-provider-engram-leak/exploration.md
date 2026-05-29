# Exploration: Provider: Engram Leak in Installed Prompts

## Goal
Find why 13/14 installed prompts still contain `Provider: Engram` after fixing `prompt-generation.ts` and reinstalling, when Supermemory is the active provider.

## Current State

### Data Flow (confirmed by code inspection)

```
buildOpenCodeDeveloperTeamInstallPlan(projectRoot, options?)
  │
  ├─ resolveOpenCodeMemoryInjection(options)
  │    └─ resolveMemoryInjection({ memoryProvider: options?.memoryProvider })
  │         └─ IF no memoryProvider passed → bundle = undefined ← ROOT CAUSE
  │
  ├─ buildPromptGenerationPlan({ capabilityInstructions, memoryBundle })
  │    └─ For each agent:
  │         buildPromptContent(agent, skillPath, capabilityInstructions, personality, memoryBundle)
  │           │
  │           ├─ getAgentContent(agentId, { capabilityInstructions })
  │           │    └─ composeCapabilityInstructions(base, bundle, { surface: "agent" })
  │           │         └─ Appends adaptive-memory fragment VERBATIM (no provider filtering)
  │           │              ↑ Fragment contains BOTH "Provider: Supermemory" AND "Provider: Engram"
  │           │
  │           ├─ determineActiveProvider(memoryBundle)
  │           │    └─ IF memoryBundle undefined → returns "unknown"
  │           │
  │           ├─ filterProviderSections(baseContent, activeProvider)
  │           │    └─ IF activeProvider === "unknown" → RETURNS UNFILTERED ← FILTER SKIPPED
  │           │
  │           └─ buildProviderAdaptiveMemorySection(memoryBundle, surface)
  │                └─ IF memoryBundle undefined → returns ""
```

### Root Cause Chain

1. **Source content**: `buildAdaptiveMemoryInstructionBundle()` (adaptive-memory.ts) creates 3 fragments (agent/session/skill), each containing BOTH `Provider: Supermemory` AND `Provider: Engram` sections.

2. **Unfiltered composition**: `composeCapabilityInstructions()` (instruction-bundles/index.ts:139-178) appends fragments verbatim via `matching.map(f => f.markdown).join("\n\n")` — NO provider filtering.

3. **Missing provider detection**: `determineActiveProvider(memoryBundle)` (prompt-generation.ts) requires `memoryBundle.toolBindings` to detect provider. When `memoryBundle` is `undefined`, returns `"unknown"`.

4. **Filter skipped**: `filterProviderSections()` (prompt-generation.ts) has early return when `activeProvider === "unknown"` — no filtering applied.

5. **Why memoryBundle is undefined**: `resolveOpenCodeMemoryInjection()` → `resolveMemoryInjection()` returns `undefined` when no `memoryProvider` is passed in options. The installer doesn't auto-detect the provider from the MCP config.

### Why Previous Fix Was Insufficient

The previous fix added `filterProviderSections` to `prompt-generation.ts`, which is architecturally correct. However:
- The filter depends on `memoryBundle` having tool bindings
- `memoryBundle` is only populated when a `memoryProvider` object is passed to the installer
- The CLI/install path does NOT pass a `memoryProvider` — it relies on `capabilityInstructions` alone
- Result: `activeProvider === "unknown"` → filter is a no-op → `Provider: Engram` leaks through

### x-sm-project Legacy `p:` Prefix

**Source**: `packages/adapter-opencode/src/opencode-mcp-config.ts:225`
```typescript
const projectId = `${parts[0]}-${parts[1]}`.toLowerCase().replace(/[^a-z0-9-]/g, "-");
return { projectId: `p:${projectId}`, derived: true };
```

**Current value**: `p:kevin15011-deck` (derived from git remote `kevin15011/deck`)

**Mismatch**: Supermemory's actual project IDs use `sm_project_*` format:
- `sm_project_default`
- `sm_project_deck`
- `sm_project_odk_raices`
- `sm_project_axis_one`

The `p:` prefix is a legacy convention that doesn't align with Supermemory's actual project namespace. This could cause memory scoping issues if the server expects `sm_project_*` format.

## Relevant Files

| File | Role |
|------|------|
| `packages/core/src/teams/developer/instruction-bundles/adaptive-memory.ts` | Source of BOTH provider sections in fragments (lines 91, 163, 291, 357) |
| `packages/core/src/teams/developer/instruction-bundles/index.ts` | `composeCapabilityInstructions` — appends fragments without filtering (line 176) |
| `packages/core/src/teams/developer/content-registry.ts` | `applyAgentContentComposition` — calls compose verbatim (line 345) |
| `packages/adapter-opencode/src/prompt-generation.ts` | `filterProviderSections` + `determineActiveProvider` — filter logic (line 148-178) |
| `packages/adapter-opencode/src/developer-team-install.ts` | `resolveOpenCodeMemoryInjection` — bundle resolution (line 241-277) |
| `packages/core/src/memory/adaptive-memory.ts` | `resolveMemoryInjection` — returns undefined when no provider (line 96-143) |
| `packages/adapter-opencode/src/opencode-mcp-config.ts` | `deriveProjectIdFromGitRemote` — generates `p:` prefix (line 205-236) |
| `packages/core/src/teams/developer/orchestrator-content.ts` | Hardcoded `Provider: Engram` at line 964 (separate from bundle) |

## Constraints

- Cannot modify `~/.config/opencode` directly; must fix source/installer
- `buildAdaptiveMemoryInstructionBundle()` is provider-neutral by design — both sections are intentional
- Filter must work even when `memoryBundle` is not available from the installer
- `composeCapabilityInstructions` is a generic composition function used for ALL instruction bundles, not just adaptive-memory

## Risks

- Modifying `composeCapabilityInstructions` could affect other instruction bundles
- Adding MCP config reading to prompt-generation couples adapter to MCP config format
- Removing one provider section from the source bundle means the bundle can't dynamically switch at runtime
- x-sm-project format change could break existing memory scoping

## Options and Tradeoffs

### Option A: Provider detection fallback from MCP config
Add a fallback in `buildPromptContent` that reads `opencode.json` to detect the active provider when `memoryBundle` is undefined.

- Pros: Minimal change, keeps existing architecture, works at install time
- Cons: Couples prompt-generation to MCP config format, needs config path
- Effort: Low

### Option B: Filter at composition time in core
Add a provider-aware filter parameter to `composeCapabilityInstructions` so fragments are filtered during composition.

- Pros: Filters at the source, works regardless of installer path
- Cons: Changes core API, all callers must pass provider info
- Effort: Medium

### Option C: Build only active provider's section
Modify `buildAdaptiveMemoryInstructionBundle()` to accept a provider parameter and only include the active section.

- Pros: Cleanest output, no post-hoc filtering needed
- Cons: Changes core API, requires provider detection at bundle build time
- Effort: Medium

### Option D (Recommended): Dual-layer fix
1. Add `detectProviderFromMcpConfig(configDir)` fallback in `prompt-generation.ts` (Option A)
2. Also add provider parameter to `buildAdaptiveMemoryInstructionBundle()` so the source bundle only contains the active provider (Option C as defense-in-depth)

- Pros: Belt-and-suspenders, fixes both the filter activation and the source content
- Cons: Two changes, slightly more work
- Effort: Medium

### x-sm-project Fix
Change `deriveProjectIdFromGitRemote` to produce `sm_project_{repo}` format instead of `p:{owner}-{repo}`, or look up the actual project ID from the Supermemory API.

- Pros: Aligns with actual Supermemory project IDs
- Cons: Needs API call or config lookup for project mapping
- Effort: Low

## Recommendation

**Option D (Dual-layer fix)**:
1. **Filter activation**: Add `detectProviderFromMcpConfig(configDir)` in `prompt-generation.ts` as fallback when `memoryBundle` is undefined. This ensures the existing `filterProviderSections` actually runs.
2. **Source reduction**: Optionally modify `buildAdaptiveMemoryInstructionBundle()` to accept a provider hint and omit the inactive section entirely (defense-in-depth).
3. **x-sm-project**: Change the `p:` prefix to match Supermemory's `sm_project_*` format or remove the prefix entirely.

## Tests to Add/Update

1. `prompt-generation.test.ts`: Add test case where `memoryBundle` is undefined but MCP config indicates Supermemory → verify `Provider: Engram` is filtered
2. `prompt-generation.test.ts`: Add test for `detectProviderFromMcpConfig()` fallback
3. `prompt-generation.test.ts`: Verify ALL 14 agent prompts filter correctly with and without `memoryBundle`
4. `developer-team-install.test.ts`: Add test where `memoryProvider` is not passed but MCP config has Supermemory → verify prompts are filtered
5. `opencode-mcp-config.test.ts`: Add test for `deriveProjectIdFromGitRemote` producing correct Supermemory-compatible format

## Open Questions

- Is the `p:kevin15011-deck` format causing actual memory scoping failures, or does Supermemory accept it?
- Should the installer auto-detect the provider from MCP config, or should the CLI always pass `memoryProvider`?
- Is the orchestrator prompt generated as a file or inline? (It doesn't appear in `~/.config/opencode/prompts/`)

## Confidence

**HIGH** — Root cause traced to `memoryBundle === undefined` → `activeProvider === "unknown"` → filter skipped. All source files, line numbers, and data flow confirmed by code inspection.

## Registry

- **Artifact Path**: `openspec/changes/fix-provider-engram-leak/exploration.md`
- **State Path**: `openspec/changes/fix-provider-engram-leak/state.yaml`
- **Events Path**: `openspec/changes/fix-provider-engram-leak/events.yaml`
- **Recorded**: phase `explore`, status `completed`
- **Registry Blocker**: none
