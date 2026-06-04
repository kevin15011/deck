# Verify Report: Fix Update/Upgrade Detection and Orchestrator Invariants

## Summary

**Overall Result**: PASS WITH WARNINGS  
**Mode**: REGISTRY-DEFERRED  
**Tasks Complete**: 10 / 10  
**Tests**: 244 / 244 passed + 1 ad hoc verification passed  
**Build**: PASS (`bun run build:dry-run`)  
**Typecheck**: PASS for affected M1 files by absence of affected-file diagnostics; WARNING for repo-wide pre-existing failures outside M1 scope

## Task Completion

| Task | Status | Owner |
|---|---|---|
| Task 1: Revert unauthorized dirty file | ✅ Complete | General Apply |
| Task 2: Release metadata commit population | ✅ Complete | General Apply |
| Task 3: Availability decision helper | ✅ Complete | General Apply |
| Task 4: Build-info generation / release-prep validation | ✅ Complete | General Apply |
| Task 5: TUI release-check integration | ✅ Complete | General Apply |
| Task 6: TUI/CLI banner display | ✅ Complete | General Apply |
| Task 7: Orchestrator invariant gate/card helpers | ✅ Complete | General Apply |
| Task 8: Orchestrator pre-delegation checklist | ✅ Complete | General Apply |
| Task 9: Apply-agent authorization card injection | ✅ Complete | General Apply |
| Task 10: Orchestrator surface verification tests | ✅ Complete | General Apply |
| Repair #5: Thread authorization into install-time call path | ✅ Complete | General Apply |

## Test Results

| Test / Check | Pass | Fail | Result |
|---|---:|---:|---|
| `bun test packages/adapter-opencode/src/prompt-generation.test.ts packages/adapter-opencode/src/developer-team-install.test.ts` | 96 | 0 | ✅ PASS |
| `bun test packages/core/src/teams/developer/orchestrator-invariants.test.ts packages/core/src/teams/developer/orchestrator-content.test.ts` | 147 | 0 | ✅ PASS |
| Ad hoc M1 install-time caller verification | 1 | 0 | ✅ PASS |

## Build / Typecheck

| Check | Result | Details |
|---|---|---|
| Build | ✅ PASS | `bun run build:dry-run` exited 0; dry-run built `deck` for `linux-x64`. |
| Affected typecheck | ✅ PASS | Repo-wide `tsc` output contains no diagnostics for `packages/adapter-opencode/src/developer-team-install.ts`, `packages/adapter-opencode/src/prompt-generation.ts`, or M1 core invariant files. |
| Repo-wide typecheck | ⚠️ WARN | `bunx tsc --noEmit` exited 2 due existing diagnostics in `packages/adapter-supermemory`, `packages/core/src/adapter-registry.test.ts`, `packages/core/src/config/deck-config.ts`, `packages/core/src/skills/sdd/index.ts`, and missing `vitest` types in `serena-composition.test.ts`; none are M1 install-time caller files. |

## M1 Install-Time Authorization Caller Gap

| Verification | Result | Notes |
|---|---|---|
| `buildOpenCodeDeveloperTeamInstallPlan` accepts `authorization?: ModificationAuthorization` | ✅ PASS | Verified in `packages/adapter-opencode/src/developer-team-install.ts`. |
| Install-time call passes `authorization: options?.authorization` to `buildPromptGenerationPlan` | ✅ PASS | Verified exact call at lines ~538-545. |
| Apply prompts receive real authorization card when install plan is built with authorization | ✅ PASS | Ad hoc Bun check verified `deck-developer-apply-backend` content includes `modifying work authorized: yes` and change name. |
| Non-apply prompts do not receive apply authorization card | ✅ PASS | Ad hoc Bun check verified orchestrator content does not receive injected apply card. |
| Focused tests cover authorization injection path | ✅ PASS | Adapter prompt-generation tests pass; install-plan regression verified by ad hoc runtime check. |

## Compliance Matrix

| REQ-ID / Scenario | Method | Result | Notes |
|---|---|---|---|
| REQ-OA-003: user authorization required | Focused tests + code inspection | ✅ PASS | Authorization type/card still required and propagated. |
| REQ-OA-005: apply agent receives invariant/authorization card | Focused tests + ad hoc install-plan check | ✅ PASS | Repair #5 closes install-time caller gap. |
| REQ-OA-006: automatic mode does not bypass gates | Core focused tests | ✅ PASS | Orchestrator content/invariant tests passed. |
| REQ-OA-008/009: invariant presence verified across surfaces | Core focused tests | ✅ PASS | 147 focused core tests passed. |
| Scenario: all gates passed — delegation proceeds with card | Focused tests + ad hoc install-plan check | ✅ PASS | Apply prompt contains real authorization card. |
| Scenario: automatic mode gates respected | Core focused tests | ✅ PASS | Passed. |

## Findings

### CRITICAL
- None.

### WARNING
- Repo-wide `bunx tsc --noEmit` is not clean due unrelated existing diagnostics outside the M1 install-time caller files. Affected M1 files showed no diagnostics in the repo-wide output.

### SUGGESTION
- Add a permanent regression test in `developer-team-install.test.ts` asserting `buildOpenCodeDeveloperTeamInstallPlan(..., { authorization })` injects the card into apply-agent prompt files. Verify used an ad hoc Bun check for this exact caller gap.

## Registry

| Field | Value |
|---|---|
| Registry Write | deferred |
| Intended Phase | `verify` |
| Intended Status | `passed_with_warnings` |
| Intended Event | `verify-pass-with-warnings` |
| Artifact | `verify-report.md` |
| Registry Blocker | None |

## Open Questions

None.
