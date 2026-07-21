import { describe, expect, test } from "bun:test";
import { buildApplyBatchContractV1 } from "./apply-batch";
import { sha256Digest } from "./canonical";
import { buildCausalContextV1 } from "./causal-context";
import { createExecutionDossierV1 } from "./execution-dossier";
import { buildLaneDecisionV1 } from "./execution-lane";
import { buildFailureManifestV1, type FailureFindingInputV1 } from "./failure-manifest";
import { buildStagedVerificationStateV1 } from "./verification-state";
import {
  buildFindingDispositionEnvelopeV1,
  computeProtectedRiskPolicyAuthorityDigestV1,
  computeProtectedRiskPolicySnapshotDigestV1,
  type ProtectedRiskAuthorityContextV1,
  type DispositionClassificationInputV1,
} from "./finding-disposition";
import {
  buildRoutingDecisionV1,
  type RoutingPolicyInputV1,
} from "./routing-decision";
import {
  appendExecutionConvergenceRevisionV1,
  appendExecutionConvergenceRevisionWithAuthorityV1,
  buildConvergenceInvalidationV1,
  buildConvergenceResultRecordV1,
  buildConvergenceStageEvidenceV1,
  buildConvergenceTransitionReceiptV1,
  createExecutionConvergenceDossierV1,
  parseExecutionConvergenceDossierV1,
  parseExecutionConvergenceDossierWithAuthorityV1,
  transitionExecutionConvergenceStateV1,
  transitionExecutionConvergenceStateWithAuthorityV1,
  type ConvergenceLifecycleStateV1,
  type ExecutionConvergenceStateV1,
} from "./execution-convergence";

const DIGEST_A = `sha256:${"a".repeat(64)}` as const;
const DIGEST_B = `sha256:${"b".repeat(64)}` as const;
const DIGEST_C = `sha256:${"c".repeat(64)}` as const;

const PROTECTED_RISK_POLICY = {
  classificationPolicyVersion: "finding-disposition-policy-v1",
  routingPolicyVersion: "routing-decision-policy-v1",
  mandatorySecurityRequirementIds: [] as readonly string[],
  mandatorySecurityTaskIds: [] as readonly string[],
  mandatorySecurityCheckIds: [] as readonly string[],
  mandatorySecurityOracleIds: [] as readonly string[],
  mandatoryDataLossRequirementIds: [] as readonly string[],
  mandatoryDataLossTaskIds: [] as readonly string[],
  mandatoryDataLossCheckIds: ["data-loss-check"] as readonly string[],
  mandatoryDataLossOracleIds: [] as readonly string[],
};
const PROTECTED_RISK_POLICY_DIGEST = computeProtectedRiskPolicyAuthorityDigestV1(PROTECTED_RISK_POLICY);

const batch = buildApplyBatchContractV1({
  schema: "apply-batch-v1",
  changeId: "deterministic-apply-verify-review-flow",
  taskIds: ["T-04"],
  dependencies: [],
  ownerRole: "apply-backend",
  allowedTargets: ["packages/sdd-runtime/src/contracts/execution-convergence.ts"],
  blockedTargets: ["packages/sdd-runtime/src/contracts/execution-dossier.ts"],
  acceptanceObligations: ["REQ-DAVR-TV-01"],
  verificationPlan: [{ stage: "targeted", checkIds: ["unit"] }],
  artifactDigests: { "protected-risk-policy": PROTECTED_RISK_POLICY_DIGEST },
  authorizationGrantRef: DIGEST_A,
  provenance: { actor: "apply-backend", issuedAt: "2026-07-17T00:00:00Z" },
});

function baseDossier() {
  const lane = buildLaneDecisionV1({
    schema: "lane-decision-v1",
    lane: "full_sdd",
    riskScore: 10,
    floorReasons: [],
    policyOverrides: [],
    shadowOnly: false,
  });
  const verification = buildStagedVerificationStateV1({
    schema: "staged-verification-state-v1",
    batchId: batch.batchId,
    stages: [{ stage: "targeted", status: "pending", checkIds: ["unit"], evidence: [] }],
    nextStage: "targeted",
  });
  const causalContext = buildCausalContextV1({
    schema: "causal-context-v1",
    batchDigest: batch.digest,
    priorDecisionDigests: [],
    activeFindingIds: [],
    evidenceRefs: [],
    attemptSummaries: [],
  });
  return createExecutionDossierV1({
    schema: "execution-dossier-v1",
    batch,
    lane,
    verification,
    causalContext,
    registryIntents: [],
  });
}

const classification: DispositionClassificationInputV1 = {
  classificationPolicyVersion: "finding-disposition-policy-v1",
  baselineFingerprints: [],
  deferPolicyRefs: {},
  advisoryCheckIds: [],
  mandatoryRequirementIds: ["REQ-DAVR-TV-01"],
  mandatoryTaskIds: ["T-04"],
  mandatoryCheckIds: ["unit"],
};

const policy: RoutingPolicyInputV1 = {
  routingPolicyVersion: "routing-decision-policy-v1",
  authorityState: "authorized",
  gitSafetyState: "not-required",
  protectedRisk: false,
  dataLossRisk: false,
  excludedTargetIntersection: false,
  progress: "none",
  diagnosableRuntime: true,
  fullyAnchored: true,
  scopeValid: true,
  policyPermitted: true,
};

function finding(overrides: Partial<FailureFindingInputV1> = {}): FailureFindingInputV1 {
  return {
    batchId: batch.batchId,
    batchDigest: batch.digest,
    sourcePhase: "verify",
    sourceArtifact: "verify.md",
    severity: "medium",
    category: "assertion",
    rootCause: "implementation",
    requirementIds: ["REQ-DAVR-TV-01"],
    taskIds: ["T-04"],
    locationKeys: ["packages/sdd-runtime/src/contracts/execution-convergence.ts"],
    oracleId: "unit",
    isSecurityRelevant: false,
    status: "open",
    relationship: "batch_related",
    evidence: [{ kind: "check", checkId: "unit", artifact: "out.log" }],
    ...overrides,
  };
}

describe("ExecutionConvergenceStateV1 + DossierV1", () => {
  test("creates append-only convergence dossier wrapping immutable V1 dossier", () => {
    const v1 = baseDossier();
    const before = JSON.stringify(v1);
    const conv = createExecutionConvergenceDossierV1({
      baseDossier: v1,
      state: {
        lifecycle: "awaiting_apply_result",
        generation: 0,
        implementationSubjectDigest: DIGEST_B,
        activeBlockingSetDigest: DIGEST_C,
      },
    });
    expect(conv.schema).toBe("execution-convergence-dossier-v1");
    expect(conv.revision).toBe(1);
    expect(conv.baseDossierDigest).toBe(v1.digest);
    expect(conv.state.lifecycle).toBe("awaiting_apply_result");
    expect(JSON.stringify(v1)).toBe(before);
    expect(Object.isFrozen(conv)).toBe(true);
  });

  test("state machine transitions match design table for happy path with current evidence digests", () => {
    const emptyActive = sha256Digest({ activeBlockingFindingIds: [] });
    const scoped = DIGEST_A;
    const review = DIGEST_B;
    const broad = DIGEST_C;
    const subject = `sha256:${"d".repeat(64)}` as const;

    let state: ExecutionConvergenceStateV1 = {
      lifecycle: "awaiting_apply_result",
      generation: 0,
      implementationSubjectDigest: subject,
      activeBlockingSetDigest: emptyActive,
    };
    state = transitionExecutionConvergenceStateV1(state, {
      event: "apply_result_accepted",
      activeBlockingSetDigest: emptyActive,
      implementationSubjectDigest: subject,
    });
    expect(state.lifecycle).toBe("targeted_pending");
    expect(state.generation).toBe(1);
    expect(state.scopedStageDigest).toBeUndefined();

    state = transitionExecutionConvergenceStateV1(state, {
      event: "targeted_accepted_no_blockers",
      activeBlockingSetDigest: emptyActive,
      implementationSubjectDigest: subject,
      scopedStageDigest: scoped,
    });
    expect(state.lifecycle).toBe("affected_pending");
    expect(state.scopedStageDigest).toBe(scoped);

    state = transitionExecutionConvergenceStateV1(state, {
      event: "affected_accepted_no_blockers",
      activeBlockingSetDigest: emptyActive,
      implementationSubjectDigest: subject,
      scopedStageDigest: scoped,
    });
    expect(state.lifecycle).toBe("review_pending");

    state = transitionExecutionConvergenceStateV1(state, {
      event: "review_stable",
      activeBlockingSetDigest: emptyActive,
      implementationSubjectDigest: subject,
      scopedStageDigest: scoped,
      reviewDigest: review,
    });
    expect(state.lifecycle).toBe("broad_pending");
    expect(state.reviewDigest).toBe(review);

    state = transitionExecutionConvergenceStateV1(state, {
      event: "broad_accepted",
      activeBlockingSetDigest: emptyActive,
      implementationSubjectDigest: subject,
      scopedStageDigest: scoped,
      reviewDigest: review,
      broadDigest: broad,
    });
    expect(state.lifecycle).toBe("registry_commit_pending");
    expect(state.broadDigest).toBe(broad);

    state = transitionExecutionConvergenceStateV1(state, {
      event: "registry_committed",
      activeBlockingSetDigest: emptyActive,
      implementationSubjectDigest: subject,
      scopedStageDigest: scoped,
      reviewDigest: review,
      broadDigest: broad,
    });
    expect(state.lifecycle).toBe("complete");
  });

  test("active blockers from targeted/affected/review route to routing_pending", () => {
    let state: ExecutionConvergenceStateV1 = {
      lifecycle: "targeted_pending",
      generation: 1,
      implementationSubjectDigest: DIGEST_B,
      activeBlockingSetDigest: DIGEST_C,
    };
    state = transitionExecutionConvergenceStateV1(state, {
      event: "targeted_has_blockers",
      activeBlockingSetDigest: DIGEST_A,
      implementationSubjectDigest: DIGEST_B,
    });
    expect(state.lifecycle).toBe("routing_pending");

    state = {
      lifecycle: "review_pending",
      generation: 1,
      implementationSubjectDigest: DIGEST_B,
      activeBlockingSetDigest: DIGEST_C,
    };
    state = transitionExecutionConvergenceStateV1(state, {
      event: "review_has_blockers",
      activeBlockingSetDigest: DIGEST_A,
      implementationSubjectDigest: DIGEST_B,
    });
    expect(state.lifecycle).toBe("routing_pending");
  });

  test("routing_pending branches to repair/diagnosis/replan/escalate/stop", () => {
    const base: ExecutionConvergenceStateV1 = {
      lifecycle: "routing_pending",
      generation: 1,
      implementationSubjectDigest: DIGEST_B,
      activeBlockingSetDigest: DIGEST_C,
    };
    expect(
      transitionExecutionConvergenceStateV1(base, {
        event: "route_repair",
        activeBlockingSetDigest: DIGEST_C,
        implementationSubjectDigest: DIGEST_B,
      }).lifecycle,
    ).toBe("repair_pending");
    expect(
      transitionExecutionConvergenceStateV1(base, {
        event: "route_diagnosis",
        activeBlockingSetDigest: DIGEST_C,
        implementationSubjectDigest: DIGEST_B,
      }).lifecycle,
    ).toBe("diagnosis_pending");
    expect(
      transitionExecutionConvergenceStateV1(base, {
        event: "route_replan",
        activeBlockingSetDigest: DIGEST_C,
        implementationSubjectDigest: DIGEST_B,
      }).lifecycle,
    ).toBe("replan_required");
    expect(
      transitionExecutionConvergenceStateV1(base, {
        event: "route_escalate",
        activeBlockingSetDigest: DIGEST_C,
        implementationSubjectDigest: DIGEST_B,
      }).lifecycle,
    ).toBe("escalated");
    expect(
      transitionExecutionConvergenceStateV1(base, {
        event: "route_stop",
        activeBlockingSetDigest: DIGEST_C,
        implementationSubjectDigest: DIGEST_B,
      }).lifecycle,
    ).toBe("stopped");
  });

  test("repair success increments generation, returns to targeted_pending, and clears prior evidence digests", () => {
    const state: ExecutionConvergenceStateV1 = {
      lifecycle: "repair_pending",
      generation: 1,
      implementationSubjectDigest: DIGEST_B,
      activeBlockingSetDigest: DIGEST_C,
      scopedStageDigest: DIGEST_A,
      reviewDigest: DIGEST_B,
      broadDigest: DIGEST_C,
    };
    const next = transitionExecutionConvergenceStateV1(state, {
      event: "repair_effect_succeeded",
      activeBlockingSetDigest: DIGEST_C,
      implementationSubjectDigest: DIGEST_A,
    });
    expect(next.lifecycle).toBe("targeted_pending");
    expect(next.generation).toBe(2);
    expect(next.implementationSubjectDigest).toBe(DIGEST_A);
    expect(next.scopedStageDigest).toBeUndefined();
    expect(next.reviewDigest).toBeUndefined();
    expect(next.broadDigest).toBeUndefined();
  });

  test("rejects accepting transitions without current stage evidence digests", () => {
    const emptyActive = sha256Digest({ activeBlockingFindingIds: [] });
    const targeted: ExecutionConvergenceStateV1 = {
      lifecycle: "targeted_pending",
      generation: 1,
      implementationSubjectDigest: DIGEST_B,
      activeBlockingSetDigest: emptyActive,
    };
    expect(() =>
      transitionExecutionConvergenceStateV1(targeted, {
        event: "targeted_accepted_no_blockers",
        activeBlockingSetDigest: emptyActive,
        implementationSubjectDigest: DIGEST_B,
      }),
    ).toThrow("invalid-evidence");

    const reviewPending: ExecutionConvergenceStateV1 = {
      lifecycle: "review_pending",
      generation: 1,
      implementationSubjectDigest: DIGEST_B,
      activeBlockingSetDigest: emptyActive,
      scopedStageDigest: DIGEST_A,
    };
    expect(() =>
      transitionExecutionConvergenceStateV1(reviewPending, {
        event: "review_stable",
        activeBlockingSetDigest: emptyActive,
        implementationSubjectDigest: DIGEST_B,
        scopedStageDigest: DIGEST_A,
      }),
    ).toThrow("invalid-evidence");

    const broadPending: ExecutionConvergenceStateV1 = {
      lifecycle: "broad_pending",
      generation: 1,
      implementationSubjectDigest: DIGEST_B,
      activeBlockingSetDigest: emptyActive,
      scopedStageDigest: DIGEST_A,
      reviewDigest: DIGEST_B,
    };
    expect(() =>
      transitionExecutionConvergenceStateV1(broadPending, {
        event: "broad_accepted",
        activeBlockingSetDigest: emptyActive,
        implementationSubjectDigest: DIGEST_B,
        scopedStageDigest: DIGEST_A,
        reviewDigest: DIGEST_B,
      }),
    ).toThrow("invalid-evidence");
  });

  test("stale pre-repair evidence cannot reach complete after repair", () => {
    const emptyActive = sha256Digest({ activeBlockingFindingIds: [] });
    let state: ExecutionConvergenceStateV1 = {
      lifecycle: "repair_pending",
      generation: 1,
      implementationSubjectDigest: DIGEST_B,
      activeBlockingSetDigest: DIGEST_C,
      scopedStageDigest: DIGEST_A,
      reviewDigest: DIGEST_B,
      broadDigest: DIGEST_C,
    };
    state = transitionExecutionConvergenceStateV1(state, {
      event: "repair_effect_succeeded",
      activeBlockingSetDigest: emptyActive,
      implementationSubjectDigest: DIGEST_A,
    });
    expect(state.lifecycle).toBe("targeted_pending");
    expect(state.generation).toBe(2);
    expect(state.scopedStageDigest).toBeUndefined();
    expect(state.reviewDigest).toBeUndefined();
    expect(state.broadDigest).toBeUndefined();

    // Attempting to advance with no fresh digests fails closed (cannot reuse cleared pre-repair evidence).
    expect(() =>
      transitionExecutionConvergenceStateV1(state, {
        event: "targeted_accepted_no_blockers",
        activeBlockingSetDigest: emptyActive,
        implementationSubjectDigest: DIGEST_A,
      }),
    ).toThrow("invalid-evidence");
  });

  test("invalid transitions are rejected", () => {
    const state: ExecutionConvergenceStateV1 = {
      lifecycle: "awaiting_apply_result",
      generation: 0,
      implementationSubjectDigest: DIGEST_B,
      activeBlockingSetDigest: DIGEST_C,
    };
    expect(() =>
      transitionExecutionConvergenceStateV1(state, {
        event: "broad_accepted",
        activeBlockingSetDigest: DIGEST_C,
        implementationSubjectDigest: DIGEST_B,
      }),
    ).toThrow("invalid-evidence");
    expect(() =>
      transitionExecutionConvergenceStateV1(state, {
        event: "review_stable",
        activeBlockingSetDigest: DIGEST_C,
        implementationSubjectDigest: DIGEST_B,
      }),
    ).toThrow("invalid-evidence");
  });

  test("append-only revision validation and predecessor digest mismatch rejected", () => {
    const v1 = baseDossier();
    const first = createExecutionConvergenceDossierV1({
      baseDossier: v1,
      state: {
        lifecycle: "awaiting_apply_result",
        generation: 0,
        implementationSubjectDigest: DIGEST_B,
        activeBlockingSetDigest: DIGEST_C,
      },
    });
    const second = appendExecutionConvergenceRevisionV1(first, {
      state: transitionExecutionConvergenceStateV1(first.state, {
        event: "apply_result_accepted",
        activeBlockingSetDigest: DIGEST_C,
        implementationSubjectDigest: DIGEST_B,
      }),
    });
    expect(second.revision).toBe(2);
    expect(second.previousDigest).toBe(first.digest);
    expect(second.convergenceId).toBe(first.convergenceId);
    expect(second.baseDossierDigest).toBe(v1.digest);

    expect(() =>
      parseExecutionConvergenceDossierV1(second, []),
    ).toThrow("invalid-evidence");

    const parsed = parseExecutionConvergenceDossierV1(second, [first]);
    expect(parsed.digest).toBe(second.digest);

    const tampered = { ...second, previousDigest: DIGEST_A };
    expect(() => parseExecutionConvergenceDossierV1(tampered, [first])).toThrow("invalid-evidence");
  });

  test("records disposition and routing without mutating V1 dossier", () => {
    const v1 = baseDossier();
    const manifest = buildFailureManifestV1({
      schema: "failure-manifest-v1",
      changeId: batch.changeId,
      batch,
      producerRole: "verify",
      producerInstanceId: "v1",
      producedAt: "2026-07-17T00:00:00Z",
      findings: [finding()],
    });
    const { disposition, auth } = (() => {
      const base = {
        batchDigest: batch.digest,
        manifestDigest: manifest.digest,
        classificationPolicyVersion: classification.classificationPolicyVersion,
        routingPolicyVersion: "routing-decision-policy-v1",
        artifactDigests: { "protected-risk-policy": PROTECTED_RISK_POLICY_DIGEST },
        mandatorySecurityRequirementIds: [],
        mandatorySecurityTaskIds: [],
        mandatorySecurityCheckIds: [],
        mandatorySecurityOracleIds: [],
        mandatoryDataLossRequirementIds: PROTECTED_RISK_POLICY.mandatoryDataLossRequirementIds,
        mandatoryDataLossTaskIds: [],
        mandatoryDataLossCheckIds: PROTECTED_RISK_POLICY.mandatoryDataLossCheckIds,
        mandatoryDataLossOracleIds: [],
      };
      const a = { ...base, policySnapshotDigest: computeProtectedRiskPolicySnapshotDigestV1(base) };
      return {
        disposition: buildFindingDispositionEnvelopeV1({
          manifest,
          batch,
          classification,
          protectedRiskAuthority: a,
        }),
        auth: a,
      };
    })();
    const routing = buildRoutingDecisionV1({
      batch,
      manifest,
      disposition,
      policy,
      protectedRiskAuthority: auth,
    });
    const first = createExecutionConvergenceDossierV1({
      baseDossier: v1,
      state: {
        lifecycle: "routing_pending",
        generation: 1,
        implementationSubjectDigest: DIGEST_B,
        activeBlockingSetDigest: routing.activeBlockingSetDigest,
      },
      dispositionDigest: disposition.digest,
      routingDecisionDigest: routing.digest,
    });
    expect(first.dispositionDigest).toBe(disposition.digest);
    expect(first.routingDecisionDigest).toBe(routing.digest);
    expect(first.baseDossierDigest).toBe(v1.digest);
    // V1 dossier object identity/digest preserved
    expect(v1.digest).toBe(first.baseDossierDigest);
  });

  test("identical inputs produce identical convergence digests", () => {
    const v1 = baseDossier();
    const input = {
      baseDossier: v1,
      state: {
        lifecycle: "awaiting_apply_result" as const,
        generation: 0,
        implementationSubjectDigest: DIGEST_B,
        activeBlockingSetDigest: DIGEST_C,
      },
    };
    const a = createExecutionConvergenceDossierV1(input);
    const b = createExecutionConvergenceDossierV1(input);
    expect(a.digest).toBe(b.digest);
    expect(a.convergenceId).toBe(b.convergenceId);
  });

  test("RED BV-03: wrong stage / prior generation / subject mismatch / opaque evidence rejected", () => {
    const emptyActive = sha256Digest({ activeBlockingFindingIds: [] });
    const subject = DIGEST_B;
    const state: ExecutionConvergenceStateV1 = {
      lifecycle: "targeted_pending",
      generation: 1,
      implementationSubjectDigest: subject,
      activeBlockingSetDigest: emptyActive,
    };
    const dep = DIGEST_A;
    // Wrong stage (review evidence while targeted_pending)
    expect(() =>
      transitionExecutionConvergenceStateWithAuthorityV1(state, {
        event: "targeted_accepted_no_blockers",
        activeBlockingSetDigest: emptyActive,
        implementationSubjectDigest: subject,
        scopedStageDigest: DIGEST_A,
        stageEvidence: buildConvergenceStageEvidenceV1({
          stage: "review",
          evidenceDigest: DIGEST_A,
          generation: 1,
          implementationSubjectDigest: subject,
          dependencySetDigest: dep,
          activeBlockingSetDigest: emptyActive,
          referencedResultDigest: DIGEST_C,
        }),
        expectedDependencySetDigest: dep,
      }),
    ).toThrow(/wrong-stage|invalid-evidence/);

    // Prior-generation evidence
    expect(() =>
      transitionExecutionConvergenceStateWithAuthorityV1(state, {
        event: "targeted_accepted_no_blockers",
        activeBlockingSetDigest: emptyActive,
        implementationSubjectDigest: subject,
        scopedStageDigest: DIGEST_A,
        stageEvidence: buildConvergenceStageEvidenceV1({
          stage: "targeted",
          evidenceDigest: DIGEST_A,
          generation: 0,
          implementationSubjectDigest: subject,
          dependencySetDigest: dep,
          activeBlockingSetDigest: emptyActive,
          referencedResultDigest: DIGEST_C,
        }),
        expectedDependencySetDigest: dep,
      }),
    ).toThrow(/generation_mismatch|invalid-evidence/);

    // Subject mismatch without invalidation
    expect(() =>
      transitionExecutionConvergenceStateWithAuthorityV1(state, {
        event: "targeted_accepted_no_blockers",
        activeBlockingSetDigest: emptyActive,
        implementationSubjectDigest: DIGEST_A,
        scopedStageDigest: DIGEST_A,
        stageEvidence: buildConvergenceStageEvidenceV1({
          stage: "targeted",
          evidenceDigest: DIGEST_A,
          generation: 1,
          implementationSubjectDigest: DIGEST_A,
          dependencySetDigest: dep,
          activeBlockingSetDigest: emptyActive,
          referencedResultDigest: DIGEST_C,
        }),
        expectedDependencySetDigest: dep,
      }),
    ).toThrow(/subject_mismatch|invalid-evidence/);

    // Opaque evidence (missing typed stage evidence)
    expect(() =>
      transitionExecutionConvergenceStateWithAuthorityV1(state, {
        event: "targeted_accepted_no_blockers",
        activeBlockingSetDigest: emptyActive,
        implementationSubjectDigest: subject,
        scopedStageDigest: DIGEST_A,
      }),
    ).toThrow(/opaque-evidence|invalid-evidence/);

    // Dependency mismatch
    expect(() =>
      transitionExecutionConvergenceStateWithAuthorityV1(state, {
        event: "targeted_accepted_no_blockers",
        activeBlockingSetDigest: emptyActive,
        implementationSubjectDigest: subject,
        scopedStageDigest: DIGEST_A,
        stageEvidence: buildConvergenceStageEvidenceV1({
          stage: "targeted",
          evidenceDigest: DIGEST_A,
          generation: 1,
          implementationSubjectDigest: subject,
          dependencySetDigest: dep,
          activeBlockingSetDigest: emptyActive,
          referencedResultDigest: DIGEST_C,
        }),
        expectedDependencySetDigest: DIGEST_C,
      }),
    ).toThrow(/dependency_mismatch|invalid-evidence/);
  });

  test("RED REG-03: arbitrary complete append and illegal transition rejected", () => {
    const emptyActive = sha256Digest({ activeBlockingFindingIds: [] });
    const state: ExecutionConvergenceStateV1 = {
      lifecycle: "awaiting_apply_result",
      generation: 0,
      implementationSubjectDigest: DIGEST_B,
      activeBlockingSetDigest: emptyActive,
    };
    expect(() =>
      transitionExecutionConvergenceStateWithAuthorityV1(state, {
        event: "registry_committed",
        activeBlockingSetDigest: emptyActive,
        implementationSubjectDigest: DIGEST_B,
        stageEvidence: buildConvergenceStageEvidenceV1({
          stage: "registry_commit",
          evidenceDigest: DIGEST_A,
          generation: 0,
          implementationSubjectDigest: DIGEST_B,
          dependencySetDigest: DIGEST_A,
          activeBlockingSetDigest: emptyActive,
          referencedResultDigest: DIGEST_C,
        }),
      }),
    ).toThrow(/illegal-transition|invalid-evidence/);
  });

  test("GREEN BV-03/REG-03: legal typed-evidence chain advances and round-trips", () => {
    const emptyActive = sha256Digest({ activeBlockingFindingIds: [] });
    const subject0 = DIGEST_B;
    const subject1 = DIGEST_A;
    const dep = DIGEST_C;
    const v1 = baseDossier();
    let dossier = createExecutionConvergenceDossierV1({
      baseDossier: v1,
      state: {
        lifecycle: "awaiting_apply_result",
        generation: 0,
        implementationSubjectDigest: subject0,
        activeBlockingSetDigest: emptyActive,
      },
    });
    const history: typeof dossier[] = [];
    const receipts: ReturnType<typeof appendExecutionConvergenceRevisionWithAuthorityV1>["receipt"][] = [];
    const stageEvidenceRecords: ReturnType<typeof buildConvergenceStageEvidenceV1>[] = [];
    const resultRecords: ReturnType<typeof buildConvergenceResultRecordV1>[] = [];

    const applyResult = buildConvergenceResultRecordV1({
      stage: "apply",
      evidenceDigest: DIGEST_A,
      generation: 1,
      implementationSubjectDigest: subject1,
      dependencySetDigest: dep,
      activeBlockingSetDigest: emptyActive,
    });
    resultRecords.push(applyResult);
    const applyEvidence = buildConvergenceStageEvidenceV1({
      stage: "apply",
      evidenceDigest: DIGEST_A,
      generation: 1,
      implementationSubjectDigest: subject1,
      dependencySetDigest: dep,
      activeBlockingSetDigest: emptyActive,
      referencedResultDigest: applyResult.digest,
    });
    stageEvidenceRecords.push(applyEvidence);
    let step = appendExecutionConvergenceRevisionWithAuthorityV1(
      dossier,
      {
        event: "apply_result_accepted",
        activeBlockingSetDigest: emptyActive,
        implementationSubjectDigest: subject1,
        stageEvidence: applyEvidence,
        expectedDependencySetDigest: dep,
      },
      history,
    );
    history.push(dossier);
    receipts.push(step.receipt);
    dossier = step.dossier;
    expect(dossier.state.lifecycle).toBe("targeted_pending");
    expect(dossier.state.generation).toBe(1);

    const stages: Array<{
      event: "targeted_accepted_no_blockers" | "affected_accepted_no_blockers" | "review_stable" | "broad_accepted" | "registry_committed";
      stage: "targeted" | "affected_area" | "review" | "broad" | "registry_commit";
      lifecycle: ConvergenceLifecycleStateV1;
      extra: Partial<{ scopedStageDigest: typeof DIGEST_A; reviewDigest: typeof DIGEST_B; broadDigest: typeof DIGEST_C }>;
    }> = [
      {
        event: "targeted_accepted_no_blockers",
        stage: "targeted",
        lifecycle: "affected_pending",
        extra: { scopedStageDigest: DIGEST_A },
      },
      {
        event: "affected_accepted_no_blockers",
        stage: "affected_area",
        lifecycle: "review_pending",
        extra: { scopedStageDigest: DIGEST_A },
      },
      {
        event: "review_stable",
        stage: "review",
        lifecycle: "broad_pending",
        extra: { scopedStageDigest: DIGEST_A, reviewDigest: DIGEST_B },
      },
      {
        event: "broad_accepted",
        stage: "broad",
        lifecycle: "registry_commit_pending",
        extra: { scopedStageDigest: DIGEST_A, reviewDigest: DIGEST_B, broadDigest: DIGEST_C },
      },
      {
        event: "registry_committed",
        stage: "registry_commit",
        lifecycle: "complete",
        extra: { scopedStageDigest: DIGEST_A, reviewDigest: DIGEST_B, broadDigest: DIGEST_C },
      },
    ];

    for (const s of stages) {
      const evidenceDigest =
        s.stage === "review" ? DIGEST_B : s.stage === "broad" ? DIGEST_C : DIGEST_A;
      const result = buildConvergenceResultRecordV1({
        stage: s.stage,
        evidenceDigest,
        generation: 1,
        implementationSubjectDigest: subject1,
        dependencySetDigest: dep,
        activeBlockingSetDigest: emptyActive,
      });
      resultRecords.push(result);
      const evidence = buildConvergenceStageEvidenceV1({
        stage: s.stage,
        evidenceDigest,
        generation: 1,
        implementationSubjectDigest: subject1,
        dependencySetDigest: dep,
        activeBlockingSetDigest: emptyActive,
        referencedResultDigest: result.digest,
      });
      stageEvidenceRecords.push(evidence);
      step = appendExecutionConvergenceRevisionWithAuthorityV1(
        dossier,
        {
          event: s.event,
          activeBlockingSetDigest: emptyActive,
          implementationSubjectDigest: subject1,
          stageEvidence: evidence,
          expectedDependencySetDigest: dep,
          ...s.extra,
        },
        history,
      );
      history.push(dossier);
      receipts.push(step.receipt);
      dossier = step.dossier;
      expect(dossier.state.lifecycle).toBe(s.lifecycle);
    }

    const parsed = parseExecutionConvergenceDossierWithAuthorityV1(dossier, history, receipts, {
      stageEvidence: stageEvidenceRecords,
      invalidations: [],
      resultRecords,
    });
    expect(parsed.digest).toBe(dossier.digest);
    expect(parsed.state.lifecycle).toBe("complete");
  });

  test("GREEN: dependencies_invalidated clears stale digests and returns to targeted_pending", () => {
    const emptyActive = sha256Digest({ activeBlockingFindingIds: [] });
    const state: ExecutionConvergenceStateV1 = {
      lifecycle: "review_pending",
      generation: 1,
      implementationSubjectDigest: DIGEST_B,
      activeBlockingSetDigest: emptyActive,
      scopedStageDigest: DIGEST_A,
      reviewDigest: DIGEST_B,
    };
    const invalidation = buildConvergenceInvalidationV1({
      predecessorRevision: 3,
      predecessorDigest: DIGEST_C,
      oldImplementationSubjectDigest: DIGEST_B,
      newImplementationSubjectDigest: DIGEST_A,
      oldDependencySetDigest: DIGEST_A,
      newDependencySetDigest: DIGEST_C,
      reason: "subject-drift",
      invalidatedStageDigests: [DIGEST_A, DIGEST_B],
      generation: 1,
    });
    const next = transitionExecutionConvergenceStateWithAuthorityV1(state, {
      event: "dependencies_invalidated",
      activeBlockingSetDigest: emptyActive,
      implementationSubjectDigest: DIGEST_A,
      invalidation,
    });
    expect(next.lifecycle).toBe("targeted_pending");
    expect(next.implementationSubjectDigest).toBe(DIGEST_A);
    expect(next.scopedStageDigest).toBeUndefined();
    expect(next.reviewDigest).toBeUndefined();
  });
  test("RED EA-B3: arbitrary complete jump with self-consistent receipt rejected at authority parse", () => {
    const emptyActive = sha256Digest({ activeBlockingFindingIds: [] });
    const v1 = baseDossier();
    const first = createExecutionConvergenceDossierV1({
      baseDossier: v1,
      state: {
        lifecycle: "awaiting_apply_result",
        generation: 0,
        implementationSubjectDigest: DIGEST_B,
        activeBlockingSetDigest: emptyActive,
      },
    });
    // Legacy structural append jumps directly to complete (illegal transition).
    const jumped = appendExecutionConvergenceRevisionV1(
      first,
      {
        state: {
          lifecycle: "complete",
          generation: 0,
          implementationSubjectDigest: DIGEST_B,
          activeBlockingSetDigest: emptyActive,
          scopedStageDigest: DIGEST_A,
          reviewDigest: DIGEST_B,
          broadDigest: DIGEST_C,
        },
      },
      [],
    );
    const fakeResult = buildConvergenceResultRecordV1({
      stage: "registry_commit",
      evidenceDigest: DIGEST_A,
      generation: 0,
      implementationSubjectDigest: DIGEST_B,
      dependencySetDigest: DIGEST_A,
      activeBlockingSetDigest: emptyActive,
    });
    const fakeEvidence = buildConvergenceStageEvidenceV1({
      stage: "registry_commit",
      evidenceDigest: DIGEST_A,
      generation: 0,
      implementationSubjectDigest: DIGEST_B,
      dependencySetDigest: DIGEST_A,
      activeBlockingSetDigest: emptyActive,
      referencedResultDigest: fakeResult.digest,
    });
    const receipt = buildConvergenceTransitionReceiptV1({
      predecessorRevision: first.revision,
      predecessorDigest: first.digest,
      event: "registry_committed",
      stageEvidenceDigest: fakeEvidence.digest,
      nextStateDigest: sha256Digest(jumped.state),
    });
    // Self-consistent receipt + structural chain must still fail authority replay.
    expect(() =>
      parseExecutionConvergenceDossierWithAuthorityV1(jumped, [first], [receipt], {
        stageEvidence: [fakeEvidence],
        invalidations: [],
        resultRecords: [fakeResult],
      }),
    ).toThrow(/illegal-transition|invalid-evidence/);
  });

  test("RED EA-B3: authority parse without typed stage records rejects", () => {
    const emptyActive = sha256Digest({ activeBlockingFindingIds: [] });
    const v1 = baseDossier();
    const first = createExecutionConvergenceDossierV1({
      baseDossier: v1,
      state: {
        lifecycle: "awaiting_apply_result",
        generation: 0,
        implementationSubjectDigest: DIGEST_B,
        activeBlockingSetDigest: emptyActive,
      },
    });
    const evidence = buildConvergenceStageEvidenceV1({
      stage: "apply",
      evidenceDigest: DIGEST_A,
      generation: 1,
      implementationSubjectDigest: DIGEST_A,
      dependencySetDigest: DIGEST_C,
      activeBlockingSetDigest: emptyActive,
      referencedResultDigest: DIGEST_C,
    });
    const step = appendExecutionConvergenceRevisionWithAuthorityV1(
      first,
      {
        event: "apply_result_accepted",
        activeBlockingSetDigest: emptyActive,
        implementationSubjectDigest: DIGEST_A,
        stageEvidence: evidence,
        expectedDependencySetDigest: DIGEST_C,
      },
      [],
    );
    expect(() =>
      parseExecutionConvergenceDossierWithAuthorityV1(step.dossier, [first], [step.receipt], {
        stageEvidence: [], // missing typed records
        invalidations: [],
        resultRecords: [],
      }),
    ).toThrow(/opaque-evidence|illegal-transition|invalid-evidence/);
  });

  test("RED EA-B3: noncanonical revision-1 completion is not authoritative", () => {
    const v1 = baseDossier();
    const noncanonical = createExecutionConvergenceDossierV1({
      baseDossier: v1,
      state: {
        lifecycle: "complete",
        generation: 0,
        implementationSubjectDigest: DIGEST_B,
        activeBlockingSetDigest: sha256Digest({ activeBlockingFindingIds: [] }),
        scopedStageDigest: DIGEST_A,
        reviewDigest: DIGEST_B,
        broadDigest: DIGEST_C,
      },
    });
    expect(() =>
      parseExecutionConvergenceDossierWithAuthorityV1(noncanonical, [], [], {
        stageEvidence: [],
        invalidations: [],
        resultRecords: [],
      }),
    ).toThrow(/canonical-initial|illegal-transition|invalid-evidence/);
  });

  test("RED EA-B3: stage evidence must resolve an exact typed result and state digest", () => {
    const emptyActive = sha256Digest({ activeBlockingFindingIds: [] });
    const first = createExecutionConvergenceDossierV1({
      baseDossier: baseDossier(),
      state: {
        lifecycle: "awaiting_apply_result",
        generation: 0,
        implementationSubjectDigest: DIGEST_B,
        activeBlockingSetDigest: emptyActive,
      },
    });
    const result = buildConvergenceResultRecordV1({
      stage: "apply",
      evidenceDigest: DIGEST_A,
      generation: 1,
      implementationSubjectDigest: DIGEST_A,
      dependencySetDigest: DIGEST_C,
      activeBlockingSetDigest: emptyActive,
    });
    const evidence = buildConvergenceStageEvidenceV1({
      stage: "apply",
      evidenceDigest: DIGEST_A,
      generation: 1,
      implementationSubjectDigest: DIGEST_A,
      dependencySetDigest: DIGEST_C,
      activeBlockingSetDigest: emptyActive,
      referencedResultDigest: result.digest,
    });
    const step = appendExecutionConvergenceRevisionWithAuthorityV1(first, {
      event: "apply_result_accepted",
      activeBlockingSetDigest: emptyActive,
      implementationSubjectDigest: DIGEST_A,
      stageEvidence: evidence,
      expectedDependencySetDigest: DIGEST_C,
    });
    expect(() =>
      parseExecutionConvergenceDossierWithAuthorityV1(step.dossier, [first], [step.receipt], {
        stageEvidence: [evidence],
        invalidations: [],
        resultRecords: [],
      }),
    ).toThrow(/opaque-evidence|invalid-evidence/);

    const mismatchedResult = buildConvergenceResultRecordV1({
      stage: "apply",
      evidenceDigest: DIGEST_B,
      generation: 1,
      implementationSubjectDigest: DIGEST_A,
      dependencySetDigest: DIGEST_C,
      activeBlockingSetDigest: emptyActive,
    });
    expect(() =>
      parseExecutionConvergenceDossierWithAuthorityV1(step.dossier, [first], [step.receipt], {
        stageEvidence: [{ ...evidence, referencedResultDigest: mismatchedResult.digest }],
        invalidations: [],
        resultRecords: [mismatchedResult],
      }),
    ).toThrow(/illegal-transition|invalid-evidence/);
  });

  test("RED REVIEW-FINAL-B1: caller-selected retry ledger growth on apply_result_accepted rejected", () => {
    const emptyActive = sha256Digest({ activeBlockingFindingIds: [] });
    const v1 = baseDossier();
    const first = createExecutionConvergenceDossierV1({
      baseDossier: v1,
      state: {
        lifecycle: "awaiting_apply_result",
        generation: 0,
        implementationSubjectDigest: DIGEST_B,
        activeBlockingSetDigest: emptyActive,
      },
    });
    const result = buildConvergenceResultRecordV1({
      stage: "apply",
      evidenceDigest: DIGEST_A,
      generation: 1,
      implementationSubjectDigest: DIGEST_A,
      dependencySetDigest: DIGEST_C,
      activeBlockingSetDigest: emptyActive,
    });
    const evidence = buildConvergenceStageEvidenceV1({
      stage: "apply",
      evidenceDigest: DIGEST_A,
      generation: 1,
      implementationSubjectDigest: DIGEST_A,
      dependencySetDigest: DIGEST_C,
      activeBlockingSetDigest: emptyActive,
      referencedResultDigest: result.digest,
    });
    const forgedAttemptDigest = DIGEST_A;
    expect(() =>
      appendExecutionConvergenceRevisionWithAuthorityV1(first, {
        event: "apply_result_accepted",
        activeBlockingSetDigest: emptyActive,
        implementationSubjectDigest: DIGEST_A,
        stageEvidence: evidence,
        expectedDependencySetDigest: DIGEST_C,
        retryLedgerDigests: [forgedAttemptDigest],
      }),
    ).toThrow(/retry ledger|illegal-transition|invalid-evidence/);

    const legal = appendExecutionConvergenceRevisionWithAuthorityV1(first, {
      event: "apply_result_accepted",
      activeBlockingSetDigest: emptyActive,
      implementationSubjectDigest: DIGEST_A,
      stageEvidence: evidence,
      expectedDependencySetDigest: DIGEST_C,
    });
    expect(legal.dossier.retryLedgerDigests).toEqual([]);
    const { digest: _d, convergenceId: _c, ...rest } = legal.dossier;
    const injectedPayload = { ...rest, retryLedgerDigests: [forgedAttemptDigest] as const };
    const injectedDigest = sha256Digest(injectedPayload);
    const injected = {
      ...injectedPayload,
      convergenceId: `convergence:v1:${injectedDigest.slice(7, 39)}` as const,
      digest: injectedDigest,
    };
    expect(() =>
      parseExecutionConvergenceDossierWithAuthorityV1(injected, [first], [legal.receipt], {
        stageEvidence: [evidence],
        invalidations: [],
        resultRecords: [result],
      }),
    ).toThrow(/illegal-transition|opaque-evidence|invalid-evidence/);
  });

  test("GREEN: legal repair_effect_succeeded appends event-derived retry ledger digest", () => {
    const emptyActive = sha256Digest({ activeBlockingFindingIds: [] });
    const v1 = baseDossier();
    let head = createExecutionConvergenceDossierV1({
      baseDossier: v1,
      state: {
        lifecycle: "awaiting_apply_result",
        generation: 0,
        implementationSubjectDigest: DIGEST_B,
        activeBlockingSetDigest: emptyActive,
      },
    });
    const history: typeof head[] = [];
    const receipts: ReturnType<typeof appendExecutionConvergenceRevisionWithAuthorityV1>["receipt"][] =
      [];
    const stageEvidenceRecords: ReturnType<typeof buildConvergenceStageEvidenceV1>[] = [];
    const resultRecords: ReturnType<typeof buildConvergenceResultRecordV1>[] = [];
    const dep = DIGEST_C;
    const subject1 = DIGEST_A;

    let evidenceSeq = 0;
    const uniqueEvidenceDigest = (): typeof DIGEST_A => {
      evidenceSeq += 1;
      return sha256Digest({ evidenceSeq, kind: "stage-evidence" });
    };
    const advance = (
      event: "apply_result_accepted" | "targeted_has_blockers" | "route_repair",
      generation: number,
    ) => {
      // stage "apply" avoids reconstruct injecting scoped digests on non-accepting events.
      const stage = "apply" as const;
      const evidenceDigest = uniqueEvidenceDigest();
      const result = buildConvergenceResultRecordV1({
        stage,
        evidenceDigest,
        generation,
        implementationSubjectDigest: subject1,
        dependencySetDigest: dep,
        activeBlockingSetDigest: emptyActive,
      });
      resultRecords.push(result);
      const evidence = buildConvergenceStageEvidenceV1({
        stage,
        evidenceDigest,
        generation,
        implementationSubjectDigest: subject1,
        dependencySetDigest: dep,
        activeBlockingSetDigest: emptyActive,
        referencedResultDigest: result.digest,
      });
      stageEvidenceRecords.push(evidence);
      const step = appendExecutionConvergenceRevisionWithAuthorityV1(
        head,
        {
          event,
          activeBlockingSetDigest: emptyActive,
          implementationSubjectDigest: subject1,
          stageEvidence: evidence,
          expectedDependencySetDigest: dep,
        },
        history,
      );
      history.push(head);
      receipts.push(step.receipt);
      head = step.dossier;
    };

    advance("apply_result_accepted", 1);
    advance("targeted_has_blockers", 1);
    advance("route_repair", 1);
    expect(head.state.lifecycle).toBe("repair_pending");
    const repairPending = head;

    const projectionDigest = DIGEST_B;
    const attemptFields = {
      retryIdentity: DIGEST_A,
      attemptNumber: 1,
      projectionDigest,
      convergenceRevision: repairPending.revision,
      convergenceDigest: repairPending.digest,
      terminalEffectResult: "succeeded" as const,
    };
    const attemptDigest = sha256Digest({
      schema: "retry-attempt-record-v1",
      retryIdentity: attemptFields.retryIdentity,
      attemptNumber: attemptFields.attemptNumber,
      projectionDigest: attemptFields.projectionDigest,
      convergenceRevision: attemptFields.convergenceRevision,
      convergenceDigest: attemptFields.convergenceDigest,
      terminalEffectResult: attemptFields.terminalEffectResult,
    });
    const attempt = { ...attemptFields, digest: attemptDigest };

    const effectEvidenceDigest = uniqueEvidenceDigest();
    const effectResult = buildConvergenceResultRecordV1({
      stage: "apply",
      evidenceDigest: effectEvidenceDigest,
      generation: 2,
      implementationSubjectDigest: subject1,
      dependencySetDigest: dep,
      activeBlockingSetDigest: emptyActive,
    });
    resultRecords.push(effectResult);
    const effectEvidence = buildConvergenceStageEvidenceV1({
      stage: "apply",
      evidenceDigest: effectEvidenceDigest,
      generation: 2,
      implementationSubjectDigest: subject1,
      dependencySetDigest: dep,
      activeBlockingSetDigest: emptyActive,
      referencedResultDigest: effectResult.digest,
    });
    stageEvidenceRecords.push(effectEvidence);
    const effectStep = appendExecutionConvergenceRevisionWithAuthorityV1(
      repairPending,
      {
        event: "repair_effect_succeeded",
        activeBlockingSetDigest: emptyActive,
        implementationSubjectDigest: subject1,
        stageEvidence: effectEvidence,
        expectedDependencySetDigest: dep,
        repairProjectionDigest: projectionDigest,
        retryAttemptRecords: [attempt],
        retryLedgerDigests: [attempt.digest],
      },
      history,
    );
    history.push(repairPending);
    receipts.push(effectStep.receipt);
    head = effectStep.dossier;
    expect(head.retryLedgerDigests).toEqual([attempt.digest]);
    expect(head.state.lifecycle).toBe("targeted_pending");
    expect(head.state.generation).toBe(2);

    const parsed = parseExecutionConvergenceDossierWithAuthorityV1(head, history, receipts, {
      stageEvidence: stageEvidenceRecords,
      invalidations: [],
      resultRecords,
      retryAttemptRecords: [attempt],
    });
    expect(parsed.digest).toBe(head.digest);
    expect(parsed.retryLedgerDigests).toEqual([attempt.digest]);
  });

  /**
   * Shared helper: legal chain to repair_pending (empty retry ledger).
   */
  function reachRepairPending(): {
    repairPending: ReturnType<typeof createExecutionConvergenceDossierV1>;
    history: ReturnType<typeof createExecutionConvergenceDossierV1>[];
    receipts: ReturnType<typeof appendExecutionConvergenceRevisionWithAuthorityV1>["receipt"][];
    stageEvidenceRecords: ReturnType<typeof buildConvergenceStageEvidenceV1>[];
    resultRecords: ReturnType<typeof buildConvergenceResultRecordV1>[];
    emptyActive: ReturnType<typeof sha256Digest>;
    dep: typeof DIGEST_C;
    subject1: typeof DIGEST_A;
    uniqueEvidenceDigest: () => typeof DIGEST_A;
  } {
    const emptyActive = sha256Digest({ activeBlockingFindingIds: [] });
    const v1 = baseDossier();
    let head = createExecutionConvergenceDossierV1({
      baseDossier: v1,
      state: {
        lifecycle: "awaiting_apply_result",
        generation: 0,
        implementationSubjectDigest: DIGEST_B,
        activeBlockingSetDigest: emptyActive,
      },
    });
    const history: typeof head[] = [];
    const receipts: ReturnType<typeof appendExecutionConvergenceRevisionWithAuthorityV1>["receipt"][] =
      [];
    const stageEvidenceRecords: ReturnType<typeof buildConvergenceStageEvidenceV1>[] = [];
    const resultRecords: ReturnType<typeof buildConvergenceResultRecordV1>[] = [];
    const dep = DIGEST_C;
    const subject1 = DIGEST_A;
    let evidenceSeq = 0;
    const uniqueEvidenceDigest = (): typeof DIGEST_A => {
      evidenceSeq += 1;
      return sha256Digest({ evidenceSeq, kind: "stage-evidence" });
    };
    const advance = (
      event: "apply_result_accepted" | "targeted_has_blockers" | "route_repair",
      generation: number,
    ) => {
      const stage = "apply" as const;
      const evidenceDigest = uniqueEvidenceDigest();
      const result = buildConvergenceResultRecordV1({
        stage,
        evidenceDigest,
        generation,
        implementationSubjectDigest: subject1,
        dependencySetDigest: dep,
        activeBlockingSetDigest: emptyActive,
      });
      resultRecords.push(result);
      const evidence = buildConvergenceStageEvidenceV1({
        stage,
        evidenceDigest,
        generation,
        implementationSubjectDigest: subject1,
        dependencySetDigest: dep,
        activeBlockingSetDigest: emptyActive,
        referencedResultDigest: result.digest,
      });
      stageEvidenceRecords.push(evidence);
      const step = appendExecutionConvergenceRevisionWithAuthorityV1(
        head,
        {
          event,
          activeBlockingSetDigest: emptyActive,
          implementationSubjectDigest: subject1,
          stageEvidence: evidence,
          expectedDependencySetDigest: dep,
        },
        history,
      );
      history.push(head);
      receipts.push(step.receipt);
      head = step.dossier;
    };
    advance("apply_result_accepted", 1);
    advance("targeted_has_blockers", 1);
    advance("route_repair", 1);
    expect(head.state.lifecycle).toBe("repair_pending");
    expect(head.retryLedgerDigests).toEqual([]);
    return {
      repairPending: head,
      history,
      receipts,
      stageEvidenceRecords,
      resultRecords,
      emptyActive,
      dep,
      subject1,
      uniqueEvidenceDigest,
    };
  }

  function buildAttemptRecord(fields: {
    retryIdentity: typeof DIGEST_A;
    attemptNumber: number;
    projectionDigest: typeof DIGEST_A;
    convergenceRevision: number;
    convergenceDigest: typeof DIGEST_A;
    terminalEffectResult: "succeeded" | "failed";
    priorAttemptDigest?: typeof DIGEST_A;
  }) {
    const digest = sha256Digest({
      schema: "retry-attempt-record-v1",
      retryIdentity: fields.retryIdentity,
      attemptNumber: fields.attemptNumber,
      projectionDigest: fields.projectionDigest,
      ...(fields.priorAttemptDigest === undefined
        ? {}
        : { priorAttemptDigest: fields.priorAttemptDigest }),
      convergenceRevision: fields.convergenceRevision,
      convergenceDigest: fields.convergenceDigest,
      terminalEffectResult: fields.terminalEffectResult,
    });
    return { ...fields, digest };
  }

  function appendRepairEffect(input: {
    predecessor: ReturnType<typeof createExecutionConvergenceDossierV1>;
    history: ReturnType<typeof createExecutionConvergenceDossierV1>[];
    emptyActive: ReturnType<typeof sha256Digest>;
    dep: typeof DIGEST_C;
    subject1: typeof DIGEST_A;
    generation: number;
    projectionDigest: typeof DIGEST_A;
    attempt: ReturnType<typeof buildAttemptRecord>;
    uniqueEvidenceDigest: () => typeof DIGEST_A;
    event?: "repair_effect_succeeded" | "repair_effect_failed";
    /** Complete records resolving predecessor.retryLedgerDigests (per-identity authority). */
    predecessorRetryAttemptRecords?: ReturnType<typeof buildAttemptRecord>[];
  }) {
    const evidenceDigest = input.uniqueEvidenceDigest();
    const result = buildConvergenceResultRecordV1({
      stage: "apply",
      evidenceDigest,
      generation: input.generation,
      implementationSubjectDigest: input.subject1,
      dependencySetDigest: input.dep,
      activeBlockingSetDigest: input.emptyActive,
    });
    const evidence = buildConvergenceStageEvidenceV1({
      stage: "apply",
      evidenceDigest,
      generation: input.generation,
      implementationSubjectDigest: input.subject1,
      dependencySetDigest: input.dep,
      activeBlockingSetDigest: input.emptyActive,
      referencedResultDigest: result.digest,
    });
    const step = appendExecutionConvergenceRevisionWithAuthorityV1(
      input.predecessor,
      {
        event: input.event ?? "repair_effect_succeeded",
        activeBlockingSetDigest: input.emptyActive,
        implementationSubjectDigest: input.subject1,
        stageEvidence: evidence,
        expectedDependencySetDigest: input.dep,
        repairProjectionDigest: input.projectionDigest,
        retryAttemptRecords: [input.attempt],
        predecessorRetryAttemptRecords: input.predecessorRetryAttemptRecords ?? [],
        retryLedgerDigests: [...input.predecessor.retryLedgerDigests, input.attempt.digest],
      },
      input.history,
    );
    return { step, result, evidence };
  }

  test("RED REVIEW-FINAL-B2: empty-ledger attempt-1 with detached priorAttemptDigest rejected", () => {
    const ctx = reachRepairPending();
    const projectionDigest = DIGEST_B;
    const detachedPrior = DIGEST_A; // unrelated valid digest; not from predecessor ledger
    const detached = buildAttemptRecord({
      retryIdentity: DIGEST_A,
      attemptNumber: 1,
      projectionDigest,
      convergenceRevision: ctx.repairPending.revision,
      convergenceDigest: ctx.repairPending.digest,
      terminalEffectResult: "succeeded",
      priorAttemptDigest: detachedPrior,
    });

    expect(() =>
      appendRepairEffect({
        predecessor: ctx.repairPending,
        history: ctx.history,
        emptyActive: ctx.emptyActive,
        dep: ctx.dep,
        subject1: ctx.subject1,
        generation: 2,
        projectionDigest,
        attempt: detached,
        uniqueEvidenceDigest: ctx.uniqueEvidenceDigest,
      }),
    ).toThrow(/retry ledger|illegal-transition|invalid-evidence/);

    // Authority replay also rejects a hand-crafted successor carrying the detached record.
    const legal = buildAttemptRecord({
      retryIdentity: DIGEST_A,
      attemptNumber: 1,
      projectionDigest,
      convergenceRevision: ctx.repairPending.revision,
      convergenceDigest: ctx.repairPending.digest,
      terminalEffectResult: "succeeded",
    });
    const legalAppend = appendRepairEffect({
      predecessor: ctx.repairPending,
      history: ctx.history,
      emptyActive: ctx.emptyActive,
      dep: ctx.dep,
      subject1: ctx.subject1,
      generation: 2,
      projectionDigest,
      attempt: legal,
      uniqueEvidenceDigest: ctx.uniqueEvidenceDigest,
    });
    // Forge successor state from legal append but swap retry digest to detached record.
    const { digest: _d, convergenceId: _c, ...rest } = legalAppend.step.dossier;
    const forgedPayload = {
      ...rest,
      retryLedgerDigests: [detached.digest] as const,
    };
    const forgedDigest = sha256Digest(forgedPayload);
    const forged = {
      ...forgedPayload,
      convergenceId: `convergence:v1:${forgedDigest.slice(7, 39)}` as const,
      digest: forgedDigest,
    };
    expect(() =>
      parseExecutionConvergenceDossierWithAuthorityV1(
        forged,
        [...ctx.history, ctx.repairPending],
        [...ctx.receipts, legalAppend.step.receipt],
        {
          stageEvidence: [...ctx.stageEvidenceRecords, legalAppend.evidence],
          invalidations: [],
          resultRecords: [...ctx.resultRecords, legalAppend.result],
          retryAttemptRecords: [detached],
        },
      ),
    ).toThrow(/illegal-transition|opaque-evidence|invalid-evidence|retry ledger/);
  });

  test("RED REVIEW-FINAL-B2: non-empty predecessor ledger rejects wrong prior / wrong attemptNumber", () => {
    const ctx = reachRepairPending();
    const projectionDigest = DIGEST_B;
    const attempt1 = buildAttemptRecord({
      retryIdentity: DIGEST_A,
      attemptNumber: 1,
      projectionDigest,
      convergenceRevision: ctx.repairPending.revision,
      convergenceDigest: ctx.repairPending.digest,
      terminalEffectResult: "succeeded",
    });
    const first = appendRepairEffect({
      predecessor: ctx.repairPending,
      history: ctx.history,
      emptyActive: ctx.emptyActive,
      dep: ctx.dep,
      subject1: ctx.subject1,
      generation: 2,
      projectionDigest,
      attempt: attempt1,
      uniqueEvidenceDigest: ctx.uniqueEvidenceDigest,
    });
    ctx.history.push(ctx.repairPending);
    ctx.receipts.push(first.step.receipt);
    ctx.stageEvidenceRecords.push(first.evidence);
    ctx.resultRecords.push(first.result);
    let head = first.step.dossier;
    expect(head.retryLedgerDigests).toEqual([attempt1.digest]);

    // Return to repair_pending for attempt 2.
    const reenter = (
      event: "targeted_has_blockers" | "route_repair",
      generation: number,
    ) => {
      const evidenceDigest = ctx.uniqueEvidenceDigest();
      const result = buildConvergenceResultRecordV1({
        stage: "apply",
        evidenceDigest,
        generation,
        implementationSubjectDigest: ctx.subject1,
        dependencySetDigest: ctx.dep,
        activeBlockingSetDigest: ctx.emptyActive,
      });
      ctx.resultRecords.push(result);
      const evidence = buildConvergenceStageEvidenceV1({
        stage: "apply",
        evidenceDigest,
        generation,
        implementationSubjectDigest: ctx.subject1,
        dependencySetDigest: ctx.dep,
        activeBlockingSetDigest: ctx.emptyActive,
        referencedResultDigest: result.digest,
      });
      ctx.stageEvidenceRecords.push(evidence);
      const step = appendExecutionConvergenceRevisionWithAuthorityV1(
        head,
        {
          event,
          activeBlockingSetDigest: ctx.emptyActive,
          implementationSubjectDigest: ctx.subject1,
          stageEvidence: evidence,
          expectedDependencySetDigest: ctx.dep,
        },
        ctx.history,
      );
      ctx.history.push(head);
      ctx.receipts.push(step.receipt);
      head = step.dossier;
    };
    reenter("targeted_has_blockers", 2);
    reenter("route_repair", 2);
    expect(head.state.lifecycle).toBe("repair_pending");
    expect(head.retryLedgerDigests).toEqual([attempt1.digest]);
    const repairPending2 = head;

    // Wrong prior (unrelated) with correct attempt number.
    const wrongPrior = buildAttemptRecord({
      retryIdentity: DIGEST_A,
      attemptNumber: 2,
      projectionDigest,
      convergenceRevision: repairPending2.revision,
      convergenceDigest: repairPending2.digest,
      terminalEffectResult: "succeeded",
      priorAttemptDigest: DIGEST_C, // not attempt1.digest
    });
    expect(() =>
      appendRepairEffect({
        predecessor: repairPending2,
        history: ctx.history,
        emptyActive: ctx.emptyActive,
        dep: ctx.dep,
        subject1: ctx.subject1,
        generation: 3,
        projectionDigest,
        attempt: wrongPrior,
        predecessorRetryAttemptRecords: [attempt1],
        uniqueEvidenceDigest: ctx.uniqueEvidenceDigest,
      }),
    ).toThrow(/retry ledger|illegal-transition|invalid-evidence/);

    // Wrong attempt number (skips to 3) with correct prior.
    const wrongNumber = buildAttemptRecord({
      retryIdentity: DIGEST_A,
      attemptNumber: 3,
      projectionDigest,
      convergenceRevision: repairPending2.revision,
      convergenceDigest: repairPending2.digest,
      terminalEffectResult: "succeeded",
      priorAttemptDigest: attempt1.digest,
    });
    expect(() =>
      appendRepairEffect({
        predecessor: repairPending2,
        history: ctx.history,
        emptyActive: ctx.emptyActive,
        dep: ctx.dep,
        subject1: ctx.subject1,
        generation: 3,
        projectionDigest,
        attempt: wrongNumber,
        predecessorRetryAttemptRecords: [attempt1],
        uniqueEvidenceDigest: ctx.uniqueEvidenceDigest,
      }),
    ).toThrow(/retry ledger|illegal-transition|invalid-evidence/);

    // Missing predecessor record resolution rejects.
    expect(() =>
      appendRepairEffect({
        predecessor: repairPending2,
        history: ctx.history,
        emptyActive: ctx.emptyActive,
        dep: ctx.dep,
        subject1: ctx.subject1,
        generation: 3,
        projectionDigest,
        attempt: buildAttemptRecord({
          retryIdentity: DIGEST_A,
          attemptNumber: 2,
          projectionDigest,
          convergenceRevision: repairPending2.revision,
          convergenceDigest: repairPending2.digest,
          terminalEffectResult: "succeeded",
          priorAttemptDigest: attempt1.digest,
        }),
        predecessorRetryAttemptRecords: [],
        uniqueEvidenceDigest: ctx.uniqueEvidenceDigest,
      }),
    ).toThrow(/retry ledger|illegal-transition|invalid-evidence/);

    // GREEN path: contiguous attempt 2 with exact same-identity prior.
    const attempt2 = buildAttemptRecord({
      retryIdentity: DIGEST_A,
      attemptNumber: 2,
      projectionDigest,
      convergenceRevision: repairPending2.revision,
      convergenceDigest: repairPending2.digest,
      terminalEffectResult: "succeeded",
      priorAttemptDigest: attempt1.digest,
    });
    const second = appendRepairEffect({
      predecessor: repairPending2,
      history: ctx.history,
      emptyActive: ctx.emptyActive,
      dep: ctx.dep,
      subject1: ctx.subject1,
      generation: 3,
      projectionDigest,
      attempt: attempt2,
      predecessorRetryAttemptRecords: [attempt1],
      uniqueEvidenceDigest: ctx.uniqueEvidenceDigest,
    });
    ctx.history.push(repairPending2);
    ctx.receipts.push(second.step.receipt);
    expect(second.step.dossier.retryLedgerDigests).toEqual([attempt1.digest, attempt2.digest]);

    const parsed = parseExecutionConvergenceDossierWithAuthorityV1(
      second.step.dossier,
      ctx.history,
      ctx.receipts,
      {
        stageEvidence: [...ctx.stageEvidenceRecords, second.evidence],
        invalidations: [],
        resultRecords: [...ctx.resultRecords, second.result],
        retryAttemptRecords: [attempt1, attempt2],
      },
    );
    expect(parsed.retryLedgerDigests).toEqual([attempt1.digest, attempt2.digest]);
  });

  test("GREEN: repair_effect_failed appends attempt-1 without prior link", () => {
    const ctx = reachRepairPending();
    const projectionDigest = DIGEST_B;
    const attempt1 = buildAttemptRecord({
      retryIdentity: DIGEST_A,
      attemptNumber: 1,
      projectionDigest,
      convergenceRevision: ctx.repairPending.revision,
      convergenceDigest: ctx.repairPending.digest,
      terminalEffectResult: "failed",
    });
    // repair_effect_failed does not require modifying generation+1 stage evidence validation
    // the same way — but stage evidence is still needed for authority replay.
    const evidenceDigest = ctx.uniqueEvidenceDigest();
    const result = buildConvergenceResultRecordV1({
      stage: "apply",
      evidenceDigest,
      generation: 1,
      implementationSubjectDigest: ctx.subject1,
      dependencySetDigest: ctx.dep,
      activeBlockingSetDigest: ctx.emptyActive,
    });
    const evidence = buildConvergenceStageEvidenceV1({
      stage: "apply",
      evidenceDigest,
      generation: 1,
      implementationSubjectDigest: ctx.subject1,
      dependencySetDigest: ctx.dep,
      activeBlockingSetDigest: ctx.emptyActive,
      referencedResultDigest: result.digest,
    });
    const step = appendExecutionConvergenceRevisionWithAuthorityV1(
      ctx.repairPending,
      {
        event: "repair_effect_failed",
        activeBlockingSetDigest: ctx.emptyActive,
        implementationSubjectDigest: ctx.subject1,
        stageEvidence: evidence,
        expectedDependencySetDigest: ctx.dep,
        repairProjectionDigest: projectionDigest,
        retryAttemptRecords: [attempt1],
        retryLedgerDigests: [attempt1.digest],
      },
      ctx.history,
    );
    expect(step.dossier.retryLedgerDigests).toEqual([attempt1.digest]);
    expect(step.dossier.state.lifecycle).toBe("stopped");

    const parsed = parseExecutionConvergenceDossierWithAuthorityV1(
      step.dossier,
      [...ctx.history, ctx.repairPending],
      [...ctx.receipts, step.receipt],
      {
        stageEvidence: [...ctx.stageEvidenceRecords, evidence],
        invalidations: [],
        resultRecords: [...ctx.resultRecords, result],
        retryAttemptRecords: [attempt1],
      },
    );
    expect(parsed.retryLedgerDigests).toEqual([attempt1.digest]);
  });

  test("RED/GREEN REVIEW-FINAL-B3: per-identity counters — B attempt1 after A; cross-identity priors reject", () => {
    const ctx = reachRepairPending();
    const projectionDigest = DIGEST_B;
    const identityA = DIGEST_A;
    const identityB = DIGEST_C;

    // Legal identity A attempt 1.
    const attemptA1 = buildAttemptRecord({
      retryIdentity: identityA,
      attemptNumber: 1,
      projectionDigest,
      convergenceRevision: ctx.repairPending.revision,
      convergenceDigest: ctx.repairPending.digest,
      terminalEffectResult: "succeeded",
    });
    const first = appendRepairEffect({
      predecessor: ctx.repairPending,
      history: ctx.history,
      emptyActive: ctx.emptyActive,
      dep: ctx.dep,
      subject1: ctx.subject1,
      generation: 2,
      projectionDigest,
      attempt: attemptA1,
      uniqueEvidenceDigest: ctx.uniqueEvidenceDigest,
    });
    ctx.history.push(ctx.repairPending);
    ctx.receipts.push(first.step.receipt);
    ctx.stageEvidenceRecords.push(first.evidence);
    ctx.resultRecords.push(first.result);
    let head = first.step.dossier;

    // Identity-changing re-entry to repair_pending (global ledger still holds A).
    const reenter = (event: "targeted_has_blockers" | "route_repair", generation: number) => {
      const evidenceDigest = ctx.uniqueEvidenceDigest();
      const result = buildConvergenceResultRecordV1({
        stage: "apply",
        evidenceDigest,
        generation,
        implementationSubjectDigest: ctx.subject1,
        dependencySetDigest: ctx.dep,
        activeBlockingSetDigest: ctx.emptyActive,
      });
      ctx.resultRecords.push(result);
      const evidence = buildConvergenceStageEvidenceV1({
        stage: "apply",
        evidenceDigest,
        generation,
        implementationSubjectDigest: ctx.subject1,
        dependencySetDigest: ctx.dep,
        activeBlockingSetDigest: ctx.emptyActive,
        referencedResultDigest: result.digest,
      });
      ctx.stageEvidenceRecords.push(evidence);
      const step = appendExecutionConvergenceRevisionWithAuthorityV1(
        head,
        {
          event,
          activeBlockingSetDigest: ctx.emptyActive,
          implementationSubjectDigest: ctx.subject1,
          stageEvidence: evidence,
          expectedDependencySetDigest: ctx.dep,
        },
        ctx.history,
      );
      ctx.history.push(head);
      ctx.receipts.push(step.receipt);
      head = step.dossier;
    };
    reenter("targeted_has_blockers", 2);
    reenter("route_repair", 2);
    expect(head.state.lifecycle).toBe("repair_pending");
    expect(head.retryLedgerDigests).toEqual([attemptA1.digest]);
    const repairPendingB = head;

    // RED: B attempt2 / prior A (global-length semantics) must reject.
    const bAsAttempt2 = buildAttemptRecord({
      retryIdentity: identityB,
      attemptNumber: 2,
      projectionDigest,
      convergenceRevision: repairPendingB.revision,
      convergenceDigest: repairPendingB.digest,
      terminalEffectResult: "succeeded",
      priorAttemptDigest: attemptA1.digest,
    });
    expect(() =>
      appendRepairEffect({
        predecessor: repairPendingB,
        history: ctx.history,
        emptyActive: ctx.emptyActive,
        dep: ctx.dep,
        subject1: ctx.subject1,
        generation: 3,
        projectionDigest,
        attempt: bAsAttempt2,
        predecessorRetryAttemptRecords: [attemptA1],
        uniqueEvidenceDigest: ctx.uniqueEvidenceDigest,
      }),
    ).toThrow(/retry ledger|illegal-transition|invalid-evidence/);

    // RED: skipped B number (3) rejects.
    const bSkipped = buildAttemptRecord({
      retryIdentity: identityB,
      attemptNumber: 3,
      projectionDigest,
      convergenceRevision: repairPendingB.revision,
      convergenceDigest: repairPendingB.digest,
      terminalEffectResult: "succeeded",
    });
    expect(() =>
      appendRepairEffect({
        predecessor: repairPendingB,
        history: ctx.history,
        emptyActive: ctx.emptyActive,
        dep: ctx.dep,
        subject1: ctx.subject1,
        generation: 3,
        projectionDigest,
        attempt: bSkipped,
        predecessorRetryAttemptRecords: [attemptA1],
        uniqueEvidenceDigest: ctx.uniqueEvidenceDigest,
      }),
    ).toThrow(/retry ledger|illegal-transition|invalid-evidence/);

    // RED: B attempt1 with wrong prior (A) rejects.
    const bWrongPrior = buildAttemptRecord({
      retryIdentity: identityB,
      attemptNumber: 1,
      projectionDigest,
      convergenceRevision: repairPendingB.revision,
      convergenceDigest: repairPendingB.digest,
      terminalEffectResult: "succeeded",
      priorAttemptDigest: attemptA1.digest,
    });
    expect(() =>
      appendRepairEffect({
        predecessor: repairPendingB,
        history: ctx.history,
        emptyActive: ctx.emptyActive,
        dep: ctx.dep,
        subject1: ctx.subject1,
        generation: 3,
        projectionDigest,
        attempt: bWrongPrior,
        predecessorRetryAttemptRecords: [attemptA1],
        uniqueEvidenceDigest: ctx.uniqueEvidenceDigest,
      }),
    ).toThrow(/retry ledger|illegal-transition|invalid-evidence/);

    // GREEN: B attempt1 / no prior — new identity, zero matching predecessor records.
    const attemptB1 = buildAttemptRecord({
      retryIdentity: identityB,
      attemptNumber: 1,
      projectionDigest,
      convergenceRevision: repairPendingB.revision,
      convergenceDigest: repairPendingB.digest,
      terminalEffectResult: "succeeded",
    });
    const bAppend = appendRepairEffect({
      predecessor: repairPendingB,
      history: ctx.history,
      emptyActive: ctx.emptyActive,
      dep: ctx.dep,
      subject1: ctx.subject1,
      generation: 3,
      projectionDigest,
      attempt: attemptB1,
      predecessorRetryAttemptRecords: [attemptA1],
      uniqueEvidenceDigest: ctx.uniqueEvidenceDigest,
    });
    ctx.history.push(repairPendingB);
    ctx.receipts.push(bAppend.step.receipt);
    expect(bAppend.step.dossier.retryLedgerDigests).toEqual([attemptA1.digest, attemptB1.digest]);

    const parsed = parseExecutionConvergenceDossierWithAuthorityV1(
      bAppend.step.dossier,
      ctx.history,
      ctx.receipts,
      {
        stageEvidence: [...ctx.stageEvidenceRecords, bAppend.evidence],
        invalidations: [],
        resultRecords: [...ctx.resultRecords, bAppend.result],
        retryAttemptRecords: [attemptA1, attemptB1],
      },
    );
    expect(parsed.retryLedgerDigests).toEqual([attemptA1.digest, attemptB1.digest]);
  });

  test("RED REVIEW-FINAL-B4: terminal repair_effect without attempt record rejects; non-terminal zero growth", () => {
    const ctx = reachRepairPending();
    const projectionDigest = DIGEST_B;
    const evidenceDigest = ctx.uniqueEvidenceDigest();
    const result = buildConvergenceResultRecordV1({
      stage: "apply",
      evidenceDigest,
      generation: 2,
      implementationSubjectDigest: ctx.subject1,
      dependencySetDigest: ctx.dep,
      activeBlockingSetDigest: ctx.emptyActive,
    });
    const evidence = buildConvergenceStageEvidenceV1({
      stage: "apply",
      evidenceDigest,
      generation: 2,
      implementationSubjectDigest: ctx.subject1,
      dependencySetDigest: ctx.dep,
      activeBlockingSetDigest: ctx.emptyActive,
      referencedResultDigest: result.digest,
    });

    // RED: repair_effect_succeeded with zero retryAttemptRecords / no ledger growth.
    expect(() =>
      appendExecutionConvergenceRevisionWithAuthorityV1(
        ctx.repairPending,
        {
          event: "repair_effect_succeeded",
          activeBlockingSetDigest: ctx.emptyActive,
          implementationSubjectDigest: ctx.subject1,
          stageEvidence: evidence,
          expectedDependencySetDigest: ctx.dep,
          repairProjectionDigest: projectionDigest,
        },
        ctx.history,
      ),
    ).toThrow(/retry ledger|illegal-transition|invalid-evidence/);

    expect(() =>
      appendExecutionConvergenceRevisionWithAuthorityV1(
        ctx.repairPending,
        {
          event: "repair_effect_succeeded",
          activeBlockingSetDigest: ctx.emptyActive,
          implementationSubjectDigest: ctx.subject1,
          stageEvidence: evidence,
          expectedDependencySetDigest: ctx.dep,
          repairProjectionDigest: projectionDigest,
          retryAttemptRecords: [],
          retryLedgerDigests: [],
        },
        ctx.history,
      ),
    ).toThrow(/retry ledger|illegal-transition|invalid-evidence/);

    // RED: repair_effect_failed with zero records.
    const failEvidenceDigest = ctx.uniqueEvidenceDigest();
    const failResult = buildConvergenceResultRecordV1({
      stage: "apply",
      evidenceDigest: failEvidenceDigest,
      generation: 1,
      implementationSubjectDigest: ctx.subject1,
      dependencySetDigest: ctx.dep,
      activeBlockingSetDigest: ctx.emptyActive,
    });
    const failEvidence = buildConvergenceStageEvidenceV1({
      stage: "apply",
      evidenceDigest: failEvidenceDigest,
      generation: 1,
      implementationSubjectDigest: ctx.subject1,
      dependencySetDigest: ctx.dep,
      activeBlockingSetDigest: ctx.emptyActive,
      referencedResultDigest: failResult.digest,
    });
    expect(() =>
      appendExecutionConvergenceRevisionWithAuthorityV1(
        ctx.repairPending,
        {
          event: "repair_effect_failed",
          activeBlockingSetDigest: ctx.emptyActive,
          implementationSubjectDigest: ctx.subject1,
          stageEvidence: failEvidence,
          expectedDependencySetDigest: ctx.dep,
          repairProjectionDigest: projectionDigest,
        },
        ctx.history,
      ),
    ).toThrow(/retry ledger|illegal-transition|invalid-evidence/);

    // RED: multiple attempt records on terminal event.
    const a1 = buildAttemptRecord({
      retryIdentity: DIGEST_A,
      attemptNumber: 1,
      projectionDigest,
      convergenceRevision: ctx.repairPending.revision,
      convergenceDigest: ctx.repairPending.digest,
      terminalEffectResult: "succeeded",
    });
    const a1b = buildAttemptRecord({
      retryIdentity: DIGEST_C,
      attemptNumber: 1,
      projectionDigest,
      convergenceRevision: ctx.repairPending.revision,
      convergenceDigest: ctx.repairPending.digest,
      terminalEffectResult: "succeeded",
    });
    expect(() =>
      appendExecutionConvergenceRevisionWithAuthorityV1(
        ctx.repairPending,
        {
          event: "repair_effect_succeeded",
          activeBlockingSetDigest: ctx.emptyActive,
          implementationSubjectDigest: ctx.subject1,
          stageEvidence: evidence,
          expectedDependencySetDigest: ctx.dep,
          repairProjectionDigest: projectionDigest,
          retryAttemptRecords: [a1, a1b],
          retryLedgerDigests: [a1.digest, a1b.digest],
        },
        ctx.history,
      ),
    ).toThrow(/retry ledger|illegal-transition|invalid-evidence/);

    // RED: outcome mismatch (failed record on succeeded event).
    const wrongOutcome = buildAttemptRecord({
      retryIdentity: DIGEST_A,
      attemptNumber: 1,
      projectionDigest,
      convergenceRevision: ctx.repairPending.revision,
      convergenceDigest: ctx.repairPending.digest,
      terminalEffectResult: "failed",
    });
    expect(() =>
      appendExecutionConvergenceRevisionWithAuthorityV1(
        ctx.repairPending,
        {
          event: "repair_effect_succeeded",
          activeBlockingSetDigest: ctx.emptyActive,
          implementationSubjectDigest: ctx.subject1,
          stageEvidence: evidence,
          expectedDependencySetDigest: ctx.dep,
          repairProjectionDigest: projectionDigest,
          retryAttemptRecords: [wrongOutcome],
          retryLedgerDigests: [wrongOutcome.digest],
        },
        ctx.history,
      ),
    ).toThrow(/retry ledger|illegal-transition|invalid-evidence/);

    // RED: authority replay rejects terminal successor with no ledger growth.
    const legal = appendRepairEffect({
      predecessor: ctx.repairPending,
      history: ctx.history,
      emptyActive: ctx.emptyActive,
      dep: ctx.dep,
      subject1: ctx.subject1,
      generation: 2,
      projectionDigest,
      attempt: a1,
      uniqueEvidenceDigest: ctx.uniqueEvidenceDigest,
    });
    const { digest: _d, convergenceId: _c, ...rest } = legal.step.dossier;
    const strippedPayload = {
      ...rest,
      retryLedgerDigests: [] as const,
    };
    const strippedDigest = sha256Digest(strippedPayload);
    const stripped = {
      ...strippedPayload,
      convergenceId: `convergence:v1:${strippedDigest.slice(7, 39)}` as const,
      digest: strippedDigest,
    };
    expect(() =>
      parseExecutionConvergenceDossierWithAuthorityV1(
        stripped,
        [...ctx.history, ctx.repairPending],
        [...ctx.receipts, legal.step.receipt],
        {
          stageEvidence: [...ctx.stageEvidenceRecords, legal.evidence],
          invalidations: [],
          resultRecords: [...ctx.resultRecords, legal.result],
          retryAttemptRecords: [],
        },
      ),
    ).toThrow(/illegal-transition|opaque-evidence|invalid-evidence|retry ledger/);

    // GREEN: non-terminal events still append zero records (targeted_has_blockers path).
    const afterLegal = legal.step.dossier;
    const ntDigest = ctx.uniqueEvidenceDigest();
    const ntResult = buildConvergenceResultRecordV1({
      stage: "apply",
      evidenceDigest: ntDigest,
      generation: 2,
      implementationSubjectDigest: ctx.subject1,
      dependencySetDigest: ctx.dep,
      activeBlockingSetDigest: ctx.emptyActive,
    });
    const ntEvidence = buildConvergenceStageEvidenceV1({
      stage: "apply",
      evidenceDigest: ntDigest,
      generation: 2,
      implementationSubjectDigest: ctx.subject1,
      dependencySetDigest: ctx.dep,
      activeBlockingSetDigest: ctx.emptyActive,
      referencedResultDigest: ntResult.digest,
    });
    const ntStep = appendExecutionConvergenceRevisionWithAuthorityV1(
      afterLegal,
      {
        event: "targeted_has_blockers",
        activeBlockingSetDigest: ctx.emptyActive,
        implementationSubjectDigest: ctx.subject1,
        stageEvidence: ntEvidence,
        expectedDependencySetDigest: ctx.dep,
      },
      [...ctx.history, ctx.repairPending],
    );
    expect(ntStep.dossier.retryLedgerDigests).toEqual([a1.digest]);
  });

});
