# Archive Report: configure-packages-instruction-injection

## Change Summary

**Change**: configure-packages-instruction-injection
**Status**: ✅ Archived
**Archive Location**: `openspec/archive/configure-packages-instruction-injection/`

### Lifecycle
- **Proposal**: 2026-05-21 — Per-runner package instruction injection for agent prompts
- **Spec + Design**: 2026-05-21 — 23 requirements across 5 capabilities; detailed architecture with config/bundle/composition/dashboard layers
- **Tasks**: 2026-05-21 — 11 tasks created (3 shared core, 2 backend adapters, 4 frontend dashboard, 2 persistence)
- **Apply**: 2026-05-21 — 3 rounds: initial implementation (Tasks 1-11), Verify/Review fixes (type consistency, OpenCode passthrough), Post-Review fixes (cross-runner config, config loading, DRY constants)
- **Verify**: 2026-05-21 — PASS WITH WARNINGS (881/890 tests pass; 9 pre-existing failures excluded)
- **Review**: 2026-05-21 — APPROVE WITH COMMENTS (all BLOCKER and MAJOR findings resolved)
- **Archive**: 2026-05-21 — archived

## Traceability Matrix

| REQ-ID | Task | Implementation | Verify Result | Review Rating |
|---|---|---|---|---|
| REQ-PIC-001 | Task 1 | ✅ Implemented | ✅ PASS | ✅ Strong |
| REQ-PIC-002 | Task 1 | ✅ Implemented | ✅ PASS | ✅ Strong |
| REQ-PIC-003 | Task 1 | ✅ Implemented | ✅ PASS | ✅ Strong |
| REQ-PIC-004 | Task 1 | ✅ Implemented | ✅ PASS | ✅ Strong |
| REQ-PIC-005 | Task 1 | ✅ Implemented | ✅ PASS | ✅ Strong |
| REQ-PIC-006 | Task 1 | ✅ Implemented | ✅ PASS | ⚠️ Adequate |
| REQ-PIC-007 | Task 1 | ✅ Implemented | ✅ PASS | ✅ Strong |
| REQ-CII-001 | Task 2 | ✅ Implemented | ✅ PASS | ✅ Strong |
| REQ-CII-002 | Task 3 | ✅ Implemented | ✅ PASS | ✅ Strong |
| REQ-CII-003 | Task 3 | ✅ Implemented | ✅ PASS | ✅ Strong |
| REQ-CII-004 | Task 3 | ✅ Implemented | ✅ PASS | ✅ Strong |
| REQ-CII-005 | Task 4 | ✅ Implemented | ✅ PASS | ✅ Strong |
| REQ-CII-006 | Task 4 | ✅ Implemented | ✅ PASS | ✅ Strong |
| REQ-CII-007 | Task 4 | ✅ Implemented | ✅ PASS | ✅ Strong |
| REQ-DTM-001 | Task 5 | ✅ Implemented | ✅ PASS | ✅ Strong |
| REQ-DTM-002 | Task 5 | ✅ Implemented | ✅ PASS | ✅ Strong |
| REQ-DTM-003 | Task 5 | ✅ Implemented | ✅ PASS | ✅ Strong |
| REQ-DC-001 | Task 1 | ✅ Implemented | ✅ PASS | ✅ Strong |
| REQ-DC-002 | Task 1 | ✅ Implemented | ✅ PASS | ✅ Strong |
| REQ-DC-003 | Task 1 | ✅ Implemented | ✅ PASS | ✅ Strong |
| REQ-DASH-001 | Tasks 8-10 | ✅ Implemented | ✅ PASS | ✅ Strong |
| REQ-DASH-002 | Tasks 8-10 | ✅ Implemented | ✅ PASS | ✅ Strong |
| REQ-DASH-003 | Tasks 8, 11 | ✅ Implemented (fixed) | ✅ PASS (after fix) | ⚠️ Adequate → ✅ Strong |
| REQ-DASH-004 | Tasks 8, 11 | ✅ Implemented (fixed) | ✅ PASS (after fix) | ⚠️ Adequate → ✅ Strong |

## Summary

- **Total Requirements**: 23
- **Total Tasks**: 11 (all completed)
- **Verification Result**: PASS WITH WARNINGS
- **Review Rating**: APPROVE WITH COMMENTS (all blockers resolved)

## Verification

**Result**: PASS WITH WARNINGS
**Critical Findings**: 0 (all initial critical findings resolved in fix rounds)
**Warnings**: 9 pre-existing test failures in CLI dashboard suite (unrelated to this change — Supermemory action ordering, token redaction, team bundle execution, internal package install routing)

## Review

**Rating**: APPROVE WITH COMMENTS
**Blockers**: 0 (1 initial blocker — cross-runner config overwrite — resolved in Post-Review fixes)
**Major Findings**: 0 (3 initial majors — type duplication, OpenCode orchestrator bypass, hardcoded IDs — all resolved)

## Files Changed

### Core (packages/core)
- `src/config/deck-config.ts` — Config types, validation, normalization for `packageInstructions`
- `src/config/deck-config.test.ts` — Config validation tests
- `src/teams/developer/instruction-bundles/index.ts` — Bundle types, builder, composer (NEW)
- `src/teams/developer/instruction-bundles/index.test.ts` — Bundle tests (NEW)
- `src/teams/developer/instruction-bundles/codebase-memory.ts` — Canonical codebase-memory instructions (NEW)
- `src/teams/developer/instruction-bundles/context-mode.ts` — Canonical context-mode instructions (NEW)
- `src/teams/developer/instruction-bundles/rtk.ts` — Canonical RTK fallback instructions (NEW)
- `src/teams/developer/instruction-bundles/*.test.ts` — Per-package builder tests (NEW)
- `src/teams/developer/content-registry.ts` — Accept capabilityInstructions option
- `src/teams/developer/content-registry.test.ts` — Composition tests
- `src/teams/developer/manifest.ts` — Thread capabilityInstructions to registry
- `src/teams/developer/manifest.test.ts` — Manifest propagation tests
- `src/runner-capability.ts` — Extend DeveloperTeamManifestInput with capabilityInstructions
- `src/index.ts` — Re-export public types

### Pi Adapter (packages/adapter-pi)
- `src/developer-team-install.ts` — Resolve config, build bundle, pass through
- `src/developer-team-install.test.ts` — Adapter integration tests
- `src/runner-capabilities.ts` — Thread instruction data through facade
- `src/capability-plan.ts` — Config-write action for package instructions
- `src/capability-plan.test.ts` — Config-write planning tests

### OpenCode Adapter (packages/adapter-opencode)
- `src/developer-team-install.ts` — Resolve config, build bundle, pass to skill/prompt generation
- `src/prompt-generation.ts` — Accept capabilityInstructions, compose into prompts
- `src/prompt-generation.test.ts` — Prompt generation tests
- `src/runner-capabilities.ts` — Thread instruction data through facade
- `src/capability-plan.ts` — Config-write action for package instructions

### CLI Dashboard (apps/cli)
- `src/tui/pi-runner-dashboard/state.ts` — Add packageInstructions state, new screen
- `src/tui/pi-runner-dashboard/reducer.ts` — Toggle/set actions for package instructions
- `src/tui/pi-runner-dashboard/selectors.ts` — Configure Packages section selectors
- `src/tui/pi-runner-dashboard/input-handler.ts` — Navigation/toggle routing
- `src/tui/pi-runner-dashboard/action-runner.ts` — Persist packageInstructions to config
- `src/tui/screens/pi-runner-dashboard-screens.tsx` — Render Configure Packages screen

## Known Issues (Pre-existing — Not Caused by This Change)

1. **9 CLI dashboard test failures** in `action-runner.test.ts` — Supermemory action ordering, token redaction, team bundle execution, internal package install routing. These failures existed before this change and are excluded from the change scope.
2. **No root `build` script** — `bun run build` exits with "Script not found". Pre-existing repo configuration issue.

## Follow-ups

- **LOW**: Add dedicated tests for dashboard load-from-config and OpenCode `packageInstructions.opencode` persistence path — current tests cover rendering/reducer but not the full persistence round-trip. Suggested owner: Frontend Apply.
- **LOW**: Consider deep-freezing instruction bundles or documenting that immutability is best-effort. Suggested owner: General Apply.
- **LOW**: Decide whether undefined `context.teamId` in `composeCapabilityInstructions` should match any team or fail closed. Suggested owner: General Apply.

> These are non-blocking suggestions from the Review. The change is fully functional and closed.

## Project AI Notes (Phase 5 — Deferred)

> Project AI notes are a planned Phase 5 feature under `.deck/ai-notes/`. Not yet active.

### Extracted Learnings

- Per-runner package instruction injection follows the same pattern as Adaptive Memory: config → bundle → composition → manifest → adapter serialization. This pattern can be reused for future prompt composition features.
- Dashboard config writes MUST read existing config before merging to avoid cross-runner overwrites — a common pitfall when multiple runners share a single config file.
- Canonical constants (package IDs, runner IDs) should be exported from core and imported by adapters/dashboard to avoid drift across 3+ files.
- OpenCode orchestrator prompt requires explicit handling in prompt generation — it bypasses the standard agent body composition path.

## Git Suggestion Context

- **Conventional commit type**: `feat`
- **Scope**: `core, adapters, cli`
- **Key changes**:
  - Added `packageInstructions` config field for per-runner instruction injection toggles
  - Created `CapabilityInstructionBundle` type and composition mechanism
  - Added canonical instruction content for codebase-memory, context-mode, and RTK packages
  - Extended content registry and manifest builder to thread instructions through
  - Integrated Pi and OpenCode adapters to resolve config and pass bundles
  - Added "Configure Packages" dashboard section with per-runner toggles
  - Persisted settings to `.deck/config.json` via existing config write path
- **Ambiguity notes**: None — this is clearly a feature addition with new user-facing capability.
