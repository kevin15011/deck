# Proposal: Deterministic Apply → Verify → Review Flow

## Change identity

- **Change ID:** `deterministic-apply-verify-review-flow`
- **Execution mode:** Automatic
- **Risk level:** High
- **Authoritative input:** the user-authorized request and `exploration.md` for this change

## Problem

Deck has strong primitives for immutable execution evidence, stable finding identity, staged verification, bounded repair, role freshness, replayable decisions, and centralized registry intents. The current lifecycle does not combine them into the requested deterministic and convergent flow. Runtime scheduling requires broad verification before Review, a legacy prompt describes Verify and Review as parallel after Apply, finding contracts lack the required disposition vocabulary, repair inputs are not machine-limited to blocking work, routing ownership is not sufficiently explicit, and retry evidence is split across contracts.

Prompt-only changes would leave these runtime gaps unenforced and would not provide reproducible repair authorization.

## Intent

Establish one deterministic, replayable Apply → Verify → Review lifecycle within the existing OpenSpec phases. The lifecycle will preserve independent role judgments, authorize repair only for anchored blocking findings, route each blocking root cause to an explicit owner, require progress for bounded retries, postpone broad validation until implementation and Review are stable without weakening mandatory broad-check floors, and keep shared registry mutation centralized.

## Measurable outcomes

The change is successful when all of the following are demonstrated by the future Spec, Design, implementation, and independent verification evidence:

1. One canonical lifecycle orders authorized Apply work, independent targeted and affected-area Verify evidence, independent Review, any blocking-only repair and scoped revalidation, and required broad verification before completion.
2. Every normalized finding has an unambiguous disposition equivalent to `blocking`, `recommendation`, `deferred`, or `pre-existing`; only an anchored blocking finding can authorize modifying repair work.
3. Every blocking root cause deterministically routes to Apply, Spec, Design, Task, Verify-runtime diagnosis, or escalation, without opportunistic scope growth or mixed-owner repair batches.
4. Every Apply repair input is immutable, minimal to the selected blocking work, bound to its original authorization and causal evidence, and rejected when it exceeds its allowed targets or checks.
5. Identical authoritative inputs produce the same stable finding identities, routing decision, retry identity, action, and ordered registry intents; prose, timestamps, and agent identity do not change the decision.
6. Modifying retries occur only while stable evidence demonstrates positive progress and remain bounded by existing hard safety limits; no progress, regression, exhaustion, or ambiguous evidence causes diagnosis, replan, stop, or escalation rather than blind repair.
7. Apply, Verify, and Review use independent identities and judgments, with freshness and evidence invalidation enforced after modifications.
8. Focused and affected-area checks pass, required broad checks run after implementation and Review stabilize, no mandatory Full-SDD/security/authorization/data-loss floor is deferred, and repository-wide results introduce no failure beyond an exact documented baseline fingerprint.
9. Specialists emit ordered `RegistryIntentV1` values only; the centralized coordinator remains the sole writer of shared registry state and stops on conflict or recovery-required outcomes.

## Proposed approach

Adopt the exploration's recommended additive direction: introduce versioned lifecycle, disposition, routing, convergence, and blocking-work concepts while preserving the meaning and readability of existing V1 contracts and recorded evidence. Align runtime enforcement and canonical role instructions around the same lifecycle, then prove compatibility, ordering, authorization boundaries, replay, retry convergence, and safety floors through focused, integration, and repository-wide checks.

This proposal approves the direction and boundaries only. Exact contract shapes, state transitions, public interfaces, file changes, and test scenarios belong to Spec and Design and must be converted into authorized Tasks before Apply.

## In scope

- Define the required lifecycle gates inside the existing Apply, Verify, and Review phases, including post-repair freshness and scoped revalidation.
- Define finding dispositions and their effect on completion, reporting, routing, and repair authorization.
- Define total blocking-root-cause routing and deterministic ownership, including Verify-runtime diagnosis and escalation boundaries.
- Define an immutable, blocking-only repair input that remains bound to the original authorized batch without mutating it.
- Unify stable retry identity, demonstrated progress, attempt accounting, and terminal governance into replayable decisions.
- Preserve mandatory broad validation while moving it after stable scoped verification and Review; any later modification must invalidate stale evidence.
- Align authoritative runtime behavior and canonical Developer Team prompt sources so they cannot prescribe contradictory choreography.
- Extend focused, contract, integration, replay, scheduler, prompt-parity, and broad validation coverage as authorized by later artifacts.
- Preserve ordered, idempotent, centralized registry-intent handling and fail-closed conflict recovery.

## Exclusions

- This Proposal phase authorizes writing only `openspec/changes/deterministic-apply-verify-review-flow/proposal.md`. It does not authorize changes to source, tests, generated files, `state.yaml`, or `events.yaml`.
- No existing OpenSpec change may be modified, continued, reconciled, or used to widen this change. Historical changes may remain read-only evidence only.
- `runner-capability-standardization` is explicitly excluded from every batch, target allowlist, dependency expansion, and repair route.
- Direct edits to generated outputs are excluded. Any later generated effects must follow the repository's canonical source-driven process and separately authorized tasks.
- No new OpenSpec phase, alternate registry authority, specialist registry writer, or parallel Verify/Review shortcut will be introduced.
- Recommendations, deferred items, pre-existing findings, unrelated baseline failures, and optional improvements cannot authorize Apply work.
- Adapter expansion, rollout cohorts, telemetry programs, and reopening historical rollout work are outside this change.
- This change will not weaken artifact/specification authority, authorization checks, Git protections, destructive-operation confirmation, secrets/security controls, data-loss floors, lane floors, verification freshness, or hard-stop precedence.

## Authority and quality invariants

- OpenSpec artifacts and the Spec Registry remain authoritative; source and tests provide runtime evidence; adaptive memory remains advisory.
- Apply, Verify, and Review remain separate judgments produced by independent role instances. Shared evidence cannot transfer identity or conclusions between them.
- Targeted and affected-area validation precede Review. Required broad validation follows stable implementation and Review and remains mandatory wherever policy or a safety floor requires it.
- A later modification invalidates dependent evidence and requires deterministic scoped revalidation; broad evidence is never reused after an invalidating modification.
- Runtime policy and effect boundaries, not prompt wording, decide whether modification is authorized.
- Registry state remains single-writer and append-preserving. Specialists never write `state.yaml` or `events.yaml` in centralized mode.
- Automatic mode may advance authorized work after required gates succeed, but it cannot waive approval boundaries, independent verification/review, safety floors, broad checks, conflict stops, or destructive Git confirmation.

## Dependencies and evidence

- `openspec/changes/deterministic-apply-verify-review-flow/exploration.md` — validated current behavior, gaps B1–B6, options, and impact candidates.
- `openspec/config.yaml` — strict TDD, focused gates, baseline comparison, and project quality rules.
- `openspec/registry-schema.md` — canonical lifecycle, artifact registration, provenance, events, and centralized registry constraints.
- `openspec/specs/adaptive-quality-control/spec.md` — bounded repeated-cycle handling and forced replan/split/escalation.
- `openspec/specs/artifact-state-contracts/spec.md` — structured mutation, single-writer control, stale-update recovery, and preserved history.
- `openspec/specs/runner-orchestration-resilience/spec.md` — transport/runtime diagnosis, budgets, watchdog hard stops, and capability-aware verification.
- `openspec/baseline-health.yaml` — exact known-failure ledger and regression policy.
- Current runtime contracts, orchestration sources, and tests identified by `exploration.md` — runtime evidence to be changed only after Spec, Design, and Tasks authorize exact targets.
- `openspec/changes/developer-team-execution-convergence/**` — historical/runtime evidence only, never a modification target or authority for scope expansion.

There is no dependency on `runner-capability-standardization`.

## Rollout and compatibility

- Preserve existing V1 meanings, digests, stored evidence, and readers; prefer additive versioning or validated projections over reinterpretation or mutation.
- Deliver the approved work in bounded, dependency-ordered tasks. New lifecycle behavior must not become completion-authorizing until contract compatibility, deterministic replay, role independence, safety floors, and canonical prompt/runtime parity are proven.
- Use detected project verification capabilities and the baseline ledger. Focused checks must pass, any new repository failure blocks completion, and the sole known failure is non-blocking only when its complete recorded fingerprint matches.
- Automatic execution stops rather than falls back silently when evidence is stale, malformed, ambiguous, conflicting, unauthorized, non-progressing, or safety-sensitive.
- No cohort, telemetry-window, or adapter-expansion rollout is part of this proposal.

## Risks and mitigations

| Risk | Level | Proposal-level mitigation |
|---|---|---|
| Existing V1 evidence or replay fixtures become unreadable | High | Require additive compatibility and preserve prior semantics and digests. |
| Review-before-broad sequencing creates an unsafe completion path | High | Keep broad as a required final gate and preserve all mandatory floor cases. |
| Shared evidence compromises role independence or freshness | High | Preserve distinct identities, causal projections, and invalidation after modification. |
| Non-blocking findings cause opportunistic repair or scope growth | High | Enforce blocking-only authorization at the runtime effect boundary. |
| Retry identities disagree or reward unrelated work | High | Bind modifying decisions to one stable, replayable blocking set and demonstrated progress. |
| Registry races or stale commits corrupt lifecycle state | High | Retain ordered intents, centralized single-writer commit, optimistic base checks, and hard stops. |
| Prompt and runtime behavior diverge again | Medium | Treat runtime as enforcement and require canonical source parity tests. |
| Work crosses excluded change boundaries | High | Hard-stop any target intersection with an existing OpenSpec change or `runner-capability-standardization`. |

## Rollback

If implementation introduces an authorization, replay, compatibility, ordering, registry, or safety regression, automatic progression must stop before further modifying work or registry commit. Rollback will use a normal auditable revert or forward-fix of the coherent implementation slice while retaining read compatibility for any already-recorded additive evidence. Prior OpenSpec artifacts, registry events, provenance, and immutable execution evidence must remain preserved; rollback must not rewrite history, discard uncommitted work, delete registry records, mutate existing changes, or bypass Git/destructive-operation confirmation. The prior supported runtime behavior remains the fallback only after its compatibility and mandatory verification floors are restored and revalidated.

## Decisions deferred to Spec and Design

The following decisions are intentionally unresolved here and must not be guessed during Apply:

1. The formal semantics and acceptance effect of each disposition, including what “Review stable” means.
2. Whether disposition uses a versioned manifest field or a separate classification envelope over unchanged V1 findings.
3. The exact lifecycle states, transition guards, evidence invalidation rules, and conditions for reusing or rerunning Review.
4. The exact total routing table and evidence boundary between Apply, Spec, Design, Task, Verify-runtime diagnosis, and escalation.
5. Whether action and owner are separate stable codes, including whether Design and Task remain one replan action or become distinct actions.
6. The minimum causal references and identity model for blocking-only repair input, including projection digest versus additive child-batch identity.
7. The single retry identity, positive-progress proof, accounting model, and bounded transition from diagnosis to replan or escalation.
8. Which existing broad-deferral policies, if any, can apply without violating mandatory broad checks or safety floors.
9. The exact compatibility, migration, and reader behavior for stored V1 and additive evidence.

## Approval boundary and next action

Approval authorizes Spec and Design to proceed from this proposal, potentially in parallel, within the stated scope. It does not authorize implementation. B1–B6 from `exploration.md` remain blockers to Apply until Spec, Design, and Tasks resolve them into an approved modifying batch. There are no blockers to beginning Spec and Design.
