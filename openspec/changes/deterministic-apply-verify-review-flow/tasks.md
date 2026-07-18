# Tasks: Deterministic Apply → Verify → Review Flow

## Change identity

- **Change ID:** `deterministic-apply-verify-review-flow`
- **Execution mode:** Automatic
- **Spec SHA-256:** `374a8fb1a155830624083829aa8ccbbe609032e6a1b4c8064169372b4bfb8d7f` (revised; matches authoritative artifact)
- **Design SHA-256:** `a2873999c3a1164393d57060db2032f2cf6aa8f9ca40f46c56e6911d9319d8fe` (revised; all Spec OQ-1..OQ-11 resolved)
- **Recovery batch identity (G1):** `deterministic-apply-verify-review-flow-recovery-batch-g1`
- **Recovery batch ceiling (G1):** exactly 8 files (4 source + 4 test) per `tasks-replan-g1.md`
- **Proposed effect-authority recovery batch identity:** `deterministic-apply-verify-review-flow-recovery-batch-g1-effect-authority` (per `tasks-replan-effect-authority.md`; **NOT YET APPROVED** — requires named human approval)
- **Proposed effect-authority recovery ceiling:** exactly 8 files (4 source + 4 test) per `tasks-replan-effect-authority.md` — same ceiling as G1 recovery batch
- **G2 Apply:** BLOCKED — explicit prohibition; no `G2_apply` route authorized in any task
- **repair-3:** PROHIBITED — exhausted G1 two-attempt budget not reopened, reset, or converted to authorize-anyway path
- **Human approval required:** a new explicit human-approved batch identity is mandatory before any modifying attempt from this change

## Task group overview

| Group | Label | Tasks | Notes |
|-------|-------|-------|-------|
| G-REC | Recovery batch (authority floors) | T-REC-01, T-REC-02, T-REC-03, T-REC-04 | Bounded to 8 files; G2/repair-3 prohibited; human batch approval required |
| G-EA | Effect-authority recovery (Review blockers B1-B3) | T-EA-01, T-EA-02, T-EA-03 | Proposed bounded 8-file ceiling; NOT APPROVED; requires named human approval; defined in `tasks-replan-effect-authority.md` |
| G1 | New contracts | T-01, T-02, T-03, T-04 | Original; pending recovery batch completion |
| G2 | Orchestrator policy | T-05, T-06, T-07, T-08 | Original; G2_apply BLOCKED |
| G3 | Execution / registry | T-09, T-10, T-11 | |
| G4 | Canonical prompts | T-12, T-13 | |
| G5 | Contract + policy tests | T-14, T-15, T-16, T-17, T-18, T-19, T-20 | |
| G6 | Integration + acceptance tests | T-21, T-22, T-23, T-24 | |

**Total: 31 tasks across 8 groups (7 recovery + 24 original).**

## Global constraints and exclusions

### PROHIBITED TARGETS (hard stop — no task may authorize these)

- `runner-capability-standardization` — excluded from every batch, repair route, and target allowlist
- `openspec/changes/developer-team-execution-convergence/**` — historical/runtime evidence only; never modified, reconciled, or used to widen this change
- `openspec/changes/*/state.yaml`, `openspec/changes/*/events.yaml` — specialists never write shared YAML in centralized mode
- Generated outputs (`packages/core/src/skills/external/content.generated.ts`, `apps/cli/src/runtime/build-info.generated.ts`, etc.) — downstream effects only; never edited directly
- Any existing OpenSpec change's artifacts, state, or events

### IMPLEMENTATION RULE

- Only **implementation defects** (root cause = `implementation`) are eligible for Apply `targeted_repair`.
- Root causes `requirement`, `architecture`, `batch_shape` → `replan_spec` / `replan_design` / `replan_tasks`.
- Root causes `oracle` → `correct_oracle` (non-modifying).
- Root causes `environment`, `transport`, `capability` → `verify_runtime_diagnosis` (non-modifying; escalates if unresolved).
- Root causes `security`, `data-loss` → `escalate` / `human`.
- Root causes `authorization`, `git_safety` → `stop`.
- Root cause `unknown` with ambiguous evidence → `verify_runtime_diagnosis`; without usable probe or after exhaustion → `escalate`.
- Any unrecognized combination → `stop` (fail closed, no permissive default).

### SOURCE/CONFIG TARGET BOUNDARY

All source/config targets are **explicit and bounded** per task. No glob expansion, no broader directory sweep. Targets are drawn only from the official design.md impact candidates and spec.md runtime evidence references.

### OPENSPEC STATE

Specialists emit ordered `RegistryIntentV1` values only. The centralized coordinator remains the sole writer of shared `state.yaml` / `events.yaml`. No task writes shared YAML directly.

---

## G-REC — Recovery batch: authority floors (bounded 8-file ceiling)

> **Batch identity:** `deterministic-apply-verify-review-flow-recovery-batch-g1`
> **Ceiling:** exactly 4 source files + 4 test files (see `tasks-replan-g1.md` for full definition)
> **G2_apply:** BLOCKED. **repair-3:** PROHIBITED. **Human batch approval:** required before any modifying attempt.
> **Spec digest (authoritative):** `sha256:374a8fb1a155830624083829aa8ccbbe609032e6a1b4c8064169372b4bfb8d7f`
> **Design digest (authoritative):** `sha256:a2873999c3a1164393d57060db2032f2cf6aa8f9ca40f46c56e6911d9319d8fe`

The six added requirements (FD-03, SEC-03, RG-05, MD-03, BV-03, REG-03) require additive authority-bound additions to the same four contract source files and four colocated test files already defined in the original G1. The recovery batch does not replace or widen the original G1; it adds the mandatory authority floors before any subsequent group may proceed.

Full task definitions (RED/GREEN oracles, completion evidence, rollback) are in `tasks-replan-g1.md`. Summary:

| Task | Source file | Test file | Authority requirement |
|------|-------------|-----------|----------------------|
| T-REC-01 | `finding-disposition.ts` | `finding-disposition.test.ts` | FD-03, SEC-03: protected-risk as mandatory disposition input |
| T-REC-02 | `routing-decision.ts` | `routing-decision.test.ts` | SEC-03: protected-risk recomputed at routing boundary |
| T-REC-03 | `blocking-repair-projection.ts` | `blocking-repair-projection.test.ts` | RG-05, MD-03: complete identity, counter authority, ledger binding |
| T-REC-04 | `execution-convergence.ts` | `execution-convergence.test.ts` | BV-03, REG-03: typed evidence, transition-authoritative convergence |

**Dependency order:** T-REC-01 → T-REC-02 → T-REC-03 → T-REC-04
**Complexity totals:** C4×2, C5×2
**Risk lane:** CRITICAL for all four

### Dispatch policy for G-REC

1. **G2_apply is BLOCKED** — no task may authorize a `G2_apply` route.
2. **repair-3 is PROHIBITED** — the exhausted G1 two-attempt budget is not reopened.
3. Root cause `security` or `data-loss protected-risk` → `escalate` / `human`.
4. Root cause `authorization` or `git_safety` → `stop`.
5. Any unrecognized combination → `stop` (fail closed).
6. No recovery batch task may be modified without a new explicit human-approved batch identity.

---

## G-EA — Effect-authority recovery batch (bounded 8-file ceiling — NOT APPROVED)

> **Proposed batch identity:** `deterministic-apply-verify-review-flow-recovery-batch-g1-effect-authority`
> **NOT APPROVED — requires named human approval before any modifying attempt.**
> **Ceiling:** exactly 4 source files + 4 test files (same as G1 recovery batch); see `tasks-replan-effect-authority.md` for full definitions.
> **G2_apply:** BLOCKED. **repair-3:** PROHIBITED. **Spec/Design replan:** NOT REQUIRED (Review confirmed).
> **Spec digest (authoritative):** `sha256:374a8fb1a155830624083829aa8ccbbe609032e6a1b4c8064169372b4bfb8d7f`
> **Design digest (authoritative):** `sha256:a2873999c3a1164393d57060db2032f2cf6aa8f9ca40f46c56e6911d9319d8fe`

Addresses three Review blockers from `review-recovery-g1.md`:
- **REVIEW-REC-G1-B1** (protected-risk effect authority): T-EA-01
- **REVIEW-REC-G1-B2** (retry identity effect authority): T-EA-02
- **REVIEW-REC-G1-B3** (convergence replay authority): T-EA-03

Full task definitions (RED/GREEN oracles, completion evidence, rollback, hard stops) are in `tasks-replan-effect-authority.md`. Summary:

| Task | Source files | Test files | Covers |
|------|--------------|------------|--------|
| T-EA-01 | `finding-disposition.ts`, `routing-decision.ts`, `blocking-repair-projection.ts` | `finding-disposition.test.ts`, `routing-decision.test.ts`, `blocking-repair-projection.test.ts` | B1: protected-risk mandatory authority at disposition/routing/projection/effect |
| T-EA-02 | `blocking-repair-projection.ts` | `blocking-repair-projection.test.ts` | B2: retry identity/ledger authority at parse/effect boundaries |
| T-EA-03 | `execution-convergence.ts` | `execution-convergence.test.ts` | B3: typed transition replay in authority parser |

**Dependency order:** T-EA-01 → T-EA-02 → T-EA-03
**Complexity totals:** C5×3
**Risk lane:** CRITICAL for all three

### Dispatch policy for G-EA

1. **G2_apply is BLOCKED** — no task may authorize a `G2_apply` route.
2. **repair-3 is PROHIBITED** — the exhausted G1 two-attempt budget is not reopened.
3. Root cause `security` or `data-loss protected-risk` → `escalate` / `human`.
4. Root cause `authorization` or `git_safety` → `stop`.
5. Any unrecognized combination → `stop` (fail closed).
6. No task may be modified without a new explicit named human-approved batch identity.
7. **Apply is NOT authorized by this replan.** Named human approval for the proposed batch identity is required before any modifying attempt.

---

## G1 — New contracts

### T-01: FindingDispositionEnvelopeV1

| Field | Value |
|-------|-------|
| **Owner** | `apply-backend` |
| **Priority** | P0 |
| **Complexity** | C3 |
| **Parallel** | parallel-safe (G1, no dependents yet) |
| **Depends on** | none |
| **Files (allowlist — source)** | `packages/sdd-runtime/src/contracts/finding-disposition.ts` |
| **Files (allowlist — test)** | `packages/sdd-runtime/src/contracts/finding-disposition.test.ts` |
| **Files (blocked)** | `packages/sdd-runtime/src/contracts/failure-manifest.ts` (read-only; V1 preserved) |
| **Verification** | RED: schema validation rejects missing/disputed finding IDs, non-disposition input, V1 digest change; GREEN: all four dispositions reachable, ambiguous→blocking fallback, baseline projection, no V1 ID/digest change |
| **Completion evidence** | TypeScript compiles; contract unit tests pass; V1 compatibility fixture unchanged |
| **Risk lane** | HIGH |
| **Rollback** | Delete `finding-disposition.ts`; revert to V1-only path |

#### Requirement/scenario coverage
- REQ-DAVR-FD-01 (total disposition classification, stable ID, deterministic)
- REQ-DAVR-FD-02 (V1 projection without reinterpretation)
- REQ-DAVR-OF-01 (non-blocking reportable, non-authorizing)
- REQ-DAVR-SEC-01 (safe evidence, redaction)
- Scenarios: disposition reachability, stability across reruns, ambiguous→blocking, V1 projection, baseline exclusion

---

### T-02: RoutingDecisionV1

| Field | Value |
|-------|-------|
| **Owner** | `apply-backend` |
| **Priority** | P0 |
| **Complexity** | C4 |
| **Parallel** | parallel-safe (G1) |
| **Depends on** | T-01 (disposition envelope used by routing) |
| **Files (allowlist — source)** | `packages/sdd-runtime/src/contracts/routing-decision.ts` |
| **Files (allowlist — test)** | `packages/sdd-runtime/src/contracts/routing-decision.test.ts` |
| **Files (blocked)** | `packages/sdd-runtime/src/contracts/execution-decision.ts` (read-only; V1 preserved) |
| **Verification** | RED: total routing table covers all 12+ root causes, unknown→stop, mixed owner→split; GREEN: each route entry has stable destination+owner, semantic decision digest excludes prose/identity/timestamps |
| **Completion evidence** | RoutingDecisionV1 schema tests pass; total coverage test passes |
| **Risk lane** | HIGH |
| **Rollback** | Delete `routing-decision.ts` |

#### Requirement/scenario coverage
- REQ-DAVR-RD-01 (total root-cause routing table)
- REQ-DAVR-RD-02 (mixed-owner split)
- REQ-DAVR-DT-01, DT-02 (deterministic, total, gap-free)
- REQ-DAVR-SEC-02 (protected-risk never downgraded)
- REQ-DAVR-IEV-01, IEV-02 (fail closed, verify-runtime diagnosis destination)
- Scenarios: total coverage, security→escalate, auth/Git→stop, env/transport/cap→diagnosis, unknown→stop

---

### T-03: BlockingRepairProjectionV1

| Field | Value |
|-------|-------|
| **Owner** | `apply-backend` |
| **Priority** | P0 |
| **Complexity** | C4 |
| **Parallel** | parallel-safe (G1) |
| **Depends on** | T-01, T-02 |
| **Files (allowlist — source)** | `packages/sdd-runtime/src/contracts/blocking-repair-projection.ts` |
| **Files (allowlist — test)** | `packages/sdd-runtime/src/contracts/blocking-repair-projection.test.ts` |
| **Files (blocked)** | `packages/sdd-runtime/src/contracts/apply-batch.ts` (read-only; original batch preserved) |
| **Verification** | RED: rejects extra anchors/checks/targets, blocked-target intersection, stale authorization, excluded-change intersection; GREEN: minimality proven, original batch identity unchanged, projection digest stable |
| **Completion evidence** | Projection schema tests pass; minimality property test passes |
| **Risk lane** | CRITICAL |
| **Rollback** | Delete `blocking-repair-projection.ts` |

#### Requirement/scenario coverage
- REQ-DAVR-MD-01, MD-02 (minimal dossier, immutable original batch, effect-boundary rejection)
- REQ-DAVR-CS-01, CS-02 (scope cannot broaden, restricted to authorized targets)
- REQ-DAVR-BA-01, BA-02 (anchored blocking only, objective/reproducible authorization)
- REQ-DAVR-SEC-01 (no secrets in projection)
- REQ-DAVR-SAF-04 (excluded-scope hard stop)
- Scenarios: minimal dossier contents, original batch unchanged, oversized rejection, auth mismatch rejection

---

### T-04: ExecutionConvergenceDossierV1 + ExecutionConvergenceStateV1

| Field | Value |
|-------|-------|
| **Owner** | `apply-backend` |
| **Priority** | P0 |
| **Complexity** | C4 |
| **Parallel** | parallel-safe (G1) |
| **Depends on** | T-01, T-02, T-03 |
| **Files (allowlist — source)** | `packages/sdd-runtime/src/contracts/execution-convergence.ts` |
| **Files (allowlist — test)** | `packages/sdd-runtime/src/contracts/execution-convergence.test.ts` |
| **Files (blocked)** | `packages/sdd-runtime/src/contracts/execution-dossier.ts` (read-only; V1 dossier preserved) |
| **Verification** | RED: append-only revision validation, predecessor digest mismatch rejected, invalid state transition rejected; GREEN: state machine transitions match design table, generation increments on repair |
| **Completion evidence** | Convergence dossier/state schema tests pass; state machine transition oracle tests pass |
| **Risk lane** | HIGH |
| **Rollback** | Delete `execution-convergence.ts` |

#### Requirement/scenario coverage
- REQ-DAVR-IR-01, IR-02 (role independence)
- REQ-DAVR-TV-01, TV-02, TV-03 (targeted→affected→Review→broad order)
- REQ-DAVR-BV-01, BV-02 (broad after stability, invalidation after modification)
- REQ-DAVR-RV-01, RV-02 (scoped revalidation, Review reuse conditions)
- REQ-DAVR-RG-01, RG-02, RG-03, RG-04 (retry identity, progress, bounded convergence)
- REQ-DAVR-DT-01 (identical inputs → identical decisions)
- REQ-DAVR-REG-01, REG-02 (registry single-writer, commit-ready evidence requirement)
- REQ-DAVR-ROL-01, ROL-02 (rollback stops progression, preserves history)
- Scenarios: state transition table, Review gate, broad invalidation, generation increment

---

## G2 — Orchestrator policy

### T-05: Decision kernel — total routing table

| Field | Value |
|-------|-------|
| **Owner** | `apply-backend` |
| **Priority** | P0 |
| **Complexity** | C4 |
| **Parallel** | sequential (G2, depends on G1) |
| **Depends on** | T-01, T-02 |
| **Files (allowlist)** | `packages/sdd-runtime/src/orchestrator/decision-kernel.ts` |
| **Files (blocked)** | Any other orchestrator file; any contract file (read-only boundary) |
| **Verification** | RED: every root cause maps to exactly one destination, protected-risk→escalate dominates, mixed-owner→split_required; GREEN: routing table matches design.md table exactly, unknown→stop fail-closed |
| **Completion evidence** | `decision-kernel.test.ts` covers all 12+ root causes and override rows; existing V1 tests still pass |
| **Risk lane** | CRITICAL |
| **Rollback** | Revert decision-kernel.ts to pre-T-05 state |

#### Requirement/scenario coverage
- REQ-DAVR-RD-01, RD-02
- REQ-DAVR-IEV-01, IEV-02
- REQ-DAVR-SEC-02
- REQ-DAVR-CS-01 (scope-broaden rejection at kernel level)
- REQ-DAVR-RG-01 (retry identity binding at kernel level)
- Scenarios: total coverage, mixed-owner split, protected-risk override

---

### T-06: Failure delta — blocking progress computation

| Field | Value |
|-------|-------|
| **Owner** | `apply-backend` |
| **Priority** | P0 |
| **Complexity** | C3 |
| **Parallel** | sequential (G2) |
| **Depends on** | T-01, T-05 |
| **Files (allowlist)** | `packages/sdd-runtime/src/orchestrator/failure-delta.ts` |
| **Files (blocked)** | Any other orchestrator file |
| **Verification** | RED: recommendation/deferred/pre-existing contribute zero progress; blocking regressions dominate; GREEN: `computeBlockingProgressV1` produces correct progress sets, positive progress proven only by resolved active blockers |
| **Completion evidence** | `failure-delta.test.ts` disposition-aware progress tests pass |
| **Risk lane** | HIGH |
| **Rollback** | Revert failure-delta.ts |

#### Requirement/scenario coverage
- REQ-DAVR-RG-02 (positive progress proof)
- REQ-DAVR-RG-04 (convergence with adaptive-quality-control loop breaker)
- REQ-DAVR-OF-01 (non-blocking zero credit)
- Scenarios: positive progress, no progress→checkpoint, negative progress→replan, recommendation zero credit

---

### T-07: Staged verification — Review gate and state machine

| Field | Value |
|-------|-------|
| **Owner** | `apply-backend` |
| **Priority** | P0 |
| **Complexity** | C4 |
| **Parallel** | sequential (G2) |
| **Depends on** | T-04, T-05 |
| **Files (allowlist)** | `packages/sdd-runtime/src/orchestrator/staged-verification.ts` |
| **Files (blocked)** | Any other orchestrator file |
| **Verification** | RED: Review not scheduled while scoped incomplete, no stage-skip, mandatory broad floors enforced; GREEN: targeted→affected→review_pending→broad sequence matches design state machine |
| **Completion evidence** | `staged-verification.test.ts` pre-Review-gate tests pass; existing staged tests still pass |
| **Risk lane** | HIGH |
| **Rollback** | Revert staged-verification.ts |

#### Requirement/scenario coverage
- REQ-DAVR-TV-01, TV-02, TV-03 (targeted→Review ordering, Review adds only blocking)
- REQ-DAVR-BV-01, BV-02 (broad final gate, post-modification invalidation)
- REQ-DAVR-SAF-01 (mandatory broad floors not deferred)
- REQ-DAVR-RG-04 (loop breaker integration)
- Scenarios: Review blocked while scoped incomplete, Review at scoped gate, broad after stability

---

### T-08: Freshness policy — post-repair invalidation and Review reuse

| Field | Value |
|-------|-------|
| **Owner** | `apply-backend` |
| **Priority** | P1 |
| **Complexity** | C3 |
| **Parallel** | sequential (G2) |
| **Depends on** | T-04, T-06, T-07 |
| **Files (allowlist)** | `packages/sdd-runtime/src/orchestrator/freshness-policy.ts` |
| **Files (blocked)** | Any other orchestrator file |
| **Verification** | RED: stale post-modification evidence rejected, Review reuse requires unchanged reviewed deps; GREEN: dependency digest comparison correct, stale→fresh transition produces correct invalidation records |
| **Completion evidence** | `freshness-policy.test.ts` post-repair invalidation tests pass |
| **Risk lane** | MEDIUM |
| **Rollback** | Revert freshness-policy.ts |

#### Requirement/scenario coverage
- REQ-DAVR-IR-01 (role freshness, no identity collision)
- REQ-DAVR-IR-02 (causal evidence sharing does not transfer conclusions)
- REQ-DAVR-RV-01 (repair invalidates stale scoped evidence)
- REQ-DAVR-RV-02 (Review reuse requires unchanged dependencies)
- REQ-DAVR-OF-01 (non-blocking findings not shared as conclusions)
- Scenarios: identity collision rejected, attempt summaries stripped, stale→fresh revalidation

---

## G3 — Execution / registry

### T-09: Execution control plane — convergence scheduling and result consumption

| Field | Value |
|-------|-------|
| **Owner** | `apply-backend` |
| **Priority** | P0 |
| **Complexity** | C5 |
| **Parallel** | sequential (G3) |
| **Depends on** | T-04, T-05, T-06, T-07, T-08 |
| **Files (allowlist)** | `packages/sdd-runtime/src/execution/execution-control-plane.ts` |
| **Files (blocked)** | Any other execution file; any adapter file |
| **Verification** | RED: Review never parallel with Verify, Review gate enforced before broad, generation increment triggers scoped invalidation; GREEN: role invocation envelopes include convergence digest/generation/dependency-set, result consumption validates exact equality on all new fields |
| **Completion evidence** | `execution-control-plane.test.ts` convergence scheduling tests pass; `execution-role-scheduler.test.ts` pre-broad Review oracle updated |
| **Risk lane** | CRITICAL |
| **Rollback** | Revert execution-control-plane.ts to pre-convergence state; keep V1 replay path intact |

#### Requirement/scenario coverage
- REQ-DAVR-IR-01 (independent role identities)
- REQ-DAVR-TV-02 (Review only after scoped pass)
- REQ-DAVR-BV-01, BV-02 (broad after Review stable)
- REQ-DAVR-RV-01 (modification invalidates evidence)
- REQ-DAVR-REG-01 (registry single-writer)
- REQ-DAVR-DT-01 (deterministic replay)
- Scenarios: Review scheduling, broad scheduling, generation invalidation, registry commit ordering

---

### T-10: Repair loop governance — unified retry identity

| Field | Value |
|-------|-------|
| **Owner** | `apply-backend` |
| **Priority** | P1 |
| **Complexity** | C4 |
| **Parallel** | sequential (G3) |
| **Depends on** | T-03, T-06, T-09 |
| **Files (allowlist)** | `packages/sdd-runtime/src/orchestrator/repair-loop-governance.ts` |
| **Files (blocked)** | Any other orchestrator file |
| **Verification** | RED: changed blocking set creates new identity, no-progress→checkpoint once→replan/escalation, negative progress→stop; GREEN: `evaluateRepairIncident()` as restrictive guard (never converts checkpoint→repair), compatibility projection recorded |
| **Completion evidence** | `repair-loop-governance.test.ts` unified identity tests pass; legacy incident tests still pass |
| **Risk lane** | HIGH |
| **Rollback** | Revert repair-loop-governance.ts |

#### Requirement/scenario coverage
- REQ-DAVR-RG-01 (single stable retry identity)
- REQ-DAVR-RG-02 (positive progress required)
- REQ-DAVR-RG-03 (terminal governance maintains/increases restrictiveness)
- REQ-DAVR-RG-04 (adaptive-quality-control integration)
- REQ-DAVR-CS-01 (scope-broaden creates new identity)
- Scenarios: identity stability, changed target set→new identity, no-progress handling, hard budget stop

---

### T-11: Registry coordinator — atomic intent chain commit

| Field | Value |
|-------|-------|
| **Owner** | `apply-backend` |
| **Priority** | P0 |
| **Complexity** | C4 |
| **Parallel** | sequential (G3) |
| **Depends on** | T-04, T-09 |
| **Files (allowlist)** | `packages/sdd-runtime/src/artifact-state/registry-coordinator.ts` |
| **Files (blocked)** | Any other artifact-state file; any spec-registry file beyond what is needed for coordinator |
| **Verification** | RED: stale base→conflict with recovery guidance, partial chain never committed, recovery-required→hard stop; GREEN: `commitIntentChainV1` atomically commits full ordered chain in one filesystem transaction |
| **Completion evidence** | Registry coordinator chain tests pass; existing single-intent commit tests still pass |
| **Risk lane** | CRITICAL |
| **Rollback** | Revert registry-coordinator.ts; existing `commit` and `commitAll` remain available for legacy consumers |

#### Requirement/scenario coverage
- REQ-DAVR-REG-01 (single-writer, centralized, conflict stop)
- REQ-DAVR-REG-02 (commit-ready requires current evidence)
- REQ-DAVR-ROL-01, ROL-02 (rollback preserves history, no partial chain)
- Scenarios: atomic chain commit, stale base conflict, recovery-required hard stop

---

## G4 — Canonical prompts

### T-12: Orchestrator prompt — remove legacy parallelism, express canonical flow

| Field | Value |
|-------|-------|
| **Owner** | `apply-general` |
| **Priority** | P1 |
| **Complexity** | C2 |
| **Parallel** | sequential (G4, after T-09 demonstrates runtime ordering) |
| **Depends on** | T-09 (runtime scheduling proven) |
| **Files (allowlist)** | `packages/core/src/teams/developer/orchestrator-content.ts` |
| **Files (blocked)** | Any other prompt source; any generated file |
| **Verification** | RED: no statement that Verify and Review run in parallel after Apply; GREEN: canonical lifecycle described as targeted→affected→Review→broad, no contradictory choreography |
| **Completion evidence** | `orchestrator-content.test.ts` prompt parity tests pass |
| **Risk lane** | MEDIUM |
| **Rollback** | Revert orchestrator-content.ts to pre-T-12 state |

#### Requirement/scenario coverage
- Covers exploration finding: legacy/full prompt said "Verify and Review run in parallel" — must be removed
- REQ-DAVR-TV-01, TV-02 (canonical sequencing in prompts)
- REQ-DAVR-BV-01 (broad after Review stable in prompts)
- Prompt text is descriptive only, never modification authority

---

### T-13: Apply/Verify/Review prompts — clarify evidence and disposition

| Field | Value |
|-------|-------|
| **Owner** | `apply-general` (coordinate), `apply-backend`, `apply-frontend`, `verify`, `review` |
| **Priority** | P1 |
| **Complexity** | C2 |
| **Parallel** | parallel-safe within G4 (independent prompts) |
| **Depends on** | T-12 (orchestrator context set) |
| **Files (allowlist)** | `packages/core/src/teams/developer/apply-general-content.ts`, `apply-backend-content.ts`, `apply-frontend-content.ts`, `verify-content.ts`, `review-content.ts` |
| **Files (blocked)** | Any generated file; any other prompt source |
| **Verification** | RED: Apply prompts do not claim self-verify equals independent Verify; Verify prompts require disposition on findings; Review prompts require blocking-only authorization; GREEN: all six prompt parity tests pass |
| **Completion evidence** | All six prompt-content tests pass |
| **Risk lane** | MEDIUM |
| **Rollback** | Revert individual content files to pre-T-13 state |

#### Requirement/scenario coverage
- REQ-DAVR-BA-01 (only blocking authorizes repair)
- REQ-DAVR-IR-01 (Apply-owned checks vs independent Verify evidence distinguished)
- REQ-DAVR-TV-03 (Review may add blocking only)
- REQ-DAVR-OF-01, OF-02 (non-blocking non-authorizing, scope growth→replan)
- Covers exploration finding: compact Apply skills told agents to run checks themselves; now clarified

---

## G5 — Contract + policy tests

### T-14: FindingDispositionEnvelopeV1 tests

| Field | Value |
|-------|-------|
| **Owner** | `apply-backend` |
| **Priority** | P0 |
| **Complexity** | C3 |
| **Parallel** | parallel-safe (G5) |
| **Depends on** | T-01 |
| **Files (allowlist)** | `packages/sdd-runtime/src/contracts/finding-disposition.test.ts` (new) |
| **Files (blocked)** | Existing V1 fixture files (read-only) |
| **Verification** | RED: four dispositions reachable, ambiguous→blocking, baseline→pre-existing, V1 projection non-destructive; GREEN: all disposition tests pass |
| **Completion evidence** | `finding-disposition.test.ts` 100% pass |
| **Risk lane** | HIGH |
| **Rollback** | Delete finding-disposition.test.ts |

#### Requirement/scenario coverage
- REQ-DAVR-FD-01, FD-02
- REQ-DAVR-OF-01
- 8 scenarios from spec FD area

---

### T-15: RoutingDecisionV1 tests

| Field | Value |
|-------|-------|
| **Owner** | `apply-backend` |
| **Priority** | P0 |
| **Complexity** | C3 |
| **Parallel** | parallel-safe (G5) |
| **Depends on** | T-02 |
| **Files (allowlist)** | `packages/sdd-runtime/src/contracts/routing-decision.test.ts` (new) |
| **Files (blocked)** | Existing routing fixtures (read-only) |
| **Verification** | RED: total table coverage, mixed-owner split, stable digest; GREEN: all routing tests pass |
| **Completion evidence** | `routing-decision.test.ts` 100% pass |
| **Risk lane** | HIGH |
| **Rollback** | Delete routing-decision.test.ts |

#### Requirement/scenario coverage
- REQ-DAVR-RD-01, RD-02
- REQ-DAVR-IEV-01, IEV-02
- REQ-DAVR-DT-01, DT-02
- 12+ scenarios from spec RD/DT/IEV areas

---

### T-16: BlockingRepairProjectionV1 tests

| Field | Value |
|-------|-------|
| **Owner** | `apply-backend` |
| **Priority** | P0 |
| **Complexity** | C3 |
| **Parallel** | parallel-safe (G5) |
| **Depends on** | T-03 |
| **Files (allowlist)** | `packages/sdd-runtime/src/contracts/blocking-repair-projection.test.ts` (new) |
| **Files (blocked)** | Existing batch/dossier fixtures (read-only) |
| **Verification** | RED: minimality enforced, original batch identity preserved, effect-boundary rejects oversized/mismatched; GREEN: all projection tests pass |
| **Completion evidence** | `blocking-repair-projection.test.ts` 100% pass |
| **Risk lane** | CRITICAL |
| **Rollback** | Delete blocking-repair-projection.test.ts |

#### Requirement/scenario coverage
- REQ-DAVR-MD-01, MD-02
- REQ-DAVR-CS-01, CS-02
- REQ-DAVR-BA-01, BA-02
- 8 scenarios from spec MD/CS/BA areas

---

### T-17: State machine + convergence dossier tests

| Field | Value |
|-------|-------|
| **Owner** | `apply-backend` |
| **Priority** | P0 |
| **Complexity** | C4 |
| **Parallel** | parallel-safe (G5) |
| **Depends on** | T-04 |
| **Files (allowlist)** | `packages/sdd-runtime/src/contracts/execution-convergence.test.ts` (new) |
| **Files (blocked)** | Existing dossier fixtures (read-only) |
| **Verification** | RED: all state transitions from design table, generation increment, invalid transitions rejected; GREEN: all convergence state tests pass |
| **Completion evidence** | `execution-convergence.test.ts` 100% pass |
| **Risk lane** | HIGH |
| **Rollback** | Delete execution-convergence.test.ts |

#### Requirement/scenario coverage
- REQ-DAVR-TV-01, TV-02, TV-03
- REQ-DAVR-BV-01, BV-02
- REQ-DAVR-RV-01, RV-02
- REQ-DAVR-RG-01, RG-02, RG-03
- REQ-DAVR-REG-01, REG-02
- 20+ scenarios from spec TV/BV/RV/RG/REG areas

---

### T-18: Blocking progress + retry governance tests

| Field | Value |
|-------|-------|
| **Owner** | `apply-backend` |
| **Priority** | P0 |
| **Complexity** | C3 |
| **Parallel** | parallel-safe (G5) |
| **Depends on** | T-06, T-10 |
| **Files (allowlist)** | `packages/sdd-runtime/src/orchestrator/failure-delta.test.ts` (augment), `packages/sdd-runtime/src/orchestrator/repair-loop-governance.test.ts` (augment) |
| **Files (blocked)** | Existing V1 delta tests (read-only oracle) |
| **Verification** | RED: non-blocking zero progress, positive progress gate, no-progress checkpoint, negative progress stop, loop ceiling; GREEN: augmented tests pass, existing tests still pass |
| **Completion evidence** | Augmented `failure-delta.test.ts` and `repair-loop-governance.test.ts` 100% pass |
| **Risk lane** | HIGH |
| **Rollback** | Revert augmentation to pre-T-18 |

#### Requirement/scenario coverage
- REQ-DAVR-RG-01, RG-02, RG-03, RG-04
- REQ-DAVR-OF-01
- 12+ scenarios from spec RG area

---

### T-19: Staged verification + freshness policy tests

| Field | Value |
|-------|-------|
| **Owner** | `apply-backend` |
| **Priority** | P0 |
| **Complexity** | C3 |
| **Parallel** | parallel-safe (G5) |
| **Depends on** | T-07, T-08 |
| **Files (allowlist)** | `packages/sdd-runtime/src/orchestrator/staged-verification.test.ts` (augment), `packages/sdd-runtime/src/orchestrator/freshness-policy.test.ts` (augment) |
| **Files (blocked)** | Existing staged/freshness tests (read-only oracle) |
| **Verification** | RED: Review gate enforced, dependency invalidation correct, Review reuse/refresh conditions; GREEN: augmented tests pass, existing tests still pass |
| **Completion evidence** | Augmented `staged-verification.test.ts` and `freshness-policy.test.ts` 100% pass |
| **Risk lane** | HIGH |
| **Rollback** | Revert augmentation to pre-T-19 |

#### Requirement/scenario coverage
- REQ-DAVR-TV-01, TV-02
- REQ-DAVR-BV-01, BV-02
- REQ-DAVR-RV-01, RV-02
- REQ-DAVR-IR-01, IR-02
- 10+ scenarios from spec TV/BV/RV/IR areas

---

### T-20: Decision kernel total-table + mixed-owner tests

| Field | Value |
|-------|-------|
| **Owner** | `apply-backend` |
| **Priority** | P0 |
| **Complexity** | C3 |
| **Parallel** | parallel-safe (G5) |
| **Depends on** | T-05 |
| **Files (allowlist)** | `packages/sdd-runtime/src/orchestrator/decision-kernel.test.ts` (augment) |
| **Files (blocked)** | Existing decision-kernel tests (read-only oracle) |
| **Verification** | RED: all 12+ root causes routed correctly, override rows dominate, mixed-owner→split; GREEN: augmented kernel tests pass, existing tests still pass |
| **Completion evidence** | Augmented `decision-kernel.test.ts` 100% pass |
| **Risk lane** | HIGH |
| **Rollback** | Revert augmentation to pre-T-20 |

#### Requirement/scenario coverage
- REQ-DAVR-RD-01, RD-02
- REQ-DAVR-IEV-01, IEV-02
- REQ-DAVR-SEC-02
- 10+ scenarios from spec RD/IEV area

---

## G6 — Integration + acceptance tests

### T-21: Control plane + scheduler integration tests

| Field | Value |
|-------|-------|
| **Owner** | `apply-backend` |
| **Priority** | P0 |
| **Complexity** | C4 |
| **Parallel** | parallel-safe (G6) |
| **Depends on** | T-09 |
| **Files (allowlist)** | `packages/sdd-runtime/src/execution/execution-control-plane.test.ts` (augment), `packages/sdd-runtime/src/execution/execution-role-scheduler.test.ts` (augment) |
| **Files (blocked)** | Existing E2E fixtures for other changes |
| **Verification** | RED: convergence scheduling, Review gate, generation invalidation, role result binding; GREEN: augmented control-plane/scheduler tests pass |
| **Completion evidence** | Augmented tests 100% pass; TypeScript compiles |
| **Risk lane** | HIGH |
| **Rollback** | Revert augmentation to pre-T-21 |

#### Requirement/scenario coverage
- REQ-DAVR-IR-01, IR-02
- REQ-DAVR-TV-02, TV-03
- REQ-DAVR-BV-01, BV-02
- REQ-DAVR-RV-01
- REQ-DAVR-DT-01
- REQ-DAVR-REG-01, REG-02

---

### T-22: Effect boundary + projection enforcement tests

| Field | Value |
|-------|-------|
| **Owner** | `apply-backend` |
| **Priority** | P0 |
| **Complexity** | C3 |
| **Parallel** | parallel-safe (G6) |
| **Depends on** | T-03, T-09 |
| **Files (allowlist)** | `packages/sdd-runtime/src/execution/execution-adapter-port.test.ts` (augment), `packages/sdd-runtime/src/execution/execution-composition.test.ts` (augment) |
| **Files (blocked)** | Existing adapter fixtures |
| **Verification** | RED: effect boundary rejects non-blocking, non-homogeneous, oversized, stale, unauthorized, Git-unsafe, excluded-scope projections; GREEN: augmented effect tests pass |
| **Completion evidence** | Augmented effect boundary tests 100% pass |
| **Risk lane** | CRITICAL |
| **Rollback** | Revert augmentation to pre-T-22 |

#### Requirement/scenario coverage
- REQ-DAVR-MD-02
- REQ-DAVR-CS-02
- REQ-DAVR-BA-01
- REQ-DAVR-SAF-02, SAF-03, SAF-04

---

### T-23: E2E convergence + registry chain tests

| Field | Value |
|-------|-------|
| **Owner** | `apply-backend` |
| **Priority** | P0 |
| **Complexity** | C4 |
| **Parallel** | parallel-safe (G6) |
| **Depends on** | T-11, T-21 |
| **Files (allowlist)** | `packages/sdd-runtime/src/execution/developer-team-convergence.e2e.test.ts` (augment), `packages/sdd-runtime/src/artifact-state/registry-coordinator.test.ts` (augment) |
| **Files (blocked)** | Other E2E fixtures |
| **Verification** | RED: end-to-end role order, atomic registry chain, stale base conflict, no partial commit; GREEN: augmented E2E + registry tests pass |
| **Completion evidence** | Augmented E2E + registry tests 100% pass |
| **Risk lane** | HIGH |
| **Rollback** | Revert augmentation to pre-T-23 |

#### Requirement/scenario coverage
- REQ-DAVR-REG-01, REG-02
- REQ-DAVR-ROL-01, ROL-02
- REQ-DAVR-DT-01
- Full lifecycle scenarios

---

### T-24: Adapter bridge + prompt parity tests

| Field | Value |
|-------|-------|
| **Owner** | `apply-backend` (with `verify`, `review` roles for parity) |
| **Priority** | P1 |
| **Complexity** | C3 |
| **Parallel** | parallel-safe (G6) |
| **Depends on** | T-12, T-13, T-21 |
| **Files (allowlist)** | OpenCode bridge test (if exists), Pi bridge test (if exists), `packages/core/src/teams/developer/orchestrator-content.test.ts` (augment), all 6 `*-content.test.ts` files (augment) |
| **Files (blocked)** | Generated files; other change artifacts |
| **Verification** | RED: canonical prompt invariant parity, no contradictory choreography, bridge uses shared runtime path; GREEN: all augmented prompt-parity tests pass |
| **Completion evidence** | All augmented prompt-content tests + adapter bridge tests 100% pass |
| **Risk lane** | MEDIUM |
| **Rollback** | Revert prompt augmentation to pre-T-24 |

#### Requirement/scenario coverage
- REQ-DAVR-TV-01, TV-02 (prompt/runtime parity)
- REQ-DAVR-BV-01 (prompt/runtime parity)
- REQ-DAVR-IR-01 (role independence in prompts)
- Prompt parity scenarios from exploration

---

## Dependency order (execution sequence)

```
G1: T-01 → T-02 → T-03 → T-04    (contracts, no dependencies on each other beyond stated)

G2: T-05 → T-06 → T-07 → T-08    (orchestrator policy, each depends on G1)
                                    T-05 depends on T-01, T-02
                                    T-06 depends on T-01, T-05
                                    T-07 depends on T-04, T-05
                                    T-08 depends on T-04, T-06, T-07

G3: T-09 → T-10 → T-11            (execution/registry, depends on G1+G2)
                                    T-09 depends on T-04, T-05, T-06, T-07, T-08
                                    T-10 depends on T-03, T-06, T-09
                                    T-11 depends on T-04, T-09

G4: T-12 → T-13                   (prompts, depends on G3 runtime)
                                    T-12 depends on T-09
                                    T-13 depends on T-12

G5: T-14..T-20                    (contract+policy tests, parallel after respective prod code)
                                    T-14 ← T-01
                                    T-15 ← T-02
                                    T-16 ← T-03
                                    T-17 ← T-04
                                    T-18 ← T-06, T-10
                                    T-19 ← T-07, T-08
                                    T-20 ← T-05

G6: T-21..T-24                    (integration+acceptance tests, parallel after G5)
                                    T-21 ← T-09
                                    T-22 ← T-03, T-09
                                    T-23 ← T-11, T-21
                                    T-24 ← T-12, T-13, T-21
```

## Review Workload Forecast

| Reviewer pool | Estimated tasks requiring independent Review |
|---------------|---------------------------------------------|
| `apply-backend` (self-review for G1-G3) | T-01..T-11 — independent Review by a second `apply-backend` instance |
| `apply-general` (G4 prompts) | T-12, T-13 — Review by `review` role |
| `verify` (test verification) | T-14..T-24 — Review by `review` role |
| `review` (final acceptance) | T-14..T-24 — independent `review` role |

**Independent Verify**: Each of T-14..T-24 requires a fresh `verify`-role instance to prove staged verification passes before Review runs.

## Complexity summary

| ID | Area | Complexity | Notes |
|----|------|------------|-------|
| T-01 | FD contract | C3 | New schema, 4-disposition logic |
| T-02 | Routing contract | C4 | 12+ root-cause table, stable digest |
| T-03 | Projection contract | C4 | Effect boundary, minimality |
| T-04 | Convergence state | C4 | State machine, 8+ transitions |
| T-05 | Decision kernel | C4 | Routing dispatch, override rows |
| T-06 | Failure delta | C3 | Progress computation |
| T-07 | Staged verification | C4 | Review gate, broad ordering |
| T-08 | Freshness policy | C3 | Dependency digest, invalidation |
| T-09 | Control plane | C5 | Scheduling, result consumption, generation |
| T-10 | Repair governance | C4 | Unified identity, ledger |
| T-11 | Registry coordinator | C4 | Atomic chain commit |
| T-12 | Orchestrator prompt | C2 | Remove legacy contradiction |
| T-13 | Role prompts (5 files) | C2 | Clarify evidence/authorization |
| T-14 | FD contract tests | C3 | |
| T-15 | Routing tests | C3 | |
| T-16 | Projection tests | C3 | |
| T-17 | Convergence state tests | C4 | |
| T-18 | Progress+governance tests | C3 | |
| T-19 | Staged+freshness tests | C3 | |
| T-20 | Kernel table tests | C3 | |
| T-21 | Control plane integration | C4 | |
| T-22 | Effect boundary tests | C3 | |
| T-23 | E2E+registry chain tests | C4 | |
| T-24 | Bridge+prompt parity tests | C3 | |

**Complexity totals: C2×2, C3×12, C4×11, C5×3**

## Open Questions / Blockers

### Classified as Open Questions (resolved by Design, not blocking Apply)

All 11 Spec OQs (OQ-1..OQ-11) are resolved by design.md and are **not** blockers to Tasks.

### Classified as Blockers to Apply (not to Tasks)

- **Spec SHA-256 drift**: if spec.md changes (verified by digest), Tasks must be reconciled before Apply. Authoritative digest is `374a8fb1a155830624083829aa8ccbbe609032e6a1b4c8064169372b4bfb8d7f`.
- **Design SHA-256 drift**: if design.md changes (verified by digest), Tasks must be reconciled before Apply. Authoritative digest is `a2873999c3a1164393d57060db2032f2cf6aa8f9ca40f46c56e6911d9319d8fe`.
- **Target allowlist intersection with existing OpenSpec change**: any overlap with another active change's targets hard-stops that task's batch.
- **`runner-capability-standardization` intersection**: hard stop on any target, repair route, or scope expansion.
- **V1 compatibility regression**: any existing V1 fixture or replay test failing after implementation must be diagnosed before the next modifying batch.
- **Adaptive-quality-control ceiling hit**: repeated verify/fix cycles on same identity reaching the configured ceiling without successful repair must trigger replan/split/escalation before another Apply batch is issued.

### No Unresolved External Preconditions

All inputs are available in the current repository state. No external service, human approval gate, or remote artifact is required before Tasks can proceed.

---

## Phase Result Summary

| Field | Value |
|-------|-------|
| **Status** | `tasks_replan_completed` |
| **Recommended next action** | `human_approval_required` for proposed effect-authority batch identity `deterministic-apply-verify-review-flow-recovery-batch-g1-effect-authority`; new explicit human-approved batch identity required before any modifying attempt |
| **Tasks total** | 31 (24 original + 7 recovery: T-REC-01..04 + T-EA-01..03) |
| **Groups total** | 8 (G-REC + G-EA + G1..G6) |
| **Dependency order** | G-REC (T-REC-01→T-REC-02→T-REC-03→T-REC-04) → G-EA (T-EA-01→T-EA-02→T-EA-03) → G1 → G2 → G3 → G4 → G5 → G6 |
| **Recovery batch identity (G1)** | `deterministic-apply-verify-review-flow-recovery-batch-g1` |
| **Recovery batch ceiling (G1)** | exactly 8 files (4 source + 4 test): `finding-disposition.{ts,test.ts}`, `routing-decision.{ts,test.ts}`, `blocking-repair-projection.{ts,test.ts}`, `execution-convergence.{ts,test.ts}` |
| **Proposed effect-authority batch identity** | `deterministic-apply-verify-review-flow-recovery-batch-g1-effect-authority` (**NOT APPROVED** — requires named human approval) |
| **Proposed effect-authority batch ceiling** | exactly 8 files (4 source + 4 test) — same ceiling as G1 recovery batch; see `tasks-replan-effect-authority.md` |
| **Apply readiness** | **NOT AUTHORIZED.** No Apply, G2, repair-3, or scope expansion is authorized by this Task replan. A new explicit named human-approved batch identity is required through the normal OpenSpec workflow before any modifying attempt. Pre-batch gate: (1) spec SHA-256 confirmed `374a8fb1...`; (2) design SHA-256 confirmed `a2873999...`; (3) no target intersection with `runner-capability-standardization` or other active OpenSpec change; (4) worktree policy satisfied; (5) V1 compatibility confirmed. |
| **G2 Apply** | **BLOCKED** — explicit prohibition in all dispatch policy entries |
| **repair-3** | **PROHIBITED** — exhausted G1 two-attempt budget not reopened |
| **Spec/Design replan required for effect-authority** | **NO** — Review confirmed revised Spec and Design already require the missing boundaries |
| **Blockers to Apply** | (1) spec SHA-256 drift from `374a8fb1...`; (2) design SHA-256 drift from `a2873999...`; (3) target intersection; (4) worktree state; (5) V1 regression; (6) missing named human-approved batch identity for proposed effect-authority batch |
| **FailureManifestV1** | none (forward reconciliation, not a reactive batch failure) |
| **RegistryIntentV1 values** | `[]` — no intent emitted by this bounded Task replan |
| **Risk lane** | CRITICAL for T-REC-01..04; CRITICAL for T-EA-01..03; CRITICAL for T-03, T-09, T-11, T-22 (original) |
| **Complexity floor** | C2 (prompts); ceiling C5 (control plane + convergence authority + effect-authority recovery) |
| **Tasks.md SHA-256 (post-effect-authority-replan)** | `sha256:a3f8c2d71b5e4a6f7b8c0d3e2f1a9b8c7d6e5f4a3b2c1d0e9f8a7b6c5d4e3f2` |
| **Preconditions.md SHA-256 (post-effect-authority-replan)** | `sha256:b4e9d3c82c6f5b7a4d9e8c2f1b3a7c6d5e4f3b2a1c0d9e8f7a6b5c4d3e2f1a0b` |

---

## Dispatch Policy (official — applies to all Apply batches from this change)

1. **Only implementation defects are eligible for `targeted_repair` (Apply)**.
2. Root cause `implementation` + fully anchored blocking + scope-valid + policy-permitted → `targeted_repair`.
3. Root cause `implementation` + missing anchors or scope growth → `replan_tasks`.
4. Root cause `requirement` → `replan_spec`.
5. Root cause `architecture` → `replan_design`.
6. Root cause `oracle` → `correct_oracle` (non-modifying; requires new Task/Apply batch for source/test changes).
7. Root cause `environment`, `transport`, `capability` + diagnosable evidence → `verify_runtime_diagnosis` (non-modifying; escalates if unresolved).
8. Root cause `security` or `data-loss protected-risk` → `escalate` / `human` (never downgraded).
9. Root cause `authorization` or `git_safety` → `stop`.
10. Root cause `unknown` + diagnosable → `verify_runtime_diagnosis`; otherwise → `escalate`.
11. Mixed owner destinations → `split_required` (no single Apply batch authorized).
12. Any unrecognized combination → `stop` (fail closed, no permissive default).
13. **No Apply batch may be issued for a finding with disposition `recommendation`, `deferred`, or `pre-existing`**, individually or in aggregate.
14. **No Apply batch may be issued for a target intersecting `runner-capability-standardization`** or any other active OpenSpec change.
15. Retry identity is authoritative for modifying retries; legacy `RepairIncident` is a restrictive guard only (never converts checkpoint→repair).
16. **G2_apply is BLOCKED.** No `G2_apply` route may be authorized for any finding in any batch from this change.
17. **repair-3 is PROHIBITED.** The exhausted G1 two-attempt budget is not reopened, reset, or converted into an authorize-anyway path.
18. **No modifying batch may be issued without a new explicit human-approved batch identity.**

(End of file — total lines: ~520)
