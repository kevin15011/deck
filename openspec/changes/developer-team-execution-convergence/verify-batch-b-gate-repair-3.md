# Verify Report: Batch B Gate Repair 3

## Verdict

**FAIL**

Gate Repair 3 functionally closes the requested B-B1 through B-B7 product/oracle findings: same-identity relationship transitions reject both directions, depth-3+ registry-intent and prior-decision append-only histories reject truncation/reorder/mutation/in-prefix insertion during issuance and parsing, the valid full chains pass, and the package-root runtime export oracle is exact sorted equality over 57 literal keys with internals excluded.

The verification gate still fails because PASS requires zero blocking findings and this fresh run found two blocking gate failures:

1. Workspace typecheck fails in `packages/sdd-runtime/src/contracts/batch-b-direct-recovery.test.ts` on the new prior-decision digest test literals.
2. Broad suite has one unapproved `scripts/prepare-release.test.ts` failure whose observed reason is `Invalid --channel value: nightly`, not the exact approved stale build-info release failure.

## Finding Disposition B-B1-B-B7

| Finding | Disposition | Fresh independent evidence |
|---|---|---|
| B-B1 | CLOSED | Existing individually named protected-placement coverage remains in Batch B suites; focused Batch B acceptance passed `81/81`, contracts passed `179/179`, sdd-runtime passed `365/365`, and core passed `1474/1474`. |
| B-B2 | CLOSED | Independent reproducer verified same finding identity rejects both `unrelated_baseline -> batch_related` and `batch_related -> unrelated_baseline` through `computeFailureDeltaV1` and authoritative `parseFailureDeltaV1`, all with exact `invalid-evidence: finding relationship transition`. |
| B-B3 | CLOSED FUNCTIONALLY; GATE BLOCKED BY TYPECHECK | Independent reproducer verified registry-intent and prior-decision depth-3+ append-only histories: valid full chains parse; issuance and parsing reject truncation, reorder, mutation, and in-prefix insertion. Workspace typecheck nevertheless fails in the new B-B3 test code. |
| B-B4 | CLOSED | Full contracts, sdd-runtime, and core affected suites remain green; no new path/identity regression reproduced. |
| B-B5 | CLOSED | Full contracts, sdd-runtime, and core affected suites remain green; no new dedup/reorder/collision regression reproduced. |
| B-B6 | CLOSED | Full contracts, sdd-runtime, and core affected suites remain green; public parser/export boundary tests remain green. |
| B-B7 | CLOSED FUNCTIONALLY | Independent export oracle compared `Object.keys(publicApi).sort()` with the complete literal 57-key list: `actualCount=57`, `expectedCount=57`, `missing=[]`, `extra=[]`; pre-Batch-B exports sampled as present and canonical internals absent. |

## Gate-Repair-3 Findings

### CRITICAL - TYPECHECK-BATCH-B-DIRECT-RECOVERY-DIGEST-TYPES-v1

- **Requirement:** Gate Repair 3 must pass typecheck.
- **Evidence:** `bunx tsc --noEmit` exited `2`.
- **Observed errors:** 27 `TS2322` errors in `packages/sdd-runtime/src/contracts/batch-b-direct-recovery.test.ts` lines `107`, `109`, `112`, `119`, `121`, `123`, `132`, `134`, `136`, `145`, `147`, `149`, `161`, `163`, and `166`; each reports `Type 'string' is not assignable to type \`sha256:${string}\``.
- **Disposition:** Blocking. Not quarantinable.

### CRITICAL - BROAD-UNAPPROVED-PREPARE-RELEASE-SHA256-FAILURE-v1

- **Requirement:** Broad suite may quarantine only the exact approved stale release failures.
- **Evidence:** `timeout 900s bun test --timeout 30000` completed in `78.94s` with `3401 pass / 3 fail / 3404 total`, `11881` expectations across `190` files.
- **Approved stale failures observed:**
  - `prepare-release / end-to-end main() > emits valid spec-shaped release.json in non-interactive mode` failed with stale `build-info.generated.ts` commit `652a9b0` versus HEAD `f88a538e493a2792076f084234054bb8904f655b`.
  - `prepare-release / end-to-end main() > prints --help and exits 0` failed with the same stale build-info reason.
- **Unapproved failure observed:**
  - `prepare-release / end-to-end main() > computes and prints SHA-256 with --sha256-file` failed with `prepare-release failed: Invalid --channel value: nightly. Expected one of: stable, beta, dev`.
- **Disposition:** Blocking because the third failure is not the exact approved stale build-info failure. No binary-doctor failure was observed.

## Exact Blocking Set

```text
{
  TYPECHECK-BATCH-B-DIRECT-RECOVERY-DIGEST-TYPES-v1,
  BROAD-UNAPPROVED-PREPARE-RELEASE-SHA256-FAILURE-v1
}
```

## Independent Reproducers

Fresh independent script in `/tmp/opencode/batch-b-gate-repair-3-independent-repro.ts` imported the package root and executed 22 checks. Result: `22 passed / 0 failed`.

Covered checks:

- `computeFailureDeltaV1` rejects same-identity `unrelated_baseline -> batch_related`.
- `parseFailureDeltaV1` rejects same-identity `unrelated_baseline -> batch_related` with authoritative manifests.
- `computeFailureDeltaV1` rejects same-identity `batch_related -> unrelated_baseline`.
- `parseFailureDeltaV1` rejects same-identity `batch_related -> unrelated_baseline` with authoritative manifests.
- Registry-intent valid full depth-3 chain parses.
- Registry-intent issuance rejects truncation, reorder, mutation, and in-prefix insertion.
- Registry-intent parser rejects forged truncation, reorder, mutation, and in-prefix insertion.
- Prior-decision valid full depth-3 chain parses.
- Prior-decision issuance rejects truncation, reorder, mutation, and in-prefix insertion.
- Prior-decision parser rejects forged truncation, reorder, mutation, and in-prefix insertion.

Fresh independent package-root export script result:

- `actualCount=57`, `expectedCount=57`, exact sorted equality `true`.
- `missing=[]`, `extra=[]`.
- Internals absent: `canonicalJson`, `sha256Digest`, `deepFreeze`, `cloneCanonical`.
- Sampled pre-Batch-B exports preserved: `parseRepairIncidentYAML`, `runOrchestratorPipeline`, `runRunnerPipeline`, `attemptResume`, `applyEnforcement`, `validateStateUpdate`, `submitStateUpdate`.

## Focused/Affected Evidence

| Check | Command | Result |
|---|---|---|
| Focused Gate Repair 3 direct/export | `bun test packages/sdd-runtime/src/contracts/batch-b-direct-recovery.test.ts packages/sdd-runtime/src/contracts/batch-b-replacement.test.ts` | PASS: `49 pass / 0 fail`, `61` expectations, `2` files. |
| All Batch B acceptance tests | `bun test packages/sdd-runtime/src/contracts/batch-b-direct-recovery.test.ts packages/sdd-runtime/src/contracts/batch-b-replacement.test.ts packages/sdd-runtime/src/contracts/batch-b-repair.test.ts packages/sdd-runtime/src/contracts/batch-b-r3a-public-matrix.test.ts` | PASS: `81 pass / 0 fail`, `114` expectations, `4` files. |
| All contracts tests | `bun test packages/sdd-runtime/src/contracts` | PASS: `179 pass / 0 fail`, `353` expectations, `13` files. |
| Full sdd-runtime | `bun test packages/sdd-runtime` | PASS: `365 pass / 0 fail`, `841` expectations, `30` files. |
| Full core | `bun test packages/core` | PASS: `1474 pass / 0 fail`, `5228` expectations, `55` files. |

No dormant/aggregate/broad/subset/count/filler acceptance evidence was accepted for the Gate Repair 3 closure decision; verification used independently named tests plus independent reproducers and exact export equality.

## Typecheck

**FAIL**

Command: `bunx tsc --noEmit`

Exit: `2`

Errors: 27 `TS2322` errors in `packages/sdd-runtime/src/contracts/batch-b-direct-recovery.test.ts`; all report `Type 'string' is not assignable to type \`sha256:${string}\`` for prior-decision digest arrays introduced around the depth-3 B-B3 tests.

## Broad Evidence

**FAIL**

Command: `timeout 900s bun test --timeout 30000`

Wall allowance: `900000 ms`

Observed duration: `78.94s`

Result: `3401 pass / 3 fail / 3404 total`, `11881` expectations, `190` files.

Quarantine classification:

- Two failures match the approved stale release/build-info quarantine.
- One failure does not match the approved stale release/build-info quarantine: `prepare-release / end-to-end main() > computes and prints SHA-256 with --sha256-file` failed because `nightly` is no longer an accepted channel value.
- No binary-doctor failure was observed.

## Generated/Scope Audit

Generated hashes:

- `packages/core/src/skills/external/content.generated.ts`: `7ca11811594bcf72751d3f9b0b1a2bbfb9aaf2cdf68d07cef75e3c35ef7c1460`.
- `apps/cli/src/runtime/build-info.generated.ts`: `d664532190265f72bdbcaa8df5a16358c0cf71dccf7201d85e34b876124e0a6e`.

Scope observations:

- Gate Repair 3 product/test evidence is limited to Batch B dossier/direct-recovery/export paths.
- Current worktree still contains broader prior authorized Batch A/B files and OpenSpec artifacts; those were present before this Verify artifact was written.
- This Verify modified only `openspec/changes/developer-team-execution-convergence/verify-batch-b-gate-repair-3.md`.
- No generated hash drift was attributed to Gate Repair 3.

## Artifact

`openspec/changes/developer-team-execution-convergence/verify-batch-b-gate-repair-3.md`

## Artifact Evidence

- Artifact write mode: registry-deferred, report only.
- Self-verified artifact byte count: `09663` bytes.
- Registry files were not modified by this Verify.

## Phase

`verify`

## Status

`failed`

## Registry Write

`deferred`

## Registry Intent

- Event: `verify.batch-b.gate-repair-3.failed`
- Phase: `verify`
- Status: `failed`
- Artifact: `verify-batch-b-gate-repair-3.md`
- Registry state path: `openspec/changes/developer-team-execution-convergence/state.yaml`
- Registry events path: `openspec/changes/developer-team-execution-convergence/events.yaml`

## Blockers

- `TYPECHECK-BATCH-B-DIRECT-RECOVERY-DIGEST-TYPES-v1`
- `BROAD-UNAPPROVED-PREPARE-RELEASE-SHA256-FAILURE-v1`
