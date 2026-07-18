# Independent Review Recovery G1: Deterministic Apply → Verify → Review Flow

## Immutable PhaseResult

| Field | Value |
|---|---|
| Role | `review` |
| Instance provenance | fresh independent Review instance for recovery G1; distinct from the recorded Apply and Verify instances |
| Change ID | `deterministic-apply-verify-review-flow` |
| Authorized batch | `deterministic-apply-verify-review-flow-recovery-batch-g1` — T-REC-01 → T-REC-02 → T-REC-03 → T-REC-04; exact eight source/test targets only |
| Verification dependency | `verify-recovery-g1.md` passed; digest bound below |
| Status | `request_changes` |
| Action | `human_approval_required` before any new bounded `targeted_repair`; this Review authorizes no modification |
| Next stage | coordinator classification and, only after explicit authorization, bounded repair followed by fresh scoped Verify and fresh independent Review |
| Broad Verify | **BLOCKED** — it may be scheduled only after a fresh Review reports zero blockers |
| G2 / repair-3 | `G2_apply` remains blocked; the prohibited historical `repair-3` is not reopened |
| Blockers | 3 |
| FailureManifestV1 | present below |
| Ordered RegistryIntentV1 values | `[]` |

**Verdict: REQUEST CHANGES.** Zero blockers is not warranted. The exact eight-file recovery implementation preserves the reviewed V1 serialized shapes, remains within scope, and retains the existing safe-evidence filtering, but fresh adversarial Review reproduced three critical authority bypasses. A policy-protected data-loss finding can reach and pass the modifying effect boundary when the mandatory authority context is omitted; a validly rehashed repair projection with a replaced retry identity can pass both structural parse and effect validation when optional authority inputs are omitted; and an arbitrary `complete` convergence revision can pass the authority parser under a self-consistent receipt without legal transition replay. These defects violate all three paired recovery authority floors. Broad verification and G2 must not begin.

## Immutable evidence bindings

| Binding | Digest / value |
|---|---|
| Repository HEAD | `ccf0f66e8f0fdbbd5cd6226466e34243a481beff` |
| Invocation digest | `sha256:a6ca330dc74391eac85721edf180676a04273b31df4591dc6415c7b01ebd8a44` |
| Recovery-batch binding digest | `sha256:3a27171486ae48a7491aa7213eaff195c05a4a093f2d637ff34ed56a5e027c99` |
| Review dossier binding digest | `sha256:3591982a6c9c146253e4707e0009f0c550ebd4aa86bfeed6a7f23ad81b9c9cff` |
| Review evidence binding digest | `sha256:0f9f3dacaec781315d92a246cc034e93e31b370c572d71c4142713147cb8eaaa` |
| Decision digest | `sha256:7c746edef1bc2a70665c37e1c62efc874dc50be88bcd4aed3e7c1970ce2cb26f` |
| Spec | `sha256:374a8fb1a155830624083829aa8ccbbe609032e6a1b4c8064169372b4bfb8d7f` |
| Design | `sha256:a2873999c3a1164393d57060db2032f2cf6aa8f9ca40f46c56e6911d9319d8fe` |
| Tasks | `sha256:a113d334a9b6aec8d64e043dc5b22531479014bc47027dec17175fb0c881fa5c` |
| Recovery Tasks | `sha256:96832a1c631669ef569b44d12764a2813173fab215b97c12be5002568c344d4a` |
| Preconditions | `sha256:81cbd0225bf757596a9f6bdb5eda460be910b12fe3019548bf2d402ec8b2e513` |
| Recovery Apply result | `sha256:61c14c7fe4e05e7ca0d71104bdc5f692b194e7e7590283e16bf781fcc88c95fa` |
| Recovery Verify result | `sha256:9ce05879a854f6a206cf5ddf5892b52c81fdcc01711d14efb4f12c9397552806` |

The batch binding is the deterministic digest of the change ID, named recovery batch, ordered T-REC task IDs, and the eight reviewed source/test hashes. The dossier binding adds HEAD and the authoritative Spec/Design/Tasks, preconditions, Apply, and Verify hashes. The evidence binding adds the exact reviewed scope and the narrow probe outcomes. Adaptive context was loaded as advisory only; OpenSpec artifacts, current source/tests, and repository evidence controlled this judgment.

## Review scope and method

- Read the revised `spec.md`, `design.md`, `tasks.md`, `tasks-replan-g1.md`, `preconditions.md`, `apply-progress.md`, and passed `verify-recovery-g1.md`.
- Inspected the exact eight recovery G1 source/test targets against REQ-DAVR-FD-03, SEC-03, RG-05, MD-03, BV-03, and REG-03.
- Reassessed V1 serialized compatibility, secret/evidence handling, effect authorization, transition replay, maintainability, and worktree scope.
- Ran one narrow in-memory adversarial probe containing three independent reproductions. No broad or repository-wide test suite was run, and this Review does not duplicate Verify's compliance matrix.
- Modified no source, test, generated output, registry YAML, `state.yaml`, `events.yaml`, other OpenSpec change, or `runner-capability-standardization`. This report is the only repository write by this Review.

### Reviewed source/test bindings

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

### Narrow adversarial probe outcomes

| Probe observation | Result |
|---|---|
| Proper mandatory policy authority classifies the probe finding | `data_loss` |
| Omitting that authority from disposition/routing | route became `targeted_repair` |
| Effect validation with the mandatory protected-risk context absent | `accepted: true` |
| Validly rehashed replacement retry identity, structural parse without authority | accepted |
| Same forged retry identity, effect validation without optional policy/ledger authority | `accepted: true` |
| `awaiting_apply_result` → arbitrary persisted `complete` revision plus self-consistent `registry_committed` receipt, authority parse | accepted as `complete` |

## Blocking findings

### REVIEW-REC-G1-B1 — Protected-risk policy and effect authority remain optional and caller-omittable

- **Severity:** Critical
- **Classification:** related recovery-batch regression; blocking
- **Requirement/task anchors:** REQ-DAVR-FD-03, REQ-DAVR-SEC-03, REQ-DAVR-FD-01, REQ-DAVR-SEC-02, REQ-DAVR-IEV-01; T-REC-01, T-REC-02, T-REC-03
- **Accepted Design constraints:** `design.md:57-64` requires the complete immutable authority chain and fail-closed missing artifacts; `design.md:68-84` requires the same mandatory context at disposition, routing, repair projection, and effect boundaries.
- **Locations:** `packages/sdd-runtime/src/contracts/finding-disposition.ts:223-277,283-325,461-532,534-613`; `packages/sdd-runtime/src/contracts/routing-decision.ts:487-586,588-689`; `packages/sdd-runtime/src/contracts/blocking-repair-projection.ts:430-576,711-870`; missing end-to-end omission/effect coverage in the three corresponding test files.
- **Root cause:** `implementation`
- **Evidence:** `ProtectedRiskAuthorityContextV1` is optional in the disposition/routing paths, and `BlockingRepairProjectionInputV1` plus the effect validator carry no protected-risk authority at all. `bindProtectedRiskAuthority()` compares only artifact entries supplied by the caller, so an empty or incomplete artifact map is accepted even when the batch binds Spec/Design/Tasks; the policy snapshot digest is only shape-checked. The narrow probe established that the same finding is `data_loss` with the mandatory policy context, but omission produced `targeted_repair`, and the effect validator returned `accepted: true`.
- **Acceptance impact:** A caller can remove mandatory data-loss/security policy authority before classification or effect consumption and obtain modifying Apply authorization. This directly defeats the additive fail-closed authority chain and the protected-risk dominance required at every decision/effect boundary.
- **Required boundary:** Make the authority-bound disposition/routing/projection/effect APIs require the complete context, exact-match the required Spec/Design/Tasks digest set and policy snapshot, and independently rederive protected risk at the effect boundary. Historical structural readers may remain readable, but their outputs must be type/API-separated from authorizing consumption.

### REVIEW-REC-G1-B2 — Retry identity and ledger authority can still be bypassed at parse and effect boundaries

- **Severity:** Critical
- **Classification:** related recovery-batch regression; blocking
- **Requirement/task anchors:** REQ-DAVR-RG-05, REQ-DAVR-MD-03, REQ-DAVR-RG-01, REQ-DAVR-MD-02, REQ-DAVR-IEV-01; T-REC-03
- **Accepted Design constraints:** `design.md:88-109` requires one authority-derived identity, mandatory equality recomputation at parse/effect boundaries, and the current fully validated ledger/head.
- **Locations:** `packages/sdd-runtime/src/contracts/blocking-repair-projection.ts:303-428,430-576,578-704,711-870`; missing omission, coherent-carrier forgery, and malformed-ledger authority coverage in `blocking-repair-projection.test.ts`.
- **Root cause:** `implementation`
- **Evidence:** `parseBlockingRepairProjectionV1()` makes `identityAuthority` optional; without it, only digest shape/integrity is checked. Even with it, identity inputs such as targets and anchors are taken from the carried projection rather than first rederived from manifest/disposition. The effect validator makes both `routingPolicyVersion` and `retryLedger` optional and silently skips identity/ledger enforcement when absent. Its initial parse also deliberately uses the structural path without authority. The narrow probe replaced `retryIdentity`, validly rehashed the projection, and both structural parse and effect validation accepted it. In addition, `validateRetryAttemptAgainstLedgerV1()` does not recompute attempt-record digests or validate uniqueness and the records' own prior/projection/convergence bindings as required by the accepted Design.
- **Acceptance impact:** A modifying effect can cross under a caller-selected retry identity and detached attempt history. Attempts, progress, terminal budget, and scope identity are therefore not authoritative despite content-addressed serialization.
- **Required boundary:** Require the complete authority projection and fully parsed current ledger at both authorizing boundaries; derive targets/anchors/owner/oracles/checks from batch+manifest+disposition+routing rather than carried fields; recompute every attempt record and validate uniqueness, contiguous prior links, projection binding, and dossier head before effect authorization.

### REVIEW-REC-G1-B3 — The authority parser does not replay typed convergence transitions

- **Severity:** Critical
- **Classification:** related recovery-batch regression; blocking
- **Requirement/task anchors:** REQ-DAVR-BV-03, REQ-DAVR-REG-03, REQ-DAVR-BV-02, REQ-DAVR-RV-01, REQ-DAVR-REG-02, REQ-DAVR-IEV-01; T-REC-04
- **Accepted Design constraints:** `design.md:113-137` requires full typed-record resolution, canonical digest-list binding, stage/dependency/subject validation, and event-derived replay from every predecessor before completion or commit readiness is trusted.
- **Locations:** `packages/sdd-runtime/src/contracts/execution-convergence.ts:482-667,670-794,896-947`; missing forged-receipt/full-replay coverage in `execution-convergence.test.ts`.
- **Root cause:** `implementation`
- **Evidence:** `parseExecutionConvergenceDossierWithAuthorityV1()` receives only transition receipts. It does not receive or resolve stage-evidence/invalidation/role-result records, verify receipt content hashes and canonical list positions, invoke the state transition function, or compare a replayed successor with persisted state. It only checks predecessor coordinates and that each receipt's caller-provided `nextStateDigest` equals the persisted state's digest. The separate transition helper tests legal transitions, but they do not prove persisted replay. The narrow probe used the legacy structural append to jump from `awaiting_apply_result` directly to `complete`, built a self-consistent `registry_committed` receipt, and the authority parser accepted `complete`. Independently, `expectedDependencySetDigest` is optional/caller-supplied rather than recomputed from stage authority, and invalidation predecessor/dependency/digest-list bindings are not consumed by the transition function.
- **Acceptance impact:** Content-addressed receipts attest to caller assertions, not legal transitions. Scoped Verify, Review, broad Verify, dependency invalidation, and registry commit authority can be skipped while a persisted dossier is accepted as complete.
- **Required boundary:** Resolve and validate every referenced typed record, enforce canonical append order, recompute record and receipt hashes, derive stage dependencies from current authority, and replay each predecessor/event through the authority transition function before accepting any persisted revision or commit-ready/complete state.

## Classified review result

| Class | Count | Findings |
|---|---:|---|
| Related regression — blocking | 3 | REVIEW-REC-G1-B1, REVIEW-REC-G1-B2, REVIEW-REC-G1-B3 |
| Unrelated baseline defect | 0 | None |
| Required Spec/Design replan | 0 | None; the revised Spec and accepted Design already require the missing boundaries |
| Optional new scope | 0 | None |

## Compatibility, security, scope, and maintainability

| Area | Result | Evidence |
|---|---|---|
| Six recovery authority requirements | **FAIL** | B1 blocks FD-03/SEC-03, B2 blocks RG-05/MD-03, and B3 blocks BV-03/REG-03. |
| V1 serialized compatibility | PASS in reviewed scope | Established V1 key sets remain unchanged; authority types are additive, and blocked foundational V1 contracts were not modified. This compatibility success does not make structural-only output authorizing. |
| Secret and diagnostic safety | PASS in reviewed scope | Causal evidence still passes through unsafe-content rejection, bounded redaction, and repository-path normalization. Rejection surfaces use stable reason codes; no literal secret was emitted by this Review. |
| Prior target/evidence derivation safety | PASS for the prior reported cases | Exact selected-finding target, anchor, check, obligation, and causal-evidence derivation remains present at the effect validator. |
| Other effect authority | **FAIL** | B1 and B2 reproduce modifying-effect acceptance without mandatory protected-risk and retry/ledger authority. |
| Scope | PASS | Before this report, the only non-OpenSpec untracked files were the exact eight authorized source/test targets; no tracked diff, generated output, registry YAML, other OpenSpec change, or `runner-capability-standardization` target was present. This report is change-local and explicitly authorized. |
| Maintainability | BLOCKED by correctness boundaries | Optional authority parameters and split structural/authorizing semantics on the same APIs create unsafe default call paths; this is included in B1-B3, not raised as optional style work. No new dependency was added. |

## Optional notes

None. No optional new scope is proposed. Repair must remain confined to an explicitly authorized allowlist; this Review does not authorize edits to the current eight files or any broader target.

## FailureManifestV1

```json
{
  "schema": "failure-manifest-v1",
  "changeId": "deterministic-apply-verify-review-flow",
  "findings": [
    {
      "findingId": "REVIEW-REC-G1-B1-PROTECTED-RISK-EFFECT-AUTHORITY",
      "status": "open",
      "relationship": "batch_related",
      "rootCause": "implementation",
      "disposition": "blocking",
      "severity": "critical",
      "requirementIds": ["REQ-DAVR-FD-03", "REQ-DAVR-SEC-03", "REQ-DAVR-FD-01", "REQ-DAVR-SEC-02", "REQ-DAVR-IEV-01"],
      "taskIds": ["T-REC-01", "T-REC-02", "T-REC-03"],
      "checkIds": ["review-recovery-g1-protected-risk-effect-authority-probe"],
      "locationKeys": [
        "packages/sdd-runtime/src/contracts/finding-disposition.ts:223-613",
        "packages/sdd-runtime/src/contracts/routing-decision.ts:487-689",
        "packages/sdd-runtime/src/contracts/blocking-repair-projection.ts:430-870",
        "packages/sdd-runtime/src/contracts/finding-disposition.test.ts",
        "packages/sdd-runtime/src/contracts/routing-decision.test.ts",
        "packages/sdd-runtime/src/contracts/blocking-repair-projection.test.ts"
      ],
      "destination": "targeted_repair",
      "owner": "apply"
    },
    {
      "findingId": "REVIEW-REC-G1-B2-RETRY-IDENTITY-EFFECT-AUTHORITY",
      "status": "open",
      "relationship": "batch_related",
      "rootCause": "implementation",
      "disposition": "blocking",
      "severity": "critical",
      "requirementIds": ["REQ-DAVR-RG-05", "REQ-DAVR-MD-03", "REQ-DAVR-RG-01", "REQ-DAVR-MD-02", "REQ-DAVR-IEV-01"],
      "taskIds": ["T-REC-03"],
      "checkIds": ["review-recovery-g1-forged-retry-identity-effect-probe"],
      "locationKeys": [
        "packages/sdd-runtime/src/contracts/blocking-repair-projection.ts:303-870",
        "packages/sdd-runtime/src/contracts/blocking-repair-projection.test.ts"
      ],
      "destination": "targeted_repair",
      "owner": "apply"
    },
    {
      "findingId": "REVIEW-REC-G1-B3-CONVERGENCE-REPLAY-AUTHORITY",
      "status": "open",
      "relationship": "batch_related",
      "rootCause": "implementation",
      "disposition": "blocking",
      "severity": "critical",
      "requirementIds": ["REQ-DAVR-BV-03", "REQ-DAVR-REG-03", "REQ-DAVR-BV-02", "REQ-DAVR-RV-01", "REQ-DAVR-REG-02", "REQ-DAVR-IEV-01"],
      "taskIds": ["T-REC-04"],
      "checkIds": ["review-recovery-g1-arbitrary-complete-authority-parse-probe"],
      "locationKeys": [
        "packages/sdd-runtime/src/contracts/execution-convergence.ts:482-794",
        "packages/sdd-runtime/src/contracts/execution-convergence.ts:896-947",
        "packages/sdd-runtime/src/contracts/execution-convergence.test.ts"
      ],
      "destination": "targeted_repair",
      "owner": "apply"
    }
  ]
}
```

The manifest destinations classify the implementation defects under the recovery dispatch policy; they are not modifying authorization. A coordinator must validate scope and obtain a new explicit authorization before issuing any repair batch.

## Ordered RegistryIntentV1 values

```json
[]
```

## Explicit blockers and exact next action

Explicit blockers: `REVIEW-REC-G1-B1-PROTECTED-RISK-EFFECT-AUTHORITY`, `REVIEW-REC-G1-B2-RETRY-IDENTITY-EFFECT-AUTHORITY`, and `REVIEW-REC-G1-B3-CONVERGENCE-REPLAY-AUTHORITY`.

**Exact next action:** the coordinator must keep `broad_verify` and `G2_apply` blocked, emit no registry commit, and request explicit authorization for any newly bounded repair of these three implementation defects. After an authorized repair, run fresh targeted + affected-area Verify and a fresh independent Review. Schedule `broad_verify` only if that Review reports zero blockers. This Review does not authorize source/test modification, historical `repair-3`, registry mutation, or scope expansion.
