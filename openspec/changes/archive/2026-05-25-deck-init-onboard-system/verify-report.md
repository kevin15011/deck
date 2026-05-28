# Verify Report: deck-init-onboard-system

## Summary

**Overall Result**: FAIL  
**Tasks Complete**: 9 / 9  
**Tests**: 1171 / 1172 passed  
**Build**: fail  
**Typecheck**: not separately run; requested `bun build --no-typecheck` check failed before compiling

## Task Completion

| Task | Status | Owner |
|---|---|---|
| Task 1: Bootstrap Skill Registry | ✅ Complete | General Apply |
| Task 2: Init-State Reader | ✅ Complete | General Apply |
| Task 3: OpenCode Adapter Inject | ✅ Complete | Backend Apply |
| Task 4: PI Adapter Inject | ✅ Complete | Backend Apply |
| Task 5: Orchestrator Init Gate | ✅ Complete | Backend Apply |
| Task 6: Write deck-init Skill Content | ✅ Complete | General Apply |
| Task 7: Write deck-onboard Skill Content | ✅ Complete | General Apply |
| Task 8: Orchestrator Prompt Rule | ✅ Complete | General Apply |
| Task 9: Integration Tests | ❌ Failed verification | Verify |

## Test Results

| Test Suite | Pass | Fail | Skip |
|---|---:|---:|---:|
| `packages/sdd-runtime/src/orchestrator/init-state.test.ts` | 5 | 0 | 0 |
| `packages/sdd-runtime/src/orchestrator/orchestrator-pipeline.test.ts` | 31 | 0 | 0 |
| `packages/adapter-opencode/` | 144 | 0 | 0 |
| `packages/adapter-pi/` | 348 | 0 | 0 |
| `packages/core/` | 639 | 1 | 0 |
| `packages/core/src/skills/bootstrap/index.test.ts` | 4 | 0 | 0 |

## Build / Typecheck

| Check | Result | Details |
|---|---|---|
| `bun build --no-typecheck` | ❌ FAIL | `error: Missing entrypoints. What would you like to bundle?` |
| Typecheck | ⚠️ WARN | No separate typecheck command was requested; build check failed before a useful compile result. |

## Compliance Matrix

| REQ-ID / Scenario | Method | Result | Notes |
|---|---|---|---|
| REQ-init-001..011 / init-state + init behavior | `init-state.test.ts` + core content tests | ✅ PASS | Init-state reader suite passed. |
| REQ-init-012 / deck-init frontmatter | New bootstrap registry test | ✅ PASS | YAML frontmatter parsed; required fields present. |
| REQ-onboard-001 / deck-onboard frontmatter | New bootstrap registry test | ✅ PASS | YAML frontmatter parsed; `user-invocable: true`. |
| REQ-onboard-002..007 / onboarding content | `packages/core/` content tests | ❌ FAIL | Core package suite failed before full package pass. |
| REQ-triage-001..004 / orchestrator init gate | `orchestrator-pipeline.test.ts` | ✅ PASS | 31/31 passed. |
| Task 3 adapter inject | `bun test packages/adapter-opencode/` | ✅ PASS | 144/144 passed. |
| Task 4 adapter inject | `bun test packages/adapter-pi/` | ✅ PASS | 348/348 passed. |
| Task 9 bootstrap registry | `packages/core/src/skills/bootstrap/index.test.ts` | ✅ PASS | 4/4 passed; exactly 2 entries; no `..`; valid frontmatter. |
| Build / compile check | `set -o pipefail; bun build --no-typecheck 2>&1 \| head -50` | ❌ FAIL | Missing entrypoints. |

## Findings

### CRITICAL
- `bun test packages/core/` fails: core purity audit reports forbidden concrete provider/runner string literals in non-test core source:
  - `skills/bootstrap/deck-init-content.ts:31` contains `engram` in `Use OpenSpec only - no Engram persistence.`
  - `skills/bootstrap/deck-init-content.ts:108` contains `opencode` in `.opencode/skills/`
- Build check fails with pipefail: `bun build --no-typecheck` exits 1 because no entrypoints were provided.

### WARNING
- Requested shell pipeline without `pipefail` masks the `bun build` failure because `head` exits 0.

### SUGGESTION
- None.

## Open Questions

None.
