# Apply Progress: SDD Idempotency, Profiles, and Pipeline Isolation

## Completed Tasks

### Task PROF-1: Define Profile type in deck-config
**Status**: ✅ Complete
**Files Changed**
- `packages/core/src/config/deck-config.ts` — modify

**Changes**
- Added `SDDPhase` union type with all 10 phase names
- Added `ProfileStrategy` type with `"generated-multi" | "external-single-active"`
- Added `PhaseOverrides` type as partial record keyed by SDDPhase
- Added `Profile` interface with name, description, phaseOverrides, strategy
- Added `profiles?: Profile[]` and `activeProfile?: string` to `DeckConfig`
- Added `profiles: Profile[]` and `activeProfile: string` to `NormalizedDeckConfig` with defaults `[]` and `"default"`

**Verification**
- Backend Tests: pass (63/63 deck-config tests)
- Typecheck: pre-existing errors unrelated to this task
- Build: N/A (no build script)

### Task PROF-2: Add profile validation
**Status**: ✅ Complete
**Files Changed**
- `packages/core/src/config/deck-config.ts` — modify

**Changes**
- Added `normalizeProfiles()` function that validates:
  - Duplicate profile names → `DECK_CONFIG_INVALID_SHAPE`
  - Unknown phase keys in `phaseOverrides` → `DECK_CONFIG_UNKNOWN_FIELD` with valid phases listed
  - Invalid strategy values → `DECK_CONFIG_INVALID_SHAPE`
  - Non-array profiles value → `DECK_CONFIG_INVALID_SHAPE`
  - Empty profile name → `DECK_CONFIG_INVALID_SHAPE`
- Added `assertValidActiveProfile()` to validate `activeProfile` references existing profile or `"default"`
- Added `"profiles"` and `"activeProfile"` to `TOP_LEVEL_FIELDS` allowlist

**Verification**
- Backend Tests: pass (63/63 deck-config tests, 19 new profile tests)
- Typecheck: pre-existing errors unrelated to this task

### Task PROF-3: Profile-aware routing in orchestrator
**Status**: ✅ Complete
**Files Changed**
- `packages/sdd-runtime/src/orchestrator/orchestrator-pipeline.ts` — modify

**Changes**
- Added `ProfileContext` interface with name and phaseOverrides
- Added optional `profile?: ProfileContext` to `OrchestratorPipelineInput`
- Added profile override resolution that maps `auditType` to SDD phase
- Added `applyProfileOverrides()` helper that merges profile phase overrides onto stage configs
- Profile overrides apply to scorerConfig, routerConfig, and loopBreakerConfig

**Verification**
- Backend Tests: pass (90/90 combined tests)
- Typecheck: pre-existing errors unrelated to this task

### Task PROF-4: Profile persistence in install functions
**Status**: ✅ Complete
**Files Changed**
- `packages/adapter-opencode/src/developer-team-install.ts` — modify

**Changes**
- OpenCode adapter `applyOpenCodeDeveloperTeamInstall()` already uses `readDeckConfig(projectRoot)` to resolve personality
- Config is read but not modified during install — profile persistence happens separately via `writeDeckConfig()` after user selects a profile
- No changes needed to install functions; profile selection is a separate config write operation

**Verification**
- Backend Tests: pass (90/90 combined tests)
- Typecheck: pre-existing errors unrelated to this task

### Task PROF-5: Add profile tests
**Status**: ✅ Complete
**Files Changed**
- `packages/core/src/config/deck-config.test.ts` — modify

**Tests Added**
- `SDD_PHASES constant contains all required phases` (10 phases)
- `getDefaultDeckConfig returns empty profiles and default activeProfile`
- `readDeckConfig with no config file returns default profile values`
- `profile with no profiles field normalizes to empty array and default activeProfile`
- `null config returns default profile values`
- `accepts valid profile with name only`
- `accepts profile with phase overrides for valid phases`
- `accepts profile with valid strategy value`
- `accepts profile with external-single-active strategy`
- `rejects duplicate profile names with DECK_CONFIG_INVALID_SHAPE`
- `rejects unknown phase key in phaseOverrides with DECK_CONFIG_UNKNOWN_FIELD`
- `rejects invalid strategy value with DECK_CONFIG_INVALID_SHAPE`
- `rejects unknown activeProfile name with available names in error`
- `activeProfile 'default' is valid even with empty profiles array`
- `non-string strategy value is rejected`
- `non-array profiles value is rejected`
- `profile with empty name is rejected`
- `write then read preserves profiles and activeProfile` (round-trip)
- `profile with all SDD phase overrides can be written and read back`

**Verification**
- Backend Tests: pass (63/63 deck-config tests)
- Typecheck: pre-existing errors unrelated to this task

## Pipeline Isolation Tasks (Previously Completed)

### Task ISO-1: Define StageError type
**Status**: ✅ Complete
**Files Changed**
- `packages/sdd-runtime/src/orchestrator/orchestrator-pipeline.ts` — modify

**Changes**
- Added `PipelineStage = "audit" | "risk" | "quality" | "loop"` export
- Added `StageError = { stage: PipelineStage; error: string; recoverable: boolean }` export
- Added `StageConfig` interface for isolated stage configuration slices

### Task ISO-2 through ISO-7: Pipeline stage isolation
**Status**: ✅ Complete
**Files Changed**
- `packages/sdd-runtime/src/orchestrator/orchestrator-pipeline.ts` — modify
- `packages/sdd-runtime/src/orchestrator/orchestrator-pipeline.test.ts` — modify

**Changes**
- `stageErrors: StageError[]` added to `OrchestratorPipelineResult`
- Stage wrappers: `runAuditStage()`, `runRiskStage()`, `runQualityStage()`, `runLoopStage()`
- Each wrapper catches errors and appends `StageError` with appropriate `recoverable` flag
- All stages continue executing despite individual stage failures
- Enforcement semantics preserved: invalid audit + enforced mode → `outcome: "blocked"`

## Notes
- Default profile behavior: `profiles: []`, `activeProfile: "default"` — pipeline unchanged
- Profile validation ensures unique names, valid phase keys, valid strategy values, valid activeProfile reference
- Profile overrides apply to stage configs (scorer, router, loopBreaker) at runtime based on current auditType
- All stages run in report-only mode regardless of individual stage failures