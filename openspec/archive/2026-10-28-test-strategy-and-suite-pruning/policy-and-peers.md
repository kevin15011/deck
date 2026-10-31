# Deck agent testing rules and peer projects

Source: Investigate task task-04081a38-f937-4c5d-ad49-1ce3a391a3c2 attempt 1. Peer value judgments are sample-based.

## Part A — Deck's testing instructions

Source refs are under `packages/core/src/teams/developer/` unless stated otherwise.

| # | Rule (quote) | Where | Effect | Verdict |
|---|---|---|---|---|
| A1 | "tdd: true", "strict_tdd: true", "coverage_threshold: 0" | `openspec/config.yaml:27,37,32` | Project-level TDD is mandatory with no escape hatch. The runner-install `strict_tdd_gates` are hard-coded to three specific test files plus the baseline ledger (`:57-61`). | **Revise.** Replace boolean strict TDD with "proportional" (matches A2). Drop the hard-coded gates, which are stale and specific to one old feature. |
| A2 | "New behavior or a bug: demonstrate RED, implement GREEN, then refactor if useful." "Cosmetic, documentation, or configuration work: … never manufacture an artificial RED." | `adaptive-team-content.ts:80-90` (`APPLY_TDD`, shared by apply-fast and apply-deep) | This is the core rule and it is sensible. It still defaults to a RED test for every "new behavior", which in a Shopify or Liquid context becomes string assertions. | **Keep, tighten.** Add "RED only when behavior is observable at a runtime boundary, not markup or text". |
| A3 | "Run focused evidence first and affected evidence once when justified." | `adaptive-team-content.ts:92` | Good: focused first, affected once. | **Keep.** |
| A4 | "Write a failing test before writing the code… Tests are proof — 'seems right' is not done." | `skills/external/test-driven-development/SKILL.md:10` | Absolutist framing. | **Revise.** Soften. |
| A5 | "Every new behavior has a corresponding test"; "Coverage hasn't decreased (if tracked)"; "Writing code without any corresponding tests" listed as a Red Flag | same, `:376-381`, Red Flags section | Test-per-behavior checklist. Pushes agents to add tests for trivial changes. | **Revise.** Change to "every non-trivial behavior at a stable boundary". |
| A6 | "'This is too simple to test' → Simple code gets complicated. The test documents the expected behavior." "'I tested it manually' → Manual testing doesn't persist." | same, `:353-359` | Rationalization table that explicitly rebuts the reasons not to test. | **Remove or rebalance.** This is the strongest over-testing driver. |
| A7 | "Tests that pass on the first run (they may not be testing what you think)" | same Red Flags | Forces a RED run even for characterization tests. | **Revise.** |
| A8 | "When NOT to use: Pure configuration changes, documentation updates, or static content changes that have no behavioral impact." | same, `:19` | The only explicit opt-out, and it is narrow. | **Keep, widen.** Add prompt text, generated files, Liquid/JSON/markup, style-only and renames. |
| A9 | "Run tests after every refactor step" (`:80`); "Run each test command after a change that could affect the result. After a clean run, don't repeat the same command" (`:385`) | same | The first sentence conflicts with the second. Per-step runs are fine only if focused. | **Revise.** State "focused tests per step; affected once at the end". |
| A10 | "Follow the test-driven-development skill for RED-GREEN-REFACTOR, Prove-It testing, test pyramid, and real-over-mocks guidance when authoring or changing tests." | `apply-general-content.ts:306`, `apply-frontend-content.ts:315`, `apply-backend-content.ts:302` (legacy SDD apply roles) | Loads the full TDD skill. It carries the "unit tests ~80%" pyramid (`SKILL.md:142`) and "Coverage" language. | **Keep** (it only says "when authoring or changing tests"), but fix the skill. |
| A11 | "Run tests, build, and typecheck for the affected areas." "Tests (sufficient coverage)." | `apply-general-content.ts:38,177`; `apply-frontend-content.ts:182`; `apply-backend-content.ts:179` | Build and typecheck on every apply. "Sufficient coverage" is undefined. | **Revise.** Remove "sufficient coverage". Make build/typecheck conditional on type-affecting changes. |
| A12 | "Tests: Sufficient test coverage." listed under "No-Negotiables (Override LOC Reduction)" | `instruction-bundles/code-economy.ts:131` | Treats tests as non-negotiable and unbounded, alongside security and accessibility. | **Revise.** Reword to "tests proving required behavior at stable boundaries". |
| A13 | "Create independently verifiable tasks with exact scope, owner, dependencies, TDD evidence, checks…"; "RED/GREEN checks" per atomic task | `task-content.ts:501,517` (Full SDD) | Test-per-task in Full SDD. | **Revise.** RED/GREEN only for behavior tasks. |
| A14 | "Run the test suite for the affected areas: Unit… Integration… Backend… Frontend… Build: `bun run build`… Typecheck: `bunx tsc --noEmit`" | `verify-content.ts:30,38,157-175` | Verify reruns everything the apply agent already ran. | **Revise.** Reuse apply evidence unless the code changed after it. |
| A15 | "Apply-local evidence is non-independent and does not satisfy targeted, affected-area, Review, or broad evidence"; "fresh final independent QA in the existing targeted → affected_area → Review → broad order"; "Any code change invalidates stale Verify evidence" | `orchestrator-content.ts:50,811,1056` (Full SDD orchestrator) | Evidence is re-run per stage and every change invalidates it. | **Revise.** In practice this triples test runs. |
| A16 | "Run when the change affects security… public APIs… uncertain coverage… Quality is not a universal gate." "Use targeted evidence, affected evidence, and broad checks only to the depth justified by impact" | `adaptive-team-content.ts:31,111-115` | Well calibrated. | **Keep.** |
| A17 | Lead: "Direct: … run the minimum relevant check"; "Do not use file count as a routing signal" | `adaptive-team-content.ts:~14,29` | Good. | **Keep.** |
| A18 | "Run the smallest affected test first." Then run `bunx tsc --noEmit` and `bun run test` (full suite, 30s per-test timeout). | `CONTRIBUTING.md:91-104` | "Then run the relevant broader checks" lists the full suite as the second step. Full suite is a human default. | **Revise.** Make the full suite pre-merge or CI only. |
| A19 | "Focused verification starts with the tests affected by the change." | `AGENTS.md:19` | Good. | **Keep.** |
| A20 | "Debugging: A regression test exists that fails without the fix"; "No regression test added after a bug fix" | `skills/external/debugging-and-error-recovery/SKILL.md:287,297` | Regression test for every bug is a mandatory checklist item. | **Revise.** Require it only when the bug is reproducible at a stable boundary. |
| A21 | "Code simplification: Run tests after each change" | `skills/external/code-simplification/SKILL.md:159` | Slows refactor loops. | **Revise** to focused runs. |
| A22 | "No regression tests with bug fix PRs" is a review Red Flag | `skills/external/code-review-and-quality/SKILL.md:335` | Reviewers flag missing tests. | **Revise.** |

I found no rule that says to run the full suite after each edit. The actual inner-loop risk comes from three things:
- the TDD skill's "after every refactor step" rule (A9);
- Verify re-running everything (A14, A15);
- the rationalization table (A6), which removes the agent's license to skip tests.

I found no explicit coverage targets. There is `coverage_threshold: 0`, "Coverage hasn't decreased (if tracked)" (A5) and "Sufficient test coverage" (A12). The vague wording lets agents over-deliver.

Nothing tells agents not to test text, markup or prompt content. Over-testing of this kind therefore follows from A2's "new behavior ⇒ RED" combined with A5 and A6. Deck's own repo has `tests/documentation-governance.test.ts`, and CONTRIBUTING uses it as its docs example.

## Part B — Peer projects

| Project | Framework | Test files / LOC vs source | Kinds of tests | CI | AI-authored? | Value |
|---|---|---|---|---|---|---|
| **espritec-theme** (Horizon fork) | `node --test` | 86 files, ~11.2k LOC; first-party source is likely far less than the 170k LOC counted (that includes assets) | Source-reading unit tests, `vm` harnesses, Chrome browser probe (`regression-browser`), review-matrix, theme-check adapter | `shopify-static-checks.yml` (Node tests, theme-check), `shopify-regression*.yml` (trusted PR regression against a preview) | Yes. 23 commits with `Co-Authored-By: Claude`, plus an `openspec/` dir | Mixed. About 880 of 2,092 asserts are string or regex style. |
| **nebula** (backend + frontend, Shopify app) | vitest + Testing Library | Backend 39.7k test vs 65.8k src (~60%); frontend 23.7k test vs 37.7k src (~63%) | Unit, component tests with heavy `vi.hoisted` mocks, coverage script | No workflows in `nebula/.github` | 2 co-author trailers, `openspec/` present, 269 changes | Mostly behavioral; some mock-heavy (e.g. `MetafieldManager.authorization.test.tsx`). |
| **nebula-extension** (+ `-breadcrumb`) | `node --test` + `liquidjs` | 14–16 files, ~2.3k test LOC vs ~8.8k source | Liquid render fixtures, `vm` JS harness, size budget check | `deploy-shopify-apps.yml`, token reminder | No co-author trailers; `openspec/` and `AGENTS.md` present | Mixed. |
| **horizon** (upstream plus custom guard) | `node --test` + browser `.mjs` | 6 tests, ~1.6k LOC; no theme source in `tests` | Guard tests against temp git fixtures, 2 browser scripts | None (upstream GitHub releases) | `openspec/` and `.serena` present | Targeted. Tests the *custom guard*, not Liquid markup. |
| **store-theme** (VTEX) | none | 0 test files | ESLint, commitlint, gitleaks, Lighthouse CI configs (`lhci-desktop.js`, `lhci-mobile.js`) | No workflows | Human authors, `openspec/` present | N/A |
| **americaneagleec-theme** | none | 0 | none | `build-css.yml` only | No | N/A |

### Representative examples

**Low-value (espritec-theme).**
- `tests/footer-help-links.test.js:8-26` reads `footer-group.json` and asserts that a menu includes specific link labels ('¿Cómo comprar?', 'Estado de mis PQRs'). The test comment itself admits merchants edit this menu in the theme editor. It pins editable content, and the file's own name is a content decision.
- `tests/registration-additional-data-note.test.js:10-24` regex-matches `<input name="contact[first_name]" … placeholder="Ingresa tu nombre" required>` in Liquid. It pins attribute strings, placeholder copy and field order. At 806 lines, it is the largest test in the repo.
- `tests/registration-age-country.test.js` has an age gate (18+, Ecuador only). This is business logic, so a test is justified, but it is better tested against rendered behavior than the Liquid source.
- `nebula-extension/tests/top-banner-arrow-color.test.js:1-30` builds a fake `document` with empty stubs and `Object.create(NativeSlider.prototype)`. It tests implementation internals.
- Test-theater signal: of the 86 test files, many follow the `*-loading`, `*-wu7`, `*-wu9`, `*-performance` naming. Those look like work-unit-per-test artifacts from agent task decomposition.

**High-value.**
- `espritec-theme/tests/gco-json-rewrite.test.js`, `gco-locale-merge.test.js` and `qa-access-probe.test.js` test tooling logic with real inputs.
- `espritec-theme/tests/regression-browser.test.js` plus `tools/regression/*` does a real browser measurement on a preview.
- `horizon/tests/custom-theme-guard.test.mjs:1-25` builds a real temp git repo as a fixture and asserts on guard violations. It tests the tooling, not copy.
- `nebula/frontend/.../MetafieldManager.authorization.test.tsx` tests permission outcomes, which is protected risk. It is mock-heavy, though.

### Observations

1. **Test ratio.** nebula runs ~60% test-to-source, which is normal for app code. The Shopify themes with tests are a different matter. For Liquid and JSON, the tests mostly reread the source file and assert on strings, which is brittle and has low signal (espritec: roughly 40% of asserts).
2. **Origin of low-value tests.** espritec's tests come with AI co-author trailers and an OpenSpec dir, consistent with Deck-style "every behavior needs a test" and per-task RED/GREEN. The `-wu7`/`-wu9` filenames point at task-per-test decomposition. I can't prove authorship from this alone.
3. **What the peers do well:**
   - `store-theme` and `americaneagleec-theme` ship with zero tests and rely on ESLint, commitlint, gitleaks and Lighthouse CI.
   - espritec runs `shopify theme check` through its `check` script and a CI static-checks job before its own tests.
   - espritec's trusted PR regression runs real browser checks against a preview. That is a handful of end-to-end measurements, not hundreds of source-scrapers.
   - horizon only tests its custom guard, not the upstream theme.
   - `nebula-extension` has `check:extension-size`, a budget check that is cheap and meaningful.
4. **What Deck should emulate:**
   - Name the validator by artifact type: Liquid, JSON, CSS and locale files go through theme-check or lint and schema/parse checks, not source-reading unit tests.
   - Keep tests for logic with real branches (age gate, pricing, tooling) and for permission/protected-risk boundaries.
   - Prefer a few real browser checks over many `vm` harness stubs.
   - Add a "do not test" list: copy, placeholder text, merchant-editable content, markup attributes, class names, and file contents that a linter already covers.
   - Make a single full-suite run the final pre-merge gate, not part of the inner loop.

I made no changes to any files. Caveat: I did not run any of these test suites, so the "low-value" calls rest on reading a sample of files, not on mutation or flakiness data.