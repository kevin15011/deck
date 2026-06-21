# Exploration: OpenCode Configured Providers Filter + TUI List Rendering

## Goal
Diagnose why OpenCode TUI shows ALL providers (145) instead of only configured ones, and why the list has "invisible selectable rows" that break arrow-key navigation.

## Current State

### Backend: `loadModelInventory` returns all cached providers
- `packages/adapter-opencode/src/model-inventory.ts` reads `~/.cache/opencode/models.json`.
- The cache contains **145 providers** (all providers OpenCode knows about), not just the ones the user has configured.
- The parser has no concept of "configured" — it treats every top-level key in the cache as a valid provider.
- The cache field for env-var hints is `env` (array of strings), but the parser reads `env_vars` (always undefined). This is a secondary field-name mismatch.

### Configured-provider signal exists but is unused
- OpenCode stores actual credentials at `~/.local/share/opencode/auth.json`.
- Shape: `{ "<providerId>": { "type": "api" | "oauth", "key" | "refresh": "..." } }`.
- The user's auth.json has 9 configured providers: `minimax-coding-plan`, `alibaba-coding-plan`, `zai-coding-plan`, `cerebras`, `openai`, `opencode-go`, `kimi-for-coding`, `google`, `alibaba-token-plan`.
- `model-inventory.ts` has **zero references** to `auth.json`. It never checks which providers are actually usable.
- `opencode.json` `provider` section (custom provider config) is read, but only for merging custom providers — not for filtering.

### TUI: MenuList has no windowing/scrolling
- `apps/cli/src/tui/components/menu-list.tsx` renders every item unconditionally.
- No `offset`, `pageSize`, `visibleItems`, `slice`, or scroll logic exists.
- With 145 providers, the list exceeds terminal height. Cursor moves through off-screen rows; user sees cursor "disappear" until it lands on a visible row near the viewport.
- This is the "invisible selectable rows" symptom.

### TUI flow
- `detectOpenCodeModelInventoryForTui` (app.tsx ~2379) calls `adapter.getModelInventory()` and passes `inventory.providers` directly to `setDetectedProviders`.
- No filtering occurs between inventory and TUI state.
- `ModelProviderSelectionScreen` renders all providers via `MenuList`.

## Likely Root Causes

1. **Backend (primary)**: `loadModelInventory` returns every provider in the cache without filtering by configured status. The cache is a catalog, not a configured-Provider list.
2. **Backend (secondary)**: `env_vars` field mismatch — parser reads `env_vars` but cache uses `env`. Env-var hints are lost.
3. **Frontend**: `MenuList` has no windowing. Long lists push cursor off-screen.

## Evidence

| File | Lines | Evidence |
|------|-------|----------|
| `packages/adapter-opencode/src/model-inventory.ts` | 38, 208, 293, 310 | Reads `providerData.env_vars` but cache field is `env` |
| `packages/adapter-opencode/src/model-inventory.ts` | 89-121, 191-225 | Parses all cache entries as providers; no configured-filter |
| `~/.cache/opencode/models.json` | — | 145 top-level provider keys; field is `env` not `env_vars` |
| `~/.local/share/opencode/auth.json` | — | 9 configured providers (api/oauth); never read by adapter |
| `apps/cli/src/tui/components/menu-list.tsx` | 17-33 | Renders all items; no windowing/scrolling/offset |
| `apps/cli/src/tui/app.tsx` | 2379-2402 | `detectOpenCodeModelInventoryForTui` passes all providers to TUI state |

## Minimal Fix Plan

### Backend Apply (adapter-opencode)
1. **Add `auth.json` reader**: New function `loadConfiguredProviderIds()` in `model-inventory.ts` that reads `~/.local/share/opencode/auth.json` and returns the set of provider IDs with credentials.
2. **Filter inventory by configured providers**: After parsing cache, filter `providers` and `modelsByProvider` to only include IDs present in `auth.json`. Providers not in auth.json are excluded.
3. **Fix `env` field name**: Change `providerData.env_vars` → `providerData.env` (or accept both) so `envVars` is populated correctly on `RunnerModelProvider`.
4. **Add option to skip filtering** (testability): Accept `configuredProviderIds?: Set<string>` in `ModelInventoryOptions` for deterministic tests.

### Frontend Apply (cli/tui)
5. **Add windowing to MenuList**: Compute visible slice based on `cursor`, terminal height, and a page size. Render only visible items with correct cursor indicator. This fixes the "invisible rows" symptom for any long list (providers, models, agents).

### Tests
6. **Add focused tests**:
   - `model-inventory.test.ts`: test that providers not in `auth.json` are filtered out.
   - `model-inventory.test.ts`: test that `env` field (not `env_vars`) populates `envVars`.
   - `menu-list.test.tsx` (if exists) or new: test that cursor navigation works correctly with windowing when items exceed visible area.

## Constraints
- `auth.json` path is `~/.local/share/opencode/auth.json` — must be configurable for tests.
- Must not break Pi adapter (separate flow, uses `detectConfiguredProviders`).
- Must preserve `RunnerModelInventory` contract (providers, modelsByProvider, diagnostics).
- Filtering must be deterministic (injectable for tests).

## Risks
- **False negatives**: If a provider is configured via env var but not in `auth.json`, it would be filtered out. Mitigation: also check env vars listed in cache's `env` field against `process.env`.
- **OAuth token expiry**: `auth.json` may have expired tokens. Mitigation: presence of entry is sufficient signal; OpenCode itself handles refresh.
- **MenuList windowing**: Changing MenuList affects all screens using it. Must test other screens (agent list, thinking levels, etc.) to ensure no regression.

## Options and Tradeoffs

1. **Filter at `loadModelInventory` level** (recommended)
   - Pros: Single source of truth; all consumers (TUI, install plan, config reader) benefit.
   - Cons: Changes adapter contract; must ensure tests inject configured set.
   - Effort: Low

2. **Filter at TUI level (`detectOpenCodeModelInventoryForTui`)**
   - Pros: Isolated to TUI; no adapter changes.
   - Cons: Other consumers still see all providers; duplicates filtering logic.
   - Effort: Low

3. **Add windowing to MenuList only (no backend filter)**
   - Pros: Fixes "invisible rows" symptom.
   - Cons: User still sees 145 providers; doesn't address "only configured" requirement.
   - Effort: Medium

**Recommendation**: Combine options 1 + 3. Filter backend to configured providers AND add MenuList windowing for robustness.

## Actionable Diagnosis
Yes — two clear root causes with minimal fix paths.

## Suggested Lifecycle Outcome
propose — direct focused bugfix is safe; no formal proposal needed if orchestrator approves as bugfix.

## Open Questions
- Should providers configured via env var (but not in `auth.json`) be included? (Recommend yes: check `process.env` against cache's `env` field.)
- Should `auth.json` path be configurable via `ModelInventoryOptions`? (Recommend yes, for testability.)

## Ready for Proposal
Yes — orchestrator can approve as direct focused bugfix or route to Proposal agent.

## Registry
- **Artifact Path**: `openspec/changes/opencode-configured-providers-filter/exploration.md`
- **State Path**: `openspec/changes/opencode-configured-providers-filter/state.yaml`
- **Events Path**: `openspec/changes/opencode-configured-providers-filter/events.yaml`
- **Recorded**: phase `explore`, status `completed`, event `exploration-completed`
- **Registry Blocker**: none
