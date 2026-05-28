# Archive Report: Orchestrator Personality Selector

## Change Summary

**Change**: orchestrator-personality-selector
**Status**: ✅ Archived
**Archive Location**: `openspec/archive/orchestrator-personality-selector/`

### Lifecycle
- **Proposal**: 2026-05-24 — Add orchestrator personality selection (Guía, Pragmática, Ahorro extremo) to TUI install flow, persist to config, affect pipeline output verbosity
- **Spec + Design**: 2026-05-24 — Parallel; 26 requirements across 4 capabilities; clean architecture with pure formatter boundary
- **Tasks**: 2026-05-24 — 9 tasks across 3 groups (Shared/Contracts, Backend, Frontend)
- **Apply**: 2026-05-24 — 8 of 9 tasks completed (Tasks 1–8); Task 9 (TUI render/routing tests) remains pending
- **Verify**: 2026-05-24 — FAIL (typecheck error in `action-runner.ts`, `bun run build` script missing, full test suite has 18 failures, Task 9 incomplete)
- **Review**: 2026-05-24 — APPROVE WITH CHANGES (1 Major: override context dropped in skipReason; 4 Minor findings; 2 Nits)
- **Archive**: 2026-05-24 — Archived with documented follow-ups; Task 9 and override bug remain open

## Traceability Matrix

| REQ-ID | Task(s) | Implementation | Verify Result | Review Rating |
|---|---|---|---|---|
| REQ-SEL-001 | Task 8 | ✅ TUI routes to personality after env selection | ✅ PASS | Strong |
| REQ-SEL-002 | Task 8 | ✅ Three options: Guía, Pragmática, Ahorro extremo | ✅ PASS | Strong |
| REQ-SEL-003 | Task 8 | ✅ Each option has name + one-line hint | ✅ PASS | Strong |
| REQ-SEL-004 | Task 8 | ✅ Persistente disclaimer about Ahorro extremo trade-offs | ✅ PASS | Strong |
| REQ-SEL-005 | Task 8 | ✅ Pragmática pre-selected (cursor index 1) | ✅ PASS | Strong |
| REQ-SEL-006 | Task 8 | ✅ Arrow keys + Enter via MenuList | ✅ PASS | Strong |
| REQ-SEL-007 | Task 8 | ✅ Confirm advances to preflight | ⚠️ WARN (no test) | Strong |
| REQ-PER-001 | Task 1, 8 | ✅ Written to `.deck/config.json` as top-level field | ⚠️ WARN (no mock test) | Strong |
| REQ-PER-002 | Task 1 | ✅ Defaults to "pragmatica" when absent | ✅ PASS | Strong |
| REQ-PER-003 | Task 1 | ✅ Rejects invalid/non-string values | ✅ PASS | Strong |
| REQ-PER-004 | Task 1 | ✅ NormalizedDeckConfig has required field | ❌ FAIL (typecheck) | Strong |
| REQ-PER-005 | Task 1 | ✅ TOP_LEVEL_FIELDS includes orchestratorPersonality | ✅ PASS | Strong |
| REQ-OUT-001 | Task 5, 6 | ✅ Pipeline accepts personality, changes verbosity | ✅ PASS | Adequate |
| REQ-OUT-002 | Task 6, 7 | ✅ Machine fields invariant across personalities | ✅ PASS | Adequate |
| REQ-OUT-003 | Task 5, 7 | ✅ Guia includes expanded rationale + why-this-matters | ✅ PASS | Adequate |
| REQ-OUT-004 | Task 5, 7 | ✅ Pragmatica matches current behavior baseline | ✅ PASS | Adequate |
| REQ-OUT-005 | Task 5, 7 | ✅ Ahorro extremo one-line summaries | ✅ PASS | Adequate |
| REQ-OUT-006 | Task 5, 7 | ✅ Critical block still has mandatory summary | ✅ PASS | Adequate |
| REQ-OUT-007 | Task 6 | ✅ Runner-neutral config field | ⚠️ WARN (indirect) | Adequate |
| REQ-FLOW-001 | Task 3 | ✅ NextScreen includes "personality-selection" | ✅ PASS | Strong |
| REQ-FLOW-002 | Task 3, 8 | ✅ Routes after environment selection | ✅ PASS | Strong |
| REQ-FLOW-003 | Task 3, 8 | ✅ Routes to correct preflight (Pi first) | ✅ PASS | Strong |

## Verification

**Result**: FAIL
**Critical Findings**: 4
- Build check fails (`bun run build`: script not found)
- Typecheck fails in `apps/cli/src/tui/pi-runner-dashboard/action-runner.ts` (TS2741: missing `orchestratorPersonality` in NormalizedDeckConfig construction)
- Full test suite fails: 1540/1558 pass, 18 failures
- Task 9 (TUI render and routing tests) remains incomplete

**Warnings**: 2
- REQ-OUT-007 (runner transversality) only indirectly evidenced
- Targeted personality test command blocked by unrelated TUI Supermemory test failure

## Review

**Rating**: APPROVE WITH CHANGES
**Blockers**: 0
**Major Findings**: 1
- Backend — Pipeline drops quality override context from skipReason: `overrideName` and `overrideExpiresAt` from `riskResult.overrides` are never passed into `skipReasonFacts`, making the formatter's override branch unreachable in production

**Minor Findings**: 4
- Type duplication of `OrchestratorPersonality` across `packages/core` and `packages/sdd-runtime` creates drift risk
- Empty `missingFields`/`invalidFields` produce trailing colon in blockReason (`"Self-audit invalid in {mode}: "`)
- `PersonalitySelectionScreen` `selected` prop is unused (dead code)
- Config test comment misleading about merge behavior

**Nits**: 2
- Duplicate round-trip test in config tests

## Follow-ups

- **CRITICAL**: Fix `action-runner.ts` to include `orchestratorPersonality` in `NormalizedDeckConfig` construction — Frontend Apply
- **HIGH**: Complete Task 9 (TUI render and routing tests) for personality screen — Frontend Apply
- **HIGH**: Fix override context loss in skipReason formatting (pass `overrideName`/`overrideExpiresAt` from `riskResult.overrides` into `skipReasonFacts`) — Backend Apply
- **MEDIUM**: Add `@deck/core` dependency to `packages/sdd-runtime` and import shared personality types — Backend Apply
- **LOW**: Handle empty `missingFields`/`invalidFields` gracefully in `formatBlockReason` — Backend Apply
- **LOW**: Either use or remove `selected` prop on `PersonalitySelectionScreen` — Frontend Apply
- **LOW**: Correct config test comment about merge behavior / remove duplicate round-trip test — General Apply

> Note: This change is being archived with open follow-ups. The orchestrator routed to archive despite verification failure and review findings.

## Project AI Notes (Phase 5 — Deferred)

> Project AI notes are a planned Phase 5 feature under `.deck/ai-notes/`. Not yet active. No learnings extracted in this session.

### Extracted Learnings

None — Phase 5 not active. Key learnings from this change:
- Personality formatter approach (pure function with structured facts in/out) is reusable for future output shaping features
- Config merge-before-write pattern is essential when multiple TUI screens write independent config fields
- `NormalizedDeckConfig` strictness creates a ripple effect: every `NormalizedDeckConfig` construction site must include the new required field
