# Verify Report: Persistent Orchestrator Invariants

## Summary

**Overall Result**: PASS WITH WARNINGS  
**Verify Mode**: registry-deferred  
**Tasks Complete**: 9 / 9 marked complete  
**Change-Related Tests**: PASS (core invariants, content/manifest integration, OpenCode adapter, Pi invariant subset)  
**Build**: PASS (`bun run build:dry-run`)  
**Typecheck**: WARNING / baseline fail (`bunx tsc --noEmit` fails in unrelated existing areas)

## Task Completion

| Task | Status | Verification Notes |
|---|---|---|
| Task 1 | ✅ Complete | Schema + 5 critical records present. |
| Task 2 | ✅ Complete | Render/prepend/verify helpers present; core invariant tests pass. |
| Task 3 | ✅ Complete | Invariants injected at very start before context authority and bundles. |
| Task 4 | ✅ Complete | Core invariant tests pass. |
| Task 5 | ✅ Complete | Content registry + manifest integration tests pass. |
| Task 6 | ✅ Complete | OpenCode adapter tests pass. |
| Task 7 | ✅ Complete | Pi invariant verification call shape fixed; Pi invariant subset passes. |
| Task 8 | ✅ Complete with warning | Pi invariant subset passes; full Pi adapter file still has unrelated/baseline failures. |
| Task 9 | ✅ Complete | SDD Triage Gate documented as module; no separate “documentation triage” module/process. |

## Test Results

| Suite / Command | Result | Evidence |
|---|---|---|
| Core invariant unit tests | ✅ PASS | `65 pass, 0 fail` across `orchestrator-invariants*.test.ts`. |
| Content registry + manifest integration | ✅ PASS | `100 pass, 0 fail`. |
| OpenCode adapter install tests | ✅ PASS | `44 pass, 0 fail`. |
| Pi invariant-relevant tests | ✅ PASS | `3 pass, 0 fail, 61 filtered`. |
| Cross-suite invariant filter | ✅ PASS | `7 pass, 0 fail, 266 filtered`. |
| Focused changed-area files unfiltered | ⚠️ WARN | `265 pass, 8 fail`; all 8 in older Pi adapter expectations/path/idempotency, not invariant-specific. |
| Full `bun test` | ⚠️ WARN | `1739 pass, 50 fail`; failures are existing/baseline areas (config, project-root, TUI boundary, runner dashboard, Pi catalog counts, etc.), not attributable to this change. |

## Build / Typecheck

| Check | Result | Details |
|---|---|---|
| Build | ✅ PASS | `bun run build:dry-run` completed; produced `deck_v0.0.3_linux-x64.tar.gz` checksum output. |
| Typecheck | ⚠️ WARN | `bunx tsc --noEmit` fails in baseline/unrelated files. Previous change-related Pi invariant call-shape errors at `developer-team-install.ts(593/630)` are absent. Remaining same-file issue is line 367 model-thinking typing, not invariant verification. |

## Ordering / Stale Wording Verification

| Check | Result | Evidence |
|---|---|---|
| Spec stale ordering wording | ✅ PASS | Search found no stale “after Context Authority/after authority” contradiction. Current line 233 says invariants appear `FIRST`, `BEFORE context-authority`. |
| Composed session order | ✅ PASS | Manual check: `inv: 0`, `authority: 17818`, `starts: true`. |
| Composed agent order | ✅ PASS | Manual check: `inv: 0`, `authority: 3077`, `starts: true`. |
| Composed skill order | ✅ PASS | Manual check: `inv: 0`, `authority: 20853`, `starts: true`. |
| No separate “documentation triage” | ✅ PASS | `docs/prompt-methodology-modules.md` has one constraint sentence only; no module/process named documentation triage. |

## Compliance Matrix

| REQ-ID / Scenario | Method | Result | Notes |
|---|---|---|---|
| REQ-OIS-001 / schema fields | Source + tests | ✅ PASS | Required type/fields exist. |
| REQ-OIS-002 / five critical invariants | Source + tests | ✅ PASS | `INV-001`..`INV-005`, critical tier. |
| REQ-OIS-003 / tier ordering | Tests | ✅ PASS | Critical before higher tiers in renderer. |
| REQ-OIS-004 / very-start injection | Tests + manual order | ✅ PASS | Invariants start at index 0 before authority/bundles. |
| REQ-OIS-005 / all surfaces | Tests | ✅ PASS | Session, agent, skill covered. |
| REQ-OIS-006 / idempotent injection | Tests | ✅ PASS | No duplicate section/IDs on re-prepend. |
| REQ-OIS-007 / parseable header | Tests | ✅ PASS | `## Orchestrator Invariants`. |
| REQ-OIS-008 / verifier | Tests | ✅ PASS | Present and detects missing critical IDs. |
| REQ-OIS-009 / structured result | Tests | ✅ PASS | `{ pass, missing }`. |
| REQ-OIS-010 / high tier support | Tests/source | ✅ PASS | Tier type/render support exists. |
| REQ-OIS-011 / source trace | Tests/source | ✅ PASS | `sourceRefs` present. |
| REQ-OIS-012 / runner-agnostic | Tests/source | ✅ PASS | Invariant records avoid Pi/OpenCode runtime references. |
| REQ-IBC-001 / composition step first | Tests + manual order | ✅ PASS | Invariant → content → authority → bundles. |
| REQ-IBC-002 / session ordering | Tests + spec search | ✅ PASS | Spec and implementation now invariant-first. |
| REQ-IBC-003 / `PACKAGE_ORDER` unchanged | Source/tests | ✅ PASS | No invariant entry added. |
| REQ-IBC-004 / fragment type unchanged | Source/tests | ✅ PASS | No invariant fields added. |
| REQ-PMD-001 / docs exists | File check | ✅ PASS | `docs/prompt-methodology-modules.md` exists. |
| REQ-PMD-002 / SDD Triage, no separate module | Doc inspection | ✅ PASS | Existing SDD Triage Gate documented; no separate module. |
| REQ-PMD-003 / required structure | Doc inspection | ✅ PASS | Sections include governs/source/rules/surfaces. |
| REQ-PMD-004 / required categories | Doc inspection | ✅ PASS | Required module categories covered. |
| REQ-PMD-005 / invariants documented | Doc inspection | ✅ PASS | Orchestrator Invariants section exists. |
| REQ-PMD-006 / complements developer-team.md | Doc inspection | ✅ PASS | Does not duplicate roster/dependency graph. |
| REQ-BC-001 / semantics preserved | Tests + source | ✅ PASS | Behavioral invariant rules preserved in composed output. |
| REQ-BC-002 / existing tests | Full test run | ⚠️ WARN | Full suite still red from baseline/unrelated failures; no invariant-attributable failures found. |
| REQ-BC-003 / adapter API types | Typecheck/source | ⚠️ WARN | Return types unchanged; full project typecheck remains baseline red. |
| REQ-BC-004 / no duplicate invariant text | Tests | ✅ PASS | One invariant block per composed surface. |

## Findings

### CRITICAL

- None.

### WARNING

- **Baseline test failures remain**: full `bun test` reports `50 fail`; focused invariant tests all pass. Failures observed in unrelated/baseline areas such as Deck config persistence/defaults, project-root expectations, TUI boundary/dashboard tests, Pi catalog count/path expectations, install-tools messages, and existing binary smoke timeout.
- **Baseline typecheck remains red**: `bunx tsc --noEmit` fails across existing CLI/adapter/config/test typing issues. No previous invariant call-shape errors remain.
- **Focused changed-area unfiltered Pi adapter file still red**: 8 failures in legacy expectations/idempotency unrelated to invariant checks; Pi invariant subset passes.

### SUGGESTION

- Follow up on review warning: replace adapter inline invariant verifier copies with core import once `@deck/core` export typing is stable.

## Commands Run

| Command | Result |
|---|---|
| `bun test packages/core/src/teams/developer/orchestrator-invariants.test.ts packages/core/src/teams/developer/orchestrator-invariants.task2.test.ts` | ✅ `65 pass, 0 fail` |
| `bun test packages/core/src/teams/developer/content-registry.test.ts packages/core/src/teams/developer/manifest.test.ts` | ✅ `100 pass, 0 fail` |
| `bun test packages/adapter-opencode/src/developer-team-install.test.ts` | ✅ `44 pass, 0 fail` |
| `bun test packages/adapter-pi/src/developer-team-install.test.ts -t "orchestrator invariants"` | ✅ `3 pass, 0 fail` |
| `bun test ...focused files... -t "orchestrator invariants"` | ✅ `7 pass, 0 fail` |
| `bun test ...focused files...` | ⚠️ `265 pass, 8 fail` baseline Pi adapter expectations |
| `bun run build:dry-run` | ✅ PASS |
| `bunx tsc --noEmit` | ⚠️ FAIL baseline/unrelated type errors |
| `bun test` | ⚠️ `1739 pass, 50 fail` baseline/unrelated failures |
| Spec/docs grep checks | ✅ No stale ordering contradiction; no separate documentation-triage module |
| Manual composition order check | ✅ session/agent/skill all start with invariants |

## Registry Intent (Deferred)

- **Registry Write**: deferred
- **Intended phase**: `verify`
- **Intended status**: `passed_with_warnings`
- **Intended artifact**: `verify-report.md`
- **Intended event**: `verification-passed-with-warnings`
- **Registry blocker**: none; deferred by orchestrator instruction.

## Open Questions

- None.
