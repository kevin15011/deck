# Attempt 38 — default four-worker gate closed

Outcome: the unchanged current tree passes the default full gate. No scheduling change or further repair was needed. No repository edits, commits, timeout changes, test deletions, quarantine, or new skips in this continuation.

## Verification

Candidate before and after the full run: `0b7008023b4320c5efd2d6a46a9a45eea9f1a4ce:5adf3e95bde53edce11897b467c56d701d6a0f46`. Captured through a temporary alternate Git index; the real index was not modified. Evidence files: `/tmp/deck38-candidate-before.txt` and `/tmp/deck38-candidate-after.txt`.

- `bun run test:full` | source: current Lead instruction, CONTRIBUTING.md, package.json and release CI | scope: all **638/638 files**, Bun 1.4.0 **4x PARALLEL** | **7,657 pass / 11 skip / 0 fail**, **7,668 tests**, **99,407 assertions** | **exit 0** | **972.67 seconds**. Log: `/tmp/deck38-four-full.log`.
- `bunx tsc --noEmit` | source: current instruction and repository conventions | scope: workspace | **exit 0**, no diagnostics. Approximately 32 seconds observed; exact duration not separately instrumented. Log: `/tmp/deck38-tsc.log`.
- `git diff --check` | scope: existing workspace diff | **exit 0**.

The nested `module0.test.ts` failure in the log is intentional: the wrapper integration test verifies propagation of a failing subprocess and itself passes. The authoritative final top-level summary reports zero failures.

## Decision and scope

Keep the existing four-worker default. The run includes the previous native-install journal isolation and all existing workspace changes. This successful complete default invocation closes the prior two-worker-only evidence gap. It does not establish that no future scheduling-sensitive failure is possible, nor prove that shared journals were the sole historical cause.

No new tests or code changes were needed. Existing unrelated edits were preserved. OpenSpec lifecycle records remain for Lead to integrate centrally.

Loaded the exposed deck-verification skill. Skill Discovery Context was absent/indeterminate; bounded direct discovery was used. Adaptive memory was disabled. Graph project deck was confirmed ready (reported generation timestamp 2026-08-20T17:25:00Z); no structural graph claims were required for this execution-only outcome.
