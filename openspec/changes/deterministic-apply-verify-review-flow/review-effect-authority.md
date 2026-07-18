# Independent Review: Effect-Authority Recovery Batch G1

## Immutable PhaseResult

| Field | Value |
|---|---|
| Role | `deck-developer-review` |
| Instance provenance | fresh independent scoped Review using `openai/gpt-5.6-sol`; distinct from the recorded Apply and Verify instances |
| Change ID | `deterministic-apply-verify-review-flow` |
| Authorized batch | `deterministic-apply-verify-review-flow-recovery-batch-g1-effect-authority` — T-EA-01 → T-EA-02 → T-EA-03; exact eight source/test targets only |
| Verification dependency | `verify-effect-authority.md` passed; SHA-256 `4d9e3399813c75d64375fdcd39f607e462936dae515d8b56f19438a50e55a53b` |
| Status | `request_changes` |
| Action | `stop_and_repair_replan` — this Review authorizes no modification |
| Broad Verify | **BLOCKED AND NOT SCHEDULED** — the zero-blocker precondition is false |
| G2 / repair-3 | `G2_apply` remains blocked; historical `repair-3` remains prohibited |
| Blocking findings | 3 |
| FailureManifestV1 | present below |
| Ordered RegistryIntentV1 values | `[]` |

**Verdict: REQUEST CHANGES.** The recovery remains within its exact eight-file scope, preserves the established V1 serialized key sets, and does not introduce a secret-disclosure regression. However, one narrow in-memory adversarial probe reproduced a remaining authority bypass in each of the three repaired areas. A caller can self-hash a stripped protected-risk policy and obtain a modifying effect; can self-hash fabricated attempt history and obtain attempt 2 plus effect acceptance; and can obtain convergence authority acceptance for a noncanonical initial `complete` state and for stage state whose digest disagrees with its typed evidence. These are critical related implementation regressions. Broad verification must not run.

## Immutable evidence bindings

| Binding | Digest / value |
|---|---|
| Repository HEAD | `ccf0f66e8f0fdbbd5cd6226466e34243a481beff` |
| Invocation digest | `sha256:cc3860f54c3f7dc249fe4109d1559480037f629de8efcc1fb378c518b0d0a54f` |
| Batch binding digest | `sha256:1401074d92143cadba1adee09b4d1cb371297f0d9f9bd33b673f6628e7f419d8` |
| Review dossier binding digest | `sha256:17d7b49e756eabde210a207773d7ee015f07f2b9c8a485d9d3620174f1c55713` |
| Narrow probe digest | `sha256:66a20a796eec2432fd357022a8b9853a5da82595657fa9ca1af863705ef407c5` |
| Review evidence binding digest | `sha256:ffc3ae92ab1dc82427e099a05e870cfcdfd4249a0e2203cbb73bc958d99d6633` |
| Decision digest | `sha256:226cfc3fbed3f0597117cfab534d34e5211fd003448523be5befa10689829321` |
| Spec | `sha256:374a8fb1a155830624083829aa8ccbbe609032e6a1b4c8064169372b4bfb8d7f` |
| Design | `sha256:a2873999c3a1164393d57060db2032f2cf6aa8f9ca40f46c56e6911d9319d8fe` |
| Spec replan | `sha256:14b0ed7cc890c440c8dad6fbb7909c346a46b7d6c5a5cf6a976506ce12abbfc5` |
| Design replan | `sha256:79f36722cc185be685b61a8ccf22907f3eb924e57d539c4a1e53016f3bd8430d` |
| Effect-authority Tasks replan | `sha256:1e2d51e7e559af5c7aef45723f5060dd64fa5a3c7903e10c12dc1873981837b0` |
| Prior blocker Review | `sha256:1315022a89a69be093cb729148cebabb45967cec652e7e40d6a6693bf7a3959d` |
| Effect-authority Verify | `sha256:4d9e3399813c75d64375fdcd39f607e462936dae515d8b56f19438a50e55a53b` |

The batch binding is the deterministic digest of the change ID, named batch, ordered T-EA task IDs, and the eight source/test hashes below. The dossier binding adds HEAD, invocation, Spec, Design, replans, prior Review, and passed Verify. The evidence binding adds the exact source hashes and summarized adversarial-probe result. Adaptive context was loaded as advisory only; OpenSpec, source, tests, and current worktree evidence controlled this judgment.

## Exact scope and freshness

| Path | SHA-256 |
|---|---|
| `packages/sdd-runtime/src/contracts/finding-disposition.ts` | `86a453071235dc048775a3570fcf82efdd0c815b535489b4503f321b1a1506a3` |
| `packages/sdd-runtime/src/contracts/finding-disposition.test.ts` | `f6ae7cc195d32dc83fe0578826a7df81f3355240eff3637cfa3222e201765ac7` |
| `packages/sdd-runtime/src/contracts/routing-decision.ts` | `8628a7cc175565bb77252304c11bf6254532d3779c6f9ce994d3b5fd13994175` |
| `packages/sdd-runtime/src/contracts/routing-decision.test.ts` | `234a9111e769afc2b0f53494349f1c268c7cd4b593fb3b4a07f6c8ed50431453` |
| `packages/sdd-runtime/src/contracts/blocking-repair-projection.ts` | `39d6e7e0b4cbd232cfdb5c9ac46588544d1eca86af62ae5d6d0354b8ffa28f9a` |
| `packages/sdd-runtime/src/contracts/blocking-repair-projection.test.ts` | `5f7c8171c4f58e1ac8785a9b299b3583bb09bb99fd45f3124980ea35da39ec7e` |
| `packages/sdd-runtime/src/contracts/execution-convergence.ts` | `9cc86907398f0f294128b636e2f6e83a544dac4a619fe5e567a75b0ce19181d3` |
| `packages/sdd-runtime/src/contracts/execution-convergence.test.ts` | `adaac27e59e7b232a9df3984da15b4c45f5a00d8d4ef1c47cb0b2e8c6fbf260a` |

The eight source/test hashes exactly match passed Verify, so its focused and affected-area evidence is fresh for the reviewed implementation. Worktree inspection found no tracked or staged diff, exactly these eight untracked package files, no package file outside the allowlist, no non-OpenSpec target outside the allowlist, and no `runner-capability-standardization` or `developer-team-execution-convergence` intersection. This report is the only Review write. No broad or repository-wide test was run.

## Review method and narrow probe

- Read the authoritative Spec, Design, replans, exact Tasks replan, prior blocker Review, and passed Verify.
- Reviewed tests first, then inspected all effect-authority entry points and the exact eight-file implementation.
- Assessed correctness, architecture, V1 compatibility, secret/effect safety, determinism, maintainability, and scope independently of Verify's compliance result.
- Ran one ephemeral in-memory probe; it wrote no source, test, registry, YAML, generated, or temporary repository file.

| Probe class | Observed result |
|---|---|
| B1 — protected-risk policy authority | A context carrying the exact batch Spec/Design/Tasks digests but empty data-loss policy lists was self-hashed with `computeProtectedRiskPolicySnapshotDigestV1()`. The data-loss-anchored finding remained `blocking`, routed to `targeted_repair`, and its effect validator returned `accepted: true`. |
| B2 — retry ledger source authority | A fabricated attempt-1 record used arbitrary `projectionDigest`, `convergenceRevision: 999`, and arbitrary convergence digest, then received a valid recomputed record hash. The builder produced attempt 2 and the effect validator returned `accepted: true`. |
| B3 — convergence typed replay authority | Authority parse accepted a revision-1 dossier whose initial state was already `complete`. Separately, append and authority parse accepted targeted evidence with `evidenceDigest = sha256:bbbb…` while persisted `scopedStageDigest = sha256:eeee…`, with zero underlying role-result record objects supplied. |

## Blocking findings

### REVIEW-EA-G1-B1-POLICY-SNAPSHOT-EFFECT-AUTHORITY — The protected-risk policy snapshot is self-asserted rather than batch-authoritative

- **Severity:** Critical
- **Classification:** related effect-authority recovery regression; blocking
- **Requirement/task anchors:** REQ-DAVR-FD-03, REQ-DAVR-SEC-03, REQ-DAVR-FD-01, REQ-DAVR-SEC-02, REQ-DAVR-IEV-01; T-EA-01
- **Accepted Design constraints:** `design-replan-g1.md:47-54` requires a mandatory context bound to the current approved Spec/Design/Tasks and mandatory policy sets; `design.md:57-84` requires a complete immutable authority chain and protected-risk recomputation at every authorizing boundary.
- **Locations:** `packages/sdd-runtime/src/contracts/finding-disposition.ts:237-320,508-684`; `packages/sdd-runtime/src/contracts/routing-decision.ts:487-681`; `packages/sdd-runtime/src/contracts/blocking-repair-projection.ts:483-643,727-843,850-1054`; missing stripped-policy/effect coverage in their colocated tests.
- **Root cause:** `implementation`
- **Evidence:** `policySnapshotDigest` is recomputed solely from the same caller-supplied authority object. `bindProtectedRiskAuthority()` exact-matches the batch's Spec/Design/Tasks artifact entries but has no independent expected policy-snapshot digest and does not derive the mandatory security/data-loss sets from those artifacts. A caller can therefore remove the data-loss sets, recompute the snapshot hash, and satisfy every current binding. The probe then routed the protected finding to `targeted_repair` and accepted the modifying effect.
- **Acceptance impact:** Content integrity is mistaken for policy source authority. A caller can strip mandatory data-loss policy while preserving valid hashes and exact artifact digests, defeating FD-03/SEC-03 at the modifying effect boundary.
- **Required boundary:** Bind the authority to an independently trusted expected policy-snapshot digest or derive and exact-compare the complete mandatory policy sets from batch-bound approved policy artifacts. Recompute that authority at disposition, routing, projection, parse, and effect consumption without changing established V1 serialized envelopes.

### REVIEW-EA-G1-B2-RETRY-LEDGER-SOURCE-AUTHORITY — Self-consistent fabricated attempt history authorizes retry effects

- **Severity:** Critical
- **Classification:** related effect-authority recovery regression; blocking
- **Requirement/task anchors:** REQ-DAVR-RG-05, REQ-DAVR-MD-03, REQ-DAVR-RG-01, REQ-DAVR-MD-02, REQ-DAVR-IEV-01; T-EA-02
- **Accepted Design constraints:** `design-replan-g1.md:56-64` makes the fully parsed convergence ledger and its complete attempt records the sole attempt/prior authority; `design.md:88-109` requires current ledger/head and complete attempt-record validation.
- **Locations:** `packages/sdd-runtime/src/contracts/blocking-repair-projection.ts:276-481,483-643,727-843,850-1054`; missing fabricated-but-rehashed projection/convergence-record coverage in `blocking-repair-projection.test.ts`.
- **Root cause:** `implementation`
- **Evidence:** `validateRetryAttemptAgainstLedgerV1()` recomputes each attempt-record digest and checks per-identity numbering/prior links, but it only shape-checks each record's `projectionDigest` and never resolves or validates the record's projection/convergence bindings. `RetryLedgerAuthorityV1` is not exact-bound to a parsed convergence dossier's authoritative `retryLedgerDigests`; its current revision/digest fields are caller-carried. The probe supplied a nonexistent attempt 1 with arbitrary projection and convergence references, recomputed its hash, and obtained both an attempt-2 projection and `accepted: true` at effect consumption.
- **Acceptance impact:** A caller can invent consumed retry history, advance attempt counters, and authorize an effect without an authoritative prior projection or convergence record. Retry budget, progress, identity history, and dossier-head authority remain forgeable despite valid hashes.
- **Required boundary:** Consume the fully parsed current convergence dossier/ledger as authority, exact-match its canonical retry digest list, resolve every attempt record's projection and convergence references, and validate their content-addressed bindings before attempt numbering or effect authorization. Preserve the V1 projection payload by keeping this authority additive and external.

### REVIEW-EA-G1-B3-CONVERGENCE-TYPED-REPLAY-AUTHORITY — Authority replay trusts noncanonical initial state and opaque/mismatched stage results

- **Severity:** Critical
- **Classification:** related effect-authority recovery regression; blocking
- **Requirement/task anchors:** REQ-DAVR-BV-03, REQ-DAVR-REG-03, REQ-DAVR-BV-02, REQ-DAVR-RV-01, REQ-DAVR-REG-02, REQ-DAVR-IEV-01; T-EA-03
- **Accepted Design constraints:** `design-replan-g1.md:65-73` requires replay from the canonical initial state, typed underlying evidence, and byte comparison of every computed successor; `design.md:113-137` and T-EA-03 require full stage-evidence/invalidation/role-result resolution, canonical append order, and event-derived replay.
- **Locations:** `packages/sdd-runtime/src/contracts/execution-convergence.ts:125-183,485-612,685-970`; missing canonical-initial, typed-role-result, exact-order, and evidence-to-state-digest coverage in `execution-convergence.test.ts`.
- **Root cause:** `implementation`
- **Evidence:** `parseExecutionConvergenceDossierWithAuthorityV1()` returns any structurally valid revision-1 dossier without validating the canonical initial state, so the probe's initial `complete` dossier passed with no transition. `ConvergenceAuthorityRecordSetV1` contains only stage-evidence and invalidation records, not the required underlying role-result/commit records. Replay checks digest-list membership with `includes()` rather than exact canonical positions, and `reconstructAuthorityInputFromReceipt()` copies scoped/Review/broad digests from the persisted successor instead of binding them to the resolved stage evidence. The second probe therefore accepted a persisted scoped digest different from `stageEvidence.evidenceDigest` while no underlying role-result object was supplied.
- **Acceptance impact:** A dossier can be authority-parsed as complete without a legal chain, and later stage state can attest to caller-selected opaque digests unrelated to typed evidence. Completion and registry readiness are therefore not transition- or evidence-authoritative.
- **Required boundary:** Validate the canonical revision-1 state; resolve typed underlying role-result and registry-commit records; bind each event's state digest to the resolved stage record; enforce exact append positions/order; and replay every revision from the canonical initial state before accepting completion or commit readiness. Keep established V1 dossier fields unchanged through additive record inputs.

## Classified result

| Class | Count | Findings |
|---|---:|---|
| Related regression — blocking | 3 | REVIEW-EA-G1-B1, REVIEW-EA-G1-B2, REVIEW-EA-G1-B3 |
| Unrelated baseline defect | 0 | None |
| Required Spec/Design replan | 0 | None; the authoritative requirements and accepted Design already specify the missing boundaries |
| Optional new scope | 0 | None |

## Compatibility, security, determinism, and maintainability

| Area | Result | Evidence |
|---|---|---|
| Exact scope | PASS | The implementation is confined to the exact eight-file ceiling; prohibited intersections are empty. |
| V1 serialized compatibility | PASS in reviewed scope | Established disposition, routing, repair-projection, retry-record, convergence-dossier, stage-evidence, invalidation, and receipt schema identifiers/key sets remain readable. The required corrections can remain additive; compatibility does not make structural/self-hashed evidence authoritative. |
| Secret and diagnostic safety | PASS in reviewed scope | Safe-evidence filtering and bounded deterministic rationale codes remain present; passed Verify's secret-shaped evidence check is fresh; the probe and this report contain no secret value. |
| Modifying-effect safety | **FAIL** | B1 and B2 each produce `accepted: true` from caller-constructed self-consistent but non-authoritative context. |
| Convergence/registry effect safety | **FAIL** | B3 accepts noncanonical completion and evidence/state digest mismatch. |
| Determinism | **FAIL as authority semantics** | Hashing and reason ordering are deterministic, but identical forged self-consistent carriers deterministically produce unsafe authorization. Deterministic serialization is not deterministic source authority. |
| Maintainability | **FAIL at trust boundaries** | Structural V1 readability is appropriately separated in name for repair projection, but policy, ledger, and convergence authority types still admit caller-self-authentication. The missing source-of-truth bindings are correctness/security blockers, not style nits. |

No optional findings or new-scope suggestions are raised.

## FailureManifestV1

```json
{
  "schema": "failure-manifest-v1",
  "changeId": "deterministic-apply-verify-review-flow",
  "findings": [
    {
      "findingId": "REVIEW-EA-G1-B1-POLICY-SNAPSHOT-EFFECT-AUTHORITY",
      "status": "open",
      "relationship": "batch_related",
      "rootCause": "implementation",
      "disposition": "blocking",
      "severity": "critical",
      "requirementIds": ["REQ-DAVR-FD-03", "REQ-DAVR-SEC-03", "REQ-DAVR-FD-01", "REQ-DAVR-SEC-02", "REQ-DAVR-IEV-01"],
      "taskIds": ["T-EA-01"],
      "checkIds": ["review-effect-authority-stripped-policy-effect-probe"],
      "locationKeys": [
        "packages/sdd-runtime/src/contracts/finding-disposition.ts:237-684",
        "packages/sdd-runtime/src/contracts/routing-decision.ts:487-681",
        "packages/sdd-runtime/src/contracts/blocking-repair-projection.ts:483-1054"
      ],
      "destination": "targeted_repair",
      "owner": "apply"
    },
    {
      "findingId": "REVIEW-EA-G1-B2-RETRY-LEDGER-SOURCE-AUTHORITY",
      "status": "open",
      "relationship": "batch_related",
      "rootCause": "implementation",
      "disposition": "blocking",
      "severity": "critical",
      "requirementIds": ["REQ-DAVR-RG-05", "REQ-DAVR-MD-03", "REQ-DAVR-RG-01", "REQ-DAVR-MD-02", "REQ-DAVR-IEV-01"],
      "taskIds": ["T-EA-02"],
      "checkIds": ["review-effect-authority-fabricated-ledger-effect-probe"],
      "locationKeys": [
        "packages/sdd-runtime/src/contracts/blocking-repair-projection.ts:276-1054",
        "packages/sdd-runtime/src/contracts/blocking-repair-projection.test.ts"
      ],
      "destination": "targeted_repair",
      "owner": "apply"
    },
    {
      "findingId": "REVIEW-EA-G1-B3-CONVERGENCE-TYPED-REPLAY-AUTHORITY",
      "status": "open",
      "relationship": "batch_related",
      "rootCause": "implementation",
      "disposition": "blocking",
      "severity": "critical",
      "requirementIds": ["REQ-DAVR-BV-03", "REQ-DAVR-REG-03", "REQ-DAVR-BV-02", "REQ-DAVR-RV-01", "REQ-DAVR-REG-02", "REQ-DAVR-IEV-01"],
      "taskIds": ["T-EA-03"],
      "checkIds": ["review-effect-authority-canonical-initial-and-typed-result-probe"],
      "locationKeys": [
        "packages/sdd-runtime/src/contracts/execution-convergence.ts:125-970",
        "packages/sdd-runtime/src/contracts/execution-convergence.test.ts"
      ],
      "destination": "targeted_repair",
      "owner": "apply"
    }
  ]
}
```

These destinations classify related implementation defects under the dispatch policy; they are not modifying authorization. The coordinator must validate any next batch and obtain the required explicit authorization before Apply.

## Ordered RegistryIntentV1 values

```json
[]
```

No pass or broad-verification scheduling intent is emitted because Review has blockers. The coordinator remains the sole registry writer.

## Explicit blockers and exact next action

Explicit blockers: `REVIEW-EA-G1-B1-POLICY-SNAPSHOT-EFFECT-AUTHORITY`, `REVIEW-EA-G1-B2-RETRY-LEDGER-SOURCE-AUTHORITY`, and `REVIEW-EA-G1-B3-CONVERGENCE-TYPED-REPLAY-AUTHORITY`.

**Exact next action:** keep `broad_verify`, `G2_apply`, registry commitment, and all modifying effects blocked. The coordinator may classify and propose a new bounded repair through the normal OpenSpec authorization path; this Review authorizes no edit. After any authorized repair, require fresh targeted and affected-area Verify followed by a fresh independent Review. Schedule broad verification only if that later Review reports zero blockers.
