# Exploration: Deterministic Apply → Verify → Review Flow

## Scope and authority

- Proposed change ID: `deterministic-apply-verify-review-flow`.
- Execution mode selected by the user: Automatic.
- This exploration is authorized to create only this artifact. It does not modify source, tests, generated output, another OpenSpec change, `state.yaml`, or `events.yaml`.
- `runner-capability-standardization` is an excluded target and must remain excluded from every future batch.
- `openspec/changes/developer-team-execution-convergence/**` is used only as historical/runtime evidence. It is not continued, amended, or treated as authority for widening this change.
- Official context is the current source, tests, promoted specifications, `openspec/config.yaml`, `openspec/registry-schema.md`, and the future artifacts of this new change. Adaptive memory was loaded only as advisory context.

## Question investigated

What current contracts, orchestration behavior, tests, and OpenSpec constraints must change to make Apply → Verify → Review deterministic and convergent while:

1. classifying findings as blocking, recommendation, deferred, or pre-existing;
2. routing blocking root causes to Apply, Spec, Design, Task, Verify-runtime diagnosis, or escalation;
3. issuing minimal Apply dossiers containing only blocking work;
4. preserving independent Apply, Verify, and Review judgments;
5. running targeted and affected-area validation before Review, postponing broad validation until implementation and Review are stable, and revalidating scoped impact after repairs;
6. preventing opportunistic findings from triggering repair;
7. bounding retries by stable failure identity and demonstrated progress; and
8. making decisions reproducible.

## Executive finding

The repository already has strong deterministic primitives: immutable batches and dossiers, stable finding identities, failure deltas, replayable decision records, independent role identities, staged verification, bounded repair governance, and centralized registry intents. Focused runtime and compact-prompt suites are green.

The requested lifecycle is nevertheless **not implementable as a prompt-only adjustment**. The current runtime requires all verification stages—including broad—to finish before Review can be scheduled, while one legacy orchestration surface still directs Verify and Review to run in parallel immediately after Apply. Current finding contracts also lack the requested disposition vocabulary and cannot produce a machine-enforced minimal blocking-only Apply dossier. These are blocking contract/choreography gaps for the proposed change.

## Verified current behavior

### Immutable and reproducible execution evidence

- `ApplyBatchContractV1` binds task IDs, dependencies, one owner role, allowed/blocked targets, acceptance obligations, a verification plan, artifact digests, authorization, and provenance into a content-derived batch ID and digest (`packages/sdd-runtime/src/contracts/apply-batch.ts:2-22`).
- `ExecutionDossierV1` binds the batch, manifests, delta, decision, lane, staged verification, causal context, authorization reference, and ordered registry intents. Revisions preserve batch identity and append-only decision/intent prefixes (`packages/sdd-runtime/src/contracts/execution-dossier.ts:21-43`, `65-120`, `124-182`).
- `planExecutionDecisionV1()` validates the dossier and history, normalizes authority/Git/governance inputs, records a versioned replay input digest, and exposes deterministic replay (`packages/sdd-runtime/src/execution/execution-control-plane.ts:1079-1164`).
- `RegistryIntentV1` has a stable semantic digest/idempotency key and binds base state/events digests, artifact, provenance, event, and optional batch/decision references (`packages/sdd-runtime/src/contracts/registry-intent.ts:3-35`). The centralized commit path serializes intents and stops on conflict or recovery-required outcomes (`packages/sdd-runtime/src/execution/execution-control-plane.ts:253-280`).

### Finding identity, progress, and root-cause routing

- `FailureFindingV1` supports severity, root cause, requirement/task/location/oracle anchors, status, relationship, and safe evidence. Stable identity hashes batch digest, requirements, tasks, category, locations, and oracle—not prose, severity, status, producer, or timestamps (`packages/sdd-runtime/src/contracts/failure-manifest.ts:4-25`).
- Current statuses are `open | resolved | pre_existing | out_of_scope`; relationships are `batch_related | unrelated_baseline` (`packages/sdd-runtime/src/contracts/failure-manifest.ts:4-8`). There is no explicit `blocking | recommendation | deferred | pre-existing` disposition.
- `computeFailureDeltaV1()` deterministically produces resolved, new-related, new-unrelated-baseline, persistent, regressed, and reclassified sets. It quarantines unrelated pre-existing baseline findings and derives positive/none/negative progress from protected-risk precedence and weighted movement (`packages/sdd-runtime/src/orchestrator/failure-delta.ts:8-101`).
- `evaluateExecutionDecisionV1()` routes authorization/Git failures to stop, security/data-loss risk to escalation, requirement gaps to Spec replan, architecture/batch-shape gaps to combined Design-or-Tasks replan, stale oracle evidence to oracle correction, environment/transport/capability/unknown causes to runtime diagnosis, and narrowly safe positive implementation deltas to targeted repair (`packages/sdd-runtime/src/orchestrator/decision-kernel.ts:43-91`).
- The current action vocabulary combines Design and Task routing as `replan_design_or_tasks` and uses generic `diagnose_runtime`; it does not encode a distinct Verify-runtime diagnosis destination.

### Retry governance

- `evaluateRepairIncident()` enforces hard and soft incident verification-cycle limits, runtime budgets, per-fingerprint attempt limits, and repair/replan/escalation thresholds with hard-stop precedence (`packages/sdd-runtime/src/orchestrator/repair-loop-governance.ts:166-394`).
- The decision kernel chooses the evidence-based action first; repair governance acts as a restrictive terminal guard and cannot manufacture targeted repair (`packages/sdd-runtime/src/orchestrator/decision-kernel.ts:43-91`; historical rationale at `openspec/changes/developer-team-execution-convergence/design.md:499-529`).
- Stable failure identity and progress exist, but retry accounting remains split between FailureManifest/FailureDelta identity and the legacy RepairIncident fingerprint/attempt model. The dossier records attempt summaries but the decision kernel does not use them directly (`packages/sdd-runtime/src/contracts/execution-dossier.ts:21-43`; `packages/sdd-runtime/src/orchestrator/repair-loop-governance.ts:166-394`).

### Verification and role independence

- Verification stages are canonicalized as `targeted → affected_area → broad`. Out-of-order transitions, failed-stage advancement, missing evidence, and unauthorized broad deferral fail closed (`packages/sdd-runtime/src/orchestrator/staged-verification.ts:107-214`).
- Role freshness rejects Apply/Verify identity collisions, Review collisions, stale post-modification Verify, and missing fresh Review triggers (`packages/sdd-runtime/src/orchestrator/freshness-policy.ts:18-88`). Verify/Review causal projection strips Apply attempt summaries (`packages/sdd-runtime/src/orchestrator/freshness-policy.ts:91-105`).
- `consumeExecutionRoleResultV1()` binds role results to invocation, batch, dossier, decision, and verification digests and accepts Review only after `validateVerificationAcceptanceV1()` reports all verification stages complete (`packages/sdd-runtime/src/execution/execution-control-plane.ts:479-627`).
- `scheduleExecutionRoleInvocationV1()` schedules Review only when the decision action is `complete`; current completion is reached after verification has no next stage (`packages/sdd-runtime/src/execution/execution-control-plane.ts:392-477`; `packages/sdd-runtime/src/orchestrator/decision-kernel.ts:43-91`).
- The focused scheduler test makes the present order explicit: “schedules independent Review only after staged verification completes” (`packages/sdd-runtime/src/execution/execution-role-scheduler.test.ts:181-194`).

### Prompt/runtime divergence

- The compact coordinator correctly requires independent Verify and Review, staged `targeted → affected_area → broad` evidence, bounded repair, and centralized intents (`packages/core/src/teams/developer/orchestrator-content.ts:882-950`).
- The legacy/full orchestration source still states that Verify and Review “run in parallel after Apply” (`packages/core/src/teams/developer/orchestrator-content.ts:713-719`).
- Compact Apply skills tell Apply agents to run scheduled targeted, affected-area, and broad checks themselves (`packages/core/src/teams/developer/apply-general-content.ts:324-336`; `apply-backend-content.ts:320-332`; `apply-frontend-content.ts:333-345`). Independent Verify later reruns staged checks, so ownership and evidence semantics are not yet expressed as one unambiguous lifecycle.
- Compact Review already requires independent identity, anchored blockers, and separation of optional scope (`packages/core/src/teams/developer/review-content.ts:343-369`). Compact Verify already requires stage-specific evidence and separate baseline findings (`packages/core/src/teams/developer/verify-content.ts:304-330`). These are useful policy surfaces but are not sufficient to override runtime sequencing.

### Official OpenSpec and baseline constraints

- The official lifecycle is `explore → proposal → spec → design → tasks → apply → verify → review → archive → closed`; no new phase should be invented (`openspec/registry-schema.md:42-58`).
- In centralized mode, specialists must not race on `state.yaml`/`events.yaml`; registry intents are the coordination boundary (`openspec/registry-schema.md:100-143`; runtime contract above).
- Strict TDD is configured, focused checks must pass, new repository failures block closure, and exact known failures require ledger references (`openspec/config.yaml:25-40`, `57-68`).
- The baseline ledger records one known repository-wide timeout in `apps/cli/src/__tests__/binary-smoke.test.tsx`; any changed fingerprint or additional failure is a regression (`openspec/baseline-health.yaml:34-68`, `70-87`).
- Promoted `runner-orchestration-resilience` requires bounded loop handling; promoted `adaptive-quality-control` requires repeated similar review/fix or verify/fix cycles to force replan, split, or escalation at the configured ceiling (`openspec/specs/runner-orchestration-resilience/spec.md`; `openspec/specs/adaptive-quality-control/spec.md:57-59`).

## Findings and routing

| ID | Classification | Finding | Required route |
|---|---|---|---|
| B1 | **Blocking** | Runtime schedules Review only after broad verification, contrary to the requested targeted → affected-area → Review → broad choreography. The legacy/full prompt separately says Verify and Review run in parallel after Apply. | **Spec** must define acceptance points and failure behavior; **Design** must define the state machine; **Apply** must update runtime and canonical prompt sources; independent **Verify** must prove ordering. |
| B2 | **Blocking** | Failure contracts do not encode the requested `blocking`, `recommendation`, `deferred`, and `pre-existing` disposition. Severity/status/relationship cannot safely substitute without an explicit deterministic mapping. | **Spec** defines semantics and which dispositions affect acceptance; **Design** selects an additive contract or projection; **Apply** implements parsers/builders/kernel validation. |
| B3 | **Blocking** | The batch/dossier carries the full issued batch and full current manifest. There is no machine-validated blocking-only Apply projection, so “minimal Apply dossier” is currently prompt intent rather than an enforceable boundary. | **Spec** defines minimality and retained causal references; **Design** defines an immutable repair projection/sub-batch without mutating batch identity; **Task** derives exact repair work; **Apply** enforces it at the effect boundary. |
| B4 | **Blocking** | Routing destinations are not granular enough for reproducible ownership: Design and Task are combined, and runtime diagnosis is not explicitly assigned to Verify-runtime diagnosis. | **Spec** defines a total root-cause routing table; **Design** defines stable action/owner codes; **Task** maps actions to dossiers; **Apply** implements exact routing. |
| B5 | **Blocking** | Retry identity/progress and attempt budgets are split across FailureManifest/FailureDelta and legacy RepairIncident projection. The repository has bounded behavior, but there is no single evidence chain proving that every new modifying retry is for the same stable blocking set and follows demonstrated positive progress. | **Design** defines one convergence state/identity binding; **Apply** connects it to decision replay and terminal governance; **Verify-runtime diagnosis** handles malformed or ambiguous runtime evidence; **escalation** handles exhaustion/no progress. |
| B6 | **Blocking** | Current runtime completion conflates “all verification stages complete” with “ready for Review.” It has no stable intermediate state for “targeted and affected passed; Review stable; broad pending,” nor explicit invalidation/revalidation after Review-driven repairs. | **Spec** and **Design** define intermediate gates and evidence invalidation; **Apply** updates scheduling/state transitions; **Verify** proves repair revalidation. |
| R1 | **Recommendation** | Keep `FailureManifestV1`, `ApplyBatchContractV1`, and existing public behavior readable. Prefer additive V2 fields/contracts or a validated projection rather than silently reinterpreting V1 values. | Proposal/Design compatibility decision. |
| R2 | **Recommendation** | Treat recommendations, deferred items, optional new scope, and unrelated baseline findings as reportable but non-repair-authorizing. Only an anchored blocking disposition may enter an Apply repair dossier. | Spec invariant plus kernel/effect-boundary test. |
| R3 | **Recommendation** | Use stable reason/action/owner codes and digest all policy inputs. Human prose should remain rendering only, never a decision input. | Design and Apply. |
| R4 | **Recommendation** | After every repair, require a fresh targeted check and recomputed affected-area check set. Reuse evidence only when its dependency digest remains valid; otherwise mark it stale explicitly. | Spec/Design/Verify. |
| D1 | **Deferred** | Repository-wide broad validation should not run during early repair churn. It should run only after targeted + affected-area pass and Review has no unresolved blockers, then rerun if any later modification invalidates it. Mandatory broad floors still cannot be waived. | Future Apply/Verify task and final acceptance gate. |
| D2 | **Deferred** | Rollout/cohort telemetry and adapter expansion are not needed to explore this lifecycle. Existing runtime behavior is evidence only; this change must not reopen the historical rollout program. | Out of current change unless separately proposed. |
| P1 | **Pre-existing** | The baseline ledger contains one exact known binary-smoke timeout. It receives no repair credit and cannot authorize scope expansion. | Verify comparison only. |
| P2 | **Pre-existing** | `developer-team-execution-convergence/state.yaml` remains a large historical/runtime record with `currentPhase: apply`; it is not part of this change and must not be reconciled or edited here. | Excluded historical evidence. |

## Proposed deterministic lifecycle

This is a recommendation for Proposal/Spec/Design, not an approved design:

1. **Apply issued batch** — Apply receives the immutable authorized batch and performs only approved implementation work.
2. **Independent targeted Verify** — a distinct Verify instance runs the targeted stage and emits normalized findings.
3. **Independent affected-area Verify** — after targeted passes, Verify runs the deterministically derived affected-area checks.
4. **Disposition and root-cause decision** — findings are normalized into one of four dispositions. Only `blocking` findings enter routing. `recommendation`, `deferred`, and `pre-existing` remain non-authorizing evidence.
5. **Independent Review** — Review runs only after targeted and affected-area evidence passes. It may add anchored blocking findings, but optional/opportunistic findings remain non-blocking.
6. **Blocking repair decision** — the kernel routes each blocking root cause to exactly one owner: Apply, Spec, Design, Task, Verify-runtime diagnosis, or escalation. Mixed owners force replan/split; they do not form one broad repair batch.
7. **Minimal Apply repair dossier** — contains only selected blocking finding IDs, exact requirement/task anchors, allowed targets, acceptance checks, causal evidence references, prior decision digest, stable failure identity, attempt number, and authorization. It references—but does not copy or mutate—the original batch.
8. **Scoped revalidation** — any repair invalidates stale targeted/affected evidence. Fresh targeted and affected-area verification must pass before Review is reused or rerun according to freshness policy.
9. **Broad Verify** — runs after implementation and Review are stable. Mandatory floor cases always run it. Any modification after broad evidence invalidates that evidence.
10. **Completion** — only a zero-blocking manifest plus accepted targeted, affected-area, Review, and required broad evidence can produce completion and commit-ready ordered registry intents.

## Retry/convergence rules to specify

- A retry identity should be derived from the ordered blocking finding IDs, selected root cause/owner, original batch digest, repair target set, and required check IDs. It must not depend on prose or agent identity.
- A modifying retry is eligible only after a valid prior attempt and demonstrated progress: at least one selected blocker resolved, no selected blocker regressed, no new related blocker, no protected-risk increase, and no broadened target/check scope without replan.
- Same identity plus no progress produces diagnosis/checkpoint once, then replan or escalation according to a fixed budget. Negative progress, opportunistic scope growth, or a changed root-cause owner forbids blind retry.
- A changed blocking set, owner, target set, obligation, or oracle creates a new planned dossier/batch projection; it is not counted as progress on the old identity.
- Terminal governance may only maintain or increase restrictiveness. It must never convert no progress into repair.

## Options

### Option A — Prompt-only choreography

Change coordinator/role text to describe the requested order.

- Advantage: small source delta.
- Rejected as sufficient: runtime currently prevents Review before broad and lacks disposition/minimal-dossier enforcement. Prompt text is not authority.

### Option B — Additive lifecycle coordinator and blocking-work projection (**recommended**)

Keep current V1 contracts readable; add a versioned disposition/routing/convergence contract and an immutable minimal repair projection referencing the original batch. Extend scheduling to represent pre-Review scoped verification, Review stability, post-repair invalidation, and final broad verification.

- Advantages: preserves compatibility, separates policy from prose, supports deterministic replay, and localizes modification authority.
- Cost: contract, scheduler, kernel, prompt, and integration-test changes across runtime/core.

### Option C — Reinterpret or mutate existing V1 contracts

Add implicit meanings to status/severity and reorder current staged verification in place.

- Advantage: fewer new types.
- Not recommended: risks breaking stored/replayed V1 evidence, historical fixtures, adapter parity, and existing callers.

## Source impact candidates

Exact files remain subject to Proposal/Design/Tasks. Likely candidates are:

- `packages/sdd-runtime/src/contracts/failure-manifest.ts` — additive disposition/anchoring semantics or compatibility projection.
- `packages/sdd-runtime/src/contracts/apply-batch.ts` — verification-plan/gate references only if additive compatibility is proven.
- `packages/sdd-runtime/src/contracts/execution-dossier.ts` — convergence state and minimal blocking-work projection references.
- `packages/sdd-runtime/src/contracts/execution-decision.ts` — granular action/owner codes and intermediate lifecycle actions.
- `packages/sdd-runtime/src/contracts/verification-state.ts` — Review gate and broad-pending/final evidence state if the state machine remains here.
- `packages/sdd-runtime/src/orchestrator/failure-delta.ts` — disposition-aware progress that gives no credit to non-blocking work.
- `packages/sdd-runtime/src/orchestrator/decision-kernel.ts` — total owner routing and blocking-only repair eligibility.
- `packages/sdd-runtime/src/orchestrator/repair-loop-governance.ts` — unified stable retry identity/progress binding while preserving legacy behavior.
- `packages/sdd-runtime/src/orchestrator/staged-verification.ts` — targeted/affected → Review gate → broad transitions and invalidation.
- `packages/sdd-runtime/src/orchestrator/freshness-policy.ts` — Review reuse/freshness and post-repair evidence invalidation.
- `packages/sdd-runtime/src/execution/execution-control-plane.ts` — scheduling, role-result consumption, replay, effect authorization, and ordered registry intent readiness.
- `packages/core/src/teams/developer/orchestrator-content.ts` — remove legacy parallelism contradiction and express the canonical flow.
- `packages/core/src/teams/developer/apply-{general,backend,frontend}-content.ts` — clarify Apply-owned checks versus independent Verify evidence.
- `packages/core/src/teams/developer/verify-content.ts` and `review-content.ts` — disposition and gate return contracts.

Generated outputs are downstream effects only and must never be edited directly.

## Test impact candidates

- `packages/sdd-runtime/src/contracts/failure-manifest.test.ts` and contract matrix tests — exact disposition parsing, compatibility, stable identity, invalid combinations.
- `packages/sdd-runtime/src/orchestrator/failure-delta.test.ts` — recommendations/deferred/pre-existing produce zero repair credit; blocking regressions dominate.
- `packages/sdd-runtime/src/orchestrator/decision-kernel.test.ts` — complete root-cause-to-owner table, mixed-owner split/replan, opportunistic non-repair, stable rationale order.
- `packages/sdd-runtime/src/orchestrator/staged-verification.test.ts` — exact targeted → affected → Review → broad state machine, failures, deferrals, mandatory broad floors, and invalidation.
- `packages/sdd-runtime/src/orchestrator/freshness-policy.test.ts` — independent identities and repair-triggered scoped revalidation/Review freshness.
- `packages/sdd-runtime/src/orchestrator/repair-loop-governance.test.ts` — same-identity/no-progress bounds and compatibility of existing incident outcomes.
- `packages/sdd-runtime/src/execution/execution-role-scheduler.test.ts` — replace the current “Review only after staged verification completes” oracle with exact pre-broad Review scheduling and final broad readiness.
- `packages/sdd-runtime/src/execution/execution-control-plane.test.ts` and `batch-c-authoritative-matrix.test.ts` — replay, effect denial for non-blocking work, minimal dossier enforcement, and stable owner routes.
- `packages/sdd-runtime/src/execution/developer-team-convergence.e2e.test.ts` plus both adapter bridge tests — end-to-end role order and dependency binding without modifying historical artifacts.
- `packages/core/src/teams/developer/{orchestrator,verify,review,apply-general,apply-backend,apply-frontend}-content.test.ts` — canonical invariant parity and no contradictory choreography.

## Validation evidence gathered

- Focused runtime suite: 107 passed, 0 failed, 565 expectations across seven relevant files.
- Compact prompt suite: 363 passed, 0 failed, 666 expectations across six relevant files.
- Serena diagnostics: no warnings/errors reported for `decision-kernel.ts` or `execution-control-plane.ts`.
- Worktree was clean before this exploration artifact was created.
- No broad repository test was run during Explore. This is intentional: broad validation is deferred until implementation and Review are stable, consistent with the proposed scope and the repository baseline policy.

## Risks and constraints

- **Compatibility risk**: changing V1 meaning can invalidate stored digests and replay fixtures. Additive versioning/projection is safer.
- **State-machine risk**: Review before broad introduces a new gate but must not introduce a new OpenSpec phase.
- **Safety-floor risk**: delaying broad must never mean omitting mandatory broad checks or lowering Full-SDD/security/authorization/data-loss floors.
- **Independence risk**: sharing causal evidence must not share agent identity, attempt summaries, or conclusions.
- **Scope-creep risk**: recommendation/deferred findings can become accidental work unless the effect boundary accepts only blocking finding IDs.
- **Retry risk**: separately maintained fingerprint systems can disagree; one stable convergence identity must bind the modifying decision.
- **Registry risk**: no specialist may write shared YAML in centralized mode; ordered intents must be committed only after all required evidence is current.
- **Generated-output risk**: prompt source changes may require canonical regeneration, but generated files remain prohibited direct targets.
- **Excluded-scope risk**: any target intersection with `runner-capability-standardization` is a hard stop.

## Open questions for Proposal/Spec/Design

1. Should finding disposition be a new required field in a V2 manifest, or a separate versioned classification envelope over unchanged V1 findings?
2. Should “Review stable” mean zero blocking findings only, or also explicit acceptance of all deferred/recommendation classifications?
3. Can a low-risk Review be reused after a repair when its reviewed dependency digest is unchanged, or should every Review-discovered blocker force a fresh Review?
4. Should Design and Task be distinct execution actions, or one replan action with a mandatory deterministic owner field?
5. What exact runtime evidence differentiates Verify-runtime diagnosis from environment/capability escalation?
6. Does the minimal repair projection retain the original batch ID with a new projection digest, or require an additive child-batch identity? It must not mutate the original batch.
7. Which existing broad-deferral policies, if any, authorize final broad deferral for Fast lane without conflicting with the requested lifecycle?

## Recommendation and confidence

Proceed to Proposal with **Option B: an additive deterministic lifecycle coordinator and blocking-work projection**. Specify the lifecycle as a state machine without adding an OpenSpec phase, preserve V1 readability, enforce blocking-only repair at the runtime effect boundary, and make post-repair evidence invalidation explicit.

Confidence: **high (0.91)**. The central sequencing and contract gaps are directly evidenced by current source and passing tests. Exact V2 shape and Review-reuse policy remain Design decisions.

## Dependency references

- Official configuration: `openspec/config.yaml`.
- Official registry contract: `openspec/registry-schema.md`.
- Promoted constraints: `openspec/specs/adaptive-quality-control/spec.md`, `openspec/specs/artifact-state-contracts/spec.md`, `openspec/specs/runner-orchestration-resilience/spec.md`.
- Baseline ledger: `openspec/baseline-health.yaml`.
- Historical/runtime evidence only: `openspec/changes/developer-team-execution-convergence/{spec.md,design.md,tasks.md,state.yaml,verify-batch-c-final-repair.md}`.
- Runtime implementation and tests: files listed in Source impact candidates and Test impact candidates.

## Explore phase result data

- Status: `completed`.
- Recommended next action: `proposal`.
- FailureManifestV1: none; Explore found design/contract gaps, not a validated issued-batch failure manifest.
- RegistryIntentV1 values: none. No immutable batch/dossier or authoritative base state/events snapshot was supplied for this new change, and centralized-mode registry writes belong to the coordinator.
- Blockers to Proposal: none.
- Blockers to Apply: B1–B6 must be resolved through Proposal → Spec/Design → Tasks before any modifying batch is issued.
