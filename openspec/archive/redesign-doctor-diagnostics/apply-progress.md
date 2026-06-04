# Apply Progress: Rediseñar diagnósticos de `deck doctor`

## Completed Tasks

### Task 1: Extender tipos de diagnósticos
**Status**: ✅ Complete
**Files Changed**
- `apps/cli/src/doctor-command/types.ts` — modify

**Verification**
- TypeScript: pass (typecheck clean for doctor files)
- Added: `DoctorSummary`, `DoctorPresentationModel` types
- Added: optional fields `deck`, `binaryCheck`, `runnerConfig`, `summary` to `DoctorDiagnosticsResult`

**Notes**
- All existing fields preserved (backward compatible)
- New fields are optional to avoid breaking existing consumers

---

### Task 2: Verificar exports de stores para lectura reutilizable
**Status**: ✅ Complete (No-op)
**Files Changed**
- No changes needed - stores already export `readManifest()`, `readState()`, `getDeckXdgPaths()`

**Verification**
- TypeScript: pass
- Existing exports sufficient for doctor checks

---

### Task 3: Crear módulo de helpers de checks por dominio
**Status**: ✅ Complete + **REPAIR 2**
**Files Changed**
- `apps/cli/src/doctor-command/doctor-checks.ts` — modify (B1-B6, M1-M2, M4-M6 fixes + second repair)

**Verification**
- TypeScript: pass (typecheck clean)
- Created helpers: `checkManifest()`, `checkState()`, `checkDeckConfig()`, `checkBinaries()`, `checkRunnerConfig()`
- Tests: 10 pass, 0 fail (added B4 readability test)

**Blocker Fixes Applied (B1-B6)**:
- B1: Added explicit manifest file existence check before calling readManifest() - returns error when file missing
- B2: Changed missing binary status from "warning" to "error" (REQ-ii-004)
- B3: Runner config now uses adapter validation functions (validateSupermemoryOpenCodeMcpConfig, validateSupermemoryPiMcpConfig) instead of just checking file existence
- B4: Deck config now checks readability using injected `access()` function - performs real R_OK|X_OK probe
- B5: Manifest drift paths now redacted with `deps.redactPath()` - folds home-relative paths to ~
- B6: Binary version stdout is now redacted via `deps.redactPath()` before processing

**Major Fixes Applied (M1-M6)**:
- M1: Binary checks now run in parallel using Promise.all
- M2: Fixed runDeckChecks to use parallel execution
- M4: Fixed hardcoded process.env.HOME - now uses homedir() from node:os
- M5: Spawn now pipes stdio (stdio: ["ignore", "pipe", "pipe"]) and caps stdout/stderr at 4 KiB
- M6: Fixed drift message math - shows all 10 displayed items, residual = total - 10 (not total - 3)

---

### Task 4: Extender orquestador de diagnósticos
**Status**: ✅ Complete
**Files Changed**
- `apps/cli/src/doctor-command/doctor-diagnostics.ts` — modify

**Verification**
- TypeScript: pass (typecheck clean)
- Added: deck checks, binary checks, runner config checks
- Added: summary calculation with counts by severity
- Updated: `hasCriticalErrors` includes new deck/binary/runner errors

**Notes**
- `runDoctorDiagnostics()` now returns new optional fields
- Non-throwing contract preserved (all sub-checks wrapped in try/catch)

---

### Task 5: Crear modelo de presentación compartido
**Status**: ✅ Complete
**Files Changed**
- `apps/cli/src/doctor-command/doctor-presentation.ts` — create

**Verification**
- TypeScript: pass (typecheck clean)
- Created: `formatDoctorResult()`, `formatExecutiveSummary()`, `getSemanticToken()`, `formatTruncatedItems()`
- Ordered sections: Deck → Runtime → Memory → MCP → Binary → Runner Config
- Pure function, no IO
- Tests: 12 pass, 0 fail

---

### Task 6: Actualizar renderer CLI
**Status**: ✅ Complete + **REPAIR**
**Files Changed**
- `apps/cli/src/doctor-command/doctor-report.ts` — modify

**Verification**
- TypeScript: pass (typecheck clean)
- Uses `formatDoctorResult()` for presentation
- Added: executive summary at top
- Added: new sections (Deck Installation, Binary Validation, Runner Configuration)
- Preserved: non-TTY plain output
- Tests: 15 pass, 0 fail

**Blocker Fix Applied (B7)**:
- B7: Fixed title regression - now shows "Doctor Report — Critical Issues Found" or "Doctor Report — All Checks Passed" with executive summary on second line

---

### Task 7: Actualizar pantalla TUI Doctor
**Status**: ✅ Complete
**Files Changed**
- `apps/cli/src/tui/screens/doctor-screen.tsx` — modify

**Verification**
- TypeScript: pass (typecheck clean)
- Added: executive summary at top (prominent)
- Added: new sections (Deck Installation, Binary Validation, Runner Configuration)
- Uses shared `formatDoctorResult()` and `formatExecutiveSummary()`

---

### Task 8: Create test files (B8)
**Status**: ✅ Complete (NEW)
**Files Changed**
- `apps/cli/src/__tests__/doctor-checks.test.ts` — create (NEW)
- `apps/cli/src/__tests__/doctor-presentation.test.ts` — create (NEW)

**Verification**
- doctor-checks.test.ts: 9 pass
- doctor-presentation.test.ts: 12 pass

**Notes**
- B8 FIX: Created missing test files as required by tasks.md

---

## Summary

| Task | Status | Notes |
|------|--------|-------|
| Task 1: Tipos | ✅ | Extended DoctorDiagnosticsResult with optional fields |
| Task 2: Stores | ✅ | No-op (exports already exist) |
| Task 3: Checks | ✅ | Created doctor-checks.ts with 5 domain helpers + blocker fixes |
| Task 4: Orchestrator | ✅ | Extended runDoctorDiagnostics() |
| Task 5: Presentation | ✅ | Created doctor-presentation.ts |
| Task 6: CLI Renderer | ✅ | Updated doctor-report.ts + title regression fix |
| Task 7: TUI | ✅ | Updated doctor-screen.tsx |
| Task 8: Tests | ✅ | Created doctor-checks.test.ts + doctor-presentation.test.ts |

## Files Changed

- `apps/cli/src/doctor-command/types.ts` (modify)
- `apps/cli/src/doctor-command/doctor-checks.ts` (modify) - B1-B6, M1-M2, M4-M6 fixes
- `apps/cli/src/doctor-command/doctor-diagnostics.ts` (modify)
- `apps/cli/src/doctor-command/doctor-presentation.ts` (create)
- `apps/cli/src/doctor-command/doctor-report.ts` (modify) - B7 fix
- `apps/cli/src/tui/screens/doctor-screen.tsx` (modify)
- `apps/cli/src/__tests__/doctor-checks.test.ts` (create) - B8 fix
- `apps/cli/src/__tests__/doctor-presentation.test.ts` (create) - B8 fix

## Blocker Findings Fixed

| Finding | Status | Description |
|---------|--------|-------------|
| B1 | ✅ Fixed | Missing manifest now reports error, not treated as fresh install |
| B2 | ✅ Fixed | Missing binary now reports error, not warning |
| B3 | ✅ Fixed | Runner config uses adapter validation, not just file existence |
| B4 | ✅ Fixed | Deck config uses real `access()` call for R_OK\|X_OK check |
| B5 | ✅ Fixed | Manifest drift paths use `redactPath()` to fold home paths to ~ |
| B6 | ✅ Fixed | Binary version output uses `redactPath()` to fold home paths |
| B7 | ✅ Fixed | Title regressions fixed - preserves "Critical Issues Found" / "All Checks Passed" |
| B8 | ✅ Fixed | Created doctor-checks.test.ts and doctor-presentation.test.ts |

## Major Findings Addressed

| Finding | Status | Description |
|---------|--------|-------------|
| M1 | ✅ Fixed | Binary checks now run in parallel with Promise.all |
| M2 | ✅ Fixed | runDeckChecks uses parallel execution |
| M3 | Partial | TUI still has some duplication, but core shared formatter is in place |
| M4 | ✅ Fixed | Uses homedir() instead of hardcoded HOME |
| M5 | ✅ Fixed | Spawn pipes stdio and caps stdout/stderr at 4 KiB |
| M6 | ✅ Fixed | Drift message shows all 10 displayed, residual = total - 10 |

## Notes

- All type errors in new code fixed
- Pre-existing type errors in other files remain (unrelated to this change)
- Tests: doctor-report.test.ts 15 pass, doctor-checks.test.ts 10 pass, doctor-presentation.test.ts 12 pass, doctor-diagnostics.test.ts 13 pass (50 total)
- All blocker findings (B1-B8) from review have been fixed in second repair
- Removed // B-FIX: and // M-FIX: markers from source code
- Removed unused imports (readdirSync, redactDiagnostic, ManifestJsonV2, DeckUpdateState)
