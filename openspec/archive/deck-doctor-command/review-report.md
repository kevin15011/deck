# Review Report: deck-doctor-command

## Summary

**Overall Rating**: APPROVE
**Scope**: general, backend
**Files Reviewed**: 3

## Ratings by Dimension

| Dimension | Rating | Notes |
|---|---|---|
| Architecture | ✅ Strong | Clean orchestrator pattern with isolated, wrapped sub-checks. Each runtime and provider is handled independently. |
| Security | ✅ Strong | Credential redaction (`redact`, `redactDiagnostic`) applied consistently. Tests verify no Bearer/API key exposure in serialized output. |
| Scalability | ✅ Strong | Synchronous checks avoid async waterfall. Error isolation prevents cascade failures. |
| Maintainability | ✅ Strong | Well-typed, well-commented, requirement references (REQ-DIAG-007/008/009) inline. Test helpers reduce duplication. |
| Code Quality | ✅ Strong | Good naming, clear separation of concerns, consistent patterns. |
| Backend | ✅ Strong | Defensive fs operations, cross-platform PATH handling, structured result contract. |
| Frontend | N/A | No frontend changes. |
| Integration | ✅ Strong | Mock completeness restored; adapters (`@deck/adapter-pi`, `@deck/adapter-opencode`) integrate cleanly. |

## Findings

### BLOCKER
None.

### MAJOR
None.

### MINOR
- **Maintainability**: `redactDiagnostic` test mock (line 18–26) mutates the input object in place. If the real implementation is pure (returns a new object), the mock behavior diverges. Consider making the mock return a shallow copy to avoid hidden test coupling.
  - **File**: `apps/cli/src/__tests__/doctor-diagnostics.test.ts` — lines 18–26
  - **Evidence**: `diag.message = diag.message.replace(...)` mutates `d` directly.
  - **Recommendation**: Return `{ ...d, message: redactedMessage }` instead of mutating `d`.

### NIT
- **Code Quality**: The Engram test (lines 158–184) hardcodes `/tmp/engram` and a Unix-style `PATH`, which will fail on native Windows test runs. The production code correctly handles Windows (`delimiter`, `.exe` suffix), but the test itself is not portable.
  - **File**: `apps/cli/src/__tests__/doctor-diagnostics.test.ts` — lines 158–184
  - **Recommendation**: Skip or parameterize the test on Windows, or use `os.tmpdir()` and `path.join`.

## Design Fidelity

Does the implementation match the Design artifact?
- **Aligned**: Yes (inferred from code structure and requirement references)
- **Deviations**: None observed.

## Open Questions

None.
