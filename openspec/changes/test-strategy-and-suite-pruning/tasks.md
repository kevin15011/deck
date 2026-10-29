# Tasks — Verification doctrine and suite pruning

These are vertical slices. Each slice can ship and be reverted on its own. They come in two tracks:
- **Track U (universal, shipped to users):** slices U1–U4. They change what every runner and the cross-runner session ship.
- **Track R (Deck repo only):** slices R1–R5. They change only how this repository runs and prunes its own suite. They may run in parallel with Track U, except where noted.

Owners are suggestions: AF = Apply Fast, AD = Apply Deep, Q = Quality.

## Track U — Universal doctrine and runner parity

### U1. Guards first: content invariants and runner-parity check, with no deletions (AF)

- [ ] U1.1 Add `packages/core/src/teams/developer/content-invariants.test.ts` per design §13 for both prompt profiles: required sections, ID resolution, protected-block map, banned phrases, size budgets. At first the doctrine-core and banned-phrase entries are inert. They activate in U2.
- [ ] U1.2 Prove the protected-block check: deleting `GIT_DISCARD_PROTECTION_RULE` from one role locally makes the invariant fail. Record the run, then revert the local mutation.
- [ ] U1.3 Add `apps/cli/src/verification-parity.test.ts` per design §8. First check whether `adapter-pi/src/capability-parity.ts` and `adapter-opencode/src/parity-consumer.test.ts` already enumerate materialized files, and reuse them if so. Export the minimal plan-level entry points it needs: Claude `expectedFiles` (or a plan API) and `sessionRolePrompt`. At first it asserts only that the four runners and the session produce role and skill outputs from the same core sources.
- **Acceptance:**
  - Both tests pass on the current tree.
  - Rewording a role body without removing required sections passes.
  - Dropping a standalone skill from one adapter's plan fails the parity test and names the runner.

### U2. Doctrine content, stack-neutral (AF; Q because role contracts are public)

- [ ] U2.1 Add `VERIFICATION_DOCTRINE_CORE` (design §5) to `@deck/core` and include it in the Lead, Apply (adaptive plus legacy general/frontend/backend), Quality and Verify bodies in both `compact` and `legacy` profiles. Keep it ≤ 1.5 KB and stack-neutral.
- [ ] U2.2 Author `packages/core/src/skills/external/deck-verification/SKILL.md` per design §1–§3 and the retirement procedure, with stack-neutral examples only. Register it in `STANDALONE_SKILLS`.
- [ ] U2.3 Patch the vendor skills per design §9: the TDD description, debugging `:287,297`, simplification `:159` and review `:335`. List each patch in apply-progress.
- [ ] U2.4 Rewrite the role content per the design §9 table: adaptive Apply/Quality, legacy apply-*, verify, orchestrator (including "integration is not verification" for both topologies), task, code-economy and deck-onboard.
- [ ] U2.5 Update deck-init to emit the design §4 policy schema with discovered commands only, in block-style YAML.
- [ ] U2.6 Activate the U1 checks: the core block is required in the role map, banned phrases include stack-specific terms in the core block, and the parity test asserts `deck-verification` is in every runner, the core block is byte-identical across runners and session prompts, and the old TDD auto-trigger is absent.
- [ ] U2.7 Phrase tests broken purely by wording go into batch B0 (R3). They are not patched one phrase at a time. If B0 is not yet approved, U2 waits on R3.4. It does not land with a red suite.
- [ ] U2.8 Regenerate with the pinned Bun: `bun scripts/generate-skill-bundle.ts`, then `bun scripts/generate-runner-execution-assets.ts`. Run `bun run canary:install`.
- **Acceptance:**
  - Content-invariant and parity tests pass. Generator freshness tests pass.
  - Each runner resolves the bare `deck-verification` ID in a canary session (Pi, OpenCode, Codex, Claude Code), recorded per runner.
  - In a cross-runner session where a member's runner has no Deck install, that member's prompt contains the core block.
  - deck-init on a non-JavaScript fixture (for example one with `pytest` and `ruff` in CI) writes only those commands. On a fixture with no conventions it writes no guessed commands.
  - Canary dogfood on fixture projects of different stacks: a template copy change adds no test; a reproducible parser bug gets a red-first test with a "protects" line; a documented project's own commands are used and no Deck conventions are created.

### U3. Runtime evidence reuse and the red-first rule (AD; Q required because this is a contract change)

- [ ] U3.1 Investigate how strictly `verification-state.ts` and `execution-control-plane.ts` parse. Decide between an optional V1 field and V2 for `producedBy` plus the candidate identity. Decide whether `implementationSubjectDigest` adopts the git-tree candidate recipe (design §2).
- [ ] U3.2 Add `redFirstRequired` to `VerificationDisciplineEvidenceV1` and gate `TDD_PRIOR_FAILURE_REQUIRED` on it. Red-first: write the failing case first.
- [ ] U3.3 Accept Apply records for `targeted` and `affected_area` when the candidate matches. Broad runs once. A delta invalidates by inputs.
- **Acceptance:**
  - The spec scenarios "Refactor with behavior flag", "Bug fix without red evidence", "Verify after a clean handoff", "Delta after Verify", "Broad stage runs once" and "Recompute before reuse" pass as tests.
  - The generated-output discipline tests stay green.
  - `@deck/sdd-runtime` export list tests are updated intentionally.
  - No runner-specific code path is added.

### U4. Session-host candidate capture — only if Q5 is approved (AD; Q required because session-host lifecycle is protected)

- [ ] U4.1 Record the candidate identity at task end alongside `baseHead` in task evidence, computed with a temporary index so the real index is never touched.
- [ ] U4.2 Expose it in `deck_task_result`, and let `deck_task_integrate` evidence reference it.
- **Acceptance:**
  - The spec scenario "Apply on one runner, Quality on another" passes against the session-host test harness with two different runner drivers.
  - The real git index is unchanged after capture (negative test).
  - Existing session-manager, recovery and ledger tests stay green.

## Track R — Deck-repo application (this repository only)

### R1. Inner-loop speedup, with no deletions (AF; independent of Track U)

- [ ] R1.1 Spike on the pinned Bun 1.3.12 and on 1.4.0. Check `--changed`, `--parallel` and `--path-ignore-patterns`, and whether the CLI value merges with the `bunfig.toml` ignore list. Record the results in apply-progress.
- [ ] R1.2 Add `scripts/test.ts` per design §11.
- [ ] R1.3 Rename the e2e/integration files to `.e2e.test.ts(x)`/`.int.test.ts(x)`. Update the references in workflows, `baseline-health.yaml` and docs.
- [ ] R1.4 Add the root scripts `test` (= fast), `test:fast`, `test:changed`, `test:int`, `test:e2e`, `test:full` and `test:quarantine`. Switch `release.yml` to `test:full`.
- [ ] R1.5 Rewrite the CONTRIBUTING "Verify your change" section and the AGENTS.md "Development path" section, clearly labelled as Deck-repo conventions.
- **Acceptance:**
  - The tier union equals what `bun test` discovers (wrapper self-check).
  - `test:full` pass count equals `bun test --timeout 30000` before the change.
  - `test:changed` for a one-module edit runs fewer than 10% of the files, within budget.
  - The wrapper's fallback rules have a small fast test.

### R2. Deck config (AF)

- [ ] R2.1 Rewrite `openspec/config.yaml` per design §10 in block-style YAML.
- **Acceptance:** it parses with `yaml` and with `readOpenSpecInitState` (`initialized: true`).

### R3. Batch B0: retire phrase tests (AF; needs batch approval; unblocks U2)

- [ ] R3.1 Fill the B0 row of design §12.1 from audit `task-535e1c2f-b9ff-47a4-be4a-8fa1a0a7d0e4`, including the per-runner TDD phrase tests that the parity test supersedes.
- [ ] R3.2 Run the before snapshot and fault probes on any must-keep file touched at block level.
- [ ] R3.3 Present B0 to the user.
- [ ] R3.4 **After approval**, retire the phrase assertions in one commit and keep the behavioral tests.
- **Acceptance:**
  - The fast-tier runtime drop is recorded.
  - Must-keep files are touched only at block level.
  - The content-invariant and parity tests cover what was removed.

### R4. Deck CI tiers and quarantine (AF; needs the Q1/Q2 decisions)

- [ ] R4.1 If Q2 is approved, add `ci.yml` for pull requests and non-main pushes: tsc, `test:fast`, `test:int`, generated-asset freshness, parity test.
- [ ] R4.2 Add `nightly.yml`: `test:e2e`, `test:full --randomize --seed`, `test:quarantine` (an expired entry fails the job), fault-probe sample.
- [ ] R4.3 Add `tests/quarantine.yaml` plus wrapper support. Protected entries need user approval.
- [ ] R4.4 If Q1 is approved, bump the canonical Bun to 1.4.x across `packageManager`, the workflows and the generator assertion. Regenerate the assets and run release verification, as a separate commit.
- **Acceptance:**
  - The PR job takes ≤ 10 min.
  - Nightly is green.
  - An expired quarantine fixture fails nightly.

### R5. Suite pruning batches B1… (AF per batch; Q on protected-adjacent batches)

- [ ] R5.1 Fill design §12.1 from the audit, giving per-file category, runtime and protected flag (Architect continuation).
- [ ] R5.2 For each batch: take the before snapshot, run the fault probes and get **user approval**. Then commit once, run `test:full` and `tsc`, and diff coverage on the protected modules. Record the result in apply-progress.
- [ ] R5.3 Recalibrate the budgets from measured data.
- **Acceptance per batch:**
  - Full suite green.
  - No unexplained drop in protected coverage.
  - Fault probes still caught.
  - Saving recorded.
  - One revertible commit.

## Optional

### E1. Eval harness (AF; needs the Q3 decision)

- [ ] E1.1 Add `evals/verification/` scenarios across stacks per design §13, each with a deterministic grader that works from the diff and the report.
- [ ] E1.2 Run each scenario on every runner. Wire it to manual dispatch, and to nightly once the budget is approved.
- **Acceptance:**
  - Pass/fail is reported per scenario and per runner.
  - The grader passes its own fixtures.

## Ordering

R1 and R2 can start at any time.

The Track U order is U1, then U2, then U3, with U4 last and optional. U2 lands only after R3.4 (B0 approval), because the rewording breaks phrase tests.

R4 depends on R1. R5 follows R3.

## Hard stops

- No test deletion without explicit user approval of the batch.
- No quarantine of protected-risk tests without approval.
- No hand edits to generated files.
- No destructive git operations. Rollback uses `git revert`.
- No Deck-repo conventions in shipped doctrine content or in deck-init output for user projects.


### Candidate-specific acceptance decision

The user accepted composite verification for U2+B0 and the bounded blocking B2 repairs after disclosure of the unresolved Pi Supermemory worker stall. For this candidate only, the green full-command requirement is satisfied by explicit acceptance of the source-bound composite evidence (7,511 pass, 11 unchanged skips, zero missing cases); the command itself remains recorded as interrupted/exit 1. See working-brief.md, “Approved bounded closure”. Future batches retain their existing acceptance requirements. Broader outstanding tasks remain open.


### Current pruning execution (2026-10-28)

- [x] B0/B3: retire the reviewed non-protected no-op phrase matrix (124 cases) and duplicate retired-output matrix (4 cases), after kept-test fault probes.
- [x] B2: seed trust-revision history; retain real eviction/restart/replay and prove revision-fence fault detection.
- [x] B4: replace OpenCode inventory call counts with returned-model outcomes; remove bootstrap prose pins while retaining metadata checks.
- [x] Reclassify stale audit candidates against current source; preserve already-tiered valuable slow tests.
- [ ] Protected candidates in B0/B3/B5: stopped for item-specific approval; see working brief. No protected deletion authorized by this execution.
- [x] Execute the one requested full gate: 7,656 pass / 1 fail / 11 skip, exit 1, 1113.72s. Reproduced TUI fixture failure fixed; affected full file 41/0. Final typecheck recorded in attempt-36 report.
- [ ] Green full-command acceptance: not claimed; retain composite full-run plus post-fix focused evidence for Lead review.

This continuation does not mark the entire broad pruning plan complete. Protected candidates remain explicitly deferred under the current instruction; earlier completed work and historical approvals remain unchanged. No commits are requested in this continuation.
