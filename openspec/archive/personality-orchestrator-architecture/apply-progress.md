# Apply Progress: Personality-Aware Orchestrator Architecture

## Completed Tasks

### Task 5: OpenCode adapter reads personality at install time
**Status**: ✅ Complete
**Files Changed**
- `packages/adapter-opencode/src/developer-team-install.ts` — modify (read config + pass personality)
- `packages/adapter-opencode/src/prompt-generation.ts` — modify (accept and propagate personality)

**Verification**
- Tests: ✅ pass (61 tests across 3 test files)
- Build: ✅ (typecheck only — pre-existing test errors in unrelated packages, not in modified code)
- Typecheck: ✅ (modified files compile without new errors)

**Notes**
- `buildOpenCodeDeveloperTeamInstallPlan` now reads `orchestratorPersonality` from `.deck/config.json` via `readDeckConfig`, falling back to `DEFAULT_ORCHESTRATOR_PERSONALITY` (pragmatica) on error
- Explicit `personality` option added to `buildOpenCodeDeveloperTeamInstallPlan` options for callers who want to override
- Both `buildSkillFileContent` and `buildPromptContent` pass `personality` to `getAgentContent` and `getTeamSessionInstructions`
- `OpenCodeDeveloperTeamInstallPlan` type now includes `personality?: OrchestratorPersonality` field
- `GeneratePromptFilesOptions` and `buildPromptGenerationPlan` options include `personality?: OrchestratorPersonality`
- No runtime imports of `@deck/core` added — all imports are at build/install time (adapter is a build tool)
- Sub-agent fragment injection is handled by `content-registry.ts` (already completed in earlier wave)

### Task 6 (Finding Fix): Pi adapter hardcoded "." config path + missing try/catch
**Status**: ✅ Complete
**Files Changed**
- `packages/adapter-pi/src/pi-team-profile.ts` — modify (use projectRoot, add try/catch)
- `packages/adapter-pi/src/developer-team-install.ts` — modify (wrap readDeckConfig in try/catch)

**Verification**
- Tests: ✅ pass (114 tests across 3 files including pi-team-profile.test.ts)
- Typecheck: ✅ (no new type errors in modified files; pre-existing errors in unrelated packages unchanged)

**Notes**
- `pi-team-profile.ts`: Added `projectRoot?: string` option to `BuildTeamSystemPromptOptions`; uses `options?.projectRoot ?? "."` as config path
- `pi-team-profile.ts`: Added try/catch fallback to `DEFAULT_ORCHESTRATOR_PERSONALITY` in `buildTeamSystemPrompt`
- `developer-team-install.ts`: Added import for `DEFAULT_ORCHESTRATOR_PERSONALITY`; wrapped `readDeckConfig(projectRoot)` in try/catch with fallback to `DEFAULT_ORCHESTRATOR_PERSONALITY`
- `pi-team-profile.ts`: `materializeTeamProfile` now passes `projectRoot` to `buildTeamSystemPrompt`

### Task 7 (Finding Fix): Adapter tests lack personality assertions
**Status**: ✅ Complete
**Files Changed**
- `packages/adapter-pi/src/developer-team-install.test.ts` — modify (added personality flow tests)
- `packages/adapter-opencode/src/developer-team-install.test.ts` — modify (added personality flow tests)

**Verification**
- Tests: ✅ pass (96 tests across 2 files)
- Typecheck: ✅ (no new type errors in test files)

**Notes**
- Pi adapter: Added test "orchestratorPersonality option flows to agent content" (verifies explicit personality propagates)
- Pi adapter: Added test "falls back to pragmatica when config read fails" (verifies try/catch fallback works)
- OpenCode adapter: Added test "explicit personality option flows to generated skill content" (verifies personality → skill content + plan.personality capture)
- OpenCode adapter: Added test "falls back to pragmatica when config read fails" (verifies fallback + plan.personality capture)
- Both tests verify the personality value flows from config → registry → generated files

## In-Progress Tasks

(None — all findings fixed)

## Blocked Tasks

(None)

## Remaining Tasks

(None — all critical findings addressed)

## Verification Evidence

### Test Results
```
bun test v1.3.12 (700fc117)
114 pass 0 fail 669 expect() calls
Ran 114 tests across 3 files:
  - packages/adapter-pi/src/developer-team-install.test.ts
  - packages/adapter-opencode/src/developer-team-install.test.ts
  - packages/adapter-pi/src/pi-team-profile.test.ts
```

### TypeCheck Results
- `pi-team-profile.ts`: ✅ No errors
- `developer-team-install.ts` (both adapters): ✅ No errors
- Pre-existing errors in unrelated packages (`runner-capabilities.test.ts`, `index.test.ts`) unchanged

## Summary of Changes

### BLOCKER Fix: `packages/adapter-pi/src/pi-team-profile.ts`
- **Problem**: `buildTeamSystemPrompt` used hardcoded `"."` instead of `projectRoot` when calling `readDeckConfig`
- **Fix**: Added `projectRoot?: string` option to `BuildTeamSystemPromptOptions`; uses `options?.projectRoot ?? "."` as config path
- **Change**: Line 92 now uses `const configPath = options?.projectRoot ?? ".";`

### MAJOR Fix: `packages/adapter-pi/src/developer-team-install.ts`
- **Problem**: No try/catch around `readDeckConfig` — malformed config aborts install
- **Fix**: Wrapped `readDeckConfig(projectRoot)` in try/catch with fallback to `DEFAULT_ORCHESTRATOR_PERSONALITY`
- **Change**: Line 290-296 now uses IIFE with try/catch; added `DEFAULT_ORCHESTRATOR_PERSONALITY` import

### MAJOR Fix: `packages/adapter-pi/src/pi-team-profile.ts` (try/catch)
- **Problem**: `buildTeamSystemPrompt` had no try/catch for `readDeckConfig` fallback
- **Fix**: Added try/catch with fallback to `DEFAULT_ORCHESTRATOR_PERSONALITY` (inline with configPath resolution)

### Test Fix: `packages/adapter-pi/src/developer-team-install.test.ts`
- **Problem**: No tests verifying personality flows from config → generated files
- **Fix**: Added 2 tests in new describe block "buildDeveloperTeamInstallPlan (personality config)":
  1. "orchestratorPersonality option flows to agent content"
  2. "falls back to pragmatica when config read fails"
- Also added test for "capabilityInstructions via bundle prop (not readDeckConfig) works without config file" in new describe block "buildDeveloperTeamInstallPlan (capability instructions)"

### Test Fix: `packages/adapter-opencode/src/developer-team-install.test.ts`
- **Problem**: No tests verifying personality flows from config → generated files
- **Fix**: Added 2 tests in new describe block "orchestratorPersonality in buildOpenCodeDeveloperTeamInstallPlan":
  1. "explicit personality option flows to generated skill content"
  2. "falls back to pragmatica when config read fails"
- Used `personality` (not `orchestratorPersonality`) to match the actual option name in `buildOpenCodeDeveloperTeamInstallPlan`
- Verified `plan.personality` captures the resolved personality value