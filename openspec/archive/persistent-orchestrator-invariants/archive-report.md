# Archive Report: Persistent Orchestrator Invariants

## Change Summary

**Change**: `persistent-orchestrator-invariants`
**Status**: ✅ Archived
**Archive Location**: `openspec/archive/persistent-orchestrator-invariants/`

### Lifecycle

| Phase | Date | Result |
|-------|------|--------|
| **Proposal** | 2026-05-28 | Intent: extract critical orchestrator behavioral rules into first-class invariants; produce prompt/methodology docs |
| **Exploration** | 2026-05-28 | Inventoried 15+ prompt/methodology modules; user corrected: no "documentation triage" |
| **Spec** | 2026-05-28 | 26 requirements across 4 capabilities (OIS, IBC, PMD, BC) |
| **Design** | 2026-05-28 | Invariant schema + composition + verification + docs architecture |
| **Tasks** | 2026-05-28 | 9 tasks across 4 waves (1 General, 2 General, 4 Backend, 2 Backend) |
| **Apply** | 2026-05-28 | 9/9 tasks complete; 8 post-verify fixes; OpenCode install verified |
| **Verify** | 2026-05-28 | **PASS WITH WARNINGS** — all invariant tests pass; baseline failures unrelated |
| **Review** | 2026-05-28 | **APPROVE WITH CHANGES** — adapter verifier duplication accepted as follow-up |
| **Archive** | 2026-05-28 | Fully archived with traceability |

## Traceability Matrix

| REQ-ID | Description | Task(s) | Implementation | Verify | Review |
|--------|-------------|---------|----------------|--------|--------|
| REQ-OIS-001 | Invariant schema types | Task 1 | `orchestrator-invariants.ts` | ✅ PASS | ✅ Strong |
| REQ-OIS-002 | 5 critical invariants | Task 1 | INV-001..INV-005 | ✅ PASS | ✅ Strong |
| REQ-OIS-003 | Tier ordering (critical > high > standard) | Task 1/2 | `renderOrchestratorInvariants` | ✅ PASS | ✅ Strong |
| REQ-OIS-004 | Invariants at very start (before authority) | Task 3 | `content-registry.ts` prepend | ✅ PASS | ✅ Strong |
| REQ-OIS-005 | All 3 surfaces (session, agent, skill) | Task 3 | Content registry injection | ✅ PASS | ✅ Strong |
| REQ-OIS-006 | Idempotent injection (no duplicates) | Task 2 | `prependOrchestratorInvariants` | ✅ PASS | ✅ Strong |
| REQ-OIS-007 | `## Orchestrator Invariants` section header | Task 2 | Render output | ✅ PASS | ✅ Strong |
| REQ-OIS-008 | Verification function | Task 2 | `verifyOrchestratorInvariantPresence` | ✅ PASS | ✅ Strong |
| REQ-OIS-009 | Structured verify result (`{pass, missing}`) | Task 2 | `InvariantVerificationResult` | ✅ PASS | ✅ Strong |
| REQ-OIS-010 | High-tier invariant support | Task 1/2 | Tier type + render support | ✅ PASS | ✅ Adequate |
| REQ-OIS-011 | Source trace to orchestrator-content.ts | Task 1 | `sourceRefs` on each invariant | ✅ PASS | ✅ Adequate |
| REQ-OIS-012 | Runner-agnostic (no Pi/OpenCode refs) | Task 1/2 | Invariant records | ✅ PASS | ✅ Strong |
| REQ-IBC-001 | Composition step at very start | Task 3 | `content-registry.ts` | ✅ PASS | ✅ Strong |
| REQ-IBC-002 | Session instructions ordering | Task 3 | `getTeamSessionInstructions` | ✅ PASS | ✅ Strong |
| REQ-IBC-003 | PACKAGE_ORDER unchanged | Task 3 | No invariant entries added | ✅ PASS | ✅ Strong |
| REQ-IBC-004 | CapabilityInstructionFragment type unchanged | Task 3 | No invariant fields added | ✅ PASS | ✅ Strong |
| REQ-PMD-001 | Documentation artifact exists | Task 9 | `docs/prompt-methodology-modules.md` | ✅ PASS | ✅ Adequate |
| REQ-PMD-002 | SDD Triage Gate documented (not "doc triage") | Task 9 | Docs section 1 | ✅ PASS | ✅ Strong |
| REQ-PMD-003 | Module structure (governs, source, rules, surfaces) | Task 9 | Per-section structure | ✅ PASS | ✅ Adequate |
| REQ-PMD-004 | Required categories covered | Task 9 | 16 module sections | ✅ PASS | ✅ Adequate |
| REQ-PMD-005 | Invariants in docs | Task 9 | Section 16 | ✅ PASS | ✅ Adequate |
| REQ-PMD-006 | Complements developer-team.md | Task 9 | No roster/dep graph duplication | ✅ PASS | ✅ Adequate |
| REQ-BC-001 | Behavioral semantics preserved | All | Invariant rules present in composed output | ✅ PASS | ✅ Strong |
| REQ-BC-002 | Existing tests pass | Task 5/8 | Filtered invariant suites pass | ⚠️ WARN | ✅ Strong |
| REQ-BC-003 | Adapter API types unchanged | Task 6/7 | `AgentContent` / session types unchanged | ⚠️ WARN | ✅ Strong |
| REQ-BC-004 | No duplicate invariant text | Task 2 | Idempotent prepend | ✅ PASS | ✅ Strong |

**Totals**: 26 requirements, 9 tasks, 26/26 verified (24 ✅ PASS, 2 ⚠️ WARN baseline), 26/26 reviewed (Strong/Adequate)

## Verification

**Result**: PASS WITH WARNINGS
**Critical Findings**: 0
**Warnings**: 3 (all baseline/unrelated — pre-existing test failures, typecheck, Pi adapter expectations)

Key verification evidence:
- Core invariant unit tests: **65 pass, 0 fail**
- Content registry + manifest integration: **100 pass, 0 fail**
- OpenCode adapter install tests: **44 pass, 0 fail**
- Pi invariant-relevant tests: **3 pass, 0 fail**
- Cross-suite invariant filter: **7 pass, 0 fail**
- Full `bun test`: ⚠️ 1739 pass, 50 fail (all pre-existing baseline)
- Build: ✅ `bun run build:dry-run` — PASS
- Typecheck: ⚠️ Baseline failures only (0 new errors from change)
- Composition ordering: ✅ Invariants at index 0 on all surfaces (session, agent, skill)
- Spec wording: ✅ No stale "after authority" contradictions

## Review

**Rating**: APPROVE WITH CHANGES
**Blockers**: 0
**Major Findings**: 1 (adapter inline verifier duplication — accepted as follow-up)
**Minor Findings**: 1 (sourceRefs line drift — recommendation for CI)
**All prior NIT findings**: Resolved (typo, dead import, incomplete test, Pi type error)

### Resolved Prior Findings

| Finding | Severity | Status |
|---------|----------|--------|
| Invariant ordering contradicts spec (updated to before-authority) | MAJOR | ✅ Resolved |
| Dead import in content registry | MINOR | ✅ Resolved |
| Incomplete test (no assertion) | MINOR | ✅ Resolved |
| Typo "Invairants" | NIT | ✅ Resolved |
| Pi adapter type error | MAJOR | ✅ Resolved |

## Files Implemented

### Created
- `packages/core/src/teams/developer/orchestrator-invariants.ts` — ~322 lines (schema, records, render/verify/prepend helpers)
- `packages/core/src/teams/developer/orchestrator-invariants.test.ts` — ~350 lines (comprehensive unit tests)
- `packages/core/src/teams/developer/orchestrator-invariants.task2.test.ts` — ~170 lines (focused task 2 tests)
- `docs/prompt-methodology-modules.md` — ~520 lines (16 module sections)

### Modified
- `packages/core/src/teams/developer/content-registry.ts` — ~35 lines added (invariant injection)
- `packages/core/src/teams/developer/content-registry.test.ts` — ~70 lines added (7 integration tests)
- `packages/core/src/teams/developer/manifest.test.ts` — ~55 lines added (5 manifest tests)
- `packages/adapter-opencode/src/developer-team-install.ts` — ~35 lines added (inline verifier)
- `packages/adapter-opencode/src/developer-team-install.test.ts` — ~45 lines added (2 adapter tests)
- `packages/adapter-pi/src/developer-team-install.ts` — ~40 lines added (inline verifier)
- `packages/adapter-pi/src/developer-team-install.test.ts` — ~55 lines added (3 adapter tests + Pi expectations fix)

## User Install Verification

User confirmed OpenCode installation succeeded. Installed `~/.config/opencode/skills/deck-developer-orchestrator/SKILL.md` contains `## Orchestrator Invariants` with INV-001 through INV-005. Non-destructive verification passed: `verifyOpenCodeDeveloperTeamInstall()` returned `valid: true` for 14 skills with no orchestrator issues.

> **Note**: Out-of-band install (manual run of OpenCode developer team install path) was used to regenerate the installed skill files. This is acknowledged; the normal SDD flow achieves the same result through `deck-developer-orchestrator` install verification.

## Follow-ups

- **MAJOR**: Resolve adapter inline verifier duplication. Both `adapter-opencode` and `adapter-pi` define local `verifyInvariantPresence()` copies instead of importing `verifyOrchestratorInvariantPresence` from core. Current workaround justified by `@deck/core` export typing constraints. Must be resolved before adding INV-006+. Options: (a) fix core export typing and replace with direct imports, (b) expose thin runtime wrapper, (c) build-time code-gen to pin ID list. — Owner: Backend Apply
- **MINOR**: `sourceRefs` line-number references in `orchestrator-invariants.ts` and `docs/prompt-methodology-modules.md` will drift when `orchestrator-content.ts` is edited. Recommendation: add CI check verifying `sourceRefs` resolve, or switch to heading/anchor references instead of line numbers. — Owner: General Apply
- **SUGGESTION**: Optional deduplication of retained prose in `orchestrator-content.ts` now that invariant verification is proven. Currently both prose rules and invariant records carry the same behavioral content, increasing token overhead. Safe to dedupe once verification confidence is established. — Owner: General Apply

## Project AI Notes (Phase 5 — Deferred)

> Project AI notes are a planned Phase 5 feature under `.deck/ai-notes/`. Not yet active.

No AI notes extracted or created.

## Rollback Notes

1. Remove invariant injection calls from `content-registry.ts` (lines added by Task 3).
2. Remove adapter inline verifier calls from `adapter-opencode/developer-team-install.ts` and `adapter-pi/developer-team-install.ts`.
3. Delete `orchestrator-invariants.ts` and `orchestrator-invariants*.test.ts`.
4. Revert test additions in `content-registry.test.ts`, `manifest.test.ts`, adapter test files.
5. Leave or revert `docs/prompt-methodology-modules.md` (non-destructive; can stay).
6. Existing runner artifacts return to previous content on next install/regeneration.
7. Installed `SKILL.md` must be regenerated after rollback.

## Git Suggestion Context

- **Conventional commit type**: `feat` (new orchestrator invariant system with structural impact across core and adapters)
- **Scope**: `orchestrator-invariants` / `core` / `adapter-opencode` / `adapter-pi` / `docs`
- **Key changes**:
  - Added `OrchestratorInvariant` schema + 5 critical-tier invariant records (INV-001..INV-005) in core
  - Added render/verify/prepend helpers for invariant composition
  - Modified `content-registry.ts` to inject invariants at very start of orchestrator output (before context-authority, before capability bundles)
  - Added comprehensive unit tests (65+) and integration tests (100+) all passing
  - Modified OpenCode and Pi adapters to verify invariants in installed artifacts
  - Created `docs/prompt-methodology-modules.md` — 16-section inventory of all prompt/methodology modules
  - Post-verify fixes: alignment to user preference for invariant ordering, Pi type error, dead import removal, brittleness fixes
- **Ambiguity notes**: Could also be `refactor` (structural extraction without behavioral change) or `docs` (significant documentation artifact). The dominant impact is `feat`: new verifiable invariant system with new runtime behavior (verification warnings, ordering guarantees). The `docs/` addition is substantial but secondary.
