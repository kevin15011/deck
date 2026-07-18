# Verify G1 Repair Attempt 1: Deterministic Apply → Verify → Review Flow

## PhaseResult

| Field | Value |
|---|---|
| Role | `verify` |
| Instance | fresh independent Verify after G1 repair attempt 1 |
| Change ID | `deterministic-apply-verify-review-flow` |
| Finding under repair | `VERIFY-G1-BLOCKING-T03-EFFECT-BOUNDARY-DERIVATION-v1` |
| Stage | Targeted + affected-area Verify only |
| Status | `passed` |
| Deterministic next action | `review` |
| RegistryIntentV1 | `[]` |
| Blockers | None |

The prior T-03 bypass is resolved: a validly rehashed projection that widens to a batch-allowed but non-derived target is rejected fail-closed with `invalid-evidence` and `OVERSIZED_TARGETS`.

## Scope and freshness proof

| Item | Evidence |
|---|---|
| Repository HEAD | `ccf0f66` |
| Authoritative artifact digests | `spec.md` = `55b388b463dcc37c4ee59f3018a4714025de980001ff44fabe859b8e2df500b3`; `design.md` = `4b61d78ab9d698744946b329e43367383fe0184dc218d270e541b408d6657207`; `tasks.md` = `e5b718f6883e60f43b46e0892118fafedb01271cf90c4e3f861d925bfb3e6510`. |
| Repair evidence digest | `apply-progress.md` = `7da7caed49ed3565fef229e18ca2891854ce9d7ffd2be1867b77ac68989d9d0c`; prior `verify-g1.md` = `879f05b851af2373da61dd26d679f0d1a6d74fde5e3d0ef569233e9af1ae1c53`; `repair-incident.md` = `223c1c199950a47071ec4eacb7b964321309095a3417cc2822d500b2f61c9609`. |
| Git freshness before this report | `git status --porcelain=v1` showed no tracked or staged diffs. Untracked source/test targets were exactly the eight G1 files; change-local artifacts were under `openspec/changes/deterministic-apply-verify-review-flow/`. |
| Verify write boundary | This Verify wrote only `openspec/changes/deterministic-apply-verify-review-flow/verify-g1-repair-1.md`. |
| Deferred by delegation | Broad/repo-wide tests, Review, source/test edits, generated changes, and registry YAML writes were not run or performed. |

Adaptive context was not loaded; this decision uses official OpenSpec artifacts, repository source/tests, and change-local evidence only.

## Source/test boundary inspection

| Path | SHA-256 | Result |
|---|---:|---|
| `packages/sdd-runtime/src/contracts/finding-disposition.ts` | `bdafbf0c6a9ba8a44551aec709d48feb85804355c5db6d8f84144b32d5a310cd` | In scope. Additive disposition sidecar; no secret-shaped source content found. |
| `packages/sdd-runtime/src/contracts/finding-disposition.test.ts` | `7298b3a2d3e71ce48338be56b9b6decfd62526d2503338bc5fc9e432c8f9bccf` | In scope. 8 tests cover four dispositions, ambiguous blocking, V1 projection, baseline behavior, and semantic digest stability. |
| `packages/sdd-runtime/src/contracts/routing-decision.ts` | `c2a6632a85f6e33615c670894f73353a4711b4bc7032dd263043f85b72226dd0` | In scope. Total routing table preserved; no secret-shaped source content found. |
| `packages/sdd-runtime/src/contracts/routing-decision.test.ts` | `bfce4f738286cee68af5a1d0bcbd7f24762c7242188bc991e06b5519d284fcb5` | In scope. 10 tests cover root-cause totality, protected risk, auth/Git stop, runtime diagnosis, unknown fail-closed, mixed owner split, scope growth, excluded targets, and digest determinism. |
| `packages/sdd-runtime/src/contracts/blocking-repair-projection.ts` | `d4d0a096789861d00ea7cbf81d5a317e5f1c0b6ff17c45b76ca4c09e1397124d` | In scope. Repair authority is re-derived from selected findings at build and effect boundary; mismatch codes include `OVERSIZED_TARGETS`, `OVERSIZED_ANCHORS`, `OVERSIZED_CHECKS`, and `OVERSIZED_OBLIGATIONS`. |
| `packages/sdd-runtime/src/contracts/blocking-repair-projection.test.ts` | `c5bffbc72894635b23048d29ad48bf94cdef0c6b164160a190668887010e137c` | In scope. 8 tests include the exact validly rehashed non-derived target regression and secret rejection. |
| `packages/sdd-runtime/src/contracts/execution-convergence.ts` | `0e44f151450026cb80a68467bb4bb028690e10dd3e36bdb78a8ea6a0cdcb12e6` | In scope. Additive convergence wrapper over V1 dossier; no secret-shaped source content found. |
| `packages/sdd-runtime/src/contracts/execution-convergence.test.ts` | `43c5734cac73f716a2417c9c70500d398deaa0723f8f2dad98d5cc630eec3914` | In scope. 9 tests cover append-only revisions, transition table, repair generation increment, V1 dossier immutability, and deterministic digests. |

No source/test/generated target outside the G1 allowlist was modified by this Verify stage.

## Executed checks

| Check ID | Command | Result |
|---|---|---|
| `g1-targeted-contract-tests` | `bun test packages/sdd-runtime/src/contracts/finding-disposition.test.ts packages/sdd-runtime/src/contracts/routing-decision.test.ts packages/sdd-runtime/src/contracts/blocking-repair-projection.test.ts packages/sdd-runtime/src/contracts/execution-convergence.test.ts` | PASS — exit 0; 35 pass, 0 fail, 170 `expect()` calls, 4 files. |
| `affected-contract-suite` | `bun test packages/sdd-runtime/src/contracts` | PASS — exit 0; 219 pass, 0 fail, 528 `expect()` calls, 17 files. |
| `typecheck` | `bunx tsc --noEmit` | PASS — exit 0; no compiler output. |
| `g1-repair-effect-boundary-probe` | In-memory Bun probe over `validateBlockingRepairProjectionAtEffectBoundaryV1` using a validly rehashed projection widened to `packages/sdd-runtime/src/contracts/finding-disposition.ts` | PASS — rehash integrity true; widened target remained a batch-allowed subset; result was `{ "accepted": false, "outcome": "invalid-evidence", "rationaleCodes": ["OVERSIZED_TARGETS"] }`; no secret-shaped text appeared in the rejection surface. |

## Requirement/task inspection

| Check | Deterministic classification |
|---|---|
| Exact prior bypass | PASS. The effect boundary now receives `manifest` + `disposition`, recomputes authority from selected blocking findings, and rejects a validly rehashed batch-allowed but non-derived target with `OVERSIZED_TARGETS`. |
| Fail-closed/no effect | PASS. The rejection outcome is `invalid-evidence`; the validator returns a rejection and does not invoke or perform a modifying effect. |
| V1 compatibility | PASS. No blocked V1 contracts were modified; the affected contracts suite including existing V1 contract tests passed; G1 contracts remain additive over V1 evidence. |
| No secret leakage | PASS. Source inspection found no secret-shaped content in contract sources; projection tests reject secret-shaped causal evidence; the targeted bypass probe rejection surface contained no secret-shaped text. The test fixture string is intentional test data, not leaked evidence. |
| TDD RED record | PASS. `apply-progress.md` records RED evidence for the repair: the new regression test failed before derivation binding with `Expected accepted=false, Received accepted=true`, then passed after repair. |
| Source/test scope | PASS. Current source/test targets are the eight G1 files only; repair-local evidence is confined to the change-local directory; no generated output, registry YAML, `state.yaml`, or `events.yaml` write was performed by this Verify stage. |
| Four G1 tests | PASS. The targeted command ran all four G1 test files and passed. |
| Full contracts suite | PASS. The affected-area contracts suite passed. |
| TypeScript | PASS. `bunx tsc --noEmit` passed with no output. |

## Findings

### Blocking

None.

### Recommendations

None.

### Deferred

Broad/repo-wide verification remains intentionally deferred by the delegated stage. No broad pass is claimed.

### Pre-existing

None identified in this scoped stage.

## FailureManifestV1

```json
{
  "schema": "failure-manifest-v1",
  "changeId": "deterministic-apply-verify-review-flow",
  "findings": []
}
```

The previous finding `VERIFY-G1-BLOCKING-T03-EFFECT-BOUNDARY-DERIVATION-v1` is verified resolved for G1 targeted + affected-area scope. The two-attempt policy does not require a second Apply attempt because the same finding did not persist.

## RegistryIntentV1

```json
[]
```

## Blockers

None. Proceed to independent Review.
