# Apply Progress: Orchestrator Personality Selector

## Completed Tasks

### Task 2: Config unit tests — personality validation, defaulting, persistence
**Status**: ✅ Complete
**Files Changed**
- `packages/core/src/config/deck-config.test.ts` — modify

**Verification**
- Tests: 45 pass, 0 fail
- Build: N/A (no build step configured for core package)
- Typecheck: N/A (no tsconfig.json in core package)

**Notes**
- Added tests for personality field loading from config JSON
- Added test for default value ("pragmatica") when config file absent
- Added test for default value when field is missing from existing config
- Added tests for all three valid values: "guia", "pragmatica", "ahorro-extremo"
- Added test for invalid string value rejection (DECK_CONFIG_INVALID_SHAPE)
- Added test for non-string value rejection
- Added round-trip test preserving personality for each valid value
- Added test verifying adaptiveMemory is preserved in write-then-read
- Followed existing test patterns (expectDeckConfigError helper, temp root pattern)
- Task 1 (config schema) was already implemented; no changes needed to deck-config.ts

### Task 4: Flow routing unit tests
**Status**: ✅ Complete
**Files Changed**
- `apps/cli/src/developer-team-flow.test.ts` — modify

**Verification**
- Tests: 21 pass, 0 fail
- Build: N/A
- Typecheck: N/A

**Notes**
- Added tests for getNextScreenAfterEnvironmentSelection:
  - Returns "personality-selection" when environments are selected (single and multiple)
  - Returns "complete" when no environments are selected
- Added tests for getNextScreenAfterPersonalitySelection:
  - Routes to "pi-preflight-checking" when Pi is selected (including when both Pi and OpenCode are selected)
  - Routes to "opencode-preflight-checking" when only OpenCode is selected
  - Routes to "complete" when no environments are selected (defensive fallback)
- Followed existing test patterns in developer-team-flow.test.ts

### Task 6: Orchestrator pipeline personality integration
**Status**: ✅ Complete
**Files Changed**
- `packages/sdd-runtime/src/orchestrator/orchestrator-pipeline.ts` — modify

**Verification**
- Backend Tests: 13 pass, 0 fail
- Build: N/A (no build script; using bun test as verification)
- Typecheck: N/A (pre-existing errors unrelated to this change)

**Notes**
- Added `personality?: OrchestratorPersonality` optional field to `PipelineConfig` with default `DEFAULT_ORCHESTRATOR_PERSONALITY` ("pragmatica")
- Replaced inline string construction for `blockReason` (both blocked and partial paths) with `formatBlockReason()` calls passing structured `BlockReasonFacts`
- Added personality-aware `skipReason` formatting via `formatSkipReason()` — only when `skipReason` is set; machine-readable fields (`invokeQuality`, `checksToRun`, `requiresReplanOrOverride`, `stateValidationRequired`) remain structurally identical
- In blocked path, `skipReason` is set to `undefined` (not used in blocked outcome anyway)
- Backward compatible: missing personality defaults to "pragmatica" which matches previous inline string behavior
- Machine-readable fields (`outcome`, `loopAction`, `riskResult.score`, `qualityDecision.invokeQuality`, `qualityDecision.checksToRun`) are invariant across all personality values

### Task 7: Orchestrator personality tests
**Status**: ✅ Complete
**Files Changed**
- `packages/sdd-runtime/src/orchestrator/personality-output.test.ts` — create
- `packages/sdd-runtime/src/orchestrator/orchestrator-pipeline.test.ts` — modify

**Verification**
- Backend Tests: 54 pass, 0 fail (personality-output.test.ts + orchestrator-pipeline.test.ts)
- Build: N/A
- Typecheck: N/A

**Notes**
- Created `personality-output.test.ts` with 30 tests covering:
  - `ORCHESTRATOR_PERSONALITIES` constant and `DEFAULT_ORCHESTRATOR_PERSONALITY` value
  - `formatBlockReason` for all three personalities (guia/pragmatica/ahorro-extremo), including critical=true and defaulting behavior
  - `formatSkipReason` for all three personalities, including override cases
  - `formatLoopBreakerMessage` for all personalities and all loop actions
  - Machine-readable field invariance across personalities
- Added 16 personality tests to `orchestrator-pipeline.test.ts`:
  - pragmatica baseline regression test
  - guia expanded rationale for block reasons and skip reasons
  - ahorro-extremo single-line output (block and skip)
  - [CRITICAL] mandatory summary in ahorro-extremo for critical blocks
  - Machine-readable field identity across all three personalities (outcome, loopAction, riskResult.score/tier, qualityDecision.invokeQuality/checksToRun/requiresReplanOrOverride, auditValid)
  - Undefined personality defaults to pragmatica
  - Low-risk skip reason personality variation
  - Low-risk machine-readable field invariance
  - pragmatica format regression test
- All three personalities produce structurally different output (guia longest, pragmatica medium, ahorro-extremo shortest)

## In-Progress Tasks

None.

## Blocked Tasks

None.

## Remaining Tasks

- Task 9: TUI render and routing tests — pending (depends on Task 8)

---

## Update: Task 8 Completed

### Task 8: TUI PersonalitySelectionScreen — component, state, navigation
**Status**: ✅ Complete
**Files Changed**
- `apps/cli/src/tui/app.tsx` — modify

**Verification**
- TypeScript: 0 errors in app.tsx (pre-existing errors in other files unrelated to this change)
- Tests: 21 pass, 0 fail (developer-team-flow.test.ts)
- Build: N/A

**Notes**
- Added `"personality-selection"` to the local `Screen` union type
- Added `selectedPersonality` state initialized from `readDeckConfig(resolveProjectRoot()).orchestratorPersonality` with fallback to `"pragmatica"`
- Added `getNextScreenAfterEnvironmentSelection` and `getNextScreenAfterPersonalitySelection` to imports
- Used `getNextScreenAfterEnvironmentSelection` in `environment-selection` continue handler (was previously doing inline routing directly to preflight)
- Used `getNextScreenAfterPersonalitySelection` in `personality-selection` continue handler to route to appropriate preflight
- Added cursor limit `2` for `personality-selection` (3 options: guia, pragmatica, ahorro-extremo)
- Default cursor for personality-selection is set to 1 (Pragmática) when entering the screen via `resetCursor(nextScreen, nextScreen === "personality-selection" ? 1 : 0)`
- Created `PersonalitySelectionScreen` component with three options (Guía, Pragmática, Ahorro extremo), hints showing token cost, and persistent disclaimer about ahorro-extremo trade-offs
- Added `"personality-selection": "environment-selection"` to the `goBack` navigation map
- Added title for personality-selection screen in `screenTitle` function
- Environment-selection now routes to personality-selection instead of directly to preflight
- Personality-selection writes selected value to config via `writeDeckConfig` with merged config (preserving existing fields)
- Config write errors are caught and leave user on the screen to retry