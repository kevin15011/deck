# Verify Report: OpenSpec Registry Schema Validator (Final)

## Summary

**Overall Result**: PASS
**Tasks Complete**: 13 / 13
**Tests**: 119 / 119 passed (55 spec-registry + 46 CLI parser + 7 CLI validate command + 11 validator unit)
**Build**: N/A (no build step for this change)
**Typecheck**: PASS (scoped to changed files: core/spec-registry + CLI/openspec-validate-command)

## Task Completion

| Task | Status | Owner |
|---|---|---|
| Task 1: Create canonical schema constants | ✅ Complete | General Apply |
| Task 2: Create YAML parser adapter | ✅ Complete | General Apply |
| Task 3: Add validator DTOs to types.ts | ✅ Complete | General Apply |
| Task 4: Update spec-registry barrel export | ✅ Complete | General Apply |
| Task 5: Implement core validateOpenSpecRegistry function | ✅ Complete | Backend Apply |
| Task 6: Write unit tests for validator (TDD) | ✅ Complete | Backend Apply |
| Task 7: Parse openspec validate CLI args | ✅ Complete | CLI Apply |
| Task 8: Add CLI parser tests | ✅ Complete | CLI Apply |
| Task 9: Create CLI validate command adapter | ✅ Complete | CLI Apply |
| Task 10: Add CLI validate command tests | ✅ Complete | CLI Apply |
| Task 11: Route CLI command in main.tsx | ✅ Complete | CLI Apply |
| Task 12: Create registry schema documentation | ✅ Complete | General Apply |
| Task 13: Add yaml dependency if needed | ✅ Complete | General Apply |

## Test Results

| Test Suite | Pass | Fail | Skip |
|---|---|---|---|
| spec-registry (validator, types, events, paths) | 55 | 0 | 0 |
| CLI parser (cli-args.test.ts) | 46 | 0 | 0 |
| CLI validate command | 7 | 0 | 0 |
| Validator unit tests | 11 | 0 | 0 |
| **Total** | **119** | **0** | **0** |

## Build / Typecheck

| Check | Result | Details |
|---|---|---|
| Typecheck (core/spec-registry) | ✅ PASS | No errors in validator.ts, schema.ts, types.ts, yaml.ts |
| Typecheck (CLI/openspec-validate-command) | ✅ PASS | No errors in openspec-validate-command.ts |
| Typecheck (full CLI package) | ⚠️ WARN | 5 errors in pi-launch-command.ts (unrelated to this change — pre-existing) |

## Previous 5 MAJOR Findings — Final Verification

| # | Previous MAJOR | Status | Evidence |
|---|---|---|---|
| 1 | Duplicate key detection uses global `seen` Set | ✅ **Fixed** | `yaml.ts:128` — `seen` is inside `if (n.type === "MAP")` block; each MAP node gets its own Set. |
| 2 | Dead code in provenance legacy_shape check | ✅ **Fixed** | `validator.ts:459` — object-form check precedes array check at line 470; `legacy_shape` warning is reachable. |
| 3 | Summary JSON fields diverge from spec REQ-val-012 | ✅ **Fixed** | Smoke output contains all 6 spec-mandated fields: `totalChanges`, `validChanges`, `changesWithErrors`, `changesWithWarnings`, `totalErrors`, `totalWarnings`. Extra fields (`totalActiveChanges`, `totalArchivedChanges`) are additive. |
| 4 | Issue field `code` vs spec `rule` | ✅ **Fixed** | Smoke output shows `"rule": "events.event.name_mismatch"`. DTO uses `rule: ValidationRuleCode`. |
| 5 | ValidationRuleCode type safety | ✅ **Fixed** | DTO `rule` field typed as `ValidationRuleCode`; all emitted codes declared in union. |

## MAJOR-6 Fix Verification (YAML diagnostic codes)

| Check | Result | Evidence |
|---|---|---|
| YAML codes in ValidationRuleCode type union | ✅ **Fixed** | `schema.ts:195-197` — `yaml.parse_error`, `yaml.parse_warning`, `yaml.duplicate_key` present in type union. |
| YAML codes in VALIDATION_RULE_CODES array | ✅ **Fixed** | `schema.ts:234-236` — same three codes present in runtime array. |
| Typecheck validator.ts:224 | ✅ **PASS** | No TS2322 error; `diag.code` (typed as YAML diagnostic) assignable to `rule: ValidationRuleCode`. |
| Typecheck validator.ts:548 | ✅ **PASS** | No TS2322 error; same as above. |

**Root Cause of Previous Failure**: The previous verify run incorrectly claimed "TypeScript compiles" but the three YAML diagnostic codes were not yet in the `ValidationRuleCode` union. The apply-progress has now been updated and the fix is complete.

## Compliance Matrix

| REQ-ID / Scenario | Method | Result | Notes |
|---|---|---|---|
| REQ-schema-001: Canonical state.yaml schema | Source + unit tests | ✅ PASS | `SCHEMA_STATE` constant, all required fields validated. |
| REQ-schema-002: Canonical events.yaml schema | Source + unit tests | ✅ PASS | `SCHEMA_EVENTS` constant, event structure validated. |
| REQ-schema-003: Phase enum includes closed | `schema.ts` inspection | ✅ PASS | `ValidatorPhase` union includes `"closed"`. |
| REQ-schema-004: Status enum complete | `schema.ts` inspection | ✅ PASS | All 9 statuses present. |
| REQ-schema-005: Artifact kinds defined | `schema.ts` inspection | ✅ PASS | 9 artifact kinds, snake_case → kebab-case map. |
| REQ-schema-006: Validation rule codes declared | `schema.ts` inspection | ✅ PASS | 38 codes in type union + runtime array. |
| REQ-schema-007: YAML codes in ValidationRuleCode | `schema.ts:195-197,234-236` | ✅ PASS | `yaml.parse_error`, `yaml.parse_warning`, `yaml.duplicate_key` present. |
| REQ-val-001: Read-only guarantee | Source + unit tests | ✅ PASS | No `fs.write*` calls in validator; 11 unit tests exercise read paths. |
| REQ-val-002: Malformed YAML handled gracefully | Unit test | ✅ PASS | `malformed YAML handled gracefully` test passes. |
| REQ-val-003: Single-change validation mode | Smoke + unit tests | ✅ PASS | `--change <id>` works; unit tests pass. |
| REQ-val-004: Full validation mode | Smoke + unit tests | ✅ PASS | No `--change` flag → validates all changes. |
| REQ-val-005: Issue field is `rule` | Smoke output | ✅ PASS | JSON uses `"rule": "events.event.name_mismatch"`. |
| REQ-val-006: Phase/status consistency | Unit tests | ✅ PASS | Archive→archived, closed→abandoned/incomplete, closure_reason. |
| REQ-val-007: Artifact alignment | Unit tests | ✅ PASS | Missing artifact for completed phase → error; future phase absent → warning. |
| REQ-val-008: Events required after explore | Unit test | ✅ PASS | Phase > explore without events.yaml → error. |
| REQ-val-009: Legacy provenance object form | Unit test | ✅ PASS | Object-form provenance → warning. |
| REQ-val-010: Legacy drift warnings | Unit test | ✅ PASS | Non-canonical fields → warnings, not errors. |
| REQ-val-011: Events/state phase cross-check | Unit test | ✅ PASS | Mismatch → error. |
| REQ-val-012: Summary JSON structure | Smoke output | ✅ PASS | All 6 spec fields present: `totalChanges`, `validChanges`, `changesWithErrors`, `changesWithWarnings`, `totalErrors`, `totalWarnings`. |
| REQ-cli-001: JSON output — success | Smoke + unit test | ✅ PASS | `--json` → pure JSON to stdout, exit 0. |
| REQ-cli-002: JSON output — errors present | Unit test | ✅ PASS | Exit code 1 for errors. |
| REQ-cli-003: JSON output — runtime failure | Smoke + unit tests | ✅ PASS | `--change does-not-exist` → exit 2. |
| REQ-cli-004: Warnings only → exit 0 | Unit test | ✅ PASS | Exit code 0 for warnings-only. |
| REQ-cli-005: Human-readable output | Unit test | ✅ PASS | Without `--json` → human-readable. |
| REQ-cli-006: stdout/stderr separation | Smoke test | ✅ PASS | stdout=JSON, stderr=0 bytes. |
| REQ-cli-007: CLI parser tests | `bun test cli-args.test.ts` | ✅ PASS | 46/46 pass (incl. 14 openspec-validate cases). |
| REQ-doc-001: Schema documentation exists | File inspection | ✅ PASS | `openspec/registry-schema.md` present; documents both schemas. |
| MAJOR-1: Duplicate key scoped per map | Source `yaml.ts:128` | ✅ PASS | `seen` inside per-MAP branch. |
| MAJOR-2: Provenance legacy_shape reachable | Source `validator.ts:459-470` | ✅ PASS | Object check precedes array check. |
| MAJOR-3: Summary JSON spec-compliant | Smoke output | ✅ PASS | All 6 spec fields present. |
| MAJOR-4: Issue field `rule` | Smoke output | ✅ PASS | JSON uses `rule` not `code`. |
| MAJOR-5: ValidationRuleCode type used | `types.ts:228` | ✅ PASS | DTO `rule: ValidationRuleCode`. |
| MAJOR-6: YAML codes in ValidationRuleCode | `schema.ts` + `tsc --noEmit` | ✅ PASS | Three codes in type union + array; no TS errors. |

## Findings

### CRITICAL
None.

### WARNING
- **W1 — Pre-existing typecheck errors in pi-launch-command.ts.** The CLI package has 5 typecheck errors in `pi-launch-command.ts` and `pi-launch-command.direct-supermemory.test.ts`. These are **unrelated to this change** (pre-existing). The scoped typecheck for changed files (core/spec-registry + CLI/openspec-validate-command) passes cleanly.

### SUGGESTION
- **S1 — Consider adding YAML parser unit tests.** The `yaml.ts` file does not have a dedicated `yaml.test.ts` file. While YAML parsing is covered indirectly through validator tests (e.g., "malformed YAML handled gracefully"), explicit unit tests for the parser would improve coverage and documentation.

## Open Questions

None.

## Registry Intent (deferred)

**Registry Write**: deferred (registry-deferred mode)
**Registry Intent**: 
- Artifact: `verify-report.md`
- Phase: `verify`
- Status: `passed`
- Event: `verify.completed`

**Registry Blocker**: none

---

**Verification completed**: 2026-06-12
**Verifier**: Verify Agent (deck-developer-verify)
**Mode**: REGISTRY-DEFERRED
