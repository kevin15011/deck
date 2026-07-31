# Spec: Causal BROAD QA Governance

## Source and Scope

- **Change ID:** `causal-broad-qa-governance`
- **Approved policies:** 1A (strict documented nonblocking disposition) and 2A (in-stage parallel Verify checks only)
- **Authoritative source:** approved `proposal.md` with coordinator approval record dated 2026-07-29, `exploration.md` (if present), and promoted specs constraining this change.
- **Scope:** Defines verifiable behavior for BROAD causal finding governance, one authoritative final-QA order, protected BROAD floors, Archive/readiness gating, evidence invalidation, in-stage concurrency, role isolation, registry intents, migration/compatibility, and rollback. Does not authorize source, test, config, design, or registry changes.
- **Exclusions:** No restoration of Verify+Review parallel acceptance gates. No deletion, skipping, or weakening of BROAD. No modification to `runner-capability-standardization`.
- **Dependencies:** `developer-team-execution-convergence` (active; execution convergence, staged verification, role freshness, registry coordination), `project-init-skill-registry-and-session-baseline` (active; baseline disposition policy), `deterministic-apply-verify-review-flow` (archived; historical safety decision for sequencing and invalidation).
- RFC 2119 terms are normative. OpenSpec artifacts and Spec Registry remain authoritative.

## Conventions

- Requirement IDs are stable: `REQ-CBQG-{area}-NN`.
- "Finding" means a normalized `FailureFindingV1`-equivalent record produced by any stage.
- "Candidate-caused" means a finding whose authoritative causal evidence links it to the current change's implementation subject, batch, or dependencies.
- "Residual BROAD finding" means a BROAD-stage finding that has completed disposition classification.
- "Protected-risk class" means security, authorization, credentials/secrets, destructive behavior, Git safety, data loss, protected migrations, public interfaces, architecture, generated-output integrity, registry recovery, freshness, or required artifacts.
- Runtime evidence references identify current source at spec time and are NOT authorization to modify those files.

---

## Requirement Areas

| Area | Capability |
|------|-----------|
| AQ | Authoritative QA Order |
| BE | BROAD Execution and Protected Floors |
| CD | Causal Disposition (Policy 1A) |
| AF | Anti-Laundering and Fail-Closed |
| AR | Archive/Readiness Gating |
| IV | Evidence Invalidation |
| CP | In-Stage Concurrency (Policy 2A) |
| RI | Role Identity and Registry Isolation |
| MG | Migration and Compatibility |
| RB | Rejection and Rollback |

---

## AQ — Authoritative QA Order

> Grounding: The convergence contract (`execution-convergence.ts`) encodes `review_pending → broad_pending` via the `review_stable` transition. The exported legacy scheduler and integrated convergence fixture exercise `TARGETED → AFFECTED_AREA → BROAD → Review`. This area reconciles to one production-reachable authority.

### REQ-CBQG-AQ-01: One authoritative final-QA ordering

Every production-reachable scheduling path, policy surface, prompt surface, and maintained integration fixture MUST express exactly one final-QA order: `TARGETED → AFFECTED_AREA → Review → BROAD`. The convergence lifecycle state machine MUST encode `review_pending` before `broad_pending`. Any legacy export or fixture that exercises `BROAD → Review` MUST be explicitly bounded as a non-authoritative compatibility surface or reconciled to the authoritative order.

**Priority:** MUST

#### Scenario: Convergence lifecycle enforces Review before BROAD

```
Given  a convergence state at `review_pending`
When   the `review_stable` event fires with valid scoped and review evidence
Then   the lifecycle transitions to `broad_pending`
And    broad cannot execute while review_pending or any earlier stage is incomplete
```

#### Scenario: Legacy scheduler path is bounded as non-authoritative

```
Given  an exported legacy scheduler fixture that exercises BROAD → Review
When   the fixture is evaluated for production scheduling authority
Then   the fixture is explicitly documented as non-authoritative
And    it does not control production scheduling outcomes
```

#### Scenario: Prompt surface reflects the authoritative order

```
Given  the canonical prompt choreography for Developer Team roles
When   the prompt describes the final-QA sequence
Then   the prompt expresses TARGETED → AFFECTED_AREA → Review → BROAD
And    no prompt surface expresses BROAD → Review as authoritative
```

### REQ-CBQG-AQ-02: Authority reconciliation before acceptance activation

Before any production activation of causal BROAD governance, the authority split between the convergence contract and the exported legacy scheduler MUST be reconciled in official Spec and Design artifacts. Unsupported compatibility paths MUST be explicitly bounded rather than silently left contradictory. Implementation acceptance MUST NOT proceed from prompt parity alone.

**Priority:** MUST

#### Scenario: Reconciliation recorded before activation

```
Given  the convergence contract and legacy scheduler express different orders
When   Design records the authority reconciliation
Then   one production owner is identified
And    all compatibility surfaces are explicitly bounded
And    no activation occurs before this reconciliation
```

---

## BE — BROAD Execution and Protected Floors

> Grounding: `staged-verification.ts` rejects broad omission when lane is `full_sdd` or `mandatoryBroadReasons` is non-empty. `execution-control-plane.ts` derives mandatory broad reasons from lane floor reasons.

### REQ-CBQG-BE-01: BROAD is mandatory and non-skippable for Full-SDD and protected-risk work

One hundred percent of mandatory BROAD obligations MUST execute for Full-SDD and protected-risk work. No check MAY be skipped, shortened, filtered, deferred, or relabeled to obtain a pass. BROAD execution is required regardless of whether scoped stages and Review have passed cleanly.

**Priority:** MUST

#### Scenario: BROAD runs under Full-SDD lane

```
Given  a change classified as Full-SDD
When   all scoped stages and Review pass with zero blocking findings
Then   BROAD still executes every required check
And    no BROAD check is skipped or deferred
```

#### Scenario: BROAD cannot be omitted under mandatory floor

```
Given  a mandatory broad reason (security, authorization, data-loss, migration, destructive, public_api, cross_package_architecture, incident, material_repair)
When   an attempt to omit broad is validated
Then   the omission is rejected with the broad-mandatory floor reason
```

#### Scenario: BROAD executes even when scoped stages are clean

```
Given  targeted and affected_area pass with zero findings
And    Review passes with zero blocking findings
When   the lifecycle selects the next verification stage
Then   broad verification still runs to completion
```

### REQ-CBQG-BE-02: Protected-risk floors are non-waivable

No mechanism — including causal disposition, concurrency, prompt text, user pressure, or rollback — MAY weaken, override, or waive mandatory BROAD floors for Full-SDD, high/critical risk, security, authorization, credentials/secrets, destructive behavior, Git safety, data loss, protected migrations, public interfaces, architecture, generated-output integrity, registry recovery, freshness, or required artifacts.

**Priority:** MUST

#### Scenario: Protected-risk floor survives causal disposition

```
Given  a BROAD finding in a protected-risk class
When   causal disposition evaluates the finding
Then   the finding remains blocking regardless of any non-candidate evidence
And    no disposition policy can downgrade it to non-blocking
```

#### Scenario: Protected-risk floor survives rollback

```
Given  a rollback that disables concurrency
When   protected-risk floor evaluation occurs
Then   all protected-risk floors remain active
And    no floor is weakened by the rollback
```

---

## CD — Causal Disposition (Policy 1A)

> Grounding: Policy 1A requires that every BROAD finding receives a durable causal disposition. Candidate-caused, new, worsened, related, unproven, stale, conflicting, or protected-risk findings remain blocking. Only proven non-candidate residual findings may become non-blocking warnings.

### REQ-CBQG-CD-01: Every BROAD finding receives a durable causal disposition

Every BROAD finding MUST receive a durable causal disposition recorded in the execution evidence. The disposition MUST classify the finding as one of: candidate-caused, new, worsened, related, unproven, stale, conflicting, non-candidate-residual, or protected-risk. The disposition MUST be deterministic from authoritative inputs only.

**Priority:** MUST

#### Scenario: Candidate-caused finding is blocking

```
Given  a BROAD finding whose causal evidence links it to the current implementation subject
When   disposition is computed
Then   the finding is classified candidate-caused
And    the finding is blocking
```

#### Scenario: Protected-risk finding is always blocking

```
Given  a BROAD finding in any protected-risk class
When   disposition is computed
Then   the finding is classified protected-risk
And    the finding is blocking regardless of causal origin
```

### REQ-CBQG-CD-02: Non-blocking disposition requires proven non-candidate residual evidence

A BROAD finding may be classified as a durable non-blocking warning ONLY when ALL of the following conditions are simultaneously satisfied with authoritative, immutable, two-subject evidence:

1. The finding is proven to predate the current candidate (implementation subject digest).
2. The finding reproduces equivalently against the current candidate and an independent baseline.
3. The finding is causally unrelated to the candidate and is not worsened by it.
4. The finding is outside every protected-risk class.
5. The finding is covered by a separately authorized, durable, fresh baseline admission record.
6. The evidence is not stale, conflicting, self-authorized, or derived from the current run's own baseline record.

If ANY condition is not met, the finding MUST remain blocking. The system MUST NOT default to non-blocking.

**Priority:** MUST

#### Scenario: All six conditions met → non-blocking warning

```
Given  a BROAD finding that predates the candidate
And    reproduces equivalently against candidate and independent baseline
And    is causally unrelated and not worsened
And    is outside all protected-risk classes
And    has a separately authorized fresh baseline admission
And    evidence is not stale, conflicting, or self-authorized
When   disposition is computed
Then   the finding is classified non-candidate-residual
And    the finding is a durable non-blocking warning
And    the warning is recorded in execution evidence and persisted through Archive
```

#### Scenario: Missing one condition → remains blocking

```
Given  a BROAD finding that meets five of six conditions
And    the baseline admission is missing or stale
When   disposition is computed
Then   the finding remains blocking
And    no partial credit or soft downgrade is applied
```

#### Scenario: Self-authorized baseline is rejected

```
Given  a BROAD finding whose baseline admission record was produced by the same run
When   disposition is evaluated
Then   the admission is rejected as self-authorized
And    the finding remains blocking
```

### REQ-CBQG-CD-03: Non-blocking disposition evidence is immutable and two-subject

Evidence supporting non-blocking disposition MUST be immutable after production and MUST cover two independent subjects: the current candidate (implementation subject digest) and an independent baseline. Single-subject evidence, bare fingerprints, age-only classification, prose-only classification, or user-pressure-based classification MUST NOT satisfy the non-blocking evidence requirement.

**Priority:** MUST

#### Scenario: Two-subject evidence is required

```
Given  a BROAD finding claimed as non-candidate-residual
When   the evidence is evaluated
Then   the evidence contains immutable references to both the candidate subject and an independent baseline subject
And    both references have matching generation and dependency digests
```

#### Scenario: Single-subject evidence is rejected

```
Given  a BROAD finding with evidence covering only the candidate subject
When   disposition is evaluated
Then   the evidence is rejected
And    the finding remains blocking
```

---

## AF — Anti-Laundering and Fail-Closed

> Grounding: The proposal specifies that any missing, stale, conflicting, or self-authorized element fails closed and blocks. This prevents regression laundering through environmental or harness debt.

### REQ-CBQG-AF-01: Fail-closed on any disposition ambiguity

When causal disposition evidence is missing, stale, conflicting, self-authorized, or otherwise insufficient to prove all six conditions of REQ-CBQG-CD-02, the finding MUST remain blocking. The system MUST NOT interpolate, assume, or default to non-blocking.

**Priority:** MUST

#### Scenario: Stale evidence fails closed

```
Given  a BROAD finding with baseline admission evidence whose dependency digest has changed
When   disposition is evaluated
Then   the evidence is stale
And    the finding remains blocking
```

#### Scenario: Conflicting evidence fails closed

```
Given  a BROAD finding with two baseline admission records that disagree
When   disposition is evaluated
Then   the evidence is conflicting
And    the finding remains blocking
```

### REQ-CBQG-AF-02: Anti-laundering — a finding cannot self-authorize its own exception

A BROAD finding's non-blocking disposition MUST NOT be authorized by evidence produced within the same execution run that is judging the finding. Baseline admission records, reproduction evidence, and causal-unrelatedness proofs MUST originate from a prior, independent, or separately authorized source.

**Priority:** MUST

#### Scenario: Same-run baseline cannot authorize non-blocking

```
Given  a BROAD finding
And    a baseline admission record produced by the same run's verification stages
When   disposition is evaluated
Then   the admission is rejected as same-run evidence
And    the finding remains blocking
```

#### Scenario: Independent prior evidence is accepted

```
Given  a BROAD finding
And    a baseline admission record from a prior archived change with matching fingerprint
When   disposition is evaluated
Then   the admission is accepted as independently sourced
And    the finding may become non-blocking if all other conditions are met
```

### REQ-CBQG-AF-03: Candidate-first causality precedence

When evidence is ambiguous between candidate-caused and non-candidate-residual, the finding MUST be classified as candidate-caused and remain blocking. Ambiguity MUST NOT resolve in favor of non-blocking.

**Priority:** MUST

#### Scenario: Ambiguous causality defaults to candidate-caused

```
Given  a BROAD finding where causal evidence is consistent with both candidate-caused and environment-caused
When   disposition is computed
Then   the finding is classified candidate-caused
And    the finding is blocking
```

---

## AR — Archive/Readiness Gating

> Grounding: `execution-convergence.ts` requires `broad_accepted` with empty active blocking set, current scoped, review, and broad evidence before `registry_commit_pending`. This area governs Archive readiness.

### REQ-CBQG-AR-01: Archive requires zero candidate-related blocking findings

Archive MUST NOT be enabled while any candidate-related or protected-risk blocking finding remains open. This includes candidate-caused, new, worsened, related, unproven, and protected-risk findings.

**Priority:** MUST

#### Scenario: Candidate-caused finding blocks Archive

```
Given  a BROAD finding classified candidate-caused with status open
When   Archive readiness is evaluated
Then   Archive is not enabled
And    the blocking finding is recorded as the reason
```

#### Scenario: Non-blocking warning does not block Archive

```
Given  a BROAD finding classified non-candidate-residual with status warning
When   Archive readiness is evaluated
Then   Archive may proceed
And    the warning is recorded in the archive evidence
```

### REQ-CBQG-AR-02: Archive requires current evidence and complete QA order

Archive MUST NOT be enabled while required evidence is stale, while the final-QA order (TARGETED → AFFECTED_AREA → Review → BROAD) is incomplete, or while the convergence lifecycle has not reached `registry_commit_pending` with all required evidence bindings.

**Priority:** MUST

#### Scenario: Stale evidence blocks Archive

```
Given  broad evidence whose dependency digest does not match the current state
When   Archive readiness is evaluated
Then   Archive is not enabled
And    a stale-evidence reason is recorded
```

#### Scenario: Incomplete QA order blocks Archive

```
Given  Review has not completed (lifecycle at review_pending)
When   Archive readiness is evaluated
Then   Archive is not enabled
And    an incomplete-QA-order reason is recorded
```

### REQ-CBQG-AR-03: Warnings are preserved in Archive

All non-blocking warning dispositions from BROAD MUST be durably recorded in the Archive artifact. Warnings carry forward the finding identity, causal disposition classification, evidence references, residual risk summary, and follow-up obligations.

**Priority:** MUST

#### Scenario: Warning survives Archive

```
Given  a BROAD finding classified non-candidate-residual with status warning
When   Archive is produced
Then   the warning is included in the archive artifact
And    the warning carries finding identity, disposition, evidence, and follow-up
```

---

## IV — Evidence Invalidation

> Grounding: `execution-convergence.ts` uses `dependencies_invalidated` events and generation increments to clear prior stage evidence. The archived spec (`REQ-DAVR-RV-01`, `REQ-DAVR-BV-02`) requires repair to invalidate dependent evidence.

### REQ-CBQG-IV-01: Candidate modification invalidates dependent evidence

Any candidate modification or Review-directed repair MUST invalidate all quality evidence whose dependency digest has changed. This includes scoped stage evidence, Review evidence, and BROAD evidence. No pre-repair Review or BROAD result MAY be reused as current acceptance evidence after a modifying event.

**Priority:** MUST

#### Scenario: Repair invalidates BROAD evidence

```
Given  a captured BROAD evidence snapshot
And    a subsequent repair that changes the implementation subject digest
When   the repair completes
Then   the BROAD evidence snapshot is invalidated
And    a fresh BROAD must rerun against the new candidate
```

#### Scenario: Repair invalidates Review evidence

```
Given  a completed Review with current evidence
And    a Review-directed repair that changes reviewed dependencies
When   the repair completes
Then   the Review evidence is invalidated
And    a fresh Review is required
```

### REQ-CBQG-IV-02: Invalidation restarts the required fresh sequence

After invalidation, the convergence lifecycle MUST return to `targeted_pending` (or the appropriate earlier stage) and MUST re-execute the full ordered sequence: TARGETED → AFFECTED_AREA → Review → BROAD. No stage MAY be skipped because it previously passed.

**Priority:** MUST

#### Scenario: Invalidation returns to targeted_pending

```
Given  a convergence state at broad_pending
And    a dependencies_invalidated event fires
When   the transition is processed
Then   the lifecycle returns to targeted_pending
And    scoped stage digests, review digest, and broad digest are cleared
And    a fresh sequence begins
```

### REQ-CBQG-IV-03: Generation increment on every modifying event

Every modifying event (apply_result_accepted, repair_effect_succeeded) MUST increment the convergence generation. Non-modifying accepting events MUST match the current generation. Evidence from a prior generation MUST NOT be accepted for a current-generation transition.

**Priority:** MUST

#### Scenario: Modifying event increments generation

```
Given  a convergence state with generation N
When   a repair_effect_succeeded event fires
Then   the new state has generation N+1
And    all prior stage evidence is cleared
```

#### Scenario: Non-modifying event requires current generation

```
Given  a convergence state with generation N
When   a broad_accepted event fires with generation N-1 evidence
Then   the event is rejected with generation_mismatch
```

---

## CP — In-Stage Concurrency (Policy 2A)

> Grounding: Policy 2A permits parallelizing only checks within a single Verify stage (TARGETED, AFFECTED_AREA, or BROAD) that have no ordering, mutation, shared-state, or evidence dependency. All results must join before the stage verdict. This does NOT permit parallelizing across stages or parallelizing Verify and Review.

### REQ-CBQG-CP-01: Parallel checks are limited to a single stage

Only checks within a single TARGETED, AFFECTED_AREA, or BROAD stage MAY be parallelized. Checks across different stages MUST NOT run concurrently. Review MUST NOT run concurrently with any Verify stage. This concurrency prohibition does not alter the authoritative final-QA order (REQ-CBQG-AQ-01): Review completes before BROAD begins.

**Priority:** MUST

#### Scenario: Within-stage parallel checks are permitted

```
Given  a TARGETED stage with three checks: A, B, C
When   the stage executes
Then   checks A, B, C may run in parallel
And    all three complete before the TARGETED stage verdict
```

#### Scenario: Cross-stage parallelism is rejected

```
Given  a TARGETED stage and an AFFECTED_AREA stage
When   an attempt is made to run them concurrently
Then   the attempt is rejected
And    stages execute sequentially per the authoritative order
```

#### Scenario: Verify and Review cannot be parallel

```
Given  a BROAD stage and a Review stage
When   an attempt is made to run them concurrently
Then   the attempt is rejected
And    per the authoritative order (REQ-CBQG-AQ-01), Review completes before BROAD begins
```

### REQ-CBQG-CP-02: Join-before-verdict rule

All parallel check results within a stage MUST be joined before the stage verdict is produced. A stage verdict MUST NOT be emitted while any check is still pending. The joined verdict MUST be deterministic — equivalent to running the same checks serially and aggregating results in canonical order.

**Priority:** MUST

#### Scenario: All checks join before verdict

```
Given  a BROAD stage with five checks running in parallel
When   three checks have completed and two are still pending
Then   no stage verdict is produced
And    the verdict is produced only after all five complete
```

#### Scenario: Deterministic equivalence to serial execution

```
Given  a stage with checks [A, B, C] run in parallel
And    the same stage with checks [A, B, C] run serially
When   both produce their verdicts
Then   the verdicts are identical
And    the evidence sets are identical
And    the registry intents are identical and in the same order
```

### REQ-CBQG-CP-03: Parallel checks preserve role independence and evidence isolation

Each parallel check within a stage MUST receive immutable candidate and dependency references. No check MAY mutate shared state consumed by another check. Check results MUST be independently verifiable and MUST NOT contaminate each other's evidence.

**Priority:** MUST

#### Scenario: Immutable references prevent contamination

```
Given  parallel checks A and B in the TARGETED stage
When   check A produces evidence
Then   check B's candidate and dependency references are unchanged
And    check A's evidence does not appear in check B's result
```

### REQ-CBQG-CP-04: Concurrency produces same phase judgment and registry intents as serial

The parallel execution of a stage MUST produce the same phase judgment (passed, passed_with_warnings, failed), the same evidence set, the same role-independence result, and the same ordered registry intents as serial execution of the same stage. A deterministic critical-path comparison MUST demonstrate reduced elapsed work for at least one representative eligible fixture without reducing check count.

**Priority:** MUST

#### Scenario: Phase judgment equivalence

```
Given  a representative eligible fixture with parallel checks
When   the fixture runs in parallel mode and serial mode
Then   both produce identical phase judgments
And    both produce identical registry intent orders
And    parallel mode has lower elapsed time
```

---

## RI — Role Identity and Registry Isolation

> Grounding: `execution-control-plane.ts` enforces role identity matching (`ROLE_IDENTITY_MISMATCH`). `REQ-REGISTRY-001` requires centralized mode specialists return intents without writing registry files.

### REQ-CBQG-RI-01: Verify and Review roles are distinct and isolated

Verify and Review MUST remain distinct roles with distinct agent instances, distinct evidence, and distinct judgments. No mechanism MAY merge their identities, share their agent instances, or allow one to authorize the other's acceptance.

**Priority:** MUST

#### Scenario: Distinct agent instances for Verify and Review

```
Given  a Verify invocation with agentInstanceId "verify-1"
And    a Review invocation with agentInstanceId "review-1"
When   role scheduling is evaluated
Then   the invocations are distinct
And    neither can impersonate or substitute for the other
```

### REQ-CBQG-RI-02: Centralized registry intents — specialists return, coordinator commits

In centralized mode, specialist roles (Verify, Review, BROAD) MUST return immutable registry intents. Specialists MUST NOT directly mutate `state.yaml` or `events.yaml`. Exactly one coordinator MUST validate, authorize, serialize, and record registry effects.

**Priority:** MUST

#### Scenario: Specialist returns intent without writing registry

```
Given  a Review result with registry intents
When   the result is consumed
Then   the intents are recorded in the result envelope
And    no registry file is written by the Review role
And    the coordinator commits the intents separately
```

#### Scenario: Coordinator commits intents atomically

```
Given  a set of registry intents from Verify and Review
When   the coordinator processes the intents
Then   all intents are committed in one atomic transition
And    state.yaml and events.yaml are updated by the coordinator only
```

### REQ-CBQG-RI-03: Immutable evidence references

All stage evidence, result records, transition receipts, and invalidation records MUST be immutable after production. Their digests MUST be content-addressed and verifiable. Mutated evidence MUST be rejected.

**Priority:** MUST

#### Scenario: Evidence immutability is enforced

```
Given  a produced stage evidence record with digest D
When   the record is referenced in a subsequent transition
Then   the record's recomputed digest equals D
And    any mutation produces a different digest and is rejected
```

---

## MG — Migration and Compatibility

> Grounding: The proposal identifies a scheduler/convergence authority split. The convergence contract encodes Review → BROAD. The exported legacy scheduler and fixture encode BROAD → Review. This area governs migration treatment.

### REQ-CBQG-MG-01: Legacy scheduler path is bounded as compatibility surface

The exported legacy scheduler path that exercises `BROAD → Review` MUST be explicitly documented and bounded as a non-authoritative compatibility surface. It MUST NOT be reachable as a production scheduling path without explicit re-authorization. The bounding MUST be recorded in Design.

**Priority:** MUST

#### Scenario: Legacy path documented as non-authoritative

```
Given  the exported legacy scheduler fixture
When   the fixture is evaluated
Then   the fixture is documented as non-authoritative
And    the fixture's scheduling order does not control production outcomes
And    Design records the explicit bounding
```

### REQ-CBQG-MG-02: Convergence contract is authoritative for new behavior

The convergence contract's lifecycle state machine (with `review_pending` before `broad_pending`) MUST be the authoritative source for new production behavior. Any adapter, export, or fixture that conflicts MUST be reconciled or explicitly bounded as non-authoritative.

**Priority:** MUST

#### Scenario: Convergence contract controls production

```
Given  a production execution using the convergence contract
When   the lifecycle evaluates the final-QA order
Then   the convergence contract's order is authoritative
And    no conflicting export overrides it
```

### REQ-CBQG-MG-03: Existing convergence fixtures remain valid

Existing convergence test fixtures (e.g., `developer-team-convergence-fixture.ts`) MUST continue to pass after this change. If fixture behavior conflicts with the new authoritative order, the fixture MUST be updated to reflect the new order while preserving its test coverage intent.

**Priority:** SHOULD

#### Scenario: Fixture reflects authoritative order

```
Given  the developer-team-convergence-fixture
When   the fixture exercises the final-QA sequence
Then   the fixture expresses TARGETED → AFFECTED_AREA → Review → BROAD
And    the fixture passes
```

### REQ-CBQG-MG-04: Dual-read permitted, dual-write prohibited

During migration, dual-read of old and new scheduling paths is permitted. Dual-write to registry or state artifacts is prohibited. No historical scheduling record MAY be rewritten to conform to the new order.

**Priority:** MUST

#### Scenario: No historical rewrite

```
Given  historical convergence dossier records with the old order
When   migration is evaluated
Then   the historical records are preserved as-is
And    no record is rewritten to reflect the new order
```

---

## RB — Rejection and Rollback

> Grounding: The proposal specifies rollback restores serial execution and prior fail-closed BROAD disposition. Concurrency is disabled first while retaining all checks.

### REQ-CBQG-RB-01: Rejection of invalid causal disposition evidence

Invalid, missing, stale, conflicting, or self-authorized causal disposition evidence MUST be rejected. Rejection MUST produce a deterministic error code and MUST block Archive. Rejection MUST NOT be overridden by prompt text, user pressure, or retry count.

**Priority:** MUST

#### Scenario: Invalid evidence is rejected with code

```
Given  a BROAD finding with causal disposition evidence that fails validation
When   disposition is evaluated
Then   the evidence is rejected
And    a deterministic error code is produced (e.g., invalid-evidence, stale-evidence, self-authorized)
And    the finding remains blocking
```

### REQ-CBQG-RB-02: Rollback disables concurrency first

Rollback MUST disable in-stage parallel concurrency first while retaining all checks. Serial execution resumes. If causal disposition is implicated, nonzero BROAD results return to blocking until corrected evidence and policy are independently revalidated.

**Priority:** MUST

#### Scenario: Rollback disables concurrency

```
Given  an active execution using in-stage parallel checks
When   rollback is triggered
Then   parallel concurrency is disabled
And    all checks execute serially
And    no check is removed or skipped
```

#### Scenario: Rollback restores fail-closed BROAD

```
Given  an active causal disposition policy
When   rollback is triggered and causal disposition is implicated
Then   nonzero BROAD results return to blocking
And    corrected evidence must be independently revalidated
```

### REQ-CBQG-RB-03: Rollback preserves evidence and history

Rollback MUST preserve all recorded findings, warning dispositions, failed attempts, registry intents, state/event history, and active-change artifacts. Rollback MUST NOT rewrite history, delete evidence, edit generated outputs directly, or use destructive Git operations without the permanent informed-confirmation flow.

**Priority:** MUST

#### Scenario: Evidence survives rollback

```
Given  an execution with recorded findings, warnings, and registry intents
When   rollback is triggered
Then   all findings, warnings, intents, and history are preserved
And    no historical record is deleted or rewritten
```

### REQ-CBQG-RB-04: Rollback does not weaken permanent floors

BROAD itself, protected-risk floors, final Review independence, freshness, candidate identity, centralized registry ownership, and historical evidence are NEVER rollback switches. Rollback MUST NOT weaken or disable any permanent safety floor.

**Priority:** MUST

#### Scenario: Protected floors survive rollback

```
Given  all protected-risk floors active
When   rollback is triggered
Then   all protected-risk floors remain active
And    no floor is weakened or disabled
```

---

## Open Questions

1. **Baseline admission source authority:** The exact form and authorization boundary for durable baseline admission records (required by CD-02) depends on the outcome of `project-init-skill-registry-and-session-baseline`. This spec assumes compatibility with its `passed_with_warnings` policy. If incompatible, explicit supersession must be recorded in Design.
2. **Critical-path measurement fixture:** CP-04 requires a deterministic critical-path comparison. Design must select or construct a representative eligible fixture and define the measurement methodology.

---

## Compliance Matrix

| Area | Requirements | Scenarios | Status |
|------|-------------|-----------|--------|
| AQ | AQ-01, AQ-02 | 4 | Defined |
| BE | BE-01, BE-02 | 5 | Defined |
| CD | CD-01, CD-02, CD-03 | 7 | Defined |
| AF | AF-01, AF-02, AF-03 | 5 | Defined |
| AR | AR-01, AR-02, AR-03 | 5 | Defined |
| IV | IV-01, IV-02, IV-03 | 5 | Defined |
| CP | CP-01, CP-02, CP-03, CP-04 | 7 | Defined |
| RI | RI-01, RI-02, RI-03 | 4 | Defined |
| MG | MG-01, MG-02, MG-03, MG-04 | 4 | Defined |
| RB | RB-01, RB-02, RB-03, RB-04 | 5 | Defined |
| **Total** | **31** | **51** | — |

## Design Inputs

- Select the exact form and authorization boundary for durable baseline admission records (CD-02) and coordinate with `project-init-skill-registry-and-session-baseline`.
- Define the eligibility classification for in-stage parallel checks (CP-01) and the deterministic critical-path comparison methodology (CP-04).
- Identify the production scheduling owner and reconcile the convergence contract with the exported legacy scheduler (AQ-02, MG-01, MG-02).
- Ensure existing convergence fixtures pass or are updated to reflect the authoritative order (MG-03).
- Preserve the evidence model from `deterministic-apply-verify-review-flow` and commit `15804c48584fc2b4e936a71c88608e9523011d79` unless a separately approved evidence-model redesign occurs.
