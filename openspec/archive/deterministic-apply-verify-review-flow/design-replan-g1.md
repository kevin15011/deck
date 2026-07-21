# Design Replan G1: Deterministic Apply → Verify → Review Flow

## Immutable PhaseResult

| Field | Value |
|---|---|
| Role | `design` |
| Instance provenance | bounded Design replan instance after revised Spec digest; distinct from the original Design, all G1 Apply/Verify/Review instances, and the bounded Spec replan instance |
| Change ID | `deterministic-apply-verify-review-flow` |
| Authorized action | update `design.md` and write this Design replan artifact only, using revised Spec digest `374a8fb1a155830624083829aa8ccbbe609032e6a1b4c8064169372b4bfb8d7f` |
| Artifacts modified | `openspec/changes/deterministic-apply-verify-review-flow/design.md` only |
| Artifacts written | `openspec/changes/deterministic-apply-verify-review-flow/design-replan-g1.md` only |
| Status | `completed` (bounded Design replan) |
| Action | `task_replan_handoff` — reconcile Tasks to the revised Spec and this Design; do not Apply |
| Next stage | bounded Task reconciliation, followed by a separate human-approved batch decision through the normal OpenSpec workflow |
| Design blockers | none; Spec OQ-11 is resolved at the architecture/HOW level |
| Implementation blockers | the three terminal G1 authority defects remain reproduced in unchanged source and must be converted into exact Tasks before any new batch may be considered |
| `G2_apply` | blocked |
| Third G1 repair | prohibited; this Design neither extends the exhausted budget nor authorizes repair-3 |
| FailureManifestV1 | present below; no new Design finding |
| Ordered RegistryIntentV1 values | `[]` |

## Context authority and write boundary

- **Official context used:** revised `spec.md`, `spec-replan-g1.md`, terminal `review-g1-repair-2.md`, approved `proposal.md`, prior `design.md`, current `tasks.md`, repository architecture guidance, the eight unchanged G1 source/test targets, and established read-only V1 contracts used as interface authority.
- **Adaptive context:** loaded as advisory only. Official OpenSpec artifacts, current source/tests, and repository evidence controlled every decision.
- **Write boundary honored:** only `design.md` was updated and only this file was added. No source, test, generated output, registry YAML, `state.yaml`, `events.yaml`, other change, or `runner-capability-standardization` target was modified.
- **Apply boundary:** no Apply was authorized, invoked, simulated, or performed. No tests or build commands were run because this was a Design-only replan.

## Immutable evidence bindings

| Binding | Digest / value |
|---|---|
| Repository HEAD | `ccf0f66e8f0fdbbd5cd6226466e34243a481beff` |
| `proposal.md` | `sha256:2b3c63a2bceaa06a8449c68d7ac080eee5724793a4060a9e5c4380a8a01e1ba1` |
| revised `spec.md` | `sha256:374a8fb1a155830624083829aa8ccbbe609032e6a1b4c8064169372b4bfb8d7f` |
| `spec-replan-g1.md` | `sha256:14b0ed7cc890c440c8dad6fbb7909c346a46b7d6c5a5cf6a976506ce12abbfc5` |
| terminal `review-g1-repair-2.md` | `sha256:5a3588e7a402f38138117ad3314f1f687e9637cf275852f5e9ebdd42907c4695` |
| `tasks.md` (pre-Task-replan) | `sha256:e5b718f6883e60f43b46e0892118fafedb01271cf90c4e3f861d925bfb3e6510` |
| `design.md` before this replan | `sha256:4b61d78ab9d698744946b329e43367383fe0184dc218d270e541b408d6657207` |
| `design.md` after this replan | `sha256:a2873999c3a1164393d57060db2032f2cf6aa8f9ca40f46c56e6911d9319d8fe` |

The digest of this report is intentionally returned by the external immutable PhaseResult because embedding a file's own digest in its content would be circular.

## Chosen additive fail-closed architecture

### 1. Protected-risk source authority

- Keep `FailureFindingV1`, `FailureManifestV1`, `FindingDispositionEnvelopeV1`, and `RoutingDecisionV1` serialized shapes unchanged.
- Add a mandatory pure `ProtectedRiskAuthorityContextV1` argument bound to batch/manifest plus current approved Spec/Design/Tasks and policy versions.
- Derive intrinsic security from parsed `rootCause` and `isSecurityRelevant`; derive data-loss relevance from positive matches against batch-bound mandatory requirement/task/check/oracle policy sets.
- Treat absent, conflicting, mismatched, or unsupported caller risk values as ambiguity. Ambiguity remains `blocking` and cannot route to Apply.
- Recompute the protected class at disposition parse, routing parse/decision, repair-projection construction, and effect consumption. Security/data loss escalates; ambiguity stops or takes an already stricter escalation path.
- A valid rehash with downgraded disposition or route is invalid evidence because content integrity is not source authority.

### 2. Retry identity and counter authority

- Keep `BlockingRepairProjectionV1` serialized keys unchanged.
- Define one canonical `RetryIdentityAuthorityProjectionV1` containing the current normalized routing-policy version, original batch digest, selected blockers, derived destination/owner, exact derived targets/anchors, the complete original acceptance-obligation set, selected-finding oracle IDs, and every original V1 verification-plan check ID.
- Derive policy version from current routing authority; no hard-coded policy version is accepted.
- Recompute exact retry identity at projection parse and effect consumption.
- Make the current fully parsed convergence `retryLedgerDigests` plus their complete attempt records the sole attempt-number/prior-attempt authority. Attempt 1 has no prior digest; attempt N is exactly ledger count + 1 and binds to attempt N-1 for the same identity.
- Reject replaced identity, stale policy, skipped/duplicate attempt, detached prior digest, missing ledger record, or stale dossier head with deterministic `invalid-evidence` codes and no effect/ledger append.

### 3. Convergence evidence and transition authority

- Keep `ExecutionConvergenceStateV1` and `ExecutionConvergenceDossierV1` serialized keys unchanged.
- Add content-addressed typed stage-evidence, invalidation, and transition-receipt authority records referenced through the existing append-only digest lists.
- Tighten deterministic append so callers supply an event plus typed authority, never an arbitrary next state. The state transition function computes the only serializable successor.
- Add authority-bound full-history parsing that replays every revision from the canonical initial state and byte-compares the computed state with the persisted state.
- Require every accepting event to carry the correct stage, current generation, current implementation subject, recomputed stage dependency digest, active-blocking-set binding, predecessor, and underlying result/commit reference.
- Handle non-modifying subject/dependency drift only through a separate `dependencies_invalidated` revision that clears stale evidence and returns to `targeted_pending`; never coalesce drift with an accepting event.
- Reject opaque evidence, out-of-table transitions, arbitrary `complete` append/rehash, and commit readiness lacking a full transition-authoritative chain.

## V1 compatibility and migration

1. Established V1 payload fields, exact-key parsers, IDs, digests, and stored records are not edited or reinterpreted.
2. The four G1 contract payload shapes remain unchanged; authority enters through additive context/typed record inputs and authority-bound consumption functions.
3. Structural readers remain available for historical readability only. Evidence lacking the new authority context is `legacy-readable/non-authoritative` and cannot authorize effect, completion, or registry commitment.
4. No persisted data migration, registry backfill, history rewrite, or in-place rehash is required or allowed.
5. The revised Spec/Design/Tasks digests require a newly issued and human-approved batch. No prior G1 projection is migrated into repair-3, and the consumed G1 attempt history remains immutable.

## Exact impacted boundaries and expected targets

The next Task replan must preserve exactly these four source/test pairs for any candidate authority batch:

| Slice | Exact source target | Current SHA-256 | Exact test target | Current SHA-256 |
|---|---|---|---|---|
| Protected-risk disposition | `packages/sdd-runtime/src/contracts/finding-disposition.ts` | `76f28bfc425b466442d65a1654d8a60bcd1e1708119e8c25f70adb783b3b0d37` | `packages/sdd-runtime/src/contracts/finding-disposition.test.ts` | `25a5b831f5b836ae670a71a0ef608eac52ddf05b752971e1dd34e58c40f2a5ec` |
| Protected-risk routing | `packages/sdd-runtime/src/contracts/routing-decision.ts` | `96e76578b8a008596ce787310d1698a793a0961e5dc245c60bf909a713bde2f2` | `packages/sdd-runtime/src/contracts/routing-decision.test.ts` | `a328a39b34d1ac775c94fb07a47efca3e3976644f440e65e112a674dc73a259a` |
| Retry identity/counter | `packages/sdd-runtime/src/contracts/blocking-repair-projection.ts` | `70e27f66d5cd0fb7c5ee39369d73cd0eb3043a604f6c53318aa304e75af19bcb` | `packages/sdd-runtime/src/contracts/blocking-repair-projection.test.ts` | `39ca820b7bfdccbbd11dbe87d0b2c741c41413f7128a7626fa1e99456ba8f524` |
| Convergence authority | `packages/sdd-runtime/src/contracts/execution-convergence.ts` | `d7d72788248852840f7cbbf0f221b24b4ee9a6b3883545f9b8d087f103ab211c` | `packages/sdd-runtime/src/contracts/execution-convergence.test.ts` | `3e8c2810524bcc58496cde2331d7073810c18b13455b2851316c22452a65289f` |

No index/export, fixture, orchestrator, execution-control-plane, adapter, prompt, generated, config, registry, YAML, other OpenSpec change, or historical target may be added to that bounded candidate batch. Broader original change impact remains non-authorizing future context.

## Task-ready constraints and test oracles

Tasks must:

1. bind to revised Spec digest `374a8fb1a155830624083829aa8ccbbe609032e6a1b4c8064169372b4bfb8d7f` and Design digest `a2873999c3a1164393d57060db2032f2cf6aa8f9ca40f46c56e6911d9319d8fe`;
2. add explicit coverage for `REQ-DAVR-FD-03`, `REQ-DAVR-SEC-03`, `REQ-DAVR-RG-05`, `REQ-DAVR-MD-03`, `REQ-DAVR-BV-03`, and `REQ-DAVR-REG-03` without weakening prior requirements;
3. preserve the exact eight-file ceiling and existing blocked-target rules;
4. require RED-first probes for each reproduced terminal Review fingerprint before production changes;
5. require protected-risk downgrade/omission/conflict and valid-rehash rejection at every disposition/routing/effect boundary;
6. require identity changes for oracle, verification-plan check, and policy-version changes; parser/effect identity recomputation; and exact current-ledger attempt/prior binding;
7. require wrong-stage/generation/subject/dependency rejection, separate invalidation, arbitrary state-append rejection, full-history transition replay, and one legal deterministic completion-chain oracle;
8. retain unchanged V1 ID/digest/readability oracles and all prior G1 regression oracles;
9. preserve existing authorization, Git-discard, secret, data-loss, mandatory broad, independent role, registry single-writer, and baseline floors; and
10. state explicitly that Task reconciliation is not modifying authorization and that a separate human-approved batch identity is still required.

Expected stable fail-closed codes include `PROTECTED_RISK_AUTHORITY_AMBIGUOUS`, `DISPOSITION_PROTECTED_RISK_MISMATCH`, `ROUTING_PROTECTED_RISK_MISMATCH`, `RETRY_IDENTITY_MISMATCH`, `RETRY_POLICY_VERSION_MISMATCH`, `RETRY_LEDGER_MISMATCH`, `RETRY_ATTEMPT_NUMBER_MISMATCH`, `RETRY_PRIOR_ATTEMPT_MISMATCH`, subject/generation/dependency mismatch, and illegal transition. Exact spellings for convergence mismatch codes must be fixed by Tasks before Apply and then treated as acceptance oracles, not chosen during implementation.

## Verification, rollout, and rollback boundaries

- **Verification plan:** future authorized work starts with the four focused test files, then the four-source contract suite, the full `packages/sdd-runtime/src/contracts` suite, TypeScript validation, affected checks, and required broad baseline comparison. Independent Verify and fresh independent Review remain separate judgments. This Design phase claims none of those checks.
- **Rollout:** add authority-bound contract entry points before any completion-authorizing runtime selection; keep the unsafe deterministic path non-authoritative until all focused, compatibility, replay, safety, effect, and transition gates pass. No cohort, telemetry window, adapter expansion, or silent legacy fallback is introduced.
- **Rollback:** stop effects and registry commits on regression; use a normal auditable coherent-slice revert or forward-fix; preserve V1 readers, additive evidence readers, registry/history, and exhausted G1 attempt evidence. Never discard uncommitted work, rewrite history, or promote structural-only evidence to authority.

## Decisions, alternatives, and tradeoffs

- **Chosen:** authority contexts and typed records around unchanged V1 serialization. This localizes the repair to the exact four contract pairs and makes forged rehashes non-authoritative.
- **Rejected:** adding risk fields to `FailureFindingV1`, adding identity fields to the repair projection, or adding transition fields to the convergence dossier. Exact-key V1 compatibility would be broken.
- **Rejected:** trusting caller booleans, digest shape, counter shape, or hash-linked state alone. Each reproduces a terminal Review authority defect.
- **Tradeoff:** structural V1 readability and authoritative deterministic consumption become distinct APIs. The separation is deliberate: compatibility readers can preserve history, while effects/completion require complete current authority.
- **Tradeoff:** typed authority records add replay material. They avoid widening persisted V1 shapes and make every transition independently testable.

## Blockers and exact next action

- **Design blockers:** none. OQ-11 and all six revised requirements have concrete architecture, migration, tests, rollout/rollback, and exact expected targets.
- **Implementation blockers:** `REVIEW-G1-R2-B1-PROTECTED-RISK-AUTHORITY`, `REVIEW-G1-R2-B2-RETRY-IDENTITY-AUTHORITY`, and `REVIEW-G1-R2-B3-CONVERGENCE-AUTHORITY` remain open against unchanged source until a future authorized implementation is independently verified and reviewed.
- **Governance gates:** bounded Task reconciliation and a new human-approved batch identity. These are not waived by Automatic mode or this completed Design.
- **Exact next action:** keep `G2_apply` blocked, emit no registry intent, route to bounded Task reconciliation, preserve the eight-file ceiling, and stop again for explicit batch authorization before any modifying attempt.

## FailureManifestV1

```json
{
  "schema": "failure-manifest-v1",
  "changeId": "deterministic-apply-verify-review-flow",
  "findings": []
}
```

This Design replan found no new Design blocker. The three implementation authority defects remain referenced by their terminal Review IDs above and are not duplicated as new findings.

## RegistryIntentV1

```json
[]
```

In centralized mode this Design phase emits no commit-ready intent and writes no shared state. No registry mutation is authorized.
