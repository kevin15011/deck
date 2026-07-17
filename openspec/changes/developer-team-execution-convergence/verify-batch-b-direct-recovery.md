# Verify Report: Batch B Direct Recovery

## Summary

**Change**: `developer-team-execution-convergence`  
**Verification scope**: Batch B direct recovery, findings B-B1 through B-B7  
**Overall result**: **FAIL**  
**Exact blocking set**: `{B-B2}`  
**Registry mode**: deferred; this report is the only repository write made by Verify.

Fresh independent verification reproduced a remaining B-B2 violation through package-root public builders and `computeFailureDeltaV1`. The implementation reports positive progress when the risk vector becomes lexicographically worse at `medium`, provided enough `low` findings are resolved to make scalar weighted movement positive. The authoritative risk order is `securityHardStops`, `critical`, `high`, `uncoveredRequirements`, `medium`, `low`; therefore the reproduced result must be negative. B-B1, B-B3, B-B4, B-B5, B-B6, and B-B7 remain closed. The exact unchanged three `scripts/prepare-release.test.ts` stale-build-metadata failures are quarantined; no other broad failure occurred.

## Official Context and Task State

Verification read the Direct Recovery Override and implementation result in `repair-incident.md`, direct-recovery evidence in `apply-progress.md`, Batch B/EG2 scope and amendments in `tasks.md`, `spec.md`, `design.md`, `design-repair-batch-b.md`, all prior Batch B Review/Verify reports, and current source/tests/worktree scope. The direct-recovery Apply artifact claims `{B-B2,B-B3,B-B7} -> {}`; independent Verify does not accept that claim because B-B2 remains reproducible. Batch C remains blocked.

Adaptive memory was loaded only as advisory context. Official OpenSpec artifacts, source, and current test evidence controlled this result.

## Finding Disposition B-B1–B-B7

| Finding | Disposition | Independent evidence |
|---|---|---|
| B-B1 | CLOSED | Four individually named package-root short-JWT placement cases pass, the larger private-key/prose corpus remains green, and Batch B acceptance suites pass. |
| B-B2 | **OPEN — CRITICAL** | An independent package-root reproducer creates prior risk `{medium:0, low:20, weighted:20}` and current risk `{medium:1, low:0, weighted:10}`. `computeFailureDeltaV1` returns `weightedMovement:10` and `progress:"positive"`; the authoritative lexicographic order makes the current vector worse at `medium`, so progress must be `negative`. |
| B-B3 | CLOSED | Recursive dossier parsing calls every nested public parser, recomputes delta algebra against supplied manifests, enforces same-batch/digest/auth/intent references, rejects duplicate intents and unknown active findings, requires prior revision context, preserves intent/decision prefixes, and enforces revision+1, previous digest, stable dossier identity, and manifest transition. Direct dossier acceptance cases pass 9/9. |
| B-B4 | CLOSED | Authoritative POSIX/Windows root and unsafe-path acceptance remains green in the Batch B matrix and affected runtime suite. |
| B-B5 | CLOSED | Exact evidence deduplication, stable reorder identity, and semantic-collision rejection remain green. |
| B-B6 | CLOSED | Recursive V1 parser boundaries, malformed self-hashed DTO rejection, exact public exports, and frozen output checks remain green. |
| B-B7 | CLOSED | The direct recovery file contains 19 individually named package-root FailureDelta/Dossier tests. Static audit found zero `for (` loops and zero broad `.toThrow()` calls in all four `*batch-b*.test.ts` acceptance files. Public export and legacy checks pass. |

## Compliance Matrix

| Requirement / gate | Method | Result | Notes |
|---|---|---|---|
| Exact sorted, unique, disjoint, coverage-complete delta buckets and exact `added` projection | Direct acceptance, orchestrator test, source inspection | PASS | Exact parser checks and bucket precedence tests pass. |
| Structured related/baseline rules and zero baseline credit | Direct acceptance plus manifest/delta source inspection | PASS | `unrelated_baseline` requires `pre_existing` plus evidence and is excluded from active risk/movement. |
| Effective 2x regression penalty | Direct reopened-protected case plus formula inspection | PASS | Reopened critical yields `weightedMovement:-2000`; current weight is counted in risk and again as penalty. |
| Reopened and reclassified semantics | Orchestrator exact bucket test and source inspection | PASS | `regressed > reclassified > persistent`; resolved-to-open is regression. |
| Full safety and lexicographic risk precedence | Independent package-root reproducer | **FAIL** | Implementation compares only the first four vector fields lexicographically and then permits scalar weighted movement to determine medium/low tradeoffs. |
| Parser recomputes derived FailureDelta fields | Direct parser mutations plus source inspection | PASS | Supplied prior/current risk, movement, progress, buckets, and digest are checked against recomputation when manifests are supplied. |
| Recursive dossier/nested DTO/reference/digest validation | Direct dossier matrix plus source inspection | PASS | Malformed nested decision/manifest and delta/reference corruption reject without silent repair. |
| Acyclic intents and append-only revisions | Direct matrix plus decision/intent/dossier parser inspection | PASS | Decision intents must be empty; dossier intents bind to decision digest; revision prefixes and identity are preserved. |
| Exact named package-root public acceptance, no aggregate loops/broad throws | Static audit plus 45-test Batch B suite | PASS | 45/45 acceptance tests pass; direct FailureDelta/Dossier file is package-root and individually named. |
| Public exports and legacy behavior unchanged | Export/compatibility and affected suites | PASS | 3/3 focused export/compatibility, 55/55 focused legacy, full runtime/core green. |
| Generated, build-info, historical, Batch C/later, excluded-WIP, unrelated scope discipline | SHA-256/status/scope audit | PASS | Canonical skill hash matches the established value; no build-info, other historical OpenSpec, or Batch C/later marker changed. Existing generated modification is the previously authorized Batch A canonical output and is byte-hash stable, not direct-recovery drift. |

## Focused Evidence

| Command / check | Result |
|---|---|
| `bun test packages/sdd-runtime/src/contracts/batch-b-direct-recovery.test.ts --timeout 30000` | 19 pass, 0 fail |
| Four Batch B acceptance files together | 45 pass, 0 fail |
| Contracts + orchestrator failure-delta + public index matrix | 145 pass, 0 fail |
| Static audit of all four `*batch-b*.test.ts` files | 45 individually named tests; zero `for (`; zero broad `.toThrow()`; direct FailureDelta/Dossier tests import package root |
| Independent medium-before-low lexicographic reproducer | **FAIL reproduced**: process exit 42; current vector is lexicographically worse, but returned progress is `positive` |

### Independent B-B2 Reproducer Result

```json
{
  "priorRisk": { "securityHardStops": 0, "critical": 0, "high": 0, "medium": 0, "low": 20, "uncoveredRequirements": 0, "weighted": 20 },
  "currentRisk": { "securityHardStops": 0, "critical": 0, "high": 0, "medium": 1, "low": 0, "uncoveredRequirements": 0, "weighted": 10 },
  "weightedMovement": 10,
  "progress": "positive",
  "resolved": 20,
  "newRelated": 1
}
```

The current vector is worse at the first differing authoritative component (`medium`: `1 > 0`). Design requires `negative`; scalar weight improvement cannot override lexicographic worsening.

## Affected Evidence

| Check | Result |
|---|---|
| `bun test packages/sdd-runtime --timeout 30000` | 329 pass, 0 fail |
| `bun test packages/core --timeout 30000` | 1474 pass, 0 fail |
| Focused legacy fixture/incident/pipeline/artifact-state command | 55 pass, 0 fail |
| Public index + core registry/prompt compatibility fixtures | 3 pass, 0 fail |
| Serena diagnostics on FailureDelta, dossier, direct acceptance, and public index | No warnings or errors |

## Typecheck

`bunx tsc --noEmit` passed with exit 0 in 23.869 seconds.

## Broad Evidence

The broad command was run with a 900-second wall timeout:

`timeout 900s bun test --timeout 30000`

Result: `3365 pass / 3 fail / 3368 total` across 190 files in 87.51 seconds. The command completed within the required wall timeout. The only failures were the three approved `scripts/prepare-release.test.ts` cases. No binary-doctor failure or timeout and no unclassified failure occurred.

## Baseline Quarantine

Quarantined names, unchanged:

1. `prepare-release / end-to-end main() > emits valid spec-shaped release.json in non-interactive mode`
2. `prepare-release / end-to-end main() > prints --help and exits 0`
3. `prepare-release / end-to-end main() > computes and prints SHA-256 with --sha256-file`

An isolated `scripts/prepare-release.test.ts` run produced 18 pass / 3 fail. Each of the three failed invocations emitted the same REQ-RM-005 stale-build-metadata evidence: generated build-info commit `1bba98b` does not match current HEAD `652a9b0ed14efc995300b9c982950a70b7792e98`. These failures receive no repair credit.

## Generated and Scope Audit

- Canonical generated skill SHA-256: `7ca11811594bcf72751d3f9b0b1a2bbfb9aaf2cdf68d07cef75e3c35ef7c1460` — exact established match.
- `apps/cli/src/runtime/build-info.generated.ts`: no worktree change.
- No Batch C/later implementation marker detected in changed scope.
- No historical OpenSpec change outside `developer-team-execution-convergence` detected.
- No direct-recovery dependency, adapter, coordinator, prompt, build-info, canonical-skill, or unrelated product edit detected.
- The worktree contains earlier authorized Batch A changes, including canonical generated output; current hash and core generator tests show no direct-recovery generated drift.

## Structured Failure Manifest

| Field | Value |
|---|---|
| Finding | `B-B2` |
| Normalized fingerprint | `FAILURE-DELTA-LEXICOGRAPHIC-MEDIUM-LOW-PRECEDENCE-v1` |
| Residual classification | `same fingerprint` — remaining B-B2 safety/precedence obligation |
| Severity | `CRITICAL` |
| Failing contract / requirement | REQ-DECISION-001, REQ-DECISION-002; corrective Design full FailureDelta/risk algebra and progress precedence |
| Evidence command | Independent `bun -e` package-root script using `buildApplyBatchContractV1`, `buildFailureManifestV1`, and `computeFailureDeltaV1` |
| Latest result | Exit 42; returned `progress:"positive"` for lexicographically worse medium risk; expected `negative` |
| Owner / routing | General Apply; Batch B FailureDelta owner |
| Suspected scope | `packages/sdd-runtime/src/orchestrator/failure-delta.ts`, specifically authoritative vector comparison/progress conjunction; adjacent exact public acceptance test |
| Changed files when known | `packages/sdd-runtime/src/orchestrator/failure-delta.ts`; `packages/sdd-runtime/src/contracts/batch-b-direct-recovery.test.ts` |
| Retry count | 1 fresh direct-recovery Verify cycle |
| Previous attempt summary | Direct-recovery Apply claimed B-B2 closure; existing 19-case matrix did not exercise a medium/low lexicographic tradeoff with opposite scalar movement. |
| Generated-artifact classification | Not generated; no generated repair authorized or needed |
| Next verification action | Add an individually named package-root exact risk-vector precedence case, correct the authoritative six-field lexicographic/progress rule, then rerun direct, Batch B, affected, typecheck, broad, generated, and scope gates. |

## Findings

### CRITICAL

- `B-B2 / FAILURE-DELTA-LEXICOGRAPHIC-MEDIUM-LOW-PRECEDENCE-v1`: exact safety/risk precedence remains incorrect as reproduced above.

### WARNING

None.

### SUGGESTION

None.

## Artifact Evidence

This report must exist and have a byte count greater than zero before return. The post-write evidence is recorded by the verifier after persistence.

## Deferred Registry Intent

- **Phase**: `verify`
- **Status**: `failed`
- **Event**: `verify.batch-b.direct-recovery.failed`
- **Artifact**: `verify-batch-b-direct-recovery.md`
- **Provenance**: agent `deck-developer-verify`; model `openai/gpt-5.6-sol`; timestamp `2026-07-15T21:25:19.409Z`; independent direct-recovery verification
- **Base state SHA-256**: `6ed0a31c94c855dc090301abeb9b160793c04ca84cefe00de1183c690d769fac`
- **Base events SHA-256**: `fac3a69302a7647c75c9debff63f71de08ded9a0bd660a5c10640e2ad96e8994`
- **Registry write**: deferred; no shared registry file was modified.

## Blockers

Exact blocker set: `{B-B2}`. Return to the Batch B General Apply owner. Batch C/later remains blocked.
