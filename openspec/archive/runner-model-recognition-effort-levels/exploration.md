# Exploration: Runner model recognition and per-model effort levels

## Goal

Investigate why OpenCode does not recognize all provider models (e.g., OpenAI) and why reasoning/effort levels appear globally hardcoded to the same three values instead of being model/provider-specific.

> User request (quoted): "Hay algo que quiero corregir y es el reconocimiento de los modelos de los proveedores de los runner, especificamente opencode no está reconociendo todos los modelos de los proveedores como por ejemplo OpenAI y tampoco los niveles de esfuerzos de dichos modelos, es como si tuviera quemados los mismo 3 niveles de esfuerzo"

## Current State

### Model catalog is narrow and static
`packages/core/src/model-catalog.ts` is the canonical source of model metadata. It currently registers only four OpenAI models:

- `openai/gpt-4o`
- `openai/gpt-4o-mini`
- `openai/gpt-4-turbo`
- `openai/gpt-5.5`

Other providers are similarly limited (one or two models each). There is no mechanism to ingest models advertised by the runner (`opencode models`, `pi --list-models`) and enrich them with catalog capabilities; the catalog is a hardcoded whitelist.

### Reasoning support defaults to false for unknown models
`packages/core/src/model-reasoning-capability.ts` resolves reasoning support with precedence:

1. Runner signal (`runnerSupportsReasoning`)
2. Catalog (`supportsReasoning` or `capabilities.includes("reasoning")`)
3. Unknown → `false`

Because the catalog omits many real-world models, any model returned by `opencode models` that is not in the catalog is treated as **not supporting reasoning**, even when the provider/model actually does.

### OpenCode TUI has no fallback model list
`apps/cli/src/tui/app.tsx` detects OpenCode models by running `opencode models` and parsing the output in `parseOpenCodeModelsOutput()`. If the command fails or returns nothing, the TUI shows an empty provider/model list (line 2361). Pi, by contrast, builds `DEFAULT_MODELS_BY_PROVIDER` from the core catalog as a fallback (`packages/adapter-pi/src/model-config.ts`).

### Effort levels are hardcoded per runtime, not per model
`packages/adapter-opencode/src/model-config.ts` defines:

```typescript
export const OPENCODE_THINKING_LEVELS: readonly OpenCodeThinkingLevel[] = ["off", "low", "medium", "high"];
```

`AgentEntry.reasoningEffort` and `OpenCodeModelConfig.reasoningEffort` are typed as `"low" | "medium" | "high"` only (`packages/adapter-opencode/src/types.ts`). The TUI imports these arrays directly and selects from them without consulting the model:

- `apps/cli/src/tui/app.tsx` lines 1307, 1731, 1746, 2213
- `apps/cli/src/tui/screens/developer-team-screens.tsx` line 257

The `RunnerAdapter` interface already exposes `getThinkingLevels(modelId?: string)` (`packages/core/src/runner-adapter.ts` line 415), but OpenCode's implementation ignores `modelId` and the TUI never calls it.

### Contrast with Pi
Pi uses six levels (`off`, `minimal`, `low`, `medium`, `high`, `xhigh`) and has a model inventory parser. The canonical `ReasoningLevel` type in core already covers the full superset (`packages/core/src/model-catalog.ts` line 28). OpenCode is artificially restricted to a subset.

## Relevant Prior Change Context

The previous change `model-reasoning-effort-capability` (archived) implemented:

- Hybrid reasoning resolver (`runner signal > catalog > unknown=false`)
- Filtering of `reasoningEffort` for unsupported models
- TUI hiding of reasoning selector/hint when a model does not support reasoning

It explicitly did **not**:
- Expand the model catalog
- Make effort levels model/provider-specific
- Add a fallback model list for OpenCode

Archive follow-ups were minor naming/typecheck items; none address catalog breadth or effort-level granularity.

## Code Touchpoints

| File | Role |
|---|---|
| `packages/core/src/model-catalog.ts` | Canonical catalog; defines `ReasoningLevel`, `ModelEntry`, provider/model lists |
| `packages/core/src/model-reasoning-capability.ts` | Resolver that falls back to catalog and defaults unknown models to `false` |
| `packages/adapter-opencode/src/model-config.ts` | Hardcoded `OPENCODE_THINKING_LEVELS`, `OpenCodeModelConfig.reasoningEffort` type |
| `packages/adapter-opencode/src/types.ts` | `AgentEntry.reasoningEffort` hardcoded to `"low" \| "medium" \| "high"` |
| `packages/adapter-opencode/src/runner-adapter.ts` | `getThinkingLevels()` ignores `modelId`; maps to canonical levels |
| `packages/adapter-opencode/src/developer-team-install.ts` | Consumes `resolveModelConfig` with hardcoded effort type |
| `apps/cli/src/tui/app.tsx` | Hardcodes `OPENCODE_THINKING_LEVELS` / `PI_THINKING_LEVELS`; parses `opencode models`; no fallback |
| `apps/cli/src/tui/screens/developer-team-screens.tsx` | Renders hardcoded thinking level lists |
| `packages/adapter-pi/src/model-config.ts` | Reference implementation: `DEFAULT_MODELS_BY_PROVIDER`, `pi --list-models` parsing, six levels |

## Root-Cause Hypotheses

1. **Catalog breadth**: The canonical catalog was seeded with a small subset of models and is not periodically expanded or dynamically enriched from runner output. OpenAI's newer reasoning models (e.g., `o1`, `o3-mini`, `gpt-4.5` series) and other provider models are missing.
2. **Unknown-model default**: The resolver's safe default (`unknown → false`) is correct for safety but becomes overly restrictive when the catalog is incomplete.
3. **Effort-level globalization**: `OPENCODE_THINKING_LEVELS` and the `reasoningEffort` type were defined once for the whole runner instead of per model/provider, so every reasoning-capable model exposes the same three levels.
4. **TUI bypasses adapter abstraction**: The TUI imports runtime-specific level arrays directly rather than using `adapter.getThinkingLevels(modelId)`, preventing model-specific behavior.
5. **Missing OpenCode fallback**: Unlike Pi, OpenCode model detection has no fallback to the catalog, so TUI model selection relies entirely on `opencode models` succeeding.

## Recommended Scope

A new SDD change to make model recognition and effort levels provider/model-aware:

1. **Expand canonical catalog** with additional provider models, especially OpenAI reasoning models and any other providers with known gaps. Add a `supportedReasoningLevels?: readonly ReasoningLevel[]` field to `ModelEntry` (optional, fallback to runner defaults).
2. **Enrich runner-detected models** with catalog metadata so models returned by `opencode models` / `pi --list-models` that exist in the catalog inherit capabilities and reasoning levels.
3. **Add OpenCode default model fallback** similar to Pi's `DEFAULT_MODELS_BY_PROVIDER` so the TUI can show catalog models when `opencode models` is unavailable.
4. **Model-specific effort levels in OpenCode adapter**: Update `getThinkingLevels(modelId)` to consult the catalog and return model-specific levels; widen `AgentEntry.reasoningEffort` / `OpenCodeModelConfig.reasoningEffort` types to accept the full canonical range where the model supports it.
5. **TUI uses adapter abstraction**: Replace direct imports of `OPENCODE_THINKING_LEVELS` / `PI_THINKING_LEVELS` in `app.tsx` and `developer-team-screens.tsx` with `adapter.getThinkingLevels(selectedModelId)`.

## Risks

- **Catalog maintenance burden**: Expanding the catalog creates ongoing maintenance as providers release models.
- **Type widening**: Changing `reasoningEffort` from `"low" | "medium" | "high"` to a broader union may affect existing configs/tests that assumed the narrower type.
- **OpenCode schema mismatch**: If OpenCode's actual `reasoningEffort` schema is narrower than the canonical `ReasoningLevel`, mapping must occur at the adapter boundary.
- **Pi regression**: Pi already has six levels and its own anti-regression rules for `opencode-go` / `kimi-k2.6`; changes must not disturb them.
- **Unknown-model safety**: Moving from "unknown = false" to "unknown = maybe" for reasoning support could allow invalid `reasoningEffort` values to be written for non-reasoning models.

## Options and Tradeoffs

### Option A: Expand catalog + add per-model reasoning levels
- **What**: Add missing models to `model-catalog.ts`, add `supportedReasoningLevels` to `ModelEntry`, update adapters and TUI to use model-specific levels.
- **Pros**: Single source of truth, model-specific UX, resolves both recognition and effort-level complaints.
- **Cons**: Larger initial change, ongoing catalog maintenance, requires mapping canonical levels to runner-native values.
- **Effort**: Medium-High

### Option B: Minimal catalog expansion + keep global levels
- **What**: Add the most requested missing models (OpenAI o-series, etc.) but keep `OPENCODE_THINKING_LEVELS` global.
- **Pros**: Smaller change, addresses the immediate "models not recognized" symptom.
- **Cons**: Does not fix the hardcoded effort-level complaint; technical debt remains.
- **Effort**: Low-Medium

### Option C: Dynamic runner-driven model inventory for OpenCode
- **What**: Implement OpenCode equivalent of Pi's `detectConfiguredProviders` / `listModelsForProvider` / `buildModelInventoryFromPiListModels`, using `opencode models` and env-var detection, with catalog enrichment.
- **Pros**: Future-proof, runner is source of truth for available models.
- **Cons**: More complex, depends on `opencode models` output stability, may need parsing logic.
- **Effort**: High

## Recommendation

**Option A as primary scope, with Option C elements limited to OpenCode fallback enrichment.**

The user's complaint has two linked symptoms:
- Models not recognized (catalog too narrow + no fallback)
- Effort levels hardcoded (global array instead of model-specific)

Fixing only one leaves the other. Expanding the catalog and adding per-model reasoning levels addresses both. A targeted OpenCode fallback list (reusing the catalog) can be added without full dynamic inventory parsing.

## Actionable Diagnosis

Yes. The root causes are identifiable and localized:
1. Narrow canonical catalog in `packages/core/src/model-catalog.ts`
2. Hardcoded `OPENCODE_THINKING_LEVELS` and `reasoningEffort` types in the OpenCode adapter
3. TUI bypassing the adapter's `getThinkingLevels(modelId)` abstraction

## Suggested Lifecycle Outcome

propose — the issue is well-scoped, files are mapped, and a recommended direction exists.

## Open Questions

1. Which exact OpenAI and other provider models must be added to the catalog? Should we include preview/alias models (e.g., `openai/gpt-4.5-preview`, `openai/o1`, `openai/o3-mini`)?
2. What is OpenCode's actual accepted range for `reasoningEffort`? Does it accept `minimal`/`xhigh` for any providers, or is it always normalized to `low`/`medium`/`high`?
3. Should unknown models detected from `opencode models` default to "no reasoning" or to a runner-provided capability signal?
4. Should the catalog include `supportedReasoningLevels` per model, or should effort-level ranges be derived from provider conventions?
5. Are there existing user configs with `reasoningEffort: "minimal"` or `"xhigh"` for OpenCode that would break if we widen the type?

## Ready for Proposal

Yes. The Explorer phase has identified concrete files, root causes, and a recommended scope. The Proposal agent should:
- Confirm the exact list of provider models to add
- Decide on the canonical `supportedReasoningLevels` schema
- Specify how OpenCode maps canonical levels to its native `reasoningEffort` values
- Define TUI changes to use `adapter.getThinkingLevels(modelId)`

## External Reference: gentle-ai

> Investigated read-only: `/home/kevinlb/gentle-ai` (Go project, sibling repo). gentle-ai is an ecosystem configurator that supercharges 13 AI coding agents (including OpenCode) with SDD workflows, per-phase model assignment, and model-specific effort levels. It solves the exact same problem Deck is tackling — but from the outside, as a consumer of OpenCode's data.

### gentle-ai Repository Summary

gentle-ai does **not** maintain its own model catalog. Instead, it reads OpenCode's own model data dynamically and enriches it with per-model effort levels via an OpenCode plugin. This is a fundamentally different architecture from Deck's hardcoded canonical catalog.

### Model Discovery Flow

gentle-ai's model discovery is a **four-layer pipeline**:

1. **Cache Load** — Reads `~/.cache/opencode/models.json` (written by OpenCode at startup). Contains all providers with their models, each having `id`, `name`, `family`, `tool_call`, `reasoning`, `cost`, `limit` fields.
   - Function: `opencode.LoadModels(cachePath)` → `map[string]Provider`

2. **Custom Provider Merge** — Reads user-defined providers from `opencode.json` (`provider` key) and merges them into the cache. Cache models win on ID collision; custom-only providers are added fresh.
   - Functions: `opencode.LoadConfigProviders(path)`, `opencode.MergeCustomProviders(cache, config)`

3. **Provider Availability Detection** — Filters to providers the user can actually use, checking (in order): custom provider IDs (always available), OAuth credentials (`~/.local/share/opencode/auth.json`), built-in `"opencode"` provider, and environment variables (`provider.Env`). Only providers with at least one `tool_call`-capable model pass.
   - Function: `opencode.DetectAvailableProviders(providers, customIDs...)`

4. **Variant Enrichment** — Merges per-model effort levels from a plugin-generated cache at `~/.gentle-ai/cache/model-variants.json`. This file is written by the `model-variants.ts` OpenCode plugin, which runs at OpenCode startup, calls `input.client.provider.list()`, extracts `Object.keys(model.variants)` for each model, and writes them as `Record<providerId, Record<modelId, string[]>>`.
   - Functions: `opencode.EnrichWithVariants(providers, variantsPath)`, `Model.EffortLevels() []string`

### Adapter/Runner Interfaces

gentle-ai treats OpenCode as a **data source**, not an adapter. The key interfaces:

| Layer | Interface | Data |
|-------|-----------|------|
| Model cache | `~/.cache/opencode/models.json` | All providers + models with metadata |
| Settings | `~/.config/opencode/opencode.json` | Custom providers + agent definitions with `model` and `variant` fields |
| Auth | `~/.local/share/opencode/auth.json` | Authenticated provider IDs |
| Plugin cache | `~/.gentle-ai/cache/model-variants.json` | Per-model variant/effort keys |
| Plugin SDK | `input.client.provider.list()` | Live provider data from within OpenCode |

The `ModelAssignment` struct (`model/model_assignment.go`) is simple:
```go
type ModelAssignment struct {
    ProviderID string // e.g., "anthropic"
    ModelID    string // e.g., "claude-sonnet-4-20250514"
    Effort     string // "" = provider default; "low" | "medium" | "high" (dynamic from variants)
}
```

### Effort/Thinking-Level Handling

**This is the critical finding.** gentle-ai does NOT hardcode effort levels. Instead:

1. The `model-variants.ts` OpenCode plugin runs at startup and extracts the actual variant keys each model supports (e.g., `["low", "medium", "high"]` for one model, `["minimal", "low", "medium", "high", "xhigh"]` for another).
2. These are cached to `~/.gentle-ai/cache/model-variants.json`.
3. `EnrichWithVariants()` merges them into the `Model.Variants` field.
4. `Model.EffortLevels()` returns `nil` when no variants exist (effort picker is skipped).
5. The TUI model picker (`tui/screens/model_picker.go`) shows a **per-model effort submenu** (ModeEffortSelect) only when the selected model has variants.
6. Effort is persisted as `variant` in `opencode.json` agent definitions (not `reasoningEffort`).
7. On load, `sanitizeKnownModelEfforts()` validates existing effort values against known variants and clears stale ones.

The effort type is **`string`** — not a closed union. This allows it to accommodate any provider's variant keys without code changes.

### Relevant Files/Functions in gentle-ai

| File | Role |
|------|------|
| `internal/opencode/models.go` | Core model discovery: `LoadModels`, `DetectAvailableProviders`, `FilterModelsForSDD`, `EnrichWithVariants`, `MergeCustomProviders`, `Model.EffortLevels()` |
| `internal/opencode/models_test.go` | Test fixtures showing the cache JSON format (providers with models, tool_call, reasoning flags) |
| `internal/assets/opencode/plugins/model-variants.ts` | OpenCode plugin that extracts per-model variant keys at runtime and writes them to a JSON cache |
| `internal/model/model_assignment.go` | `ModelAssignment` struct with `ProviderID`, `ModelID`, `Effort string` |
| `internal/model/types.go` | `Profile` struct: per-profile orchestrator model + phase assignments |
| `internal/model/selection.go` | `Selection` struct with `ModelAssignments map[string]ModelAssignment` |
| `internal/model/claude_model.go` | Claude-specific alias system (opus/sonnet/haiku) with preset tables (balanced/performance/economy) |
| `internal/tui/screens/model_picker.go` | Full model picker with 4 modes: PhaseList → ProviderSelect → ModelSelect → EffortSelect |
| `internal/tui/model.go` | `sanitizeKnownModelEfforts()` — validates effort against known variants on load |
| `internal/components/sdd/read_assignments.go` | `ReadCurrentModelAssignments()` — reads `model` + `variant` from opencode.json agents |
| `internal/components/sdd/inject.go` | `injectModelAssignments()` — writes `model` + `variant` to opencode.json agent definitions |

### Comparison to Deck

| Aspect | Deck (current) | gentle-ai |
|--------|---------------|-----------|
| **Model source** | Hardcoded catalog in `model-catalog.ts` (4 OpenAI models) | Dynamic: reads `~/.cache/opencode/models.json` (all models OpenCode knows about) |
| **Model discovery** | Static whitelist, no runtime enrichment | 4-layer pipeline: cache → custom merge → availability detection → variant enrichment |
| **Effort levels** | Hardcoded `["off", "low", "medium", "high"]` globally | Per-model: extracted from `model.variants` by an OpenCode plugin at runtime |
| **Effort type** | `"low" \| "medium" \| "high"` (closed union) | `string` (open, dynamic from variant keys) |
| **Effort field name** | `reasoningEffort` | `variant` (in opencode.json) |
| **Provider detection** | Catalog-based | OAuth + env vars + custom providers + built-in |
| **Per-model effort** | No — same 3 levels for all models | Yes — each model reports its own variant keys |
| **Fallback** | None for OpenCode TUI | Cache file + custom provider merge |
| **Stale effort handling** | N/A (hardcoded) | `sanitizeKnownModelEfforts()` clears stale values on load |
| **Plugin architecture** | None | OpenCode plugin extracts variants at startup, writes JSON cache |

### Recommendations for Proposal

1. **Adopt gentle-ai's variant-enrichment pattern for Deck.** Instead of expanding the hardcoded catalog with `supportedReasoningLevels`, Deck should read OpenCode's model cache (`~/.cache/opencode/models.json`) and enrich models with variant data. This is the same data source gentle-ai uses, and it is always up-to-date because OpenCode writes it at startup.

2. **Use the `model-variants.ts` plugin pattern.** The OpenCode plugin that extracts `Object.keys(model.variants)` per model is the key innovation. Deck could either (a) reuse gentle-ai's plugin output (`~/.gentle-ai/cache/model-variants.json`), (b) implement its own similar plugin, or (c) read the variant data directly from `input.client.provider.list()` within the adapter layer.

3. **Widen `reasoningEffort` to `string` (or a broader union).** gentle-ai uses `string` for effort, which allows it to accommodate any provider's variant keys without code changes. Deck's closed union `"low" | "medium" | "high"` is the root cause of the hardcoded effort complaint. At minimum, it should accept the full canonical `ReasoningLevel` range; ideally, it should be `string` with validation at the adapter boundary.

4. **Implement per-model effort in `getThinkingLevels(modelId)`.** The `RunnerAdapter` interface already has `getThinkingLevels(modelId?: string)`, but OpenCode's implementation ignores `modelId`. Deck should make it consult the variant cache (or catalog fallback) to return model-specific levels, exactly like gentle-ai's `Model.EffortLevels()`.

5. **Add stale-effort sanitization.** gentle-ai's `sanitizeKnownModelEfforts()` is a defensive pattern that clears effort values when a model no longer reports those variants. Deck should implement similar sanitization when loading persisted configs, especially if the type is widened.

6. **The `variant` field name matters.** OpenCode uses `variant` (not `reasoningEffort`) in its `opencode.json` agent definitions. gentle-ai reads/writes this field. Deck's adapter must map between its internal `reasoningEffort` terminology and OpenCode's `variant` field. This mapping already exists at the adapter boundary but should be verified.

### Open Questions from gentle-ai Investigation

1. Does Deck want to depend on gentle-ai's plugin cache (`~/.gentle-ai/cache/model-variants.json`) or implement its own variant extraction? The former creates a cross-project dependency; the latter requires an OpenCode plugin.
2. Can Deck read `~/.cache/opencode/models.json` directly, or does it need to go through `opencode models` CLI output? The cache file is the richer data source (includes `tool_call`, `reasoning`, `cost`, `limit`).
3. Should the `variant` field in opencode.json be the canonical effort field name for Deck as well, or should Deck maintain its own `reasoningEffort` terminology internally and only map to `variant` at the adapter boundary?

## Registry

- **Artifact Path**: `openspec/changes/runner-model-recognition-effort-levels/exploration.md`
- **State Path**: `openspec/changes/runner-model-recognition-effort-levels/state.yaml`
- **Events Path**: `openspec/changes/runner-model-recognition-effort-levels/events.yaml`
