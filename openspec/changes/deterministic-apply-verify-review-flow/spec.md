# Spec: Deterministic Apply → Verify → Review Flow

- **Change ID:** `deterministic-apply-verify-review-flow`
- **Execution mode:** Automatic
- **Risk level:** High
- **Authoritative inputs:** `proposal.md`, `exploration.md`, `openspec/config.yaml`, `openspec/registry-schema.md`, promoted specs (`adaptive-quality-control`, `artifact-state-contracts`, `runner-orchestration-resilience`), `openspec/baseline-health.yaml`, and current runtime contracts referenced below as runtime evidence.
- **Scope authority:** This Spec defines WHAT observable behavior MUST hold. It does not select data structures, file layouts, public interfaces, libraries, or task routing. Exact contract shapes, state transitions, and source targets belong to Design and Tasks and MUST be converted into an authorized batch before any modification.

## Conventions

- Requirement IDs are stable and of the form `REQ-DAVR-{area}-NN`.
- RFC 2119 keywords are used with their normative meaning: **MUST** (absolute), **SHALL** (absolute), **SHOULD** (strong recommendation), **MAY** (optional).
- "Finding" means a normalized `FailureFindingV1`-equivalent record produced by Apply, Verify, or Review.
- "Disposition" means the post-normalization classification introduced by this change.
- "Blocking finding" means a finding whose disposition is exactly `blocking` and that is anchored to at least one requirement ID, task ID, and check identity within the current authorized batch.
- Runtime evidence references (`packages/sdd-runtime/src/...`) identify the current state at Spec time and are NOT authorization to modify those files; they ground requirement observability.

## Requirement areas and dependencies

Areas: FD (Finding Disposition), BA (Blocker Authorization), MD (Minimal Dossier), RD (Root-cause Destinations), CS (Constrained Repair Scope), IR (Independent Roles), TV (Targeted Verify before Review), BV (Broad Verify final gate), RV (Scoped Revalidation), OF (Opportunistic Findings), RG (Retry Governance), DT (Decision Table reproducibility), COMP (Compatibility), SEC (Security), IEV (Invalid Evidence), SAF (Safety floors), REG (Registry centralized control), ROL (Rollback).

Cross-area hard dependency: BA depends on FD; MD depends on BA; RD depends on FD; CS depends on MD and RD; TV depends on IR; BV depends on TV and RV; RV depends on MD.

G1 replan additions (authority floors added after exhausted G1 repair governance): REQ-DAVR-FD-03 depends on FD-01 and SEC-02; REQ-DAVR-SEC-03 depends on SEC-02 and RD-01; REQ-DAVR-RG-05 depends on RG-01; REQ-DAVR-MD-03 depends on MD-02 and RG-05; REQ-DAVR-BV-03 depends on BV-02 and RV-01; REQ-DAVR-REG-03 depends on REG-02. These floors are stricter authority boundaries only and do not relax any prior requirement.

---

## FD — Four-way finding disposition

> Grounding: current `FailureFindingV1.status` is `open | resolved | pre_existing | out_of_scope` and has no `blocking | recommendation | deferred | pre-existing` disposition (`packages/sdd-runtime/src/contracts/failure-manifest.ts:4-8`). Current relationship is `batch_related | unrelated_baseline` (`failure-manifest.ts:4`). There is no deterministic mapping from severity/status to the requested dispositions.

### REQ-DAVR-FD-01: Disposition is a total, machine-enforced classification

Every normalized finding produced by Apply, Verify, or Review MUST be classified into exactly one disposition from the ordered set `{ blocking, recommendation, deferred, pre-existing }`. The classification MUST be deterministic from authoritative inputs only (root cause, requirement/task anchors, oracle identity, location keys, batch identity, and lane/safety policy) and MUST NOT depend on human prose, severity text, producer agent identity, or timestamps. A finding that cannot be deterministically classified SHALL be treated as `blocking` until a valid non-`blocking` classification is proven; the system MUST NOT default a legitimately blocking finding to a non-`blocking` disposition to avoid repair.

- **Priority:** MUST
- **Evidence boundary:** observable as classification output for any input finding; rejecting ambiguity MUST be testable.

#### Scenario: Each disposition is reachable

- GIVEN findings with distinct root causes, anchors, and baseline relationships
- WHEN dispositions are computed for the set
- THEN each of the four dispositions is produced for at least one finding and no finding carries two dispositions

#### Scenario: Classification is stable across reruns

- GIVEN the same authoritative inputs (root cause, anchors, oracle, batch identity, policy) and different producer agent identity, prose summary, and timestamps
- WHEN dispositions are computed twice
- THEN each corresponding finding receives the same disposition and the same stable finding identifier

#### Scenario: Ambiguous finding defaults to blocking

- GIVEN a finding's authoritative inputs are insufficient to prove a non-`blocking` disposition
- WHEN disposition is computed
- THEN the finding is classified `blocking` and is eligible for routing under REQ-DAVR-RD-01

### REQ-DAVR-FD-02: Disposition interprets existing fields without reinterpreting them

The disposition classification SHALL be expressible additively over existing `FailureFindingV1`-equivalent semenatics. The existing `status` and `relationship` fields MUST remain valid and readable by any current reader; the disposition MUST NOT silently reassign meaning to an existing enum value in a way that changes historical evidence interpretation. A stored V1 finding without a disposition MUST project to a deterministic disposition without losing its prior identifier or stored digest.

- **Priority:** MUST

#### Scenario: Existing V1 finding projects to a disposition

- GIVEN a stored V1 finding with `status: "open"` and `relationship: "batch_related"` and no explicit disposition field
- WHEN a disposition is projected for historical/compatibility purposes
- THEN the projected disposition is deterministic and the original finding identifier and stored digest are unchanged

#### Scenario: Pre-existing baseline finding is pre-existing

- GIVEN a finding with `relationship: "unrelated_baseline"` and `status: "pre_existing"`
- WHEN the disposition is computed
- THEN the disposition is `pre-existing` and the finding is excluded from repair authorization

#### Scenario: Unrelated baseline cannot become blocking by reclassification alone

- GIVEN an `unrelated_baseline` finding whose exact baseline fingerprint matches `openspec/baseline-health.yaml`
- WHEN dispositions are computed
- THEN the finding remains `pre-existing` regardless of severity and cannot authorize any repair

### REQ-DAVR-FD-03: Protected-risk evidence is a mandatory authoritative classification input

The finding's protected-risk classification (a `security` root cause, a data-loss-risk classification, or an authoritative security-relevant finding field) MUST be a mandatory authoritative input to disposition classification. Disposition classification MUST NOT be computed from caller-supplied requirement/task/check lists alone when authoritative per-finding protected-risk evidence is present. A finding whose authoritative evidence marks it security-relevant or data-loss-relevant MUST be classified `blocking` regardless of any advisory check classification, defer reference, or caller-supplied policy flag. A caller-supplied false or omitted protected-risk flag MUST NOT downgrade an authoritative protected-risk finding to `recommendation`, `deferred`, or `pre-existing`, and MUST NOT let an advisory check policy override it. Missing or conflicting protected-risk evidence MUST fail safely to `blocking` per REQ-DAVR-FD-01, never to a non-`blocking` disposition.

- **Priority:** MUST
- **Evidence boundary:** observable as the classification result for any finding carrying authoritative protected-risk evidence; a caller-override downgrade MUST be independently reproducible as rejected.

#### Scenario: Security finding under advisory policy remains blocking

- GIVEN a finding with authoritative root cause `security` and `isSecurityRelevant: true` presented under an advisory check policy that would otherwise classify it `recommendation`
- WHEN disposition is computed
- THEN the finding is classified `blocking`, the advisory classification does not downgrade it, and it is eligible for protected-risk routing under REQ-DAVR-SEC-02 and REQ-DAVR-SEC-03

#### Scenario: Omitted caller flag cannot downgrade data-loss risk

- GIVEN a finding whose authoritative evidence marks a data-loss risk, while caller-supplied policy risk flags are false or omitted
- WHEN disposition is computed
- THEN the finding is classified `blocking` and the omitted/false caller flags do not change the protected-risk classification

#### Scenario: Conflicting protected-risk evidence fails to blocking

- GIVEN a finding whose authoritative protected-risk evidence is conflicting or ambiguous
- WHEN disposition is computed
- THEN the finding is classified `blocking` and no advisory classification authorizes a non-`blocking` disposition

---

## BA — Objective blocker authorization

### REQ-DAVR-BA-01: Only anchored blocking findings authorize modifying repair

A modifying repair (any work that changes source, tests, or generated outputs through Apply) MUST be authorized by at least one finding whose disposition is `blocking` AND that is anchored to at least one requirement ID, at least one task ID, and at least one check identity that belong to the current authorized batch. Dispositions `recommendation`, `deferred`, and `pre-existing` SHALL NOT authorize modifying repair, either individually or in aggregate, and MUST NOT be combined to produce repair authorization. The absence of blocking findings MUST NOT produce repair; it MUST produce completion, checkpoint, diagnosis, replan, or escalation per RD and RG.

- **Priority:** MUST

#### Scenario: Blocking finding authorizes targeted repair

- GIVEN one anchored `blocking` finding whose root cause is `implementation`
- WHEN authorization for modifying repair is evaluated
- THEN exactly that finding's anchors are eligible as repair targets and no other finding's anchors are added implicitly

#### Scenario: Recommendation does not authorize repair

- GIVEN a set containing only `recommendation` findings
- WHEN authorization for modifying repair is evaluated
- THEN no modifying repair is authorized and the lifecycle advances to completion, diagnosis, replan, or escalation per other findings

#### Scenario: Deferred and pre-existing do not authorize repair

- GIVEN a set containing `deferred` and `pre-existing` findings only, including an `unrelated_baseline` pre-existing baseline failure
- WHEN authorization for modifying repair is evaluated
- THEN no modifying repair is authorized, none of these findings become targeted repair inputs, and the pre-existing baseline failure receives no repair credit

### REQ-DAVR-BA-02: Authorization is objective and reproducible

The decision "is modifying repair authorized for finding F in batch B under policy P" MUST be a pure function of (F's disposition and anchors, B's allowed/blocked targets and obligations, P's lane and safety floors). It MUST produce the same authorization result for identical inputs across reruns and MUST NOT depend on which agent produced F or F's summary text.

- **Priority:** MUST

#### Scenario: Authorization is reproducible

- GIVEN identical F, B, and P produced by two different producer identities
- WHEN authorization is evaluated twice
- THEN both evaluations produce the identical authorization decision and the identical ordered rationale codes

---

## MD — Blocking-only minimal Apply dossier

> Grounding: `ApplyBatchContractV1` and `ExecutionDossierV1` currently carry the full issued batch and full current manifest with no machine-validated blocking-only projection (`packages/sdd-runtime/src/contracts/apply-batch.ts:2-22`; `execution-dossier.ts:21-43`). "Minimal Apply dossier" is currently prompt intent, not an enforceable boundary.

### REQ-DAVR-MD-01: Repair inputs are minimal to selected blocking work

An authorized repairing Apply input MUST contain only the selected blocking finding IDs, their exact requirement/task/check anchors, the allowed target set, the required acceptance check identities, causal evidence references, the prior decision digest, the stable failure identity, the attempt number, and the authorization reference. It MUST reference — but MUST NOT copy or mutate — the original authorized batch or manifest. Any element not derivable from the selected blocking findings and the original authorization MUST be absent from the repair input.

- **Priority:** MUST

#### Scenario: Minimal dossier contains only blocking-derived elements

- GIVEN three open findings: one `blocking` (implementation root, anchored), one `recommendation`, and one `deferred`
- WHEN a repairing Apply input is built from the blocking finding
- THEN the input contains the blocking finding's anchors, target set, and acceptance checks and contains no anchor, target, or check introduced by the recommendation or deferred finding

#### Scenario: Repair input does not mutate the original batch

- GIVEN an authorized batch B and a selected blocking finding F
- WHEN a repairing Apply input is built
- THEN B's batch identity and digest are unchanged by the construction and B's allowed/blocked target lists are not mutated

### REQ-DAVR-MD-02: Oversized or mismatched repair input is rejected at the effect boundary

The runtime effect boundary MUST reject a repairing Apply input when (a) it contains any target, check, or anchor not derivable from its selected blocking findings, (b) its allowed target set intersects the original batch's blocked targets, or (c) its authorization reference does not match the producing decision's authorization. Rejection MUST be fail-closed: no modification is performed and the rejection produces an `invalid-evidence` outcome with deterministic rationale codes.

- **Priority:** MUST

#### Scenario: Oversized target set is rejected

- GIVEN a repairing Apply input that adds a target not anchored to any selected blocking finding
- WHEN the effect boundary validates the input
- THEN the input is rejected, no modification occurs, and a deterministic rejection reason is recorded

#### Scenario: Authorization mismatch is rejected

- GIVEN a repairing Apply input whose authorization reference disagrees with the producing decision's authorization
- WHEN the effect boundary validates the input
- THEN the input is rejected and no modification occurs

### REQ-DAVR-MD-03: Retry identity and attempt bindings are recomputed and equal-verified at parse and effect boundaries

Parsing a blocking repair projection MUST recompute the retry identity from authoritative inputs and compare it for exact equality against the projection's carried identity; it MUST NOT merely assert that the identity is digest-shaped. The runtime effect boundary MUST recompute the retry identity and compare it for exact equality before authorizing the effect, in addition to the target/check/anchor/evidence derivation checks of REQ-DAVR-MD-02. The projection's attempt number and prior-attempt binding MUST be validated against the current convergence ledger before effect authorization. A validly rehashed projection whose carried identity, attempt number, or prior-attempt binding has been replaced or detached MUST be rejected fail-closed with an `invalid-evidence` outcome and deterministic rationale codes, and no modification occurs.

- **Priority:** MUST

#### Scenario: Forged retry identity is rejected at parse

- GIVEN a projection whose carried retry identity was replaced and the projection was then validly rehashed
- WHEN the projection is parsed
- THEN the parser recomputes the identity from authority, the equality check fails, and the projection is rejected

#### Scenario: Forged retry identity is rejected at effect boundary

- GIVEN a projection whose carried identity still disagrees with the recomputed identity after a valid rehash
- WHEN the effect boundary validates the projection
- THEN the recomputed identity mismatch is detected, the projection is rejected with `invalid-evidence`, and no modifying effect is authorized

#### Scenario: Detached attempt ledger binding is rejected

- GIVEN a projection whose attempt number or prior-attempt digest does not match the current convergence ledger
- WHEN the effect boundary validates the projection
- THEN the binding is rejected, the attempt is not credited or advanced, and no modifying effect is authorized

---

## RD — Deterministic root-cause destinations

> Grounding: current action vocabulary combines Design and Task as `replan_design_or_tasks` and uses the generic `diagnose_runtime` (`packages/sdd-runtime/src/orchestrator/decision-kernel.ts:57-75`). There is no distinct Verify-runtime diagnosis destination. Routing today routes authorization/Git failures to stop, security/data-loss to escalate, requirement to replan_spec, architecture/batch-shape to combined Design-or-Tasks, oracle to correct_oracle, environment/transport/capability/unknown to diagnose_runtime (`decision-kernel.ts:52-75`).

### REQ-DAVR-RD-01: Total root-cause-to-destination routing table

For every blocking finding the lifecycle MUST deterministically route its root cause to exactly one destination from the ordered set `{ targeted_repair (Apply), replan_spec, replan_design, replan_tasks, verify_runtime_diagnosis, correct_oracle, escalate, stop }`. The mapping MUST be a total function of the finding's root cause, protected-risk classification, lane/safety policy, and progress evidence — not producer identity or prose. Whether Design and Task are two stable codes or one code with a mandatory deterministic owner field is a Design decision; either way, the routing MUST be unambiguous and reproducible.

- **Priority:** MUST

#### Scenario: Total coverage of root causes

- GIVEN the full set of recognized root causes from current runtime (`implementation`, `environment`, `transport`, `capability`, `oracle`, `requirement`, `architecture`, `batch_shape`, `authorization`, `security`, `git_safety`, `unknown`)
- WHEN each is routed as a blocking finding under identical policy
- THEN every root cause maps to exactly one destination in the ordered set and no root cause is left unrouted

#### Scenario: Security and data-loss root causes route to escalation

- GIVEN a `blocking` finding whose root cause is `security` or whose protected-risk classification marks a data-loss risk
- WHEN it is routed
- THEN the destination is `escalate` and it is never routed to `targeted_repair`

#### Scenario: Authorization and Git-safety root causes route to stop

- GIVEN a `blocking` finding whose root cause is `authorization` or `git_safety`
- WHEN it is routed
- THEN the destination is `stop` and no modifying repair occurs

#### Scenario: Environment/transport/capability route to diagnosis, not blind repair

- GIVEN a `blocking` finding whose root cause is `environment`, `transport`, or `capability`
- WHEN it is routed
- THEN the destination is `verify_runtime_diagnosis` (or escalation when diagnosis cannot resolve evidence) and it is never routed to `targeted_repair` based solely on this root cause

### REQ-DAVR-RD-02: Mixed-owner blocking sets are split, never batched into one repair

When two or more selected blocking findings require different destinations, the lifecycle MUST NOT merge them into a single `targeted_repair` batch. It MUST split owners deterministically (replan/split) and route each homogeneous subset to its single owner. Mixed owners or a changed root-cause owner during a retry MUST forbid blind repair and trigger replan or escalation.

- **Priority:** MUST

#### Scenario: Mixed owners force replan/split

- GIVEN two anchored `blocking` findings, one with root cause `implementation` and one with root cause ` architecture`
- WHEN routing is computed
- THEN no single `targeted_repair` batch is authorized and a replan/split outcome is produced with deterministic rationale codes

---

## CS — Constrained repair scope

### REQ-DAVR-CS-01: Repair scope cannot broaden without replan

A modifying retry MUST NOT broaden its target set, check set, obligations, or oracle beyond the prior attempt's identity without producing a new planned dossier/batch projection. A changed blocking set, owner, target set, obligation, or oracle MUST create a new identity and MUST NOT be counted as progress on the prior identity. The lifecycle MUST reject a retry whose inputs imply scope growth without an authorizing replan.

- **Priority:** MUST

#### Scenario: Broadened target set is not progress

- GIVEN a prior repair identity I1 over target set T1 and a new attempt over T1 ∪ {extra}
- WHEN the new attempt's identity and progress are computed
- THEN a new identity is created, the new attempt is not counted as progress for I1, and no blind retry proceeds without replan

#### Scenario: Changed owner creates a new identity

- GIVEN a prior repair identity I1 owned by `targeted_repair` and a new attempt routed to `replan_design`
- WHEN the new attempt is evaluated
- THEN a new identity is created and I1's attempt accounting is not credited to the new attempt

### REQ-DAVR-CS-02: Repair is restricted to its authorized targets

A targeted repair MUST only modify locations and checks derivable from its selected blocking findings and original authorized batch's allowed targets. It MUST NOT modify files, checks, or obligations outside that set even if a non-blocking finding suggests them.

- **Priority:** MUST

#### Scenario: Out-of-target modification is rejected

- GIVEN a targeted repair input that proposes to modify a location not in its allowed-target set
- WHEN the effect boundary validates the modification
- THEN the modification is rejected and no change is applied

---

## IR — Independent roles

> Grounding: freshness policy rejects Apply/Verify identity collisions, Review collisions, stale post-modification Verify, and missing fresh Review triggers (`packages/sdd-runtime/src/orchestrator/freshness-policy.ts:18-88`). Verify/Review causal projection strips Apply attempt summaries (`freshness-policy.ts:91-105`). Role results are bound to invocation/batch/dossier/decision/verification digests (`execution-control-plane.ts:479-627`).

### REQ-DAVR-IR-01: Apply, Verify, and Review are independent identities and judgments

Apply, Verify, and Review MUST be produced by independent role instances with distinct identities. Shared evidence (causal projections) MUST NOT transfer agent identity, attempt summaries, or conclusions between roles. Verify MUST not inherit Apply's identity or attempt summaries; Review MUST not inherit Apply's or Verify's identity or attempt summaries. An Apply/Verify identity collision, a Review identity collision, a stale post-modification Verify, or a missing fresh Review trigger MUST fail closed.

- **Priority:** MUST

#### Scenario: Identity collision is rejected

- GIVEN a Verify invocation whose instance identity equals the Apply instance identity for the same batch
- WHEN freshness policy validates the role result
- THEN the result is rejected and no verification advancement occurs

#### Scenario: Attempt summaries are not shared

- GIVEN an Apply dossier containing attempt summaries for a prior repair
- WHEN Verify and Review causal projections are computed
- THEN neither projection carries Apply's attempt summaries into its bound evidence

#### Scenario: Stale post-modification Verify fails closed

- GIVEN a Verify result produced before a modification that invalidates it
- WHEN the modification is applied and the stale Verify result is presented
- THEN the stale result is rejected and fresh scoped revalidation is required per RV

### REQ-DAVR-IR-02: Role independence is preserved under causal evidence sharing

Sharing causal evidence references between roles MUST NOT cause one role's conclusion or identity to substitute for another's. Each role's conclusion MUST be independently reproducible from its own inputs and the deterministic policy.

- **Priority:** SHALL

#### Scenario: Review cannot adopt Verify's conclusion as its own

- GIVEN a Verify conclusion that asserts "no blockers" and a Review that references the same causal evidence
- WHEN Review runs independently
- THEN Review's conclusion is recomputed from its own inputs and is not simply copied from Verify's conclusion

---

## TV — Targeted → affected-area Verify before Review

> Grounding: staged verification is canonicalized as `targeted → affected_area → broad`; out-of-order transitions, failed-stage advancement, missing evidence, and unauthorized broad deferral fail closed (`packages/sdd-runtime/src/orchestrator/staged-verification.ts:107-214`). Targeted cannot be omitted (`staged-verification.ts:139-141`). Current scheduler schedules Review only when verification is `complete` (`execution-control-plane.ts:392-477`; scheduler test states "schedules independent Review only after staged verification completes" at `execution-role-scheduler.test.ts:181-194`). Review before broad is currently impossible at runtime.

### REQ-DAVR-TV-01: Independent targeted Verify runs before affected-area Verify

A distinct Verify instance MUST run the targeted stage and emit normalized findings before the affected-area stage runs. Targeted MUST NOT be omitted. The affected-area stage MUST be a deterministically derived set, not a free-form choice, and MUST run only after targeted has passed (or is otherwise terminal-acceptable).

- **Priority:** MUST

#### Scenario: Targeted must precede affected-area

- GIVEN a fresh batch after Apply
- WHEN staged verification begins
- THEN the targeted stage runs first and the affected-area stage does not advance while targeted is still pending or failed

#### Scenario: Affected-area check set is deterministic

- GIVEN the same targeted findings and batch dependency graph
- WHEN the affected-area check set is computed twice
- THEN both computations produce the identical check set and order

#### Scenario: Targeted cannot be skipped

- GIVEN a transition that attempts to skip the targeted stage
- WHEN staged verification validates the transition
- THEN the transition is rejected with the targeted-mandatory floor reason

### REQ-DAVR-TV-02: Review runs only after targeted and affected-area pass

Review MUST NOT be scheduled while any scoped (targeted or affected-area) verification stage is pending, failed, or not yet at a terminal-accepted state. The lifecycle MAY define a stable intermediate gate "scoped passes; Review stable; broad pending" without introducing any new OpenSpec phase. Review authorization MUST require all scoped stages at terminal-accepted and a fresh Review trigger.

- **Priority:** MUST

#### Scenario: Review blocked while scoped verification is incomplete

- GIVEN targeted has failed and affected-area has not run
- WHEN Review scheduling is evaluated
- THEN Review is not scheduled and a scoped-reverification requirement is recorded

#### Scenario: Review scheduled at the scoped gate

- GIVEN targeted and affected-area are both at terminal-accepted and a fresh Review trigger exists
- WHEN Review scheduling is evaluated
- THEN Review is scheduled and the broad stage remains pending and is not required for this Review

### REQ-DAVR-TV-03: Review may add anchored blocking findings only

Review MAY add new findings. Any new Review-discovered finding that warrants changing work MUST be classified `blocking` and anchored per BA before it can authorize repair. Review MUST NOT escalate optional/opportunistic non-`blocking` findings into repair authorization.

- **Priority:** MUST

#### Scenario: Review adds a blocking finding

- GIVEN a Review that discovers a new finding whose root cause is `architecture`
- WHEN the finding is classified
- THEN it is `blocking`, anchored, and routed per RD; it is eligible to authorize the next repair/replan

#### Scenario: Review optional finding is non-authorizing

- GIVEN a Review that surfaces a `recommendation` finding
- WHEN authorization for repair is evaluated
- THEN no modifying repair is authorized based on that finding

---

## BV — Final broad Verify after stability and valid freshness

> Grounding: broad omission is rejected when lane is `full_sdd` or `mandatoryBroadReasons` is non-empty (`staged-verification.ts:142-145`). The legacy/full prompt says Verify and Review run in parallel after Apply (`packages/core/src/teams/developer/orchestrator-content.ts:713-719`), contradicting the requested order.

### REQ-DAVR-BV-01: Broad Verify runs after scoped verification and Review are stable

Broad verification MUST run after (a) targeted and affected-area are at terminal-accepted and (b) Review has no unresolved blocking findings. Broad MUST NOT be skipped while a mandatory broad floor applies. Any mandatory Full-SDD, security, authorization, or data-loss floor case MUST always run broad and MUST NOT be deferred by the new sequencing.

- **Priority:** MUST

#### Scenario: Broad runs after scoped and Review stable

- GIVEN targeted and affected-area pass and Review has no unresolved `blocking` findings
- WHEN the lifecycle selects the next verification stage
- THEN broad verification runs

#### Scenario: Broad cannot be skipped under a mandatory floor

- GIVEN a `full_sdd` lane or a non-empty `mandatoryBroadReasons` policy and an attempt to omit broad
- WHEN the omission transition is validated
- THEN the omission is rejected with the broad-mandatory floor reason

#### Scenario: Mandatory floors remain mandatory under the new order

- GIVEN any change in scoped/review ordering introduced by this change
- WHEN broad-deferral eligibility is evaluated against each Full-SDD, security, authorization, and data-loss mandatory case
- THEN each mandatory floor case still requires broad verification and is never deferred

### REQ-DAVR-BV-02: Modification after broad invalidates broad evidence

Any modification that occurs after a broad evidence snapshot has been captured MUST invalidate that broad evidence. Completion MUST NOT be produced from a broad evidence snapshot whose dependency digest has changed since capture. A fresh broad Must rerun (or be deterministically validated as unchanged) before completion.

- **Priority:** MUST

#### Scenario: Post-broad modification invalidates completion

- GIVEN a captured broad snapshot that passed and a later modification whose dependency digest differs from the snapshot's
- WHEN completion is evaluated
- THEN the captured broad snapshot is treated as invalid and completion is blocked until broad is rerun

#### Scenario: Completion requires valid broad evidence

- GIVEN zero blocking findings, accepted scoped and Review evidence
- WHEN completion is evaluated
- THEN completion is produced only if broad evidence is at terminal-accepted and its dependency digest matches the current state

### REQ-DAVR-BV-03: Accepting convergence events bind to stage-typed current-generation evidence with matching dependency/subject digest

Every accepting convergence event (including `review_stable`, `broad_accepted`, `registry_committed`, or any completion-eligible transition) MUST be bound to stage-typed, current-generation evidence whose dependency-set digest and implementation-subject digest equal the current convergence state's values. A non-modifying event MUST reject an implementation-subject digest that differs from the current state's unless an explicit, recorded dependency-invalidation is applied. The binding MUST be recomputed at parse/consumption; a content-addressed value that lacks the matching binding MUST fail closed. Completion MUST NOT be reachable while any scoped, Review, or broad evidence is stale, opaque, inherited from a prior subject, or otherwise mismatched to the current state.

- **Priority:** MUST

#### Scenario: Subject drift on non-modifying events blocks advancement

- GIVEN a convergence state whose implementation-subject digest is D1 and a non-modifying `review_stable` event carrying subject digest D2 with no recorded invalidation
- WHEN the event is parsed or consumed
- THEN the event is rejected, the state does not advance, and a deterministic mismatch reason is recorded

#### Scenario: Subject change requires explicit invalidation

- GIVEN a non-modifying event whose subject digest differs from the current state and an explicit recorded dependency-invalidation covering that subject change
- WHEN the event is validated
- THEN the invalidation is applied and the event is accepted or rerun as required, but the subject change is never silently inherited

#### Scenario: Opaque inherited evidence blocks completion

- GIVEN a convergence state that reaches `complete` while scoped, Review, or broad evidence carries a prior-generation or opaque digest not equal to the current state's dependency/subject digest
- WHEN completion is evaluated
- THEN completion is blocked and a deterministic stale-evidence reason is recorded

---

## RV — Scoped revalidation after repair

> Grounding: freshness policy rejects stale post-modification Verify and requires fresh Review triggers (`freshness-policy.ts:18-88`). The exploration's R4 recommends fresh targeted and recomputed affected-area after every repair, reusing evidence only when its dependency digest is valid (`exploration.md:90`).

### REQ-DAVR-RV-01: Repair invalidates stale scoped evidence

Any authorized modifying repair MUST invalidate stale targeted and affected-area evidence whose dependency digest is changed by the repair. Fresh targeted and recomputed affected-area verification MUST pass before Review is reused or rerun, and before broad runs. Evidence whose dependency digest remains valid after the repair MAY be reused deterministically; all other scoped evidence MUST be marked stale.

- **Priority:** MUST

#### Scenario: Repair invalidates dependent scoped evidence

- GIVEN a targeted evidence snapshot S and a repair that changes S's dependency digest
- WHEN the repair completes
- THEN S is marked stale and is not reused for any stage advancement, Review reuse, or broad readiness

#### Scenario: Independent scoped evidence is reused

- GIVEN an affected-area evidence snapshot A whose dependency digest is unchanged by a repair that only touched targeted dependencies
- WHEN scoped revalidation is computed
- THEN A remains valid and is reused deterministically

### REQ-DAVR-RV-02: Review reuse requires unchanged reviewed dependencies

Review MAY be reused after a repair only when the dependency digest of everything Review examined is unchanged by the repair. A Review-discovered `blocking` finding repaired by Apply MUST force a fresh Review unless the dependencies that finding reviewed are provably unchanged. The decision to reuse or rerun Review MUST be deterministic from dependency digests and freshness policy — not from agent convenience.

- **Priority:** SHOULD

#### Scenario: Unchanged dependencies allow Review reuse

- GIVEN a Review that examined dependency set D, a repair that did not change any digest in D
- WHEN Review reuse is evaluated
- THEN Review MAY be reused and the decision is deterministic

#### Scenario: Changed dependencies force fresh Review

- GIVEN a Review-discovered `blocking` finding repaired by an Apply that changed a reviewed dependency
- WHEN Review reuse is evaluated
- THEN Review MUST NOT be reused and a fresh Review is required

---

## OF — Opportunistic finding restrictions

### REQ-DAVR-OF-01: Non-blocking findings are reportable and non-authorizing

`recommendation`, `deferred`, and `pre-existing` findings MUST be reportable in Verify and Review output but MUST NOT enter a repairing Apply input, MUST NOT broaden the target set, and MUST NOT consume retry attempt budget. The lifecycle MUST record them as evidence but MUST NOT credit them as progress toward a blocking identity.

- **Priority:** MUST

#### Scenario: Recommendation is reported but not repaired

- GIVEN a Verify result containing a `recommendation` finding
- WHEN the result is normalized and routing is computed
- THEN the finding is reported in the manifest and does not authorize, broaden, or consume any retry attempt budget

#### Scenario: Pre-existing baseline is excluded from progress

- GIVEN a failure delta including a `pre-existing` unrelated-baseline finding
- WHEN progress is computed
- THEN the pre-existing finding contributes zero positive progress to any blocking identity and does not reduce retry budget

### REQ-DAVR-OF-02: Review-surfaced scope growth requires replan, not opportunistic repair

If Review surfaces new scope that the original batch did not authorize, that scope MUST NOT be repaired opportunistically. It MUST trigger a replan (Spec/Design/Tasks) or be deferred; only an explicitly authorized follow-on batch may act on it.

- **Priority:** MUST

#### Scenario: New Review scope triggers replan, not repair

- GIVEN a Review that identifies a new improvement outside the authorized batch obligations
- WHEN routing is computed for that item
- THEN the item is classified `deferred` or `recommendation` and no targeted repair is authorized for it

---

## RG — Retry governance by stable identity and progress

> Grounding: stable failure identity hashes batch digest, requirements, tasks, category, locations, and oracle — not prose, severity, status, producer, or timestamps (`failure-manifest.ts:24`). `evaluateRepairIncident()` enforces hard/soft incident limits, runtime budgets, per-fingerprint attempt limits, and repair/replan/escalation thresholds with hard-stop precedence (`repair-loop-governance.ts:166-394`). Retry accounting is split between FailureManifest/FailureDelta identity and legacy RepairIncident fingerprint/attempt model (`exploration.md:51-52`). Loop breaker forces replan/split/escalation at the configured ceiling (`adaptive-quality-control/spec.md:57-59`).

### REQ-DAVR-RG-01: Single stable retry identity per blocking set

Each modifying retry MUST be bound to exactly one stable retry identity derived from the ordered selected blocking finding IDs, the selected root-cause owner, the original batch digest, the repair target set, and the required check IDs. The identity MUST NOT depend on prose or agent identity. A changed blocking set, owner, target set, obligation, or oracle MUST create a new identity; it MUST NOT be counted as progress on the old identity.

- **Priority:** MUST

#### Scenario: Identity is stable across reruns

- GIVEN the same selected blocking set, owner, batch digest, target set, and required check IDs produced by two different agents
- WHEN retry identities are computed twice
- THEN both identities are identical

#### Scenario: Changed target set creates a new identity

- GIVEN an identity I1 over target set T1 and a new attempt over a different target set T2
- WHEN the new attempt's identity is computed
- THEN a new identity I2 is produced and is not counted against I1's attempt budget or progress

### REQ-DAVR-RG-02: Modifying retry requires demonstrated positive progress

A modifying retry is eligible only after a valid prior attempt AND demonstrated positive progress: at least one selected blocker resolved, no selected blocker regressed, no new related blocker introduced, no protected-risk increase, and no broadened target/check scope without replan. Same identity plus no progress MUST produce diagnosis or checkpoint once, then replan or escalation per the configured budget. Negative progress, opportunistic scope growth, or a changed root-cause owner MUST forbid blind retry.

- **Priority:** MUST

#### Scenario: Progress authorizes retry

- GIVEN a prior attempt I1 with one selected blocker resolved and none regressed
- WHEN the next attempt's eligibility is evaluated
- THEN an attempt is authorized under I1 with the prior attempt counted

#### Scenario: No progress forbids blind retry

- GIVEN a prior attempt I1 with zero selected blockers resolved and none regressed
- WHEN the next attempt's eligibility is evaluated
- THEN no modifying retry is authorized under I1; the lifecycle produces diagnosis/checkpoint, then replan or escalation per budget

#### Scenario: Negative progress forbids blind retry

- GIVEN a prior attempt I1 with a regressed selected blocker or a new related blocker
- WHEN the next attempt's eligibility is evaluated
- THEN no modifying retry is authorized under I1 and the lifecycle produces replan or escalation

### REQ-DAVR-RG-03: Terminal governance only maintains or increases restrictiveness

Terminal governance (hard/soft incident limits, runtime budgets, per-identity attempt limits, repair/replan/escalation thresholds) MUST maintain or increase restrictiveness across attempts. It MUST NEVER convert no progress into repair. Hard-stop precedence MUST apply over soft thresholds. Exhaustion MUST produce escalation or stop, never silent continuation.

- **Priority:** MUST

#### Scenario: Terminal guard refuses no-progress repair

- GIVEN no-progress evidence and a target action of `targeted_repair`
- WHEN the terminal guard is evaluated
- THEN the action is converted to checkpoint, replan, escalation, or stop and is never left as `targeted_repair`

#### Scenario: Hard budget stops the loop

- GIVEN an identity that has exhausted its hard attempt budget
- WHEN the terminal guard is evaluated for a further attempt
- THEN the outcome is stop or escalation and no further modifying attempt is authorized

### REQ-DAVR-RG-04: Convergence with adaptive quality control

The retry governance MUST integrate with the promoted `adaptive-quality-control` loop breaker: repeated similar verify/fix cycles over the same blocking identity and affected scope MUST force replan, split, or user escalation after the configured ceiling, and MUST NOT classify differently-scoped failures as the same loop.

- **Priority:** MUST

#### Scenario: Same identity repeated cycles trigger replan

- GIVEN repeated verify/fix cycles over the same blocking identity and affected scope reaching the configured ceiling
- WHEN the loop breaker evaluates the next cycle
- THEN another fix attempt is blocked until replan or escalation occurs

#### Scenario: Different scopes are not looped together

- GIVEN failures affecting unrelated scopes and categories
- WHEN cycle history is evaluated
- THEN the loop breaker does not classify them as the same loop

### REQ-DAVR-RG-05: Retry identity is complete and derived from current authoritative policy

The stable retry identity MUST be a deterministic projection of every authoritative Spec/Design field of the selected blocking work: ordered selected blocking finding IDs, homogeneous destination/owner, original batch digest, sorted repair target set, sorted requirement/task/check anchors, acceptance obligations, oracle IDs, mandatory verification-plan check IDs, and the current deterministic policy version. The policy version MUST be derived from current authority, not a hard-coded constant. Any change to a hashed field — including an oracle ID, a mandatory verification-plan check ID, or the policy version — MUST create a new identity and MUST NOT be counted as progress on the old identity. The identity MUST NOT depend on attempt number, prose, timestamps, or producer identity.

- **Priority:** MUST

#### Scenario: Identity includes oracle and verification-plan check IDs

- GIVEN two otherwise identical selected blocking sets where one includes an oracle ID or mandatory verification-plan check ID and the other omits it
- WHEN retry identities are computed
- THEN the two identities differ and the second is not counted as progress for the first

#### Scenario: Policy version is derived from current authority

- GIVEN two projections produced under different current deterministic policy versions
- WHEN retry identities are computed
- THEN the identities differ because the policy version differs, and a hard-coded policy version is not a permitted input

#### Scenario: Completeness change creates a new identity

- GIVEN a prior identity I1 and a new attempt that adds or removes an oracle ID or mandatory verification-plan check ID while preserving all other hashed fields
- WHEN the new identity is computed
- THEN a new identity I2 is produced and is not credited as progress for I1

---

## DT — Reproducible decision table

### REQ-DAVR-DT-01: Identical authoritative inputs produce identical decisions

For identical authoritative inputs (manifest evidence, batch identity, lane and safety policy, authorization, Git-safety state, and freshness state), the lifecycle MUST produce the identical routing destination, retry identity, action, ordered rationale codes, and ordered `RegistryIntentV1` values across reruns and across producers. Human prose, timestamps, and agent identity MUST NOT change the decision.

- **Priority:** MUST

#### Scenario: Deterministic decision replay

- GIVEN a captured authoritative decision input D captured at time T1 and the identical authoritative input captured at T2 with different producer identity and prose summaries
- WHEN decisions are computed for both
- THEN both produce the same action, destination, retry identity, ordered rationale codes, and ordered registry intents

#### Scenario: Order of rationale codes is stable

- GIVEN two decisions with the same action and rationale concept set
- WHEN rationale codes are emitted in both
- THEN the rationale codes appear in the same stable order in both

### REQ-DAVR-DT-02: Decision table is total and gap-free

The routing and progress decision table MUST be total over the recognized root causes, protected-risk classes, lane/safety policies, and progress states. Any input that falls outside recognized inputs MUST fail closed (stop or escalation), not produce an implicit default that authorizes repair.

- **Priority:** MUST

#### Scenario: Unrecognized input fails closed

- GIVEN an authoritative input containing an unrecognized root cause or policy combination
- WHEN the decision is computed
- THEN the action is stop or escalate and no modifying repair is authorized

---

## COMP — Compatibility

### REQ-DAVR-COMP-01: Existing V1 evidence remains readable

The change MUST preserve the meaning, digests, identifiers, and readability of existing `FailureManifestV1`, `ApplyBatchContractV1`, `ExecutionDossierV1`, `RegistryIntentV1`, and existing stored/replayed evidence. Additive versioning or validated projections MUST be preferred over reinterpretation or mutation of V1 values. A stored V1 artifact readable before this change MUST remain readable after it without changing its digest.

- **Priority:** MUST

#### Scenario: Stored V1 manifest remains valid

- GIVEN a stored `FailureManifestV1` from before this change
- WHEN its validation and replay are run after this change
- THEN it remains valid, its digest is unchanged, and its replay output matches its original

#### Scenario: Additive field projection is non-destructive

- GIVEN a reader that does not understand the new disposition field
- WHEN it reads a manifest containing the additive disposition
- THEN the reader ignores the new field and the manifest's prior fields and digest remain valid

### REQ-DAVR-COMP-02: Replay fixtures remain green

Existing replay fixtures and contract matrix tests MUST remain green after this change unless an authorized test artifact explicitly updates an oracle for the new behavior. Any fixture that would break MUST be updated only through an authorized task, and the update MUST preserve the ability to replay prior decisions.

- **Priority:** MUST

#### Scenario: Existing replay fixtures pass

- GIVEN the existing replay and contract matrix fixture set
- WHEN the change is applied
- THEN the fixtures pass without modification unless an authorized task updates a documented oracle

---

## SEC — Security

### REQ-DAVR-SEC-01: Secrets and unsafe diagnostic content remain excluded

Findings, repair inputs, and decisions MUST continue to exclude secrets, unsafe diagnostic content, and unbounded excerpts. Redaction boundaries in the current `failure-manifest.ts` evidence pipeline MUST remain in effect. Disposition and routing MUST NOT introduce a new path that bypasses redaction or safe-content enforcement.

- **Priority:** MUST

#### Scenario: Repair input does not carry secrets

- GIVEN a finding whose evidence excerpt contains a secret-shaped string
- WHEN the repairing Apply input is built
- THEN the secret-shaped content is redacted or rejected and the input carries only safe evidence references

#### Scenario: Decision rationale excludes unsafe content

- GIVEN a finding with unsafe diagnostic content
- WHEN its decision rationale is built
- THEN the rationale codes are safe and deterministic and no unsafe content enters the decision record

### REQ-DAVR-SEC-02: Protected-risk handles never downgrade

A protected-risk (security or data-loss) blocking finding MUST always route to escalation or stop and MUST NOT be downgraded by disposition, retry progress, or sequencing. No aspect of this change MAY lower the threat floor for protected-risk findings.

- **Priority:** MUST

#### Scenario: Protected risk survives a positive-progress retry

- GIVEN a `blocking` finding with a data-loss protected-risk classification and positive progress evidence
- WHEN retry eligibility is evaluated under the new lifecycle
- THEN no targeted repair is authorized for that finding and the destination remains escalation

### REQ-DAVR-SEC-03: Protected-risk dominance is recomputed at every decision boundary and is immune to caller override

At every parse, decision, and effect-consumption boundary the protected-risk classification and its resulting `escalate`/`stop` route MUST be recomputed from authoritative per-finding evidence and mandatory safety policy, not from a carried or caller-supplied value. A recomputed protected-risk result that disagrees with the carried classification or route MUST fail closed. A protected-risk finding MUST route to `escalate` or `stop` and MUST NOT be routed to `targeted_repair` by advisory classification, anchors, retry progress, or sequencing. Caller-supplied false/omitted policy flags MUST NOT alter the recomputed protected-risk result at any boundary. This dominance MUST be reproducible across reruns for identical authoritative inputs.

- **Priority:** MUST

#### Scenario: Recomputed protected-risk overrides advisory route at parse boundary

- GIVEN a disposition or routing envelope whose carried protected-risk classification is absent but whose authoritative finding evidence marks a security risk
- WHEN the envelope is parsed
- THEN protected-risk is recomputed from authority, the finding is routing-classified accordingly, and a carrier that omits it fails closed

#### Scenario: Forged downgrade rehash is rejected at decision boundary

- GIVEN a self-rehashed routing decision that preserves content-addressed integrity but routes a `security` finding to `targeted_repair`
- WHEN the decision is parsed or consumed
- THEN the recomputed protected-risk result disagrees, the decision is rejected as invalid evidence, and no modifying repair is authorized

#### Scenario: Omitted caller flag cannot authorize targeted repair

- GIVEN an anchored `implementation`-rooted finding with authoritative `isSecurityRelevant: true` and caller-supplied risk flags false or omitted
- WHEN routing is computed
- THEN the recomputed protected-risk result routes to `escalate` or `stop`, not `targeted_repair`

---

## IEV — Invalid evidence handling

### REQ-DAVR-IEV-01: Invalid, stale, malformed, ambiguous, or conflicting evidence fails closed

When evidence is invalid, stale, malformed, ambiguous, conflicting, unauthorized, non-progressing, or safety-sensitive, the lifecycle MUST stop rather than silently fall back. Each such condition MUST map to a deterministic fail-closed outcome (reject, checkpoint, diagnosis, replan, stop, or escalation) with stable rationale codes. The lifecycle MUST NOT continue modifying work on invalid evidence.

- **Priority:** MUST

#### Scenario: Malformed manifest is rejected

- GIVEN a manifest that fails the V1 schema or content validation
- WHEN the lifecycle validates it
- THEN the manifest is rejected and no further modification is authorized using it

#### Scenario: Ambiguous runtime evidence routes to diagnosis

- GIVEN a `blocking` finding whose runtime evidence is ambiguous between implementation and environment
- WHEN routing is computed
- THEN the destination is verify_runtime_diagnosis (or escalation if diagnosis cannot resolve), never targeted_repair

#### Scenario: Conflicting base-state evidence stops

- GIVEN registry-intent base-state digests that conflict with current authoritative state
- WHEN registry commit is evaluated
- THEN the commit stops and no central write occurs per REQ-DAVR-REG-01

### REQ-DAVR-IEV-02: Verify-runtime diagnosis destination receives malformed runtime evidence

Where current runtime routes unknown/trans norsport/capability causes to a generic `diagnose_runtime`, this change MUST provide a deterministic destination (verify_runtime_diagnosis) that receives ambiguous runtime evidence for resolution. If diagnosis cannot resolve the evidence, escalation MUST follow. Verify-runtime diagnosis MUST NOT itself authorize modifying repair; only a validated blocking finding routed to targeted_repair may do so.

- **Priority:** MUST

#### Scenario: Ambiguous runtime evidence reaches diagnosis

- GIVEN a `blocking` finding with root cause `transport` and ambiguous artifact validity
- WHEN routing is computed
- THEN the destination is verify_runtime_diagnosis and not targeted_repair

#### Scenario: Diagnosis cannot authorize repair directly

- GIVEN verify_runtime diagnosis that proposes a target set change
- WHEN authorization for modification is evaluated
- THEN no modification is authorized until a valid blocking finding is routed to targeted_repair via RD

---

## SAF — Safety floors

### REQ-DAVR-SAF-01: Mandatory broad, Full-SDD, security, authorization, and data-loss floors cannot be deferred

No sequencing change introduced by this change MAY defer or weaken any mandatory broad check, Full-SDD floor, security floor, authorization check, or data-loss floor. Where scoped/review sequencing postpones broad verification, every mandatory case MUST still require broad at its required point and MUST NOT allow completion without it.

- **Priority:** MUST

#### Scenario: Full-SDD floor remains mandatory

- GIVEN a `full_sdd` lane change and a request to complete without broad
- WHEN completion is evaluated
- THEN completion is rejected with the Full-SDD broad mandatory floor

#### Scenario: Security floor remains mandatory

- GIVEN a change touching security-relevant behavior and a request to defer broad
- WHEN broad deferral is evaluated
- THEN broad remains mandatory and deferral is rejected

### REQ-DAVR-SAF-02: Git-discard and destructive-operation protections cannot be waived

No aspect of this change MAY weaken Git-discard protection, destructive-operation confirmation, or the requirement that a new user message containing the exact destructive command precede execution. No automatic progression, retry, or sequencing rule MAY bypass these controls.

- **Priority:** MUST

#### Scenario: Destructive Git command still requires confirmation

- GIVEN an automatic-mode retry whose repair needs a destructive Git operation
- WHEN authorization is evaluated
- THEN the operation still requires the canonical informed-confirmation flow and is not auto-authorized by retry or sequencing

### REQ-DAVR-SAF-03: Authorization and approval boundaries cannot be waived by automatic mode

Automatic execution mode MAY advance authorized work after required gates succeed but MUST NOT waive approval boundaries, independent Verify/Review, safety floors, broad checks, conflict stops, or destructive Git confirmation. No sequencing or retry rule MAY turn a missing or invalid authorization into authorized work.

- **Priority:** MUST

#### Scenario: Missing authorization stops regardless of mode

- GIVEN automatic mode and an authority state of `missing`
- WHEN the decision is computed
- THEN the action is stop and no modifying work is authorized

### REQ-DAVR-SAF-04: Excluded scope is a hard stop

Any target intersection with an existing OpenSpec change or with `runner-capability-standardization` MUST hard-stop. No repair, retry, or sequencing rule MAY widen this change into excluded scope.

- **Priority:** MUST

#### Scenario: Target intersecting an excluded change is stopped

- GIVEN a proposed repair target set intersecting `runner-capability-standardization` or another existing OpenSpec change
- WHEN the effect boundary validates the target set
- THEN the repair is rejected with a hard-stop rationale and no modification occurs

---

## REG — Registry and centralized rollback control

### REQ-DAVR-REG-01: Registry state remains single-writer with centralized conflict stop

Specialists MUST NOT write `state.yaml` or `events.yaml` directly. They MAY emit ordered `RegistryIntentV1` values only. The centralized coordinator MUST remain the sole writer of shared registry state and MUST stop on conflict or recovery-required outcomes. Ordered intents MUST be committed only after all required evidence is current and accepting. Optimistic base-state/event-digest checks MUST reject stale intents with deterministic conflict details and retry guidance per `artifact-state-contracts`.

- **Priority:** MUST

#### Scenario: Specialist emits intents only

- GIVEN a Specialist producing phase evidence
- WHEN registry coordination is evaluated
- THEN the Specialist emits ordered `RegistryIntentV1` values and writes no `state.yaml` or `events.yaml`

#### Scenario: Coordinator stops on conflict

- GIVEN two `RegistryIntentV1` values whose base-state digests conflict
- WHEN the coordinator attempts serialized commit
- THEN commit stops, no shared state is written, and a deterministic conflict/recovery-required outcome is recorded

#### Scenario: Stale intent is rejected with recovery data

- GIVEN an intent whose base-state or event digest is stale
- WHEN validation runs
- THEN the intent is rejected with current version, conflict summary, and retry guidance, per `artifact-state-contracts`

### REQ-DAVR-REG-02: Commit-ready intents require current evidence

Ordered registry intents MUST NOT be marked commit-ready while scoped verification, Review, or required broad evidence is stale, invalidated by a later modification, or otherwise fail-closed. The coordinator MUST reject commit-ready intents whose evidence dependency digests do not match current state.

- **Priority:** MUST

#### Scenario: Stale evidence blocks commit-ready intents

- GIVEN ordered registry intents with scoped or broad evidence whose dependency digest has changed
- WHEN commit readiness is evaluated
- THEN the intents are not commit-ready and the coordinator does not write shared state

### REQ-DAVR-REG-03: Persisted convergence revisions are state-transition-validated; arbitrary complete append fails closed

Every persisted convergence revision MUST be validated as a legal state transition from its predecessor revision against the authoritative transition table. Parsing a convergence dossier MUST validate not only hashes and predecessor integrity but also that each revision's state is the authorized output of its predecessor's transition. An arbitrary caller-provided `complete` state append or rehash that is not the output of a valid predecessor transition MUST fail closed with deterministic rationale codes. Commit-ready registry intents MUST NOT be derived from a convergence state that is not transition-authoritative.

- **Priority:** MUST

#### Scenario: Jump to complete is rejected

- GIVEN a convergence revision chain whose predecessor is `awaiting_apply_result` and an appended revision asserts `complete` with valid hashes
- WHEN the dossier is parsed
- THEN the state transition is invalid, the revision is rejected, and no completion or registry commitment is produced

#### Scenario: Out-of-table transition is rejected

- GIVEN a persisted revision whose state transition is not in the authoritative transition table
- WHEN the dossier is parsed
- THEN the revision is rejected as invalid evidence regardless of hash integrity

#### Scenario: Commit-readiness requires transition authority

- GIVEN a convergence state that asserts commit-readiness but whose last legal transition does not authorize it
- WHEN registry commitment is evaluated
- THEN the intents are not commit-ready and the coordinator writes no shared state per REQ-DAVR-REG-01

---

## ROL — Rollback conditions

### REQ-DAVR-ROL-01: Automatic progression stops on regression

If implementation introduces an authorization, replay, compatibility, ordering, registry, or safety regression, automatic progression MUST stop before further modifying work or registry commit. Rollback MUST use a normal auditable revert or forward-fix of the coherent slice while preserving read compatibility for any already-recorded additive evidence.

- **Priority:** MUST

#### Scenario: Replay regression stops progression

- GIVEN an implementation that breaks a prior replay fixture or V1 readability
- WHEN the regression is detected
- THEN automatic progression stops before further modifying work or registry commit

### REQ-DAVR-ROL-02: History and immutable evidence are preserved across rollback

Rollback MUST NOT rewrite history, discard uncommitted work, delete registry records, mutate existing changes, or bypass Git/destructive-operation confirmation. Prior OpenSpec artifacts, registry events, provenance, and immutable execution evidence MUST remain preserved. The prior supported runtime behavior remains the fallback only after its compatibility and mandatory verification floors are restored and revalidated.

- **Priority:** MUST

#### Scenario: Rollback preserves prior evidence

- GIVEN a detected regression triggering rollback
- WHEN rollback runs
- THEN prior artifacts, registry events, provenance, and immutable evidence are preserved and no history is rewritten

#### Scenario: Fallback requires revalidated floors

- GIVEN a rollback to prior runtime behavior
- WHEN the fallback is considered ready
- THEN readiness requires that compatibility and mandatory verification floors are restored and revalidated (focused checks pass, no new repo-wide failure beyond an exact documented baseline fingerprint)

### REQ-DAVR-ROL-03: Baseline fingerprint policy

Focused checks MUST pass. Any new repository-wide failure MUST block closure. The sole known repository failure (the binary-smoke `doctor` timeout in `apps/cli/src/__tests__/binary-smoke.test.tsx`) is non-blocking ONLY when its complete recorded fingerprint (file, suite, test name, error signature) matches `openspec/baseline-health.yaml` exactly. Any changed fingerprint or additional failure is a regression.

- **Priority:** MUST

#### Scenario: Known fingerprint matches

- GIVEN a repo-wide run that reproduces the exact recorded binary-smoke doctor timeout fingerprint
- WHEN closure eligibility is evaluated
- THEN the known failure is non-blocking and closure MAY proceed with warnings per the ledger

#### Scenario: Changed fingerprint blocks closure

- GIVEN a repo-wide run whose binary-smoke doctor failure signature differs from the recorded fingerprint
- WHEN closure eligibility is evaluated
- THEN closure is blocked as a regression

#### Scenario: Additional failure blocks closure

- GIVEN a repo-wide run with the known fingerprint match plus one additional failure
- WHEN closure eligibility is evaluated
- THEN closure is blocked as a regression

---

## G1 spec replan — exhausted repair governance

> **Replan authority:** bounded Spec replan authorized by the user's new message after the G1 two-attempt repair budget was exhausted (see `review-g1-repair-2.md`, `repair-incident.md`, `verify-g1.md`, `verify-g1-repair-1.md`, `verify-g1-repair-2.md`, and `review-g1.md`). This update modifies only this `spec.md` and writes `spec-replan-g1.md`. It authorizes no source, test, generated-output, `state.yaml`, `events.yaml`, registry, or other-change modification.

The terminal independent Review (`review-g1-repair-2.md`) reported three MUST-level blocker reproduction classes after repair attempt 2, with destination `escalate` / owner `human`:

1. `REVIEW-G1-R2-B1-PROTECTED-RISK-AUTHORITY` — a protected-risk finding can be downgraded to a non-authorizing disposition or routed to modifying Apply because protected-risk evidence is not a mandatory authority input to classification and routing. Resolved as verifiable requirements **REQ-DAVR-FD-03** and **REQ-DAVR-SEC-03**.
2. `REVIEW-G1-R2-B2-RETRY-IDENTITY-AUTHORITY` — a stable retry identity is neither complete nor revalidated at the effect boundary; a validly rehashed projection can replace it and still pass. Resolved as verifiable requirements **REQ-DAVR-RG-05** and **REQ-DAVR-MD-03**.
3. `REVIEW-G1-R2-B3-CONVERGENCE-AUTHORITY` — convergence completion remains caller-asserted rather than transition- and dependency-authoritative; subject drift and arbitrary `complete` append/rehash can reach or persist completion. Resolved as verifiable requirements **REQ-DAVR-BV-03** and **REQ-DAVR-REG-03**.

### Mandatory next-step authority boundary

- **Third blind G1 repair is prohibited.** The exhausted two-attempt G1 repair budget is not extended, reopened, or converted into an authorize-anyway path by this replan or by any prompt text. No third G1 modifying attempt may proceed without the boundary below.
- **A newly authorized, scoped batch is required, and only after Design+Task reconciliation** against this revised `spec.md` (its digest has changed). Design and Tasks MUST be updated to incorporate REQ-DAVR-FD-03, SEC-03, RG-05, MD-03, BV-03, and REG-03 into their contract/projection/convergence models and task allowlists; the resulting batch must be issued through the normal OpenSpec workflow. Spec/Design/Tasks reconciliation is a hard prerequisite to any new modifying Apply, per the existing reconciliation contract in `design.md`.
- **Scope ceiling preserved.** No requirement added here may widen the worktree target allowlist, the eight G1 source/test targets, the change-local OpenSpec directory, or `runner-capability-standardization`. The two-attempt-per-identity budget and existing hard-stop precedence remain in effect.
- **V1 compatibility and safety floors preserved.** Every prior requirement remains in force; the additions are stricter authority floors only and MUST NOT weaken compatibility (COMP-01..02), safety floors (SAF-01..04), or destructive-operation protections.

### Blocker-to-requirement traceability

| Critical blocker (reproduction class) | New requirements | Requirement areas | Resolved or remaining |
|---|---|---|---|
| `REVIEW-G1-R2-B1-PROTECTED-RISK-AUTHORITY` | REQ-DAVR-FD-03, REQ-DAVR-SEC-03 | FD, SEC, RD | Resolved at the requirement level (WHAT); reconciliation by Design/Tasks |
| `REVIEW-G1-R2-B2-RETRY-IDENTITY-AUTHORITY` | REQ-DAVR-RG-05, REQ-DAVR-MD-03 | RG, MD, CS, IEV | Resolved at the requirement level (WHAT); reconciliation by Design/Tasks |
| `REVIEW-G1-R2-B3-CONVERGENCE-AUTHORITY` | REQ-DAVR-BV-03, REQ-DAVR-REG-03 | BV, RV, REG, IEV | Resolved at the requirement level (WHAT); reconciliation by Design/Tasks |

---

## Open questions for Design

These requirements intentionally do NOT decide the following; Design and Tasks MUST resolve them before any modifying batch is authorized, and the spec MUST not be construed to prescribe them:

- OQ-1: Whether disposition is a new required field in a V2 manifest or a separate versioned classification envelope over unchanged V1 findings (REQ-DAVR-FD-02 forbids reinterpretation either way).
- OQ-2: The precise acceptance effect of "Review stable" (zero blocking findings only, or also explicit acceptance of all `deferred`/`recommendation` classifications).
- OQ-3: The exact lifecycle states, transition guards, evidence-invalidation rules, and conditions for reusing or rerunning Review.
- OQ-4: The exact total routing table and the evidence boundary between Apply, Spec, Design, Task, verify_runtime_diagnosis, and escalation (REQ-DAVR-RD-01 fixes the ordered destination set and totality; Design fixes the per-input mapping).
- OQ-5: Whether action and owner are separate stable codes, including whether `replan_design` and `replan_tasks` are distinct actions or one action with a mandatory deterministic owner field (REQ-DAVR-RD-01 requires unambiguous ownership either way).
- OQ-6: The minimum causal references and identity model for blocking-only repair input, including projection digest versus additive child-batch identity (REQ-DAVR-MD-01 forbids mutating the original batch either way).
- OQ-7: The single retry identity, positive-progress proof, accounting model, and bounded transition from diagnosis to replan or escalation (REQ-DAVR-RG-01..03 fix the deterministic behavior; Design fixes the data model).
- OQ-8: Which existing broad-deferral policies, if any, can apply for Fast lane without violating mandatory broad checks or safety floors (REQ-DAVR-BV-01 / REQ-DAVR-SAF-01 forbid weakening floors either way).
- OQ-9: The exact compatibility, migration, and reader behavior for stored V1 and additive evidence (REQ-DAVR-COMP-01..02 fix the observable guarantees; Design fixes the migration shape).
- OQ-10: What exact runtime evidence differentiates `verify_runtime_diagnosis` from `escalation` for environment/capability causes (REQ-DAVR-RD-01 / REQ-DAVR-IEV-02 fix the behavior boundary; Design fixes the discriminator).
- OQ-11: The exact authoritative source fields and the policy-version derivation for the complete retry identity (REQ-DAVR-RG-05), and the convergence-revision state-transition validation model plus the stage-typed dependency/subject binding scheme (REQ-DAVR-BV-03, REQ-DAVR-REG-03). Added by the G1 spec replan; Design MUST reconcile the existing convergence/projection contract model against these new authority floors before any new modifying batch is authorized, per the boundary in the "G1 spec replan" section.

---

## Spec phase result data

- **Status:** `completed` (revised by the bounded G1 spec replan; see the "G1 spec replan — exhausted repair governance" section)
- **Recommended next action:** `design` reconciliation against this revised `spec.md` is a hard prerequisite before any new modifying batch; Spec does not authorize implementation.
- **Replan artifact:** `openspec/changes/deterministic-apply-verify-review-flow/spec-replan-g1.md`
- **Artifact:** `openspec/changes/deterministic-apply-verify-review-flow/spec.md`
- **Requirements:** 18 capability areas, 48 requirements (42 original plus 6 authority-floor additions: FD-03, SEC-03, RG-05, MD-03, BV-03, REG-03).
- **Scenarios:** 101 Given/When/Then scenarios total (83 original plus 18 added by the G1 replan: 3 each for FD-03, SEC-03, RG-05, MD-03, BV-03, and REG-03).
- **Key IDs:** FD-01..03, BA-01..02, MD-01..03, RD-01..02, CS-01..02, IR-01..02, TV-01..03, BV-01..03, RV-01..02, OF-01..02, RG-01..05, DT-01..02, COMP-01..02, SEC-01..03, IEV-01..02, SAF-01..04, REG-01..03, ROL-01..03.
- **G1 replan resolved blockers:** `REVIEW-G1-R2-B1-PROTECTED-RISK-AUTHORITY` (FD-03, SEC-03), `REVIEW-G1-R2-B2-RETRY-IDENTITY-AUTHORITY` (RG-05, MD-03), `REVIEW-G1-R2-B3-CONVERGENCE-AUTHORITY` (BV-03, REG-03) — resolved at the requirement (WHAT) level and pending Design+Task reconciliation before any new modifying batch.
- **Remaining blockers:** no new Spec blockers. The three reproduction classes above are resolved as verifiable requirements; Design/Tasks reconciliation and a newly authorized, scoped batch are the only outstanding gates for any further modification. A third blind G1 repair is explicitly prohibited.
- **Dependencies (OFFICIAL CONTEXT):**
  - `openspec/changes/deterministic-apply-verify-review-flow/proposal.md` (approved intent and scope)
  - `openspec/changes/deterministic-apply-verify-review-flow/exploration.md` (validated gaps B1–B6, options, impact candidates)
  - `openspec/config.yaml` (strict TDD, focused gates, baseline policy, quality rules)
  - `openspec/registry-schema.md` (canonical lifecycle, centralized registry constraints)
  - `openspec/specs/adaptive-quality-control/spec.md` (loop breaker and forced replan)
  - `openspec/specs/artifact-state-contracts/spec.md` (structured mutation, single-writer, stale recovery)
  - `openspec/specs/runner-orchestration-resilience/spec.md` (transport classification, budgets, capability-aware verification)
  - `openspec/baseline-health.yaml` (exact known-failure ledger)
  - Current runtime contracts (evidence only, not authorization): `packages/sdd-runtime/src/contracts/failure-manifest.ts`, `apply-batch.ts`, `execution-dossier.ts`, `execution-decision.ts`, `verification-state.ts`; `packages/sdd-runtime/src/orchestrator/{failure-delta,decision-kernel,repair-loop-governance,staged-verification,freshness-policy}.ts`; `packages/sdd-runtime/src/execution/execution-control-plane.ts`; `packages/core/src/teams/developer/orchestrator-content.ts` and apply/verify/review content sources.
  - Historical/runtime evidence only (not modification targets, not authority for scope expansion): `openspec/changes/developer-team-execution-convergence/**`.
- **Dependencies not used:** `runner-capability-standardization` (explicitly excluded).
- **FailureManifestV1:** none. Spec phase produced requirements, not a validated issued-batch failure manifest.
- **RegistryIntentV1 values:** none. In centralized mode, Specialists emit ordered intents only at later phases; the Spec phase produces no commit-ready intents and does not write `state.yaml` or `events.yaml`.
- **Blockers to Design:** none.
- **Blockers to Apply:** B1–B6 from `exploration.md` remain blockers until Spec, Design, and Tasks resolve them into an approved modifying batch. This Spec resolves the WHAT for all six; Design and Tasks must resolve the HOW before any modifying batch is issued.
- **Open questions carried to Design:** OQ-1 through OQ-10 (listed above). They are constrained by spec requirements but not decided at the requirement level.
- **Scope preservation ensured:** This Spec does not design implementation structures beyond requirement-level behavior; it does not select file layouts, public interfaces, libraries, or task routing; it preserves mandatory broad, Full-SDD, security, authorization, and data-loss floors; and it does not lower risk, authority, or destructive-operation controls. It does not modify sources, tests, generated files, `state.yaml`, `events.yaml`, existing changes, or `runner-capability-standardization`.