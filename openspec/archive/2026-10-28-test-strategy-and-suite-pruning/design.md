# Design — Verification doctrine and suite pruning

Requirements: [spec.md](spec.md). Evidence: [research.md](research.md), [policy-and-peers.md](policy-and-peers.md). Rule IDs A1–A22 refer to policy-and-peers.md. Scope constraint: [working-brief.md](working-brief.md) "Scope constraint".

The design has three parts:
- **Part I — Universal doctrine (§1–§4).** What ships to every user, in every language, framework and stack. Tool names are illustrative only.
- **Part II — Runner and topology parity (§5–§8).** How the same doctrine reaches Pi, OpenCode, Codex, Claude Code and the cross-runner session, and how evidence moves between roles.
- **Part III — Deck-repo application (§9–§13).** Bun tiers, scripts, CI, config and pruning for this repository only. Nothing here is exported to user projects.

## 0. Verified facts that shape the design

| Fact | Evidence | Consequence |
|---|---|---|
| Role content has one source: `getAgentContent(id, { promptProfile })` in `@deck/core` | Pi `adapter-pi/src/developer-team-install.ts:572` (compact); OpenCode `adapter-opencode/src/runner-capabilities.ts:240` (`buildDeveloperTeamManifest`); Codex `adapter-codex/src/developer-team-install.ts:210` (`buildDeveloperTeamManifest`); Claude `adapter-claude/src/runner-adapter.ts:73` (**legacy** profile); cross-runner session `apps/cli/src/session-service.ts:85` (compact, `sessionRolePrompt`) | Doctrine text in role bodies reaches every runner and the session. It must exist in **both** prompt profiles. |
| Standalone skills have one source: `STANDALONE_SKILLS` + `content.generated.ts` via `getStandaloneSkills`/`getStandaloneSkill` | Pi `global-materialization.ts:81`, `developer-team-install.ts:617` → `.pi/skills/<id>/SKILL.md`; OpenCode `runner-adapter.ts:1302`, `apps/cli/src/opencode-launch-command.ts:237`; Codex `developer-team-install.ts:281-287` → `.agents/skills/<id>/SKILL.md`; Claude `runner-adapter.ts:89-93` → plugin `skills/<id>/SKILL.md` | Registering `deck-verification` once materializes it in all four runners. No adapter change is needed for the skill itself. |
| The cross-runner session role prompt is `agentBody` plus session text only; it does not inject skills | `apps/cli/src/session-service.ts:82-95` | A cross-runner member sees skills only if its runner has a native Deck install (OpenCode adds global skill paths at `adapter-opencode/src/session-driver/launch.ts:24-27`). The doctrine core must therefore live in the role body, not only in the skill. |
| Runner execution assets (`generate-runner-execution-assets.ts`) are execution bridges: OpenCode plugin, Pi extension, Codex hook | `scripts/generate-runner-execution-assets.ts:6-19`; `rg -i "tdd\|test-driven"` over their sources finds nothing | Doctrine content does not flow through them, and they enforce no TDD. They only need regeneration if their imported core code changes. |
| Session-host task evidence already carries `baseHead`, a scoped diff, edit artifacts with digests, and integrations cite `evidenceSeqs` | `packages/session-host/src/task-handoff.ts:7`, `task-evidence.ts:6-20`, `deck_task_integrate` in `session-manager.ts:622` | Cross-runner reuse can rely on the shared workspace and the report's candidate identity. Recording the candidate identity at task end is an optional session-host extension (Q5). |
| Bun 1.4.0 (local) supports `--changed[=ref]`, `--parallel`, `--shard`, `--randomize`; the repo pins 1.3.12 | `bun test --help`; `package.json`, workflows, `scripts/generate-runner-execution-assets.ts:55`, `scripts/generate-skill-bundle.ts:196` | Deck-repo only (Part III). → Q1 |
| Nothing in source reads `strict_tdd`, `strict_tdd_gates`, `coverage_threshold` or `rules.apply.tdd` | `rg` over `packages apps scripts`, excluding generated files | Removing them changes no runtime behavior. |
| `openspec/config.yaml` is invalid YAML; `readOpenSpecInitState` rejects `[ ] { }` | `yaml` parse error at line 27 | Rewrite in block style (Part III §10). The deck-init emitter (Part I §4) must obey the same constraint. |
| The only coded TDD gate is `validateVerificationDisciplineV1` | `packages/sdd-runtime/src/orchestrator/staged-verification.ts:254-284`; no production caller | Small public-API change, runner-independent. |
| The staged schedule is bound to `implementationSubjectDigest` | `execution-control-plane.ts:545,793,830-955` | Full SDD reuse binds to the existing digest. |
| No PR test workflow exists | `.github/workflows/` | Deck-repo only. → Q2 |
| 35 test files in `teams/developer` hold 1,703 `toContain`/`toMatch` | `grep -c` | Largest change-detector share; first Deck pruning target. |

---

# Part I — Universal doctrine

## 1. Doctrine

### Principles

1. **Verification is mandatory, and tests are optional tools.** Every change needs a runnable check. A test is the right check only when nothing cheaper proves the property.
2. **The project's conventions come first.** Discover them, use them, cite them. Doctrine defaults fill gaps only.
3. **A test must be able to fail for a real behavioral reason.** It asserts intended behavior at a public boundary.
4. **Cheapest sufficient tool:** types → lint/static/template validators → schema/parse → property → example → integration → e2e. Agent-content behavior → structural invariants and evals.
5. **The oracle comes from intent:** the spec, issue or contract, never a captured run of the implementation.
6. **Red-first where it pays:** reproducible bugs and specified logic (all behavior under `strict`).
7. **Run the least that proves the change, once per candidate.**
8. **Retire with evidence.** Deletion needs evidence and user approval. Protected risk stays strongly verified.

### Convention discovery (agent-facing, step 0)

1. Read project instructions: `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING*`, `README*`, developer docs.
2. Read CI configuration (for example `.github/workflows`, `.gitlab-ci.yml`, `Jenkinsfile`, `azure-pipelines.yml`). Commands CI runs are the authoritative gate list.
3. Read manifests and task runners: `package.json` scripts, `Makefile`, `justfile`, `pyproject.toml`/`tox.ini`/`noxfile.py`, `Cargo.toml`, `go.mod`, Gradle/Maven, `Taskfile`, `mise.toml`, `composer.json`, `Gemfile`/`Rakefile`.
4. Inspect existing test layout, naming and framework config. New tests follow it.
5. Detect affected-selection tooling and prefer it for the handoff moment:

   | Ecosystem (illustrative) | Affected or focused selection |
   |---|---|
   | JS/TS monorepos | `nx affected`, `turbo run test --filter=...[ref]`, `vitest related`/`--changed`, `jest --findRelatedTests`/`--onlyChanged`, `bun test --changed` |
   | Python | `pytest-testmon`, `pytest --lf`, path/keyword scoping |
   | Go | `go test ./changed/pkg/...` |
   | Rust | `cargo test -p <crate>` |
   | JVM | Gradle/Maven module and test filters |
   | Polyglot build systems | Bazel `rdeps` queries, Pants `--changed-since` |

6. Read the project testing policy (`testing.policy` or equivalent).

**Fallback defaults when absent:** focused = the detected framework on the touched test file or module; affected = the touched package or module's tests; full = the framework's default command; static = the configured linter/type checker if present. Report each fallback as `source: doctrine default`.

**Never imposed on user projects:** Deck's `*.int.test.*`/`*.e2e.test.*` suffixes, `test:*` script names, `scripts/test.ts`, quarantine file, CI layout or budgets. Proposing such structure is allowed; adding it requires the user's request.

### Decision procedure (agent-facing; core of `deck-verification`)

0. **Discover conventions** (above).
1. **Classify the artifact** by category (table below).
2. **Is it on the do-not-test list?** User-facing copy, translations, markup/template attributes, class names, DOM/view structure, content or settings editable by non-developers, agent-instruction prose, constants, enum values, re-exports, pass-throughs, generated contents, formatting and styles. If yes, run the artifact's validator and stop.
3. **Does a cheaper tool prove it?** Compiler, linter, template validator or schema. If yes, run it and stop.
4. **Is red-first required?** For a bug reproducible at a stable boundary, logic specified by a spec/issue/acceptance scenario, or policy `strict`. If yes, write the failing check first and record the red run.
5. **Choose the level:** the lowest level that observes the behavior through a public boundary. Mock only at process, network and clock edges; prefer fakes.
6. **Pick the assertions** from the intent source. State in one line what regression this test catches. No call counts, private state, or snapshots of large text.
7. **How many tests?** Extend an existing test before adding a file. Add a case only for a distinct behavior or partition.
8. **Run the checks for the moment** (§2), using discovered commands. Report per §3.

### Artifact category → cheapest sufficient verification

Tools are illustrative examples across ecosystems; the project's discovered tools win.

| Category | Default check | Illustrative tools | Test only when |
|---|---|---|---|
| Typed logic | Compiler/type checker, then focused tests | `tsc`, mypy/pyright, `go vet`, `cargo check`/clippy, `javac`/`kotlinc`; jest/vitest/bun test, pytest, `go test`, `cargo test`, JUnit | Branching logic, invariants, parsers, state machines, calculations. Prefer properties (fast-check, hypothesis, proptest, jqwik) where an invariant exists. |
| Untyped/dynamic logic | Linter, then an example test at the module boundary | eslint, ruff, rubocop, shellcheck; pytest, rspec, bats | Branching logic. The bar is lower than typed logic because no compiler proves shapes. |
| UI components | Types + lint (including a11y lint); visual review for visuals | eslint-plugin-jsx-a11y, Testing Library (React/Vue/Svelte/Angular), Playwright, Storybook interaction tests | Interaction, validation or permission outcomes, driven at the user level. No markup snapshots, no class-name asserts. |
| Templates/markup | Template-language validator + parse/render check | theme-check, htmlhint, html-validate, djlint, erb-lint | Real logic in the template (access, price, visibility rules), tested on rendered output via the real engine or a browser; never regex over source. |
| Styles | Style linter; screenshot or visual review | stylelint | Never as unit tests |
| Config / IaC | Parse + schema + the tool's own validator or plan | JSON Schema, yamllint, actionlint, hadolint, `terraform validate`/`plan`, kubeconform; OPA/conftest for policy | Only when a loader has behavior, or for security policy rules |
| Schemas / migrations / persistence | Run the migration against a real or ephemeral store, forward and back | Testcontainers, temporary SQLite/Postgres, the project's migration tool | Always (protected: data integrity) |
| Data pipelines | Input/output schema and contract checks; small fixture runs | dbt tests, Great Expectations, pandera | Transformations with business rules |
| CLIs | Integration test invoking the CLI in a temp dir; exit codes and output as contract | bats, execa, click testing, assert_cmd | Contract changes |
| APIs / contracts | Schema validation and contract tests at the boundary | OpenAPI validators, Pact, `buf lint`/`buf breaking`, GraphQL schema checks | Always for contract changes |
| Prompts / agent content | Structural invariants (sections, IDs, protected blocks, size) | Project-specific | Behavior through evals only; never prose asserts |
| Generated artifacts | Generator freshness/determinism check | Project generator in check mode | Never test the contents |
| Concurrency / distributed | Deterministic tests with injected scheduler/clock; race detectors | `go test -race`, loom, ThreadSanitizer, fault injection | Ordering, idempotency and recovery contracts; protected when data integrity is involved |
| Security / authority / destructive ops | Example + negative tests at the boundary | The project's framework | Always (protected) |
| Docs | Link and structure checks | lychee, markdownlint | Never test the prose |

Mutation tools (Stryker, mutmut/cosmic-ray, PIT, cargo-mutants, go-mutesting) and scripted fault injection are retirement and audit aids, not default gates.

## 2. Verification moments and candidate identity

| Moment | Owner | Runs (discovered commands) |
|---|---|---|
| Edit loop | Implementation owner | Focused tests for touched code + cheapest static checks. Never the full gate. |
| Handoff | Implementation owner | Affected tests, typecheck/lint and artifact validators, once, bound to candidate C. |
| Review/Verify | Quality/Verify | Recompute C. If equal, reuse; review compliance and oracle independence; run only missing checks. Protected risk: one independent re-execution of targeted protected tests. If different, re-run only checks whose inputs changed. |
| Final candidate | Lead (Verify in Full SDD) | The project's full gate once, when required. A project CI run for the same commit satisfies it. |

Which suites run on pull requests, main or schedules is the project's own CI decision.

**Candidate identity (stack-neutral, recomputable by any role):**
- `base` = `git rev-parse HEAD`.
- `tree` = the tree ID of the full working state without touching the real index: copy the index to a temp file, then `GIT_INDEX_FILE=<tmp> git add -A && GIT_INDEX_FILE=<tmp> git write-tree`, then delete the temp file. This covers tracked changes and untracked, non-ignored files.
- Report it as `candidate: <base>:<tree>`. In Full SDD, also report the runtime's `implementationSubjectDigest`; slice 4 decides whether the runtime adopts the tree ID directly.
- No VCS or the recipe fails → no reuse; consumers re-run what they need.

**Reuse and invalidation:** an evidence record is `{command, source, scope, result, duration, candidate, inputs}`. A delta invalidates only records whose `inputs` intersect changed paths. Unknown inputs invalidate every record for the touched package or module.

### Full SDD evidence chain (A14, A15)

- **Today:** Apply runs checks; Verify reruns targeted, then affected_area; Review; broad. Any change invalidates everything. Up to three executions of the same commands.
- **New rule:** Verify accepts Apply records for `targeted` and `affected_area` when the candidate matches the QA snapshot's `implementationSubjectDigest`. Independence comes from the compliance matrix and oracle review, not re-execution. `broad` runs once per final candidate. Protected risk adds one independent re-execution.
- **Runtime touchpoints:** `SafeEvidenceRefV1` stage evidence gains a provenance (`producedBy: apply|verify|ci`) and the candidate identity. Acceptance checks digest equality. Optional V1 field vs V2 is decided by a short Investigate of `verification-state.ts` parsing (slice 4).

### Runtime red-first rule

`VerificationDisciplineEvidenceV1` gains `redFirstRequired: boolean`. `TDD_PRIOR_FAILURE_REQUIRED` fires only when `redFirstRequired`. `TDD_PASSING_STAGES_REQUIRED` still fires on `behaviorChanged`. Generated-output checks unchanged. Codes keep their names (stable identifiers).

## 3. Evidence contract (all roles, all topologies)

```
Verification
- <command> | source: instructions|ci|manifest|doctrine-default | scope: focused|affected|full|protected-reexec | result: pass N / fail M (exit c) | <duration> | candidate: <base>:<tree>
Tests added/changed
- <file>::<name> — protects: <behavior/regression>; oracle: <spec/issue/contract ref>; fails if: <what breaks it>; red-first: <observed|not required (reason)>
Deliberately not tested
- <change> — covered by <cheaper check> | do-not-test: <category>
Retired
- <file> — <category>; evidence: <runtime, duplicate of X, fault probe>; approved: <batch id>
Reused evidence
- <stage> ← <producer role/task> record for <candidate>
```

Quality rejects reports that add tests without a "protects" line and flags oracles copied from implementation output. Quality flags only gaps that affect correctness or stated requirements, never tests for cases that cannot happen.

## 4. Project policy schema and deck-init

The shipped policy schema, written by deck-init into a user project's `openspec/config.yaml` in block style (no flow collections):

```yaml
testing:
  policy: proportional          # proportional | strict
  red_first:
    - reproducible_bug_fix
    - specified_logic
  commands:                     # only discovered or user-supplied values
    focused: "<discovered>"
    affected: "<discovered, if the project has selection tooling>"
    typecheck: "<discovered>"
    lint: "<discovered>"
    full: "<discovered>"
  validators:                   # per artifact category present in the project
    templates: "<discovered>"
    config: "<discovered>"
```

Rules:
- deck-init detects commands with the §1 discovery procedure. Unknown keys are omitted, not guessed.
- deck-init never writes Deck-repo commands, Bun commands in non-Bun projects, or tier suffixes.
- `strict` is written only on the user's request. `strict_tdd`, `strict_tdd_gates` and `coverage_threshold` are never written.
- Existing user values are preserved (config-merge rules unchanged).

---

# Part II — Runner and topology parity

## 5. One canonical source, five consumers

| Surface | Canonical source (`@deck/core`) | Consumers (materialization points) |
|---|---|---|
| Doctrine core block (new constant, for example `VERIFICATION_DOCTRINE_CORE` in `packages/core/src/teams/developer/verification-doctrine.ts`) | Included by Lead, Apply (adaptive and legacy general/frontend/backend), Quality and Verify bodies in **both** `compact` and `legacy` profiles | Pi agents (`developer-team-install.ts:572`), OpenCode agents (`runner-capabilities.ts:240`), Codex agents/skills (`developer-team-install.ts:210,276`), Claude plugin `agents/*.md` + role `skills/*/SKILL.md` (`runner-adapter.ts:73-86`), cross-runner `sessionRolePrompt` (`apps/cli/src/session-service.ts:85`) |
| `deck-verification` skill (`packages/core/src/skills/external/deck-verification/SKILL.md`, registered in `STANDALONE_SKILLS`, bundled into `content.generated.ts`) | Full procedure, category table, examples, retirement | Pi (`global-materialization.ts:81`, `developer-team-install.ts:617`), OpenCode (`runner-adapter.ts:1302`, `opencode-launch-command.ts:237`), Codex (`developer-team-install.ts:281-287`), Claude (`runner-adapter.ts:89-93`) |
| Vendor TDD skill description patch | `test-driven-development/SKILL.md` frontmatter | Same four standalone-skill consumers |
| Runner execution assets | Unchanged; no doctrine content | Regenerated only if imported core code changes |

Rules:
- Role bodies reference the skill by bare ID `deck-verification`. Runner-specific naming (for example Claude plugin namespacing) stays in each adapter's existing instruction translation; slice 2 confirms each runner resolves the bare ID.
- The core block is short (target ≤ 1.5 KB) because it is duplicated into every role body. It covers: discover conventions first; decision procedure summary; red-first triggers; do-not-test list; moments and reuse by candidate identity; evidence contract lines; "load `deck-verification` for the full table and retirement".
- Adapters add no doctrine wording.

## 6. Evidence reuse per topology

**Native runner** (Deck installed in Pi, OpenCode, Codex or Claude Code; Lead delegates through the runner's native subagents):
- Apply subagent runs edit-loop and handoff checks and returns the §3 report with `candidate`.
- Quality subagent recomputes the candidate in the same workspace. Match → reuse. Mismatch → re-run affected checks.
- Lead, when integrating, checks that the cited evidence matches the current candidate and does not re-run it.

**Cross-runner session** (session-host Lead; members delegated via `deck_delegate`, possibly on different runners and models):
- Only the task report and session-host task evidence cross the boundary (`baseHead`, scoped diff, edit-artifact digests, report artifact digest). Runner-local state never counts.
- The report's `candidate` is a claim. The consumer (Quality member or Lead) recomputes it in the shared workspace before reuse. Different runners or models do not matter: command results are deterministic facts about the candidate; oracle review is Quality's own judgment.
- Concurrent members can change the workspace (`potentiallyMixed`). Then the candidate differs and only checks whose inputs changed are re-run, not everything.
- `deck_task_integrate` records adoption of a task result. It is not verification. When Lead integrates, it cites the evidence seqs of a report whose candidate matches the current workspace, or records that verification is pending.
- Optional (Q5): session-host records the candidate identity at task end next to `baseHead`, so Lead can compare without trusting the member's report. This touches protected session-host lifecycle code, so it is a separate slice with Quality.

## 7. Who runs what, by topology

| Moment | Native runner | Cross-runner session |
|---|---|---|
| Edit loop | Apply subagent (or Lead on a direct route) | Apply member on its runner |
| Handoff | Apply subagent | Apply member; report carries `candidate` |
| Review/Verify | Quality/Verify subagent: recompute, reuse, protected re-exec | Quality member (any runner/model): recompute, reuse, protected re-exec |
| Integration | Native Lead: candidate check, no re-run | Session Lead: candidate check, cite evidence seqs in `deck_task_integrate`, no re-run |
| Final full gate (when required) | Lead runs once, or delegates once to Apply; project CI for the same commit satisfies it | Same; Lead delegates once to an Apply member or runs it itself |

## 8. Parity verification (structural)

One test, `apps/cli/src/verification-parity.test.ts` (in `apps/cli` because it is the only package that composes all adapters), builds each runner's materialization plan into memory or a temp dir and the session role prompts, then checks:
1. Each runner's skill set contains `deck-verification` with valid frontmatter (`name` = ID).
2. Each runner's Lead, Apply, Quality and Verify role output, and `sessionRolePrompt` for lead/apply-fast/apply-deep/quality, contain `VERIFICATION_DOCTRINE_CORE` byte-identical after stripping runner framing.
3. No materialized asset carries the old TDD auto-trigger description, and no role body names `test-driven-development` as a default.
4. The `deck-verification` SKILL.md body is byte-identical across runners after frontmatter normalization.

Entry points to reuse: Pi's install plan (`buildDeveloperTeamInstallPlan` path in `developer-team-install.ts`) and `global-materialization.ts`; OpenCode `runner-capabilities.ts` manifest; Codex `developer-team-install.ts` plan; Claude `expectedFiles` (`runner-adapter.ts:68`, needs an export or a plan-level API); `sessionRolePrompt` (needs an export). The existing `adapter-pi/src/capability-parity.ts` and `adapter-opencode/src/parity-consumer.test.ts` are checked first and extended if they already enumerate materialized files. This replaces any per-runner phrase tests about TDD.

---

# Part III — Deck-repo application

Everything below applies only to the Deck repository.

## 9. Skill and role content plan

**Regeneration path.** Edit `packages/core/src/skills/external/<id>/SKILL.md` or the role TS sources. Run `bun scripts/generate-skill-bundle.ts` to refresh `content.generated.ts`, then `bun scripts/generate-runner-execution-assets.ts` to refresh runner bridges. Both assert the pinned Bun from `release.yml`. Then `bun run canary:install` and dogfood each runner. Never hand-edit `content.generated.ts`.

| Target | Action |
|---|---|
| **New `VERIFICATION_DOCTRINE_CORE`** | Shared constant per §5, included in both profiles of Lead, Apply (all variants), Quality, Verify. Stack-neutral. |
| **New `deck-verification` skill** | Deck-owned. §1 principles, discovery, procedure and category table; red-first and hermetic rules; §2 moments and candidate recipe; §3 evidence contract; **Retire** section (evidence format, fault-injection check, approval requirement). Keeps TDD's valuable parts: Prove-It bug reproduction, real over mocks, fakes at edges. Stack-neutral examples only. Description: "Use when deciding whether and how to verify a change, writing or reviewing tests, or proposing test retirement." |
| `test-driven-development` (vendor) | Keep registered as opt-in. Patch only the `description` to "Use only when the project testing policy is strict or the user explicitly requests TDD." |
| `debugging-and-error-recovery` (vendor) | Patch `:287,297`: regression test only when the fault is reproducible at a stable boundary; otherwise record diagnostic evidence. |
| `code-simplification` (vendor) | Patch `:159`: focused tests per step, affected checks once at the end. |
| `code-review-and-quality` (vendor) | Patch `:335`: flag missing regression tests only for reproducible bug fixes and protected risk; reference the do-not-request list. |
| `adaptive-team-content.ts` `APPLY_TDD` | Rename to `APPLY_VERIFICATION`; include the core block; load `deck-verification`. Keep the frontend visual paragraph. |
| `QUALITY_AGENT_BODY` | Include the core block; candidate recompute and reuse; oracle independence; correctness gaps only; do-not-request list. |
| `apply-general/frontend/backend-content.ts` `:306/315/302`, `:38/177/182/179` | Point to `deck-verification`; remove "sufficient coverage"; typecheck once at handoff; build only when build inputs change. |
| `verify-content.ts` Steps 3–4 | Reuse by candidate; missing/invalidated checks only; broad once. |
| `orchestrator-content.ts:50,811,1056` | Replace "Apply-local evidence … does not satisfy" and "fresh final independent QA" with the §2 reuse rule; keep label-only evidence rejection as "label-only red-first evidence"; add integration-is-not-verification for both topologies. |
| `task-content.ts:501,517` | "verification evidence" replaces "TDD evidence"; RED/GREEN only for red-first tasks. |
| `instruction-bundles/code-economy.ts:131` | "Tests: proof of required behavior at stable boundaries (see deck-verification)." |
| `deck-onboard-content.ts:19` | "Verify proportionally (deck-verification)." |
| deck-init content | Emit the §4 schema with discovered commands only. |
| CONTRIBUTING.md, AGENTS.md | Deck-repo commands and tiers (§11). Mark them as this repo's conventions. |

## 10. Deck's own `openspec/config.yaml`

Replace `rules.apply.tdd`, `rules.verify.coverage_threshold`, `testing.strict_tdd`, `testing.strict_tdd_gates` and stale `layers` with block-style YAML:

```yaml
rules:
  apply:
    - Follow existing code patterns
    - Verify with the deck-verification doctrine; focused checks in the edit loop, test:changed once at handoff
  verify:
    - Reuse Apply evidence bound to the same candidate; run only missing or invalidated checks
testing:
  policy: proportional
  red_first:
    - reproducible_bug_fix
    - specified_logic
  commands:
    focused: "bun test <file>"
    affected: "bun run test:changed"
    typecheck: "bunx tsc --noEmit"
    full: "bun run test:full"
  tiers:
    fast: "*.test.ts(x), in-process, median file <= 1s"
    int: "*.int.test.ts(x), subprocess, git fixtures, composition"
    e2e: "*.e2e.test.ts(x), binary, cross-runner, TUI/web flows"
  quarantine: tests/quarantine.yaml
  baseline_health:
    ledger: openspec/baseline-health.yaml
    policy: |
      (unchanged)
  security_constraints: |
    (unchanged)
  quality:
    type_checker:
      command: "bunx tsc --noEmit"
```

Acceptance: parses with `yaml` and `readOpenSpecInitState`.

## 11. Deck repo test architecture

- **Tiers:** suffixes per spec Capability C. Rename `*e2e*` and `*.integration.*`; move subprocess/binary/>3 s files to `.int.` using audit data; `apps/web/*-acceptance.ts` stays outside `bun test`.
- **Wrapper `scripts/test.ts`:** `--tier fast|int|e2e|all`, `--changed[=ref]`, `--quarantine`, passthrough. Enumerates `git ls-files` tests, applies the `bunfig.toml` ignore list and quarantine, filters by suffix, invokes `bun test` with explicit paths (`--parallel` when available). `--changed` uses Bun's built-in when the pinned Bun supports it with tier exclusion, else a `Bun.Transpiler.scanImports` closure. Non-import inputs (fixtures, `*.generated.ts`, `package.json`, `bunfig.toml`, `bun.lock`, `scripts/test-preload.ts`) expand to the owning package's fast+int; lockfile/`bunfig.toml`/preload expand to everything. Prints the selection reason.
- **Scripts:** `test` = `test:fast`; `test:changed`; `test:int`; `test:e2e`; `test:full` (`--timeout 30000`); `test:quarantine`. `release.yml` calls `test:full`.
- **CI:** PR workflow `ci.yml` (if Q2): `tsc`, `test:fast`, `test:int`, generated-asset freshness, verification-parity test. `release.yml` keeps the full suite. `nightly.yml`: `test:e2e`, `test:full --randomize --seed=$RUN_ID`, `test:quarantine` (expired fails), fault-probe sample, optional evals. Shard only if `test:full` > 10 min.
- **Budgets (provisional):** fast-file median ≤ 1 s; `test:changed` ≤ 20 s typical; `test:fast` ≤ 90 s; PR job ≤ 10 min.
- **Quarantine:** `tests/quarantine.yaml` `{file, test?, owner, reason, link, added, expires}`, expiry ≤ 14 days; no retries in required tiers; protected entries need user approval.
- **Fault probe:** `scripts/fault-probe.ts` applies known mutations (negate a guard, drop a check, swap a constant) to must-keep modules and asserts a test fails. Stryker only after a runtime spike.

## 12. Pruning framework (Deck repo)

**Categories:**

| Code | Category | Default action |
|---|---|---|
| K | Protected-risk or incident guard, or boundary behavior with independent oracle | Keep; speed-fix or demote |
| C | Change-detector: prose, large-text snapshot, markup, constants, generated contents | Retire; structural invariant if a property matters |
| I | Implementation-mirroring: call counts, private state, mock choreography, copied oracle | Rewrite at boundary or retire |
| T | Type-redundant | Retire |
| D | Duplicate | Merge, then retire |
| S | Slow but valuable | Move to int/e2e or fix speed |
| F | Flaky | Quarantine and fix within expiry, or retire if also C/I/T/D |

**Value questions:** can it fail for a behavioral reason; is the oracle independent; does it guard protected risk or an incident (`git log -S`, issue/OpenSpec ref); does a remaining test fail under the same fault; runtime and failure history.

**Safe batch process:**
1. Select a batch: one package, ≤ 40 files or ≤ 1 category.
2. Record before state: file count, tier runtimes, lcov line coverage for touched protected modules.
3. Fault probe for each K-adjacent retirement.
4. Present the batch (list, categories, evidence, expected saving). **Wait for user approval.**
5. Apply in one commit; update `openspec/baseline-health.yaml` if affected.
6. Run `test:full` and `tsc`; accept if green and no unexplained protected coverage drop.
7. Record in `apply-progress.md`. Rollback is `git revert <commit>`.

**Must-keep (by area; audit maps to files):**
- **Git safety:** `packages/core/src/teams/developer/git-safety.test.ts`, adapter discard-protection hook tests.
- **Approvals/authority:** session-host approval and approval-scope tests; sdd-runtime `qa-authority`, `qa-execution-authority`, `qa-runner-host-authority`, `readiness-authority`, finding-disposition authority.
- **Session-host lifecycle:** `session-manager`, `recovery.integration`, `cross-runner.e2e`, event-ledger and transport tests.
- **Release/install:** `tests/release-workflow.test.ts`, `scripts/release-build-contract.test.ts`, `scripts/install-canary.test.ts`, generated-asset freshness, runner-install contract/e2e, adapter preflight, migration/rollback/backup.
- **Runner parity:** the new `verification-parity.test.ts` and existing adapter materialization-layout tests.
- **Data integrity:** OpenSpec state/registry writers, `baseline-evidence`, artifact-state contracts, `init-state`, config-merge, model-migration.
- **Security:** secret handling, path traversal/sandbox, MCP bridge authorization.

Block-level C/I/T retirement inside must-keep files follows the same process.

### 12.1 Per-file pruning batches — PLACEHOLDER

> **To be filled from audit task `task-535e1c2f-b9ff-47a4-be4a-8fa1a0a7d0e4`.** Nothing is deleted before the user approves each batch.

| Batch | Scope | Files | Categories | Evidence (runtime, duplicate, probe) | Expected saving | Status |
|---|---|---|---|---|---|---|
| B0 | `packages/core/src/teams/developer/*-content.test.ts` phrase assertions → content invariants (§13), plus per-runner TDD phrase tests superseded by the parity test (§8) | TBD | C | TBD | TBD | pending audit |
| B1 | Tier reclassification (slow → int) | TBD | S | TBD | TBD | pending audit |
| B2… | TBD | TBD | TBD | TBD | TBD | pending audit |

## 13. Verifying Deck's own prompt and skill content

- **`packages/core/src/teams/developer/content-invariants.test.ts`** iterates the content registry in both prompt profiles, `ADAPTIVE_AGENT_CONTENT` and `STANDALONE_SKILLS`:
  1. Frontmatter parses; `name` matches the ID.
  2. Required sections per role from a declarative map.
  3. Referenced skill, agent and tool IDs resolve.
  4. Protected blocks included verbatim where required: `GIT_DISCARD_PROTECTION_RULE`, `FINDING_DISPOSITION_AUTHORITY_BOUNDARY_V1`, `ADAPTIVE_TEAM_RUNTIME_CONTRACT`, `VERIFICATION_DOCTRINE_CORE`.
  5. Banned phrases: "strict TDD" as default, "sufficient test coverage", "every new behavior has a corresponding test", "run tests after every refactor step", and stack-specific terms in doctrine content (for example "merchant", "Liquid", "bun test" inside `VERIFICATION_DOCTRINE_CORE`), so the shipped doctrine stays stack-neutral.
  6. Size budgets per role/skill; core block ≤ 1.5 KB.
  7. Generated-bundle freshness (existing generator tests).
- **Runner parity** is §8, not this file.
- **Retire:** phrase assertions in the 35 `teams/developer/*.test.ts` files, prime candidates `*-content.test.ts`, `prompt-profile.test.ts`, `execution-v1-prompt-baseline.test.ts`, `user-phase-communication.test.ts`, `skill-discovery-content.test.ts`; prose asserts in `skills/external/__tests__/content.test.ts` and `tests/documentation-governance.test.ts` (keep link/structure checks). Keep behavioral tests (`manifest`, `catalog`, `content-registry`, `model-migration`, `git-safety`, `orchestrator-invariants`, `readiness-authority`). Audit confirms per file in B0.
- **Optional eval harness** (`evals/verification/*.yaml`, nightly or dispatch): fixture repos across stacks, each with a task and a deterministic grader over the diff and report:
  - copy change in a template project → no new test;
  - reproducible parser bug in a typed project → red-first regression test with a "protects" line;
  - pass-through in a typed project → typecheck only;
  - logic change in a Python project with documented `pytest`/`ruff` → those commands used, no Deck conventions created;
  - protected authority change → negative boundary test.

  Scenarios run per runner to measure parity in behavior, not just text. LLM rubric only where unavoidable, calibrated on labeled examples. Budget needs a decision (Q3).

## 14. Decisions and tradeoffs

- **Core block + skill, not skill only.** Cross-runner members may lack installed skills; the core block guarantees parity. The cost is ~1.5 KB per role body, bounded by a size budget.
- **Candidate identity from git, not runtime state.** Any role on any runner can recompute it; no new protocol is needed for the first slices. Session-host capture is an optional hardening (Q5).
- **Fork instead of rewriting the vendor TDD skill.** Minimal listed patches keep upstream refreshes mechanical; TDD stays opt-in.
- **Discovery over defaults.** Deck adapts to the user's stack instead of exporting its own layout.
- **Selection before deletion** (Deck repo). Tiers and `test:changed` land first; pruning waits for audit data and approval.
- **Reuse over re-execution.** Independence comes from oracle review; protected risk keeps one re-execution.
- **Not chosen:** coverage thresholds; mandatory mutation testing; mandatory evals in required CI; per-runner doctrine variants.

## 15. Open questions (need the user)

- **Q1 Deck-repo Bun pin.** For this repository's own tooling, bump the canonical Bun from 1.3.12 to 1.4.x (`packageManager`, workflows, generator assertion, regenerated assets) to use built-in `--changed`/`--parallel`? It does not affect the shipped doctrine. Recommendation: yes, as its own release-verified slice; Deck's wrapper works either way.
- **Q2 Deck-repo PR CI.** Add a `pull_request` workflow to this repository (tsc + fast + int + parity test)? Today Deck's tests run only on main/tags. It does not affect user projects. Recommendation: yes.
- **Q3 Evals.** Allow a model-backed eval harness with a secret and budget, nightly or dispatch only, across runners? Recommendation: build the deterministic harness; run manually until approved.
- **Q4 Approval granularity.** Approve Deck test deletions per batch (recommended) or the whole plan once the audit is filled?
- **Q5 (new) Session-host candidate capture.** Should session-host record the candidate identity at task end, next to `baseHead`, so the cross-runner Lead can check reuse without trusting the member's report? It touches protected session-host lifecycle code. Recommendation: yes, as a later slice after the prose-level rule proves useful; slices 1–4 do not depend on it.
