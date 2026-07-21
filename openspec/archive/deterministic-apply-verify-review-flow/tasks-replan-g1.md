# Tasks Replan G1: Deterministic Apply → Verify → Review Flow — Bounded Recovery Batch

## Immutable PhaseResult

| Field | Value |
|---|---|
| Role | `task_replan` |
| Instance provenance | bounded Task replan instance after revised Spec digest `374a8fb1` and revised Design digest `a2873999`; distinct from the original Tasks, all G1 task/apply/verify/review instances, and the bounded Spec/Design replan instances |
| Change ID | `deterministic-apply-verify-review-flow` |
| Authorized action | update `tasks.md` and `preconditions.md` only; write this `tasks-replan-g1.md` artifact only |
| Spec SHA-256 (authoritative) | `374a8fb1a155830624083829aa8ccbbe609032e6a1b4c8064169372b4bfb8d7f` |
| Design SHA-256 (authoritative) | `a2873999c3a1164393d57060db2032f2cf6aa8f9ca40f46c56e6911d9319d8fe` |
| Artifacts modified | `tasks.md`, `preconditions.md` |
| Artifacts written | `tasks-replan-g1.md` |
| Status | `tasks_replan_completed` (bounded Task replan) |
| Action | `task_replan_handoff` — reconcile Tasks to revised Spec and Design; do not Apply |
| Next stage | a new bounded human-approved recovery batch through the normal OpenSpec workflow |
| G2 Apply | **BLOCKED** — explicit prohibition |
| Third G1 repair (repair-3) | **PROHIBITED** — explicit prohibition |
| Recovery batch identity | `deterministic-apply-verify-review-flow-recovery-batch-g1` |

## Context authority and write boundary

- **Official context used:** revised `spec.md` (SHA-256 `374a8fb1...`), revised `design.md` (SHA-256 `a2873999...`), `design-replan-g1.md`, terminal `review-g1-repair-2.md`, approved `proposal.md`, current `tasks.md` (SHA-256 `e5b718f6...`), current `preconditions.md`, repository architecture guidance, and the four exact G1 source/test target pairs.
- **Adaptive context:** loaded as advisory only. Official OpenSpec artifacts, current source/tests, and repository evidence controlled every decision.
- **Write boundary honored:** only `tasks.md` and `preconditions.md` were updated and only this file was added. No source, test, generated output, registry YAML, `state.yaml`, `events.yaml`, other change, or `runner-capability-standardization` target was modified.
- **Apply boundary:** no Apply was authorized, invoked, simulated, or performed. This is a Task-only replan.

## Evidence bindings

| Binding | Digest / value |
|---|---|
| Repository HEAD | `ccf0f66e8f0fdbbd5cd6226466e34243a481beff` |
| revised `spec.md` | `sha256:374a8fb1a155830624083829aa8ccbbe609032e6a1b4c8064169372b4bfb8d7f` |
| revised `design.md` | `sha256:a2873999c3a1164393d57060db2032f2cf6aa8f9ca40f46c56e6911d9319d8fe` |
| `design-replan-g1.md` | `sha256:5a3588e7a402f38138117ad3314f1f687e9637cf275852f5e9ebdd42907c4695` |
| `tasks.md` (pre-replan) | `sha256:e5b718f6883e60f43b46e0892118fafedb01271cf90c4e3f861d925bfb3e6510` |
| `preconditions.md` (pre-replan) | `sha256:8e82fc975e1ad6eff1069c5c134034e1bbba492302887637636d3c4724ac8a82` |
| preconditions.md (post-replan) | `sha256:81cbd0225bf757596a9f6bdb5eda460be910b12fe3019548bf2d402ec8b2e513` |
| tasks.md (post-replan) | `sha256:16891ea8024a704f9e438ba6a9bc44b9a54aca572b3aea0e9b748842c5acbc26` |

## Recovery batch identity and ceiling

The new recovery batch is named **`deterministic-apply-verify-review-flow-recovery-batch-g1`**.

It is bounded to exactly **8 files** (4 source + 4 test):

| Authority slice | Exact source target | SHA-256 | Exact test target | SHA-256 |
|---|---|---|---|---|
| Protected-risk disposition | `packages/sdd-runtime/src/contracts/finding-disposition.ts` | `76f28bfc425b466442d65a1654d8a60bcd1e1708119e8c25f70adb783b3b0d37` | `packages/sdd-runtime/src/contracts/finding-disposition.test.ts` | `25a5b831f5b836ae670a71a0ef608eac52ddf05b752971e1dd34e58c40f2a5ec` |
| Protected-risk routing | `packages/sdd-runtime/src/contracts/routing-decision.ts` | `96e76578b8a008596ce787310d1698a793a0961e5dc245c60bf909a713bde2f2` | `packages/sdd-runtime/src/contracts/routing-decision.test.ts` | `a328a39b34d1ac775c94fb07a47efca3e3976644f440e65e112a674dc73a259a` |
| Retry identity/counter and effect validation | `packages/sdd-runtime/src/contracts/blocking-repair-projection.ts` | `70e27f66d5cd0fb7c5ee39369d73cd0eb3043a604f6c53318aa304e75af19bcb` | `packages/sdd-runtime/src/contracts/blocking-repair-projection.test.ts` | `39ca820b7bfdccbbd11dbe87d0b2c741c41413f7128a7626fa1e99456ba8f524` |
| Typed evidence and transition-authoritative convergence | `packages/sdd-runtime/src/contracts/execution-convergence.ts` | `d7d72788248852840f7cbbf0f221b24b4ee9a6b3883545f9b8d087f103ab211c` | `packages/sdd-runtime/src/contracts/execution-convergence.test.ts` | `3e8c2810524bcc58496cde2331d7073810c18b13455b2851316c22452a65289f` |

No index, export, fixture, orchestrator, execution, adapter, prompt, generated, config, registry YAML, other OpenSpec change, or historical target may be added to this batch. Broader original change impact remains non-authorizing future context.

## G1 recovery task definitions

### Global constraints

- **G2 Apply is BLOCKED.** No task in this batch may authorize a `G2_apply` route.
- **repair-3 is PROHIBITED.** The exhausted G1 two-attempt budget is not reopened, reset, or converted into an authorize-anyway path.
- **Source/test boundary:** only the 8 files above are authorized targets. No glob expansion, no broader directory sweep.
- **V1 shapes preserved:** serialized keys of `FailureFindingV1`, `FailureManifestV1`, `FindingDispositionEnvelopeV1`, `RoutingDecisionV1`, `BlockingRepairProjectionV1`, `ExecutionConvergenceStateV1`, and `ExecutionConvergenceDossierV1` remain unchanged.
- **Authority enters through additive context arguments only:** `ProtectedRiskAuthorityContextV1`, `RetryIdentityAuthorityProjectionV1`, `ConvergenceStageEvidenceV1`, `ConvergenceInvalidationV1`, `ConvergenceTransitionReceiptV1` — not through V1 field injection.
- **Rollback:** stop effects and registry commits on regression; revert or forward-fix the coherent 8-file slice; preserve V1 readers and exhausted G1 attempt history.

---

## T-REC-01: Protected-risk authority — disposition

| Field | Value |
|---|---|
| **Owner** | `apply-backend` |
| **Priority** | P0 |
| **Complexity** | C4 |
| **Parallel** | parallel-safe (recovery batch; no dependents yet) |
| **Depends on** | none |
| **Files (allowlist — source)** | `packages/sdd-runtime/src/contracts/finding-disposition.ts` |
| **Files (allowlist — test)** | `packages/sdd-runtime/src/contracts/finding-disposition.test.ts` |
| **Files (blocked)** | All other files; V1 serialized shapes unchanged |
| **Risk lane** | CRITICAL |

### Requirement coverage

- REQ-DAVR-FD-03: protected-risk evidence is mandatory authoritative input to disposition classification
- REQ-DAVR-SEC-03: protected-risk dominance is recomputed at every decision boundary; caller override fails closed
- REQ-DAVR-FD-01: ambiguous findings default to `blocking`
- REQ-DAVR-FD-02: V1 projection without reinterpretation

### RED oracle (must fail closed)

| Test scenario | Expected RED result |
|---|---|
| Security-rooted finding with `isSecurityRelevant: true` under advisory check policy → disposition | Must classify `blocking`; advisory downgrade must not change result |
| Data-loss-authoritative finding with caller-supplied `dataLossRisk: false` | Must classify `blocking`; omitted/false caller flag must not downgrade |
| Finding with conflicting authoritative protected-risk evidence | Must fail to `blocking`; no advisory classification may authorize non-`blocking` |
| Finding with absent authoritative protected-risk evidence and caller-supplied `protectedRisk: false` | Must not accept caller flag as clearing authority; must evaluate from finding fields + mandatory policy |
| Forged `security` → `recommendation` disposition envelope with valid content hash | Must reject at parse because recomputed protected-risk from V1 finding fields disagrees |

### GREEN oracle (must pass when authority is correct)

| Test scenario | Expected GREEN result |
|---|---|
| V1 finding with `rootCause: "implementation"` and no protected-risk markers → disposition | Must classify deterministically per FD-01 precedence |
| V1 `unrelated_baseline + pre_existing` finding → disposition | Must classify `pre-existing`; cannot become `blocking` by severity alone |
| Advisory `recommendation` finding with no protected-risk markers | Must classify `recommendation` under FD-01 precedence |
| Four-disposition reachability with mixed root-cause/findings | Each disposition reachable for at least one finding; stable IDs |
| V1 compatibility: same finding ID/digest after disposition projection | Original V1 ID and digest unchanged |

### Completion evidence

TypeScript compiles; `finding-disposition.test.ts` RED/GREEN oracles for FD-03 and SEC-03 pass; V1 fixture unchanged; `PROTECTED_RISK_AUTHORITY_AMBIGUOUS`, `DISPOSITION_PROTECTED_RISK_MISMATCH` codes observable as rejection reasons.

### Rollback

Delete added authority-bound builder/parser overloads; revert to V1-only parse path.

---

## T-REC-02: Protected-risk authority — routing

| Field | Value |
|---|---|
| **Owner** | `apply-backend` |
| **Priority** | P0 |
| **Complexity** | C4 |
| **Parallel** | parallel-safe (recovery batch) |
| **Depends on** | T-REC-01 (disposition authority used by routing) |
| **Files (allowlist — source)** | `packages/sdd-runtime/src/contracts/routing-decision.ts` |
| **Files (allowlist — test)** | `packages/sdd-runtime/src/contracts/routing-decision.test.ts` |
| **Files (blocked)** | All other files; V1 serialized shapes unchanged |
| **Risk lane** | CRITICAL |

### Requirement coverage

- REQ-DAVR-SEC-03: protected-risk dominance recomputed at routing parse and effect boundaries; caller-supplied flags cannot alter recomputed result
- REQ-DAVR-SEC-02: protected-risk never downgraded to `targeted_repair`
- REQ-DAVR-RD-01: total root-cause routing table
- REQ-DAVR-IEV-01: invalid/stale/conflicting evidence fails closed

### RED oracle (must fail closed)

| Test scenario | Expected RED result |
|---|---|
| Carried route `escalate` but authoritative finding has `security` root cause with false/omitted caller flags | Must reject: recomputed protected-risk from V1 fields disagrees with carried result |
| Forged routing decision with valid content hash routing `security` → `targeted_repair` | Must reject at parse: recomputed protected-risk from manifest + mandatory policy disagrees |
| Routing decision with `protectedRisk: false` carried but authoritative `dataLossRisk` match in mandatory policy | Must reject: caller flag cannot clear derived data-loss authority |
| Missing mandatory `ProtectedRiskAuthorityContextV1` at routing parse | Must reject with `PROTECTED_RISK_AUTHORITY_AMBIGUOUS` |
| Conflicting authoritative protected-risk evidence on a finding | Must route to `escalate`/`stop`; cannot route to `targeted_repair` |

### GREEN oracle (must pass when authority is correct)

| Test scenario | Expected GREEN result |
|---|---|
| `implementation` root cause, fully anchored, scope-valid → `targeted_repair` with `apply` owner | Route and owner stable across reruns |
| `security` root cause with `isSecurityRelevant: true` | Must route to `escalate` with `human` owner |
| `environment` root cause with bounded diagnostic probe | Must route to `verify_runtime_diagnosis` |
| Total coverage: all 12+ root causes map to exactly one destination | Routing table is total and gap-free |
| Mixed-owner blocking sets → `split_required` | No single `targeted_repair` batch authorized |
| Unknown root cause → `stop` | Fail-closed; no permissive default |

### Completion evidence

TypeScript compiles; `routing-decision.test.ts` RED/GREEN oracles for SEC-03 pass; total coverage test passes; `ROUTING_PROTECTED_RISK_MISMATCH` observable as rejection reason.

### Rollback

Delete added authority-bound routing parser overloads; revert to V1-only routing parse path.

---

## T-REC-03: Retry identity and counter authority — projection

| Field | Value |
|---|---|
| **Owner** | `apply-backend` |
| **Priority** | P0 |
| **Complexity** | C5 |
| **Parallel** | parallel-safe (recovery batch) |
| **Depends on** | T-REC-01, T-REC-02 |
| **Files (allowlist — source)** | `packages/sdd-runtime/src/contracts/blocking-repair-projection.ts` |
| **Files (allowlist — test)** | `packages/sdd-runtime/src/contracts/blocking-repair-projection.test.ts` |
| **Files (blocked)** | All other files; V1 serialized shapes unchanged |
| **Risk lane** | CRITICAL |

### Requirement coverage

- REQ-DAVR-RG-05: retry identity is complete and derived from current authoritative policy; oracle IDs, verification-plan check IDs, and policy version are mandatory hashed fields
- REQ-DAVR-MD-03: retry identity recomputed and exact-equality verified at parse and effect boundaries; attempt binding validated against current ledger
- REQ-DAVR-RG-01: single stable retry identity per blocking set
- REQ-DAVR-RG-03: terminal governance maintains/increases restrictiveness

### RED oracle (must fail closed)

| Test scenario | Expected RED result |
|---|---|
| Projection whose carried retry identity was replaced, then validly rehashed | Must reject at parse: recomputed identity from `RetryIdentityAuthorityProjectionV1` disagrees |
| Projection with hard-coded/stale `routingPolicyVersion` | Must reject: version must be derived from current normalized routing-policy input |
| Projection with changed `oracleId` vs prior identity → same blocking set | Must create new identity; not counted as progress on old identity |
| Projection with changed mandatory verification-plan check ID → same blocking set | Must create new identity |
| Projection with valid content hash but carrying attempt number that skips ledger count | Must reject `RETRY_ATTEMPT_NUMBER_MISMATCH` |
| Attempt 1 carrying a `priorAttemptDigest` | Must reject `RETRY_PRIOR_ATTEMPT_MISMATCH` |
| Attempt N with `priorAttemptDigest` not equal to digest of attempt N-1 for same identity | Must reject `RETRY_PRIOR_ATTEMPT_MISMATCH` |
| Projection whose binding ledger record is missing from current convergence dossier | Must reject `RETRY_LEDGER_MISMATCH` |
| Projection whose convergence revision/digest does not match current dossier head | Must reject `RETRY_LEDGER_MISMATCH` |
| Projection with stale dossier head | Must reject `RETRY_LEDGER_MISMATCH` |

### GREEN oracle (must pass when authority is correct)

| Test scenario | Expected GREEN result |
|---|---|
| Attempt 1 with zero prior ledger records, no `priorAttemptDigest`, matching recomputed identity | Accepted; attempt credited |
| Attempt N with valid prior attempt digest equal to digest of attempt N-1, contiguous ledger, matching dossier head | Accepted; attempt credited |
| Oracle ID added → new identity created | New identity different from prior; not counted as progress |
| Mandatory verification-plan check ID removed → new identity | Identity changes; scope growth detected |
| Current `routingPolicyVersion` derived from normalized routing policy input | Identity stable across reruns with same inputs |

### Completion evidence

TypeScript compiles; `blocking-repair-projection.test.ts` RED/GREEN oracles for RG-05 and MD-03 pass; `RETRY_IDENTITY_MISMATCH`, `RETRY_POLICY_VERSION_MISMATCH`, `RETRY_LEDGER_MISMATCH`, `RETRY_ATTEMPT_NUMBER_MISMATCH`, `RETRY_PRIOR_ATTEMPT_MISMATCH` all observable as rejection codes.

### Rollback

Delete added authority-bound projection builder/parser overloads; revert to V1-only projection parse path.

---

## T-REC-04: Convergence authority — typed evidence and transition validation

| Field | Value |
|---|---|
| **Owner** | `apply-backend` |
| **Priority** | P0 |
| **Complexity** | C5 |
| **Parallel** | parallel-safe (recovery batch) |
| **Depends on** | T-REC-01, T-REC-02, T-REC-03 |
| **Files (allowlist — source)** | `packages/sdd-runtime/src/contracts/execution-convergence.ts` |
| **Files (allowlist — test)** | `packages/sdd-runtime/src/contracts/execution-convergence.test.ts` |
| **Files (blocked)** | All other files; V1 serialized shapes unchanged |
| **Risk lane** | CRITICAL |

### Requirement coverage

- REQ-DAVR-BV-03: accepting convergence events bind to stage-typed current-generation evidence with matching dependency/subject digest
- REQ-DAVR-REG-03: persisted convergence revisions validated as legal state transitions; arbitrary `complete` append fails closed
- REQ-DAVR-RG-05: retry identity complete and derived from current authoritative policy
- REQ-DAVR-DT-01: identical authoritative inputs produce identical decisions

### RED oracle (must fail closed)

| Test scenario | Expected RED result |
|---|---|
| Event with wrong stage type (e.g., `review_stable` event presented while state is `targeted_pending`) | Must reject; wrong stage |
| Event with prior-generation evidence (generation less than current state) | Must reject; prior-generation evidence |
| Non-modifying event carrying implementation-subject digest D2 ≠ current state D1 with no recorded invalidation | Must reject `subject_mismatch` |
| Event with dependency-set digest not matching stage-specific recomputed digest | Must reject `dependency_mismatch` |
| Event with opaque digest-only evidence lacking typed `ConvergenceStageEvidenceV1` | Must reject; opaque evidence not authoritative |
| `awaiting_apply_result` + valid content hash directly appending `complete` | Must reject; illegal transition |
| Out-of-table transition (any predecessor/event/predecessor-binding not in transition table) | Must reject |
| Attempt to append arbitrary caller-provided next state | Must reject; state transition computed by function, not caller |
| Non-modifying event coalesced with `dependencies_invalidated` in same revision | Must reject; invalidation must be separate event |

### GREEN oracle (must pass when authority is correct)

| Test scenario | Expected GREEN result |
|---|---|
| `awaiting_apply_result` + `apply_result_accepted` with typed Apply evidence + matching batch/projection/generation+1 subject → `targeted_pending` | Legal transition; state advances |
| `targeted_pending` + `targeted_accepted_no_blockers` with typed targeted evidence + same generation/subject/dependency → `affected_pending` | Legal transition |
| `affected_pending` + `affected_accepted_no_blockers` → `review_pending` | Legal transition |
| `review_pending` + `review_stable` with typed Review evidence + same generation/subject/current scoped dependencies → `broad_pending` | Legal transition |
| `broad_pending` + `broad_accepted` → `registry_commit_pending` | Legal transition |
| `registry_commit_pending` + `registry_committed` with typed registry evidence → `complete` | Legal transition |
| `dependencies_invalidated` + typed invalidation record with old/new subject or dependency binding → `targeted_pending` | Separate invalidation accepted; stale digests cleared |
| Full legal typed-evidence chain round-trips deterministically | Identical inputs → identical state |
| V1 compatibility: existing convergence fixtures pass unchanged | V1 fixture oracle unchanged |

### Completion evidence

TypeScript compiles; `execution-convergence.test.ts` RED/GREEN oracles for BV-03 and REG-03 pass; all state transition table rows testable; legal chain round-trip deterministically.

### Rollback

Delete added typed authority record types and authority-bound append/parse overloads; revert to V1-only convergence path.

---

## Dependency order (recovery batch — sequential within parallel pairs)

```
T-REC-01 → T-REC-02 → T-REC-03 → T-REC-04
           ↑__________|  ↑__________|
           (T-REC-02 depends on T-REC-01)
           (T-REC-03 depends on T-REC-01 and T-REC-02)
           (T-REC-04 depends on all prior)
```

All four tasks are `parallel-safe` in the sense of having no cross-task file-system write conflicts at the source level; the dependency chain reflects authority data flow.

---

## Complexity summary (recovery batch)

| ID | Area | Complexity | Notes |
|----|------|------------|-------|
| T-REC-01 | Protected-risk disposition authority | C4 | Authority context, recomputation, caller-override rejection |
| T-REC-02 | Protected-risk routing authority | C4 | Routing recomputation, caller-override rejection |
| T-REC-03 | Retry identity/counter and projection effect | C5 | Complete authority projection, ledger binding, identity recomputation |
| T-REC-04 | Convergence typed evidence and transition authority | C5 | Typed records, event-derived transitions, full predecessor replay |

**Complexity totals: C4×2, C5×2**

---

## Verification gates and stage ordering

### Apply gate (recovery batch — T-REC-01..04)

1. TypeScript compiles without errors
2. `packages/sdd-runtime/src/contracts/finding-disposition.test.ts` — all FD-03 / SEC-03 oracles GREEN; no regression on V1 fixture
3. `packages/sdd-runtime/src/contracts/routing-decision.test.ts` — all SEC-03 / RD-01 oracles GREEN; total coverage confirmed
4. `packages/sdd-runtime/src/contracts/blocking-repair-projection.test.ts` — all RG-05 / MD-03 oracles GREEN; identity/counter binding confirmed
5. `packages/sdd-runtime/src/contracts/execution-convergence.test.ts` — all BV-03 / REG-03 oracles GREEN; state machine table confirmed
6. Full `packages/sdd-runtime/src/contracts` suite passes
7. No new repository-wide test failures beyond `openspec/baseline-health.yaml` exact fingerprint

### Independent Verify gate

Each T-REC-01..04 requires a fresh `verify`-role instance producing normalized findings before the `review` role runs.

### Independent Review gate

Each T-REC-01..04 requires an independent `review`-role instance confirming that:
- RED oracles fail closed as specified
- GREEN oracles pass as specified
- No V1 fixture regression introduced
- Authority enters through additive context only; no V1 serialized key modified

### Broad stage gate

Broad verification runs only after:
- All scoped stages (T-REC targeted) at `terminal-accepted`
- Review has no unresolved `blocking` findings for this batch
- Mandatory broad floors (Full-SDD, security, authorization, data-loss) confirmed not applicable or satisfied

### Rollback triggers

- Authorization or compatibility regression
- V1 fixture failure
- Any RED oracle passing (fails closed when it should fail)
- Any GREEN oracle failing
- Registry chain partial commit
- V1 readability broken

---

## Original task groups status

The original 24-task, 6-group plan (G1–G6) remains the authoritative forward implementation plan for the full change. This `tasks-replan-g1.md` defines only the **recovery batch** (T-REC-01..04) that reconciles the six added authority-floor requirements against the revised Spec/Design digests.

After the recovery batch completes and is independently verified and reviewed, the full change may proceed through the original task groups with the updated contracts serving as the authority-enforced foundation. The original G2 (T-05..T-08) and subsequent groups are not modified by this replan; they retain their existing task definitions pending the recovery batch outcome.

---

## Open Questions / Blockers

### Blockers to Apply (recovery batch — not to Task reconciliation)

1. **Spec SHA-256 drift**: must match `374a8fb1a155830624083829aa8ccbbe609032e6a1b4c8064169372b4bfb8d7f`
2. **Design SHA-256 drift**: must match `a2873999c3a1164393d57060db2032f2cf6aa8f9ca40f46c56e6911d9319d8fe`
3. **Target allowlist intersection**: any intersection with `runner-capability-standardization` or another active OpenSpec change → hard stop
4. **Worktree policy violation**: unrelated tracked modifications, untracked files outside `openspec/changes/deterministic-apply-verify-review-flow/`, or generated outputs present at pre-batch gate
5. **V1 compatibility regression**: any existing V1 fixture failing after implementation → diagnose before next batch

### No Unresolved External Preconditions

All inputs are available in the current repository state. No external service or remote artifact is required before Task reconciliation can proceed.

---

## Phase Result Summary

| Field | Value |
|---|---|
| **Status** | `tasks_replan_completed` |
| **Recovery batch identity** | `deterministic-apply-verify-review-flow-recovery-batch-g1` |
| **Recommended next action** | `human_approval_required` — explicit approval required before issuing the named recovery batch |
| **Tasks total (recovery)** | 4 (T-REC-01..04) |
| **Groups total (recovery)** | 1 (G-REC) |
| **Dependency order** | T-REC-01 → T-REC-02 → T-REC-03 → T-REC-04 |
| **Apply readiness** | **NOT AUTHORIZED.** This Task replan does not authorize Apply, G2, repair-3, registry mutation, or scope expansion. A new human-approved batch identity is required through the normal OpenSpec workflow before any modifying attempt. |
| **Blockers to Apply** | Spec digest drift, design digest drift, target intersection, worktree state, V1 regression, missing human batch approval |
| **FailureManifestV1** | none (forward reconciliation, not a reactive batch failure) |
| **RegistryIntentV1 values** | `[]` — no intent emitted; recovery batch is verification-only reconciliation |
| **Risk lane** | CRITICAL for all 4 recovery tasks |
| **Complexity floor** | C4; ceiling C5 |
| **File ceiling** | exactly 8 (4 source + 4 test) |
| **G2 / repair-3** | explicitly BLOCKED / PROHIBITED |
| **Tasks.md SHA-256 (post-replan)** | `sha256:16891ea8024a704f9e438ba6a9bc44b9a54aca572b3aea0e9b748842c5acbc26` |
| **Preconditions.md SHA-256 (post-replan)** | `sha256:81cbd0225bf757596a9f6bdb5eda460be910b12fe3019548bf2d402ec8b2e513` |

---

## Dispatch Policy for Recovery Batch

1. **Only implementation defects are eligible for `targeted_repair` (Apply)** within this recovery batch.
2. Root cause `implementation` + fully anchored blocking + scope-valid + policy-permitted + authority-valid → `targeted_repair`.
3. Root cause `requirement` → `replan_spec`.
4. Root cause `architecture` → `replan_design`.
5. Root cause `oracle` → `correct_oracle` (non-modifying; requires new Task/Apply batch for source/test changes).
6. Root cause `security` or `data-loss protected-risk` → `escalate` / `human` (never downgraded).
7. Root cause `authorization` or `git_safety` → `stop`.
8. Root cause `unknown` + diagnosable → `verify_runtime_diagnosis`; otherwise → `escalate`.
9. **G2_apply is BLOCKED.** No `G2_apply` route may be authorized for any finding in this recovery batch.
10. **repair-3 is PROHIBITED.** The exhausted G1 two-attempt budget is not reopened.
11. **No recovery batch may be issued without a new explicit human-approved batch identity.**
12. Any unrecognized combination → `stop` (fail closed, no permissive default).

---

## RegistryIntentV1

```json
[]
```

No intent is emitted by this bounded Task replan. The recovery batch is a verification-only reconciliation step. Ordered `RegistryIntentV1` values will be emitted by Apply → Verify → Review → broad acceptance only after a separately human-approved batch is issued and the recovery batch completes successfully.

(End of file — total lines: ~290)
