# Proposal: Runner Model Recognition and Model-Aware Effort Levels

**Change ID**: `runner-model-recognition-effort-levels`

## Problem / Motivation

OpenCode-backed Deck flows do not recognize all models exposed by providers such as OpenAI, and effort/reasoning choices appear fixed to the same small set of values. Exploration found two connected causes:

- Deck currently relies on a narrow hardcoded catalog and treats unknown models conservatively as not supporting reasoning.
- OpenCode effort levels are modeled as globally hardcoded values instead of per-model runner data, and TUI flows bypass the existing `RunnerAdapter.getThinkingLevels(modelId?)` abstraction.

The sibling `gentle-ai` repository demonstrates a more resilient pattern: read OpenCode's runtime/cache model inventory, enrich models with per-model `variant` keys from OpenCode provider data, treat effort as an open validated string, and clear stale persisted effort values when they are no longer valid.

## Goals

- Make runner model and effort discovery adapter-driven, model-aware, and safe for unknown models.
- For OpenCode, prefer runtime/cache-derived model inventory and per-model variant discovery/caching over manually expanding Deck's canonical model catalog.
- Preserve existing internal `reasoningEffort` terminology where useful while mapping OpenCode configuration boundaries to OpenCode's native `variant` field.
- Ensure invalid, stale, or unsupported effort/variant values are not displayed or persisted.
- Keep tests deterministic by using mocks and fixtures instead of live network or provider calls.

## Non-Goals

- Do not manually enumerate every current provider model as the primary solution.
- Do not make unsupported or unknown models assume reasoning/variant support without a trusted runner/cache signal.
- Do not require live network calls in tests.
- Do not replace the entire runner adapter architecture.
- Do not introduce a hard dependency on the sibling `gentle-ai` project unless explicitly chosen in a later phase.

## Proposed Approach

1. **Adapter-driven inventory**
   - Extend or use existing runner adapter contracts so the TUI asks the active adapter for available providers/models and model-specific thinking levels.
   - Stop importing hardcoded OpenCode/Pi level arrays directly in TUI selection flows where adapter data is available.

2. **OpenCode runtime/cache model source**
   - Add OpenCode model inventory loading from OpenCode's local cache, especially `~/.cache/opencode/models.json`, when available.
   - Preserve existing CLI parsing/fallback behavior as a secondary path only when cache data is unavailable or invalid.
   - Merge custom provider data when supported by OpenCode configuration, subject to safe validation.

3. **Per-model variant discovery and caching**
   - Discover per-model OpenCode variants using a deterministic adapter-owned cache or plugin pattern equivalent to gentle-ai's `model-variants.ts` approach.
   - `getThinkingLevels(modelId?)` should consult model-specific variants and return no selectable effort when variants are unknown or unsupported.
   - Treat effort values as open strings validated against discovered variants at the adapter boundary.

4. **Boundary mapping and compatibility**
   - Keep Deck's internal `reasoningEffort` concept if needed for shared runner abstractions.
   - Map OpenCode writes/reads to the native `variant` field in `opencode.json` agent definitions.
   - Maintain backward compatibility for existing configs that already use valid `reasoningEffort`/variant values.

5. **Stale/invalid effort cleanup**
   - When loading persisted agent/model assignments, clear or ignore stale effort values that are not present in the selected model's known variants.
   - Preserve unknown-model safety: unsupported/unknown models must not display or persist reasoning/variant unless confirmed by runner/cache metadata.

## Scope

### In Scope

- OpenCode model inventory discovery from local runtime/cache data.
- Per-model OpenCode variant/effort discovery and cache integration.
- Adapter contract usage from TUI flows for model-aware thinking levels.
- Type and validation changes needed to represent dynamic effort values safely.
- Sanitization/migration behavior for stale or invalid persisted effort values.
- Deterministic tests using fixtures for OpenCode model cache, variant cache, malformed cache, custom providers, and stale efforts.

### Out of Scope

- Full provider network discovery during Deck tests or normal TUI rendering.
- Exhaustively expanding the canonical catalog as a substitute for runtime discovery.
- Changing Pi behavior except where shared adapter/TUI abstractions require compatibility checks.
- Depending on `gentle-ai` files or cache paths as a required runtime dependency.
- Writing specs, detailed technical design, implementation tasks, or production code in this phase.

## Affected Capabilities

### New Capabilities

- `runner-model-inventory-discovery`: Deck can derive runner/provider model inventories from adapter-owned runtime/cache sources rather than only static catalog data.
- `model-aware-effort-discovery`: Deck can expose effort/variant choices per selected model when the runner confirms supported variants.
- `stale-effort-sanitization`: Deck can clear or ignore persisted effort values that are invalid for the selected model.

### Modified Capabilities

- `opencode-runner-configuration`: OpenCode reads/writes must map Deck's internal effort terminology to the native `variant` field and validate values against model variants.
- `developer-team-model-selection`: TUI model and effort selectors should use adapter-provided model inventory and thinking levels instead of hardcoded arrays.
- `model-reasoning-capability`: Reasoning support should remain safe for unknown models while accepting trusted runner/cache signals for known dynamic models.

### Unchanged Capabilities

- `pi-runner-configuration`: Pi may share adapter/TUI abstractions but its existing model list and six-level behavior should not regress.
- `canonical-model-catalog`: The catalog may remain as fallback/enrichment metadata, but it should not be the primary source for OpenCode model coverage.

## Alternatives and Tradeoffs

| Alternative | Why Considered | Why Not Chosen |
|---|---|---|
| Expand Deck's canonical catalog with more OpenAI/provider models | Simple and directly addresses missing model names | Creates ongoing maintenance burden and does not solve dynamic per-model variants |
| Add `supportedReasoningLevels` to static catalog only | Provides model-aware levels without new cache/plugin mechanics | Still stale as providers change; weaker than OpenCode's own provider data |
| Reuse `gentle-ai`'s plugin/cache directly | Fast path and proven reference behavior | Creates cross-project runtime coupling; Deck should own its integration unless explicitly approved |
| Keep global `low | medium | high` levels and only fix model list | Smaller change | Fails the user's core complaint that effort levels are hardcoded globally |
| Dynamic OpenCode cache + adapter-owned variant discovery | Uses runner-owned data, supports new models/variants, keeps tests fixture-driven | More design and validation work; requires robust malformed/stale cache handling |

## Risks and Mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| OpenCode cache format changes | Medium | Encapsulate parsing in OpenCode adapter, validate schema defensively, fall back to existing safe behavior |
| Dynamic effort strings persist invalid values | Medium | Validate against per-model variants before display/write; sanitize stale values on load |
| Unknown models accidentally show reasoning controls | Medium | Keep unknown/unsupported default as no reasoning/variant unless runner/cache confirms support |
| TUI regressions for Pi or existing OpenCode configs | Medium | Route through adapter abstraction with runner-specific fixtures and regression tests |
| Plugin/cache variant discovery adds setup complexity | Medium | Design adapter-owned cache/plugin lifecycle explicitly; allow degraded mode with no effort picker if variants unavailable |
| Confusion between `reasoningEffort` and OpenCode `variant` | Medium | Document boundary mapping and test read/write serialization of OpenCode agent config |

## Dependencies

- OpenCode local model cache format (`~/.cache/opencode/models.json`) and its fields for providers/models.
- A chosen Deck-owned mechanism for obtaining per-model OpenCode variants, likely a plugin/cache pattern analogous to gentle-ai's `model-variants.ts`.
- Existing runner adapter abstractions, especially `RunnerAdapter.getThinkingLevels(modelId?)`.
- Existing OpenCode config read/write paths for agent model settings.

## Rollback Plan

- Revert OpenCode adapter inventory/variant loading to the prior static catalog and CLI parsing behavior.
- Restore previous hardcoded TUI level arrays only if adapter-driven selection causes a release-blocking regression.
- Keep sanitization changes behind adapter validation so rollback can stop writing dynamic variants while preserving existing valid configs.
- Because no product code is changed in this Proposal phase, rollback for this phase is limited to removing or superseding this proposal and registry entries through the normal OpenSpec workflow.

## Success Criteria

- OpenCode model selection can show models available from OpenCode's local model cache, including provider models absent from Deck's static catalog.
- Effort/variant choices are model-specific and absent when a selected model has no confirmed variants.
- Existing valid OpenCode configs continue to load, and stale/invalid effort values are cleared or ignored safely.
- OpenCode writes use the native `variant` field while Deck may retain internal `reasoningEffort` terminology.
- TUI flows obtain thinking levels through adapter APIs with the selected `modelId`.
- Tests use deterministic fixtures/mocks for model cache and variant data, with no live network calls.

## Open Questions

- Should Deck implement its own OpenCode plugin for variants, read variants through another OpenCode-supported mechanism, or use a cache produced by an adapter setup step?
- What exact cache locations should Deck support across platforms, and should paths be configurable?
- How should Deck merge OpenCode custom providers from `opencode.json`, and which validation rules are required before displaying them?
- Should dynamic effort be typed as unrestricted `string`, a branded/validated string, or a broader union plus fallback string at the adapter boundary?
- What UX should appear when model inventory is available but variant cache is stale, missing, or malformed?

## Suggested Next Phase Inputs

### For Spec

- Define requirements for dynamic model inventory discovery, fallback behavior, and safe unknown-model handling.
- Define requirements for per-model effort/variant display and persistence.
- Define stale/invalid effort sanitization behavior and acceptance scenarios.
- Define deterministic fixture-based test expectations and explicitly forbid network-dependent tests.

### For Design

- Decide the OpenCode variant discovery mechanism and cache ownership/lifecycle.
- Design adapter contract changes, if any, for model inventory and model-aware thinking levels.
- Design `reasoningEffort` ↔ `variant` boundary mapping and migration/sanitization flow.
- Identify file-level impacts in OpenCode adapter, core runner adapter/types, TUI screens, and tests.

## Acceptance Direction

- [ ] OpenCode model inventory is sourced from runner/cache data when available and safely falls back when unavailable.
- [ ] `getThinkingLevels(modelId)` returns model-specific variants or no effort choices for unsupported/unknown models.
- [ ] TUI model/effort selectors use adapter-provided data and no longer assume one global OpenCode effort list.
- [ ] Persisted OpenCode agent config uses `variant` at the OpenCode boundary and does not retain invalid/stale effort values.
- [ ] Regression tests cover cache parsing, variant enrichment, stale cleanup, unknown-model safety, and Pi compatibility without network calls.

## Mermaid Summary Source

```mermaid
flowchart LR
  OC[OpenCode runtime/cache\n~/.cache/opencode/models.json] --> INV[OpenCode adapter\nmodel inventory]
  PLUG[Variant discovery/cache\nper-model variants] --> INV
  CFG[opencode.json\ncustom providers + agent variant] --> INV
  INV --> API[RunnerAdapter APIs\nmodels + getThinkingLevels(modelId)]
  API --> TUI[Deck TUI\nmodel + effort selection]
  TUI --> SAFE[Safe persistence\nvariant validated per model]
  SAFE --> CLEAN[Stale effort cleanup\nclear invalid variants]
  CAT[Canonical catalog\nfallback/enrichment only] -.-> INV
```
