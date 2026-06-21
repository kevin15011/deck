# Exploration: OpenCode effort levels hardcoded instead of model-specific

## Goal

Diagnose why the Deck TUI shows the same fixed 3-4 effort levels for every OpenCode model, even though models expose model-specific reasoning effort levels in OpenCode's cache.

## User Report

> "El nivel de razonamiento no es el que disponibilizan los modelos, es como si estuvieran quemados los 3 niveles que se muestran siempre, pero, se que varios modelos tienen diferentes niveles de razonamiento o esfuerzo y no se están listando lo que realmente tienen los modelos."

Translation: reasoning levels shown are not the ones the models actually expose; they look like the same hardcoded 3 levels always, but several models have different reasoning/effort levels that are not being listed.

## Current State

The OpenCode effort-level pipeline has three layers, all of which independently ignore per-model variant data and fall back to the same hardcoded constant `OPENCODE_THINKING_LEVELS = ["off", "low", "medium", "high"]` (defined in `packages/adapter-opencode/src/model-config.ts:37`).

### Layer 1 — Real OpenCode cache schema mismatch (`model-inventory.ts`)

`~/.cache/opencode/models.json` (2.3 MB, 5288 models across 144 providers) does NOT use a `variants` field. It uses `reasoning_options`:

```json
// alibaba-token-plan / glm-5.2 (the user's configured model)
{
  "id": "glm-5.2",
  "reasoning": true,
  "reasoning_options": [
    { "type": "effort", "values": ["high", "max"] }
  ]
}

// openai / gpt-5.3-codex-spark
{
  "id": "gpt-5.3-codex-spark",
  "reasoning_options": [
    { "type": "effort", "values": ["none", "low", "medium", "high", "xhigh"] }
  ]
}

// anthropic / claude-sonnet-4-5
{
  "reasoning_options": [ { "type": "budget_tokens", "min": 1024 } ]
}
```

`packages/adapter-opencode/src/model-inventory.ts:551-552` only reads `data.variants`:

```ts
const rawVariants = data.variants;
const validatedVariants = validateAndDedupVariants(rawVariants);
```

Result: 0 of 5288 models expose a `variants` field. Every `RunnerModelEntry.variants` is `[]`. The real cache has 656 models with `reasoning_options[].type === "effort"` carrying a `values` array, and 137 with `type === "budget_tokens"`. None of this data is ever read.

### Layer 2 — Deck variant cache plugin reads the wrong field (`assets/opencode/plugins/model-variants.ts`)

The plugin `discoverVariants()` reads `model.variants` (array or object) or the legacy `model.thinking_levels`. Neither exists in the real cache. Additionally, the plugin is NOT installed in the user's OpenCode config (`~/.config/opencode/opencode.json` `plugin: ["./plugins/cyberpunk"]` only), and the Deck variant cache `~/.cache/deck/opencode/model-variants.json` does not exist.

Even if the plugin were installed, it would write an empty `providers: {}` because no model has a `variants` field.

### Layer 3 — Adapter `getThinkingLevels(modelId)` ignores `modelId` (`runner-adapter.ts:539-548`)

```ts
getThinkingLevels(_modelId?: string): readonly RunnerThinkingLevel[] {
  const mapping: Record<OpenCodeThinkingLevel, ...> = { off: "off", low: "low", medium: "medium", high: "high" };
  return OPENCODE_THINKING_LEVELS.map((l) => mapping[l]);
}
```

The `_modelId` parameter is unused (underscore-prefixed). It never calls `variantsFor()` from `model-variants.ts`, never reads `getModelInventory().modelsByProvider[...].variants`, and never reads `reasoning_options`. It always returns the 4 hardcoded levels.

### Layer 4 — TUI screens use the constant directly (`developer-team-screens.tsx:257` and `app.tsx`)

`AgentModelAssignmentScreen` line 257:

```tsx
const thinkingLevels = runtime === "opencode" ? OPENCODE_THINKING_LEVELS : PI_THINKING_LEVELS;
```

The screen imports and uses the hardcoded constant directly — it does NOT receive or call `adapter.getThinkingLevels(modelId)`. `app.tsx` repeats this pattern at lines 1455, 1879, 1894, and 2361. The adapter's `getThinkingLevels()` is never called from the TUI at all.

### Net effect

For the user's model `alibaba-token-plan/glm-5.2` (which exposes `["high", "max"]`), the TUI shows `["off", "low", "medium", "high"]` — levels the model does not even support. The "max" level is invisible, and "off"/"low"/"medium" are offered but are not valid for this model.

## Relevant Files

- `packages/adapter-opencode/src/runner-adapter.ts` (lines 539-548) — `getThinkingLevels(_modelId)` ignores `modelId`, returns hardcoded constant. **Primary fix site.**
- `packages/adapter-opencode/src/model-inventory.ts` (lines 49-59 type, 521-563 parse, 551-552 variants read) — reads `data.variants` instead of `data.reasoning_options`. **Primary fix site.**
- `packages/adapter-opencode/src/model-config.ts` (line 37) — `OPENCODE_THINKING_LEVELS` hardcoded constant.
- `packages/adapter-opencode/src/model-variants.ts` — Deck variant cache loader (`variantsFor()`); never called by the adapter. Currently dead code in the effort-level flow.
- `packages/adapter-opencode/assets/opencode/plugins/model-variants.ts` — plugin reads `model.variants` / `model.thinking_levels`; both fields absent from real cache. Not installed in user config.
- `apps/cli/src/tui/screens/developer-team-screens.tsx` (line 257) — `AgentModelAssignmentScreen` uses hardcoded constant, not adapter. **Primary fix site.**
- `apps/cli/src/tui/app.tsx` (lines 1455, 1879, 1894, 2361) — four sites using hardcoded `OPENCODE_THINKING_LEVELS` instead of adapter. **Primary fix site.**
- `packages/core/src/runner-adapter.ts` (lines 144-152) — `RunnerModelEntry` type already has `variants?: readonly string[]`; schema-compatible but unused.
- `packages/adapter-opencode/src/runner-adapter.inventory.test.ts` — existing tests only assert "array is returned", never assert model-specific levels.
- `apps/cli/src/tui/__tests__/developer-team-screens-effort.test.tsx` — uses MOCK adapters that return model-specific variants; never tests that the REAL `AgentModelAssignmentScreen` calls `adapter.getThinkingLevels(modelId)`. Test gap.

## Constraints

- The real cache field is `reasoning_options: Array<{ type: "effort" | "budget_tokens"; values?: string[]; min?: number }>`. Two distinct effort models exist: discrete levels (`effort` + `values`) and token-budget (`budget_tokens` + `min`). The TUI effort picker only supports discrete levels today.
- `OPENCODE_THINKING_LEVELS` is also consumed by `resolveThinkingForOpenCodeModel()` and `parseOpenCodeThinkingLevel()` in `model-config.ts`, and by config-write paths in `developer-team-install.ts`. Any change to the level set must remain compatible with the `opencode.json` `reasoningEffort` field and `variant` field semantics.
- The OpenCode config already uses a per-agent `"variant": ""` field (seen in the user's `opencode.json`), which is OpenCode's native mechanism for selecting a model variant. Deck's effort levels should map to this field.
- Model IDs in the cache are unprefixed (`glm-5.2`, `gpt-5.3-codex-spark`); `model-inventory.ts` constructs canonical IDs as `providerId/modelId` (`alibaba-token-plan/glm-5.2`). Any variant lookup must use a consistent key form.
- Pi runtime uses a fixed 6-level set and must not regress.
- The prior archived change `model-reasoning-effort-capability` addressed **whether** a model supports reasoning (capability), not **which levels** it offers. That change's scope explicitly did not cover per-model variant sets.

## Risks

- **Schema stability**: switching from `variants` to `reasoning_options` changes what `RunnerModelEntry.variants` carries. Downstream consumers (TUI, config writer) must agree on the shape.
- **Budget-tokens models**: 137 models use `type: "budget_tokens"` (e.g., Anthropic Claude). These don't have discrete effort levels. The TUI picker cannot represent them as a menu today; a fallback is needed (hide picker, or map to a single "auto" option).
- **Models with `reasoning: true` but no `reasoning_options`**: 1299 models. These need a safe default level set.
- **Test false-confidence**: the existing effort test uses mocks that prove the *contract* but not the *wiring*. Adding a wiring test (real adapter + real cache fixture + real screen) is essential.
- **Config-write compatibility**: `opencode.json` `reasoningEffort` accepts `"low"|"medium"|"high"`. If a model only offers `["high","max"]`, writing `"low"` would be invalid for that model. The config writer must validate against the model's actual levels.
- **Variant cache plugin**: even if fixed to read `reasoning_options`, the plugin is not installed. The adapter should read `reasoning_options` directly from `loadModelInventory()` (which already reads the cache) rather than depending on the separate Deck variant cache file.

## Options and Tradeoffs

### Option A — Read `reasoning_options` directly in `model-inventory.ts`; thread through adapter and TUI (RECOMMENDED)

Populate `RunnerModelEntry.variants` from `reasoning_options[].values` (for `type: "effort"`) in `parseModelEntry()`. Make `getThinkingLevels(modelId)` look up the model in inventory and return its `variants`; fall back to `OPENCODE_THINKING_LEVELS` only when unavailable. Make `AgentModelAssignmentScreen` and `app.tsx` call `adapter.getThinkingLevels(selectedModel.id)` instead of using the constant.

- Pros: Single source of truth (real cache). No dependency on the plugin or Deck variant cache file. Minimal new surface area. The `RunnerModelEntry.variants` field already exists.
- Cons: Requires touching 4 files (inventory, adapter, screen, app). Need to handle `budget_tokens` and no-options cases. The TUI cursor/index logic in `app.tsx` assumes a fixed-length array and must be made model-aware.
- Effort: Medium.

### Option B — Fix the plugin to read `reasoning_options`; keep the Deck variant cache as the source

Update `assets/opencode/plugins/model-variants.ts` to read `reasoning_options` and write to `~/.cache/deck/opencode/model-variants.json`. Make `getThinkingLevels(modelId)` call `variantsFor(providerId, modelId)`. Install the plugin in OpenCode config.

- Pros: Keeps the two-cache separation. `model-variants.ts` already validates the cache.
- Cons: Requires the plugin to be installed and run (it is not). Adds a runtime dependency on plugin activation. Two caches can drift. More moving parts. Does not fix the model ID prefix mismatch without extra work.
- Effort: Medium-High.

### Option C — Minimal: only fix `getThinkingLevels()` to read inventory; leave TUI using constant

Make `getThinkingLevels(modelId)` read inventory variants, but leave the TUI screens using `OPENCODE_THINKING_LEVELS`.

- Pros: Smallest code change.
- Cons: Does NOT fix the user's problem. The TUI still shows hardcoded levels. Defeats the purpose.
- Effort: Low (but ineffective).

## Recommendation

**Option A.** Read `reasoning_options[].values` directly in `model-inventory.ts` `parseModelEntry()`, populate `RunnerModelEntry.variants`, make `getThinkingLevels(modelId)` return those variants (with the existing hardcoded set as fallback only when inventory is unavailable), and rewire `AgentModelAssignmentScreen` + `app.tsx` to call `adapter.getThinkingLevels(selectedModel.id)`. Handle `budget_tokens` models by hiding the picker (already supported via `supportsThinking` prop). This is the smallest change that actually fixes the user's report, uses the real cache as the single source of truth, and avoids the plugin/second-cache complexity.

## Actionable Diagnosis

**Yes.** Three independent root causes confirmed by reading real code and the real cache:

1. `model-inventory.ts` reads `data.variants` but the real cache uses `data.reasoning_options[].values` — 0/5288 models match.
2. `runner-adapter.ts getThinkingLevels(_modelId)` ignores `modelId` and returns the hardcoded constant.
3. `developer-team-screens.tsx` and `app.tsx` use `OPENCODE_THINKING_LEVELS` directly instead of `adapter.getThinkingLevels(modelId)`.

## Suggested Lifecycle Outcome

**propose** — clear root cause, clear fix, user-impacting bug. Should proceed to proposal/spec/design/tasks.

## Open Questions

- Should `budget_tokens` models (137 in cache, e.g., Anthropic Claude) hide the effort picker entirely, or surface a single "auto/budget" option? Current `supportsThinking` prop can hide the picker, but the catalog `supportsReasoning` for these models is `true`, so the picker would show unless explicitly suppressed.
- Should the Deck variant cache (`model-variants.ts` / plugin) be removed entirely as dead code, or kept for future use? It is currently never read by the effort-level flow.
- Should the model ID passed to `getThinkingLevels()` be the canonical form (`alibaba-token-plan/glm-5.2`) or the raw cache form (`glm-5.2`)? The inventory uses canonical; the variant cache plugin uses raw. Option A uses canonical (inventory), which is consistent.
- The user's `opencode.json` already has a per-agent `"variant": ""` field (empty). Should Deck populate this field with the selected effort level, or continue using `reasoningEffort`?

## Ready for Proposal

**Yes.** The root cause is fully diagnosed with concrete evidence from the real cache and source code. The orchestrator should communicate to the user (in Spanish) that the issue is confirmed: the TUI shows hardcoded levels because three layers (cache parser, adapter, TUI) all ignore the real `reasoning_options` field, and a fix will read the actual per-model levels from the cache.
