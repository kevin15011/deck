# Verify Report: Keep AGENTS.md as a Repository Guide

## Result

**PASS** for the scoped functional candidate.

## Evidence

| Check | Result |
|---|---|
| Codex planner, instruction translation, transaction, adapter, and runner-sync focused tests | PASS — final independent review reported 67 focused tests with zero failures. |
| Documentation governance | PASS — root guide rejects managed runtime markers and retains architecture/development navigation. |
| TypeScript | PASS — `node node_modules/typescript/bin/tsc --noEmit`. |
| Scoped whitespace/error check | PASS — `git diff --check -- . ':!.serena/project.yml'`. |
| OpenSpec Registry | PASS — zero errors and warnings before final lifecycle updates; revalidated after updates. |

## Behavioral verification

- Fresh and content-only Codex plans do not create or append `AGENTS.md`.
- Native roles and skills retain canonical and selected capability instructions.
- Exact owned marker cleanup preserves surrounding bytes and mode and is rollback-safe.
- Unsafe, ambiguous, changed, or unowned targets fail closed.
- One authoritative snapshot prevents discovery-time edits from being overwritten.
- Ownership-only release validates apply and verify state without writing the guide.
- Durable version-1 tombstones make external ownership reconciliation idempotent and retryable across fresh adapter instances.

## Exclusions

- No network, provider calls, real runner installation, user-home writes, release build, or broad release-readiness claim.
- The unrelated `.serena/project.yml` worktree change was excluded.
