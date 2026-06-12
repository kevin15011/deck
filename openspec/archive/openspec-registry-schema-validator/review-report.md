# Review Report: OpenSpec Registry Schema Canonical + Validator Read-Only (Final)

## Summary

**Overall Rating**: APPROVE WITH WARNINGS
**Scope**: general
**Files Reviewed**: 10 (yaml.ts, validator.ts, schema.ts, types.ts, index.ts, openspec-validate-command.ts, cli-args.ts, validator.test.ts, openspec-validate-command.test.ts, registry-schema.md)
**Review Type**: Final review — post-fix verification of 5 original MAJORs + MAJOR-6 + CLI summary fields

## Fix Batch Assessment — All Items

| # | Finding | Status | Verification |
|---|---|---|---|
| 1 | MAJOR: Duplicate key detection uses global `seen` Set | ✅ Fixed | `seen` created inside `if (n.type === "MAP")` block in `yaml.ts`. Each MAP node gets its own Set. Correct per-map scoping. |
| 2 | MAJOR: Dead code in provenance legacy_shape check | ✅ Fixed | Object-form check (`typeof === "object" && !Array.isArray(...)`) now precedes array check in `validator.ts`. `legacy_shape` warning is reachable. |
| 3 | MAJOR: Summary JSON fields diverge from spec REQ-val-012 | ✅ Fixed | All 6 spec-mandated fields present in `validator.ts:147-166`: `totalChanges`, `validChanges`, `changesWithErrors`, `changesWithWarnings`, `totalErrors`, `totalWarnings`. Extra fields (`totalActiveChanges`, `totalArchivedChanges`) are additive. |
| 4 | MAJOR: Issue field `code` vs spec `rule` | ✅ Fixed | Core DTO uses `rule: ValidationRuleCode` in `types.ts`. All validator emissions use `rule:`. CLI adapter's success path uses `rule:`. See MINOR-1 for residual in error fallbacks. |
| 5 | MAJOR: ValidationRuleCode type safety | ✅ Fixed | DTO field `rule` typed as `ValidationRuleCode`. Union expanded with all required codes. |
| 6 | MAJOR-6: YAML diagnostic codes not in ValidationRuleCode | ✅ Fixed | `yaml.parse_error`, `yaml.parse_warning`, `yaml.duplicate_key` added to both the type union and `VALIDATION_RULE_CODES` runtime array in `schema.ts`. `tsc --noEmit` passes for spec-registry files. |
| 7 | CLI summary field names | ✅ Fixed | CLI adapter error fallbacks use spec-aligned field names (`totalChanges`, `totalErrors`, `totalWarnings`, `validChanges`, `changesWithErrors`, `changesWithWarnings`). Human output render uses new field names. |

## Ratings by Dimension

| Dimension | Rating | Notes |
|---|---|---|
| Architecture | ✅ Strong | Clean boundaries: yaml adapter encapsulated, validator read-only, CLI adapter thin. Module separation matches design. |
| Security | ✅ Strong | Read-only guarantee maintained. No mutation paths. No secrets or credentials exposed. |
| Scalability | ✅ Strong | Linear traversal of changes/archive dirs. No N+1 patterns. Summary computed in single pass. |
| Maintainability | ✅ Strong | Type system is now consistent. `ValidationRuleCode` union covers all emitted codes. DTOs well-documented with JSDoc. |
| Code Quality | ✅ Strong | Naming is clear and consistent. Comments explain non-obvious decisions (e.g., provenance check ordering). No duplication. |
| Backend | ✅ Strong | N/A — not an API change. Validator function contract is clean. |
| Frontend | N/A | Not in scope. |
| Integration | ✅ Strong | CLI routing through `main.tsx` is clean. JSON output shape matches spec. Error fallbacks are consistent (see MINOR-1). |

## Findings

### BLOCKER
None.

### MAJOR
None. All 6 previous MAJORs are verified fixed.

### MINOR

- **MINOR-1 — Code Quality: CLI adapter error fallbacks use `code` instead of `rule`**
  - **File**: `apps/cli/src/openspec-validate-command.ts` — lines 70, 170
  - **Evidence**: Two manually-constructed error fallback JSON objects use `code: "runtime.error"` instead of `rule: "runtime.error"`. Line 70 (root not found) and line 170 (catch-all exception). The core validator DTO was fixed (MAJOR-4) but these CLI-level fallback objects were not updated.
  - **Impact**: Low. These paths only execute on runtime failures (exit 2). The JSON output is inconsistent with the `rule` field name used everywhere else and mandated by REQ-val-005. Agents parsing error output may need to handle both field names.
  - **Recommendation**: Change `code: "runtime.error"` to `rule: "runtime.error"` on lines 70 and 170 of `openspec-validate-command.ts`. One-word change, two locations.

- **MINOR-2 (Carried) — Previous deferred MINORs from first review**
  - Five design rules not implemented (deferred to follow-up).
  - Severity differentiation canonical/legacy for `name_mismatch` and `duplicate_key`.
  - Paths absolute vs repo-relative inconsistency.
  - `mode` option declared in types but not wired in validator logic.
  - **Impact**: Low. These are documented deferrals and do not affect the core validation contract.

### NIT
None.

## Design Fidelity

Does the implementation match the Design artifact?
- **Aligned**: Yes (with minor deferrals)
- **Deviations**: The remaining deviations are the carried MINOR-2 items, all of which are documented deferrals to follow-up changes. The core architecture, data flow, API contract, CLI design, and rules list from the Design artifact are faithfully implemented.

## Test Results

- **Core validator tests**: 11/11 pass ✅
- **CLI adapter tests**: 7/7 pass ✅
- **TypeScript typecheck**: No errors in spec-registry or openspec-validate-command files ✅
- Pre-existing typecheck errors in unrelated files (`tui/app.tsx`, `pi-launch-command.ts`, `runtime/process.ts`) are not part of this change.

## Positive Observations

- All 6 previous MAJOR fixes are logically correct and well-scoped.
- The YAML diagnostic code fix (MAJOR-6) chose the simpler approach (adding generic codes to the union) which is pragmatic and avoids call-site mapping complexity.
- The provenance check restructure (MAJOR-2) is clean and the ordering logic is well-commented.
- Summary computation (MAJOR-3) adds useful extra fields without breaking spec compliance.
- The `rule` rename (MAJOR-4) was applied consistently across all 30+ emission sites in the validator.
- CLI summary field names are now fully spec-aligned per REQ-val-012.
- Test coverage is solid: canonical pass, missing fields, invalid enums, malformed YAML, phase consistency, artifact alignment, legacy drift, empty project, closure reasons.

## Open Questions

None.

---

**Review Conclusion**: All 5 original MAJOR findings plus MAJOR-6 and CLI summary fields are correctly fixed. TypeScript compiles cleanly for all changed files. All 18 tests pass. One new MINOR found (CLI adapter `code` vs `rule` in two error fallback paths) — trivial one-word fix, non-blocking. The change is ready for approval and can proceed to Archive.
