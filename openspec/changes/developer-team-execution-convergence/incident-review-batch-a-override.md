# Incident Review: EG1-R2 Batch A Acceptance Override

## Review Identity

- Change: `developer-team-execution-convergence`
- Incident: `INC-BATCH-A-ACCEPTANCE-ORACLE-GAPS-v1`
- Linked exhausted incident: `INC-BATCH-A-GEN-SKILL-SUPPORT-ORDER-v1`
- Task: `EG1-R2`
- Scope: final fresh independent Review of Batch A only; this is not the final whole-change Review
- Verdict: **PASS**
- Review agent: `deck-developer-review`
- Date: `2026-07-15`
- Lifecycle effect: the SDD phase remains Apply; Batch A is accepted and Batch B is unblocked.

## Summary

EG1-R2 closes both findings from `incident-review-batch-a.md`. The compatibility harness now calls `runOrchestratorPipeline()` and `evaluateRepairIncident()` and asserts exact legacy outcomes for no-contract/pass, Verify and Review failure phases, an open incident, and unchanged, shrinking, and expanding failure sets. The generated-bundle test now performs two independent temporary-destination generations, compares the first output with tracked canonical bytes, compares the second output with the first, proves tracked bytes remain unchanged after success and induced failure, and removes its temporary root in `finally`.

The generator's optional `--output` seam changes only the destination. Its no-argument canonical destination, canonical inputs, traversal, serialization, and output bytes remain unchanged. Independent test execution reproduced compatibility 5/5, generated 19/19, runtime 273/273, core 1,474/1,474, and broad 3,309 passes with exactly the established three stale build-metadata failures. `bunx tsc --noEmit` passed. The tracked generated SHA-256 remained `7ca11811594bcf72751d3f9b0b1a2bbfb9aaf2cdf68d07cef75e3c35ef7c1460`, and no `deck-skill-bundle-*` temporary root remained.

## Ratings

| Dimension | Rating | Evidence |
|---|---|---|
| Architecture and boundaries | Strong | EG1-R2 is limited to executable compatibility tests, generated-output testing, and one generator destination seam; runtime/product boundaries are unchanged. |
| Security and filesystem safety | Strong | Generation targets explicit temporary paths; the induced failure targets an existing temporary directory; cleanup is recursive only within the unique `mkdtempSync()` root. |
| Determinism and portability | Strong | Locale-independent traversal remains in place; destination construction uses Node path/OS APIs; independent outputs and tracked canonical bytes are byte-identical. |
| Maintainability | Strong | The repair uses direct standard-library test isolation and adds no dependency or new product abstraction. |
| Test quality | Strong | Both former false-negative oracles now execute the behavior or generator they claim to guard and assert exact outcomes/bytes. |
| Economy / critical judgment | Strong | Changes are the minimum test/harness seam needed for the two authorized findings. |

## Findings

No blocking or non-blocking engineering finding is identified within EG1-R2 scope.

## Two-Finding Closure

| Prior finding | Result | Independent evidence |
|---|---|---|
| Compatibility fixtures asserted labels rather than legacy behavior | Closed | `baseline-harness.test.ts:11-39` calls `runOrchestratorPipeline()` and `evaluateRepairIncident()` and asserts exact completion, audit, loop-action, incident-decision, and failure-set decisions. |
| Generated-bundle test omitted first-generation equality with tracked bytes | Closed | `content.test.ts:190-213` compares first temporary output to tracked bytes, second temporary output to first, checks tracked bytes after each successful generation and induced failure, and cleans the unique temporary root in `finally`. |

## Legacy Oracle Assessment

- No-contract/pass: the harness calls the actual orchestrator pipeline and requires `completed`, valid audit, no stage errors, legacy-compatible mapping, and no findings.
- Verify/Review failures: each fixture phase is passed into an actual two-entry failure history and the returned legacy `loopAction` must be exactly `repair`.
- Incident: the actual repair-governance evaluator must return exactly `continue` for the open one-failure template.
- Failure sets: actual evaluator calls over unchanged, shrinking, and expanding fixture sets must return exactly `[continue, continue]`, `[repair, continue]`, and `[continue, repair]` respectively.
- The fixture labels select inputs only; they are not the outcome oracle. A broken runtime outcome changes an asserted value and fails the test.

## Generated Oracle Assessment

- `scripts/generate-skill-bundle.ts:19-25` selects the historical canonical output when `--output` is absent and rejects a missing destination value.
- `scripts/generate-skill-bundle.ts:181-187` applies the selected destination only at directory creation/write time; canonical source discovery, deterministic traversal, and serialization are shared unchanged.
- The seam is deterministic and portable: it uses `process.argv`, `node:path`, and `node:fs`; generated content contains no destination-dependent data.
- The success path creates two independent destinations below a unique OS temporary root. First output equals tracked canonical bytes; second equals first; tracked bytes are checked after both.
- The induced failure passes the temporary root directory itself as the output file, causing `writeFileSync()` to fail without selecting or opening the tracked output. `finally` removes only the unique temporary root with no Git discard operation.
- Independent execution began and ended with no `/tmp/deck-skill-bundle-*` roots and with the tracked hash unchanged.

## Verification and Quarantine Assessment

| Check | Independent result |
|---|---|
| Compatibility harness | 5 passed, 0 failed, 17 expectations |
| Generated bundle | 19 passed, 0 failed, 326 expectations |
| Affected SDD runtime | 273 passed, 0 failed, 681 expectations |
| Affected core | 1,474 passed, 0 failed, 5,228 expectations |
| Workspace typecheck | `bunx tsc --noEmit` exited successfully |
| Broad repository suite | 3,309 passed, 3 failed, 11,721 expectations across 180 files |

The three broad failures are exactly the established `scripts/prepare-release.test.ts` quarantine:

1. `emits valid spec-shaped release.json in non-interactive mode`
2. `prints --help and exits 0`
3. `computes and prints SHA-256 with --sha256-file`

All three retain the same cause: ignored `build-info.generated.ts` commit `1bba98b` does not match current HEAD `652a9b0ed14efc995300b9c982950a70b7792e98`. No new failure appeared, and Batch A receives no repair credit for these quarantined failures.

## Scope Audit

- EG1-R2 changed only `baseline-harness.test.ts`, `content.test.ts`, the generator's optional destination seam, and current change governance artifacts.
- No runtime/product behavior, canonical external skill content, prompt/EG7 source, Batch B/EG2 implementation, build-info file, `scripts/prepare-release.test.ts`, historical OpenSpec record, other OpenSpec change, excluded `runner-capability-standardization` WIP/commit `8c6d167`, or unrelated product scope was modified by EG1-R2.
- The tracked generated file remains the prior canonical EG1-R1 ordering result; EG1-R2 neither invoked its output path nor directly edited it.
- No destructive Git command was used.

## Generated Artifact Evidence

- Tracked path: `packages/core/src/skills/external/content.generated.ts`
- SHA-256 before independent checks: `7ca11811594bcf72751d3f9b0b1a2bbfb9aaf2cdf68d07cef75e3c35ef7c1460`
- SHA-256 after focused, affected, broad, success, and induced-failure checks: `7ca11811594bcf72751d3f9b0b1a2bbfb9aaf2cdf68d07cef75e3c35ef7c1460`
- Residual temporary bundle roots: none

## Registry Disposition

- Repair incident state: `resolved/review-accepted`
- Overall phase: `apply`
- Overall status: `in-progress`
- Events, in order: `repair.review.completed`, then `apply.batch-a.completed`
- Batch A acceptance: accepted.
- Batch B readiness: unblocked.
- Prior EG1-R1 hard-stop and exhausted-budget history remains preserved; this verdict grants no additional repair attempt.
