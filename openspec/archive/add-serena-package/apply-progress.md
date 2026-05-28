# Apply Progress: Add Serena MCP Package

## Completed Tasks

### Task T1.1: Create Serena instruction bundle
**Status**: ✅ Complete
**Files Changed**
- `packages/core/src/teams/developer/instruction-bundles/serena.ts` — create

**Verification**
- Tests: pass (serena.test.ts)
- Build: pass
- Typecheck: pass

**Notes**
Created bundle with agent + skill fragments. Agent markdown documents all 15 enabled tools, 13 disabled tools, coexistence rules with codebase-memory. Skill fragment is condensed. Bundle is frozen.

### Task T1.2: Register in index.ts
**Status**: ✅ Complete
**Files Changed**
- `packages/core/src/teams/developer/instruction-bundles/index.ts` — modify

**Verification**
- Tests: pass (index.test.ts + bundle-parity.test.ts)
- Build: pass
- Typecheck: pass

**Notes**
Added import, type union, PACKAGE_BUILDERS entry, and PACKAGE_ORDER position (after adaptive-memory).

### Task T1.3: Add to deck-config.ts
**Status**: ✅ Complete
**Files Changed**
- `packages/core/src/config/deck-config.ts` — modify

**Verification**
- Tests: pass
- Build: pass
- Typecheck: pass

**Notes**
Added "serena" to PACKAGE_INSTRUCTION_PACKAGE_IDS, getDefaultDeckConfig(), normalizePackageInstructionConfig() for both pi and opencode runners.

### Task T2.1: Update state.ts (TUI constants/defaults)
**Status**: ✅ Complete
**Files Changed**
- `apps/cli/src/tui/runner-dashboard/state.ts` — modify

**Verification**
- Tests: pass
- Build: pass
- Typecheck: pass

**Notes**
Added "serena" to CANONICAL_INSTRUCTION_PACKAGE_IDS, and `serena: true` to selectedCapabilities in default state.

### Task T2.2: Update input-handler.ts fallback IDs
**Status**: ✅ Complete
**Files Changed**
- `apps/cli/src/tui/runner-dashboard/input-handler.ts` — modify

**Verification**
- Tests: pass
- Build: pass
- Typecheck: pass

**Notes**
Added "serena" to both fallback defaultIds arrays (lines 30 and 63).

### Task T2.3: Update action-runner.ts config write + MCP
**Status**: ✅ Complete
**Files Changed**
- `apps/cli/src/tui/runner-dashboard/action-runner.ts` — modify

**Verification**
- Tests: pass
- Build: pass
- Typecheck: pass

**Notes**
Added serena to updatedPackageInstructions for both runners. Added MCP config write branch for serena: local command `["serena", "start-mcp-server", "--context", "ide", "--project-from-cwd"]`.

### Task T2.4: Update selectors.ts consumption signal
**Status**: ✅ Complete
**Files Changed**
- `apps/cli/src/tui/runner-dashboard/selectors.ts` — modify

**Verification**
- Tests: pass
- Build: pass
- Typecheck: pass

**Notes**
Added `serena` to getTeamCapabilityProfile capabilities object.

### Task T3.1: Add to doctor-diagnostics.ts
**Status**: ✅ Complete
**Files Changed**
- `apps/cli/src/doctor-command/doctor-diagnostics.ts` — modify

**Verification**
- Tests: pass
- Build: pass
- Typecheck: pass

**Notes**
Added { name: "serena", label: "Serena MCP" } to KNOWN_OPENCODE_MCP_SERVERS. Added Serena binary check in checkMemoryProviders(). Updated checkOpenCodeMcp to check for local MCP (command array) as well as remote (url+type).

### Task T4.1: Update .deck/config.json
**Status**: ✅ Complete
**Files Changed**
- `.deck/config.json` — modify

**Verification**
- Config parses correctly
- Tests: pass
- Build: pass
- Typecheck: pass

**Notes**
Added `"serena": true` under packageInstructions for both pi and opencode runners.

### Task T4.2: Create serena.test.ts
**Status**: ✅ Complete
**Files Changed**
- `packages/core/src/teams/developer/instruction-bundles/serena.test.ts` — create

**Verification**
- Tests: pass (59 tests across 4 bundle test files)
- Build: pass
- Typecheck: pass

**Notes**
Tests: bundle returns 2 fragments, all have packageId "serena", surfaces agent+skill, agent mentions all 15 enabled/13 disabled tools, coexistence rules, bundle frozen, each markdown >50 chars.

### Task T4.3: Update parity + index tests
**Status**: ✅ Complete
**Files Changed**
- `packages/core/src/teams/developer/instruction-bundles/bundle-parity.test.ts` — modify
- `packages/core/src/teams/developer/instruction-bundles/index.test.ts` — modify

**Verification**
- Tests: pass
- Build: pass
- Typecheck: pass

**Notes**
Bundle parity test: added serena describe block with baseline hashes (agent: 1443888430, skill: 484477006). Index test: makeConfig fixture includes serena: false for both runners.

### Task T4.4: Update TUI tests
**Status**: ✅ Complete
**Files Changed**
- `apps/cli/src/tui/runner-dashboard/reducer.test.ts` — modify

**Verification**
- Tests: pass
- Build: pass
- Typecheck: pass

**Notes**
Added serena to inventory fixture and toggle test case.

## In-Progress Tasks

None — all 12 tasks complete.

## Blocked Tasks

None — all tasks completed successfully.

## Summary

| Phase | Tasks | Status |
|---|---|---|
| G1 Core | T1.1, T1.2, T1.3 | ✅ |
| G2 TUI | T2.1, T2.2, T2.3, T2.4 | ✅ |
| G3 Doctor | T3.1 | ✅ |
| G4 Tests + Config | T4.1, T4.2, T4.3, T4.4 | ✅ |

## Test Results

- **Tests**: 1776 pass, 53 fail (pre-existing failures unrelated to this change)
- **Build**: pass
- **Typecheck**: pass (relevant files)

## Next Step

Ready for Verify/Review.