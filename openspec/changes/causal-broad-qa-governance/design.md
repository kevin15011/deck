# Design: Causal BROAD QA Governance

## Design status and authority

- **Change:** `causal-broad-qa-governance`
- **Phase:** Design
- **Mode:** Interactive
- **Approved policies:** **1A**, strict documented nonblocking disposition; **2A**, independent checks within one Verify stage only
- **Design status:** Complete, with one Spec reconciliation blocker recorded below; Task authoring is blocked until it is resolved in official context.
- **Implementation authority:** None. This artifact does not authorize Tasks, Apply, source, test, configuration, generated-output, registry, or lifecycle-state changes.
- **Required order:** `TARGETED -> AFFECTED_AREA -> Review -> BROAD`
- **Permanent exclusions:** no authoritative Verify+Review parallelism, no BROAD deletion/skipping, no direct generated-output edit, and no change to `runner-capability-standardization`.

OpenSpec artifacts and Spec Registry records are authoritative. Source and tests are current runtime evidence. Adaptive memory was loaded as advisory context only and did not alter the approved Proposal or Spec.

## Spec reconciliation

The available parallel Spec materializes 31 requirement headings and 51 scenarios, although its compliance matrix reports 28 requirements. This Design maps all requirement areas and preserves the approved Proposal. Two internal Spec defects must be corrected or explicitly reconciled before Tasks:

- **`CBQG-SPEC-B01` — CP-01 scenario order conflict:** `REQ-CBQG-CP-01` normatively requires Review not to overlap any Verify stage, and `REQ-CBQG-AQ-01` requires Review before BROAD. The CP-01 scenario nevertheless says “Review runs only after BROAD completes,” while its own parenthetical says Review precedes BROAD. This Design follows the approved Proposal, AQ-01, CP-01's normative requirement, and the scenario parenthetical: **Review completes before BROAD starts**. Tasks and Apply must not rely on the contradictory sentence until the Spec is repaired or the coordinator records an official clarification.
- **`CBQG-SPEC-B02` — requirement-count mismatch:** the ten area lists contain 31 distinct `REQ-CBQG-*` headings (`2+2+3+3+3+3+4+3+4+4`), while the compliance matrix and total claim 28. The Spec must correct the area/total accounting without deleting or weakening a requirement, or explicitly identify any unintended duplicate, before Task coverage can be proven.

No Design decision restores final Verify+Review parallelism or permits BROAD omission.

## Focused architecture findings

1. `packages/sdd-runtime/src/contracts/execution-convergence.ts` already encodes the correct lifecycle: `targeted_pending -> affected_pending -> review_pending -> broad_pending -> registry_commit_pending`. Its authority-bound transitions validate stage, generation, implementation subject, dependency set, and typed evidence.
2. `packages/sdd-runtime/src/orchestrator/staged-verification.ts` remains a check-state container ordered `targeted -> affected_area -> broad`; it has no Review state. That order is valid only inside Verify and must not independently decide the cross-role lifecycle.
3. `packages/sdd-runtime/src/orchestrator/decision-kernel.ts` advances from `verification.nextStage`, and `scheduleExecutionRoleInvocationV1()` currently schedules Review only after staged verification is complete. Therefore the exported scheduler still reaches BROAD before Review.
4. `packages/sdd-runtime/src/testing/developer-team-convergence-fixture.ts` confirms the split by looping through `targeted`, `affected_area`, and `broad`, then scheduling Review.
5. Graph and source references show `scheduleExecutionRoleInvocationV1()` and `consumeExecutionRoleResultV1()` are exported but currently exercised by scheduler/tests and the maintained integration fixture, not by a production QA host path. The runner host bridge and canonical OpenCode/Pi assets currently enforce Apply/deck-init boundaries, not Verify/Review/BROAD scheduling and result consumption.
6. The OpenCode plugin source currently implements `tool.execute.before` but not `tool.execute.after`. The supported OpenCode plugin API exposes both hooks, including session/call correlation and mutable post-execution result metadata. The Pi extension currently implements `tool_call`; its supported extension lifecycle provides an equivalent post-result hook. Both adapters therefore have a concrete source-level integration seam, but activation must remain fail-closed until their conformance tests prove result interception.
7. The active `project-init-skill-registry-and-session-baseline` candidate already introduces `BaselineEvidenceEnvelopeV1`, `BaselineLedgerAuthorityRefV1`, `QualityDispositionEnvelopeV1`, `evaluateFindingDispositionBaselineV1()`, and canonical warning/fail-closed role content. This change must consume those contracts, not create a second baseline ledger or evaluator policy.
8. The active baseline evaluator currently returns warning/blocking decisions, while this Spec requires one of nine durable causal classifications for every BROAD finding. A narrow authoritative BROAD projection is needed above the baseline proof evaluator.
9. `RegistryCoordinatorV1.commitAll()` currently loops over single-intent commits. That can expose a committed prefix and does not satisfy the Spec's one atomic intent transition. The authoritative QA path needs an additive atomic chain operation; legacy single-intent behavior remains readable.
10. Canonical runner asset sources are the two TypeScript files under adapter `assets/`; `scripts/generate-runner-execution-assets.ts` produces the checked-in `.generated.js` files. The generated JavaScript files are never direct edit targets.

## Chosen architecture

### Decision 1 — Convergence is the sole QA sequencing authority

Add `QaExecutionAuthorityV1` as a pure control-plane facade over the existing authority-bound `ExecutionConvergenceDossierV1`. It does not introduce a second state machine. Given a validated snapshot, it emits exactly one next action:

```ts
type QaNextActionV1 =
  | { kind: "run_verify_stage"; stage: "targeted" | "affected_area" | "broad"; invocation: QaRoleInvocationV1 }
  | { kind: "run_review"; invocation: QaRoleInvocationV1 }
  | { kind: "commit_registry_chain"; readiness: QualityReadinessDecisionV1 }
  | { kind: "route_blockers"; blockingFindingIds: readonly FindingId[]; reasonCodes: readonly string[] }
  | { kind: "blocked"; reasonCodes: readonly string[] };
```

The lifecycle, not a caller-supplied role or `verification.nextStage`, selects the action:

| Convergence state | Sole legal accepting action |
|---|---|
| `targeted_pending` | TARGETED Verify stage |
| `affected_pending` | AFFECTED_AREA Verify stage |
| `review_pending` | fresh independent Review |
| `broad_pending` | BROAD Verify stage |
| `registry_commit_pending` | readiness validation, then one atomic registry-intent chain |

`StagedVerificationStateV1` remains the compatible owner of Verify check status. New scoped and broad acceptance helpers expose TARGETED+AFFECTED_AREA completion separately from BROAD completion. It is explicitly **not** a cross-role scheduler.

`scheduleExecutionRoleInvocationV1()` and `consumeExecutionRoleResultV1()` remain exported compatibility facades. In an active run they require a current convergence authority binding and delegate to `QaExecutionAuthorityV1`; an active call without that binding returns a stable fail-closed `QA_AUTHORITY_REQUIRED` result. Legacy/observe/shadow callers may still be parsed and compared, but cannot emit commit-ready intents or control active QA ordering.

### Decision 2 — Additive, discriminated authority contracts

Public contracts expose stable semantic fields, not raw command strings, prompt text, private reasoning, logs, temporary paths, or runner implementation details.

```ts
interface QaAuthoritySnapshotV1 {
  readonly schema: "qa-authority-snapshot-v1";
  readonly qaRunId: `qa-run:v1:${string}`;
  readonly changeId: string;
  readonly batchId: BatchId;
  readonly batchDigest: Sha256Digest;
  readonly convergenceDossierDigest: Sha256Digest;
  readonly convergenceRevision: number;
  readonly generation: number;
  readonly lifecycle: ConvergenceLifecycleStateV1;
  readonly implementationSubjectDigest: Sha256Digest;
  readonly dependencySetDigest: Sha256Digest;
  readonly stagedVerificationDigest: Sha256Digest;
  readonly protectedPolicyDigest: Sha256Digest;
  readonly registryBase: { readonly stateDigest: Sha256Digest; readonly eventsDigest: Sha256Digest };
  readonly digest: Sha256Digest;
}

type QaAuthorityBindingV1 =
  | { readonly kind: "convergence"; readonly snapshotDigest: Sha256Digest; readonly generation: number; readonly dependencySetDigest: Sha256Digest }
  | { readonly kind: "legacy_compatibility"; readonly nonAuthoritative: true };
```

The existing role invocation/result schemas gain an additive nested `authority` discriminant. Active parsing requires `kind: "convergence"`; an absent binding is interpreted only by the legacy compatibility adapter. Unknown kinds, fields, versions, or digest mismatches fail closed at the runner/control-plane boundary.

### Decision 3 — Stage plans, immutable check results, and join-before-verdict

Policy 2A is implemented as deterministic waves inside one Verify stage. The trusted planner, never prompt text or a check worker, classifies eligibility.

```ts
type CheckEffectProfileV1 =
  | { kind: "repository_read_only" }
  | { kind: "isolated_ephemeral"; isolationKey: string; cleanupRequired: true }
  | { kind: "serial_required"; reasonCodes: readonly string[] };

interface VerificationCheckDescriptorV1 {
  readonly checkId: string;
  readonly capabilityDigest: Sha256Digest;
  readonly commandPlanDigest: Sha256Digest;
  readonly effectProfile: CheckEffectProfileV1;
  readonly dependencyCheckIds: readonly string[];
  readonly exclusiveResourceKeys: readonly string[];
}

interface VerificationStageExecutionPlanV1 {
  readonly schema: "verification-stage-execution-plan-v1";
  readonly stageRunId: `stage-run:v1:${string}`;
  readonly stage: "targeted" | "affected_area" | "broad";
  readonly qaAuthorityDigest: Sha256Digest;
  readonly generation: number;
  readonly implementationSubjectDigest: Sha256Digest;
  readonly dependencySetDigest: Sha256Digest;
  readonly checkSetDigest: Sha256Digest;
  readonly checks: readonly VerificationCheckDescriptorV1[];
  readonly waves: readonly (readonly string[])[];
  readonly digest: Sha256Digest;
}

type VerificationCheckOutcomeV1 =
  | { kind: "completed"; status: "passed" | "failed"; evidence: readonly SafeEvidenceRefV1[] }
  | { kind: "execution_error"; code: "timeout" | "cancelled" | "crashed" | "invalid_result"; evidence: readonly SafeEvidenceRefV1[] };

interface VerificationCheckResultV1 {
  readonly schema: "verification-check-result-v1";
  readonly stageRunId: string;
  readonly checkId: string;
  readonly planDigest: Sha256Digest;
  readonly capabilityDigest: Sha256Digest;
  readonly generation: number;
  readonly implementationSubjectDigest: Sha256Digest;
  readonly dependencySetDigest: Sha256Digest;
  readonly producerIdentityDigest: Sha256Digest;
  readonly outcome: VerificationCheckOutcomeV1;
  readonly digest: Sha256Digest;
}

interface VerificationStageJoinV1 {
  readonly schema: "verification-stage-join-v1";
  readonly planDigest: Sha256Digest;
  readonly orderedResultDigests: readonly Sha256Digest[];
  readonly evidenceSetDigest: Sha256Digest;
  readonly rawFailureManifestDigest?: Sha256Digest;
  readonly digest: Sha256Digest;
}
```

Parallel eligibility requires all of the following: same stage and immutable subject/dependency bindings; no ordering or evidence dependency; no repository/config/generated/registry/ledger/Git/user-home mutation; either repository-read-only behavior or a unique ephemeral isolation key; no overlapping exclusive resource key; and a validated runner capability. Unknown or incomplete classification produces a singleton serial wave. Cross-stage waves are unrepresentable.

The executor starts waves sequentially and checks within an eligible wave concurrently. It never fail-fasts: every required check must reach a terminal result. Completion order and elapsed time are excluded from semantic joins. The join sorts by the plan's canonical check order and rejects missing, duplicate, extra, stale, cross-stage, cross-subject, or mutated results. While a result is pending, the API returns `kind: "incomplete"` and produces no stage verdict or RegistryIntent.

Check workers never return RegistryIntent values. Only the stage authority may derive one result after the immutable join, which makes serial and parallel intent bytes identical.

### Decision 4 — BROAD causal disposition is a typed projection over the active baseline evaluator

Adopt the active predecessor's `BaselineEvidenceEnvelopeV1`, `BaselineLedgerAuthorityRefV1`, and `evaluateFindingDispositionBaselineV1()` as the six-condition proof gate. Add a BROAD-specific authoritative envelope that supplies the Spec's required durable classification and binds the Review-before-BROAD evidence.

```ts
type BroadBlockingClassificationV1 =
  | "candidate_caused"
  | "new"
  | "worsened"
  | "related"
  | "unproven"
  | "stale"
  | "conflicting"
  | "protected_risk";

type BroadFindingDispositionV1 =
  | {
      kind: "blocking";
      classification: BroadBlockingClassificationV1;
      findingId: FindingId;
      reasonCodes: readonly string[];
      evidenceDigests: readonly Sha256Digest[];
    }
  | {
      kind: "warning";
      classification: "non_candidate_residual";
      findingId: FindingId;
      baselineEvidenceDigest: Sha256Digest;
      admissionDigest: Sha256Digest;
      reviewAttestationDigest: Sha256Digest;
      residualRiskCode: string;
      followUpRef: string;
    };

interface BroadCausalDispositionEnvelopeV1 {
  readonly schema: "broad-causal-disposition-envelope-v1";
  readonly qaRunId: string;
  readonly batchDigest: Sha256Digest;
  readonly generation: number;
  readonly implementationSubjectDigest: Sha256Digest;
  readonly dependencySetDigest: Sha256Digest;
  readonly broadStageJoinDigest: Sha256Digest;
  readonly broadManifestDigest: Sha256Digest;
  readonly reviewResultDigest: Sha256Digest;
  readonly reviewAttestationDigest: Sha256Digest;
  readonly protectedPolicyDigest: Sha256Digest;
  readonly entries: readonly BroadFindingDispositionV1[];
  readonly digest: Sha256Digest;
}
```

Review produces an immutable `CausalDispositionReviewAttestationV1` after scoped Verify and before BROAD. It independently validates current candidate/dependency bindings, candidate diff/affected-area causal analysis, protected policy, prior baseline subject, admission provenance, and the fixed BROAD check plan. It may declare a fingerprint eligible for final evaluation, but cannot create an admission, skip BROAD, or authorize Archive. BROAD candidate observations and the final non-regression comparison are added only after all BROAD checks join.

Classification precedence is deterministic and candidate-first:

1. authoritative protected-risk class or unknown protected classification -> `protected_risk`;
2. contradictory authoritative records -> `conflicting`;
3. expired or invalidated binding -> `stale`;
4. first proven candidate occurrence -> `new`;
5. any worse severity, count, reachability, duration, resource, or risk -> `worsened`;
6. credible or ambiguous candidate causal path -> `candidate_caused`;
7. structural location/dependency/configuration/oracle overlap -> `related`;
8. any missing, partial, self-authorized, single-subject, or otherwise insufficient proof -> `unproven`;
9. only the complete six-condition proof -> `non_candidate_residual` warning.

Every BROAD finding has exactly one entry. If finding identity itself cannot be trusted, the entire envelope is invalid and readiness is blocked. Protected classification uses the structured protected-risk authority and policy digest; free-text/regex inference is never sufficient to permit a warning.

The existing `QualityDispositionEnvelopeV1` remains an additive compatibility summary. It may be projected from the new BROAD envelope, but it cannot by itself authorize current readiness.

### Decision 5 — Adopt, do not duplicate, baseline admission authority

The durable admission source remains `openspec/baseline-health.yaml` through the active predecessor's `BaselineLedgerAuthorityRefV1`. This change adds no ledger writer and does not directly target that file.

A warning is possible only when a read-only resolver proves that the referenced entry:

- already existed before the current `qaRunId` and candidate's first relevant modification;
- binds the normalized fingerprint, normalizer/policy version, immutable baseline subject, environment cohort, evidence digest, approval identity/transaction, admission and expiry times, and invalidation triggers;
- was admitted by a separate explicitly authorized OpenSpec Apply with an exact ledger allowlist and distinct independent QA/approval identity; and
- is unique, active, current, and byte/digest consistent with the official ledger.

Verify, Review, BROAD, Orchestrator, Archive, and the failing run receive no admission-write capability. The current ledger contains no per-finding admission that this Design may invent; therefore absence remains blocking. If the active predecessor's final promoted contract differs, this Design must be reconciled before Tasks rather than creating a competing record.

### Decision 6 — Readiness and Archive eligibility are separate fail-closed decisions

```ts
type QualityReadinessDecisionV1 =
  | { schema: "quality-readiness-decision-v1"; kind: "registry_commit_ready"; phaseStatus: "passed" | "passed_with_warnings"; warningFindingIds: readonly FindingId[]; evidenceDigests: readonly Sha256Digest[]; orderedIntentDigests: readonly Sha256Digest[]; digest: Sha256Digest }
  | { schema: "quality-readiness-decision-v1"; kind: "blocked"; blockingFindingIds: readonly FindingId[]; reasonCodes: readonly string[]; evidenceDigests: readonly Sha256Digest[]; digest: Sha256Digest }
  | { schema: "quality-readiness-decision-v1"; kind: "invalid_evidence"; reasonCodes: readonly string[]; digest: Sha256Digest };

type ArchiveEligibilityDecisionV1 =
  | { schema: "archive-eligibility-decision-v1"; kind: "archive_ready"; readinessDigest: Sha256Digest; registryCommitReceiptDigest: Sha256Digest; warningFindingIds: readonly FindingId[]; digest: Sha256Digest }
  | { schema: "archive-eligibility-decision-v1"; kind: "blocked"; reasonCodes: readonly string[]; digest: Sha256Digest };
```

`registry_commit_ready` requires an authority replay ending at `registry_commit_pending`, current TARGETED/AFFECTED_AREA joins, a current fresh Review, a complete BROAD join, exactly one disposition for every BROAD finding, zero blocking entries, current subject/dependency/policy bindings, and a valid ordered intent chain. `archive_ready` additionally requires the atomic chain commit receipt and the convergence `registry_committed -> complete` transition. Archive never recomputes or weakens causality; it consumes the decision and preserves all warnings.

### Decision 7 — Freshness, invalidation, and replay use the same semantic input

The stage dependency-set digest covers named current authorities: batch; Proposal/Spec/Design/Tasks; implementation subject/tree; allowed targets; dependency graph and affected-area plan; check catalog/command plan; test and oracle definitions; relevant configuration and lockfile; canonical source/generated parity; protected policy; preceding accepted stage evidence; Review attestation where required; and registry base pair.

Any modifying `apply_result_accepted` or `repair_effect_succeeded` event increments generation, clears scoped/Review/BROAD authority, and restarts at `targeted_pending`. Any candidate modification, Review-directed repair, or non-modifying dependency/policy/oracle/configuration drift emits a separate typed invalidation record, clears all current final-QA digests, and restarts the full `TARGETED -> AFFECTED_AREA -> Review -> BROAD` sequence. Prior evidence remains immutable history but cannot be reused for current acceptance.

`QaDecisionRecordV1` captures the complete semantic input digest, an injected evaluation time, action, ordered reason codes, and output digest. Historical replay uses the recorded evaluation time and reproduces bytes. A current readiness check uses a new explicit evaluation time; an expiry may then deterministically change the result to `stale`, which is a new input rather than replay divergence. Scheduler, replay, fixture, and Archive use the same parsers/evaluators.

### Decision 8 — Production runner hooks enforce both sides of delegation

The canonical OpenCode/Pi adapter assets remain thin runner adapters:

1. **Before delegation:** remove caller-supplied QA authority fields; ask the runtime authority for the sole next action; validate role, stage, session/call, change, candidate, generation, dependencies, and runner capability; inject only the immutable invocation reference; reject wrong/out-of-order roles.
2. **During a Verify stage:** execute the trusted stage plan through an injected check-executor port. Capability handles are resolved at the boundary; the public contract never accepts arbitrary shell text. Unsupported or uncertain isolation runs serially.
3. **After delegation:** correlate by session/call/invocation digest; parse the result as untrusted input; validate the immutable join/Review result and consume it through the same authority; malformed prose or missing structured metadata is not interpreted into success.
4. **Session/process loss:** a pending invocation without a matching post-result is invalid. On restart, only complete authority-bound records may be replayed; otherwise restart at TARGETED. No hidden cache authorizes progression.

OpenCode uses its supported `tool.execute.before` and `tool.execute.after` hooks. Pi uses the equivalent `tool_call` and post-result hook. An adapter that cannot prove both sides remains observe/serial and cannot become an active scheduling authority.

## End-to-end data flow

```mermaid
sequenceDiagram
  participant O as Central Orchestrator
  participant H as Runner hook
  participant Q as QaExecutionAuthorityV1
  participant V as Independent Verify
  participant R as Independent Review
  participant E as Baseline evaluator
  participant G as Registry coordinator
  participant A as Archive

  O->>H: Request next QA delegation for current change
  H->>Q: Current authority snapshot
  Q-->>H: TARGETED Verify invocation
  H->>V: Immutable stage plan; eligible checks run in-stage
  V-->>H: Complete check-result set
  H->>Q: Canonical join and result
  Q-->>H: AFFECTED_AREA Verify invocation
  H->>V: Immutable affected-area plan
  V-->>Q: Complete joined result
  Q-->>H: Fresh Review invocation
  H->>R: Scoped joins + candidate/dependencies + admission candidates
  R-->>Q: Independent result + causal attestation
  Q-->>H: BROAD Verify invocation
  H->>V: Mandatory BROAD plan; all checks execute and join
  V-->>Q: Raw BROAD results + FailureManifestV1
  Q->>E: Two-subject evidence + Review attestation + protected policy
  E-->>Q: Broad causal dispositions + compatibility quality summary
  Q->>Q: Readiness; zero blockers; current bindings
  Q->>G: Atomic ordered intent chain
  G-->>Q: Commit/replay receipt or conflict/recovery stop
  Q-->>A: ArchiveEligibilityDecisionV1
```

No Review and Verify stage overlap. BROAD remains `role: "verify", stage: "broad"`; this Design does not create a new Developer Team role or OpenSpec phase.

## Registry and persistence

- Stage workers and specialist roles return immutable results/intents only. They never write `state.yaml` or `events.yaml` in centralized mode.
- Intermediate execution substates are represented by convergence records and phase artifacts, not new registry phases.
- After all current evidence accepts, the authority materializes the canonical OpenSpec intent order: existing Apply completion, final `verify.passed|passed_with_warnings` whose Verify artifact includes scoped+BROAD evidence, then `review.passed|passed_with_warnings`. Execution order remains Review-before-BROAD; registry order remains the existing OpenSpec phase order.
- Add `commitIntentChainV1()` to validate every intent, artifact, evidence binding, simulated predecessor base, and idempotency key in memory, then write one pair transaction. Existing `commit()` and `commitAll()` remain legacy compatibility APIs and are not used by active QA acceptance.
- A base conflict, third digest, incomplete artifact, or recovery-required result returns a blocker; no prefix is committed or reinterpreted.
- Historical old-order dossiers and events remain unchanged. Dual-read is permitted; dual-write and backfill are prohibited.

## Compatibility and migration

1. **Add before restrict:** land parsers, joins, causal/readiness decisions, replay, and adapter conformance while active behavior remains serial and fail-closed.
2. **Legacy scheduler:** retain exported names. Legacy/observe/shadow behavior remains readable and comparison-only. Active mode without convergence authority fails closed; it cannot schedule BROAD-before-Review or emit commit-ready intents.
3. **Staged verification:** retain existing V1 stage/status vocabulary. Add scoped/broad acceptance projections; do not insert Review into `StagedVerificationStateV1`.
4. **Baseline compatibility:** retain `BaselineEvidenceEnvelopeV1` and `QualityDispositionEnvelopeV1`. The new BROAD envelope is authoritative for current 1A readiness and projects the old quality summary for consumers.
5. **Fixture:** update `developer-team-convergence-fixture.ts` to TARGETED -> AFFECTED_AREA -> Review -> BROAD while retaining repair, freshness, registry, and adapter coverage.
6. **Historical records:** old-order records parse only as historical compatibility evidence. Resuming a current run requires a fresh authority snapshot and complete new-order sequence; no record is rewritten.
7. **One-version rule:** no long-lived V2 fork. Add nested discriminants and optional compatibility fields to V1 surfaces, then require the convergence variant only at the active boundary.

## In-stage concurrency policy and measurement

The representative CP-04 fixture uses three read-only fake checks with injected logical durations of 30, 20, and 10 units. A controlled executor/barrier records starts and completions without wall-clock sleeps. The serial control has a 60-unit critical path; one eligible parallel wave has a 30-unit critical path. Both runs must have the same plan digest, ordered result/evidence digests, stage/phase verdict, identity result, and RegistryIntent bytes. A real elapsed-duration field may be telemetry, but acceptance depends on the deterministic trace, not host timing.

Production telemetry is allowlisted and records only hashed run/stage IDs, stage kind, strategy, wave/check counts, outcome codes, warning/blocker counts, invalidation/retry counts, and durations. It records no raw prompts, commands, outputs, paths, findings, or secrets.

## Verification strategy

Strict TDD applies to later authorized implementation. No check below is claimed by this Design phase.

| Layer | Required evidence |
|---|---|
| Contract mutation | Reject unknown discriminants, extra/missing keys, bad digests, cross-run/stage/generation/subject/dependency records, duplicate/missing results, mutated evidence, and unsafe text fields. |
| Convergence/order | Exhaustive legal transition matrix; BROAD before Review rejected; caller-selected role rejected; modification/invalidation clears all current QA evidence and restarts TARGETED. |
| 1A causality | Every required classification; complete six-condition warning; each single missing condition; candidate-first ambiguity; structured protected classes; stale/conflicting/self-authorized/single-subject refusal; all-green and mixed warning+blocker cases. |
| Readiness/Archive | Incomplete order, stale binding, unresolved blocker, missing disposition, registry conflict/recovery, and missing commit receipt block; warnings survive with identity/evidence/residual-risk/follow-up. |
| 2A join | Serial/parallel permutation equivalence; pending result produces no verdict; no fail-fast; isolation/resource conflicts force serial; no check-level intent; deterministic 60-versus-30 critical path. |
| Registry | Full-chain base simulation, one atomic pair transaction, replay, no prefix on failure, stale base, artifact mismatch, crash/recovery, and unchanged legacy single-intent behavior. |
| Runner adapters | OpenCode before/after and Pi pre/post-result correlation; injected caller authority stripped; wrong role/stage blocked; missing post-result blocked; unsupported capability remains serial/observe; identical normalized results. |
| Integration | Maintained fixture crosses TARGETED -> AFFECTED_AREA -> Review -> BROAD -> atomic registry commit for OpenCode and Pi; warning and blocking variants; restart/replay and invalidation variants. |
| Prompt/EII parity | Every legacy/compact system, agent, and skill surface has the authoritative order, in-stage-only concurrency, fail-closed readiness, no Verify+Review parallelism, and no BROAD skipping. |
| Generated discipline | Run `scripts/generate-runner-execution-assets.ts` from canonical TypeScript sources; second generation byte-identical; installed temporary OpenCode/Pi assets match generated bytes; no hand edits. |
| Final gates | Focused tests, affected packages/typecheck, fresh independent Review, then mandatory BROAD on one frozen candidate. Any modification restarts the sequence. |

## Rollout and rollback

### Rollout

1. Settle the three active ownership dependencies and re-inspect their final source/contracts before any Task allowlist is approved.
2. Add runtime contracts and replay with `qaAuthority=observe`, `verifyCheckConcurrency=serial`, and `causalBroadDisposition=block_all`.
3. Activate the convergence authority in serial mode only after both runner adapters prove pre/post-result reachability. Prompt surfaces may advertise runtime enforcement only after this gate.
4. Enable `causalBroadDisposition=evidence_backed` only after baseline resolver/evaluator, protected-floor, anti-laundering, scheduler, replay, and Archive fixtures agree byte-for-byte. No valid admission means nonzero BROAD remains blocking.
5. Enable in-stage parallel waves last, by deterministic cohort, after serial/parallel equivalence, critical-path, isolation, and zero-check-loss gates pass. Full-SDD and protected floors remain unchanged.

The two additive configuration controls are `verifyCheckConcurrency: "serial" | "parallel"` (default `serial`) and `causalBroadDisposition: "block_all" | "evidence_backed"` (default `block_all` until activation). Existing execution-contract/decision-kernel rollout controls gate the authority itself. User/project configuration may select a stricter mode but may not enable a weaker mode ahead of release policy.

### Rollback

1. Set `verifyCheckConcurrency=serial`; retain every check and the authoritative stage order.
2. If causality is implicated, set `causalBroadDisposition=block_all`; every nonzero BROAD result blocks while evidence is repaired and independently revalidated.
3. If an adapter or authority defect exists, stop active QA progression or return it to observe; do **not** restore BROAD-before-Review as an acceptance path.
4. Preserve all findings, warning dispositions, joins, transition/invalidation receipts, intents, state/events history, and artifacts. Rollback never deletes evidence, rewrites history, edits generated files directly, weakens permanent floors, touches `runner-capability-standardization`, or uses destructive Git without the permanent informed-confirmation flow.

## Active-change overlap and ownership gates

| Active change | Owned/overlapping boundary | Required coordination |
|---|---|---|
| `developer-team-execution-convergence` (`apply/passed_with_warnings`) | convergence, staged verification, control plane, host bridge, rollout/telemetry, exports, adapters, registry coordinator, prompt runtime mapping | Consume its final authoritative result. Shared-path Apply is blocked until Archive/ownership transfer or an explicit coordinator path-level handoff with fresh subject/dependency digests. |
| `project-init-skill-registry-and-session-baseline` (`apply/completed`, independent QA pending) | baseline contracts/evaluator, control-plane sidecar, readiness fragment, Verify/Review/Archive content, adapter hooks/tests | Reuse its final contracts and exact canonical fragment; do not duplicate or supersede its ledger/evaluator. Any incompatible final change requires Design reconciliation. |
| `streamline-orchestrator-ownership-and-acceptance` (`verify/in_progress`) | Orchestrator invariant/content and prompt/materialization tests; it explicitly left scheduler reconciliation to this follow-up | Preserve its pre-QA/ownership/commit-only decisions. Prompt-path Apply waits for its current final QA/ownership release. |
| `runner-capability-standardization` | explicitly excluded | No read-derived modification authority, no target, and no overlap resolution through this change. |

The current worktree contains uncommitted changes from these owners, including canonical adapter assets, generated adapter JavaScript, control-plane files, and role content. They are preserved in place; this Design neither discards nor edits them. Before Tasks, the coordinator must freeze predecessor artifact/source digests and re-run overlap detection because current interfaces may settle after this Design.

## Exact editable targets and estimate

This is the complete prospective implementation impact map, not Apply authority. Any additional path is an ambiguity stop requiring Design reconciliation.

### Runtime contracts, decisions, execution, and tests (33)

1. `packages/sdd-runtime/src/contracts/qa-authority.ts` (new)
2. `packages/sdd-runtime/src/contracts/qa-authority.test.ts` (new)
3. `packages/sdd-runtime/src/contracts/verification-stage-execution.ts` (new)
4. `packages/sdd-runtime/src/contracts/verification-stage-execution.test.ts` (new)
5. `packages/sdd-runtime/src/contracts/broad-causal-disposition.ts` (new)
6. `packages/sdd-runtime/src/contracts/broad-causal-disposition.test.ts` (new)
7. `packages/sdd-runtime/src/contracts/execution-convergence.ts`
8. `packages/sdd-runtime/src/contracts/execution-convergence.test.ts`
9. `packages/sdd-runtime/src/contracts/batch-b-replacement.test.ts`
10. `packages/sdd-runtime/src/orchestrator/verification-stage-execution.ts` (new)
11. `packages/sdd-runtime/src/orchestrator/verification-stage-execution.test.ts` (new)
12. `packages/sdd-runtime/src/orchestrator/broad-causal-disposition.ts` (new)
13. `packages/sdd-runtime/src/orchestrator/broad-causal-disposition.test.ts` (new)
14. `packages/sdd-runtime/src/orchestrator/quality-readiness.ts` (new)
15. `packages/sdd-runtime/src/orchestrator/quality-readiness.test.ts` (new)
16. `packages/sdd-runtime/src/orchestrator/staged-verification.ts`
17. `packages/sdd-runtime/src/orchestrator/staged-verification.test.ts`
18. `packages/sdd-runtime/src/execution/qa-execution-authority.ts` (new)
19. `packages/sdd-runtime/src/execution/qa-execution-authority.test.ts` (new)
20. `packages/sdd-runtime/src/execution/execution-control-plane.ts`
21. `packages/sdd-runtime/src/execution/execution-control-plane.test.ts`
22. `packages/sdd-runtime/src/execution/execution-role-scheduler.test.ts`
23. `packages/sdd-runtime/src/execution/developer-team-runner-host-bridge.ts`
24. `packages/sdd-runtime/src/execution/developer-team-host-reachability.test.ts`
25. `packages/sdd-runtime/src/execution/rollout-policy.ts`
26. `packages/sdd-runtime/src/execution/rollout-policy.test.ts`
27. `packages/sdd-runtime/src/execution/telemetry.ts`
28. `packages/sdd-runtime/src/execution/telemetry.test.ts`
29. `packages/sdd-runtime/src/execution/developer-team-convergence.e2e.test.ts`
30. `packages/sdd-runtime/src/execution/batch-c-authoritative-matrix.test.ts`
31. `packages/sdd-runtime/src/testing/developer-team-convergence-fixture.ts`
32. `packages/sdd-runtime/src/index.ts`
33. `packages/sdd-runtime/src/index.test.ts`

### Atomic registry chain (6)

34. `packages/sdd-runtime/src/artifact-state/registry-coordinator.ts`
35. `packages/sdd-runtime/src/artifact-state/registry-coordinator.test.ts`
36. `packages/sdd-runtime/src/artifact-state/registry-transaction.ts`
37. `packages/sdd-runtime/src/artifact-state/registry-pair-store.ts`
38. `packages/sdd-runtime/src/artifact-state/filesystem-registry-store.ts`
39. `packages/sdd-runtime/src/execution/execution-registry-coordinator-port.test.ts`

### Core configuration, canonical prompts/system instructions, and tests (20)

40. `packages/core/src/config/deck-config.ts`
41. `packages/core/src/config/deck-config.test.ts`
42. `packages/core/src/teams/developer/readiness-authority.ts`
43. `packages/core/src/teams/developer/readiness-authority.test.ts`
44. `packages/core/src/teams/developer/orchestrator-invariants.ts`
45. `packages/core/src/teams/developer/orchestrator-invariants.test.ts`
46. `packages/core/src/teams/developer/orchestrator-invariants.task2.test.ts`
47. `packages/core/src/teams/developer/orchestrator-content.ts`
48. `packages/core/src/teams/developer/orchestrator-content.test.ts`
49. `packages/core/src/teams/developer/content-registry.ts`
50. `packages/core/src/teams/developer/content-registry.test.ts`
51. `packages/core/src/teams/developer/prompt-profile.test.ts`
52. `packages/core/src/teams/developer/verify-content.ts`
53. `packages/core/src/teams/developer/verify-content.test.ts`
54. `packages/core/src/teams/developer/review-content.ts`
55. `packages/core/src/teams/developer/review-content.test.ts`
56. `packages/core/src/teams/developer/archive-content.ts`
57. `packages/core/src/teams/developer/archive-content.test.ts`
58. `packages/core/src/teams/developer/manifest.test.ts`
59. `packages/core/src/teams/developer/user-phase-communication.test.ts`

### Runner adapter canonical sources and acceptance tests (10)

60. `packages/adapter-opencode/assets/opencode/plugins/developer-team-execution.ts`
61. `packages/adapter-opencode/src/developer-team-execution-reachability.test.ts`
62. `packages/adapter-opencode/src/developer-team-execution-bridge.test.ts`
63. `packages/adapter-opencode/src/developer-team-install.test.ts`
64. `packages/adapter-opencode/src/prompt-generation.test.ts`
65. `packages/adapter-pi/assets/pi/extensions/developer-team-execution.ts`
66. `packages/adapter-pi/src/developer-team-execution-reachability.test.ts`
67. `packages/adapter-pi/src/developer-team-execution-bridge.test.ts`
68. `packages/adapter-pi/src/pi-team-profile.test.ts`
69. `packages/adapter-pi/src/registry-consumption.test.ts`

### Operations documentation (1)

70. `docs/developer-team-execution.md`

**Estimate:** 70 exact editable targets: 14 new and 56 modified; approximately **4,500–6,500 touched lines**, including **2,400–3,400 test lines**. The high count is driven by two-runner reachability, immutable contract/adversarial matrices, atomic registry-chain safety, and legacy/compact prompt parity.

### Generated and materialized outputs — not editable targets

- `packages/adapter-opencode/assets/opencode/plugins/developer-team-execution.generated.js`
- `packages/adapter-pi/assets/pi/extensions/developer-team-execution.generated.js`

These are regenerated only by `scripts/generate-runner-execution-assets.ts` after canonical TypeScript changes and verified by a second byte-identical generation. Installed OpenCode/Pi files and user-home outputs are test/materialization evidence only. `packages/core/src/skills/external/content.generated.ts` and `apps/cli/src/runtime/build-info.generated.ts` are unaffected and must remain untouched.

## Exact Implementation Instructions

All instructions below use **semantic-constrained** mode. Byte-verbatim text is not required because wording is profile/composition dependent; the active predecessor's existing byte-verbatim `FINDING_DISPOSITION_AUTHORITY_BOUNDARY_V1` must remain unchanged and composed exactly as its owner requires.

### EII-CBQG-001 — Canonical QA execution authority boundary

- **Editable source target:** `packages/core/src/teams/developer/readiness-authority.ts`, new canonical symbol `QA_EXECUTION_AUTHORITY_BOUNDARY_V1`.
- **Mode:** `semantic-constrained`.
- **Required change:** State that convergence runtime is the sole next-stage authority; enforce TARGETED -> AFFECTED_AREA -> Review -> BROAD; allow concurrency only among authority-declared checks within one Verify stage; require complete immutable join before verdict; prohibit cross-stage and Verify+Review overlap; require current candidate/dependencies, mandatory BROAD, protected floors, fail-closed readiness, and centralized intents.
- **Preserved constraints:** both existing authority constants and their exact bytes, Git safety, role independence, language policy, no prompt-granted authority, and generated-source discipline.
- **Affected tests/assertions:** `readiness-authority.test.ts`, all Orchestrator/Verify/Review/Archive content tests, content registry/profile, and both adapter materialization suites.
- **Prohibited reinterpretations:** no caller-selected stage, prompt-only authority, check omission, BROAD-before-Review, final Verify+Review parallelism, or warning-by-label.
- **Ambiguity stop:** if the new clauses conflict with the settled predecessor fragment or runtime contract, stop for Design reconciliation; do not duplicate or weaken either authority.

### EII-CBQG-002 — `INV-005` bounded parallelism invariant

- **Editable source target:** `packages/core/src/teams/developer/orchestrator-invariants.ts`, `INV_005_REGISTRY_DEFERRED_PARALLELISM` (rename allowed while retaining ID `INV-005`).
- **Mode:** `semantic-constrained`.
- **Required change:** Remove `Verify+Review` as a parallel phase example; retain registry-deferred Spec+Design behavior; permit only runtime-authorized in-stage Verify check waves; require one joined stage verdict and coordinator-only registry commit.
- **Preserved constraints:** invariant ID, critical tier, surfaces/order, centralized registry protection, and all unrelated invariants.
- **Affected tests/assertions:** both invariant tests, Orchestrator content, manifest, content-registry/profile, and materialization tests.
- **Prohibited reinterpretations:** no parallel final judgments, no specialist registry write, and no cross-stage wave.
- **Ambiguity stop:** a surface that still requires Verify+Review parallelism blocks generation.

### EII-CBQG-003 — Compact `INV-005` summary

- **Editable source target:** `packages/core/src/teams/developer/orchestrator-invariants.ts`, `COMPACT_ORCHESTRATOR_INVARIANT_SUMMARIES_V1` entry `INV-005`.
- **Mode:** `semantic-constrained`.
- **Required change:** Concisely retain Spec+Design registry deferral and in-stage-only joined check concurrency, with explicit no Verify+Review overlap.
- **Preserved constraints:** invariant count/order/immutability and unrelated summaries.
- **Affected tests/assertions:** invariant, profile, registry, and adapter parity tests.
- **Prohibited reinterpretations:** compactness cannot omit join, stage boundary, or single-writer semantics.
- **Ambiguity stop:** stop rather than emit a generic “parallelize safe work” instruction.

### EII-CBQG-004 — Legacy Orchestrator system prompt

- **Editable source target:** `packages/core/src/teams/developer/orchestrator-content.ts`, `ORCHESTRATOR_SYSTEM_PROMPT`.
- **Mode:** `semantic-constrained`.
- **Required change:** Compose EII-CBQG-001 once; obtain the next QA action from runtime; schedule only its role/stage; wait for complete joins; consume typed results; order Review before BROAD; defer commit-ready intents until all gates accept; stop on invalid/stale/missing authority.
- **Preserved constraints:** settled ownership/pre-QA/decision/commit-only fragments, Interactive/Automatic behavior, user-language communication, Git safety, and no direct specialist work.
- **Affected tests/assertions:** Orchestrator content, profile/registry/manifest/user-communication, and OpenCode/Pi prompt parity.
- **Prohibited reinterpretations:** no prompt-selected stage, BROAD omission, warning self-admission, or Verify+Review parallel launch.
- **Ambiguity stop:** any lower-priority contradictory order or parallel instruction must be removed or implementation stops.

### EII-CBQG-005 — Legacy Orchestrator agent body

- **Editable source target:** `packages/core/src/teams/developer/orchestrator-content.ts`, `ORCHESTRATOR_AGENT_BODY`.
- **Mode:** `semantic-constrained`.
- **Required change:** Define the role as coordinator of authority-selected QA actions and immutable result joins; preserve distinct Verify/Review judgments and central intent reconciliation.
- **Preserved constraints:** role skill loading, bounded discovery, target authority, pre-QA candidate loop, and Git safety.
- **Affected tests/assertions:** Orchestrator six-surface and adapter materialization parity.
- **Prohibited reinterpretations:** no agent-authored verdict, stage override, or shared role identity.
- **Ambiguity stop:** missing runtime authority yields a blocker, not legacy active scheduling.

### EII-CBQG-006 — Legacy Orchestrator skill body

- **Editable source target:** `packages/core/src/teams/developer/orchestrator-content.ts`, `ORCHESTRATOR_SKILL_BODY`.
- **Mode:** `semantic-constrained`.
- **Required change:** Specify authority snapshot validation, ordered scheduling, join consumption, causal/readiness decision consumption, atomic intent chain, invalidation restart, and warning preservation.
- **Preserved constraints:** existing phase workflow, recovery, language, registry, authorization, and Git suggestions.
- **Affected tests/assertions:** Orchestrator/content-registry/profile/materialization tests.
- **Prohibited reinterpretations:** no new OpenSpec phase or BROAD role; BROAD remains a Verify stage.
- **Ambiguity stop:** absent structured result or current dependency binding stops progression.

### EII-CBQG-007 — Compact Orchestrator system prompt

- **Editable source target:** `packages/core/src/teams/developer/orchestrator-content.ts`, `ORCHESTRATOR_SYSTEM_PROMPT_COMPACT`.
- **Mode:** `semantic-constrained`.
- **Required change:** Encode EII-CBQG-004 without losing runtime authority, exact order, joined checks, invalidation, protected floors, or central intent clauses.
- **Preserved constraints:** all current compact ownership/authorization/language/Git hard stops.
- **Affected tests/assertions:** compact profile digest/markers and OpenCode/Pi materialization.
- **Prohibited reinterpretations:** size pressure cannot collapse Review and BROAD or omit fail-closed behavior.
- **Ambiguity stop:** compact generation fails rather than dropping a clause.

### EII-CBQG-008 — Compact Orchestrator agent body

- **Editable source target:** `packages/core/src/teams/developer/orchestrator-content.ts`, `ORCHESTRATOR_COMPACT_AGENT_BODY`.
- **Mode:** `semantic-constrained`.
- **Required change:** Coordinate only runtime-selected next actions; accept only joined typed evidence; preserve separate role identities and ordered intents.
- **Preserved constraints:** ownership, matching skill, no scope expansion, and Git safety.
- **Affected tests/assertions:** profile, registry, and adapter parity.
- **Prohibited reinterpretations:** no direct stage/verdict invention or final role parallelism.
- **Ambiguity stop:** unbound result is rejected.

### EII-CBQG-009 — Compact Orchestrator skill body

- **Editable source target:** `packages/core/src/teams/developer/orchestrator-content.ts`, `ORCHESTRATOR_COMPACT_SKILL_BODY`.
- **Mode:** `semantic-constrained`.
- **Required change:** Cover next-action authority, in-stage join, Review-before-BROAD, invalidation restart, readiness, and atomic registry reconciliation.
- **Preserved constraints:** current compact workflow and hard stops.
- **Affected tests/assertions:** Orchestrator/profile/materialization tests.
- **Prohibited reinterpretations:** no omission/defer shortcut or warning-based stage bypass.
- **Ambiguity stop:** stop on stale convergence or registry base.

### EII-CBQG-010 — Runtime-control map

- **Editable source target:** `packages/core/src/teams/developer/content-registry.ts`, `PROMPT_RUNTIME_CONTROL_MAP_V1`.
- **Mode:** `semantic-constrained`.
- **Required change:** Register/update mappings for convergence QA sequencing, immutable stage joins, BROAD causal disposition, and readiness/Archive eligibility; mark them runtime-active only when their actual production/export and adapter conformance tests pass.
- **Preserved constraints:** existing mapping order semantics, real function resolution, compact/legacy profiles, and retained Git-safety defense in depth.
- **Affected tests/assertions:** content-registry, prompt-profile runtime function map, export matrices, and adapters.
- **Prohibited reinterpretations:** no `runtimeActive: true` for a prompt-only or test-only control.
- **Ambiguity stop:** missing production-reachable function keeps the mapping inactive and blocks prompt condensation.

### EII-CBQG-011 — Compact runtime team contract

- **Editable source target:** `packages/core/src/teams/developer/content-registry.ts`, `DEVELOPER_TEAM_COMPACT_RUNTIME_CONTRACT`.
- **Mode:** `semantic-constrained`.
- **Required change:** State that runtime controls final QA order and joins; only checks within one Verify stage may run concurrently; Review and Verify judgments remain sequential/independent; mandatory BROAD and protected floors remain non-waivable.
- **Preserved constraints:** all current authority, target, Git, skill-loading, return, language, and registry clauses.
- **Affected tests/assertions:** profile/content registry and every composed compact role.
- **Prohibited reinterpretations:** no blanket parallelism or prompt override.
- **Ambiguity stop:** contradictory role content blocks composition.

### EII-CBQG-012 — Verify legacy agent body

- **Editable source target:** `packages/core/src/teams/developer/verify-content.ts`, `VERIFY_AGENT_BODY`.
- **Mode:** `semantic-constrained`.
- **Required change:** Accept only an authority-bound stage plan; execute every check; use only declared parallel waves; return immutable per-check results and one joined stage result; BROAD requires current Review authority; preserve raw failures and produce no check-level intents.
- **Preserved constraints:** compliance-only role, no fixes, `FailureManifestV1`, protected floors, centralized intents, and generated discipline.
- **Affected tests/assertions:** Verify content, readiness fragment count, scheduler/result contracts, and profile parity.
- **Prohibited reinterpretations:** no self-selected checks/stage, fail-fast check loss, Review work, ledger write, or Archive decision.
- **Ambiguity stop:** missing/extra/stale check evidence returns failure/invalid evidence.

### EII-CBQG-013 — Verify legacy skill body

- **Editable source target:** `packages/core/src/teams/developer/verify-content.ts`, `VERIFY_SKILL_BODY`.
- **Mode:** `semantic-constrained`.
- **Required change:** Define plan validation, wave execution, canonical join, stage-specific verdict, raw BROAD manifest, evaluator request, typed return, and invalidation behavior.
- **Preserved constraints:** TDD/lane floors, report structure, role independence, no implementation, and registry-deferred behavior.
- **Affected tests/assertions:** full Verify semantic/negative matrix and runtime fixtures.
- **Prohibited reinterpretations:** no classification from prose/age/fingerprint, no BROAD skip, and no cross-stage parallelism.
- **Ambiguity stop:** any incomplete join produces no pass/intents.

### EII-CBQG-014 — Verify compact agent body

- **Editable source target:** `packages/core/src/teams/developer/verify-content.ts`, `VERIFY_COMPACT_AGENT_BODY`.
- **Mode:** `semantic-constrained`.
- **Required change:** Compactly preserve authority-bound stage, all-check execution, eligible in-stage waves, join-before-verdict, raw evidence, and no fixes.
- **Preserved constraints:** current compact identity/return and authority fragment composition.
- **Affected tests/assertions:** Verify compact parity/profile tests.
- **Prohibited reinterpretations:** no generic “parallelize tests” or partial pass.
- **Ambiguity stop:** unknown eligibility runs serially.

### EII-CBQG-015 — Verify compact skill body

- **Editable source target:** `packages/core/src/teams/developer/verify-content.ts`, `VERIFY_COMPACT_SKILL_BODY`.
- **Mode:** `semantic-constrained`.
- **Required change:** Encode complete plan -> waves -> join -> manifest/disposition -> typed result flow and Review-before-BROAD guard.
- **Preserved constraints:** mandatory BROAD, warning proof, central intents, and no repair.
- **Affected tests/assertions:** Verify content/profile/materialization tests.
- **Prohibited reinterpretations:** no final Verify+Review overlap or evaluator duplication.
- **Ambiguity stop:** missing Review receipt blocks BROAD.

### EII-CBQG-016 — Review legacy agent body

- **Editable source target:** `packages/core/src/teams/developer/review-content.ts`, `REVIEW_AGENT_BODY`.
- **Mode:** `semantic-constrained`.
- **Required change:** Run only at `review_pending` after current scoped joins; remain non-concurrent and identity-distinct from Verify; independently produce causal/protected/admission attestation for the fixed BROAD plan; return no final BROAD or Archive verdict.
- **Preserved constraints:** engineering-quality judgment, no fixes, four-way scope classification, fresh identity, and central intents.
- **Affected tests/assertions:** Review content, freshness, scheduler, causality, and profile tests.
- **Prohibited reinterpretations:** no inherited Verify conclusion, admission write, BROAD execution, or final warning authorization.
- **Ambiguity stop:** incomplete/stale scoped evidence is blocking.

### EII-CBQG-017 — Review legacy skill body

- **Editable source target:** `packages/core/src/teams/developer/review-content.ts`, `REVIEW_SKILL_BODY`.
- **Mode:** `semantic-constrained`.
- **Required change:** Validate subject/dependencies, scoped joins, causal paths, protected policy, prior admission provenance, non-regression inputs, and planned BROAD checks; emit immutable attestation and independent result.
- **Preserved constraints:** current report/return, rollback assessment, no Apply, and registry-deferred semantics.
- **Affected tests/assertions:** Review semantic/negative and runtime attestation tests.
- **Prohibited reinterpretations:** matching fingerprint never compels approval; Review cannot pre-accept unseen BROAD output.
- **Ambiguity stop:** conflicting admission/evidence fails Review.

### EII-CBQG-018 — Review compact agent body

- **Editable source target:** `packages/core/src/teams/developer/review-content.ts`, `REVIEW_COMPACT_AGENT_BODY`.
- **Mode:** `semantic-constrained`.
- **Required change:** Preserve fresh sequential Review and independent causal/protected attestation before BROAD.
- **Preserved constraints:** compact identity, no fixes, blocker precedence.
- **Affected tests/assertions:** compact Review/profile parity.
- **Prohibited reinterpretations:** no concurrent or copied judgment.
- **Ambiguity stop:** missing current joins blocks.

### EII-CBQG-019 — Review compact skill body

- **Editable source target:** `packages/core/src/teams/developer/review-content.ts`, `REVIEW_COMPACT_SKILL_BODY`.
- **Mode:** `semantic-constrained`.
- **Required change:** Encode current scoped evidence -> independent attestation -> result, followed by BROAD only if stable.
- **Preserved constraints:** four-way classification, warning durability, no ledger authority.
- **Affected tests/assertions:** Review content/profile/materialization.
- **Prohibited reinterpretations:** no final Archive readiness claim.
- **Ambiguity stop:** protected-policy uncertainty blocks.

### EII-CBQG-020 — Archive legacy agent body

- **Editable source target:** `packages/core/src/teams/developer/archive-content.ts`, `ARCHIVE_AGENT_BODY`.
- **Mode:** `semantic-constrained`.
- **Required change:** Require `ArchiveEligibilityDecisionV1` plus atomic registry commit receipt; preserve each warning's identity/classification/evidence/residual risk/follow-up; refuse on any blocker, stale/incomplete order, invalid decision, or missing receipt.
- **Preserved constraints:** append-only history, canonical `archived` status, cleanup blocking, no ledger write, and Git safety.
- **Affected tests/assertions:** Archive content, readiness service, registry chain, and profile tests.
- **Prohibited reinterpretations:** no causality recomputation, global-green claim, warning deletion, or prompt override.
- **Ambiguity stop:** any mismatch between decision and artifacts blocks before move/intent.

### EII-CBQG-021 — Archive legacy skill body

- **Editable source target:** `packages/core/src/teams/developer/archive-content.ts`, `ARCHIVE_SKILL_BODY`.
- **Mode:** `semantic-constrained`.
- **Required change:** Add decision/receipt validation before traceability/move; carry warning evidence into report and final return; preserve failed attempts and rollback history.
- **Preserved constraints:** existing artifact checks, move-not-copy semantics, canonical registry transition, and no destructive Git.
- **Affected tests/assertions:** Archive full workflow and readiness/refusal matrix.
- **Prohibited reinterpretations:** `passed_with_warnings` without `archive_ready` is insufficient.
- **Ambiguity stop:** missing authoritative decision stops Archive.

### EII-CBQG-022 — Archive compact agent body

- **Editable source target:** `packages/core/src/teams/developer/archive-content.ts`, `ARCHIVE_COMPACT_AGENT_BODY`.
- **Mode:** `semantic-constrained`.
- **Required change:** Compactly require archive-ready decision/current commit and durable warning preservation.
- **Preserved constraints:** no evidence erasure, append-only history, cleanup blocker.
- **Affected tests/assertions:** compact Archive/profile parity.
- **Prohibited reinterpretations:** no status-only Archive gate.
- **Ambiguity stop:** stale/missing decision blocks.

### EII-CBQG-023 — Archive compact skill body

- **Editable source target:** `packages/core/src/teams/developer/archive-content.ts`, `ARCHIVE_COMPACT_SKILL_BODY`.
- **Mode:** `semantic-constrained`.
- **Required change:** Encode current complete order, archive-ready decision, commit receipt, warning preservation, and refusal semantics.
- **Preserved constraints:** canonical archive workflow and centralized registry ownership.
- **Affected tests/assertions:** Archive content/profile/materialization tests.
- **Prohibited reinterpretations:** no ledger repair, BROAD skip, or blocker downgrade.
- **Ambiguity stop:** contradictory evidence refuses Archive.

## Decisions, alternatives, and tradeoffs

| Decision | Chosen | Rejected | Tradeoff |
|---|---|---|---|
| Sequencing owner | Existing convergence state machine through one QA facade | Staged-verification `nextStage`, prompts, or a new competing state machine | Requires adapter/control-plane wiring, but removes split authority. |
| In-stage execution | Deterministic eligibility waves + immutable join | Cross-stage or Verify+Review concurrency; raw `Promise.all` over commands | Smaller speedup, materially lower safety risk. |
| Causality | New BROAD classification projection over active baseline proof gate | Duplicate ledger/evaluator or warning by fingerprint/age | Depends on predecessor settlement; preserves one admission authority. |
| Protected floors | Structured policy authority first | Free-text/regex as permitting evidence | More explicit inputs; unknown classifications conservatively block. |
| Readiness | Typed commit-ready and archive-ready decisions | Prompt/report status checks | Additional contracts, but scheduler/replay/Archive share one result. |
| Registry | One atomic intent chain | Sequential `commitAll()` | Requires transaction extension; prevents visible committed prefixes. |
| Compatibility | Additive nested discriminants and fail-closed active adapter | Breaking removal or permanent V2 fork | Legacy consumers remain readable; unsafe active calls intentionally stop. |
| Timing proof | Injected logical clock/barrier | Wall-clock sleep benchmark | Proves critical path deterministically, while real time remains telemetry. |

## Risks and mitigations

| Risk | Level | Mitigation |
|---|---|---|
| Candidate regression is laundered as baseline debt | High | Structured protected precedence, candidate-first classification, prior admission, two subjects, independent Review attestation, final BROAD observation, fail-closed readiness. |
| Runner cannot reliably consume subagent results | High | Require pre/post-hook conformance; unsupported adapter remains observe/serial and cannot activate. |
| Parallel checks share hidden state | High | Trusted effect profiles, isolation/resource keys, singleton fallback, no fail-fast, mutation sentinels, serial equivalence. |
| Active changes settle incompatible contracts | High | Path ownership gates, final digest freeze, source re-inspection, explicit Design reconciliation rather than duplicate implementation. |
| Multi-intent commit exposes partial lifecycle | High | In-memory chain validation plus one pair transaction and recovery tests. |
| Replay changes because evidence expires | Medium | Record evaluation time for historical replay; current-time reevaluation is an explicit new input and deterministically returns stale. |
| Prompt parity precedes runtime reachability | High | Runtime-control map stays inactive and prompt activation is blocked until production/export/adapter tests pass. |
| Large cross-cutting test surface | Medium | Keep product logic in pure contracts/services; adapters remain thin; exact target allowlist and no new phase/ledger writer. |

## Open decisions and blockers

- **Spec blockers:** `CBQG-SPEC-B01` and `CBQG-SPEC-B02` must be resolved in official Spec context before Tasks.
- **Dependency blocker:** shared-target Apply must wait for authoritative ownership handoff from `developer-team-execution-convergence`, `project-init-skill-registry-and-session-baseline`, and `streamline-orchestrator-ownership-and-acceptance`, or an explicit coordinator-approved path-level plan.
- **Conditional compatibility stop:** if the final active baseline admission/evaluator contract differs from the adopted interfaces, reconcile this Design; do not silently supersede it.
- **Product decisions:** otherwise closed. The baseline source authority and CP-04 fixture/methodology requested by the Spec are selected above.

## Requirement traceability

| Spec area | Design sections |
|---|---|
| AQ / MG | Decisions 1, 2, 8; Compatibility and migration |
| BE | Decisions 1, 3, 4; EIIs; rollback permanent floors |
| CD / AF | Decisions 4 and 5; causal precedence and boundary validation |
| AR | Decision 6; Registry and persistence; Archive EIIs |
| IV | Decision 7; convergence transitions and replay |
| CP | Decision 3; concurrency policy and measurement |
| RI | Decisions 2, 3, 8; atomic registry chain |
| RB | Rollout and rollback; preserved history/generated discipline |

## Official evidence and provenance

- Approved `openspec/changes/causal-broad-qa-governance/proposal.md`, selections 1A + 2A.
- Concurrent `openspec/changes/causal-broad-qa-governance/spec.md`, 31 materialized requirement IDs / 51 scenarios while its compliance matrix reports 28, including both recorded reconciliation blockers.
- `openspec/archive/deterministic-apply-verify-review-flow/{spec.md,design.md}` and commit `15804c48584fc2b4e936a71c88608e9523011d79` for sequencing, typed convergence evidence, invalidation, role independence, and deferred registry order.
- Active dependency artifacts under `developer-team-execution-convergence`, `project-init-skill-registry-and-session-baseline`, and `streamline-orchestrator-ownership-and-acceptance`.
- Current source/tests named in Focused architecture findings and the exact target map.
- Current OpenCode plugin hook documentation for `tool.execute.before`/`tool.execute.after`; repository Pi extension and external Pi lifecycle evidence for pre/post tool hooks. Runtime activation remains gated by repository conformance tests.
- `openspec/config.yaml`, `openspec/baseline-health.yaml`, `openspec/registry-schema.md`, `docs/architecture.md`, and `docs/developer-team-execution.md`.
- **Role:** `deck-developer-design`; **runner:** `opencode`; **model:** `openai/gpt-5.6-sol`; **instance:** `deck-developer-design-opencode-causal-broad-qa-governance-20260729`.
- Skill Discovery Context V1 was `indeterminate` with reason `CLI_VALIDATION_OPENED_INTERACTIVE_MENU`. Bounded direct discovery used repository sources and active-runner OpenCode exposure only. `.atl/skill-registry.md` was neither read as authority nor written.

## Handoff

Design is technically actionable, but Task remains blocked by `CBQG-SPEC-B01`, `CBQG-SPEC-B02`, and the active shared-target ownership gates. This specialist did not write `state.yaml`, `events.yaml`, any registry, source, test, configuration, generated output, or other artifact. The coordinator must validate this artifact, reconcile the parallel Spec, and serialize any eventual registry intent atomically.
