# Archive Report: Comando `deck doctor`

## Change Summary

**Change**: `deck-doctor-command`
**Name**: Comando `deck doctor` — Environment diagnostics CLI command
**Status**: ✅ Archived
**Archive Location**: `openspec/archive/deck-doctor-command/`

### Lifecycle
- **Proposal**: 2026-05-23 — Environment diagnostics command to detect runtimes, verify packages, diagnose memory providers and MCPs
- **Spec + Design**: 2026-05-23 — 23 requirements (17 MUST, 4 SHOULD), 17 acceptance scenarios, orchestrator + report architecture
- **Tasks**: 2026-05-23 — 9 atomic tasks: Shared/Contracts (2), Backend (2), General CLI/Reporting (2), Tests (3)
- **Apply**: 2026-05-23 — All 9 tasks completed by 2 agents (General + Backend)
- **Verify**: 2026-05-23 — PASS, 57 tests passing, all requirements met
- **Review**: 2026-05-23 — APPROVE, all dimensions rated Strong
- **Archive**: 2026-05-23 — Archived, all artifacts preserved

## Traceability Matrix

| REQ-ID | Task | Implementation | Verify Result | Review Rating |
|---|---|---|---|---|
| REQ-CLI-001 | T5 (CLI args) | ✅ `doctor` command recognized | ✅ PASS | ✅ Strong |
| REQ-CLI-002 | T5 (CLI args) | ✅ Unsupported flags rejected | ✅ PASS | ✅ Strong |
| REQ-CLI-003 | T6 (main routing) | ✅ No TUI launch | ✅ PASS | ✅ Strong |
| REQ-CLI-004 | T6 (main routing) | ✅ No runtime launch | ✅ PASS | ✅ Strong |
| REQ-DIAG-001 | T3 (diagnostics) | ✅ Detect Pi runtime | ✅ PASS | ✅ Strong |
| REQ-DIAG-002 | T3 (diagnostics) | ✅ Verify Pi packages | ✅ PASS | ✅ Strong |
| REQ-DIAG-003 | T3 (diagnostics) | ✅ Detect Claude runtime | ✅ PASS | ✅ Strong |
| REQ-DIAG-004 | T3 (diagnostics) | ✅ Detect Codex runtime | ✅ PASS | ✅ Strong |
| REQ-DIAG-005 | T3 (diagnostics) | ✅ Detect memory providers | ✅ PASS | ✅ Strong |
| REQ-DIAG-006 | T3 (diagnostics) | ✅ Diagnose MCPs | ✅ PASS | ✅ Strong |
| REQ-DIAG-007 | T3 (diagnostics) | ✅ Sub-check isolation | ✅ PASS | ✅ Strong |
| REQ-DIAG-008 | T3 (diagnostics) | ✅ Structured result object | ✅ PASS | ✅ Strong |
| REQ-DIAG-009 | T3 (diagnostics) | ✅ No credential exposure | ✅ PASS | ✅ Strong |
| REQ-DIAG-010 | T3 (diagnostics) | ✅ Diagnostic wrapped | ✅ PASS | ✅ Strong |
| REQ-RPT-001 | T4 (report formatter) | ✅ Status icons (✓/⚠/✗) | ✅ PASS | ✅ Strong |
| REQ-RPT-002 | T4 (report formatter) | ✅ Actionable suggestions | ✅ PASS | ✅ Strong |
| REQ-RPT-003 | T4 (report formatter) | ✅ Color-coded output | ✅ PASS | ✅ Strong |
| REQ-RPT-004 | T4 (report formatter) | ✅ Non-TTY output plain | ✅ PASS | ✅ Strong |
| REQ-RPT-005 | T4 (report formatter) | ✅ TTY output colored | ✅ PASS | ✅ Strong |
| REQ-NF-001 | T1-T9 | ✅ No unhandled exceptions | ✅ PASS | ✅ Strong |
| REQ-NF-002 | T4 (report formatter) | ✅ Exit code 1 on errors | ✅ PASS | ✅ Strong |
| REQ-NF-003 | T3 (diagnostics) | ✅ No user interaction | ✅ PASS | ✅ Strong |
| REQ-NF-004 | T3 (diagnostics) | ✅ Synchronous checks | ✅ PASS | ✅ Strong |

**Summary**: 23/23 requirements implemented and verified

## Files Created

| File | Description | Lines |
|---|---|---|
| `apps/cli/src/doctor-command/types.ts` | Shared types for diagnostics | ~150 |
| `apps/cli/src/doctor-command/doctor-diagnostics.ts` | Diagnostics orchestrator | ~350 |
| `apps/cli/src/doctor-command/doctor-report.ts` | Report formatter + exit code logic | ~120 |
| `apps/cli/src/doctor-command/index.ts` | Barrel export | ~15 |
| `apps/cli/src/__tests__/doctor-diagnostics.test.ts` | Unit tests (13 tests) | ~400 |
| `apps/cli/src/__tests__/doctor-report.test.ts` | Unit tests (7 tests) | ~180 |

## Files Modified

| File | Changes |
|---|---|
| `apps/cli/src/cli-args.ts` | Added `doctor` command to argument parser |
| `apps/cli/src/main.tsx` | Added routing for `doctor` command |
| `packages/adapters/pi/src/pi-mcp-config.ts` | Exported redact functions for credential hiding |

## Verification

**Result**: ✅ PASS
**Tests**: 57 tests passing (13 diagnostics + 7 report + 37 existing)
**Build/Typecheck**: ✅ No errors
**Critical Findings**: 0
**Warnings**: 0
**Suggestions**: 3 minor (not blockers)

## Review

**Rating**: ✅ APPROVE
**Blockers**: 0
**Major Findings**: 0
**Minor Findings**: 4
**Nits**: 4

### Review Dimensions (all Strong)
- Architecture: Clean orchestrator pattern, isolated wrapped sub-checks
- Security: Credential redaction applied consistently (`redact`, `redactDiagnostic`)
- Scalability: Synchronous checks, error isolation prevents cascade failures
- Maintainability: Well-typed, requirement references inline, test helpers reduce duplication
- Code Quality: Good naming, clear separation of concerns
- Integration: Mock completeness restored, adapters integrate cleanly

## Follow-ups

None — change is fully closed.

### Suggestions from Review (non-blocking)
1. Minor: Consider adding `--json` flag for machine-readable output (future enhancement)
2. Minor: Add `--fix` flag hint in suggestions (future enhancement)
3. Minor: Document known false positives in MCP detection (documentation)
4. Minor: Consider caching diagnostic results (performance)

## Project AI Notes (Phase 5 — Deferred)

> Project AI notes are a planned Phase 5 feature under `.deck/ai-notes/`. Not yet active.

### Extracted Learnings

- **Pattern**: Barrel exports for sub-modules (`index.ts` re-exporting public API) is the convention
- **Pattern**: Diagnostic checks should be wrapped to prevent cascade failures (REQ-DIAG-007)
- **Pattern**: Credential redaction should happen at serialization boundaries, not source
- **Convention**: Test helpers should reduce duplication via factory functions
- **Security**: All serialized output must be scanned for credential exposure

## Git Suggestion Context

**Conventional commit type**: `feat(cli)`
**Scope**: CLI environment diagnostics
**Key changes**:
- Add `deck doctor` command for environment diagnostics
- Detect installed runtimes (Pi, Claude, Codex)
- Verify Pi required packages and tools
- Diagnose memory providers (Engram, Supermemory)
- Validate MCP configurations
- Structured report with color-coded output
- TTY/non-TTY detection for formatting
**Ambiguity notes**: None — clear feature addition

## Provenance

| Agent | Action | Phase | Timestamp |
|---|---|---|---|
| deck-developer-proposal | create | proposal | 2026-05-23T00:00:00Z |
| deck-developer-spec | create | spec | 2026-05-23T00:00:00Z |
| deck-developer-design | create | design | 2026-05-23T00:00:00Z |
| deck-developer-task | create | tasks | 2026-05-23T00:00:00Z |
| deck-developer-apply-general | apply | apply | 2026-05-23T00:00:00Z |
| deck-developer-apply-backend | apply | apply | 2026-05-23T00:00:00Z |
| deck-developer-verify | verify | verify | 2026-05-23T00:00:00Z |
| deck-developer-review | review | review | 2026-05-23T00:00:00Z |
| deck-developer-archive | archive | archive | 2026-05-23T00:00:00Z |

---

**Archive completed**: 2026-05-23
