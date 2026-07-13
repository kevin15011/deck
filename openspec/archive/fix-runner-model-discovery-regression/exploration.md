# Exploration: Runner-Owned Model and Reasoning Variant Discovery

**Change ID**: `fix-runner-model-discovery-regression`

## Goal

Determine why Deck's model-selection TUI shows models that OpenCode does not report as available, omits models that OpenCode does report, and exposes reasoning levels that differ from the runner's actual per-model variants.

## User Runtime Correction

The user runs `npm run deck:run`, which executes:

```text
bun run build:dry-run && ./dist/cli/deck
```

`build:dry-run` compiles the current host-platform binary before execution. Therefore, the previously inspected `~/.local/bin/deck` binary is irrelevant. The earlier stale-binary diagnosis is superseded.

## Current Deck Behavior

`packages/adapter-opencode/src/model-inventory.ts` reads `~/.cache/opencode/models.json`, derives configured provider IDs from `auth.json` and provider environment variables, filters the cache to those providers, and includes every cached model under them. It derives reasoning levels from cached `reasoning_options` entries with `type: "effort"`, falling back to cached legacy `variants`.

Provider filtering reduces unrelated providers, but incorrectly treats the runner cache as authoritative for model availability and reasoning variants.

## Direct Runtime Evidence

The local runtime is OpenCode `1.17.18`. A direct comparison found:

- OpenCode cache providers: **160**.
- Auth/environment-configured providers used by Deck: **9**.
- Models Deck derives from those configured providers: **148**.
- Models reported by `opencode models`: **107** across **10** providers.
- Cache-derived Deck candidates not reported by the runner: **58**.
- Runner-reported models absent from Deck's filtered candidate set: **17**.
- The runner reports the built-in `opencode` provider, but Deck omits it because it is not represented as an auth/environment-configured provider.

Representative cache-only entries include `google/gemini-2.0-flash`, `openai/gpt-4`, and `openai/gpt-3.5-turbo`. Representative runner-only entries include `openai/gpt-5.4-fast`, `openai/gpt-5.5-fast`, and current GPT-5.6 variants.

This reproduces both reported symptoms: unavailable/stale models appear, while newer runner-recognized models are missing.

## Reasoning-Level Investigation

OpenCode exposes an authoritative per-model representation through:

```text
opencode models --verbose
```

Verbose output contains each `provider/model` followed by structured model metadata, including the runner-computed `variants` object. These variants incorporate OpenCode's provider transforms, model API identity, built-in reasoning rules, user aliases, overrides, disabled variants, and plugin/configuration effects.

Direct comparison of live verbose variants against Deck's cache-derived effort values found:

- Live runner models: **107**.
- Live models with one or more variants: **53**.
- Models comparable against cache metadata: **99**.
- Models with different live vs cached variant sets: **33**.
- Models where the runner exposes variants but Deck's cache extraction yields none: **16**.
- Models where Deck's cached levels are non-empty but differ from the runner: **17**.

Examples:

- `google/gemini-2.5-flash`: runner variants `high`, `max`; Deck cache extraction returns none.
- `openai/gpt-5.6`: runner variants `none`, `low`, `medium`, `high`, `xhigh`; Deck cache additionally exposes unsupported `max`.
- `opencode/deepseek-v4-flash-free`: runner variants `low`, `medium`, `high`, `max`; cached metadata does not match the live set.

Cached `reasoning_options` are not a reliable source of the levels accepted by the active OpenCode runtime.

## OpenCode Contract

Current OpenCode documentation states that `opencode models` lists available models from configured providers, `--verbose` includes resolved model metadata and variants, and `--refresh` refreshes the models.dev cache. OpenCode computes and merges built-in variants, user-defined variants, aliases, disabled variants, and provider transforms before exposing the final model.

The live runner output is a stronger availability and variant contract than reading the underlying cache directly.

## Root Cause

Deck duplicates part of OpenCode's model-resolution logic and reads an intermediate cache instead of consuming the runner's resolved inventory.

1. **Provider proxy**: auth/environment presence omits runner-provided providers such as `opencode`.
2. **Model/variant proxy**: `models.json` plus cached `reasoning_options` includes unavailable/stale entries and misses or misstates current runner-resolved models and variants.

## Recommended Direction

1. Use `opencode models --verbose` or an equivalent stable runner API as the authoritative available provider/model inventory.
2. Expose exactly each resolved model's final `variants` keys as selectable reasoning levels.
3. Derive visible providers from returned model IDs rather than auth-file keys.
4. Use `models.json` only as optional metadata enrichment; it MUST NOT add models or variants absent from the resolved runner inventory.
5. Preserve aliases, custom providers, plugins, built-in providers, and user-disabled variants as resolved by OpenCode.
6. Fail closed or use a clearly identified last-known-good runner snapshot when discovery fails. Do not fall back to a broad static catalog.
7. Keep Pi and other runner adapters independent; each runner owns its inventory and variant discovery contract.

`--refresh` should not automatically run on every TUI opening because it may incur network latency. Deck should reflect the active runner's recognized state and may offer an explicit refresh path if required.

## Affected Areas

- `packages/adapter-opencode/src/model-inventory.ts`
- `packages/adapter-opencode/src/runner-adapter.ts`
- `packages/core/src/runner-adapter.ts`
- `apps/cli/src/tui/app.tsx`
- OpenCode adapter and TUI inventory tests
- Active overlapping changes `opencode-configured-providers-filter` and `fix-opencode-effort-levels-hardcoded`

## Required Test Coverage

- Parse normal and verbose OpenCode output deterministically.
- Include only runner-reported providers/models, including built-in providers absent from `auth.json`.
- Exclude cache-only models and include runner-only models.
- Preserve exact per-model variant keys, including custom/disabled variants and aliases.
- Hide reasoning selection for models with no variants.
- Handle malformed output, command failure, empty inventory, and timeout safely.
- Avoid network calls through injected command/filesystem seams.
- Verify Pi model discovery does not regress.

## Risks and Open Questions

- Verbose CLI output needs version-aware parsing unless a structured OpenCode API/SDK endpoint is more stable.
- Command execution adds latency and needs timeout/caching behavior.
- A long-lived process needs refresh/invalidation semantics.
- The failure policy must avoid reintroducing unavailable catalog entries.
- Existing overlapping OpenSpec changes should be reconciled rather than reimplemented independently.

## Actionable Diagnosis

**Yes.** Deck consumes OpenCode's intermediate model cache and reconstructs availability/variants, while the runner already exposes the resolved available inventory and final per-model variants.

## Ready for Proposal

**Yes.** Define runner-owned resolved inventory discovery, exact variant propagation, safe caching/failure behavior, and reconciliation with overlapping active changes.

## Registry

- Artifact: `openspec/changes/fix-runner-model-discovery-regression/exploration.md`
- State: `openspec/changes/fix-runner-model-discovery-regression/state.yaml`
- Events: `openspec/changes/fix-runner-model-discovery-regression/events.yaml`
- Corrected event: `exploration-corrected`
