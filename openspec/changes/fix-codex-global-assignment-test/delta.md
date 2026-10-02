# Codex global assignment release test

Status: verified locally; upstream release rerun pending.

Failed release workflow: https://github.com/kevin15011/deck/actions/runs/37053129290

## Outcome

The global Codex ownership test must exercise an assignment change using authenticated model evidence and verify that the assigned model and reasoning are persisted under the Codex home, independent of the project being opened. It must not require Deck to silently omit an unconfirmed assignment.

## Targets and evidence

- `packages/adapter-codex/src/runner-adapter.tools.test.ts`: use the Codex model fixture and the production preparation/planning path; assert the applied role TOML and global cross-project reads.
- The previous assertion expected `blocked: false` from a direct unprepared plan with no catalog, which conflicts with the fail-closed protection in PR #12. The original test then manually inserted fields after asserting they had been omitted.
- Before: isolated test failed at `expect(withModels.blocked).toBe(false)`.
- After: isolated test passed; full `runner-adapter.tools.test.ts` passed (20 tests, 126 assertions, 217.91 seconds); `bunx tsc --noEmit` passed.
- A local repository-wide `bun test --timeout 30000` was attempted but exceeded the 420-second command limit and reported unrelated failures in Claude Supermemory credential tests and timeouts in Codex Supermemory launch tests. No full-suite pass is claimed; the reported CI failure had only the Codex global-assignment assertion.
- The three reported opt-in skips are unrelated to the failing assertion.
