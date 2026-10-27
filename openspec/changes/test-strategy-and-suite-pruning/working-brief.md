# Test strategy research and suite pruning

Status: Full SDD designed; U1/R1/R2/R4 and B1 committed (b71ffbb). No tests deleted yet.

## Intent

The user believes Deck writes and runs automated tests without clear value criteria: the repo suite is large (~622 test files, ~138k test LOC, roughly 1:1 with source), covers minor details, and is slow enough to obstruct development because agents run it while implementing. Validate against current industry practice and research (including AI-generated tests), compare with peer projects (`~/nebula`, Shopify themes), and plan a pruning that keeps only tests with real stability value.

## Acceptance

- Evidence-based criteria for test value, cost, tiering and AI-agent test writing, with sources.
- Data on Deck's suite: inventory, runtime, slowest files, category shares.
- Deck's agent testing rules quoted, with a keep/revise/remove verdict.
- Peer-project comparison.
- Pruning plan with must-keep protections; the user approves the complete plan once, then all batches execute as separate revertible commits.

## Authority (user, 2026-10-26)

The user authorized a full rethink: rewrite testing skills, agent instructions, contracts and invariants as needed, drop `strict_tdd`, and prune the Deck suite to what adds real value. Goal: the best quality/speed trade-off for an agent engineering system, even if the philosophy changes.

## Scope constraint (user, 2026-10-26)

The doctrine is for every kind of developer and project Deck serves, not this repo, Bun, Shopify or frontend specifically; those were only the user's examples. Keep the doctrine language-, framework- and stack-neutral, with stack-specific tools as illustrative mappings resolved from the target project's own conventions. It must apply equally to Deck installed natively in each runner (Pi, OpenCode, Codex, Claude) and to the Deck cross-runner session (session-host Lead + delegated members). Deck-repo pruning and Bun tiering are one concrete application, not the doctrine itself.

## User decisions (2026-10-26)

- Q1 Bun pin: upgrade from 1.3.12 to 1.4.x as its own slice (enables `bun test --changed` and `--parallel`).
- Q2 PR CI: yes, add a workflow running typecheck plus fast and integration tiers on pull requests.
- Q3 Model-backed evals: no budget or API secret. Build the harness only if cheap; it runs manually and is never a required CI gate.
- Q5 Session-host candidate capture (U4): accepted by Lead under the user's broad authority, as a late slice after U3.
- Q4 Pruning approval: approve the complete pruning plan once; then execute every batch without per-batch approval, each as an isolated revertible commit with the full suite run.

## Non-goals

- Removing protections for protected risk (git safety, approvals/authority, session lifecycle, release/install, data integrity).

## Progress

- Investigate tasks: external research `task-d9d057e7-49d4-487e-8824-c472f24a87cd`; suite audit `task-535e1c2f-b9ff-47a4-be4a-8fa1a0a7d0e4`; agent test policy + peers `task-04081a38-f937-4c5d-ad49-1ce3a391a3c2`.
- External research integrated (seq 2492). Agent policy + peers integrated (seq 2498): over-testing drivers are the external TDD skill (rationalization table, "every new behavior has a test", "run tests after every refactor step"), `strict_tdd: true` in `openspec/config.yaml`, "sufficient coverage" as a non-negotiable in code-economy, Full SDD Verify re-running evidence per stage, and no "do not test" list for copy/markup/prompt text. Adaptive APPLY_TDD/Quality rules are already proportional. Peer evidence: espritec-theme has ~40% string/regex asserts on Liquid/JSON with Claude co-author trailers; store-theme/horizon rely on lint, theme-check, Lighthouse and few targeted tests.
- Direct delta (done): `deck_delegate` now explains why `commandId` without `replan` is rejected (`packages/session-host/src/session-manager.ts`), and the tool description states the rule (`packages/session-host/src/mcp-bridge.ts`). Regression assertion added in `session-manager.test.ts`; `session-manager.test.ts` + `bridge.test.ts`: 347 pass (70.8s). Takes effect for live sessions after rebuild/canary install.
- Deeper verified research: continuation of `task-d9d057e7-49d4-487e-8824-c472f24a87cd` (attempt 2).
- Deeper research integrated (seq 4727), persisted as `research.md`; rules/peers persisted as `policy-and-peers.md`.
- Architect `task-6dc20844-74ee-4b25-9db2-f9c94d0dbd43` drafting Full SDD (proposal/spec/design/tasks); per-file pruning batches to be filled from the audit via continuation.
- Architect attempt 1 integrated (seq 5961); attempt 2 revising for stack neutrality and native/cross-runner parity. Audit still running the full suite (>21 min wall clock at last check).
- Architect attempt 2 integrated (seq 7067): universal doctrine vs Deck-repo split, runner parity design, candidate-digest evidence reuse.
- Apply-fast `task-09d3d118-1f29-42bf-9f83-bb3d6603c18c`: U1, R1, R2, R4 (no deletions, no commits).
- PAUSED (user, 2026-10-26: internet cut). Cancelled apply-fast `task-09d3d118-1f29-42bf-9f83-bb3d6603c18c` before any file edits, and the audit `task-535e1c2f-b9ff-47a4-be4a-8fa1a0a7d0e4` (full suite killed after ~29 min without finishing; no runtime data captured). Resume: relaunch the audit with per-package timed runs instead of one full-suite run, and continue apply-fast on U1/R1/R2/R4.
- RESUMED (user, 2026-10-26). Audit attempt 1 discarded (seq 7712, no data). Audit relaunched as attempt 2 with per-package timed runs and CSV output; apply-fast resumed as attempt 2 on U1/R1/R2/R4 with Lead's delegate fix preserved and `git mv` renames.
- Lead verification of Architect's "cross-runner members never receive skills" claim: partially correct. `sessionRolePrompt` (`apps/cli/src/session-service.ts:83-96`) injects only the compact role body; skills are left to each runner's native loader (`session-shared-services.ts:57`). Pi sessions pass the Deck package via `--extension` (skills available); OpenCode adds `~/.claude/skills` and `~/.agents/skills` paths; Codex uses its native config. Claude session children get `--plugin-dir` only for the ready memory plugin (`adapter-claude/src/session-driver/launch.ts:62,110`), not the Deck team plugin, so Deck's STANDALONE_SKILLS are absent there (confirmed: this Claude Lead session lists no Deck skills). Consequence: doctrine must live in role bodies (planned) and the Claude skill gap is a separate parity defect to fix.
- Apply-fast attempt 2 integrated: U1 (content-invariants + verification-parity guards, mutation-proven), R1 (`scripts/test.ts` tier wrapper, 7 `git mv` renames to .int/.e2e, root scripts, CONTRIBUTING/AGENTS), R2 (`openspec/config.yaml` proportional policy, valid block YAML), R4 (PR `ci.yml`, `tests/quarantine.yaml`, Bun pin 1.4.0 + regenerated assets; `release:verify` passed). Full report copied to `apply-progress.md`. Lead spot-check: 38 pass in 1.54s. Nightly (R4.2) deferred.
- Open: fast tier selected 616 files and was stopped at 596.6s with 5 timeouts (push-attention-store, release-check-transport, runner-sync); fast budget unmet until audit reclassifies/prunes slow tests. Concurrent audit contention possible.
- New defect found by apply: adaptive roles rendered with the `legacy` profile (used by the Claude plugin) omit `ADAPTIVE_TEAM_RUNTIME_CONTRACT` and the Git discard protection block. Safety parity gap for native Claude; fix belongs with U2 or session-skill-availability.
- User decision (2026-10-26): legacy prompt profile and legacy SDD roles are being removed (see `session-skill-availability`). U2 must not rewrite legacy role content (apply-general/frontend/backend, verify, orchestrator, task); only the adaptive roles and the profile that survives. Legacy-only tests join the pruning plan.
- Audit attempt 2 integrated (seq 19457), persisted as `audit.md` + `audit-files.csv` (621 files). Key data: ~2300s summed per-file; 72 files (>3s) = ~2155s (93%); remaining 549 files ~160s; core+sdd-runtime 2474 tests ~25s; 27% of expects are phrase assertions (core 48%). Proposed batches: B0 phrase/content (~41 files, 15.1k LOC, replaced by content-invariants + parity guards), B1 tier reclassification (138 files to int/e2e, no deletion, ~91% of fast-tier time), B2 speed fixes on protected slow files (no coverage loss), B3 retirement/one-off regressions (per-file decision), B4 implementation-mirroring rewrites, B5 cross-adapter duplicates (needs similarity pass). `verification-parity.test.ts` failure seen by the audit was in-flight state; Lead re-run now 14 pass.
- Ordering: legacy removal first (deletes legacy content and its tests, shrinking B0), then B1, B0, B2, B3, B4, B5.
- USER APPROVAL (2026-10-26): complete pruning plan approved once (B1 tiers, B0 phrase tests, B2 speed fixes, B3 retirement/one-off, B4 mirror rewrites, B5 duplicates per the audit and design §12 process). Batches execute without per-batch approval, each as an isolated revertible commit with fault probe, full suite and tsc. Must-keep protections unchanged. Order: B1 now (no deletions); legacy removal; then B0, B2, B3, B4, B5.
- B1 integrated (seq 26726): 149 files `git mv` (114 int, 35 e2e); inventory 468 fast + 120 int + 39 e2e = 627. Fast tier 62.4s complete (was interrupted at 596.6s), max retained file 2.97s; int 881.7s (exceeds 10-min PR budget); e2e 191.5s. Report `b1-report.md`, mapping `b1-mapping.txt`. Failures: 14 timeouts (B2 scope) + 5 assertion failures, of which 4 are regressions from this session's own work (`.bun-version` left at 1.3.12; AGENTS.md placeholder vs documentation-governance; Claude fail-closed vs session-smoke and codebase-availability fixtures). Fixes delegated to the owning apply tasks (09d3d118 attempt 4, b475cdb9 attempt 3). Open: integration tier too slow for PR CI; B2 must address it.
- Regression fixes integrated: Bun 1.4.0 pin completed (`.bun-version`, release contract test, CONTRIBUTING, git-diff qualification guard) and AGENTS.md placeholder fixed (seq 28364): fast tier 5,673 pass / 0 fail in 71.2s, tsc ok. Claude fixtures now install a verified team generation; production unchanged because native Claude also blocks unverified installs (`claude-plugin-unverified`) (seq 28370).
- Next: commit the accumulated candidate in logical commits (needs user authorization), then legacy removal in its own commit, then parity S1-S8 and B0/B2-B5.
- Committed (user-authorized, 2026-10-26, main, not pushed): `9c7898f` fix(session,claude) Claude parity + legacy-profile safety blocks + deck_delegate message + guards; `b71ffbb` test tiers, test:changed, PR CI, quarantine, Bun 1.4.0, proportional policy, B1 renames. Intermediate commits were not individually re-verified; the combined tree is the verified candidate (fast 5,673/0, tsc ok).
