# Exploration: Adaptive Memory Heading Duplication & Missing Backtick Tool Refs

## Goal

Identify why installed prompts have (1) 3 `## Adaptive Memory` headings in orchestrator and (2) 0 exact backtick refs to `memory`/`recall` in 14/14 agent prompts after R31.

## Current State

### Heading Duplication (3 headings in orchestrator)

The orchestrator installed prompt contains **3** `## Adaptive Memory` headings from 3 independent injection paths:

1. **Source: `ORCHESTRATOR_SKILL_BODY` line 913** — static text `## Adaptive Memory` inside the orchestrator skill body constant.
   - File: `packages/core/src/teams/developer/orchestrator-content.ts:913`
   - Heading: `## Adaptive Memory` (bare, no suffix)
   - **This heading is NOT in the prompt** — it's only in the skillBody, not the session/agent prompt. However, it IS in the installed skill file at `~/.config/opencode/skills/deck-developer-orchestrator/SKILL.md`.

2. **Source: `composeCapabilityInstructions` via `getTeamSessionInstructions`** — when `capabilityInstructions` bundle includes `adaptive-memory` fragments.
   - File: `packages/core/src/teams/developer/instruction-bundles/index.ts:176-178`
   - Heading: `## Adaptive Memory` (from the fragment's markdown, line 22/170/265 of `adaptive-memory.ts`)
   - Wrapped under `## Package Instructions (configured)` parent heading
   - Surface: `session` fragment for orchestrator

3. **Source: `buildProviderAdaptiveMemorySection` in `prompt-generation.ts`** — R31 fallback when provider detected.
   - File: `packages/adapter-opencode/src/prompt-generation.ts:228-238`
   - Heading: `## Adaptive Memory (provider-injected)` (from `ADAPTIVE_MEMORY_SECTION_HEADING` constant)
   - File: `packages/core/src/memory/adaptive-memory.ts:87`
   - This is the **provider-specific injection** that uses the `MemoryInjectionBundle` fragments

**Root cause of 3 headings**: When `capabilityInstructions` includes `adaptive-memory` AND `memoryBundle` is also present (or R31 fallback creates it), the SAME adaptive-memory content gets injected via TWO independent paths. The orchestrator prompt ends up with:
- `## Package Instructions` → `## Adaptive Memory` (from capabilityInstructions path)
- `## Adaptive Memory (provider-injected)` → `## Adaptive Memory` (from memoryBundle path)

For non-orchestrator agents, both paths inject into `agentBody` (surface `agent`), same duplication.

### Missing Backtick Tool Refs (0 refs in all 14 prompts)

The adaptive-memory instruction bundle references tools as:

```
- **memory** (action: "save", content: "...") — commit a memory
- **memory** (action: "forget", content: "...") — remove a memory
- **recall** (query: "...", includeProfile?: boolean) — retrieve relevant memories
```

These use **bold** (`**memory**`) not **backticks** (`` `memory` ``). The tool names are wrapped in `**` markdown bold, not backtick code spans.

- File: `packages/core/src/teams/developer/instruction-bundles/adaptive-memory.ts:95-97` (and identical lines at 196-198, 311-313)
- Pattern: `- **memory** (action: "save", content: "...")` instead of `` - `memory` (action: "save", content: "...") ``
- Count: **0 backtick refs** across all 3 fragments (agent, session, skill surfaces)

## Relevant Files

| File | Role |
|------|------|
| `packages/core/src/teams/developer/instruction-bundles/adaptive-memory.ts` | Source of 3 `## Adaptive Memory` fragments with `**memory**` (bold, not backtick) refs |
| `packages/core/src/teams/developer/orchestrator-content.ts:913` | Static `## Adaptive Memory` heading in `ORCHESTRATOR_SKILL_BODY` |
| `packages/core/src/teams/developer/instruction-bundles/index.ts:176-178` | `composeCapabilityInstructions` injects fragments under `## Package Instructions` |
| `packages/core/src/memory/adaptive-memory.ts:87` | `ADAPTIVE_MEMORY_SECTION_HEADING = "## Adaptive Memory (provider-injected)"` |
| `packages/adapter-opencode/src/prompt-generation.ts:228-238` | `buildProviderAdaptiveMemorySection` — second injection path |
| `packages/adapter-opencode/src/prompt-generation.ts:365` | R31 fallback: `effectiveMemoryBundle = memoryBundle ?? (explicitProvider ? buildAdaptiveMemoryInstructionBundle() : undefined)` |
| `packages/adapter-opencode/src/prompt-generation.ts:257-298` | `buildPromptContent` composes: skillGate + filteredBase + providerMemory + reference |
| `packages/core/src/teams/developer/content-registry.ts:514-537` | `getTeamSessionInstructions` — orchestrator session prompt with capabilityInstructions composition |
| `packages/adapter-opencode/src/developer-team-install.ts:453-459` | Passes both `capabilityInstructions` and `memoryBundle` to `buildPromptGenerationPlan` |

## Heading Source Mapping

| Heading Text | Source File | Line | Injection Path |
|---|---|---|---|
| `## Adaptive Memory` | `orchestrator-content.ts` | 913 | Static in `ORCHESTRATOR_SKILL_BODY` → skill file only |
| `## Adaptive Memory` | `adaptive-memory.ts` (bundle) | 22, 170, 265 | Via `composeCapabilityInstructions` → `## Package Instructions` section |
| `## Adaptive Memory (provider-injected)` | `adaptive-memory.ts` (core constant) | 87 | Via `buildProviderAdaptiveMemorySection` → `ADAPTIVE_MEMORY_SECTION_HEADING` |

### Installed Orchestrator Prompt Has:

1. `## Package Instructions (configured)` → `## Adaptive Memory` (from capabilityInstructions)
2. `## Adaptive Memory (provider-injected)` → `## Adaptive Memory` (from memoryBundle/provider)

### Installed Orchestrator Skill Has:

1. `## Adaptive Memory` (static from `ORCHESTRATOR_SKILL_BODY:913`)
2. `## Package Instructions (configured)` → `## Adaptive Memory` (from capabilityInstructions)

## Tool Ref Source Issue

| Current Format | Location | Lines |
|---|---|---|
| `- **memory** (action: "save", ...)` | `adaptive-memory.ts` | 95, 196, 311 |
| `- **memory** (action: "forget", ...)` | `adaptive-memory.ts` | 96, 197, 312 |
| `- **recall** (query: ..., ...)` | `adaptive-memory.ts` | 97, 198, 313 |

**Issue**: Bold (`**`) instead of backtick (`` ` ``) code spans. Agent LLMs parse backtick-wrapped names as exact tool identifiers. Bold is interpreted as emphasis, not code. This reduces tool-calling accuracy.

## Constraints

- Cannot modify `~/.config/opencode` directly (user constraint)
- Must maintain backward compatibility with existing prompt structure
- `composeCapabilityInstructions` is shared by all agents — changes affect all surfaces
- The `MemoryInjectionBundle` and `CapabilityInstructionBundle` are separate types with separate injection paths

## Risks

- Removing `adaptive-memory` from `capabilityInstructions` path may break other adapters (adapter-pi) that rely on it
- Changing heading text may break existing tests that check for exact heading strings
- Backtick change is cosmetic but affects LLM tool-calling behavior

## Options and Tradeoffs

### Option A: Remove adaptive-memory from capabilityInstructions, keep only provider-injected path

- **Pros**: Single heading, single source of truth, cleaner
- **Cons**: adapter-pi uses `composeAdaptiveMemory` not `buildProviderAdaptiveMemorySection`; may break PI path; requires testing both adapters
- **Effort**: Medium

### Option B: Deduplicate in `buildPromptContent` — strip `## Adaptive Memory` from `filteredBaseContent` when `providerMemoryContent` is non-empty

- **Pros**: Minimal change, isolated to opencode adapter, no core changes
- **Cons**: String-level dedup is fragile; doesn't fix the root cause
- **Effort**: Low

### Option C: Fix at source — remove `adaptive-memory` from `PACKAGE_BUILDERS` in `instruction-bundles/index.ts`, make it provider-only

- **Pros**: Root cause fix, no double injection anywhere
- **Cons**: adapter-pi's `composeAdaptiveMemory` also injects; needs coordination
- **Effort**: Medium

### Option D (RECOMMENDED): Change `adaptive-memory.ts` bundle to NOT start with `## Adaptive Memory` heading — use sub-headings only; keep `## Adaptive Memory (provider-injected)` as the sole top-level heading from `buildProviderAdaptiveMemorySection`; also fix backtick refs

- **Pros**: Single top-level heading, clean hierarchy, backtick fix improves tool calling
- **Cons**: Requires updating tests that check heading structure
- **Effort**: Low-Medium

## Minimal Fix (Recommended)

### Fix 1: Backtick tool refs

**File**: `packages/core/src/teams/developer/instruction-bundles/adaptive-memory.ts`
**Lines**: 95-97, 196-198, 311-313 (all 3 fragments)
**Change**: Replace `- **memory**` with `` - `memory` `` and `- **recall**` with `` - `recall` ``

Before:
```
- **memory** (action: "save", content: "...") — commit a memory
- **memory** (action: "forget", content: "...") — remove a memory
- **recall** (query: "...", includeProfile?: boolean) — retrieve relevant memories
```

After:
```
- `memory` (action: "save", content: "...") — commit a memory
- `memory` (action: "forget", content: "...") — remove a memory
- `recall` (query: "...", includeProfile?: boolean) — retrieve relevant memories
```

### Fix 2: Remove `## Adaptive Memory` heading from bundle fragments

**File**: `packages/core/src/teams/developer/instruction-bundles/adaptive-memory.ts`
**Lines**: 22, 170, 265 (all 3 fragment markdown strings)
**Change**: Remove `## Adaptive Memory\n\n` from the start of each fragment's markdown. Keep the content but start with the first sub-heading (e.g., `### Automatic Scoping`).

The top-level heading will come exclusively from:
- `ADAPTIVE_MEMORY_SECTION_HEADING` (`## Adaptive Memory (provider-injected)`) via `buildProviderAdaptiveMemorySection` for prompts
- `composeAdaptiveMemory` via `ADAPTIVE_MEMORY_SECTION_HEADING` for adapter-pi

### Fix 3: Remove static `## Adaptive Memory` from `ORCHESTRATOR_SKILL_BODY`

**File**: `packages/core/src/teams/developer/orchestrator-content.ts`
**Lines**: 913-915
**Change**: Remove the static placeholder text `## Adaptive Memory\n\nAdaptive memory instructions are injected dynamically...`. The real content comes from bundles.

## Tests to Update

1. `packages/core/src/teams/developer/instruction-bundles/adaptive-memory.test.ts` — verify backtick refs, verify no `## Adaptive Memory` heading in fragment markdown
2. `packages/core/src/teams/developer/instruction-bundles/bundle-parity.test.ts` — if it checks heading structure
3. `packages/adapter-opencode/src/prompt-memory-injection.test.ts` — verify single `## Adaptive Memory` heading in orchestrator prompt
4. `packages/core/src/teams/developer/orchestrator-content.test.ts` — if it checks skill body for `## Adaptive Memory`
5. `packages/core/src/teams/developer/content-registry.test.ts` — verify composition doesn't produce duplicate headings

## Confidence

**High** (90%) — all sources traced to exact files/lines, composition flow fully mapped, root cause identified.

## Blockers

- None. All changes are in controlled source files with existing test coverage.
