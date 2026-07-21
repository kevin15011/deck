# Verify Recovery G1: Deterministic Apply → Verify → Review Flow

## Phase result

| Field | Value |
|---|---|
| Change | `deterministic-apply-verify-review-flow` |
| Recovery batch | `deterministic-apply-verify-review-flow-recovery-batch-g1` |
| Role / instance | fresh independent Verify; distinct from Apply |
| Stage | targeted + affected-area Verify for recovery G1 only |
| Authorized file scope inspected | exactly 8 source/test files |
| Status | **passed** |
| Classification | no blocking, recommendation, deferred, or unrelated-baseline findings in this Verify scope |
| Broad verification | not run by delegation; no broad claim made |
| Next stage | fresh independent Review of `deterministic-apply-verify-review-flow-recovery-batch-g1` |

This Verify independently inspected the exact recovery G1 eight-file scope, reran all scheduled focused checks, reran the affected contracts suite, reran TypeScript validation, and probed the six replanned authority requirements. No blocker was found. `G2_apply` remains blocked and `repair-3` remains prohibited.

## Official context and digests

| Artifact | SHA-256 / binding |
|---|---|
| Repository HEAD | `ccf0f66e8f0fdbbd5cd6226466e34243a481beff` |
| `spec.md` | `374a8fb1a155830624083829aa8ccbbe609032e6a1b4c8064169372b4bfb8d7f` |
| `design.md` | `a2873999c3a1164393d57060db2032f2cf6aa8f9ca40f46c56e6911d9319d8fe` |
| `tasks.md` | `a113d334a9b6aec8d64e043dc5b22531479014bc47027dec17175fb0c881fa5c` |
| `preconditions.md` | `81cbd0225bf757596a9f6bdb5eda460be910b12fe3019548bf2d402ec8b2e513` |
| `spec-replan-g1.md` | `14b0ed7cc890c440c8dad6fbb7909c346a46b7d6c5a5cf6a976506ce12abbfc5` |
| `design-replan-g1.md` | `79f36722cc185be685b61a8ccf22907f3eb924e57d539c4a1e53016f3bd8430d` |
| `tasks-replan-g1.md` | `96832a1c631669ef569b44d12764a2813173fab215b97c12be5002568c344d4a` |

Adaptive context was loaded only as advisory context. Official OpenSpec artifacts, current source, tests, and command evidence remained authoritative.

## Scope evidence

Pre-report worktree inspection showed no tracked diffs. The only non-OpenSpec untracked files were the exact eight recovery G1 source/test targets; no generated output, registry YAML, other OpenSpec change, or `runner-capability-standardization` target was present.

| Path | SHA-256 |
|---|---|
| `packages/sdd-runtime/src/contracts/finding-disposition.ts` | `fb5b4cdc1fecb7e445281ebf3161ad7a46e1023abb3c8088a8a6672eb2577265` |
| `packages/sdd-runtime/src/contracts/finding-disposition.test.ts` | `7a074cc8f067099542e54f15d64bbf8ab2de1baa2cb90c3fb3a88e4dc4e72414` |
| `packages/sdd-runtime/src/contracts/routing-decision.ts` | `b711e70d14debaa3ad0a7bed77b0228a2f1119e024b2111f15fe9b77f8ff42d5` |
| `packages/sdd-runtime/src/contracts/routing-decision.test.ts` | `569341468982e602882984d5349d7a145a387c04065228d2c087981bff26e946` |
| `packages/sdd-runtime/src/contracts/blocking-repair-projection.ts` | `084935ed1b7c7362ba104f76ea69d3cc39511bb29df563c234ddbcfbade8bbb9` |
| `packages/sdd-runtime/src/contracts/blocking-repair-projection.test.ts` | `9356d5847584aa287ca30e00e4ee9ec996cf9d9c293399086adf3eb0a48e67b8` |
| `packages/sdd-runtime/src/contracts/execution-convergence.ts` | `4251e201e9e4e0d2dbbdd3b4c2cbac0e8d1bbf2a39984365940128826f51da8f` |
| `packages/sdd-runtime/src/contracts/execution-convergence.test.ts` | `211e26d5856a2d2ded473ef597c87bb8fc6adc1d506fbb0dc485175c9f297aca` |

## Scheduled check evidence

| Check ID | Command | Result |
|---|---|---|
| `focused-finding-disposition` | `bun test packages/sdd-runtime/src/contracts/finding-disposition.test.ts --timeout 30000` | PASS — 14 pass, 0 fail, 39 `expect()` calls, 1 file |
| `focused-routing-decision` | `bun test packages/sdd-runtime/src/contracts/routing-decision.test.ts --timeout 30000` | PASS — 15 pass, 0 fail, 86 `expect()` calls, 1 file |
| `focused-blocking-repair-projection` | `bun test packages/sdd-runtime/src/contracts/blocking-repair-projection.test.ts --timeout 30000` | PASS — 16 pass, 0 fail, 59 `expect()` calls, 1 file |
| `focused-execution-convergence` | `bun test packages/sdd-runtime/src/contracts/execution-convergence.test.ts --timeout 30000` | PASS — 15 pass, 0 fail, 73 `expect()` calls, 1 file |
| `affected-contracts-suite` | `bun test packages/sdd-runtime/src/contracts --timeout 30000` | PASS — 244 pass, 0 fail, 615 `expect()` calls, 17 files |
| `typecheck` | `bunx tsc --noEmit` from repository root | PASS — exit code 0; no compiler output |

No broad or repository-wide test suite beyond the affected contracts suite was run.

## Replanned authority requirement probes

| Check ID | Requirement | Result | Independent evidence |
|---|---|---|---|
| `req-davr-fd-03-protected-risk-disposition` | `REQ-DAVR-FD-03` | PASS | `ProtectedRiskAuthorityContextV1` is an additive authority argument with mandatory security/data-loss policy fields; `deriveProtectedRiskV1` derives from V1 finding security/root-cause evidence and policy anchors; `projectFindingDispositionV1` makes any protected/ambiguous risk `blocking`. Focused tests cover advisory security downgrade, caller-omitted data-loss flags, and conflicting security evidence. |
| `req-davr-sec-03-protected-risk-recompute` | `REQ-DAVR-SEC-03` | PASS | Disposition and routing parsers require authority-bound recomputation and reject validly rehashed protected-risk downgrades with `DISPOSITION_PROTECTED_RISK_MISMATCH`, `ROUTING_PROTECTED_RISK_MISMATCH`, or `PROTECTED_RISK_AUTHORITY_AMBIGUOUS`. Focused tests cover forged `security → recommendation`, forged `security → targeted_repair`, and missing authority at authoritative routing parse. |
| `req-davr-rg-05-retry-identity-complete` | `REQ-DAVR-RG-05` | PASS | `RetryIdentityAuthorityProjectionV1` includes routing policy version, original batch digest, selected finding IDs, destination/owner, targets, requirements, tasks, checks, obligations, oracle IDs, and verification-plan check IDs. `computeRetryIdentityFromAuthorityV1` derives identity from that projection. Focused tests cover oracle/check inclusion and identity changes when oracle or verification-plan scope changes. |
| `req-davr-md-03-retry-identity-and-ledger-boundary` | `REQ-DAVR-MD-03` | PASS | `parseBlockingRepairProjectionV1` and `validateBlockingRepairProjectionAtEffectBoundaryV1` recompute identity and enforce ledger attempt/prior/head bindings. Rejection codes include `RETRY_IDENTITY_MISMATCH`, `RETRY_POLICY_VERSION_MISMATCH`, `RETRY_LEDGER_MISMATCH`, `RETRY_ATTEMPT_NUMBER_MISMATCH`, and `RETRY_PRIOR_ATTEMPT_MISMATCH`. Focused tests cover replaced identity after rehash, skipped/stale/prior ledger bindings, and valid attempt 1/attempt 2 binding. |
| `req-davr-bv-03-typed-current-stage-evidence` | `REQ-DAVR-BV-03` | PASS | `ConvergenceStageEvidenceV1` and authority-bound transition APIs require typed evidence with correct stage, generation, implementation subject, dependency digest, active blocking set, and referenced result. Non-modifying subject drift, wrong stage, prior generation, dependency mismatch, and opaque evidence fail closed. Focused tests cover wrong stage, prior generation, subject mismatch, opaque evidence, and the legal typed-evidence chain. |
| `req-davr-reg-03-transition-authoritative-persistence` | `REQ-DAVR-REG-03` | PASS | `appendExecutionConvergenceRevisionWithAuthorityV1` computes successor state from event + typed authority, not caller-provided arbitrary state. `parseExecutionConvergenceDossierWithAuthorityV1` replays authority-bound history and rejects illegal transition or arbitrary `complete` append. Focused tests cover arbitrary complete append rejection, illegal transition rejection, deterministic legal chain round-trip, and separate `dependencies_invalidated` handling. |

## Prior terminal Review blocker reassessment

| Prior finding | Result | Verify judgment |
|---|---|---|
| `REVIEW-G1-R2-B1-PROTECTED-RISK-AUTHORITY` | PASS | Protected-risk evidence is now mandatory authority in disposition and routing; caller downgrade and forged rehash probes are covered by focused tests. |
| `REVIEW-G1-R2-B2-RETRY-IDENTITY-AUTHORITY` | PASS | Retry identity is recomputed from the complete authority projection, and attempt/prior bindings are checked against the current ledger at parser/effect boundaries. |
| `REVIEW-G1-R2-B3-CONVERGENCE-AUTHORITY` | PASS | Accepting convergence transitions require typed current evidence; persisted authority-bound dossiers replay legal predecessor transitions and reject arbitrary completion. |

## Compatibility and safety checks

| Area | Result | Evidence |
|---|---|---|
| V1 serialized shape preservation | PASS | Inspected V1 interfaces keep established fields for `FindingDispositionEnvelopeV1`, `RoutingDecisionV1`, `BlockingRepairProjectionV1`, `ExecutionConvergenceStateV1`, and `ExecutionConvergenceDossierV1`; authority enters through additive context/typed records and authority-bound APIs. |
| Scope ceiling | PASS | Worktree source/test scope is exactly the four authorized source/test pairs; no generated/config/registry/YAML/other-change file was added to the batch. |
| Fail-closed codes | PASS | Required protected-risk and retry rejection codes are present and exercised by tests; convergence mismatch/transition codes are fixed in source and tested through rejection oracles. |
| Fresh evidence | PASS | All focused tests, the contracts suite, and TypeScript validation were rerun by this Verify instance after the recovery G1 implementation. |
| Registry safety | PASS | No `state.yaml` or `events.yaml` was written by this Verify instance; no registry commit or completion claim is emitted. |

## Classified findings

| Class | Count | Findings |
|---|---:|---|
| Blocking | 0 | None |
| Recommendation | 0 | None |
| Deferred | 0 | None |
| Unrelated baseline | 0 | None |

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

Next action: route `deterministic-apply-verify-review-flow-recovery-batch-g1` to a fresh independent Review. `G2_apply` remains blocked, `repair-3` remains prohibited, and broad verification remains unscheduled until the workflow orders it after scoped acceptance and Review.
