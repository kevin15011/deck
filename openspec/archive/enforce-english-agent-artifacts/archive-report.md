# Archive Report: enforce-english-agent-artifacts

## Change Summary

**Change**: enforce-english-agent-artifacts
**Status**: ✅ Archived
**Archive Location**: `openspec/archive/enforce-english-agent-artifacts/`

### Lifecycle
- **Proposal**: 2026-06-17 — English-only policy for Developer Team sub-agent communication and artifacts
- **Spec + Design**: 2026-06-17 — Requirements and implementation design completed and repaired (user-facing language correction + policy scope alignment)
- **Tasks**: 2026-06-17 — 13 atomic tasks created and completed
- **Apply**: 2026-06-17 — All 13 tasks completed (core + backend test coverage)
- **Verify**: 2026-06-17 — PASS WITH WARNINGS
- **Review**: 2026-06-17 — APPROVE (re-review after required test coverage fix)
- **Archive**: 2026-06-17 — Archived

## Traceability Matrix

| REQ-ID | Task | Implementation | Verify Result | Review Rating |
|---|---|---|---|---|
| REQ-LANG-001 | 1, 2, 3, 8, 9 | ✅ Implemented (central policy + composition + orchestrator reinforcement + coverage) | ✅ PASS | ✅ Strong |
| REQ-LANG-002 | 1, 3, 8, 9 | ✅ Implemented (allowed literal policy + non-broad test strategy) | ✅ PASS | ✅ Strong |
| REQ-LANG-003 | 1, 2, 8, 10-13 | ✅ Implemented (Deck-owned generated content + install-plan surfaces only) | ✅ PASS | ✅ Strong |
| REQ-ORCH-001 | 3, 9 | ✅ Implemented (delegation in English for sub-agent prompts) | ✅ PASS | ✅ Strong |
| REQ-ORCH-002 | 3, 9 | ✅ Implemented (sub-agent outputs and artifact outputs required English with exceptions) | ✅ PASS | ✅ Strong |
| REQ-ORCH-003 | 1, 3, 9 | ✅ Implemented (user-facing responses preserved to user language) | ✅ PASS | ✅ Strong |
| REQ-ORCH-004 | 1, 3, 9 | ✅ Implemented (repair/reject guidance added to orchestrator policy) | ✅ PASS | ✅ Strong |
| REQ-REG-001 | 1, 2, 8, 10-13 | ✅ Implemented (agent body/skill/session composition updated across all catalog surfaces) | ✅ PASS | ✅ Strong |
| REQ-REG-002 | 2, 8 | ✅ Implemented (composition order preserves policy through capability bundles) | ✅ PASS | ✅ Strong |
| REQ-ADAPT-001 | 1, 2, 10, 11 | ✅ Implemented (OpenCode prompt + install-plan outputs include policy) | ✅ PASS | ✅ Strong |
| REQ-ADAPT-002 | 1, 2, 12, 13 | ✅ Implemented (Pi install-plan + profile outputs include policy) | ✅ PASS | ✅ Strong |
| REQ-ADAPT-003 | 1-13 | ✅ Implemented within Deck-generated content pipeline only | ✅ PASS | ✅ Strong |
| REQ-LEAK-001 | 4-7, 8, 10-13 | ✅ Implemented (no `herramienta` in generated core/adapter outputs) | ✅ PASS | ✅ Strong |
| REQ-LEAK-002 | 4-7, 8, 10-13 | ✅ Implemented (regression tests assert absence on core and adapter surfaces) | ✅ PASS | ✅ Strong |
| REQ-TEST-001 | 8, 9, 10-13 | ✅ Implemented (positive policy assertions across required surfaces) | ✅ PASS | ✅ Strong |
| REQ-TEST-002 | 8, 9 | ✅ Implemented (tests avoid broad language detection, use targeted assertions) | ✅ PASS | ✅ Strong |
| REQ-TEST-003 | 4-7, 8, 10-13 | ✅ Implemented (targeted deny-list uses confirmed leak `herramienta`) | ✅ PASS | ✅ Strong |

## Verification

**Result**: PASS WITH WARNINGS
**Critical Findings**: 0
**Warnings**: 1

- Full-project TypeScript typecheck (`bunx tsc --noEmit`) still fails with pre-existing errors outside this change scope.

## Review

**Rating**: APPROVE
**Blockers**: 0
**Major Findings**: 0

## Files Inspected

1. `openspec/archive/enforce-english-agent-artifacts/state.yaml`
2. `openspec/archive/enforce-english-agent-artifacts/events.yaml`
3. `openspec/archive/enforce-english-agent-artifacts/proposal.md`
4. `openspec/archive/enforce-english-agent-artifacts/spec.md`
5. `openspec/archive/enforce-english-agent-artifacts/design.md`
6. `openspec/archive/enforce-english-agent-artifacts/tasks.md`
7. `openspec/archive/enforce-english-agent-artifacts/preconditions.md`
8. `openspec/archive/enforce-english-agent-artifacts/apply-progress.md`
9. `openspec/archive/enforce-english-agent-artifacts/verify-report.md`
10. `openspec/archive/enforce-english-agent-artifacts/review-report.md`
11. `openspec/archive/enforce-english-agent-artifacts/exploration.md`

## Follow-ups

- **Low**: Consider expanding the known-leak deny-list beyond `herramienta` only after triaging pre-existing Spanish plural strings (`herramientas`) in pre-existing OpenCode test names (`prompt-memory-injection.test.ts`) to avoid false positives.

## Project AI Notes (Phase 5 — Deferred)

> Project AI notes are a planned Phase 5 feature under `.deck/ai-notes/`. Not yet active.

### Extracted Learnings

- Central policy composition in `content-registry.ts` is the most robust location to enforce internal language behavior consistently across generated content and materialized adapter outputs.
- Explicitly expanding policy test iteration to all `REAL_CONTENT` keys (`deck-developer-*`, `deck-init`, and `deck-onboard`) closes coverage gaps without widening policy scope.
- Targeted leak checks (`herramienta`) are safer than broad language-detection enforcement when legitimate non-English literals are allowed.

## Git Suggestion Context

- **Conventional commit type**: `fix` (with a secondary `test` component for large regression additions)
- **Scope**: `@deck/core` language policy composition and orchestrator reinforcement; `@deck/adapter-opencode` and `@deck/adapter-pi` regression coverage
- **Key changes**:
  - Added `DEVELOPER_TEAM_LANGUAGE_POLICY` and `appendDeveloperTeamLanguagePolicy` usage in content composition flows
  - Enforced central policy on agent/skill/session surfaces plus fallback and capability composition order
  - Added orchestrator-specific language policy reinforcement (English-only sub-agent flow + repair behavior + user-language exception)
  - Removed known non-English leakage token `herramienta` from four core generated content paths
  - Added/updated focused tests for policy presence, allowed literals, and leak absence across Developer Team and adapter outputs
  - Added `LANGUAGE_POLICY_TEST_AGENT_IDS` to include `deck-init` and `deck-onboard` in coverage
- **Ambiguity notes**: The change is primarily a policy fix; test additions are substantial and tightly scoped to requirements, so `fix` is preferred over a feature commit type.

## Archival Integrity

- `archive-report.md` created in `openspec/archive/enforce-english-agent-artifacts/`
- `state.yaml` set to `phase: archive`, `status: archived`
- `events.yaml` includes `phase: archive`, `status: completed`
- Source change directory moved from `openspec/changes/enforce-english-agent-artifacts/` to `openspec/archive/enforce-english-agent-artifacts/`
