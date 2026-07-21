# Verify G1: Deterministic Apply → Verify → Review Flow

## Decision

**Status:** blocked — targeted and affected checks pass, but independent inspection found one anchored G1 contract blocker in T-03.

**Deterministic next action:** route to `apply-backend` for a T-03 implementation repair. Do not advance to Review until the blocker is repaired and G1 targeted + affected verification are rerun fresh.

## Scope and freshness evidence

| Item | Evidence |
|---|---|
| Stage | G1 scoped Verify only; broad/repo-wide tests intentionally not run. |
| Authoritative digests | `spec.md` = `55b388b463dcc37c4ee59f3018a4714025de980001ff44fabe859b8e2df500b3`; `design.md` = `4b61d78ab9d698744946b329e43367383fe0184dc218d270e541b408d6657207`; `tasks.md` = `e5b718f6883e60f43b46e0892118fafedb01271cf90c4e3f861d925bfb3e6510`. |
| Apply record | `apply-progress.md` reports G1 T-01..T-04 GREEN and RED module-missing evidence before implementation. |
| Source/test target boundary | Git showed no tracked diff. Untracked source/test/generated targets are exactly the eight G1 files: `finding-disposition.ts`, `finding-disposition.test.ts`, `routing-decision.ts`, `routing-decision.test.ts`, `blocking-repair-projection.ts`, `blocking-repair-projection.test.ts`, `execution-convergence.ts`, `execution-convergence.test.ts`. No source/test/generated target outside the G1 allowlist was present. |
| Change-local artifacts | Existing untracked artifacts are under `openspec/changes/deterministic-apply-verify-review-flow/`. This Verify wrote only this report. |
| V1/generated boundary | No V1 contract, barrel, generated output, `state.yaml`, `events.yaml`, existing change, or `runner-capability-standardization` source/test/generated target was modified by this Verify stage. |

Adaptive context was loaded as advisory only; OpenSpec artifacts and repository evidence controlled the decision.

## Executed checks

| Check ID | Command | Result |
|---|---|---|
| `g1-targeted-contract-tests` | `bun test packages/sdd-runtime/src/contracts/finding-disposition.test.ts packages/sdd-runtime/src/contracts/routing-decision.test.ts packages/sdd-runtime/src/contracts/blocking-repair-projection.test.ts packages/sdd-runtime/src/contracts/execution-convergence.test.ts` | PASS — 34 pass, 0 fail, 163 expect() calls, 4 files. |
| `affected-contract-suite` | `bun test packages/sdd-runtime/src/contracts` | PASS — 218 pass, 0 fail, 521 expect() calls, 17 files. |
| `typecheck` | `bunx tsc --noEmit` | PASS — exit 0, no compiler output. |
| `g1-effect-boundary-probe` | Temporary in-memory Bun probe over `validateBlockingRepairProjectionAtEffectBoundaryV1` with a recomputed oversized projection digest | FAIL — a projection widened to include an additional batch-allowed but non-derived target was accepted: `{ "accepted": true }`. |

## Requirement/task inspection

| Task | Inspection result |
|---|---|
| T-01 `FindingDispositionEnvelopeV1` | No blocker found. Evidence covers all four dispositions, ambiguous→blocking, V1 projection, baseline pre-existing exclusion, one-to-one entries, stable semantic digest, and active-blocking filtering. |
| T-02 `RoutingDecisionV1` | No G1 blocker found. Evidence covers total recognized root-cause routing, protected risk escalation, auth/Git stop, runtime diagnosis, excluded-target stop, mixed-owner split, and producer/prose/timestamp-independent digesting. |
| T-03 `BlockingRepairProjectionV1` | **Blocking finding below.** Builder enforces minimality, authorization, redacted evidence, blocked/excluded targets, and V1 batch identity preservation, but the effect-boundary validator does not independently reject a validly rehashed oversized projection. |
| T-04 `ExecutionConvergenceDossierV1` / `ExecutionConvergenceStateV1` | No blocker found for G1 scope. Evidence covers append-only revision validation, predecessor mismatch rejection, invalid transitions, Review gate ordering, broad pending after Review, repair generation increment, and deterministic dossier digests. |

## Classified findings

### Blocking

1. **`VERIFY-G1-BLOCKING-T03-EFFECT-BOUNDARY-DERIVATION-v1`**
   - **Classification:** blocking
   - **Root cause:** implementation
   - **Anchors:** T-03; REQ-DAVR-MD-02; REQ-DAVR-CS-02; REQ-DAVR-BA-01; REQ-DAVR-SAF-04; check `g1-effect-boundary-probe`
   - **Location:** `packages/sdd-runtime/src/contracts/blocking-repair-projection.ts:365-438`; test gap at `packages/sdd-runtime/src/contracts/blocking-repair-projection.test.ts:169-206`
   - **Evidence:** The effect boundary validates parseability, stale digests, authorization, capability binding, batch subset, blocked/excluded intersections, selected routes, homogeneous routing, and digest integrity, but it does not recompute the projection's anchors/checks/targets from the selected blocking findings or an equivalent expected derivation set. A validly rehashed projection that adds another batch-allowed target is therefore accepted. This violates the T-03 requirement that extra anchors/checks/targets be rejected at the effect boundary.
   - **Repair route:** `apply-backend`, limited to T-03 allowlisted contract/test files unless Tasks replan.

### Recommendations

None.

### Deferred

Broad/repo-wide verification remains explicitly deferred until stable final acceptance; no broad pass is claimed here.

### Pre-existing

None identified in this scoped stage.

## FailureManifestV1

```json
{
  "schema": "failure-manifest-v1",
  "changeId": "deterministic-apply-verify-review-flow",
  "findings": [
    {
      "findingId": "VERIFY-G1-BLOCKING-T03-EFFECT-BOUNDARY-DERIVATION-v1",
      "status": "open",
      "relationship": "batch_related",
      "rootCause": "implementation",
      "disposition": "blocking",
      "requirementIds": ["REQ-DAVR-MD-02", "REQ-DAVR-CS-02", "REQ-DAVR-BA-01", "REQ-DAVR-SAF-04"],
      "taskIds": ["T-03"],
      "checkIds": ["g1-effect-boundary-probe"],
      "locationKeys": [
        "packages/sdd-runtime/src/contracts/blocking-repair-projection.ts:365-438",
        "packages/sdd-runtime/src/contracts/blocking-repair-projection.test.ts:169-206"
      ]
    }
  ]
}
```

## RegistryIntentV1

`[]`
