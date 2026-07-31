# Draft Proposal: Causal BROAD QA Governance

## Proposal status

- **Change ID:** `causal-broad-qa-governance`
- **Classification:** Run SDD
- **Mode:** Interactive
- **Status:** Approved in Interactive mode; selected policies are recorded below
- **Risk level:** High, because this change governs final quality disposition, Archive eligibility, and execution ordering
- **Authorization boundary:** This draft authorizes no Spec, Design, Tasks, source, test, configuration, generated-output, runtime, registry, or lifecycle-state change. Draft completion is not approval.

The user is the client, system owner, domain authority, and active stakeholder for the two policy choices in this proposal. Only the coordinator may record explicit approval. Spec and Design remain blocked until that approval includes both choices.

## Coordinator approval record

- **Recorded by:** Orchestrator
- **Mode:** Interactive
- **Date:** 2026-07-29
- **Approval:** The user explicitly approved this proposal with the recommended selections.
- **Selected policy 1:** **1A — Strict documented nonblocking disposition.**
- **Selected policy 2:** **2A — Independent checks within a Verify stage only.**
- **Boundary:** This approval authorizes Spec and Design work within this proposal. It does not authorize Tasks, Apply, source, test, configuration, generated-output, runtime, registry, or lifecycle-state changes.

## Problem

BROAD is a mandatory final quality gate and currently blocks Archive. It has caught genuine candidate defects, so deleting or bypassing it would remove material protection. However, an audit of the ten most recent changes also found recurrent failures caused by historical repository state, global baseline debt, execution environment differences, and verification-harness faults rather than by the candidate under judgment. Treating every such failure as an active-candidate defect can force unrelated repair, repeated final-QA cycles, or indefinite closure delay without improving the candidate.

The execution authority is also split. Current policy, canonical prompt choreography, and the convergence contract describe:

`TARGETED -> AFFECTED_AREA -> Review -> BROAD`

The exported legacy role scheduler and integrated convergence fixture instead exercise:

`TARGETED -> AFFECTED_AREA -> BROAD -> Review`

The newer convergence contract appears not to control production scheduling. Until this split is reconciled, changing prompt text or one helper cannot establish a trustworthy final-QA order.

Final Verify and Review also cannot simply be made parallel. Commit `15804c48584fc2b4e936a71c88608e9523011d79` deliberately removed that pattern: Review consumes current candidate-bound Verify evidence, Review-directed repairs invalidate dependent evidence, and BROAD must judge the stable candidate. Restoring Verify and Review as concurrent authoritative acceptance gates would require a different evidence model and is outside this change.

## Intent

Make BROAD causally fair, operationally predictable, and as efficient as safety permits while preserving its defect-detection value. The change will establish one authoritative final-QA order, distinguish candidate-caused findings from rigorously proven non-candidate findings, and introduce only bounded concurrency whose results are joined before an authoritative phase judgment.

The selected policy must reduce unrelated closure churn without laundering regressions, weakening mandatory floors, sharing registry writes, accepting stale evidence, or merging independent Verify and Review judgments.

## Measurable outcomes

Future Spec, Design, implementation, and independent evidence will demonstrate all of the following:

1. Every supported production scheduling path, policy surface, prompt surface, and maintained integration fixture expresses one final-QA order: `TARGETED -> AFFECTED_AREA -> Review -> BROAD`.
2. One production-reachable authority, rather than prompt wording alone, governs that order; legacy exports and fixtures are either reconciled to it or explicitly bounded as non-authoritative compatibility surfaces.
3. One hundred percent of mandatory BROAD obligations still execute for Full-SDD and protected-risk work. No check is skipped, shortened, filtered, deferred, or relabeled to obtain a pass.
4. Every BROAD finding receives a durable causal disposition. Candidate-caused, new, worsened, related, unproven, stale, conflicting, or protected-risk findings remain blocking.
5. Under the approved non-candidate policy, equivalent evidence produces the same blocking or non-blocking result across replay, scheduler, and Archive-decision fixtures. A failing run cannot self-authorize the exception or baseline record it consumes.
6. Archive is never enabled while a candidate-related or protected blocking finding remains, while required evidence is stale, or while the final-QA order is incomplete.
7. Any candidate modification or Review-directed repair invalidates all dependent quality evidence and restarts the required fresh sequence; no pre-repair Review or BROAD result is reused as current acceptance evidence.
8. The approved first concurrency tier executes every required check and produces the same phase judgment, evidence set, role-independence result, and registry-intent order as its serial control. A deterministic critical-path comparison demonstrates reduced elapsed work for at least one representative eligible fixture without reducing check count.
9. There are zero concurrent authoritative final Verify and Review acceptance judgments, zero specialist writes to shared registry YAML in centralized mode, and zero silent downgrades of Full-SDD or protected-risk floors.

## Bounded scope

### Required work

- Define proposal-level causal governance for BROAD findings while retaining mandatory BROAD execution.
- Select and consistently apply one of the two non-candidate disposition policies below.
- Reconcile the scheduler/convergence authority split so the intended `TARGETED -> AFFECTED_AREA -> Review -> BROAD` sequence is production-reachable and testable.
- Preserve a stable-candidate boundary: Review consumes current scoped Verify evidence, BROAD consumes the resulting stable candidate and Review evidence, and later modification invalidates both.
- Introduce the selected safe concurrency tier only where work is independent and all results join before an authoritative judgment.
- Keep Apply, Verify, Review, and BROAD evidence and role judgments distinct even when they share immutable candidate and dependency references.
- Coordinate with the active evidence-backed baseline-disposition work so this change reuses, explicitly supersedes, or remains compatible with it rather than creating a competing acceptance rule.
- Preserve centralized, ordered registry intents; specialists return intents and never race to write `state.yaml` or `events.yaml`.
- Measure causal disposition outcomes, retries, stage elapsed work, and evidence invalidation sufficiently to compare the new behavior with the current serial/blocking baseline without collecting secrets or raw prompts.

### Optional follow-up

Any concurrency tier not selected for the first implementation remains a separately approved follow-up. It must not be smuggled into Spec, Design, Tasks, or Apply as an optimization detail.

### Explicit exclusions

- **Total deletion, blanket disabling, or routine skipping of BROAD is excluded.**
- **Authoritative final Verify and Review parallelism is excluded.** This proposal does not restore the removed Verify+Review acceptance shortcut.
- No weakening of mandatory BROAD floors for Full-SDD, high/critical risk, security, authorization, credentials/secrets, destructive behavior, Git safety, data loss, protected migrations, public interfaces, architecture, generated-output integrity, registry recovery, freshness, or required artifacts.
- No merging of Apply, Verify, or Review identities or judgments; no use of user acceptance as engineering QA.
- No reuse of stale evidence after repair, no same-run baseline self-admission, and no warning classification based only on age, prose, a bare fingerprint, or user pressure.
- No automatic repair of unrelated historical/global repository debt inside the active candidate's scope.
- No new OpenSpec phase, alternate registry authority, distributed shared-registry writes, or rewrite of historical state, events, findings, or archived evidence.
- No direct edit of generated outputs and no change to `runner-capability-standardization`.
- No source, test, configuration, runtime, baseline-ledger, or registry implementation during this Proposal phase.

## Approach alternatives and tradeoffs

### Consequential choice 1 — non-candidate BROAD disposition

| Option | Policy direction | Benefit | Cost and guardrail |
|---|---|---|---|
| **1A — Strict documented nonblocking disposition (recommended)** | BROAD still runs. A residual finding may become a durable warning only after authoritative evidence proves it predates the candidate, reproduces equivalently, is causally unrelated and non-worsened, is outside every protected-risk class, and is covered by separately authorized durable baseline admission. | Prevents proven repository, environment, or harness debt from indefinitely blocking an otherwise sound candidate; aligns with the active evidence-backed baseline-disposition direction. | Evidence is intentionally expensive and introduces anti-laundering complexity. Any missing, stale, conflicting, or self-authorized element fails closed and blocks. |
| **1B — Retry/repair-only** | Any nonzero BROAD result remains blocking. Environment or harness faults may be retried after bounded diagnosis; durable repository defects require a separately approved baseline repair before BROAD is rerun. | Simplest acceptance rule and lowest risk of misclassification. | Continues closure delay and additional lifecycle work for failures proven unrelated to the candidate; may reproduce the churn this proposal is intended to reduce. |

Option 1A does not mean “ignore unrelated failures.” It preserves the raw failure, its disposition evidence, residual risk, and follow-up through Archive. Option 1B does not authorize absorbing repository repair into the candidate; repair remains separate and explicitly scoped.

### Consequential choice 2 — first safe concurrency tier

| Option | First implementation boundary | Benefit | Cost and guardrail |
|---|---|---|---|
| **2A — Independent checks within a Verify stage only (recommended first)** | Parallelize only checks that have no ordering, mutation, shared-state, or evidence dependency inside one TARGETED, AFFECTED_AREA, or BROAD stage. Join all results before the stage verdict. | Lowest-risk speed improvement; leaves phase ordering and independent Review unchanged. | Smaller initial time saving and requires conservative eligibility classification. |
| **2B — In-stage checks plus speculative/final-join subreviews** | Include 2A, and additionally allow non-accepting speculative analyses or isolated Review subscopes. A fresh final joined Review, after required current Verify evidence, remains the sole authoritative Review judgment. | Can reduce analysis latency and distribute large Review workloads. | Higher orchestration, contamination, identity, and evidence-joining complexity; no subreview may independently approve, authorize repair, emit a completion intent, or race final Review. |

### Rejected alternatives

- **Delete BROAD:** rejected because BROAD has caught real candidate defects and remains a mandatory safety floor.
- **Keep contradictory authorities and change prompts only:** rejected because the new contract is not proven to schedule production work and legacy order remains executable in exported code and fixtures.
- **Run final Verify and Review as parallel acceptance gates:** rejected because Review depends on current Verify evidence and repair invalidation; this would reverse the safety decision in commit `15804c48584fc2b4e936a71c88608e9523011d79` without the required evidence-model redesign.
- **Always repair every BROAD failure inside the active change:** rejected because it expands candidate scope, obscures causality, and couples closure to unrelated repository debt.

## Dependencies and coordination gates

1. **User policy selection:** explicit approval must choose exactly one option from Choice 1 and one option from Choice 2.
2. **Scheduler/convergence authority reconciliation:** before implementation can become acceptance-authoritative, Spec and Design must identify the production scheduling owner and reconcile policy/prompts/convergence (`Review -> BROAD`) with the exported scheduler and integrated fixture (`BROAD -> Review`). Unsupported compatibility paths must be explicitly bounded rather than silently left contradictory.
3. **Active baseline-disposition boundary:** `project-init-skill-registry-and-session-baseline` currently owns an evidence-backed `passed_with_warnings` policy and related runtime work. Choice 1A should reuse its authoritative result where compatible; Choice 1B, or any conflicting semantics, requires explicit supersession and target coordination rather than duplicate policy.
4. **Execution-convergence boundary:** `developer-team-execution-convergence` owns active convergence, staged-verification, role-freshness, and registry-coordination work. This change must consume its final authoritative result and coordinate any overlapping target before Apply.
5. **Historical safety decision:** the sequencing and invalidation rationale preserved by `deterministic-apply-verify-review-flow` and commit `15804c48584fc2b4e936a71c88608e9523011d79` remains a floor unless a separately approved evidence-model redesign occurs.
6. **Baseline and project policy:** `openspec/config.yaml`, `openspec/baseline-health.yaml`, OpenSpec authority, strict TDD, centralized registry ownership, and existing protected-risk policy remain governing dependencies.

No implementation activation may proceed from prompt parity alone. The authority split, active-change overlap, and selected disposition/concurrency policies must be resolved in official Spec and Design before Tasks authorize targets.

## Risks and mitigations

| Risk | Level | Proposal-level mitigation |
|---|---|---|
| A candidate regression is mislabeled as historical or environmental. | High | Candidate-first causality, protected-risk precedence, immutable two-subject evidence for Option 1A, independent Review, and fail-closed ambiguity. |
| Scheduler paths continue to execute different final-QA orders. | High | Make authority reconciliation a dependency and block acceptance activation until production reachability and maintained fixtures agree. |
| Concurrency compromises role independence or consumes incomplete evidence. | High | Parallelize only dependency-independent work, mark speculative work non-accepting, join before judgment, and retain one fresh final Review. |
| Review repair leaves stale BROAD or Review evidence current. | High | Treat every modification as invalidating dependent evidence and require the fresh ordered sequence against the new candidate identity. |
| The proposal duplicates or contradicts active baseline/convergence work. | High | Require explicit reuse, supersession, compatibility, and target-overlap decisions before Tasks or Apply. |
| Retry/repair-only preserves excessive closure latency. | Medium | Keep retries bounded, classify environment/harness causes before modification, and route durable repository repair as separate authorized work. |
| Strict nonblocking evidence becomes too expensive or operationally brittle. | Medium | Reuse durable valid evidence only under explicit freshness/invalidation rules; otherwise block rather than lower proof quality. |

## Rollback

Rollback will be an auditable, separately authorized revert or forward fix of the coherent policy/scheduling slice. It will restore serial execution and the prior fail-closed BROAD disposition before any weaker or ambiguous acceptance behavior remains active.

Concurrency is disabled first while retaining all checks. If causal disposition is implicated, nonzero BROAD results return to blocking until corrected evidence and policy are independently revalidated. BROAD itself, protected-risk floors, final Review independence, freshness, candidate identity, centralized registry ownership, and historical evidence are never rollback switches.

Rollback preserves all recorded findings, warning dispositions, failed attempts, registry intents, state/event history, and active-change artifacts. It must not rewrite history, delete evidence, edit generated outputs directly, touch `runner-capability-standardization`, or use destructive Git operations without the permanent informed-confirmation flow.

## Resolved proposal decisions

The following user-owned decisions were resolved by explicit Interactive approval:

1. **Non-candidate BROAD policy:** **1A, strict documented nonblocking disposition**.
2. **First safe concurrency tier:** **2A, in-stage Verify checks only**.

No other Proposal-level scope decision is open. After approval, Spec and Design may choose bounded representations, interfaces, eligibility rules, and rollout mechanics only within the selected options and unchanged safety floors.

## Exact approval question

**As the client, system owner, domain authority, and active stakeholder, do you approve this High-risk `causal-broad-qa-governance` proposal—including mandatory BROAD preservation, one authoritative `TARGETED -> AFFECTED_AREA -> Review -> BROAD` order, causal finding governance, active-change coordination, exclusions, dependencies, and rollback—and which exact pair do you select: Choice 1A or 1B, and Choice 2A or 2B?**

The recommended starting pair is **1A + 2A**. Please respond with explicit approval and the selected pair, for example: `Approve 1A + 2A`, or request revisions. Draft completion alone is not approval.

## Handoff readiness

- **Approval status:** explicit Proposal approval with both selections is recorded above.
- **Next handoff:** Spec and Design may proceed in parallel from this boundary.
- **Before Tasks or Apply:** scheduler/convergence production authority and overlap with both active dependent changes must be reconciled in official artifacts.
- **Implementation remains unauthorized:** this proposal creates no modifying authority beyond this draft artifact.

## Official evidence and provenance

- User-supplied official exploration evidence: recent ten-change BROAD audit; current and legacy order split; production-wiring gap; commit `15804c48584fc2b4e936a71c88608e9523011d79`; safe concurrency boundaries; unchanged mandatory floors.
- `openspec/config.yaml` and `openspec/registry-schema.md`.
- `openspec/archive/deterministic-apply-verify-review-flow/` and `openspec/archive/stabilize-repository-broad-baseline/`.
- `openspec/changes/developer-team-execution-convergence/` and `openspec/changes/project-init-skill-registry-and-session-baseline/` as active dependency boundaries, not modification authority.
- Current runtime evidence: `packages/sdd-runtime/src/contracts/execution-convergence.ts`, `packages/sdd-runtime/src/execution/execution-control-plane.ts`, and `packages/sdd-runtime/src/testing/developer-team-convergence-fixture.ts`.
- **Role:** `deck-developer-proposal`; **runner:** `opencode`; **model:** `openai/gpt-5.6-sol`; **instance:** `deck-developer-proposal-opencode-causal-broad-qa-governance-20260729`.
- Skill Discovery Context V1 was `indeterminate` with reason `CLI_VALIDATION_OPENED_INTERACTIVE_MENU`. Bounded direct discovery used generic project sources and the active OpenCode runner only. `.atl/skill-registry.md` was neither treated as authority nor written.
- Adaptive memory was loaded as advisory context only; official user evidence, OpenSpec artifacts, source, and tests controlled this draft.
