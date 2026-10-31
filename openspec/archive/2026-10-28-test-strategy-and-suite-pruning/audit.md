# Deck test-suite audit (read-only, attempt 2)

**CSV:** `/tmp/deck-audit/files.csv` (621 tracked test files). Raw material is in `/tmp/deck-audit/` (`*.xml`, `*.log`, `cli_times.txt`, `static.json`).

**Caveats:**
- An apply agent was active, and the session-host suite ran 681s. Treat single timings as indicative.
- `apps/cli` timed out at 900s with no XML. I re-ran its 136 files individually, 4 in parallel with `timeout 120`. Those durations are inflated by roughly 2–4×.
- `scripts/`, `tests/` and `benchmarks/` were not timed, so their duration cells are blank.
- Categories come from grep heuristics, so they are estimates. The protected-area tags in the CSV are filename regexes (for example "state" tags many files as data-integrity), so confirm them per batch.

## 1. Per package

Tracked files only. `packages/core` has 267 test files on disk, but 162 are vendored under `skills/external` and ignored by `bunfig.toml`.

| Package | Files | Tests | Test LOC | Src LOC | Ratio | Wall | Notes |
|---|---|---|---|---|---|---|---|
| apps/cli | 136 | 1503 | 37.1k | 31.5k | 1.18 | **900s timeout** | 3 files hit the 120s timeout. 6 files failed under contention, so they may not be real failures. |
| apps/web | 42 | 305 | 3.4k | 11.3k | 0.30 | 59s | 5 fail, all in `session-codebase-availability.test.tsx`. |
| adapter-claude | 16 | 182 | 2.5k | 2.5k | 1.00 | 47s | |
| adapter-codex | 30 | 343 | 5.7k | 6.7k | 0.85 | **323s** | 2 files account for 243s. |
| adapter-opencode | 43 | 645 | 12.0k | 13.3k | 0.90 | 55s | |
| adapter-pi | 99 | 980 | 17.4k | 16.5k | 1.06 | **297s** | |
| adapter-supermemory | 5 | 46 | 0.9k | 1.1k | 0.83 | 1s | |
| core | 105 | 1728 | 23.3k | 28.8k | 0.81 | **16s** | Fastest package per test. |
| provider-tavily | 1 | 2 | 42 | 51 | – | 0s | |
| sdd-runtime | 69 | 746 | 17.4k | 19.2k | 0.90 | **9s** | |
| session-host | 53 | 867 | 12.9k | 10.8k | 1.20 | **681s**, 4 fail | 3 of the failures are 30s timeouts in `push-attention-store.test.ts`. |
| scripts | 17 | 142 | 3.0k | 4.8k | 0.62 | not run | |
| tests/ | 4 | 29 | 0.9k | – | – | not run | |
| benchmarks | 1 | 3 | 51 | – | – | not run | |
| **Total** | **621** | **~7.5k** | **136.7k** | | | | |

- **Where the time goes:** summed per-file time is about 2300s. 72 files over 3s account for about 2155s, which is 93%. The other 549 files take about 160s combined.
- **The cheap part is cheap:** `core` plus `sdd-runtime` hold 174 files and 2474 tests and run in about 25s together.
- **Failing files** (each also holds a must-keep or slow test; check contention before judging):
  - `session-host/__tests__/push-attention-store.test.ts`
  - `session-host/__tests__/web-push.test.ts`
  - `apps/web/src/session-codebase-availability.test.tsx`
  - `apps/cli/src/runner-launch-command.test.ts`
  - `apps/cli/src/session-commands.test.ts`
  - `apps/cli/src/tui/release-check-transport.test.ts`
  - `apps/cli/src/tui/app.synthetic-runner.test.tsx`
- **Failure caused by the in-flight Pi/prompt work:** `apps/cli/src/verification-parity.test.ts` fails with "agent prompts consume canonical role bodies". It is a new test and likely belongs to the in-progress change. I did not check what it is missing.
- **Flakiness:** I did not re-run anything, so I have no flakiness data. The failures above are timeouts or contention-sensitive.

## 2. Top 30 slowest files

CLI values are inflated by the 4× parallel sampling.

| ms | Tests | Fail | File |
|---|---|---|---|
| 168731 | 31 | 0 | adapter-codex/src/runner-adapter.test.ts |
| 133695 | 9 | 3 | session-host/__tests__/push-attention-store.test.ts |
| >120000 | – | timeout | apps/cli/src/codex-supermemory-launch.test.ts |
| >120000 | – | timeout | apps/cli/src/session-smoke.test.ts |
| >120000 | – | timeout | apps/cli/src/upgrade-command/runner-recovery-composition.test.ts |
| 107159 | 36 | 1 | session-host/__tests__/web-push.test.ts |
| 95949 | – | fail | apps/cli/src/runner-launch-command.test.ts |
| 90870 | – | 0 | apps/cli/src/upgrade-command/__tests__/runner-sync.test.ts |
| 77392 | – | 0 | apps/cli/src/native-interactive-authority.test.ts |
| 74877 | 6 | 0 | adapter-codex/src/runner-adapter.tools.test.ts |
| 60588 | 4 | 0 | session-host/__tests__/git-diff-process.test.ts |
| 57503 | – | fail | apps/cli/src/tui/app.synthetic-runner.test.tsx |
| 55003 | 20 | 5 | apps/web/src/session-codebase-availability.test.tsx |
| 52160 | 26 | 0 | session-host/__tests__/web-push-daemon.test.ts |
| 50618 | 28 | 0 | adapter-pi/src/pi-codebase-guard.test.ts |
| 50269 | – | 0 | apps/cli/src/native-package-retirement-install.test.ts |
| 49849 | – | 0 | apps/cli/src/pi-client-proof.native.test.ts |
| 46457 | – | 0 | apps/cli/src/native-package-retirement-fresh.test.ts |
| 39569 | 72 | 0 | adapter-opencode/src/developer-team-execution-reachability.test.ts |
| 38852 | 29 | 0 | adapter-claude/src/runner-adapter.test.ts |
| 35910 | 8 | 0 | adapter-pi/.../tool-policy/pi-cli.contract.test.ts |
| 33887 | – | 0 | apps/cli/src/claude-team-launch.test.ts |
| 29826 | 8 | 0 | adapter-pi/.../memory/pi-cli.contract.test.ts |
| 26815 | – | 0 | apps/cli/src/upgrade-command/__tests__/orchestrator.test.ts |
| 24723 | 5 | 0 | session-host/__tests__/project-trust-revision.test.ts |
| 23570 | – | 0 | apps/cli/src/runner-migration-recovery.test.ts |
| 21632 | – | fail | apps/cli/src/tui/release-check-transport.test.ts |
| 21114 | 26 | 0 | session-host/__tests__/git-diff.test.ts |
| 17245 | 5 | 0 | adapter-pi/src/pi-native-reconnect.test.ts |
| 15865 | 4 | 0 | adapter-pi/.../subagents/pi-cli.contract.test.ts |

## 3. Category shares

Shares use the design §12 codes (K, C, I, S, G) plus **O** for one-off or retirement-named tests. I could not detect T (type-redundant), D (duplicate) or F (flaky) with grep. They need the fault-probe and git-history work that §12 describes.

| Code | Files | LOC | Tests | Heuristic |
|---|---|---|---|---|
| K | 461 | 76.2k (56%) | 4416 | Default bucket: behavioral or contract tests. |
| S | 98 | 43.1k (32%) | 1794 | Filename has `e2e`, `integration` or `.int.`, or the file has 4 or more spawn/fs/network/tmpdir calls. Slow but valuable. |
| C | 41 | 15.1k (11%) | 1204 | Phrase assertions are over 50% of expects, with at least 3 of them, on content-like files. |
| G | 9 | 0.7k | 30 | Generated-artifact or freshness tests (filename). |
| O | 7 | 0.7k | 43 | Filename contains retirement, historical or regression. |
| I | 5 | 1.0k | 34 | More than 60% of assertions are mock or call-count assertions. |

- **Phrase assertions overall:** 6454 of 24054 `expect(` calls (27%) are `toContain`, `toMatch` or `toInclude`. 93 files have phrase assertions as the majority of their expects.
- **Where they concentrate:** core has 2022 of 4169 expects as phrase assertions (48%). Pi has 929 of 3429. apps/cli has 1535 of 5330.
- **Under-counted phrase tests:** the C bucket only counts files that match the content-like filter. The CSV `reason` column records the phrase counts.

## 4. CI and local running

- **Local:** `package.json` has one script, `"test": "bun test --timeout 30000"`, which runs the whole repo in one process. There is no tiering, no affected-only or watch mode, and no sharding.
- **CI:** `.github/workflows/release.yml` runs the same full `bun test --timeout 30000`. It first runs the generator tests (`generate-pi-extension-assets` and `generate-runner-execution-assets`), then `tsc`, an OpenSpec validate, `bench:memory` and `verify:supermemory-compiled`.
- **No PR workflow:** no CI workflow runs on pull requests. The other two workflows (`darwin-reader-diagnostic`, `retirement-historical-diagnostic`) are diagnostics.
- **Why one process is slow:** the 29-minute no-result run came from serial execution, with 2155s of subprocess-heavy files and 3 CLI files that hit the timeout.

## 5. Proposed batches

Savings are measured seconds. CLI figures are inflated, so treat them as upper bounds. Nothing is removed without per-batch user approval (§12).

| Batch | Scope | Files / tests / LOC | Runtime saved | Risk |
|---|---|---|---|---|
| **B0** | Phrase/content tests: `packages/core/src/teams/developer/*-content.test.ts`, `orchestrator-invariants`, `user-phase-communication`, `content-registry`, Pi `pi-team-profile`, `adapter-opencode/prompt-memory-injection`, `tests/documentation-governance`, CLI `pi-launch-command*`. Replace with content invariants (§13) and the parity test (§8). | ~41 files (C), 1204 tests, 15.1k LOC | ~40s, because the files are fast. The saving is mostly LOC and maintenance, about 11% of LOC. | Low to medium. `verify-content` and `content-registry` touch the release and data-integrity areas, so do block-level changes there and run the fault probe first. |
| **B1** | Tier reclassification. Move 127 slow or subprocess files to `.int.`, and 11 `native` / `*e2e*` / `binary` / smoke files to e2e. Leave `scripts/` and `tests/` out until timed. | 138 files, about 47k LOC | About 2100s (91%) moves out of the fast tier. Nothing is deleted. | Low. The risk is losing coverage on PRs, so keep the int tier in PR CI. |
| **B2** | Speed fixes in 5 outlier files, without removing coverage: the two codex `runner-adapter*` tests (243s), `push-attention-store` (134s, already failing at 30s), `web-push*` (160s combined), `pi-codebase-guard` (50s) and `session-host/git-diff-process` (61s). | 5–7 files | About 400–500s | Medium. These are protected session-lifecycle tests. Find why they take 30s+ before touching the oracle. |
| **B3** | Retirement and one-off regression tests: `package-retirement*` (3 core files), `scripts/retirement-*` (3), `apps/cli/native-package-retirement-install` (50s) and `-fresh` (46s). Check `git log -S` and the OpenSpec reference for each. | 7 + 2 G files, about 1.4k LOC | ~100s (CLI figure inflated) | Medium. Some guard the release/install area, so decide per file and keep one live proof. |
| **B4** | Implementation-mirroring tests (category I): `core/serena-bootstrap`, `adapter-opencode/runner-adapter.inventory`, `scripts/linux-install-sandbox`, 2 TUI progress screens. Rewrite them at the boundary. | 5 files, 1.0k LOC | Negligible | Low. |
| **B5** | Duplicate detection across the per-runner adapters (claude 16, codex 30, opencode 43, pi 99 files). They are largely parallel structures, but I did not measure duplicates, so this batch needs a similarity pass first. | TBD | TBD | Unknown. |

## 6. Must keep (protected-risk list)

These are tagged `keep` or `tier-*`, never `retire`. Block-level C/I/T cleanup inside them follows the §12 process.

- **Git safety:** `packages/core/src/teams/developer/git-safety.test.ts` and adapter discard-protection hook tests.
- **Approvals and authority:**
  - session-host approval and scope tests
  - sdd-runtime `qa-authority`, `qa-execution-authority`, `qa-runner-host-authority` and `readiness-authority`
  - `apps/cli/src/native-interactive-authority.test.ts` (77s, tier-int)
- **Session lifecycle:**
  - `session-manager`, `recovery.integration`, `cross-runner.e2e`, event-ledger and transport tests
  - `push-attention-store`, `web-push*` and `project-trust-revision` (fix their speed rather than demote them)
- **Release and install:**
  - `tests/release-workflow.test.ts`
  - `scripts/release-build-contract`, `install-canary` and the `generate-*` freshness tests
  - `apps/cli/src/tui/__tests__/runner-install-e2e.test.tsx`
  - adapter preflight, migration/rollback/backup tests
  - `runner-sync`, `runner-migration-recovery` and `upgrade-command/orchestrator` (tier-int)
- **Data integrity:** OpenSpec state and registry writers, `baseline-evidence`, `init-state`, config-merge and model-migration.
- **Security:** secret handling, path traversal and sandbox, and MCP bridge authorization (`mcp-bridge` has a pending diff from the apply agent).
- **Runner parity:** the new `verification-parity.test.ts` and the adapter materialization-layout tests. The parity test needs to pass before the B0 retirements.

## 7. Next steps if approved

1. Create `scripts/test.ts` with `--tier` and `--changed` options, as in design §11.
2. Run B1 first, since it needs no deletions.
3. Time the `scripts/` and `tests/` files, then re-run `apps/cli` serially on an idle machine to get clean durations.
4. Run the fault probe on B0 and B3 before anything is retired.