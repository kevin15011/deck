# Research: testing strategy for an agent engineering system

Source: Investigate task task-d9d057e7-49d4-487e-8824-c472f24a87cd attempt 2 (verified follow-up of attempt 1). Markers: [F] fetched, [A] abstract/summary only, [K] from knowledge, unverified.


Markers: **[F]** = page fetched and read. **[A]** = abstract or search summary only. **[K]** = from my own knowledge, not checked this session.

## 1. Empirical studies of agent-written tests

- **Test volume (Milanese et al., arXiv 2601.21194, AIDev) [F, abstract]:** 6,582 agent PRs vs 3,122 human PRs.
  - Tests appear in 42.9% of agent PRs and 40.0% of human PRs.
  - The agent test-to-source line ratio is nearly double the human one.
  - Agents are more likely to add new tests (OR=1.79). Humans more often modify existing tests.
  - Test-smell differences have negligible effect size.
  - So agents write more test code, not measurably smellier code. The abstract does not measure value.
  - https://arxiv.org/abs/2601.21194
- **Test quality (arXiv 2607.12068) [F, abstract]:** 204,673 test files (179,732 agent, 24,941 human), Python, static analysis only.
  - Strong assertions: humans 88.1%, agents 85.37%.
  - Edge-case variety: agents 0.62 vs humans 0.32.
  - Flakiness-candidate rate: agents 0.41 vs humans 0.30, mostly from file I/O and non-determinism.
  - The "stealth technical debt" claim is the authors' framing. They say agents lack environmental awareness for hermetic tests.
  - https://arxiv.org/abs/2607.12068
- **Coverage (arXiv 2607.18057) [F, abstract]:** 4,882 agent PRs (Java and Python).
  - Agents changed tests in only 49.6% of PRs touching code under test.
  - In 64.8% of PRs, no changed line is executed by any existing test.
  - Agent tests improved coverage in only 35.9% (Java) and 22.5% (Python) of "Code + Tests" PRs.
  - Error-handling code was missed 86% (Java) and 81% (Python) of the time.
  - The authors call for coverage feedback loops for agents.
  - https://arxiv.org/abs/2607.18057
- **Oracle problem (Konstantinou, Degiovanni, Papadakis, arXiv 2410.21136) [F, abstract]:** 24 Java repositories.
  - "LLM-based test generation approaches mainly capture the actual program behavior."
  - LLMs generate oracles better than they classify them, and beat EvoSuite on fault-detection potential.
  - A search summary [A] reports under 50% accuracy. I could not confirm that in the abstract I fetched.
  - https://arxiv.org/abs/2410.21136
- **Other oracle work [A]:**
  - AugmenTest (arXiv 2501.17461) says regression-style assertions cannot catch bugs where the implementation deviates from expected behavior.
  - A 2026 pilot found that oracles generated from requirements align with the requirements, not the system under test. It is 10 Defects4J bugs only, so preliminary.
- **TDD with agents [A]:** TDDev (arXiv 2605.17242, May 2026) is a single controlled preprint.
  - Test-first infrastructure improved web-app generation by 34–48 points over no-TDD.
  - The best protocol depends on the model.
  - I found no replicated study of strict TDD for autonomous agents on general code.
- **Meta ACH [A, from the earlier report]:** mutation-guided generation, 73% of tests accepted by engineers. https://arxiv.org/abs/2501.12862

**Takeaway.** Agents produce more tests, not clearly better ones. Their tests mirror current behavior, are flakier, and often miss the paths that matter. The evidence supports gating tests on whether they can catch a fault, not capping test count. The 2×-lines result and the oracle finding fit the user's over-testing suspicion, but no study here measures suite slowdown directly.

## 2. Vendor guidance on agents and tests

- **Anthropic, Claude Code best practices [F]:** https://code.claude.com/docs/en/best-practices
  - "Give Claude a way to verify its work." The check can be tests, a build, a linter, a fixture diff or a screenshot.
  - Verification options escalate: one prompt, `/goal`, a Stop hook as a deterministic gate, and an independent verification subagent so the worker is not the grader.
  - It tells agents to "Prefer running single tests, and not the whole test suite, for performance."
  - It recommends scoping test requests (example: "covering the edge case where the user is logged out. avoid mocks.").
  - It warns that a reviewer told to find gaps over-engineers: "extra abstraction layers, defensive code, and tests for cases that can't happen." It says to flag only gaps affecting correctness or stated requirements.
  - It endorses "write a failing test that reproduces the issue, then fix it" for bug fixes.
  - It suggests a Writer/Reviewer split, "one Claude write tests, then another write code to pass them."
  - It does not mandate strict TDD.
  - It says to prune instructions: "Would removing this cause Claude to make mistakes?"
- **OpenAI Codex best practices [F]:** https://learn.chatgpt.com/guides/best-practices
  - "Ask it to create tests when needed, run the relevant checks."
  - Put build, test and lint commands and "What done means and how to verify work" in AGENTS.md.
  - Not documenting how to run tests is named as a common mistake.
  - It does not advocate TDD.
- **Google, GitHub, Cursor:** not fetched. No claims made.

**Is strict TDD recommended for agents?** Not by either vendor I read. Both recommend a runnable verification loop and targeted test runs. Red-first is endorsed for bug reproduction. The only supporting experimental evidence is the single TDDev preprint.

## 3. Verification tools, and when each is better

- **Strict types, TS compiler [K]:** best for shape and interface errors. Free at edit time, zero maintenance. Tests that only check types or shapes are redundant with it.
- **Linters and static checks [K]:** best for banned patterns and architecture-boundary rules. Deck's package-boundary invariants in AGENTS.md fit this tool better than example tests.
- **Schema and contract validation [K]:** validate once at the boundary (Zod or similar) rather than writing many shape assertions.
- **Property-based testing, fast-check [K]:** best for parsers, serializers, state machines and anything with an invariant. It removes the need for many hand-picked examples.
- **Mutation testing, Stryker [F]:** the value signal for "do these tests catch faults?"
  - Incremental mode (`--incremental`, `--incrementalFile`) reruns only mutants whose code or tests changed. Previous results are reused from `reports/stryker-incremental.json`.
  - `--force --mutate file:5-7` scopes a rerun to a file or line range.
  - Limits: it diffs against the stored report, not a git branch. It does not detect changes to dependencies, snapshots or env. Test-change detection quality varies by runner (Vitest and Jest report full locations, command runners report nothing). A `bun test` setup would be a command-runner case, which means no test-change detection. I did not test Stryker with Bun.
  - https://stryker-mutator.io/docs/stryker-js/incremental/
- **Approval and golden tests [K]:** fine for small, stable, reviewed outputs. They are poor for large text, because updating the snapshot becomes a reflex.
- **Runtime assertions and invariants [K]:** good for conditions that should never occur. They fail loudly in production use, not only in tests.
- **Prompt and skill content [A, practitioner and vendor docs]:**
  - Promptfoo's guide recommends deterministic checks (`equals`, `contains`, `is-json`, regex) where they fit, and `llm-rubric` model-graded judges for open-ended output.
  - It says to start with one clear pass/fail criterion and calibrate the judge on labeled examples before trusting it in CI.
  - https://www.promptfoo.dev/docs/guides/llm-as-a-judge/
  - For Deck, whole-string assertions on generated prompts are change-detectors. A structural check (required sections, referenced tool names exist, no banned phrases) is cheap and deterministic. Behavior is better checked with a small eval run off the hot path.

## 4. Fast-feedback mechanics for Bun/TS

- **Bun [F]:** https://bun.sh/docs/cli/test and https://bun.sh/docs/test/parallel
  - Path filters are positional (`bun test foo`). Use a leading `./` for an exact file. Glob patterns are not supported.
  - `-t` filters by test name.
  - `--parallel` spreads files across cores. `--no-isolate` is faster but only safe if files do not leak state.
  - `--shard=i/n` splits by sorted path. `--timings=<file> --update-timings` balances shards by recorded duration.
  - `--randomize` and `--seed` expose order dependence. `--bail[=n]` stops early.
  - `--timeout` defaults to 5000 ms.
  - Neither page documented `--changed` or related-file selection. I did not run `bun test --help`, so treat Bun's built-in affected selection as unconfirmed and likely absent.
- **Vitest [F]:** https://vitest.dev/guide/cli.html
  - `vitest related <files> --run` runs tests that statically import those files. Dynamic imports are missed.
  - `--changed [since]` selects by git diff against a ref such as `origin/main`.
  - `--shard` and `--project` are supported.
- **Nx affected [F]:** https://nx.dev/ci/features/affected
  - It selects tasks whose declared inputs include a changed file, against a base such as `origin/main`.
  - Weaknesses: undeclared inputs cause misses, a lockfile change selects everything by default, and a change to shared code selects most of the workspace.
  - `--explain` shows why a task was selected.
- **Turborepo `--affected` [K]:** package-level selection, similar in spirit.
- **Tiering [K]:** this follows Google's size model (small, medium, large). I propose directory or suffix conventions, not Deck's current layout:
  - `*.test.ts` for the fast tier.
  - `*.int.test.ts` for integration.
  - `*.e2e.test.ts` for end-to-end.
  - `*.slow.test.ts` for anything over a time budget.
- **Flaky quarantine [K]:** Google reported about 1.5% of test runs flaky, with new flakiness arriving about as fast as it is fixed. I did not re-fetch that post.

## 5. Pruning and retirement

- **Search result [A]:** it found no public account of how Google or Microsoft retire tests.
- **Industrial GA reduction (Stadler, Plösch, Ramler, 2023) [A]:** 28% fewer tests with minimal coverage loss on a suite of several hundred. Obstacles were unreliable execution history and flaky tests. https://research.jku.at/en/publications/applying-a-genetic-algorithm-for-test-suite-reduction-in-industry/
- **Coverage-only redundancy gives false positives [A]:** Koochakzadeh & Garousi (2010) propose tester-assisted detection confirmed by mutation analysis. https://prism.ucalgary.ca/items/fb331137-db00-4917-b985-402f13f90ac3
- **Meta predictive test selection and Google TAP [K]:** selection is the proven way to cut run cost without deleting tests.
- **Safe process I'd propose, built on those signals:**
  1. Measure per-test runtime and failure history.
  2. Run mutation on the candidate area and find tests that kill no mutant uniquely.
  3. Move candidates to a slow tier first.
  4. Delete after a few weeks with no unique failures.
  5. Keep any test that guards a past incident.
  - This procedure is my synthesis, not a published standard.

## Proposed Deck testing doctrine

**Principles**
1. Verification is mandatory. Tests are one tool among several, and TDD is optional. Red-first applies to bug fixes and parsers or state logic with a clear spec.
2. A test earns its place if it can fail for a real behavioral reason. It must assert intended behavior at a public boundary, not current output or internal calls.
3. Prefer the cheapest tool that proves the property: types, then lint or architecture rules, then schema validation, then property test, then example test, then integration, then e2e.
4. Never snapshot or string-match whole prompts, skills or markdown. Check structure and invariants, and use evals for behavior.
5. Fast tier by default while developing. The full suite belongs in CI, not in the edit loop.

**Decision procedure for an agent**
1. *Test or not?* Skip tests for trivial code (getters, pass-throughs, constants, re-exports), wiring that types already prove, and text content. Add a test when behavior is non-obvious, a bug is being fixed, a boundary or invariant exists, or no cheaper tool covers it.
2. *Which level or tool?* Use the order in principle 3. Mock only at process or network edges, and prefer fakes.
3. *What to assert?* Take intended behavior from the task, spec or issue, not from reading the implementation. State why the test would fail if the behavior broke. Avoid assertion on call counts or private state.
4. *How many?* Add a new test only if it covers something no existing test does. Extend an existing test first. Do not exceed what the change needs. Use `test-to-source` growth as a review signal, not a cap.
5. *Hermetic.* No real clock, network, random or shared file state. Use temp dirs and injected time. Run `--randomize` periodically to catch order dependence.
6. *What to run when:*
   - Edit loop: typecheck plus targeted test files for the changed code (path filters, `-t`, or git-diff-based selection).
   - Before handoff: affected tests plus lint.
   - CI: full suite, sharded with timing balance.
   - Nightly or release: slow, e2e, mutation on changed files, and evals.
7. *Report evidence.* Show the command run and its result. A separate reviewer role checks that tests assert intended behavior, with instructions to flag only correctness or requirement gaps.
8. *Retire.* An agent may propose deleting a test only with evidence (slow, duplicate, no unique mutant kill). A human approves.

## Gaps and caveats

- All empirical results above are recent preprints, and I read abstracts only.
- None of these studies measures slowdown of the edit loop, so the user's central suspicion rests on inference plus the 2× test-volume finding.
- Next step, outside this read-only task: measure Deck's own suite (per-file runtime, flaky history, mutation on a sample) to see whether the problem is volume, slow tests, or the full suite running in the edit loop.

## Sources

- [F] https://arxiv.org/abs/2601.21194
- [F] https://arxiv.org/abs/2607.12068
- [F] https://arxiv.org/abs/2607.18057
- [F] https://arxiv.org/abs/2410.21136
- [F] https://code.claude.com/docs/en/best-practices
- [F] https://learn.chatgpt.com/guides/best-practices
- [F] https://bun.sh/docs/cli/test
- [F] https://bun.sh/docs/test/parallel
- [F] https://vitest.dev/guide/cli.html
- [F] https://nx.dev/ci/features/affected
- [F] https://stryker-mutator.io/docs/stryker-js/incremental/
- [A] https://arxiv.org/abs/2605.17242
- [A] https://arxiv.org/abs/2501.17461
- [A] https://arxiv.org/abs/2501.12862
- [A] https://www.promptfoo.dev/docs/guides/llm-as-a-judge/
- [A] https://research.jku.at/en/publications/applying-a-genetic-algorithm-for-test-suite-reduction-in-industry/
- [A] https://prism.ucalgary.ca/items/fb331137-db00-4917-b985-402f13f90ac3
- [K] https://abseil.io/resources/swe-book/html/ch11.html
- [K] https://abseil.io/resources/swe-book/html/ch12.html
- [K] https://www.manning.com/books/unit-testing
- [K] https://testing.googleblog.com/2016/05/flaky-tests-at-google-and-how-we.html
- [K] https://arxiv.org/abs/1810.05286