# Proposal — Verification doctrine and suite pruning

Status: draft for user review. Inputs: [working-brief.md](working-brief.md) (including "Scope constraint"), [research.md](research.md), [policy-and-peers.md](policy-and-peers.md).

## Problem

Deck's agents over-test and over-run tests, in the Deck repo and in the projects Deck serves, whatever their language, framework or stack.

- **Instructions push test volume.** The vendor `test-driven-development` skill auto-triggers on "any logic", rebuts every reason not to test (A6), and requires "every new behavior has a test" (A5). `strict_tdd: true` (A1) and "sufficient test coverage" as a non-negotiable (A12) add pressure. Nothing tells agents not to test copy, markup, content editable by non-developers, or prompt prose. Peer evidence (a user theme project with about 40% string/regex asserts on templates and JSON) shows the result in a user project.
- **Agents do not adapt to the project.** No rule tells agents to discover and use the project's own commands, CI gates, test layout or affected-selection tooling before choosing checks.
- **The evidence chain repeats runs.** Full SDD treats Apply evidence as non-independent (A15), and Verify reruns tests, build and typecheck (A14). The same commands run up to three times per candidate. Nothing defines how evidence is reused when Lead, Apply and Quality run on different runners and models in a cross-runner session.
- **The doctrine has no parity guarantee.** Role content and skills reach Pi, OpenCode, Codex, Claude Code and the cross-runner session through five materialization paths. Cross-runner members get only the role body, not skills. Nothing proves that every runner ships the same verification rules.
- **The Deck repo suite is slow and noisy.** It has 621 test files and only `bun run test`. The 35 test files in `teams/developer` hold 1,703 phrase assertions, so every prompt edit breaks them. `openspec/config.yaml` is invalid YAML and carries unread TDD keys.

## Outcome

**Universal (shipped to every user, every runner, every topology):**
1. A stack-neutral **verification doctrine**. Agents discover the project's conventions first. Verification is mandatory, and tests are one tool among several. Agents pick the cheapest sufficient check by artifact category; tools are illustrative examples across ecosystems. Red-first is required only for reproducible bugs, specified logic, or `strict` policy. There is an explicit do-not-test list and a retirement capability.
2. **Moment-based execution** with a clear owner for each moment. Evidence is bound to a **candidate identity** that any role can recompute from the shared workspace, so Quality reuses results instead of re-running them.
3. An **evidence contract**. Each command cites its convention source. Each new test names the regression it protects and where its oracle came from.
4. A **proportional policy schema** that deck-init writes using only discovered commands.
5. **Runner parity**. There is one canonical source in `@deck/core`: a doctrine-core block in every relevant role body in both prompt profiles, plus the `deck-verification` skill. All four adapters and the cross-runner session prompt consume it. A structural parity test runs over the materialized output.

**Deck-repo application (this repository only):**
6. Tier suffixes, `test:*` scripts, a `scripts/test.ts` wrapper with import-graph affected selection, a valid block-style `openspec/config.yaml`, CI tiers, budgets and a flaky quarantine.
7. Suite pruning under an evidence-based framework, in user-approved batches, with a must-keep list for protected risk.
8. Structural invariants for Deck's own prompt and skill content replace phrase assertions. An optional eval harness runs across stacks and runners.

## Scope

In scope:
- Universal:
  - role content in `packages/core/src/teams/developer/`;
  - the new doctrine-core constant and the `deck-verification` skill;
  - patches to four vendor skills;
  - deck-init policy emission;
  - `validateVerificationDisciplineV1` and Full SDD evidence reuse in `@deck/sdd-runtime`;
  - plan-level exports needed for the parity test;
  - optionally (Q5), session-host candidate capture.
- Deck repo:
  - `openspec/config.yaml`, CONTRIBUTING.md and AGENTS.md;
  - `package.json` scripts, `scripts/test.ts` and the CI workflows;
  - test renames and retirements.

Out of scope:
- Weakening protected-risk verification: git safety, approvals/authority, session-host lifecycle, release/install, data integrity and security.
- Imposing Deck-repo conventions on user projects.
- Per-runner doctrine variants.
- Rewriting historical OpenSpec records.
- Mandatory model-backed evals in required CI.

## Approach summary

Guards land first: content invariants and a runner-parity check, with no deletions. The stack-neutral doctrine follows. It lands together with the approved retirement of phrase tests that the rewording breaks. Next comes runtime evidence reuse. Session-host candidate capture is optional. The Deck-repo inner-loop tiers run in parallel. Pruning comes last, in approved batches. See [design.md](design.md) and [tasks.md](tasks.md).

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Pruning removes a test that guarded a real fault | Must-keep list, fault-injection checks, one revertible commit per batch, user approval per batch, and demotion before deletion. |
| The doctrine leaks Deck or stack specifics into user projects | Doctrine content holds only stack-neutral rules. Banned-phrase invariants cover stack terms in the core block. deck-init writes discovered commands only. Eval scenarios cover a non-JS project. |
| A runner or cross-runner member misses the doctrine | The core block sits in the role body, so it does not depend on skill availability. The parity test checks every runner and the session prompts. Canary dogfood runs on each runner. |
| Evidence reuse lets a stale result pass | The candidate identity is recomputed by the consumer, never trusted from the report. Mismatches invalidate only the checks whose inputs changed. Protected risk keeps one independent re-execution. |
| Affected selection misses a dependency | Handoff uses the project's selection tooling or package scope. The final full gate or project CI runs once per candidate. |
| A proportional policy lets agents skip needed tests | Red-first stays mandatory where it pays. Quality checks oracles and evidence. Projects can opt into `strict`. |
| The vendor skill patches drift | Each patch is listed in design §9 and re-applied on any vendor refresh. |

## Rollback

Every slice is one or more revertible commits. Pruning batches are isolated commits. Content and skill changes revert together with regenerated bundles: rerun `bun scripts/generate-skill-bundle.ts` and `bun scripts/generate-runner-execution-assets.ts` with the pinned Bun. No destructive git operation is part of the rollout.
