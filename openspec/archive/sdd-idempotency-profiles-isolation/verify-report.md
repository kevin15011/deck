# Verify Report: SDD Idempotency, Profiles, and Pipeline Isolation

## Summary

**Overall Result**: FAIL  
**Tasks Complete**: 13 / 13 claimed complete  
**Tests**: affected suites 193 / 193 passed; full suite 1565 / 1595 passed  
**Build**: N/A — no build script  
**Typecheck**: FAIL — `bunx tsc --noEmit` exits 2

## Task Completion

| Task | Status | Owner |
|---|---:|---|
| Tasks 1-13 | ✅ Complete claimed | Apply |

## Test Results

| Test Suite | Pass | Fail | Skip |
|---|---:|---:|---:|
| `packages/adapter-pi/src/developer-team-install.test.ts` | 61 | 0 | 0 |
| `packages/adapter-opencode/src/developer-team-install.test.ts` | 42 | 0 | 0 |
| `packages/core/src/config/deck-config.test.ts` | 63 | 0 | 0 |
| `packages/sdd-runtime/src/orchestrator/orchestrator-pipeline.test.ts` | 27 | 0 | 0 |
| Full `bun test` | 1565 | 30 | 0 |

## Build / Typecheck

| Check | Result | Details |
|---|---|---|
| Build | ⚠️ N/A | Root `package.json` has no build script. |
| Typecheck | ❌ FAIL | 19 TS errors. SDD profile fallout appears fixed, but typecheck still fails in `packages/adapter-opencode`, `packages/adapter-supermemory`, and tests. |

## Compliance Matrix

| REQ-ID / Scenario | Method | Result | Notes |
|---|---|---|---|
| REQ-IDEM-001 | Code + typecheck | ✅ PASS | `DeveloperTeamApplyResult` includes `changedCount` / `unchangedCount`. |
| REQ-IDEM-002 | Code + tests | ✅ PASS | OpenCode result includes counts. |
| REQ-IDEM-003 | Tests | ✅ PASS | Created/updated/added counted as changed. |
| REQ-IDEM-004 | Tests | ✅ PASS | Unchanged status counted as unchanged. |
| REQ-IDEM-005 | Tests | ✅ PASS | Second apply returns `changedCount === 0`. |
| REQ-IDEM-006 | Tests | ✅ PASS | OpenCode config merge contributes to counts. |
| REQ-IDEM-007 | Tests | ✅ PASS | Existing `results` shape/statuses preserved. |
| REQ-PROF-001 | Code + tests | ✅ PASS | `Profile` / strategy / phase override types defined. |
| REQ-PROF-002 | Code + tests | ✅ PASS | `DeckConfig.profiles?: Profile[]`. |
| REQ-PROF-003 | Code + tests | ✅ PASS | `NormalizedDeckConfig.profiles` and `activeProfile` present with defaults. |
| REQ-PROF-004 | Tests | ✅ PASS | Duplicate names rejected. |
| REQ-PROF-005 | Tests | ✅ PASS | Unknown phase keys rejected. |
| REQ-PROF-006 | Tests | ✅ PASS | Default implicit behavior covered. |
| REQ-PROF-007 | Tests | ✅ PASS | Profile persistence round-trip covered. |
| REQ-PROF-008 | Tests | ✅ PASS | Unknown active profile rejected with available names. |
| REQ-PROF-009 | Tests | ✅ PASS | Pipeline accepts profile and applies overrides. |
| REQ-PROF-010 | Code + tests | ✅ PASS | Valid phase list matches spec. |
| REQ-ISO-001 | Code + tests | ✅ PASS | `stageErrors` present; empty on success. |
| REQ-ISO-002 | Code + tests | ✅ PASS | `StageError` fields present. |
| REQ-ISO-003 | Tests | ⚠️ WARN | Throw/catch covered; explicit invalid-return coverage not proven. |
| REQ-ISO-004 | Tests | ✅ PASS | Report-only executes stages despite failures. |
| REQ-ISO-005 | Tests | ✅ PASS | StageConfig isolation covered. |
| REQ-ISO-006 | Tests | ✅ PASS | Enforced invalid audit remains blocked. |
| REQ-ISO-007 | Tests | ⚠️ WARN | Partial outcome covered; non-audit non-recoverable path not clearly isolated. |

## Findings

### CRITICAL

- Typecheck fails: `bunx tsc --noEmit` exits 2. First errors: missing `@deck/adapter-supermemory`, invalid async mock shapes in `packages/adapter-opencode/src/developer-team-install.test.ts`, and `adapter-supermemory` test type errors.
- Full suite fails: `bun test` exits 1 with 30 failures across 7 files. Breakdown: `deck-config.test.ts` 14, `pi-runner-dashboard/action-runner.test.ts` 9, `pi-runner-dashboard/reducer.test.ts` 3, plus 1 each in `pi-launch-command.supermemory.test.ts`, `developer-team-flow.test.tsx`, `tui-boundary-audit.test.ts`, `quality-router.test.ts`.

### WARNING

- REQ-ISO-003 invalid-return isolation is not clearly verified.
- REQ-ISO-007 non-audit non-recoverable partial outcome is not clearly verified.

### SUGGESTION

- Add direct tests for invalid stage return and non-audit non-recoverable stage failure.

## Open Questions

- Are the 30 full-suite failures accepted as pre-existing? Current verification still blocks unless waived.
