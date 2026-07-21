# Tasks Replan Effect Authority: Deterministic Apply → Verify → Review Flow — Bounded Recovery Batch

## Immutable PhaseResult

| Field | Value |
|---|---|
| Role | `task_replan` |
| Instance provenance | bounded Task replan instance for effect-authority recovery after independent Review; distinct from all prior instances |
| Change ID | `deterministic-apply-verify-review-flow` |
| Authorized action | update `tasks.md` and `preconditions.md` only; write this `tasks-replan-effect-authority.md` artifact only |
| Spec SHA-256 (authoritative) | `sha256:374a8fb1a155830624083829aa8ccbbe609032e6a1b4c8064169372b4bfb8d7f` |
| Design SHA-256 (authoritative) | `sha256:a2873999c3a1164393d57060db2032f2cf6aa8f9ca40f46c56e6911d9319d8fe` |
| Review that triggered this replan | `review-recovery-g1.md` — three blocking findings: REVIEW-REC-G1-B1, REVIEW-REC-G1-B2, REVIEW-REC-G1-B3 |
| Review verdict | `request_changes` |
| Artifacts modified | `tasks.md`, `preconditions.md` |
| Artifacts written | `tasks-replan-effect-authority.md` |
| Status | `tasks_replan_completed` |
| Action | `task_replan_handoff` — bounded repair plan for three effect-authority blockers; do not Apply |
| Next stage | a new named human-approved recovery batch through the normal OpenSpec workflow |
| G2 Apply | **BLOCKED** — explicit prohibition carried forward |
| repair-3 | **PROHIBITED** — carried forward from G1 |
| Apply authorization | **NOT AUTHORIZED** — requires named human approval for proposed batch identity |
| Spec/Design replan required | **NO** — Review confirmed revised Spec and Design already require the missing boundaries |

## Context authority and write boundary

- **Official context used:** `review-recovery-g1.md`, revised `spec.md` (SHA-256 `374a8fb1...`), revised `design.md` (SHA-256 `a2873999...`), `tasks-replan-g1.md`, current `tasks.md`, current `preconditions.md`, repository architecture guidance, and the four exact G1 source/test target pairs.
- **Adaptive context:** loaded as advisory only. Official OpenSpec artifacts, current source/tests, and repository evidence controlled every decision.
- **Write boundary honored:** only `tasks.md` and `preconditions.md` were updated and only this file was added. No source, test, generated output, registry YAML, `state.yaml`, `events.yaml`, other change, or `runner-capability-standardization` target was modified.
- **Apply boundary:** no Apply was authorized, invoked, simulated, or performed. This is a Task-only replan.

## Evidence bindings

| Binding | Digest / value |
|---|---|
| Repository HEAD | `ccf0f66e8f0fdbbd5cd6226466e34243a481beff` |
| Review dossier binding | `sha256:3591982a6c9c146253e4707e0009f0c550ebd4aa86bfeed6a7f23ad81b9c9cff` |
| Review evidence binding | `sha256:0f9f3dacaec781315d92a246cc034e93e31b370c572d71c4142713147cb8eaaa` |
| Decision digest | `sha256:7c746edef1bc2a70665c37e1c62efc874dc50be88bcd4aed3e7c1970ce2cb26f` |
| revised `spec.md` | `sha256:374a8fb1a155830624083829aa8ccbbe609032e6a1b4c8064169372b4bfb8d7f` |
| revised `design.md` | `sha256:a2873999c3a1164393d57060db2032f2cf6aa8f9ca40f46c56e6911d9319d8fe` |
| `tasks-replan-g1.md` | `sha256:96832a1c631669ef569b44d12764a2813173fab215b97c12be5002568c344d4a` |

## Proposed batch identity and ceiling

The proposed new recovery batch is named:

**`deterministic-apply-verify-review-flow-recovery-batch-g1-effect-authority`**

This batch is bounded to exactly **8 files** (4 source + 4 test) — the same ceiling as the original G1 recovery batch:

| Authority slice | Exact source target | Reviewed SHA-256 | Exact test target | Reviewed SHA-256 |
|---|---|---|---|---|
| Protected-risk disposition/routing/effect (B1) | `packages/sdd-runtime/src/contracts/finding-disposition.ts` | `fb5b4cdc1fecb7e445281ebf3161ad7a46e1023abb3c8088a8a6672eb2577265` | `packages/sdd-runtime/src/contracts/finding-disposition.test.ts` | `7a074cc8f067099542e54f15d64bbf8ab2de1baa2cb90c3fb3a88e4dc4e72414` |
| Protected-risk routing boundary (B1) | `packages/sdd-runtime/src/contracts/routing-decision.ts` | `b711e70d14debaa3ad0a7bed77b0228a2f1119e024b2111f15fe9b77f8ff42d5` | `packages/sdd-runtime/src/contracts/routing-decision.test.ts` | `569341468982e602882984d5349d7a145a387c04065228d2c087981bff26e946` |
| Retry identity/counter and effect validation (B2) | `packages/sdd-runtime/src/contracts/blocking-repair-projection.ts` | `084935ed1b7c7362ba104f76ea69d3cc39511bb29df563c234ddbcfbade8bbb9` | `packages/sdd-runtime/src/contracts/blocking-repair-projection.test.ts` | `9356d5847584aa287ca30e00e4ee9ec996cf9d9c293399086adf3eb0a48e67b8` |
| Typed evidence and transition-authoritative convergence (B3) | `packages/sdd-runtime/src/contracts/execution-convergence.ts` | `4251e201e9e4e0d2dbbdd3b4c2cbac0e8d1bbf2a39984365940128826f51da8f` | `packages/sdd-runtime/src/contracts/execution-convergence.test.ts` | `211e26d5856a2d2ded473ef597c87bb8fc6adc1d506fbb0dc485175c9f297aca` |

No index, export, fixture, orchestrator, execution, adapter, prompt, generated, config, registry YAML, other OpenSpec change, or historical target may be added to this batch.

## Review narrow probe summary (RED/GREEN oracle basis)

These three probe outcomes from `review-recovery-g1.md` establish the mandatory RED failures that the proposed repair must convert to GREEN:

| Probe | RED condition (bypass demonstrated) | Expected GREEN (after repair) |
|---|---|---|
| B1: protected-risk omitted at disposition/routing | `data_loss` finding routed to `targeted_repair` when authority omitted; effect validator returned `accepted: true` without mandatory context | Same finding with mandatory protected-risk context present: must route to `blocking`; effect validator must reject missing context |
| B1: protected-risk omitted at projection/effect | Effect validation `accepted: true` with mandatory protected-risk context absent | Effect validator must independently recompute protected risk and fail closed when context is absent or mismatches |
| B2: forged retry identity accepted at parse | Validly rehashed replacement retry identity accepted at structural parse without authority | Structural parse must require complete authority projection; caller-supplied identity must be rederived from manifest/disposition and compared |
| B2: forged retry identity accepted at effect | Same forged identity accepted at effect validation without optional policy/ledger authority | Effect validator must require fully validated ledger/head and recompute identity from batch+manifest+disposition |
| B2: attempt record digests not recomputed | `validateRetryAttemptAgainstLedgerV1()` does not recompute attempt-record digests or validate uniqueness/links | Must recompute every attempt record digest and validate contiguous prior/projection/convergence bindings |
| B3: arbitrary complete revision accepted | `awaiting_apply_result` → arbitrary `complete` revision with self-consistent `registry_committed` receipt accepted as `complete` | Authority parser must resolve every referenced typed record, enforce canonical append order, and replay each predecessor through the transition function before accepting `complete` |

---

## T-EA-01: Protected-risk mandatory authority — disposition, routing, projection, effect

> **Covers:** REVIEW-REC-G1-B1

| Field | Value |
|---|---|
| **Owner** | `apply-backend` |
| **Priority** | P0 |
| **Complexity** | C5 |
| **Parallel** | parallel-safe within recovery batch |
| **Depends on** | none (first in recovery sequence) |
| **Files (allowlist — source)** | `packages/sdd-runtime/src/contracts/finding-disposition.ts`, `packages/sdd-runtime/src/contracts/routing-decision.ts`, `packages/sdd-runtime/src/contracts/blocking-repair-projection.ts` |
| **Files (allowlist — test)** | `packages/sdd-runtime/src/contracts/finding-disposition.test.ts`, `packages/sdd-runtime/src/contracts/routing-decision.test.ts`, `packages/sdd-runtime/src/contracts/blocking-repair-projection.test.ts` |
| **Files (blocked)** | All other files; V1 serialized shapes unchanged; `runner-capability-standardization` |
| **Risk lane** | CRITICAL |

### Requirement/task anchors

- REQ-DAVR-FD-03, REQ-DAVR-SEC-03, REQ-DAVR-FD-01, REQ-DAVR-SEC-02, REQ-DAVR-IEV-01
- T-REC-01, T-REC-02, T-REC-03 (from `tasks-replan-g1.md`)

### Design constraints enforced

- `design.md:57-64`: complete immutable authority chain and fail-closed missing artifacts
- `design.md:68-84`: mandatory protected-risk context at disposition, routing, repair projection, and effect boundaries

### RED oracle (must fail closed — based on B1 probe)

| Test scenario | Expected RED result |
|---|---|
| Security/data-loss finding with caller-omitted `ProtectedRiskAuthorityContextV1` | Must not accept; disposition must require mandatory authority; missing context is reject, not advisory |
| Finding disposition with caller-supplied `protectedRisk: false` under mandatory policy requiring `blocking` | Must override caller-supplied false; authoritative policy digest must be exact-matched |
| Routing decision with absent protected-risk authority context | Must not route; must fail closed at routing boundary |
| Repair projection effect validation with omitted protected-risk context | Must reject; effect validator must independently rederive protected risk and fail when context absent/mismatched |
| Binding comparison without mandatory artifact entries supplied | Must compare artifact entries supplied; empty or incomplete artifact map must be rejected even when batch binds Spec/Design/Tasks |
| Policy snapshot digest shape-only check without content verification | Must exact-match required Spec/Design/Tasks digest set and policy snapshot |

### GREEN oracle (after repair)

| Test scenario | Expected GREEN result |
|---|---|
| Security/data-loss finding with complete `ProtectedRiskAuthorityContextV1` present and exact-match policy snapshot | Classifies `blocking`; effect boundary accepts |
| Binding comparison with complete mandatory artifact set and matching policy snapshot | Accepts; effect boundary proceeds |
| Effect boundary independently rederived protected risk matching carried context | Accepts; authorized consumption proceeds |

### Completion evidence

1. TypeScript compiles without errors in all three source files
2. All three colocated test files pass 100%
3. Mandatory authority parameters are non-optional at disposition/routing/projection/effect APIs
4. Effect validator independently rederives protected-risk before authorization
5. Missing or mismatched authority context causes fail-closed rejection
6. No V1 serialized shapes changed

### Rollback

If any regression detected: revert all three source files and three test files to pre-repair SHA-256 bindings above. Preserve V1 readers. Do not commit partial changes.

### Hard stops

- If V1 fixture fails: stop and escalate before proceeding
- If mandatory authority cannot be made non-optional without breaking existing callers: escalate before proceeding
- If protected-risk recomputation at effect boundary requires API shape change incompatible with V1 readers: escalate before proceeding

---

## T-EA-02: Retry identity and ledger authority — parse and effect boundaries

> **Covers:** REVIEW-REC-G1-B2

| Field | Value |
|---|---|
| **Owner** | `apply-backend` |
| **Priority** | P0 |
| **Complexity** | C5 |
| **Parallel** | sequential after T-EA-01 |
| **Depends on** | T-EA-01 |
| **Files (allowlist — source)** | `packages/sdd-runtime/src/contracts/blocking-repair-projection.ts` |
| **Files (allowlist — test)** | `packages/sdd-runtime/src/contracts/blocking-repair-projection.test.ts` |
| **Files (blocked)** | All other files; V1 serialized shapes unchanged; `runner-capability-standardization` |
| **Risk lane** | CRITICAL |

### Requirement/task anchors

- REQ-DAVR-RG-05, REQ-DAVR-MD-03, REQ-DAVR-RG-01, REQ-DAVR-MD-02, REQ-DAVR-IEV-01
- T-REC-03 (from `tasks-replan-g1.md`)

### Design constraints enforced

- `design.md:88-109`: one authority-derived identity, mandatory equality recomputation at parse/effect boundaries, current fully validated ledger/head

### RED oracle (must fail closed — based on B2 probe)

| Test scenario | Expected RED result |
|---|---|
| `parseBlockingRepairProjectionV1()` with omitted `identityAuthority` | Must reject; structural integrity-only check is insufficient |
| Projection with caller-supplied `retryIdentity` without rederivation from manifest/disposition | Must reject; identity must be rederived from batch+manifest+disposition |
| Effect validator with optional `routingPolicyVersion` or `retryLedger` omitted | Must reject; silently skipping identity/ledger enforcement is prohibited |
| Effect validator initial structural parse then authority parse with same forged identity | Must reject; structural path must not be used as shortcut around authority |
| `validateRetryAttemptAgainstLedgerV1()` with caller-carried attempt records | Must recompute attempt-record digests; must validate uniqueness, contiguous prior links, projection binding, dossier head |

### GREEN oracle (after repair)

| Test scenario | Expected GREEN result |
|---|---|
| Projection parse with complete authority projection and fully parsed current ledger | Accepts; identity derived from batch+manifest+disposition matches carried projection |
| Effect validation with non-optional routing policy version and retry ledger | Accepts only with valid, non-omitted authority |
| Attempt record validation with recomputed digests and validated links | Accepts only if uniqueness, prior links, projection binding, and dossier head all valid |

### Completion evidence

1. TypeScript compiles without errors
2. All blocking-repair-projection tests pass 100%
3. `identityAuthority` is non-optional at parse
4. Identity inputs rederived from manifest/disposition before comparison
5. Effect validator requires non-optional `routingPolicyVersion` and `retryLedger`
6. `validateRetryAttemptAgainstLedgerV1()` recomputes every attempt-record digest and validates uniqueness, links, and bindings
7. No V1 serialized shapes changed

### Rollback

If any regression detected: revert blocking-repair-projection source and test to pre-repair SHA-256 bindings. Preserve V1 readers and exhausted G1 attempt history.

### Hard stops

- If identity rederivation requires manifest/disposition shape change incompatible with V1: escalate before proceeding
- If ledger validation requires API change that breaks existing V1 callers: escalate before proceeding

---

## T-EA-03: Convergence typed transition replay — authority parser

> **Covers:** REVIEW-REC-G1-B3

| Field | Value |
|---|---|
| **Owner** | `apply-backend` |
| **Priority** | P0 |
| **Complexity** | C5 |
| **Parallel** | sequential after T-EA-02 |
| **Depends on** | T-EA-02 |
| **Files (allowlist — source)** | `packages/sdd-runtime/src/contracts/execution-convergence.ts` |
| **Files (allowlist — test)** | `packages/sdd-runtime/src/contracts/execution-convergence.test.ts` |
| **Files (blocked)** | All other files; V1 serialized shapes unchanged; `runner-capability-standardization` |
| **Risk lane** | CRITICAL |

### Requirement/task anchors

- REQ-DAVR-BV-03, REQ-DAVR-REG-03, REQ-DAVR-BV-02, REQ-DAVR-RV-01, REQ-DAVR-REG-02, REQ-DAVR-IEV-01
- T-REC-04 (from `tasks-replan-g1.md`)

### Design constraints enforced

- `design.md:113-137`: full typed-record resolution, canonical digest-list binding, stage/dependency/subject validation, event-derived replay from every predecessor before completion or commit readiness is trusted

### RED oracle (must fail closed — based on B3 probe)

| Test scenario | Expected RED result |
|---|---|
| `parseExecutionConvergenceDossierWithAuthorityV1()` receiving only transition receipts | Must reject; must receive or resolve stage-evidence/invalidation/role-result records |
| Receipt content hash verification without canonical list position enforcement | Must reject; canonical append order must be enforced |
| State transition function not invoked; predecessor `nextStateDigest` equality check only | Must invoke state transition function and compare replayed successor with persisted state |
| `awaiting_apply_result` → `complete` jump with self-consistent `registry_committed` receipt | Must reject; every predecessor must be replayed through transition function |
| Optional/caller-supplied `expectedDependencySetDigest` | Must recompute from stage authority; caller-supplied value is insufficient |
| Invalidation predecessor/dependency/digest-list bindings not consumed by transition function | Must consume and validate all invalidation bindings |

### GREEN oracle (after repair)

| Test scenario | Expected GREEN result |
|---|---|
| Dossier parse with resolved stage-evidence/invalidation/role-result records and valid receipts | Accepts; all referenced typed records resolved |
| Canonical append order enforced with recomputed record and receipt hashes | Accepts; hash chain is valid |
| Transition function invoked; replayed successor matches persisted state | Accepts; legal transition confirmed |
| `complete` state reached only after all predecessors replayed through transition function | Accepts; authoritative convergence demonstrated |

### Completion evidence

1. TypeScript compiles without errors
2. All execution-convergence tests pass 100%
3. Authority parser resolves every referenced typed record before accepting any revision
4. Canonical append order enforced with recomputed hashes
5. State transition function invoked for every predecessor before `complete` is accepted
6. `expectedDependencySetDigest` recomputed from stage authority
7. Invalidation bindings consumed and validated by transition function
8. No V1 serialized shapes changed

### Rollback

If any regression detected: revert execution-convergence source and test to pre-repair SHA-256 bindings. Preserve V1 readers and exhausted G1 attempt history.

### Hard stops

- If typed record resolution requires new record types incompatible with V1: escalate before proceeding
- If transition replay requires state machine API change: escalate before proceeding

---

## Dependency order

```
T-EA-01 → T-EA-02 → T-EA-03
```

All three tasks are sequential within the proposed recovery batch.

## Complexity summary

| ID | Area | Complexity |
|----|------|------------|
| T-EA-01 | Protected-risk mandatory authority (disposition/routing/projection/effect) | C5 |
| T-EA-02 | Retry identity/ledger authority (parse/effect) | C5 |
| T-EA-03 | Convergence typed transition replay | C5 |

**Complexity totals: C5×3**

## Verify, Review, and broad gates

| Gate | Condition |
|---|---|
| **Verify** | All three source files compile; all three test files pass 100%; TypeScript `--noEmit` succeeds |
| **Scoped Review** | Independent Review of the proposed 8-file修复 slice; must report zero blockers before broad Verify |
| **Broad Verify** | **BLOCKED** until scoped Review reports zero blockers |
| **G2 Apply** | **BLOCKED** — prohibition carried forward from all prior instances |
| **repair-3** | **PROHIBITED** — carried forward from all prior instances |

## Global constraints and exclusions (carried forward)

### PROHIBITED TARGETS (hard stop — no task may authorize these)

- `runner-capability-standardization` — excluded from every batch, repair route, and target allowlist
- `openspec/changes/developer-team-execution-convergence/**` — historical/runtime evidence only
- `openspec/changes/*/state.yaml`, `openspec/changes/*/events.yaml` — specialists never write shared YAML in centralized mode
- Generated outputs — downstream effects only; never edited directly
- Any existing OpenSpec change's artifacts, state, or events

### IMPLEMENTATION RULE

- Only **implementation defects** (root cause = `implementation`) are eligible for Apply `targeted_repair`
- Root causes `requirement`, `architecture` → `replan_spec` / `replan_design`
- Root causes `oracle` → `correct_oracle` (non-modifying)
- Root causes `security`, `data-loss` → `escalate` / `human`
- Root causes `authorization`, `git_safety` → `stop`
- Any unrecognized combination → `stop` (fail closed)

---

## Open Questions / Blockers

### Classified as Blockers to Apply (not to Tasks)

- **Spec SHA-256 drift**: if `spec.md` changes, Tasks must be reconciled. Authoritative digest is `374a8fb1...`.
- **Design SHA-256 drift**: if `design.md` changes, Tasks must be reconciled. Authoritative digest is `a2873999...`.
- **Target allowlist intersection**: any overlap with `runner-capability-standardization` or another active change hard-stops.
- **Named human approval**: this batch requires explicit human approval before any modifying attempt. Apply is NOT authorized by this replan.

### No Unresolved External Preconditions

All inputs are available in the current repository state. No external service or remote artifact is required before this Tasks reconciliation.

---

## Phase Result Summary

| Field | Value |
|---|---|
| **Status** | `tasks_replan_completed` |
| **Recommended next action** | `human_approval_required` — named human must approve proposed batch identity `deterministic-apply-verify-review-flow-recovery-batch-g1-effect-authority` before any modifying attempt |
| **Tasks total** | 3 (T-EA-01, T-EA-02, T-EA-03) |
| **Proposed batch identity** | `deterministic-apply-verify-review-flow-recovery-batch-g1-effect-authority` |
| **Proposed batch ceiling** | exactly 8 files (4 source + 4 test): same as G1 recovery batch |
| **Apply readiness** | **NOT AUTHORIZED** — requires named human approval for proposed batch identity through the normal OpenSpec workflow |
| **G2 Apply** | **BLOCKED** — explicit prohibition carried forward |
| **repair-3** | **PROHIBITED** — carried forward |
| **Spec/Design replan required** | **NO** — Review confirmed revised Spec and Design already require the missing boundaries |
| **Blockers** | (1) named human approval for proposed batch identity not yet obtained; (2) spec SHA-256 drift; (3) design SHA-256 drift; (4) target intersection |
| **FailureManifestV1** | none (forward reconciliation from Review findings) |
| **RegistryIntentV1 values** | `[]` — no intent emitted by this bounded Task replan |
| **Risk lane** | CRITICAL for all three tasks |
| **Complexity floor/ceiling** | C5 (all tasks) |

---

## Dispatch Policy additions (official — applies to this proposed batch)

1. **No Apply batch may be issued without a new explicit named human-approved batch identity.**
2. **G2_apply is BLOCKED.** No `G2_apply` route may be authorized for any finding in any batch from this change.
3. **repair-3 is PROHIBITED.** The exhausted G1 two-attempt budget is not reopened.
4. Root cause `security` or `data-loss protected-risk` → `escalate` / `human` (never downgraded).
5. Root cause `authorization` or `git_safety` → `stop`.
6. Any unrecognized combination → `stop` (fail closed).

(End of file — total lines: ~320)
