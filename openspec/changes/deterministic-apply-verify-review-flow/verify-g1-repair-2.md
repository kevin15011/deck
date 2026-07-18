# Verify G1 Repair Attempt 2: Deterministic Apply → Verify → Review Flow

## Phase result

| Field | Value |
|---|---|
| Change | `deterministic-apply-verify-review-flow` |
| Role / instance | fresh independent Verify; distinct from Apply |
| Stage | targeted + affected-area Verify for G1 repair-2 only |
| Authorized batch | G1 — T-01, T-02, T-03, T-04 |
| Status | **passed** |
| Classification | no blocking, recommendation, deferred, or pre-existing findings in this Verify scope |
| Broad verification | not run by delegation; no broad claim made |
| Next stage | fresh independent Review of G1 repair-2 |

G1 repair-2 is verified for targeted and affected-area scope. All five anchored Review blockers are covered by fresh source/test inspection and passing tests. The prior T-03 bypass remains rejected. No registry intent is emitted by this Verify stage.

## Official context and digests

| Artifact | Digest / binding |
|---|---|
| `spec.md` | `55b388b463dcc37c4ee59f3018a4714025de980001ff44fabe859b8e2df500b3` |
| `design.md` | `4b61d78ab9d698744946b329e43367383fe0184dc218d270e541b408d6657207` |
| `tasks.md` | `e5b718f6883e60f43b46e0892118fafedb01271cf90c4e3f861d925bfb3e6510` |
| `review-g1.md` | `c628595de8398a6e1afa8529e7b4b05cc303adb111c9fb354805e47a88b31b00` |
| `apply-progress.md` | `c5c69f41255d184b0327ff2b1d1f322cc0755843ec3f5a708486eae42518cbb1` |

Adaptive memory was loaded only as advisory context. Official OpenSpec artifacts, source, and tests remained authoritative.

## Scope evidence

Pre-report `git diff --name-only` was empty. Pre-report `git status --porcelain=v1` contained exactly the eight G1 source/test targets plus the change-local OpenSpec directory; no generated output, registry YAML, `state.yaml`, `events.yaml`, other OpenSpec change, or `runner-capability-standardization` target was in scope.

Inspected G1 targets and fresh SHA-256 hashes:

| Path | SHA-256 |
|---|---|
| `packages/sdd-runtime/src/contracts/finding-disposition.ts` | `76f28bfc425b466442d65a1654d8a60bcd1e1708119e8c25f70adb783b3b0d37` |
| `packages/sdd-runtime/src/contracts/finding-disposition.test.ts` | `25a5b831f5b836ae670a71a0ef608eac52ddf05b752971e1dd34e58c40f2a5ec` |
| `packages/sdd-runtime/src/contracts/routing-decision.ts` | `96e76578b8a008596ce787310d1698a793a0961e5dc245c60bf909a713bde2f2` |
| `packages/sdd-runtime/src/contracts/routing-decision.test.ts` | `a328a39b34d1ac775c94fb07a47efca3e3976644f440e65e112a674dc73a259a` |
| `packages/sdd-runtime/src/contracts/blocking-repair-projection.ts` | `70e27f66d5cd0fb7c5ee39369d73cd0eb3043a604f6c53318aa304e75af19bcb` |
| `packages/sdd-runtime/src/contracts/blocking-repair-projection.test.ts` | `39ca820b7bfdccbbd11dbe87d0b2c741c41413f7128a7626fa1e99456ba8f524` |
| `packages/sdd-runtime/src/contracts/execution-convergence.ts` | `d7d72788248852840f7cbbf0f221b24b4ee9a6b3883545f9b8d087f103ab211c` |
| `packages/sdd-runtime/src/contracts/execution-convergence.test.ts` | `3e8c2810524bcc58496cde2331d7073810c18b13455b2851316c22452a65289f` |

## Targeted blocker checks

| Check ID | Review blocker | Result | Evidence |
|---|---:|---|---|
| `review-g1-disposition-rehash-probe` | REVIEW-G1-B1 | PASS | `parseFindingDispositionEnvelopeV1` requires `DispositionClassificationInputV1`, recomputes entries with `projectFindingDispositionV1`, and rejects `disposition-recompute-mismatch`. Test present: validly rehashed downgrade rejection. |
| `review-g1-routing-rehash-probe` | REVIEW-G1-B2 | PASS | `parseRoutingDecisionV1` requires `RoutingPolicyInputV1`, recomputes with `buildRoutingDecisionV1`, compares routes/outcome/rationales, and rejects recompute mismatch. Test present: complete-with-active-blockers rehash rejection. |
| `review-g1-mixed-anchor-routing-probe` | REVIEW-G1-B3 | PASS | `buildRoutingDecisionV1` derives per-finding anchor/scope/risk/runtime inputs with `policy.findingInputs` while preserving global safety overrides. Tests present for mixed anchored/unanchored and mixed protected-risk routing. |
| `review-g1-causal-evidence-derivation-probe` | REVIEW-G1-B4 | PASS | `deriveRepairAuthorityFromSelectedFindingsV1` derives canonical causal evidence from selected findings; `buildBlockingRepairProjectionV1` requires caller evidence to match; effect boundary compares derived evidence and emits `OVERSIZED_EVIDENCE` on mismatch. Tests present for same-check/different-artifact and foreign evidence. |
| `review-g1-line-location-derivation-probe` | REVIEW-G1-B4 | PASS | location keys are normalized to repository paths before allowlist comparison. Test present for line/range location keys. |
| `review-g1-stale-evidence-transition-probe` | REVIEW-G1-B5 | PASS | modifying convergence transitions do not inherit old scoped/Review/broad digests; accepting transitions require current digests and empty active-blocking-set digest; `registry_committed` requires current scoped + Review + broad bindings. Tests present for stale pre-repair completion rejection. |
| `g1-effect-boundary-probe` | prior Verify T-03 bypass | PASS | `validateBlockingRepairProjectionAtEffectBoundaryV1` re-derives targets/anchors/checks/obligations/evidence from manifest + disposition and rejects validly rehashed non-derived batch-allowed targets with `OVERSIZED_TARGETS`. The prior bypass test remains present and passed. |

## Scheduled commands

| Check | Command | Result |
|---|---|---|
| G1 four-file targeted tests | `bun test packages/sdd-runtime/src/contracts/finding-disposition.test.ts packages/sdd-runtime/src/contracts/routing-decision.test.ts packages/sdd-runtime/src/contracts/blocking-repair-projection.test.ts packages/sdd-runtime/src/contracts/execution-convergence.test.ts` | PASS — 44 pass, 0 fail, 208 `expect()` calls, 4 files |
| Affected contracts suite | `bun test packages/sdd-runtime/src/contracts` | PASS — 228 pass, 0 fail, 566 `expect()` calls, 17 files |
| TypeScript | `bunx tsc --noEmit` | PASS — exit code 0 |

No broad or repository-wide test suite was run.

## Compatibility, safety, and freshness

| Area | Result | Evidence |
|---|---|---|
| V1 compatibility | PASS | The G1 targets are additive contract files/tests. Blocked V1 files listed in tasks (`failure-manifest.ts`, `execution-decision.ts`, `apply-batch.ts`, `execution-dossier.ts`) were not modified. The affected contracts suite, including existing V1 contract tests, passed. |
| Secret safety | PASS | Projection source keeps evidence bounded/redacted and rejects unsafe diagnostic content. Targeted tests include secret-shaped causal-evidence rejection. Rejection surfaces use stable rationale/error codes; no raw secret-shaped diagnostic was emitted as Verify evidence. |
| Effect safety | PASS | Effect-boundary validation fails closed before accepting stale authorization, stale routing, capability mismatch, excluded/blocked targets, oversized targets, oversized anchors/checks/obligations, or oversized causal evidence. |
| Fresh evidence | PASS | This Verify reran targeted G1 tests, the affected contracts suite, and `tsc` after repair-2. It does not rely on Apply's prior completion labels. |
| No stale completion | PASS | No completion or registry-commit intent is emitted. Convergence source/tests require current scoped, Review, and broad evidence before completion after modifying transitions. |

## FailureManifestV1

```json
{
  "schema": "failure-manifest-v1",
  "changeId": "deterministic-apply-verify-review-flow",
  "findings": []
}
```

## RegistryIntentV1

```json
[]
```

## Blockers and next action

Explicit blockers: none in this targeted + affected-area Verify scope.

Next action: route G1 repair-2 to a fresh independent Review. `G2_apply` remains blocked until that Review reports zero blockers and the coordinator schedules the next authorized stage.
