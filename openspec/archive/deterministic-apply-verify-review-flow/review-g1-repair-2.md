# Independent Review G1 Repair Attempt 2: Deterministic Apply → Verify → Review Flow

## Immutable PhaseResult

| Field | Value |
|---|---|
| Role | `review` |
| Instance provenance | fresh independent Review instance for G1 repair-2; distinct from the recorded Apply and Verify instances |
| Change ID | `deterministic-apply-verify-review-flow` |
| Authorized batch | G1 repair-2 — T-01, T-02, T-03, T-04; eight source/test targets only |
| Status | `request_changes` |
| Action | `stop_and_replan` — the bounded two-attempt repair budget is exhausted; no third modifying repair is authorized |
| Next stage | human governance/architecture decision and Spec/Design/Tasks replan before any further modifying attempt |
| Blockers | 3 |
| FailureManifestV1 | present below |
| Ordered RegistryIntentV1 values | `[]` |

**Verdict: REQUEST CHANGES.** Zero blockers is not warranted. The exact five repair-2 regressions have substantial fixes, and the previous T-03 non-derived-target regression remains rejected, but fresh adversarial Review reproduced three MUST-level authority defects: protected-risk findings can become non-authorizing or Apply-authorizing, a validly rehashed repair projection can replace its stable retry identity and still pass the effect boundary, and the convergence contract can reach or persist `complete` with stale or bypassed evidence authority. `G2_apply` remains blocked.

## Immutable evidence bindings

| Binding | Digest / value |
|---|---|
| Repository HEAD | `ccf0f66e8f0fdbbd5cd6226466e34243a481beff` |
| Invocation digest | `sha256:f6dafd65bc0203ca26fceb264001c421bb8a88a36e49d6bc801af68569b8839f` |
| G1 repair-2 batch binding digest | `sha256:c737c2b72b37b6eccbaa81394cbe4ee99cf71d77b9ff3f4d4d4c033814439760` |
| Review evidence binding digest | `sha256:5ffe17746a13fc29c0499354d7f03a8b2a02acce669b7c933172aa6f5e3dd506` |
| Decision digest | `sha256:d9f8581544c7a2d20122a98f3d45ca9e2bdf131dbec770b9fe02f8f2183bdd2c` |
| Spec | `sha256:55b388b463dcc37c4ee59f3018a4714025de980001ff44fabe859b8e2df500b3` |
| Design | `sha256:4b61d78ab9d698744946b329e43367383fe0184dc218d270e541b408d6657207` |
| Tasks | `sha256:e5b718f6883e60f43b46e0892118fafedb01271cf90c4e3f861d925bfb3e6510` |
| Repair incident | `sha256:d1c10ec8497c2c25271e3206e905a6a8f9ca304ed911a37008defbebfd4ef146` |
| Prior Review | `sha256:c628595de8398a6e1afa8529e7b4b05cc303adb111c9fb354805e47a88b31b00` |
| Repair-2 Verify | `sha256:38ee868900c4854f02fc90f8aef8e4ca62aeb6ff506c011af21be8409983ee02` |

The batch binding is the deterministic digest of the change ID, G1, ordered task IDs, and the eight reviewed source/test content hashes. The Review evidence binding adds the six authoritative artifact hashes, repository HEAD, and the narrow probe outcomes. Adaptive context was loaded as advisory only; OpenSpec artifacts, current source/tests, and repository evidence controlled this judgment.

## Review scope and method

- Read `spec.md`, `design.md`, `tasks.md`, `repair-incident.md`, `review-g1.md`, and `verify-g1-repair-2.md`.
- Inspected all eight G1 source/test targets in full.
- Reassessed all five prior Review blockers, the previous T-03 Verify regression, V1 compatibility, deterministic authority boundaries, effect/secret safety, scope, and maintainability.
- Ran only narrow in-memory adversarial contract probes. No broad or repository-wide test suite was run, and this Review does not duplicate Verify's compliance matrix.
- Modified no source, test, generated output, registry YAML, `state.yaml`, or `events.yaml`.

### Reviewed source/test bindings

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

## Prior-blocker reassessment

| Prior blocker | Result | Independent Review judgment |
|---|---|---|
| REVIEW-G1-B1 disposition rehash downgrade | Exact forgery fixed | The parser now recomputes entries from supplied classification authority and rejects the prior validly rehashed downgrade. A distinct protected-risk classification defect remains as REVIEW-G1-R2-B1. |
| REVIEW-G1-B2 routing false completion | Resolved | The parser recomputes the complete ordered route set, outcome, and rationales and rejects the prior empty-route `complete` forgery. |
| REVIEW-G1-B3 global routing authority | Partially resolved | Anchor and explicit mixed-risk inputs are finding-specific, and mixed-owner outcomes are deterministic. Protected-risk authority is still optional/caller-supplied and can contradict authoritative V1 finding data; see REVIEW-G1-R2-B1. |
| REVIEW-G1-B4 incomplete repair derivation | Resolved for the reported cases | Causal evidence is derived and compared at builder/effect boundaries; same-check/different-artifact and foreign evidence are rejected; line/range locations normalize to repository paths. |
| REVIEW-G1-B5 stale-evidence completion | Not fully resolved | Modifying helper transitions clear old digests and accepting helper transitions require explicit digests, but current-subject equality and persisted transition validity remain unenforced; see REVIEW-G1-R2-B3. |
| Prior T-03 non-derived batch-allowed target regression | Resolved | Effect-boundary derivation compares the exact target set from manifest + disposition and returns `OVERSIZED_TARGETS` for the validly rehashed widening case. |

## Blocking findings

### REVIEW-G1-R2-B1 — Protected-risk authority can be downgraded or routed to modifying Apply

- **Severity:** Critical
- **Classification:** related G1 regression; blocking
- **Requirement/task anchors:** REQ-DAVR-FD-01, REQ-DAVR-RD-01, REQ-DAVR-SEC-02, REQ-DAVR-IEV-01; T-01, T-02
- **Locations:** `packages/sdd-runtime/src/contracts/finding-disposition.ts:146-220`; `packages/sdd-runtime/src/contracts/routing-decision.ts:285-371,442-484`; missing adversarial coverage in both corresponding test files
- **Root cause:** `implementation`
- **Evidence:** The disposition classifier's mandatory decision uses only caller-supplied requirement/task/check lists and ignores the finding's security root cause and `isSecurityRelevant` field. A narrow probe supplied an open `rootCause: "security"`, `isSecurityRelevant: true` finding under an advisory check policy; it became `recommendation`, and routing returned `complete`. A second probe supplied an anchored `rootCause: "implementation"`, `isSecurityRelevant: true` finding while the optional policy risk flags were false/omitted; routing returned `targeted_repair`.
- **Acceptance impact:** Current V1 protected-risk evidence is not a mandatory authority input. Caller policy can therefore erase escalation before routing or authorize a modifying effect, contradicting the fixed safety floor and fail-safe classification requirements.
- **Required boundary:** Protected-risk classification must be derived from authoritative per-finding evidence and mandatory safety policy, must dominate advisory/defer classification and repair routing, and must be recomputed at parse/decision boundaries. Caller-supplied false/omitted overrides must never downgrade authoritative risk.

### REVIEW-G1-R2-B2 — Stable retry identity is neither complete nor revalidated at the effect boundary

- **Severity:** Critical
- **Classification:** related G1 implementation defect; blocking
- **Requirement/task anchors:** REQ-DAVR-RG-01, REQ-DAVR-CS-01, REQ-DAVR-MD-01, REQ-DAVR-MD-02, REQ-DAVR-IEV-01; T-03
- **Locations:** `packages/sdd-runtime/src/contracts/blocking-repair-projection.ts:264-287,369-382,413-478,544-599`; missing adversarial identity coverage in `blocking-repair-projection.test.ts`
- **Root cause:** `implementation`
- **Evidence:** `computeRetryIdentity()` omits selected findings' oracle IDs and mandatory verification-plan check IDs and hard-codes the routing policy version instead of deriving it from current authority. Parsing asserts only that `retryIdentity` is digest-shaped. Effect validation independently recomputes anchors, targets, checks, obligations, and evidence but never recomputes or compares `retryIdentity`. A narrow probe replaced a projection's retry identity (and attempt counter), validly rehashed the projection, and the effect boundary returned `accepted: true`.
- **Acceptance impact:** A modifying repair can cross the effect boundary under an identity not determined by its authoritative blocker/owner/oracle/check scope. Attempt and progress accounting can be detached from the actual repair, defeating the single-identity and no-scope-growth guarantees.
- **Required boundary:** Define one authoritative retry-identity projection containing every Spec/Design field, expose the actual policy version, and recompute exact equality at parse/effect consumption. Attempt/prior-attempt bindings must be validated against the current convergence ledger before effect authorization.

### REVIEW-G1-R2-B3 — Convergence completion remains caller-asserted rather than transition- and dependency-authoritative

- **Severity:** Critical
- **Classification:** related regression; blocking
- **Requirement/task anchors:** REQ-DAVR-BV-02, REQ-DAVR-RV-01, REQ-DAVR-RV-02, REQ-DAVR-REG-02, REQ-DAVR-IEV-01; T-04
- **Locations:** `packages/sdd-runtime/src/contracts/execution-convergence.ts:221-388,490-545,548-645`; missing adversarial coverage in `execution-convergence.test.ts`
- **Root cause:** `implementation`
- **Evidence:** Non-modifying transitions accept a different `implementationSubjectDigest` while inheriting or accepting opaque scoped/Review/broad digests; no equality guard binds the evidence to the current subject or generation. A narrow probe changed the subject on `review_stable`, again on `broad_accepted`, and again on `registry_committed`, yet reached `complete`. Separately, `appendExecutionConvergenceRevisionV1()` accepts an arbitrary caller-provided state without proving it is the output of a valid predecessor transition, and `parseExecutionConvergenceDossierV1()` validates hashes/history but not state transitions. A revision jumped directly from `awaiting_apply_result` to `complete` and parsed successfully.
- **Acceptance impact:** Content-addressed history proves only what was serialized, not that the state transition or evidence dependency binding was authorized. Scoped/Review/broad work can be skipped or made stale while completion and registry readiness remain reachable.
- **Required boundary:** Bind every accepting event to stage-typed current-generation evidence whose dependency/subject digest equals current state, reject subject changes on non-modifying events unless dependency invalidation is applied, and validate every persisted revision's state transition against its predecessor. Arbitrary `complete` state append/rehash must fail closed.

## Compatibility, safety, scope, and maintainability

| Area | Result | Evidence |
|---|---|---|
| V1 compatibility | PASS in reviewed scope | All four implementations/tests are additive files. Blocked V1 files `failure-manifest.ts`, `execution-decision.ts`, `apply-batch.ts`, and `execution-dossier.ts` are unchanged; existing V1 source was inspected only as authority context. |
| Exact prior T-03 effect regression | PASS | Non-derived batch-allowed target widening is re-derived and rejected at the effect boundary. |
| Causal-evidence effect safety | PASS for prior B4 cases | Exact evidence membership is derived at builder and effect boundaries; foreign/same-check-different-artifact references fail. |
| Secret safety | PASS in reviewed scope | Evidence remains bounded and repository-normalized; unsafe diagnostic content is rejected/redacted, and rejection surfaces use stable codes without raw diagnostic content. No literal secret was emitted by Review. |
| Other effect authority | FAIL | REVIEW-G1-R2-B2 reproduces acceptance of a forged retry identity; REVIEW-G1-R2-B1 reproduces a protected-risk downgrade. |
| Scope | PASS | Worktree scope contains exactly the eight G1 source/test targets plus this change-local OpenSpec directory. No generated output, registry YAML, other OpenSpec change, or `runner-capability-standardization` target was modified. |
| Maintainability | BLOCKED by correctness boundaries | The additive modules remain localized and introduce no dependency, but duplicated caller-asserted authority and a hard-coded routing policy version make safety behavior easy to misuse. These are included in blocking findings, not style preferences. |

## Optional notes

None. No optional new scope is proposed. Any future recommendation outside the three anchored blockers is non-authorizing and cannot expand this batch, repair budget, or target allowlist.

## FailureManifestV1

```json
{
  "schema": "failure-manifest-v1",
  "changeId": "deterministic-apply-verify-review-flow",
  "findings": [
    {
      "findingId": "REVIEW-G1-R2-B1-PROTECTED-RISK-AUTHORITY",
      "status": "open",
      "relationship": "batch_related",
      "rootCause": "implementation",
      "disposition": "blocking",
      "severity": "critical",
      "requirementIds": ["REQ-DAVR-FD-01", "REQ-DAVR-RD-01", "REQ-DAVR-SEC-02", "REQ-DAVR-IEV-01"],
      "taskIds": ["T-01", "T-02"],
      "checkIds": ["review-g1-r2-protected-risk-authority-probe"],
      "locationKeys": [
        "packages/sdd-runtime/src/contracts/finding-disposition.ts:146-220",
        "packages/sdd-runtime/src/contracts/routing-decision.ts:285-371",
        "packages/sdd-runtime/src/contracts/routing-decision.ts:442-484",
        "packages/sdd-runtime/src/contracts/finding-disposition.test.ts",
        "packages/sdd-runtime/src/contracts/routing-decision.test.ts"
      ],
      "destination": "escalate",
      "owner": "human"
    },
    {
      "findingId": "REVIEW-G1-R2-B2-RETRY-IDENTITY-AUTHORITY",
      "status": "open",
      "relationship": "batch_related",
      "rootCause": "implementation",
      "disposition": "blocking",
      "severity": "critical",
      "requirementIds": ["REQ-DAVR-RG-01", "REQ-DAVR-CS-01", "REQ-DAVR-MD-01", "REQ-DAVR-MD-02", "REQ-DAVR-IEV-01"],
      "taskIds": ["T-03"],
      "checkIds": ["review-g1-r2-retry-identity-effect-probe"],
      "locationKeys": [
        "packages/sdd-runtime/src/contracts/blocking-repair-projection.ts:264-287",
        "packages/sdd-runtime/src/contracts/blocking-repair-projection.ts:369-382",
        "packages/sdd-runtime/src/contracts/blocking-repair-projection.ts:413-478",
        "packages/sdd-runtime/src/contracts/blocking-repair-projection.ts:544-599",
        "packages/sdd-runtime/src/contracts/blocking-repair-projection.test.ts"
      ],
      "destination": "escalate",
      "owner": "human"
    },
    {
      "findingId": "REVIEW-G1-R2-B3-CONVERGENCE-AUTHORITY",
      "status": "open",
      "relationship": "batch_related",
      "rootCause": "implementation",
      "disposition": "blocking",
      "severity": "critical",
      "requirementIds": ["REQ-DAVR-BV-02", "REQ-DAVR-RV-01", "REQ-DAVR-RV-02", "REQ-DAVR-REG-02", "REQ-DAVR-IEV-01"],
      "taskIds": ["T-04"],
      "checkIds": [
        "review-g1-r2-subject-drift-completion-probe",
        "review-g1-r2-append-state-jump-probe"
      ],
      "locationKeys": [
        "packages/sdd-runtime/src/contracts/execution-convergence.ts:221-388",
        "packages/sdd-runtime/src/contracts/execution-convergence.ts:490-545",
        "packages/sdd-runtime/src/contracts/execution-convergence.ts:548-645",
        "packages/sdd-runtime/src/contracts/execution-convergence.test.ts"
      ],
      "destination": "escalate",
      "owner": "human"
    }
  ]
}
```

The destinations above reflect the exhausted two-attempt repair budget and are not modifying authorization. They require coordinator stop plus a new human governance decision.

## RegistryIntentV1

```json
[]
```

## Explicit blockers and exact next action

Explicit blockers: `REVIEW-G1-R2-B1-PROTECTED-RISK-AUTHORITY`, `REVIEW-G1-R2-B2-RETRY-IDENTITY-AUTHORITY`, and `REVIEW-G1-R2-B3-CONVERGENCE-AUTHORITY`.

**Exact next action:** the coordinator must keep `G2_apply` blocked, emit no registry commit from this Review, stop the exhausted G1 repair loop, and request a new human governance/architecture decision that explicitly replans the affected Spec/Design/Tasks and authorizes any new bounded repair identity before another modifying attempt. This Review does not authorize repair-3, source/test modification, registry mutation, or scope expansion.
