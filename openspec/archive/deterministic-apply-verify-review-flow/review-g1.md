# Independent Review G1: Deterministic Apply → Verify → Review Flow

## Immutable PhaseResult

| Field | Value |
|---|---|
| Role | `review` |
| Instance provenance | fresh independent Review instance; distinct from the recorded Apply and Verify instances |
| Change ID | `deterministic-apply-verify-review-flow` |
| Authorized batch | G1 — T-01, T-02, T-03, T-04 |
| Status | `request_changes` |
| Action | `targeted_repair` after coordinator authorization; then fresh targeted + affected-area Verify and fresh independent Review |
| Next stage | G1 repair; `G2_apply` is blocked |
| Blockers | 5 |
| FailureManifestV1 | present below |
| RegistryIntentV1 | `[]` |

**Verdict: REQUEST CHANGES.** Fresh Verify evidence is acknowledged, but independent adversarial Review reproduced five requirement-anchored engineering defects. The new contracts can downgrade a mandatory blocker, accept a routing decision that declares completion with an active blocker, route unanchored findings as Apply-owned repair, admit non-derived repair evidence, and reach completion after repair while retaining stale scoped/Review/broad digests. These defects affect authorization and effect-boundary safety; G2 must not begin.

## Immutable evidence bindings

| Binding | Digest / value |
|---|---|
| Repository HEAD | `ccf0f66e8f0fdbbd5cd6226466e34243a481beff` |
| Invocation digest | `sha256:c40cacd347c6a14423a099cab9d48527de255a9a6c604752b63a8466a5b0810b` |
| G1 batch binding digest | `sha256:623a2c3a092e7f68506278be1dd34e0902f76c38721bd4dc11a59a890bb0ee76` |
| Apply dossier (`apply-progress.md`) | `sha256:7da7caed49ed3565fef229e18ca2891854ce9d7ffd2be1867b77ac68989d9d0c` |
| Prior Verify/repair decision binding | `sha256:231d41983a59bf81140383e19a82cb85da90716084c4ecb8f37f8df17b86b3c7` |
| Fresh verification (`verify-g1-repair-1.md`) | `sha256:844d337c6b3a21d796e7deb4fbfbc1e228c42e44fb818d39bd8224e0cc10a97a` |
| Review evidence digest | `sha256:584861c5b1589798826b355e0c73c222dd4dc06374ec614c16a59e44eb01993d` |
| Spec | `sha256:55b388b463dcc37c4ee59f3018a4714025de980001ff44fabe859b8e2df500b3` |
| Design | `sha256:4b61d78ab9d698744946b329e43367383fe0184dc218d270e541b408d6657207` |
| Tasks | `sha256:e5b718f6883e60f43b46e0892118fafedb01271cf90c4e3f861d925bfb3e6510` |
| Repair incident | `sha256:223c1c199950a47071ec4eacb7b964321309095a3417cc2822d500b2f61c9609` |

The G1 batch binding digest is the deterministic digest of change ID, group, ordered task IDs, and the eight reviewed source/test content hashes; no separate issued `ApplyBatchContractV1` artifact was supplied to Review. The prior decision binding deterministically combines `verify-g1.md` and `repair-incident.md`.

Adaptive context was loaded as advisory only. OpenSpec artifacts, source, tests, and fresh repository evidence controlled this judgment.

## Review scope and method

- Read `spec.md`, `design.md`, `tasks.md`, `apply-progress.md`, `verify-g1.md`, `verify-g1-repair-1.md`, and `repair-incident.md`.
- Inspected all eight G1 source/test targets and their content hashes.
- Ran only narrow, in-memory adversarial contract probes. No broad/repository-wide verification was run.
- Did not modify source, tests, generated files, `state.yaml`, or `events.yaml`.
- Current source/test scope remains the eight authorized G1 files; no generated output, V1 contract, other OpenSpec change, or `runner-capability-standardization` target was reviewed as modified G1 work.

## Blocking findings

### REVIEW-G1-B1 — A self-rehashed disposition envelope can downgrade a mandatory open blocker

- **Severity:** Critical
- **Classification:** related regression; blocking
- **Requirement/task anchors:** REQ-DAVR-FD-01, REQ-DAVR-BA-01, REQ-DAVR-IEV-01; T-01
- **Location:** `packages/sdd-runtime/src/contracts/finding-disposition.ts:247-269,316-369`; missing adversarial coverage in `finding-disposition.test.ts:174-217`
- **Root cause:** `implementation`
- **Destination / owner:** `targeted_repair` / `apply-backend`
- **Evidence:** `parseFindingDispositionEnvelopeV1()` verifies keys, finding-set membership, and self-computed digests, but it does not recompute or validate the disposition and reason code from authoritative classification policy. A narrow probe changed a mandatory open finding from `blocking` to `recommendation`, changed its reason code, recomputed the semantic/full digests and ID, and the parser accepted it (`dispositionDowngradeAccepted: true`).
- **Acceptance impact:** The parsed envelope no longer contributes that finding to the active blocking set. A content-addressed value is not independent classification authority; this permits a mandatory blocker to become non-authorizing and contradicts the fail-safe classification and invalid-evidence requirements.
- **Required repair boundary:** Bind parsing/consumption to authoritative classification inputs and reject any disposition/reason/reference/anchor projection that is not the deterministic recomputation. Add the validly rehashed downgrade regression test within T-01's allowlist.

### REVIEW-G1-B2 — A self-rehashed routing decision can declare completion while an active blocker exists

- **Severity:** Critical
- **Classification:** related regression; blocking
- **Requirement/task anchors:** REQ-DAVR-RD-01, REQ-DAVR-DT-01, REQ-DAVR-DT-02, REQ-DAVR-IEV-01; T-02
- **Location:** `packages/sdd-runtime/src/contracts/routing-decision.ts:299-365,429-493`; missing adversarial coverage in `routing-decision.test.ts:197-233`
- **Root cause:** `implementation`
- **Destination / owner:** `targeted_repair` / `apply-backend`
- **Evidence:** `parseRoutingDecisionV1()` checks the supplied active-set digest but does not require one route per active blocker, bind route root cause to the manifest, recompute routes from policy, or recompute the outcome/rationale from routes. A narrow probe removed every route from a decision with one active blocker, set `outcome: "complete"`, recomputed all content digests/ID, and the parser accepted it (`routingCompleteAccepted: true`).
- **Acceptance impact:** Malformed but self-consistent evidence can bypass total routing and stop repair/escalation by claiming no active blockers. This is a fail-open decision boundary, not merely a serialization issue.
- **Required repair boundary:** Recompute and compare the complete ordered route set, per-route root cause/destination/owner/rationales, and aggregate outcome/rationales from the authoritative manifest, disposition, and policy. Add an exact active-blocker-to-empty-completion rejection test within T-02's allowlist.

### REVIEW-G1-B3 — Routing authorization is batch-global rather than finding-specific

- **Severity:** High
- **Classification:** related regression; blocking
- **Requirement/task anchors:** REQ-DAVR-BA-01, REQ-DAVR-BA-02, REQ-DAVR-RD-01, REQ-DAVR-RD-02; T-02
- **Location:** `packages/sdd-runtime/src/contracts/routing-decision.ts:54-67,218-297,367-397`; missing mixed-anchor coverage in `routing-decision.test.ts:167-189`
- **Root cause:** `implementation`
- **Destination / owner:** `targeted_repair` / `apply-backend`
- **Evidence:** `fullyAnchored`, `scopeValid`, `protectedRisk`, `dataLossRisk`, and `diagnosableRuntime` are single decision-wide booleans applied to every active finding. A narrow two-finding probe used one anchored and one unanchored implementation blocker with `fullyAnchored: true`; both routes were emitted as `targeted_repair` instead of routing the unanchored finding to `replan_tasks` (`mixedAnchorDestinations: ["targeted_repair", "targeted_repair"]`).
- **Acceptance impact:** The decision does not implement the Design's per-blocker routing function and can emit Apply authorization for a finding that fails BA's anchor floor. T-03 may reject some resulting projections, but a later boundary rejection does not make the authoritative route correct or reproducible.
- **Required repair boundary:** Represent and derive protected-risk, anchor, scope, and diagnostic inputs per finding (while retaining true global safety overrides), then compute mixed-owner outcomes from those per-finding routes. Add mixed anchored/unanchored and mixed protected-risk cases.

### REVIEW-G1-B4 — Repair authority derivation omits causal-evidence membership and valid line-qualified target locations

- **Severity:** Critical
- **Classification:** related regression; blocking
- **Requirement/task anchors:** REQ-DAVR-MD-01, REQ-DAVR-MD-02, REQ-DAVR-BA-02, REQ-DAVR-CS-02, REQ-DAVR-SEC-01; T-03
- **Location:** `packages/sdd-runtime/src/contracts/blocking-repair-projection.ts:110-173,175-196,293-297,418-533`; missing cases in `blocking-repair-projection.test.ts:108-269`
- **Root cause:** `implementation`
- **Destination / owner:** `targeted_repair` / `apply-backend`
- **Evidence:**
  1. The builder accepts caller-supplied causal evidence when only its `checkId` matches; the artifact/reference need not occur in the selected finding. A probe built a projection containing `unrelated-safe-artifact.log` although the finding referenced `authoritative.log` (`acceptedByBuilder: true`).
  2. The effect boundary recomputes anchors/checks/targets/obligations but never recomputes causal evidence. A validly rehashed projection with an additional `foreign-check` / `foreign-safe-artifact.log` evidence reference was accepted (`effectBoundaryAccepted: true`).
  3. Target derivation drops any non-Windows location key containing `:`. A normal repository location with a line range, `blocking-repair-projection.ts:12-13`, failed projection construction with `invalid-evidence: no-allowed-targets`, even though its underlying file is batch-allowed. The prior Verify finding itself used line-qualified locations.
- **Acceptance impact:** The repair dossier is neither minimal nor exactly derivable from selected blockers, and valid anchored evidence can also become unrepairable. Arbitrary safe-looking diagnostic references cross the effect boundary without blocker authority; safe-content filtering does not establish causal authorization.
- **Required repair boundary:** Derive and compare complete canonical causal evidence references against selected finding evidence at both builder and effect boundary, and normalize supported line-qualified location syntax to its repository path before allowlist comparison. Add validly rehashed foreign-evidence, same-check/different-artifact, and line/range location tests.

### REVIEW-G1-B5 — The convergence state reaches completion using stale pre-repair evidence

- **Severity:** Critical
- **Classification:** related regression; blocking
- **Requirement/task anchors:** REQ-DAVR-BV-02, REQ-DAVR-RV-01, REQ-DAVR-RV-02, REQ-DAVR-REG-02, REQ-DAVR-IEV-01; T-04
- **Location:** `packages/sdd-runtime/src/contracts/execution-convergence.ts:221-251,257-303`; test oracle at `execution-convergence.test.ts:143-167,241-256`
- **Root cause:** `implementation`
- **Destination / owner:** `targeted_repair` / `apply-backend`
- **Evidence:** Optional evidence digests default to their prior state values whenever a transition omits replacements. `repair_effect_succeeded` increments generation but does not clear scoped, Review, or broad digests. The state machine also accepts `targeted_accepted_no_blockers`, `affected_accepted_no_blockers`, `review_stable`, and `broad_accepted` without the corresponding current digest. A narrow probe started in `repair_pending` with three old evidence digests, performed a repair, supplied no new evidence digests, and reached `complete` at generation 2 while all three old digests remained (`scopedRetained`, `reviewRetained`, and `broadRetained` were all `true`).
- **Acceptance impact:** A modifying repair does not invalidate prior evidence and completion does not require current scoped/Review/broad proof. This directly defeats the final broad and commit-readiness safety gates.
- **Required repair boundary:** Clear or explicitly mark prior evidence stale on every modifying transition; require stage-appropriate current-generation evidence and zero active blockers at each accepting transition; forbid registry completion without current evidence/intent bindings. Replace the digest-free happy-path oracle with positive and adversarial freshness cases.

## Test adequacy and engineering quality

The 35 passing G1 tests and affected contract-suite pass do not cover the trust-boundary cases above. Existing parser tests mostly parse values emitted by the corresponding builder; they do not test validly rehashed semantic forgeries. The projection suite covers target derivation after the prior repair but not evidence derivation. The convergence happy path advances without any stage evidence digest, encoding the stale-evidence defect as accepted behavior. These are blocking omissions because each omitted case reproduces a MUST-level authorization, invalid-evidence, or freshness violation.

No additive V1 compatibility regression was found in the reviewed diff: the four G1 implementations are new modules and the blocked V1 source files were not modified. That compatibility observation does not offset the fail-open new-contract boundaries.

Secret-shaped excerpt rejection remains present and rejection results use stable codes rather than returning raw diagnostic content. The blocker in REVIEW-G1-B4 is authority/minimality: safe-looking but non-derived evidence is accepted. No literal secret was written or emitted by Review.

## Scope classification

| Item | Classification | Authorization effect |
|---|---|---|
| REVIEW-G1-B1..B5 | Related G1 implementation regressions | Blocking; coordinator may route only an authorized blocking-only G1 repair |
| Broad/repository-wide verification | Deferred by stage delegation | Not run; no broad claim |
| G2 implementation | Dependent scope | Blocked; not authorized by this Review |
| Optional new scope | None identified | None |

## Recommendations

None. This report contains no optional suggestion and grants no authority beyond coordinator-issued repair work derived from the five blocking findings.

## FailureManifestV1

```json
{
  "schema": "failure-manifest-v1",
  "changeId": "deterministic-apply-verify-review-flow",
  "findings": [
    {
      "findingId": "REVIEW-G1-B1-DISPOSITION-DOWNGRADE",
      "status": "open",
      "relationship": "batch_related",
      "rootCause": "implementation",
      "disposition": "blocking",
      "severity": "critical",
      "requirementIds": ["REQ-DAVR-FD-01", "REQ-DAVR-BA-01", "REQ-DAVR-IEV-01"],
      "taskIds": ["T-01"],
      "checkIds": ["review-g1-disposition-rehash-probe"],
      "locationKeys": [
        "packages/sdd-runtime/src/contracts/finding-disposition.ts:247-269",
        "packages/sdd-runtime/src/contracts/finding-disposition.ts:316-369",
        "packages/sdd-runtime/src/contracts/finding-disposition.test.ts:174-217"
      ],
      "destination": "targeted_repair",
      "owner": "apply-backend"
    },
    {
      "findingId": "REVIEW-G1-B2-ROUTING-FALSE-COMPLETE",
      "status": "open",
      "relationship": "batch_related",
      "rootCause": "implementation",
      "disposition": "blocking",
      "severity": "critical",
      "requirementIds": ["REQ-DAVR-RD-01", "REQ-DAVR-DT-01", "REQ-DAVR-DT-02", "REQ-DAVR-IEV-01"],
      "taskIds": ["T-02"],
      "checkIds": ["review-g1-routing-rehash-probe"],
      "locationKeys": [
        "packages/sdd-runtime/src/contracts/routing-decision.ts:299-365",
        "packages/sdd-runtime/src/contracts/routing-decision.ts:429-493",
        "packages/sdd-runtime/src/contracts/routing-decision.test.ts:197-233"
      ],
      "destination": "targeted_repair",
      "owner": "apply-backend"
    },
    {
      "findingId": "REVIEW-G1-B3-GLOBAL-ROUTING-AUTHORITY",
      "status": "open",
      "relationship": "batch_related",
      "rootCause": "implementation",
      "disposition": "blocking",
      "severity": "high",
      "requirementIds": ["REQ-DAVR-BA-01", "REQ-DAVR-BA-02", "REQ-DAVR-RD-01", "REQ-DAVR-RD-02"],
      "taskIds": ["T-02"],
      "checkIds": ["review-g1-mixed-anchor-routing-probe"],
      "locationKeys": [
        "packages/sdd-runtime/src/contracts/routing-decision.ts:54-67",
        "packages/sdd-runtime/src/contracts/routing-decision.ts:218-297",
        "packages/sdd-runtime/src/contracts/routing-decision.ts:367-397",
        "packages/sdd-runtime/src/contracts/routing-decision.test.ts:167-189"
      ],
      "destination": "targeted_repair",
      "owner": "apply-backend"
    },
    {
      "findingId": "REVIEW-G1-B4-INCOMPLETE-REPAIR-DERIVATION",
      "status": "open",
      "relationship": "batch_related",
      "rootCause": "implementation",
      "disposition": "blocking",
      "severity": "critical",
      "requirementIds": ["REQ-DAVR-MD-01", "REQ-DAVR-MD-02", "REQ-DAVR-BA-02", "REQ-DAVR-CS-02", "REQ-DAVR-SEC-01"],
      "taskIds": ["T-03"],
      "checkIds": [
        "review-g1-causal-evidence-derivation-probe",
        "review-g1-line-location-derivation-probe"
      ],
      "locationKeys": [
        "packages/sdd-runtime/src/contracts/blocking-repair-projection.ts:110-196",
        "packages/sdd-runtime/src/contracts/blocking-repair-projection.ts:293-297",
        "packages/sdd-runtime/src/contracts/blocking-repair-projection.ts:418-533",
        "packages/sdd-runtime/src/contracts/blocking-repair-projection.test.ts:108-269"
      ],
      "destination": "targeted_repair",
      "owner": "apply-backend"
    },
    {
      "findingId": "REVIEW-G1-B5-STALE-EVIDENCE-COMPLETION",
      "status": "open",
      "relationship": "batch_related",
      "rootCause": "implementation",
      "disposition": "blocking",
      "severity": "critical",
      "requirementIds": ["REQ-DAVR-BV-02", "REQ-DAVR-RV-01", "REQ-DAVR-RV-02", "REQ-DAVR-REG-02", "REQ-DAVR-IEV-01"],
      "taskIds": ["T-04"],
      "checkIds": ["review-g1-stale-evidence-transition-probe"],
      "locationKeys": [
        "packages/sdd-runtime/src/contracts/execution-convergence.ts:221-303",
        "packages/sdd-runtime/src/contracts/execution-convergence.test.ts:143-167",
        "packages/sdd-runtime/src/contracts/execution-convergence.test.ts:241-256"
      ],
      "destination": "targeted_repair",
      "owner": "apply-backend"
    }
  ]
}
```

## RegistryIntentV1

```json
[]
```

## Explicit blockers

`G2_apply` is blocked until REVIEW-G1-B1 through REVIEW-G1-B5 are repaired within an explicitly coordinator-authorized G1 batch, fresh targeted and affected-area Verify passes on the repaired dependency set, and a fresh independent Review reports zero blockers. This Review does not write or authorize any registry state transition.
