# Archive Report: SDD Idempotency, Profiles, and Pipeline Isolation

## Change Summary

**Change**: sdd-idempotency-profiles-isolation
**Status**: ✅ Archived
**Archive Location**: `openspec/archive/sdd-idempotency-profiles-isolation/`

### Lifecycle
- **Proposal**: 2026-05-24 — Three capability enhancements: idempotency aggregate counts, SDD profile system with orchestrator routing, pipeline stage isolation
- **Spec + Design**: 2026-05-24 — 27 requirements + 13 design components; parallel completion
- **Tasks**: 2026-05-24 — 13 atomic tasks (3 shared contracts, 4 backend impl, 2 content/profile, 4 test suites)
- **Apply**: 2026-05-24 — 13/13 tasks completed by Backend Apply
- **Verify**: 2026-05-25 — PASS (affected suites) / FAIL (full suite pre-existing failures); 193/193 affected tests pass
- **Review**: 2026-05-24 — APPROVE WITH CHANGES (1 blocker: runner contract missing count fields — resolved)
- **Archive**: 2026-05-24 — change closed, all artifacts migrated

## Traceability Matrix

| REQ-ID | Task(s) | Implementation | Verify Result | Review Rating |
|---|---|---|---|---|
| REQ-IDEM-001 | Task 1, 4 | `DeveloperTeamApplyResult.changedCount/unchangedCount` in runner-capability.ts + PI adapter | ✅ PASS | ✅ Strong |
| REQ-IDEM-002 | Task 1, 5 | OpenCode counts in opencode adapter + runner contract | ✅ PASS | ✅ Strong |
| REQ-IDEM-003 | Task 4, 5 | Changed = created/updated/added; verified via tests | ✅ PASS | ✅ Strong (after fix) |
| REQ-IDEM-004 | Task 4, 5 | Unchanged = unchanged status; verified via tests | ✅ PASS | ✅ Strong |
| REQ-IDEM-005 | Task 10, 11 | Second apply yields changedCount===0 | ✅ PASS | ✅ Strong |
| REQ-IDEM-006 | Task 5 | configMergeResult contributes to OpenCode counts | ✅ PASS | ✅ Strong |
| REQ-IDEM-007 | Task 4, 5 | Existing results arrays preserved; additive only | ✅ PASS | ✅ Strong |
| REQ-PROF-001 | Task 2 | Profile, SDDPhase, ProfileStrategy, PhaseOverrides types defined | ✅ PASS | ⚠️ Adequate (opaque PhaseOverrides noted) |
| REQ-PROF-002 | Task 2 | `DeckConfig.profiles?: Profile[]` | ✅ PASS | ✅ Strong |
| REQ-PROF-003 | Task 2, 6 | Normalized profiles + activeProfile with defaults | ✅ PASS | ✅ Strong |
| REQ-PROF-004 | Task 6, 12 | Duplicate names rejected with clear error | ✅ PASS | ✅ Strong |
| REQ-PROF-005 | Task 6, 12 | Unknown phase keys rejected with valid phases listed | ✅ PASS | ✅ Strong |
| REQ-PROF-006 | Task 6, 12 | Default implicit profile without config changes | ✅ PASS | ✅ Strong |
| REQ-PROF-007 | Task 6, 12 | activeProfile persisted in config, round-trip verified | ✅ PASS | ✅ Strong |
| REQ-PROF-008 | Task 6, 12 | Unknown activeProfile rejected with available names | ✅ PASS | ✅ Strong |
| REQ-PROF-009 | Task 9, 13 | Pipeline accepts profile, applies phase overrides at runtime | ✅ PASS | ⚠️ Adequate (limited phaseMap coverage) |
| REQ-PROF-010 | Task 2, 6, 12 | SDDPhase = 10 valid phase names | ✅ PASS | ✅ Strong |
| REQ-ISO-001 | Task 3, 8 | stageErrors: StageError[] on OrchestratorPipelineResult | ✅ PASS | ✅ Strong |
| REQ-ISO-002 | Task 3 | StageError type with stage/error/recoverable fields | ✅ PASS | ✅ Strong |
| REQ-ISO-003 | Task 8, 13 | Stage failure captured; other stages continue | ⚠️ WARN (invalid-return not proven) | ✅ Strong |
| REQ-ISO-004 | Task 8, 13 | All stages execute in report-only mode despite failures | ✅ PASS | ✅ Strong |
| REQ-ISO-005 | Task 3, 8, 13 | StageConfig isolation per stage | ✅ PASS | ✅ Strong |
| REQ-ISO-006 | Task 8, 13 | Enforced invalid audit remains blocked | ✅ PASS | ✅ Strong |
| REQ-ISO-007 | Task 8, 13 | Non-recoverable error → partial outcome | ⚠️ WARN (path not clearly isolated) | ✅ Strong |

## Verification

**Result**: PASS (affected suites) — full suite has 30 pre-existing failures in pi-runner-dashboard, supermemory tests (unrelated)
**Critical Findings**: 0 (blocker resolved: runner contract updated with count fields)
**Warnings**: 2 (REQ-ISO-003 invalid-return isolation not clearly proven; REQ-ISO-007 non-audit non-recoverable path not clearly isolated)
**Affected Tests**: 193/193 pass
**Typecheck**: Pre-existing errors in adapter-supermemory (unrelated)

## Review

**Rating**: APPROVE WITH CHANGES
**Blockers**: 1 — runner capability contract missing count fields (RESOLVED)
**Major Findings**: 3 — "added" status filter mismatch (resolved), path traversal risk in standaloneSkills (deferred), opaque PhaseOverrides shape (deferred)

## Follow-ups

- **MEDIUM**: Path traversal risk in standaloneSkills — `skillId` in `packages/adapter-pi/src/developer-team-install.ts` and `packages/adapter-opencode/src/developer-team-install.ts` is unsanitized before path construction. Deferred from this change. Suggested owner: Backend/security
- **LOW**: PhaseOverrides inner shape is `Record<string, unknown>` — opaque and not self-documenting. Consider defining `PhaseConfig` interface for discoverability. Suggested owner: Backend
- **LOW**: Content registry not receiving profile context per Design artifact. Either implement or update Design. Suggested owner: Backend
- **LOW**: Orchestrator phase map only covers 3 audit types; expanding would increase profile override applicability. Suggested owner: Backend

## Git Suggestion Context

- **Conventional commit type**: `feat` (three new capabilities: idempotency reporting, profile system, pipeline isolation)
- **Scope**: `core`, `sdd-runtime`, `adapter-pi`, `adapter-opencode`
- **Key changes**:
  - `packages/core/src/runner-capability.ts` — added `changedCount`/`unchangedCount` to shared result contract
  - `packages/core/src/config/deck-config.ts` — added `Profile`, `SDDPhase`, `ProfileStrategy`, `PhaseOverrides` types; profile validation/normalization
  - `packages/core/src/teams/developer/content-registry.ts` — profile context option (deferred per review)
  - `packages/adapter-pi/src/developer-team-install.ts` — paths and aggregate counts in apply results
  - `packages/adapter-opencode/src/developer-team-install.ts` — paths, counts, config merge contribution
  - `packages/sdd-runtime/src/orchestrator/orchestrator-pipeline.ts` — stage isolation, StageError, profile-aware routing
  - 4 test suites updated (Pi, OpenCode, deck-config, pipeline)
- **Ambiguity notes**: Could split into `feat(core)` + `feat(sdd-runtime)` + `feat(adapters)` if desired; the three capabilities are independent enough for separate commits but were implemented in one flow
