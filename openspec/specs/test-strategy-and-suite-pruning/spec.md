# Verification Doctrine and Deck Test Suite Specification

## Promotion and accepted scope

Promoted on 2026-10-28 from [the archived change](../../archive/2026-10-28-test-strategy-and-suite-pruning/archive-report.md). Universal doctrine, tier tooling, repository policy, CI configuration and the approved bounded pruning are delivered. Closure is user-approved with deferred work explicitly retained: U3 runtime evidence/classification wiring, optional U4 candidate capture, nightly/eval execution, unapproved protected retirements and measured CI/budget acceptance. Requirements for those items remain targets, not claims of delivered behavior.

Later approved decisions supersede draft options: strict TDD and its bundled vendor skill are removed, with no opt-in; legacy roles/profiles and deck-init are retired in favor of current roles and authenticated Setup. Installed verified role delivery is governed by [session skill availability](../session-skill-availability/spec.md). Live model-backed runner consumption was not verified, and the user chose to archive without it. See the archive report for native Setup/Codex limitations and the CODEX_HOME incident and fix.

## Purpose

Define how Deck agents choose, write, run, report and retire verification in **any** project Deck serves, in any language, framework or stack, and under every Deck topology. Separately, define how the Deck repository applies that doctrine to its own suite. Protected-risk verification stays strong.

The spec has two layers that MUST stay separate:
- **Part 1 — Universal doctrine (shipped to users).** Capabilities A, B and D. Stack-neutral. Applies to every runner and to the cross-runner session.
- **Part 2 — Deck-repo application.** Capability C. Bun tiers, scripts, CI and pruning for this repository only. Nothing in Part 2 may be imposed on user projects.

Terms:
- **Protected risk** covers destructive VCS operations (git safety), approvals/authority, session and process lifecycle, release/install, data integrity and security. In Deck's own repo it also includes the session-host lifecycle.
- **Candidate** is the implementation subject: the VCS base commit plus a digest of the working-tree delta (see Capability B).
- **Red-first** means observing a failing check before the fix or implementation.
- **Project conventions** are the target project's own documented commands, CI gates, manifests, test layout and selection tooling.
- **Topology** is either a *native runner* (Deck installed in Pi, OpenCode, Codex or Claude Code, with native delegation) or the *cross-runner session* (session-host Lead plus members delegated via `deck_delegate`, possibly on different runners and models).

---

# Part 1 — Universal doctrine

## Capability A — Verification doctrine (all projects, all stacks)

### Requirement: Discover project conventions first

Before choosing or running any check, agents MUST discover the target project's conventions, in this order:
1. Project instructions: `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING*`, `README*`, developer docs.
2. CI configuration: the commands CI runs are the authoritative gate list.
3. Manifests and task runners: for example `package.json` scripts, `Makefile`, `justfile`, `pyproject.toml`/`tox.ini`/`noxfile.py`, `Cargo.toml`, `go.mod`, Gradle/Maven files, `Taskfile`.
4. Existing test layout, naming and framework configuration.
5. Affected-selection tooling, if any: for example Nx affected, Turborepo filters, Bazel/Pants change queries, `pytest-testmon`, `vitest related`, `jest --findRelatedTests`, `go test` package scoping, `cargo test -p`, `bun test --changed`.
6. The project's testing policy, if declared (for example `testing.policy` in `openspec/config.yaml`).

Agents MUST use the discovered commands. They MUST fall back to doctrine defaults only for what is absent. They MUST NOT impose Deck-repo conventions (file suffixes, tier names, scripts, CI layout) on a user project. Adding new scripts, tiers or CI to a user project is a scope expansion that requires the user's request. Evidence MUST name where each command came from.

#### Scenario: Project documents its commands
- GIVEN a project whose CONTRIBUTING lists a lint command and a focused test command, and whose CI runs a typecheck
- WHEN the agent verifies a change
- THEN it uses those commands and cites them as the source
- AND it does not invent a different runner, script or file-naming convention

#### Scenario: No conventions found
- GIVEN a project with a test framework config but no documented commands and no CI
- WHEN the agent verifies a change
- THEN it uses the framework's default focused and full invocations
- AND it reports that the commands are doctrine defaults, not project conventions

#### Scenario: Deck-repo conventions are not exported
- GIVEN a user project that names tests `test_*.py` under `tests/`
- WHEN the agent adds a regression test
- THEN it follows `test_*.py` under `tests/`
- AND it does not create `*.int.test.*` files, a `scripts/test.ts` or `test:changed` script

### Requirement: Verification is mandatory; tests are proportional

Every modifying change MUST be verified by at least one runnable check appropriate to the artifact. Agents MUST NOT add a test when a cheaper check already proves the property, or when the change is on the do-not-test list. Strict TDD MUST NOT be shipped as a default, opt-in or fallback.

#### Scenario: User-facing copy change in a template
- GIVEN a task that changes button text in a server- or client-rendered template
- WHEN the agent verifies the change
- THEN it runs the project's template/markup validator (or a parse/render check when none exists)
- AND it adds no test that asserts the text, attributes or markup

#### Scenario: Pass-through or constant
- GIVEN a change that adds a re-export, constant or typed pass-through in a statically typed language
- WHEN the agent verifies it
- THEN the compiler or type checker is sufficient evidence and no new test is added

### Requirement: Cheapest sufficient tool by artifact category

Agents MUST classify the artifact into a category (typed logic, untyped/dynamic logic, UI components, templates/markup, styles, config/IaC, schemas/migrations/persistence, data pipelines, CLIs, APIs/contracts, prompts/agent content, generated artifacts, concurrency/distributed code, security/authority/destructive operations, docs). They MUST then select verification in this order, stopping at the first tool that proves the property:
1. compiler/type checker
2. lint, static or architecture rules, including template/markup validators
3. schema/parse validation
4. property test
5. example test at a public boundary
6. integration test
7. e2e/browser test

For prompt or agent-content behavior, agents MUST use structural invariants and, when behavior is at risk, evals. Category defaults and illustrative tools are non-normative mappings resolved through the discovered conventions. The selected tool and the reason MUST appear in the evidence.

#### Scenario: Parser change
- GIVEN a change to a parser or serializer with a round-trip invariant
- WHEN the agent selects verification
- THEN it prefers a property or round-trip test over many hand-picked examples, using the project's property-testing library if one is present

#### Scenario: Interactive UI logic
- GIVEN a UI component change that alters user-visible interaction (state, validation, permission outcome), in any UI framework
- WHEN the agent writes a test
- THEN the test drives the component through its public, user-level interface and asserts the user-observable outcome
- AND it does not snapshot markup or assert class names

#### Scenario: Dynamic language without a type checker
- GIVEN a logic change in a dynamically typed module with no configured type checker
- WHEN the agent selects verification
- THEN it runs the configured linter and treats an example test at the module boundary as the cheapest sufficient check for branching logic

### Requirement: Red-first only where it pays

Red-first MUST be required for:
- (a) a bug fix whose fault is reproducible at a stable boundary;
- (b) logic specified by a spec, issue or acceptance scenario, such as parsers, state machines, calculations, permissions and protocol handling.

Red-first MUST NOT otherwise be required for refactors, characterization tests, configuration, content or wiring. For behavior-preserving refactors, a trustworthy baseline MUST exist before the change.

#### Scenario: Reproducible bug
- GIVEN a bug report with a reproducible failure at a public boundary
- WHEN the agent fixes it
- THEN it first records a failing test that reproduces the report, then the passing run after the fix

#### Scenario: Bug not reproducible at a stable boundary
- GIVEN a race or environment-specific bug that cannot be reproduced deterministically
- WHEN the agent fixes it
- THEN it records the diagnostic evidence and the check that was used, and explains why no regression test was added

### Requirement: Oracle from intent, not implementation

Assertions MUST come from the task, spec, issue or documented contract, never from reading the current output of the implementation. Tests MUST assert observable behavior at a public boundary. Tests MUST NOT assert call counts, private state or internal call order unless that order is the contract. Mocks MUST be limited to process, network, clock and other external edges, and fakes are preferred.

#### Scenario: Quality reviews an oracle
- GIVEN a new test whose expected values were copied from a run of the implementation
- WHEN Quality reviews the candidate
- THEN Quality reports a finding that the oracle is not independent of the implementation

### Requirement: Do-not-test list

Agents MUST NOT write tests whose only assertions pin any of the following:
- user-facing copy, translations and locale strings;
- markup/template attributes, class names, DOM or view-tree structure;
- content and settings editable by non-developers (CMS entries, content files, editor-managed settings, menus);
- prompt, skill or other agent-instruction prose;
- constants and enum values;
- re-exports and pass-throughs;
- generated file contents, except a freshness or determinism check against the generator;
- formatting and styles.

Reviewers MUST NOT request such tests.

#### Scenario: Reviewer requests a prose assertion
- GIVEN a change to an agent-instruction file
- WHEN a reviewer considers missing tests
- THEN it does not request a test asserting the wording
- AND it may request a structural invariant or eval if behavior is at risk

#### Scenario: Editor-managed content
- GIVEN a change to a content file or settings document that non-developers edit through a CMS or editor
- WHEN the agent verifies it
- THEN it runs parse/schema validation and any key-parity check the project has
- AND it adds no test pinning the values

### Requirement: Hermetic tests

New tests MUST NOT depend on real clock, network, randomness without a seed, global shared filesystem state or test order. Temp directories, injected time and fakes MUST be used instead.

### Requirement: Retirement with evidence

An agent MAY propose retiring, merging or demoting a test in any project. Any proposal MUST cite evidence for each test: category, runtime, duplicate coverage or lack of a unique fault-detection signal, and whether it guards protected risk or a past incident. Deleting tests is modifying work. It MUST NOT proceed without user approval of the specific batch.

#### Scenario: Retirement proposal for a protected test
- GIVEN a slow test that guards an authorization decision
- WHEN an agent evaluates it for pruning
- THEN it may propose demotion to a slower suite or a speed fix
- BUT it MUST NOT propose deletion unless an equivalent remaining test is named and a fault-injection check shows that test fails

## Capability B — Verification moments and evidence (all projects, all topologies)

### Requirement: Moment-based execution by role

Roles MUST run checks by moment, using the project's discovered commands for each moment:

| Moment | Owner | Runs |
|---|---|---|
| Edit loop | Implementation owner | Focused tests for touched code plus the cheapest static checks. Never the full suite. |
| Handoff | Implementation owner | Affected checks once: affected tests, typecheck/lint, and the project's artifact validators. |
| Review/Verify | Quality/Verify | Reuse handoff evidence bound to the same candidate. Run only missing or invalidated checks. Protected risk adds one independent re-execution of targeted protected tests. |
| Final candidate | Lead (or Verify in Full SDD) | The project's full gate once, when the project or change requires it. A project CI run for the same commit satisfies it. |

The same command MUST NOT be re-run on an unchanged candidate unless the run is an explicitly independent protected-risk re-execution. Which suites run on pull requests, main or schedules is the project's CI decision, not the doctrine's.

#### Scenario: Verify after a clean handoff
- GIVEN the implementation owner reports affected tests and typecheck passed for candidate C
- AND the candidate is still C
- WHEN Verify runs
- THEN Verify accepts that evidence for the targeted and affected_area stages without re-running it
- AND Verify spends its effort on compliance mapping and oracle quality

#### Scenario: Delta after Verify
- GIVEN Verify accepted evidence for candidate C
- WHEN a fix changes one module and produces candidate C'
- THEN only evidence whose inputs include the changed module is invalidated and re-run

#### Scenario: Broad stage runs once
- GIVEN a Full SDD change requiring broad evidence
- WHEN broad evidence is gathered
- THEN exactly one full-gate run bound to the final candidate is required
- AND that run may be a project CI run for the same commit

### Requirement: Candidate identity

Evidence MUST be bound to a candidate identity that any role on any runner can recompute from the shared workspace without trusting the producer: the VCS base commit plus a digest of the working-tree delta (tracked changes and untracked, non-ignored files). When the workspace is not under version control or the identity cannot be computed, evidence MUST NOT be reused and the consumer re-runs the checks it needs.

#### Scenario: Recompute before reuse
- GIVEN an Apply report claiming candidate C
- WHEN Quality, on a different runner and model, recomputes the identity and gets C
- THEN Quality may reuse the report's evidence
- BUT if it gets a different value, it treats the evidence as stale and re-runs the affected checks

### Requirement: Evidence contract

Implementation and Quality reports MUST state the following for each command:
- the command and its convention source (project instructions, CI, manifest, or doctrine default);
- its scope reason (focused, affected, full or protected re-execution);
- the result (pass/fail counts and exit code);
- the duration;
- the candidate identity.

For each new or modified test, the report MUST state:
- the behavior or regression it protects;
- the oracle source;
- how it would fail if the behavior broke (the red-first observation when required).

The report MUST list checks deliberately not run, or tests deliberately not written, with the cheaper check used instead. It MUST also list tests retired, with their evidence.

#### Scenario: Missing oracle statement
- GIVEN an implementation report that adds a test without stating what regression it protects
- WHEN Quality or Lead evaluates the report
- THEN the evidence is incomplete and the implementation owner is asked to supply the statement or remove the test

### Requirement: Proportional project policy

The testing policy MUST be `proportional`. Where authenticated Setup writes supported project configuration, it MUST record red-first triggers and only discovered or user-supplied commands and artifact validators. It MUST NOT retain strict-TDD opt-in, `strict_tdd`, `strict_tdd_gates` or `coverage_threshold`. Supported cleanup MUST preserve command-valued gates and unrelated user data under the session-skill-availability repair contract. Unknown or lossy shapes MUST fail closed.

#### Scenario: Setup in a non-JavaScript project
- GIVEN a project whose CI runs `pytest` and `ruff check`
- WHEN authenticated Setup writes the testing policy
- THEN the policy is `proportional` and the recorded commands are the discovered `pytest`/`ruff` invocations
- AND no Bun, Node or Deck-repo command appears

### Requirement: Runtime red-first rule

`validateVerificationDisciplineV1` MUST require prior-failure evidence only when the evidence declares red-first as required. A behavior change alone MUST NOT trigger `TDD_PRIOR_FAILURE_REQUIRED`. Generated-output discipline checks MUST stay unchanged.

#### Scenario: Refactor with behavior flag
- GIVEN discipline evidence with `behaviorChanged: true`, `redFirstRequired: false` and passing stages
- WHEN validated
- THEN the result is `accepted`

#### Scenario: Bug fix without red evidence
- GIVEN discipline evidence with `redFirstRequired: true` and no `failed-before-implementation` reference
- WHEN validated
- THEN the result includes `TDD_PRIOR_FAILURE_REQUIRED`

## Capability D — Runner and topology parity

### Requirement: Single canonical source

The doctrine MUST have exactly one canonical source in `@deck/core`:
- a shared doctrine-core block, included in every implementation, review, verify and Lead role body in every supported role materialization;
- the `deck-verification` standalone skill, registered in `STANDALONE_SKILLS`.

Every adapter (Pi, OpenCode, Codex, Claude Code) MUST materialize these sources through the existing core APIs (`getAgentContent`, `getStandaloneSkills`/`getStandaloneSkill`). Cross-runner sessions MUST select those verified installed roles instead of re-rendering role bodies at launch. No adapter may carry its own copy, paraphrase or runner-specific variant of the doctrine. Adapters MAY only add runner-native framing (frontmatter, tool names, paths).

### Requirement: Doctrine available without skills

Because a role may run where the `deck-verification` skill is not materialized or not loaded (for example a role whose optional skill bundle has not been loaded), the doctrine-core block in the role body MUST be sufficient on its own for: convention discovery, the decision procedure summary, red-first triggers, the do-not-test list, moment-based execution, candidate binding and the evidence contract. The skill adds the full category table, examples and the retirement procedure.

#### Scenario: Cross-runner member without a loaded skill
- GIVEN a cross-runner session with a verified installed Quality role whose verification skill has not been loaded
- WHEN it reviews a candidate
- THEN its session role prompt still contains the doctrine-core block
- AND it applies the same reuse, oracle and do-not-request rules as a native Quality role

### Requirement: Old TDD triggers are removed everywhere

No runner's materialized assets and no session role prompt may auto-load the vendor `test-driven-development` skill for general logic. Deck MUST remove the bundled vendor skill and its references; no strict-policy opt-in or legacy fallback remains.

### Requirement: Same evidence rules in every topology

Evidence reuse, candidate identity and the evidence contract MUST behave identically:
- **Native runner:** the implementation subagent's report reaches the native Lead/Quality in the same workspace; reuse requires a recomputed candidate match.
- **Cross-runner session:** members may run on different runners and models. Reuse MUST rely only on what crosses the task boundary (the task report and session-host task evidence such as `baseHead`, edit artifacts and their digests) plus recomputation in the shared workspace, never on runner-specific state. Integration of a task (`deck_task_integrate`) MUST NOT by itself count as verification; verification evidence cited at integration MUST carry the candidate identity.

#### Scenario: Apply on one runner, Quality on another
- GIVEN a cross-runner session where Apply runs on runner R1 and Quality on runner R2
- AND Apply's report lists affected tests passing for candidate C
- WHEN Quality recomputes the candidate identity in the shared workspace and gets C
- THEN Quality reuses the evidence without re-running it
- AND Lead may cite that evidence when integrating the task

### Requirement: Parity is checked structurally

Parity MUST be verified by structural checks over each runner's materialized output and the session role prompts, not by prose assertions:
- every runner's materialized skill set contains `deck-verification` with valid frontmatter;
- every runner's materialized Lead, Apply, Quality and Verify roles, and every session role prompt for those roles, contain the doctrine-core block;
- no materialized asset references the vendor TDD skill as a default or carries its old auto-trigger description;
- the materialized doctrine bytes are identical across runners after stripping runner-native framing.

#### Scenario: One adapter drops the skill
- GIVEN an adapter change that stops materializing `deck-verification`
- WHEN the parity check runs
- THEN it fails, naming the runner and the missing skill

---

# Part 2 — Deck-repo application

Capability C applies only to the Deck repository. It is one application of Part 1, not part of the shipped doctrine.

## Capability C — Deck repository suite

### Requirement: Deck project policy

Deck's own `openspec/config.yaml` MUST express `testing.policy: proportional`, the red-first triggers, Deck's moment commands and artifact validators. It MUST NOT contain `strict_tdd`, `strict_tdd_gates` or `coverage_threshold`. The file MUST parse with a strict YAML parser and MUST NOT use flow collections, because the init-state reader rejects lines containing `[`, `]`, `{` or `}`.

#### Scenario: Config validity
- GIVEN the rewritten `openspec/config.yaml`
- WHEN it is parsed with the `yaml` package and with `readOpenSpecInitState`
- THEN both succeed and `initialized` is `true`

### Requirement: Tier conventions

Deck test files MUST be classified by suffix:
- `*.test.ts(x)` is the fast tier: in-process, no subprocess, no network, no real sleeps, temp FS allowed, file median ≤ 1 s;
- `*.int.test.ts(x)` is integration: subprocesses, git fixtures, multi-package composition, real FS trees;
- `*.e2e.test.ts(x)` is e2e: cross-runner, compiled binary, full TUI or web flows.

Existing `-e2e`/`.integration.` names MUST be normalized.

### Requirement: Scripts and affected selection

The root `package.json` MUST provide these scripts:
- `test` and `test:fast`: the fast tier;
- `test:changed`: fast and int tests affected by changes versus a ref, defaulting to the working tree versus `HEAD`;
- `test:int`;
- `test:e2e`;
- `test:full`: all tiers, 30 s per-test timeout;
- `test:quarantine`.

Affected selection MUST use the import graph: Bun `--changed` where the pinned Bun supports it, otherwise a Deck wrapper. Selection MUST fall back to the touched package's full fast and int tiers when inputs that are not imports change: fixtures, generated files, `bunfig.toml`, `package.json` or the lockfile.

#### Scenario: One-file edit
- GIVEN a working-tree change to one source module
- WHEN `bun run test:changed` runs
- THEN only test files that transitively import that module (plus fallback rules) run

#### Scenario: Tier union equals full
- GIVEN the tier classification
- WHEN the union of fast, int and e2e file sets is compared with the files `bun test` discovers
- THEN they are equal, so no test is silently dropped

### Requirement: CI and budgets

If the user approves a pull-request workflow (open question Q2), pull requests MUST run typecheck and `test:fast` + `test:int`. The main/release verification MUST run `test:full`. A scheduled nightly MUST run `test:e2e`, the full suite with `--randomize`, `test:quarantine` and the fault-probe sample.

The budgets are:
- `test:changed` typical ≤ 20 s;
- `test:fast` ≤ 90 s wall locally;
- PR CI job ≤ 10 min.

Budget values MAY be recalibrated from audit data.

### Requirement: Flaky quarantine

A flaky test MAY be quarantined in a versioned list with owner, reason, link and expiry (≤ 14 days). Quarantined tests MUST be excluded from required tiers and run nightly. Retries MUST NOT be used to mask flakiness in required tiers. Protected-risk tests MUST NOT be quarantined without user approval. An expired entry MUST fail the nightly job.

### Requirement: Content verification by structural invariants

Deck's prompt and skill content MUST be verified by structural invariants:
- frontmatter validity;
- required sections per role;
- referenced skill, agent and tool IDs exist;
- protected canonical blocks such as `GIT_DISCARD_PROTECTION_RULE`, `FINDING_DISPOSITION_AUTHORITY_BOUNDARY_V1` and the new doctrine-core block are included where a declarative map requires them, in every supported role materialization;
- a banned-phrase list;
- size budgets;
- generated-bundle freshness.

Phrase or whole-string assertions on prose MUST be retired. Behavior MAY be checked by an optional eval harness outside required CI.

#### Scenario: Prompt wording edit
- GIVEN an edit that rewords a role body without removing required sections or protected blocks
- WHEN the fast tier runs
- THEN no test fails

#### Scenario: Protected block removed
- GIVEN an edit that drops `GIT_DISCARD_PROTECTION_RULE` from a role that requires it
- WHEN the fast tier runs
- THEN the content-invariant test fails naming the role and block

### Requirement: Must-keep protection

Tests guarding protected risk MUST be kept unless:
- an equivalent remaining test is identified;
- a fault-injection check on the protected module shows the remaining suite fails;
- the user approves the batch.
