# Apply Progress: fix-opencode-effort-levels-hardcoded (Backend + Frontend)

## Completed Tasks

### Task 1: Extract effort variants from reasoning_options in model-inventory.ts
**Status**: ✅ Complete
**Files Changed**
- `packages/adapter-opencode/src/model-inventory.ts` — modify

**What**
- Extended `OpenCodeModelData` interface with a typed `reasoning_options` field
  (array of `{ type, values?, min? }` entries) and a new `OpenCodeReasoningOption`
  interface.
- Added `extractEffortVariants(options)` helper that pulls discrete effort level
  strings from entries where `type === "effort"` and `values` is a string array.
  Non-string entries, non-array `values`, unknown `type` entries, and
  `budget_tokens` entries are ignored.
- Updated `parseModelEntry()` to prefer `reasoning_options` effort values and
  fall back to the legacy `variants` field for backward compatibility. Existing
  `validateAndDedupVariants()` validation (dedup, control-char rejection,
  whitespace trimming) is applied to the merged result, so reasoning_options
  values get the same sanitization as legacy variants.

**Behavior**
- `reasoning_options: [{ type: "effort", values: ["high","max"] }]` → variants `["high","max"]`.
- `reasoning_options: [{ type: "effort", values: ["none","low","medium","high","xhigh"] }]` → those 5 levels.
- `reasoning_options: [{ type: "budget_tokens", min: 1024 }]` → variants `[]` (no discrete levels).
- No `reasoning_options` and no `variants` → variants `[]`.
- Both present → `reasoning_options` effort values win (matches real cache semantics).

**Verification**
- Backend Tests: pass (8 new model-inventory.test.ts cases)
- Typecheck: pass (model-inventory.ts has 0 type errors)

### Task 2: Model-specific getThinkingLevels in runner-adapter.ts
**Status**: ✅ Complete
**Files Changed**
- `packages/adapter-opencode/src/runner-adapter.ts` — modify

**What**
- Added `OpenCodeRunnerAdapterOptions` type with an optional `inventoryLoader`
  testing seam (production leaves it undefined → `loadModelInventory()`).
- `createOpenCodeRunnerAdapter(options?)` and `OpenCodeRunnerAdapterImpl`
  constructor now accept options; `#inventoryLoader` is stored and consulted by
  `getModelInventory()` (cached via `#cachedInventory`).
- Rewrote `getThinkingLevels(modelId?)`:
  - No `modelId` → returns canonical `OPENCODE_THINKING_LEVELS` (preserves the
    pre-existing "all levels" contract; independent of cache availability).
  - `modelId` provided → looks up the model in the inventory and returns its
    per-model `variants` when present. Fail-closed (returns `[]`) when the
    inventory throws, the model is absent, or the model has no discrete effort
    variants (e.g. `budget_tokens`-only). Never returns the generic constant for
    a specific model — prevents offering levels the model does not support.
- Added `findModelInInventory(inventory, modelId)` helper that tolerates the
  `provider/model` vs raw `model` ID mismatch: exact-id match first, then
  suffix match for unprefixed IDs (e.g. `"glm-5.2"` → `"alibaba-token-plan/glm-5.2"`).

**Type note**
- `RunnerThinkingLevel` (= `ReasoningLevel`) is a closed union that does not
  enumerate provider-specific tokens ("max", "none"). The return cast is
  documented inline; runtime treats levels as strings. Widening the core type
  is out of scope for this backend task (would be a frontend-facing contract
  change requiring a Frontend Apply handoff).

**Verification**
- Backend Tests: pass (14 runner-adapter.inventory.test.ts cases, including
  model-specific `["high","max"]` vs `["none","low","medium","high","xhigh"]`,
  raw-id suffix resolution, budget_tokens empty, throw fail-closed, and
  no-modelId canonical fallback)
- Typecheck: pass (runner-adapter.ts has 0 type errors)

### Task 3: Backend Tests
**Status**: ✅ Complete
**Files Changed**
- `packages/adapter-opencode/src/model-inventory.test.ts` — modify (8 new cases)
- `packages/adapter-opencode/src/runner-adapter.inventory.test.ts` — modify (rewritten with 14 cases)

**Cases added**
- model-inventory.test.ts: reasoning_options effort extraction (high,max and
  none..xhigh), budget_tokens → empty, absent options → empty, reasoning_options
  wins over legacy variants, unknown type ignored, malformed values filtered,
  dedup/validation applied.
- runner-adapter.inventory.test.ts: model-specific levels (high,max vs
  none..xhigh), raw-id suffix resolution, budget_tokens → empty, undefined
  variants → empty, inventory-throws → empty (fail-closed), no-modelId →
  canonical (even when inventory throws), injected inventoryLoader seam.

### Task 4: Frontend TUI rewiring — AgentModelAssignmentScreen (Layer 3)
**Status**: ✅ Complete
**Files Changed**
- `apps/cli/src/tui/screens/developer-team-screens.tsx` — modify

**What**
- Added an optional `thinkingLevels?: readonly string[]` prop to
  `AgentModelAssignmentScreenProps`. When provided, the screen renders exactly
  those levels (sourced from `adapter.getThinkingLevels(selectedModel.id)` by
  app.tsx) instead of the hardcoded `OPENCODE_THINKING_LEVELS` constant.
- When the prop is provided AND empty (`[]`), the screen hides the effort picker
  and shows "Thinking not supported" — matching the fail-closed contract of
  `RunnerAdapter.getThinkingLevels` for unsupported/no-variant models.
- When the prop is omitted, the screen falls back to the runtime-default
  constant (`PI_THINKING_LEVELS` for Pi, `OPENCODE_THINKING_LEVELS` for
  OpenCode). This preserves Pi's fixed-levels path and all existing Pi tests
  that don't pass the new prop.

**Behavior**
- OpenCode model with variants `["high","max"]` → renders exactly "thinking high"
  and "thinking max"; does NOT render "thinking low/medium/off/minimal/xhigh".
- OpenCode model with variants `["none","low","medium","high","xhigh"]` → renders
  exactly those five; does NOT render "thinking off" or "thinking minimal".
- OpenCode model with empty variants (budget_tokens-only or unknown) → hides the
  picker and shows "Thinking not supported".
- Pi runtime without the prop → renders all six fixed PI_THINKING_LEVELS unchanged.

**Verification**
- Frontend Tests: pass (7 new test cases in developer-team-screens-effort.test.tsx)
- Typecheck: pass (developer-team-screens.tsx has 0 type errors)

### Task 5: Frontend TUI rewiring — app.tsx thinking-level sites (Layer 3)
**Status**: ✅ Complete
**Files Changed**
- `apps/cli/src/tui/app.tsx` — modify

**What**
- Added `getActiveThinkingLevels(modelId?)` helper inside DeckApp. For OpenCode
  it calls `adapter.getThinkingLevels(modelId ?? selectedModel.id)` to fetch
  model-specific variants from the adapter's inventory. For Pi it returns the
  fixed `PI_THINKING_LEVELS` constant.
- Removed the unused `OPENCODE_THINKING_LEVELS` import (no longer referenced in
  app.tsx — all four hardcoded sites now use the helper).
- Added `RunnerThinkingLevel` type import from `@deck/core`.
- Updated four sites that previously used `OPENCODE_THINKING_LEVELS`:
  1. `getCursorLimit()` — `agent-model-assignment` branch: cursor limit now
     reflects the model-specific level count (was hardcoded 4).
  2. `continueFromCurrent()` — `model-selection` handler: the preselected
     thinking index is computed against the model's real variants so the cursor
     lands on a valid option.
  3. `continueFromCurrent()` — `agent-model-assignment` handler: the selected
     level is read from the model-specific array by cursor index.
  4. `getThinkingLevelByCursor()` — cursor-to-level mapping now uses
     model-specific levels for OpenCode (was dead code using the constant).
- Updated the `AgentModelAssignmentScreen` render site to pass
  `thinkingLevels={getActiveThinkingLevels(selectedModel.id)}` for OpenCode.
  Pi omits the prop and falls back to `PI_THINKING_LEVELS`.

**Pi behavior preserved**
- Pi continues using its fixed `PI_THINKING_LEVELS` through its adapter path.
  The `thinkingLevels` prop is `undefined` for Pi, so the screen falls back to
  the runtime-default constant.

**Native variant fallback preserved**
- `detectOpenCodeModelInventoryForTui()` still reads `existing.reasoningEffort`
  from `opencode.json` and flows it through `adapter.resolveThinking(modelId,
  existingAssignment)`, which uses the native variant when available and falls
  back to `reasoningEffort`. No change to this path.

**Verification**
- Frontend Tests: pass (44/44 in developer-team-screens-effort.test.tsx;
  40/40 in menu-list.test.tsx; 3/3 in no-gentle-ai-dependency.test.ts)
- Typecheck: pass (0 errors in modified line ranges of app.tsx; all remaining
  app.tsx errors are pre-existing baseline in unrelated dashboard/supermemory/
  optional-tools areas — verified by stash comparison)
- Pre-existing test failures (TeamSelectionScreen "archive" and
  PersonalitySelectionScreen "Ahorro extremo") confirmed on baseline before
  my changes — not caused by this work.

## In-Progress Tasks
None.

## Blocked Tasks
None.

## Remaining Tasks
None — all three layers (backend inventory, backend adapter, frontend TUI) are
complete. Ready for Verify/Review.

## Verification Summary
- Backend Tests: pass (359/359 across packages/adapter-opencode/src; 39/39
  targeted in the two inventory test files)
- Frontend Tests: pass (44/44 developer-team-screens-effort.test.tsx including
  7 new model-specific rendering tests; 40/40 menu-list.test.tsx;
  3/3 no-gentle-ai-dependency.test.ts)
- Build: skipped (no build step for this package; consumed as source via
  workspace exports)
- Typecheck: pass for all touched files (0 errors in modified line ranges).
  Pre-existing baseline errors remain in untouched files.
- no-gentle-ai-dependency guard: pass (3/3)

## Notes
- Serena symbol-body operations (`replace_symbol_body`) used successfully for
  `developer-team-screens.tsx` (props type + component body). `edit` tool used
  for `app.tsx` surgical edits at 5 distinct sites (more appropriate than
  full-body replacement for a 3200-line file).
- Pre-existing test failures in `developer-team-flow.test.tsx`
  (TeamSelectionScreen "archive" and PersonalitySelectionScreen "Ahorro extremo")
  confirmed as baseline by stashing my changes and re-running — these reference
  text that does not exist in app.tsx and are unrelated to this change.
- No live runner/network/provider/OAuth/gentle-ai dependencies introduced.
- Not committed (per instructions).
