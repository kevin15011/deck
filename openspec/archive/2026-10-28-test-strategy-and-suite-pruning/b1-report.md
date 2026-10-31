# B1 tier reclassification

Status: B1 reclassification and requested measurements complete. Verification is not green; unresolved failures are listed below.

- 149 files renamed with `git mv`: 114 to integration, 35 to e2e. No deletions, no commits, no assertion changes except required path-literal reference updates. Existing unrelated work preserved. One previously untracked Claude session-skills test needed `git add --intent-to-add` before `git mv`; its content is unchanged.
- Mapping: `/tmp/deck-b1-mapping.txt`; classification reasons and pre-rename hashes: `/tmp/deck-b1-applied.json`.
- Serial per-file measurements: `/tmp/deck-b1-times.jsonl`, logs `/tmp/deck-b1-logs/`. Bun 1.4.0; 15-second outer measurement cap, 10-second default test timeout (individual explicit timeouts may override). All 627 discovered files measured, including scripts, tests and benchmarks. 31 outer-cap timeouts are classification evidence, not final test failures. Background Deck/runner services remained active; no competing test suite was observed.
- Retained fast files: maximum measured wall time 2.973 seconds. Tier inventory: 468 fast + 120 integration + 39 e2e = 627. `bun scripts/test.ts --self-check` passed.
- Updated workflow, diagnostic-script, documentation and test path references. No matching B1 path in baseline-health required replacement. OpenSpec change/history records untouched. `scripts/test.ts` discovers suffixes dynamically and needed no change.
- `bunx tsc --noEmit` passed; `git diff --check` passed. The three tier runs collectively cover the full discovered inventory; no additional redundant full/changed run was launched.

## Results

Fast: 62.425 seconds, 5,671 pass / 2 fail, completed normally. Prior fast run was interrupted at 596.6 seconds: this completed run took 10.46% of that elapsed time (89.54% less), though the old run was incomplete. Under the provisional 90-second target.

Pre-existing assertion failures reproduced before any B1 rename:
- `scripts/release-build-contract.test.ts`: expects Bun 1.3.12 while packageManager/workflows specify 1.4.0; `.bun-version` remains 1.3.12. Protected release test left unchanged.
- `tests/documentation-governance.test.ts`: unsupported `bun test <file>` placeholder in AGENTS.md. Assertions left unchanged.

The standalone session-commands measurement also reported an internal `timeout: reply`; final tier results supersede this sample.

Raw tier logs: `/tmp/deck-b1-fast.log`, `/tmp/deck-b1-int.log`, `/tmp/deck-b1-e2e.log`; machine-readable wall time/exit status: `/tmp/deck-b1-tiers.json`.

## Integration findings

Integration completed in 881.683 seconds: 2,499 pass, 3 skip, 16 fail, plus 1 error between tests. Two failures are genuine assertion mismatches in `apps/web/src/session-codebase-availability.int.test.tsx`: Claude unsupported/unavailable preparation returns `failed` instead of `ready`. The other fourteen failures are timeouts: runner-sync (1), push-attention-store (3), session-manager large completion batch (1), web-push capacity/durability cases (3), codex-supermemory-launch (1), web Codebase availability absent/disabled/cancellation (3), session-commands reply (1), release-check-transport (1). The error between tests is another timeout: waiting for all children complete. These protected behavior/speed issues remain for their owning work or B2.

The integration tier exceeds the provisional 10-minute PR-job budget even before other CI steps; reclassification achieves the fast budget but does not solve total suite runtime.

## Final e2e and handoff

E2e completed in 191.476 seconds: 243 pass, 8 skip, 1 fail across 39 files. Genuine smoke assertion failure: `apps/cli/src/session-smoke.e2e.test.ts` S1 Claude reports `claude-session-skills-unverified`; the fake-Claude fixture has no verified current team generation, so the turn fails before the expected end-to-end checks. Native Codex/OpenCode smoke tests passed. This intersects the concurrent Claude parity work and was left unchanged.

Final totals: 8,413 pass, 11 skip, 19 fail, plus 1 between-tests error across 627 files. Of the 19 failures, 14 are timeouts and 5 are assertion failures (2 fast, 2 integration, 1 e2e); the between-tests error is also a timeout. Combined tier wall time: 1,135.584 seconds.

After the final documentation path update, the focused documentation-governance test was rerun: 17 pass / 1 fail, the same existing AGENTS.md placeholder failure (`/tmp/deck-b1-docs-final.log`). The releasing guide now uses `bun run test:int` for preparation-test coverage. Final inventory self-check and diff whitespace check passed.

No full-suite rerun is needed: the three completed disjoint tier runs covered the entire inventory once. Typecheck evidence remains valid because only documentation changed afterward. No commits, test deletions, assertion logic changes, production-code modifications, OpenSpec changes, or destructive Git operations were made by B1. Path literals in reference-list assertions were updated as required.

Acceptance: fast completes under 90 seconds, every retained fast file measured below 3 seconds, all three tier totals recorded, full inventory accounted for, and mapping delivered. Green-suite and PR-duration goals remain unmet by the recorded failures and integration runtime; B2 / the concurrent Claude work must resolve them.
