# Archive Report: add-serena-package

## Change Summary

**Change**: add-serena-package
**Status**: ✅ Archived
**Archive Location**: `openspec/archive/add-serena-package/`

### Lifecycle
- **Proposal**: 2026-05-28 — Add Serena MCP package to Deck harness
- **Spec + Design**: 2026-05-28 — 35 requirements, 18 files affected
- **Tasks**: 2026-05-28 — 12 tasks in 4 groups
- **Apply**: 2026-05-28 — All 12 tasks completed
- **Verify**: 2026-05-28 — PASS — all requirements verified
- **Review**: 2026-05-28 — APPROVE — zero findings
- **Archive**: 2026-05-28 — archived

## Traceability Matrix

| REQ-ID | Task | Implementation | Verify Result | Review Rating |
|---|---|---|---|---|
| REQ-SIB-001 | T1.1 | ✅ serena.ts:22-120 | ✅ PASS | ✅ Strong |
| REQ-SIB-002 | T1.1 | ✅ packageId: "serena" | ✅ PASS | ✅ Strong |
| REQ-SIB-003 | T1.1 | ✅ 15 enabled tools | ✅ PASS | ✅ Strong |
| REQ-SIB-004 | T1.1 | ✅ 13 disabled tools | ✅ PASS | ✅ Strong |
| REQ-SIB-005 | T1.1 | ✅ coexistence rules | ✅ PASS | ✅ Strong |
| REQ-SIB-006 | T1.1 | ✅ skill fragment | ✅ PASS | ✅ Strong |
| REQ-SIB-007 | T1.1 | ✅ markdown >50 chars | ✅ PASS | ✅ Strong |
| REQ-SIB-008 | T1.1 | ✅ Object.freeze() | ✅ PASS | ✅ Strong |
| REQ-PIR-001 | T1.2 | ✅ index.ts:27 | ✅ PASS | ✅ Strong |
| REQ-PIR-002 | T1.2 | ✅ PACKAGE_BUILDERS | ✅ PASS | ✅ Strong |
| REQ-PIR-003 | T1.2 | ✅ PACKAGE_ORDER | ✅ PASS | ✅ Strong |
| REQ-PIR-004 | T1.2 | ✅ composition | ✅ PASS | ✅ Strong |
| REQ-PIR-005 | T1.2 | ✅ getEnabledPkgIds | ✅ PASS | ✅ Strong |
| REQ-DC-001 | T1.3 | ✅ deck-config.ts | ✅ PASS | ✅ Strong |
| REQ-DC-002 | T1.3 | ✅ FIELD set | ✅ PASS | ✅ Strong |
| REQ-DC-003 | T1.3 | ✅ default false | ✅ PASS | ✅ Strong |
| REQ-DC-004 | T1.3 | ✅ getDefaultDeck | ✅ PASS | ✅ Strong |
| REQ-DC-005 | T1.3 | ✅ validate bool | ✅ PASS | ✅ Strong |
| REQ-DC-006 | T1.3 | ✅ reject invalid | ✅ PASS | ✅ Strong |
| REQ-TUI-001 | T2.1 | ✅ state.ts | ✅ PASS | ✅ Strong |
| REQ-TUI-002 | T2.1 | ✅ default true | ✅ PASS | ✅ Strong |
| REQ-TUI-003 | T2.2 | ✅ input-handler | ✅ PASS | ✅ Strong |
| REQ-TUI-004 | T2.4 | ✅ selectors | ✅ PASS | ✅ Strong |
| REQ-TUI-005 | T2.3 | ✅ action-runner | ✅ PASS | ✅ Strong |
| REQ-TUI-006 | T2.3 | ✅ reducer | ✅ PASS | ✅ Strong |
| REQ-DOC-001 | T3.1 | ✅ diagnostics | ✅ PASS | ✅ Strong |
| REQ-DOC-002 | T3.1 | ✅ warning status | ✅ PASS | ✅ Strong |
| REQ-DOC-003 | T3.1 | ✅ isolation | ✅ PASS | ✅ Strong |
| REQ-RC-001 | T4.1 | ✅ config.json | ✅ PASS | ✅ Strong |
| REQ-TP-001 | T4.3 | ✅ bundle-parity | ✅ PASS | ✅ Strong |
| REQ-TP-002 | T4.3 | ✅ index test | ✅ PASS | ✅ Strong |
| REQ-TP-003 | T4.2 | ✅ serena.test.ts | ✅ PASS | ✅ Strong |
| REQ-TP-004 | T4.4 | ✅ reducer test | ✅ PASS | ✅ Strong |
| REQ-CR-001 | T1.1 | ✅ codebase-memory | ✅ PASS | ✅ Strong |
| REQ-CR-002 | T1.1 | ✅ serena usage | ✅ PASS | ✅ Strong |
| REQ-CR-003 | T1.1 | ✅ no overlap | ✅ PASS | ✅ Strong |

## Verification

**Result**: PASS
**Critical Findings**: 0
**Warnings**: 1 (bundle-parity hash discrepancy — non-blocking, test passes)

## Review

**Rating**: APPROVE
**Blockers**: 0
**Major Findings**: 0
**Findings**: None — zero issues identified

## Implementation Summary

| Group | Tasks | Files Changed |
|---|---|---|
| G1 Core | T1.1, T1.2, T1.3 | serena.ts, index.ts, deck-config.ts |
| G2 TUI | T2.1, T2.2, T2.3, T2.4 | state.ts, input-handler.ts, action-runner.ts, selectors.ts |
| G3 Doctor | T3.1 | doctor-diagnostics.ts |
| G4 Config+Tests | T4.1, T4.2, T4.3, T4.4 | .deck/config.json, serena.test.ts, bundle-parity.test.ts, index.test.ts, reducer.test.ts |

## Modified Files

| File | Action |
|---|---|
| `packages/core/src/teams/developer/instruction-bundles/serena.ts` | create |
| `packages/core/src/teams/developer/instruction-bundles/index.ts` | modify |
| `packages/core/src/config/deck-config.ts` | modify |
| `packages/adapter-opencode/src/installation-plan.ts` | modify |
| `packages/adapter-opencode/src/capability-catalog.ts` | modify |
| `packages/adapter-opencode/src/capability-plan.ts` | modify |
| `apps/cli/src/tui/runner-dashboard/state.ts` | modify |
| `apps/cli/src/tui/runner-dashboard/input-handler.ts` | modify |
| `apps/cli/src/tui/runner-dashboard/action-runner.ts` | modify |
| `apps/cli/src/tui/runner-dashboard/selectors.ts` | modify |
| `apps/cli/src/doctor-command/doctor-diagnostics.ts` | modify |
| `.deck/config.json` | modify |
| `packages/core/src/teams/developer/instruction-bundles/serena.test.ts` | create |
| `packages/core/src/teams/developer/instruction-bundles/bundle-parity.test.ts` | modify |
| `packages/core/src/teams/developer/instruction-bundles/index.test.ts` | modify |
| `apps/cli/src/tui/runner-dashboard/reducer.test.ts` | modify |

## Follow-ups

**None** — change is fully closed. All requirements verified, review approved, no open questions.

## Project AI Notes (Phase 5 — Deferred)

> Project AI notes are a planned Phase 5 feature under `.deck/ai-notes/`. Not yet active.

### Extracted Learnings

- **Coexistence pattern**: Serena + codebase-memory coexistence rules documented in instruction bundle markdown prevent tool confusion. This pattern should be replicated for future package additions.
- **Testing strategy**: Bundle parity tests use hash baselines. Non-blocking warning about hash discrepancy noted (apply-progress had stale value, test file had correct value).
- **MCP config isolation**: Local MCP servers (context7, serena) use command arrays, remote MCP uses token. Separate branches in action-runner for type safety.

## Git Suggestion Context

- **Conventional commit type**: `feat` — adds new capability
- **Scope**: adapter-opencode, cli-tui, core-teams
- **Key changes**:
  - New `serena` package instruction bundle
  - TUI capability toggle + MCP config write
  - OpenCode adapter capability catalog entry
  - Doctor diagnostics for Serena binary
- **Ambiguity notes**: Could also be `refactor` if treating as reconfiguration, but `feat` is accurate since new tools exposed to agents.