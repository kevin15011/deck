# Verify Report: Batch B Combined Gate Repair

## Verdict

**FAIL**

The implementation passes the independent runtime reproducers, focused and affected suites, typecheck, broad repository gate, generated drift check, and prohibited-scope audit. The exact blocking set is nevertheless non-empty because the Batch B acceptance evidence still contains the previously identified combined-case and subset-only public-export oracle. This is the same stable `B-B7-PUBLIC-MATRIX-SUBSET-FILLER-v1` fingerprint; no new runtime defect was reproduced.

Registry mode was explicitly deferred. This report is the only repository write made by Verify.

## Finding Disposition B-B1–B-B7

| Finding | Disposition | Independent evidence |
|---|---|---|
| B-B1 | CLOSED | Secret/JWT placement acceptance remains green; no secret persistence or digest influence was reproduced. |
| B-B2 | CLOSED | Six-dimension lexicographic precedence, positive-progress conjunction, mandatory delta authority, complete recomputation, regression penalty, and baseline isolation passed independent reproducers. |
| B-B3 | CLOSED | Revision 3 issuance/parsing with complete history passed; missing, reordered, and malformed histories rejected. Recursive dossier acceptance remained green. |
| B-B4 | CLOSED | Authoritative POSIX/Windows path identity and unsafe-path acceptance remained green. |
| B-B5 | CLOSED | Exact evidence deduplication, reorder identity, semantic-collision rejection, and no-inflation acceptance remained green. |
| B-B6 | CLOSED | Public parser authority, malformed self-hashed delta rejection, recursive parsing, freeze behavior, and supported API tests remained green. |
| B-B7 | **OPEN — BLOCKING** | `batch-b-replacement.test.ts` still combines four private-key/prose placements under one test and proves only a selected export subset plus four selected absent internals. It does not perform the required exact package-root object-key comparison. |

## Gate Finding Disposition

| Combined gate finding | Disposition | Evidence |
|---|---|---|
| `B-B2-RISK-PRECEDENCE-OMITS-MEDIUM-LOW-v1` | CLOSED | Independent cases passed for `securityHardStops > critical > high > uncoveredRequirements > medium > low`; medium-over-low and safer-vector/negative-weight conjunction were exact. |
| `B-B2-DELTA-PARSER-OPTIONAL-AUTHORITY-v1` | CLOSED | One- and two-argument calls reject with `invalid-evidence: failure delta authority`; a self-hashed invented algebra rejects with authoritative manifests as `invalid-evidence: failure delta algebra`. |
| `B-B2-BASELINE-PERSISTENT-BUCKET-v1` | CLOSED | Unchanged and removed unrelated baselines enter no active bucket; a new unrelated baseline enters only `newUnrelatedBaseline`; all three have zero risk, movement, progress, and repair credit. |
| `B-B3-REVISION-CHAIN-STOPS-AT-TWO-v1` | CLOSED | Revision 3 issues and parses with `[revision1, revision2]`; missing, reordered, and malformed histories reject. |
| `B-B7-PUBLIC-MATRIX-SUBSET-FILLER-v1` | **OPEN — BLOCKING** | Dormant `parserCases`, `.every()`, loops, broad no-message `toThrow()`, and count-only length assertions are absent, but the acceptance suite still retains a combined placement case and subset-only export evidence. |

## Exact Blocking Set

`{B-B7-PUBLIC-MATRIX-SUBSET-FILLER-v1}`

Residual classification: **same fingerprint**. The five-finding combined manifest shrank to this one exact acceptance-evidence remainder; no new finding was added.

### Structured Failure Manifest

| Field | Value |
|---|---|
| Normalized fingerprint | `B-B7-PUBLIC-MATRIX-SUBSET-FILLER-v1` |
| Severity | CRITICAL for this mandatory final acceptance gate |
| Failing contract / requirement | REQ-VERIFY-005; EG2-R2-S02/S10; EG2-R3B/R3C exact public matrix amendments; corrective Design exact public-entrypoint adversarial matrix |
| Evidence | Static inspection of `packages/sdd-runtime/src/contracts/batch-b-replacement.test.ts:20-26,70-86` and `packages/sdd-runtime/src/index.test.ts:1-2` |
| Latest result | Runtime suites pass, but acceptance evidence remains combined/subset-only and therefore cannot satisfy the mandatory oracle-quality gate |
| Owner / routing | General Apply; Batch B acceptance/public-export owner |
| Suspected scope | Batch B acceptance tests only; exact package-root export oracle and individual secret-placement rows |
| Changed files when known | `packages/sdd-runtime/src/contracts/batch-b-replacement.test.ts`; `packages/sdd-runtime/src/index.test.ts` |
| Retry count | Fresh combined gate-repair Verify cycle 1 |
| Previous attempt summary | Gate repair removed dormant metadata, aggregate loops, broad throws, and count-only evidence, but did not replace the selected export assertions with exact object-key equality or split the remaining combined placement case. |
| Generated-artifact classification | Not generated |
| Next verification action | Replace the remaining combined/subset oracle with individually named exact package-root cases and an exact supported root export-key comparison, then rerun the same gate. |

## Independent Reproducers

An independent package-root `bun -e` reproducer executed 16 exact checks and passed all 16:

1. `securityHardStops > critical`.
2. `critical > high`.
3. `high > uncoveredRequirements`.
4. `uncoveredRequirements > medium`.
5. `medium > low`.
6. Low-risk worsening is negative.
7. Positive progress requires both a safer vector and positive weighted movement.
8. Prior/current manifests are mandatory parser authority.
9. Invented self-hashed algebra rejects after full recomputation.
10. Unchanged unrelated baseline isolation.
11. Removed unrelated baseline isolation.
12. New unrelated baseline isolation.
13. Revision 3 accepts complete history.
14. Revision 3 rejects missing history.
15. Revision 3 rejects reordered history.
16. Revision 3 rejects malformed history.

## Focused/Affected Evidence

| Check | Result |
|---|---|
| Four Batch B acceptance files | 66 pass, 0 fail, 111 assertions |
| Contracts + delta + dossier + public matrix | 166 pass, 0 fail, 361 assertions |
| Full `packages/sdd-runtime` | 350 pass, 0 fail, 838 assertions |
| Full `packages/core` | 1474 pass, 0 fail, 5228 assertions |
| Legacy repair/parser/pipeline/baseline matrix | 77 pass, 0 fail, 247 assertions |
| Focused public export matrix | 8 pass, 0 fail, 35 assertions; mandatory exactness defect remains visible by static audit |
| Core registry compatibility | 80 pass, 0 fail, 232 assertions |
| Static audit of four `*batch-b*.test.ts` files | 66 named tests; 0 `.every()`; 0 `for`/`while` loops; 0 broad no-message `toThrow()`; 0 `parserCases`; 0 `toHaveLength()` |

Static success does not close B-B7 because `batch-b-replacement.test.ts` lines 70–85 individually probe only selected public functions and selected internal names rather than asserting the exact package-root export set. Lines 20–26 also keep four protected placements under one test outcome.

## Typecheck

`bunx tsc --noEmit` passed with exit 0 and no diagnostics.

## Broad Evidence

`timeout 900s bun test --timeout 30000` completed within the required wall allowance:

- 3389 pass.
- 0 fail.
- 3389 total across 190 files.
- 79.52 seconds.
- Exit 0; no timeout, binary-doctor failure, or unclassified failure.

## Baseline Quarantine

No quarantine was consumed. The isolated `scripts/prepare-release.test.ts` run passed 21/21, and the broad run had zero failures. The three historically approved stale cases remain the only eligible quarantine names if they recur unchanged, but they were not reproduced and receive no repair credit in this run.

## Generated/Scope Audit

- Canonical generated skill SHA-256: `7ca11811594bcf72751d3f9b0b1a2bbfb9aaf2cdf68d07cef75e3c35ef7c1460`.
- Tracked generated bytes, first independent temporary generation, and second independent temporary generation were byte-identical at 445,136 bytes.
- `apps/cli/src/runtime/build-info.generated.ts` was not dirty.
- No `runner-capability-standardization`, historical archive, other OpenSpec change, or prohibited Batch C/later path appeared in current changed scope.
- The existing Batch A adapter/generator/generated-output changes remain present and classified by prior official evidence; this Verify did not modify them.
- Registry base hashes were read only: state `e332e31c544c2b177713a18ebb3f4cd01ac580e5eb1b55605a6ed41616ce36bb`; events `10ab7971bae316b455b77606f979b4a269e652f02e62ed291b2c299af4501ff5`.

## Artifact

`openspec/changes/developer-team-execution-convergence/verify-batch-b-gate-repair.md`

## Artifact Evidence

- File exists and is non-empty.
- Self-verified byte count: `09609` bytes.
- No source, test, generated output, shared registry, progress, incident, or other artifact was written by Verify.

## Phase

`verify`

## Status

`failed`

## Registry Write

`deferred`

## Registry Intent

- **Phase**: `verify`
- **Status**: `failed`
- **Event**: `verify.batch-b.gate-repair.failed`
- **Artifact**: `verify-batch-b-gate-repair.md`
- **Provenance**: agent `deck-developer-verify`; model `openai/gpt-5.6-sol`; timestamp `2026-07-15T21:55:31Z`; fresh independent Batch B combined gate-repair verification; official OpenSpec/source/test evidence authoritative; adaptive memory advisory only
- **Base state SHA-256**: `e332e31c544c2b177713a18ebb3f4cd01ac580e5eb1b55605a6ed41616ce36bb`
- **Base events SHA-256**: `10ab7971bae316b455b77606f979b4a269e652f02e62ed291b2c299af4501ff5`

## Blockers

Exact blocker set: `{B-B7-PUBLIC-MATRIX-SUBSET-FILLER-v1}`. Batch B remains unaccepted and Batch C/later remains blocked. Return to Apply; do not repair in Verify.
