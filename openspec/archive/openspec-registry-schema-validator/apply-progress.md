# Apply Progress: openspec-registry-schema-validator

## Completed Tasks

### Task 1: Create canonical schema constants
**Status**: ✅ Complete
**Files Changed**
- `packages/core/src/spec-registry/schema.ts` — create

**Verification**
- TypeScript compiles
- Exports: SCHEMA_STATE, SCHEMA_EVENTS, ValidatorPhase, ValidatorStatus, ValidatorArtifactKind, ValidationRuleCode, PHASE_ORDER, PHASE_TO_INDEX

**Notes**
- Includes closed phase in validator phases (not in existing ChangePhase enum)
- Maps snake_case internal artifact keys to kebab-case public keys

---

### Task 2: Create YAML parser adapter
**Status**: ✅ Complete
**Files Changed**
- `packages/core/src/spec-registry/yaml.ts` — create

**Verification**
- TypeScript compiles
- Exports: parseYaml, parseYamlSync, ParsedYamlDocument, YamlDiagnostic

**Notes**
- Uses yaml npm package (added as dependency)
- Normalizes parse errors/warnings into consistent DTO
- Duplicate key detection included

---

### Task 3: Add validator DTOs to types.ts
**Status**: ✅ Complete
**Files Changed**
- `packages/core/src/spec-registry/types.ts` — modify (add validator DTOs)

**Verification**
- TypeScript compiles
- Types re-exported from barrel

**Notes**
- Added: ValidateOpenSpecRegistryOptions, ValidationSeverity, OpenSpecRegistryValidationIssue, OpenSpecRegistryChangeValidation, OpenSpecRegistryValidationSummary, OpenSpecRegistryValidationResult

---

### Task 4: Update spec-registry barrel export
**Status**: ✅ Complete
**Files Changed**
- `packages/core/src/spec-registry/index.ts` — modify

**Verification**
- `import { validateOpenSpecRegistry }` resolves

**Notes**
- Exports schema.ts, yaml.ts, and validator.ts modules

---

### Task 5: Implement core validateOpenSpecRegistry function
**Status**: ✅ Complete
**Files Changed**
- `packages/core/src/spec-registry/validator.ts` — create

**Verification**
- TypeScript compiles
- Core validator function implemented with:
  - Directory discovery (openspec/changes/, openspec/archive/)
  - YAML parsing with tolerant adapter
  - Schema validation (canonical vs legacy detection)
  - Phase/status consistency rules
  - Artifact alignment checks
  - Events.yaml requirement enforcement
  - Legacy drift warning emission
  - Result aggregation

**Notes**
- Read-only validator: never writes to disk
- Supports single-change and full validation modes
- Handles legacy tolerance properly

---

### Task 6: Write unit tests for validator (TDD)
**Status**: ✅ Complete
**Files Changed**
- `packages/core/src/spec-registry/validator.test.ts` — create

**Verification**
- bun test packages/core/src/spec-registry/validator.test.ts passes (11 tests)

**Notes**
- TDD coverage:
  - Canonical valid state.yaml passes
  - Missing required field reports error
  - Invalid enum reports error
  - Malformed YAML handled gracefully
  - Phase > explore without events.yaml reports error
  - Artifact missing for completed phase reports error
  - Legacy drift reports warnings
  - Empty project returns ok:true with zero counts
  - Archive phase requires archived status
  - Closed phase requires abandoned or incomplete status
  - closure_reason required for abandoned status

---

### Task 7: Parse openspec validate CLI args
**Status**: ✅ Complete
**Files Changed**
- `apps/cli/src/cli-args.ts` — modify

**Verification**
- Parser tests pass for new command shapes

**Notes**
- Added openspec-validate command type
- Parses: --json, --change, --root

---

### Task 8: Add CLI parser tests
**Status**: ✅ Complete
**Files Changed**
- `apps/cli/src/cli-args.test.ts` — modify

**Verification**
- bun test apps/cli/src/cli-args.test.ts passes (46 tests)

**Notes**
- Added 14 tests for openspec validate command

---

### Task 9: Create CLI validate command adapter
**Status**: ✅ Complete
**Files Changed**
- `apps/cli/src/openspec-validate-command.ts` — create
- `packages/core/package.json` — modify (add spec-registry export)

**Verification**
- TypeScript compiles
- CLI adapter implemented with:
  - Resolve project root from args or cwd
  - Call core validator
  - Render JSON output (stable machine format)
  - Render optional human output (TTY detection)
  - Map severity to exit codes: 0 (no errors), 1 (errors found), 2 (runtime failure)

**Notes**
- `--json` flag outputs pure JSON to stdout
- Exit code 2 for nonexistent change and runtime failures

---

### Task 10: Add CLI validate command tests
**Status**: ✅ Complete
**Files Changed**
- `apps/cli/src/openspec-validate-command.test.ts` — create

**Verification**
- bun test apps/cli/src/openspec-validate-command.test.ts passes (7 tests)

**Notes**
- Tests:
  - JSON output matches schema
  - Exit code 0 for warnings-only
  - Exit code 1 for errors present
  - Exit code 2 for runtime failure (nonexistent change)
  - Exit code 2 for runtime failure (nonexistent root)
  - Human output mode works
  - Full validation mode - no --change flag

---

### Task 11: Route CLI command in main.tsx
**Status**: ✅ Complete
**Files Changed**
- `apps/cli/src/main.tsx` — modify

**Verification**
- `deck openspec validate --json --change openspec-registry-schema-validator` runs and exits with code 0

**Notes**
- Routes parsed `openspec-validate` command to CLI adapter
- Proper stdout/stderr separation

---

### Task 12: Create registry schema documentation skeleton/initial full doc
**Status**: ✅ Complete
**Files Changed**
- `openspec/registry-schema.md` — create

**Verification**
- File exists and contains both schema examples

**Notes**
- Full documentation with examples, severity rules, legacy compatibility notes

---

### Task 13: Add yaml dependency if needed
**Status**: ✅ Complete
**Files Changed**
- `package.json` — modify
- `bun.lockb` — modify

**Verification**
- yaml package installed and importable

**Notes**
- Added yaml@2.9.0 to dependencies

---

## In-Progress Tasks

None for this batch.

## Blocked Tasks

None — all tasks completed.

## Remaining Tasks

All tasks completed in this batch.

## Fix Batch: Review MAJOR Findings

### MAJOR-1: Duplicate key detection uses global `seen` Set
**Status**: ✅ Fixed
**Files Changed**
- `packages/core/src/spec-registry/yaml.ts` — modify `findDuplicateKeys` function

**Verification**
- Tests pass: all 11 validator tests pass
- Smoke run confirms no false positives between nested maps

**Notes**
- Moved `seen` Set inside the per-MAP branch to scope it per mapping node
- Each MAP node now gets its own `seen` Set, preventing cross-map key collision

---

### MAJOR-2: Dead code in provenance legacy_shape check
**Status**: ✅ Fixed
**Files Changed**
- `packages/core/src/spec-registry/validator.ts` — modify provenance validation (lines 450-479)

**Verification**
- Tests pass
- Smoke confirms legacy_shape warning now fires for object-form provenance

**Notes**
- Restructured: first check if object (legacy shape) → emit warning
- Then check if array missing/empty → emit error/warning
- The legacy_shape branch now fires correctly

---

### MAJOR-3: Summary JSON diverges from spec REQ-val-012
**Status**: ✅ Fixed
**Files Changed**
- `packages/core/src/spec-registry/types.ts` — modify `OpenSpecRegistryValidationSummary`
- `packages/core/src/spec-registry/validator.ts` — modify summary computation

**Verification**
- Tests pass (updated to use new field names)
- Smoke confirms JSON uses spec field names: `totalChanges`, `totalErrors`, etc.

**Notes**
- Aligned to spec REQ-val-012 field names:
  - `totalChanges` (was `checkedChanges`)
  - `totalActiveChanges` (was `checkedActiveChanges`)
  - `totalArchivedChanges` (was `checkedArchivedChanges`)
  - `changesWithErrors`, `changesWithWarnings`, `validChanges` (new)
  - `totalErrors` (was `errors`)
  - `totalWarnings` (was `warnings`)

---

### MAJOR-4: Issue field `code` vs spec `rule`
**Status**: ✅ Fixed
**Files Changed**
- `packages/core/src/spec-registry/types.ts` — rename `code` → `rule` in `OpenSpecRegistryValidationIssue`
- `packages/core/src/spec-registry/validator.ts` — rename `code` → `rule` (all 26 occurrences)
- `apps/cli/src/openspec-validate-command.ts` — update human output to use `rule`

**Verification**
- Tests pass (updated to use `rule`)
- Smoke confirms JSON output uses `rule` field

**Notes**
- Follows spec REQ-val-005: field is `rule` (rule identifier)
- Type now uses `ValidationRuleCode` union for type safety

---

### MAJOR-5: Type safety — ValidationRuleCode not used in DTO
**Status**: ✅ Fixed
**Files Changed**
- `packages/core/src/spec-registry/types.ts` — type `rule` as `ValidationRuleCode`
- `packages/core/src/spec-registry/schema.ts` — add missing codes to `ValidationRuleCode`:
  - `state.currentPhase.invalid`
  - `state.status.invalid`
  - `change.not_found`
  - `runtime.error`

**Verification**
- TypeScript compiles
- Tests pass

**Notes**
- DTO now uses typed `ValidationRuleCode` union
- All emitted codes are declared in the type

---

### MAJOR-6: YAML diagnostic codes not in ValidationRuleCode
**Status**: ✅ Fixed
**Files Changed**
- `packages/core/src/spec-registry/schema.ts` — add 3 codes to `ValidationRuleCode` type union and `VALIDATION_RULE_CODES` array

**Verification**
- TypeScript compiles: no errors in spec-registry files
- Tests pass: 64/64 tests pass

**Notes**
- Added to type union: `yaml.parse_error`, `yaml.parse_warning`, `yaml.duplicate_key`
- Added to runtime array: same three codes
- Fixes TS2322 at validator.ts:224 and validator.ts:548

---

## Summary

All Backend Apply tasks (Task 5, 6, 9, 10, 11) are now complete:
- Task 5: Core validator implemented ✅
- Task 6: Validator tests written and passing ✅
- Task 9: CLI adapter created ✅
- Task 10: CLI tests written and passing ✅
- Task 11: CLI routing in main.tsx ✅

Total tests: 64 passing across validator.test.ts, openspec-validate-command.test.ts, and cli-args.test.ts

---

### Fix batch CLI summary field names
**Status**: ✅ Complete
**Files Changed**
- `apps/cli/src/openspec-validate-command.ts` — modify error fallbacks and human output

**Verification**
- Tests: 7 pass
- Typecheck: pass (CLI adapter compiles)

**Notes**
- Fixed remaining old field names in CLI error fallbacks:
  - `checkedChanges` → `totalChanges`
  - `errors` → `totalErrors`
  - `warnings` → `totalWarnings`
- Fixed human output render to use new field names
- All JSON output now spec-aligned per REQ-val-012

---

### Fix MINOR-1: Fallback errors use `code` instead of `rule`
**Status**: ✅ Complete
**Files Changed**
- `apps/cli/src/openspec-validate-command.ts` — modify error fallback objects (lines 70, 170)

**Verification**
- Tests: 7 pass
- Typecheck: pass

**Notes**
- Changed `code: "runtime.error"` → `rule: "runtime.error"` in 2 fallback error objects
- Consistency fix for Review warning: spec uses `rule` field, not `code`