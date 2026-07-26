# R1 Review Report — `opencode-package-install-running-binary-regression`

## Verdict

**REQUEST_CHANGES — BLOCKING.**

R1 found three reproducible implementation defects and one required-test-quality gap. A higher-precedence malformed configuration layer can be ignored in favor of lower configured evidence, secret-bearing failure headers can remain enumerable and reach TUI action state, and multibyte diagnostics can exceed the exact UTF-8 aggregate bound while introducing replacement characters. The focused and affected V2 checks remain valid historical evidence for the cases they execute, but they do not cover these defects.

The mandatory broad gate is **not released**. The exact broad command `bun test` remains blocked by Tasks B1's dependency on a non-blocking R1. Review did not implement repairs or run the broad command.

## Immutable phase binding

| Dependency | Bound value | R1 check |
|---|---|---|
| Checkpoint | `3b5b22d9a47e79471c9a9f1e378ff427d85abf10` | Current `HEAD`; all 15 implementation targets match this checkpoint byte-for-byte. |
| Checkpoint parent used for implementation inspection | `e906b99691f5d0b446315d236e63a829025db0f2` | Read-only comparison base. |
| `spec.md` | `sha256:007dacb13bacc4e891454dd11a7d9a2de4db229cf36656374202df4283c7846a` | Exact match. |
| `design.md` | `sha256:b52aa1174d4408f1132738a00cc630399ed0419ef8ce3192defb6ed83ae28465` | Exact match. |
| `tasks.md` | `sha256:fb06ccbafc96093bd891a5f24454f74991d30d9c4f18d6cdb90d3a7ebe4a7c50` | Exact match. |
| `apply-progress.md` | `sha256:19be2c95ef1d52fbd44b9f2b9677a6bccf7371d4d35eadd06afcc7b6d3c3c799` | Exact match. |
| `verify-report.md` | `sha256:16651d339333cee932603fc9a38367e7f082a3c8824927cc6e602fafad8cbc26` | Exact match, including V2 and the post-restart addendum. |
| `state.yaml` | `sha256:41b62994288bdda38ec601a25a4cbc950a39bb20c48743b64f033bcff5a1659b` | Exact match; not modified by Review. |
| `events.yaml` | `sha256:2d870adcf538f5eeb309998c4960be684b1440731076c08fa7b84c82a3f40cdc` | Exact match; not modified by Review. |
| V2 15-target source/test digest | `sha256:40509fe8bb7ca486e3d5ca4ee61d1e61e3501c07d7217133182f302dc0659d6a` | V2 reports equality at checkpoint/current; R1 independently confirmed every individual target equals its checkpoint blob. |

No separate immutable dossier or bounded Skill Discovery Context was supplied. Skill discovery therefore remained `indeterminate`; R1 used only generic capabilities exposed by the active runner. Adaptive memory was loaded as advisory context only and did not override official OpenSpec, source, tests, or runtime evidence.

## Review method and target coverage

R1 reviewed tests before production code, then inspected the relevant implementation paths and official artifacts. It did not duplicate Verify's full command matrix. The source review used checkpoint/current source, symbol/call-path inspection, the implementation diff, and deterministic no-network/no-process-effect reproduction scripts.

| # | Authorized target | R1 review anchor |
|---:|---|---|
| 1 | `packages/adapter-opencode/src/model-discovery-context.ts` | Candidate ordering, project/pure controls, shared JSONC parser, parser consumers. |
| 2 | `packages/adapter-opencode/src/model-discovery-context.test.ts` | Candidate-order, project-disable/pure, JSONC, and existing secret-safe discovery tests. |
| 3 | `packages/adapter-opencode/src/required-tools.ts` | Effective config merge, issue handling, exact tool relevance, PATH/canonical resolution, executable and symlink handling. |
| 4 | `packages/adapter-opencode/src/required-tools.test.ts` | Eight evidence tests, including PATH/config positive cases and declaration/non-file/non-executable negatives. |
| 5 | `packages/adapter-opencode/src/capability-inventory.ts` | Strict usable-evidence consumption and declaration re-promotion prevention. |
| 6 | `packages/adapter-opencode/src/capability-inventory.test.ts` | Command-backed negative/positive inventory and internal plugin compatibility. |
| 7 | `packages/adapter-opencode/src/install-tools.ts` | Outcome factory, immediate/second rechecks, single-flight, cancellation, isolation, raw retention, sanitizer, capture and bounds. |
| 8 | `packages/adapter-opencode/src/install-tools.test.ts` | Nineteen installer tests, including no-effect, TOCTOU, concurrency, cancellation, duplicate IDs, package isolation, v0.9.0 text, and ASCII bounds. |
| 9 | `packages/adapter-opencode/src/runner-adapter.ts` | OPCR direct action/inventory portions; shared ASRD-owned portions remained outside this Review judgment. |
| 10 | `packages/adapter-opencode/src/runner-adapter.test.ts` | Direct project scope, already-present mapping, failed mapping, and raw-stream serialization assertions. |
| 11 | `apps/cli/src/tui/app.tsx` | Exact `toolId` catalog projection, evidence context, and raw-field drop before TUI callbacks/state. |
| 12 | `apps/cli/src/tui/runner-dashboard/action-runner.ts` | Result integrity, aggregate mapping, second sanitation, callbacks, and package-local dependency gates. |
| 13 | `apps/cli/src/tui/runner-dashboard/__tests__/runner-install-contract.test.ts` | Outcome/status mapping, raw drop, matching-only gates, integrity failures, and ASCII hostile diagnostics. |
| 14 | `apps/cli/src/tui/screens/runner-dashboard-screens.tsx` | Existing progress/completion composition, action identity, inline cause, final-five behavior, and display sanitation. |
| 15 | `apps/cli/src/tui/__tests__/runner-install-e2e.test.tsx` | Identified already-present/failure rendering, final five, text/symbol meaning, and deterministic no-I/O fixtures. |

## Blocking findings

### R1-B01 — Malformed higher-precedence config can produce false `usable/configured` evidence

- **Severity:** Critical
- **Classification:** Related regression
- **Axes:** Correctness, compatibility, architecture
- **Requirement / Design anchors:** `REQ-EVD-04`; resolved OQ-02; Design Decision 1 lines 66-75 and 152-162. The accepted Design requires an unreadable or malformed supported layer to make config projection `indeterminate`, while independent positive PATH or canonical evidence may still rescue the result.
- **Code anchors:** `packages/adapter-opencode/src/required-tools.ts:151-175` records `snapshot.issueReasons` but returns `usable/configured` at lines 156-158 before the indeterminate branch at lines 174-176. `readConfigSnapshot` records and then skips malformed layers at lines 293-305 and 317-335, leaving lower merged config available. `readConfigCandidate` also collapses every non-missing read/parse error to `configured-malformed` at lines 341-349; `configured-unreadable` is declared but never produced.
- **Reproduction:** An in-memory context supplied a valid global command pointing to an executable and a malformed higher-precedence `/project/opencode.jsonc`, with no PATH/canonical evidence. `resolveOpenCodeInstalledEvidence("codebase-memory", context)` returned:

  ```json
  {"toolId":"codebase-memory","state":"usable","source":"configured","reasonCodes":["configured-usable","configured-malformed"]}
  ```

- **Impact:** Runner Setup can classify an indeterminate effective configuration as installed/ready, skip installation, and propagate false readiness into inventory. This violates exact config precedence and the fail-closed evidence contract.
- **Acceptance impact:** Blocking. The malformed/unreadable precedence path must return `indeterminate` unless independent executable evidence succeeds, and deterministic regression tests must lock that behavior and its exact reason disposition.

### R1-B02 — Secret/header redaction is bypassable across adapter, action, and render boundaries

- **Severity:** Critical
- **Classification:** Related regression
- **Axes:** Security, correctness, frontend/backend boundary safety
- **Requirement / Design anchors:** `REQ-DIA-01`, `REQ-SAF-05`, resolved OQ-03, and Design Decision 4 lines 294-327. Header values for `authorization`, `proxy-authorization`, `cookie`, and the other named keys must be redacted before bounded diagnostics become enumerable or renderable.
- **Code anchors:** The first key/value replacement consumes only one whitespace/comma/semicolon-delimited token at `packages/adapter-opencode/src/install-tools.ts:510-518`, `apps/cli/src/tui/runner-dashboard/action-runner.ts:392-400`, and `apps/cli/src/tui/screens/runner-dashboard-screens.tsx:305-312`. Because it runs before the separate `Bearer` replacement, `Authorization: Bearer SECRET` becomes `Authorization: [REDACTED] SECRET`, so the secret remains. Multi-token Basic values, additional cookie fields, and quoted values have the same failure. Separately, the direct adapter catch serializes the unsanitized exception message at `packages/adapter-opencode/src/runner-adapter.ts:952-958`.
- **Adapter reproduction:** Meaningful failure lines containing authorization, proxy authorization, cookie, and quoted token values produced enumerable lines including:

  ```text
  error Authorization: [REDACTED] SUPER-SECRET-AUTH
  failed Proxy-Authorization: [REDACTED] QWxhZGRpbjpvcGVuIHNlc2FtZQ==
  failure Cookie: [REDACTED]; refresh=COOKIE-TWO
  error token=[REDACTED] SECRET VALUE"
  ```

- **TUI boundary reproduction:** `runRunnerReviewPlan` returned a serialized failed action whose `diagnostics`, `cause`, and safe structured `raw.diagnostic.lines` retained all four secret tails. Thus the second sanitation layer did not contain the adapter defect.
- **Direct adapter reproduction:** An injected installer exception `Authorization: Bearer DIRECT-SECRET /home/private/token` was returned verbatim in `RunnerActionRunResult.message`.
- **Impact:** Credentials can enter callback/dashboard state, serialized action results, and direct adapter results despite the no-sensitive-content requirement. Defense in depth currently repeats the same bypass instead of containing it.
- **Acceptance impact:** Blocking security defect. All named header/key forms and direct exception text must fail closed, with tests for Bearer/Basic authorization, multi-cookie values, quoted/multi-token values, and serialization/render boundaries.

### R1-B03 — Multibyte truncation violates the exact UTF-8 aggregate bound

- **Severity:** Major
- **Classification:** Related regression
- **Axes:** Correctness, security boundary determinism, compatibility
- **Requirement / Design anchors:** `REQ-DIA-01`, `REQ-SAF-05`, resolved OQ-03, and Design Decision 4 lines 318-327. Aggregate truncation must end on valid code-point boundaries, remain within 1,024/320/1,280 UTF-8 bytes as applicable, and append `…` only when it fits.
- **Code anchors:** `packages/adapter-opencode/src/install-tools.ts:536-579` slices a UTF-8 buffer at an arbitrary byte offset and decodes it before appending `…`. A partial sequence becomes U+FFFD and can make the result larger than the supplied remaining-byte budget. Similar small-remainder branches exist at `apps/cli/src/tui/runner-dashboard/action-runner.ts:424-438`, `apps/cli/src/tui/screens/runner-dashboard-screens.tsx:353-367`, and the direct adapter's byte slicing at `packages/adapter-opencode/src/runner-adapter.ts:1515-1531`.
- **Reproduction:** Two meaningful lines containing repeated `😀` scalars were passed through the public `installOpenCodeTools` failure path. The resulting `diagnostic.lines` had byte sizes `[941, 85]`, aggregate `1026`, while the accepted maximum is `1024`; U+FFFD was introduced. The cause remained 320 bytes, but valid-boundary fidelity was also lost.
- **Impact:** The supposedly exact safe diagnostic contract is not exact for non-ASCII output. Downstream layers cannot rely on its hard byte cap or preservation of valid source code points.
- **Acceptance impact:** Blocking. Truncation must be code-point-safe at every remaining-byte value and tests must assert exact byte/scalar/line limits with multibyte boundary cases, not only ASCII.

### R1-B04 — Required acceptance oracles omit the cases that expose R1-B01 through R1-B03

- **Severity:** Major
- **Classification:** Related regression
- **Axes:** TDD quality, maintainability, compatibility
- **Requirement / Design anchors:** Design implementation obligations at lines 400-414 and Tasks T2/T3/T5/T6. T2 requires the full config/PATH/canonical/broken/indeterminate/source/reason matrix; T3/T5/T6 require adversarial sanitizer and exact-boundary coverage.
- **Test anchors:** `required-tools.test.ts:115-199` has no malformed/unreadable precedence, canonical-target, Windows `PATHEXT`, valid/broken symlink, relative/empty PATH-segment, or exact unreadable-reason case. `install-tools.test.ts:354-379` checks bounds and secrets with ASCII/unquoted fixtures only. `runner-install-contract.test.ts:350-377` and `runner-install-e2e.test.tsx:110-133` repeat ASCII/unquoted token/path cases. `runner-adapter.test.ts:287-350` does not exercise an exception containing sensitive text.
- **Positive TDD evidence:** `apply-progress.md` contains genuine RED then GREEN evidence for T1-T6. The process evidence is credible; the issue is oracle completeness, not fabricated RED.
- **Impact:** V2's `81/81` focused and `49/49` affected PASS could not detect the three release-blocking behaviors above. The current suite overstates coverage of the approved full matrix and adversarial boundaries.
- **Acceptance impact:** Blocking as part of the repair. Each defect needs a behavioral regression test that fails on checkpoint `3b5b22d` and passes only with the approved behavior; repair evidence then requires fresh independent Verify and Review.

## Engineering assessment by dimension

| Dimension | Judgment | Evidence |
|---|---|---|
| Correctness | **Fail** | R1-B01 and R1-B03 violate accepted precedence and exact-bound contracts. Genuine failure/no-hidden-success behavior otherwise remains truthful in inspected branches. |
| Architecture | **Concern** | The adapter-local evidence resolver, effect boundary, and Core/TUI projection boundaries are appropriate. Three handwritten sanitizer/truncation implementations have drifted into the same security defect; this complexity is not currently contained. Any repair outside the existing allowlist requires normal Spec/Design replan rather than silent expansion. |
| Security | **Fail** | R1-B02 demonstrates credential leakage into enumerable action state and direct action output. Raw capture non-enumerability/drop works for the covered normal projection, but it does not compensate for unsafe sanitized text. |
| Scalability / performance | **Pass** | Single-flight is keyed by canonical project/home/tool identity and cleaned in `finally`; one call is ordered, distinct tools can proceed independently, raw capture and script download are bounded. No measured regression contradicts this. |
| Maintainability | **Fail** | The cross-layer contracts are named and typed, but duplicated sanitizers plus missing edge oracles make changes difficult to reason about. The 15-target diff is substantially larger than the Design estimate; the approved cross-layer behavior justifies much of the surface, not the repeated defective primitives. |
| Compatibility | **Concern** | The public Core status union remains unchanged and normal direct/TUI mappings are exact. PATH/PATHEXT/symlink and reason-disposition coverage is too sparse to release cross-platform evidence logic confidently; this is included in R1-B04. |
| Accessibility | **Pass** | Existing Ink screens are retained; symbol, action ID, and words convey status without color; failed items have one indented cause; final-five progress behavior remains. No new control, panel, modal, or key binding was added. |
| Scope | **Pass** | The OPCR implementation target set is exactly the 15-file allowlist. V2's 72/72 checkpoint ownership reconciliation resolves V1's historical scope-proof failure; shared runner-adapter paths have explicit OPCR+ASRD ownership. |

## Concurrency, cancellation, failure truth, and isolation

- Immediate evidence is resolved inside the same-tool single-flight gate before the first effect. The shell branch performs the approved second evidence check after bounded download and before shell mutation.
- A same-scope follower does not start duplicate work; leader map entries are removed in `finally`. Different tool IDs remain isolated, and a later duplicate input ID fails without a second effect.
- Pre-effect and during-download cancellation remain cooperative; no process matching, child signaling, or kill behavior was added. Once mutation starts, the current package pipeline is awaited.
- Nonzero installer/post-install and unusable post-evidence paths remain failures; no error-text special case or hidden-success conversion was found. Ordinary skip remains unsatisfied, while already-present is the distinct satisfied skip.
- Matching dependency gates use the capability action prefix; unrelated config work continues. Missing, unknown, duplicate, and inconsistent package results fail closed.
- The accepted residual cross-process TOCTOU remains: no filesystem/cross-process lock exists after the final check. This is explicit in Design and is not a Review finding.

## Scope and prohibition audit

R1 independently inspected diff-added text in all 15 targets. It found no implementation expansion into generated files, dependencies/locks, Git state, archives, `runner-capability-standardization`, or other runner-exclusive roots. It found no process matching/enumeration/signaling invocation, binary staging/replacement, implicit upgrade, retry loop, or automated network/live-home fixture.

Reviewed lexical hits were allowed/inert: `pgrep` appears in meaningful-line keywords and the text-only v0.9.0 fixture; `https://example.test` is fixture data; the production `curl` installer seam pre-exists behind injected test effects; `AbortSignal` is cooperative cancellation, not process signaling; `process.env.HOME` in TUI code is a redaction root, not a test fixture. Review did not touch source, tests, registry YAML, Git/config/generated/dependency/user state, processes, or archives.

## V1, V2, and live-runtime evidence

- V1's historical failure was limited to inability to prove the exact Apply path set in a mixed worktree. It did not report a behavior/test/build failure.
- Checkpoint `3b5b22d` and V2's complete ownership table resolve that historical proof problem: `72/72` committed paths have authoritative owners, `0/72` are unknown or forbidden, and all 15 OPCR implementation targets have no post-checkpoint drift.
- Fresh V2 evidence remains: focused `81/81`, affected `49/49`, typecheck, build dry run, diff check, rooted OpenSpec validation, 34/51 heading coverage, RED integrity, static audit, freshness, and disposable sandbox all passed.
- The post-restart live run is accepted as runtime evidence: setup completed in `56ms` with zero failures; four positively detected installers were intentionally skipped; five MCP bindings and 14 Developer Team agents/skills were confirmed; `opencode models --verbose` exited `0`.
- The earlier timeout is only **consistent with** transient or stale runtime state. R1 does not claim an exact root cause because the available evidence does not prove one.
- The live run demonstrates the already-present happy path in the current environment. It does not exercise malformed config precedence, adversarial secret headers, or multibyte truncation, so it does not negate R1-B01 through R1-B03.

## FailureManifestV1

```yaml
version: FailureManifestV1
status: blocking
change: opencode-package-install-running-binary-regression
phase: R1 Review
failed_check_id: R1-ENGINEERING-QUALITY
what_failed: >-
  R1 reproduced false usable evidence under malformed higher-precedence config,
  credential leakage through sanitizer/direct-action boundaries, UTF-8 aggregate
  bound overflow with replacement-character insertion, and missing required
  regression oracles for those cases.
why_it_matters: >-
  These defects violate MUST evidence, diagnostic secrecy, and exact-bound
  behavior. They can skip work on indeterminate configuration and expose
  credentials in enumerable dashboard/action state. Passing focused tests and
  the live happy path do not cover the failing inputs.
blocking: true
next_decision_or_action: >-
  Do not run B1. The coordinator must request an explicitly authorized repair
  within the approved change or return for Spec/Design replan if any target
  expansion is required. After repair and genuine RED/GREEN evidence, schedule
  fresh independent Verify and a new independent Review before broad release.
```

## Ordered RegistryIntentV1 values

The coordinator owns centralized registry writes. Review did not modify `state.yaml` or `events.yaml`.

1. `registry-intent:v1:review:opencode-package-install-running-binary-regression:r1:request-changes` — phase `review`, status `failed`, event `review.failed`, actor `deck-developer-review`, checkpoint `3b5b22d`, findings `R1-B01` through `R1-B04`, broad release `blocked`; the coordinator must bind the final `review-report.md` digest and validate the authoritative registry base pair atomically.

## Provenance, blockers, and broad release

- **Role / instance:** fresh independent `deck-developer-review` R1 instance, distinct from Apply and Verify.
- **Model:** `openai/gpt-5.6-sol`.
- **Capabilities loaded:** `using-agent-skills`, `code-review-and-quality`, `security-and-hardening`, `performance-optimization`, `frontend-ui-engineering`, `fixing-accessibility`, and `test-driven-development`.
- **Official authority:** immutable OpenSpec artifacts, checkpoint source/tests, V2 evidence, and the post-restart runtime addendum.
- **Adaptive authority:** advisory only.
- **Git safety:** no destructive Git command was requested or run.
- **Blockers:** `R1-B01`, `R1-B02`, `R1-B03`, `R1-B04`.
- **Optional new scope:** None.
- **Broad release:** **NOT RELEASED**. Exact `bun test` must not proceed as B1 until a fresh non-blocking R1.
