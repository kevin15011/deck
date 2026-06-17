# Verify Report: Enforce English Agent Artifacts

## Summary

**Overall Result**: PASS WITH WARNINGS  
**Tasks Complete**: 13 / 13 plus review fix complete  
**Tests**: 396 / 396 focused tests passed  
**Build**: PASS (`bun run build:dry-run`)  
**Typecheck**: WARN — full-project `bunx tsc --noEmit` still fails with pre-existing unrelated errors

Registry-deferred mode was requested. This report is the only OpenSpec artifact written by Verify. `state.yaml` and `events.yaml` were not modified.

## Task Completion

| Task | Status | Owner | Verification Notes |
|---|---|---|---|
| Task 1: Add central language policy constant and helper | Complete | General Apply | Apply progress marks complete; focused tests verify policy export and composition behavior. |
| Task 2: Compose central policy into generated surfaces | Complete | General Apply | Core language-policy composition tests passed. |
| Task 3: Reinforce orchestrator prompt and skill body | Complete | General Apply | Orchestrator language-policy reinforcement tests passed. |
| Task 4: Replace known leak in Serena instruction bundle | Complete | General Apply | Focused tests passed. |
| Task 5: Replace known leak in apply-general content | Complete | General Apply | Focused tests passed. |
| Task 6: Replace known leak in apply-backend content | Complete | General Apply | Focused tests passed. |
| Task 7: Replace known leak in apply-frontend content | Complete | General Apply | Focused tests passed. |
| Task 8: Add content-registry tests | Complete | General Apply | `content-registry.test.ts` passed. |
| Task 9: Add orchestrator-content tests | Complete | General Apply | `orchestrator-content.test.ts` passed. |
| Task 10: Add OpenCode prompt-generation regression tests | Complete | Backend Apply | `prompt-generation.test.ts` passed. |
| Task 11: Add OpenCode install-plan regression tests | Complete | Backend Apply | OpenCode developer-team install tests passed. |
| Task 12: Add Pi install-plan regression tests | Complete | Backend Apply | Pi developer-team install tests passed. |
| Task 13: Add Pi team-profile regression tests | Complete | Backend Apply | Pi team-profile tests passed. |

## Review Fix Verification

| Review Fix | Method | Result | Notes |
|---|---|---|---|
| Add `deck-init` and `deck-onboard` to the content-registry language-policy test iteration | Test source inspection and focused core test execution | PASS | `LANGUAGE_POLICY_TEST_AGENT_IDS` includes `...DEVELOPER_AGENT_IDS`, `deck-init`, and `deck-onboard`; the policy presence and known-leak absence tests iterate over that array. |

## Test Results

| Test Suite | Command | Pass | Fail | Skip | Result |
|---|---|---:|---:|---:|---|
| Core focused tests | `bun test ./packages/core/src/teams/developer/content-registry.test.ts ./packages/core/src/teams/developer/orchestrator-content.test.ts` | 202 | 0 | 0 | PASS |
| Adapter focused tests | `bun test ./packages/adapter-opencode/src/prompt-generation.test.ts ./packages/adapter-opencode/src/developer-team-install.test.ts ./packages/adapter-pi/src/developer-team-install.test.ts ./packages/adapter-pi/src/pi-team-profile.test.ts` | 194 | 0 | 0 | PASS |

## Build / Typecheck

| Check | Result | Details |
|---|---|---|
| Build | PASS | `bun run build:dry-run` completed successfully and produced the configured dry-run binary archive/checksum output. |
| Typecheck | WARNING | `bunx tsc --noEmit` exited with status 2. The first reported errors are in existing CLI/TUI, adapter, and test areas, including `apps/cli/src/pi-launch-command.direct-supermemory.test.ts`, `packages/core/src/skills/sdd/index.ts`, and `apps/cli/src/tui/app.tsx`. Apply progress already recorded full-project typecheck failures as pre-existing. |

## Compliance Matrix

| REQ-ID / Scenario | Method | Result | Notes |
|---|---|---|---|
| REQ-LANG-001 | Source inspection and core tests | PASS | Generated Developer Team content carries the English-only internal communication, returns, and artifact policy. |
| REQ-LANG-002 | Source inspection and tests | PASS | Policy permits necessary literal exceptions and tests avoid broad language detection. |
| REQ-LANG-003 | Artifact/source inspection | PASS | Change remains scoped to Deck-owned generated content and install-plan behavior. |
| REQ-ORCH-001 | Orchestrator tests | PASS | Delegation prompts are required to be English only. |
| REQ-ORCH-002 | Orchestrator tests | PASS | Sub-agent outputs and generated artifacts are required to be English only, with allowed literal exceptions. |
| REQ-ORCH-003 | Orchestrator tests | PASS | Direct orchestrator-to-user responses are required to use the user's language. |
| REQ-ORCH-004 | Orchestrator tests | PASS | Policy-violating sub-agent output repair is required by orchestrator reinforcement. |
| REQ-REG-001 | Core focused tests and review-fix inspection | PASS | Agent bodies, skill bodies, and session instructions include the central policy; `deck-init` and `deck-onboard` are now included in the core language-policy test iteration. |
| REQ-REG-002 | Core focused tests | PASS | Capability bundle composition preserves the policy and does not reintroduce the known leak. |
| REQ-ADAPT-001 | OpenCode focused tests | PASS | OpenCode generated prompts and install-plan skills preserve the policy and exclude the known leak. |
| REQ-ADAPT-002 | Pi focused tests | PASS | Pi install-plan files covered by Task 12 and the Pi runtime profile covered by Task 13 preserve the policy and exclude the known leak. |
| REQ-ADAPT-003 | Artifact/source inspection | PASS | Verification found no direct edits to installed runner files outside the Deck repository. |
| REQ-LEAK-001 | Focused tests | PASS | Required generated Developer Team and adapter output test surfaces exclude the known leak. |
| REQ-LEAK-002 | Focused tests | PASS | Core and adapter tests verify leak absence on generated and materialized output surfaces. |
| REQ-TEST-001 | Test inspection and execution | PASS | Tests assert positive policy presence across required core and adapter-generated surfaces, including the review-requested `deck-init` and `deck-onboard` core iteration. |
| REQ-TEST-002 | Test inspection | PASS | Tests use targeted policy/leak assertions, not broad natural-language detection. |
| REQ-TEST-003 | Test inspection and execution | PASS | Tests use a curated known-leak check for `herramienta`. |
| Scenario: Generated policy states internal English-only behavior | Tests and inspection | PASS | Policy is present on required core surfaces. |
| Scenario: Policy permits necessary literal exceptions | Source inspection | PASS | Policy includes literal exception categories. |
| Scenario: Scope remains within Deck-owned generation | Source/artifact inspection | PASS | No installed runner files are modified by the implementation. |
| Scenario: Orchestrator delegates to sub-agents in English | Orchestrator tests | PASS | Delegation prompt requirement is covered. |
| Scenario: Sub-agent outputs and artifacts are English only | Orchestrator tests | PASS | Return and artifact language requirement is covered. |
| Scenario: User-facing orchestrator response uses user language | Orchestrator tests | PASS | User-language requirement is covered. |
| Scenario: Orchestrator requests repair for invalid sub-agent language | Orchestrator tests | PASS | Repair behavior is covered. |
| Scenario: Core generated surfaces include the policy | Core tests | PASS | Core policy composition tests passed, including `deck-init` and `deck-onboard`. |
| Scenario: Capability bundles preserve the policy | Core tests | PASS | Serena capability bundle coverage passed. |
| Scenario: OpenCode generated output preserves the policy | OpenCode tests | PASS | OpenCode generated prompts and skills passed. |
| Scenario: Pi generated output preserves the policy | Pi tests | PASS | Pi install-plan and profile tests passed. |
| Scenario: Known leak is absent from generated content | Core tests | PASS | Core known-leak checks passed. |
| Scenario: Known leak is absent from adapter output | Adapter tests | PASS | Adapter known-leak checks passed. |
| Scenario: Tests use positive policy checks | Test inspection and execution | PASS | Positive policy assertions are present and passing. |
| Scenario: Tests avoid broad language detection false positives | Test inspection | PASS | No broad language detector is used as a required enforcement mechanism. |
| Scenario: Tests may use curated known-leak checks | Test inspection and execution | PASS | Curated leak checks are limited to the confirmed `herramienta` term. |

## Findings

### CRITICAL

None.

### WARNING

- Full-project typecheck still fails with pre-existing unrelated TypeScript errors. Focused tests for this change pass, and Apply progress recorded the typecheck failures as pre-existing.

### SUGGESTION

- The review report's pre-existing note about plural Spanish test names (`herramientas`) remains a future deny-list consideration only; no action is required for this change.

## Open Questions

None.

## Registry Intent

Registry write is deferred to the orchestrator.

- Intended phase: `verify`
- Intended status: `passed_with_warnings`
- Intended event: `verification.passed_with_warnings`
- Artifact: `verify-report.md`
