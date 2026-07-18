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

});
