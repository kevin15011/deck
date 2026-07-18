import { describe, expect, test } from "bun:test";
import { buildApplyBatchContractV1 } from "./apply-batch";
import { sha256Digest } from "./canonical";
import { buildFailureManifestV1, type FailureFindingInputV1 } from "./failure-manifest";
import {
  buildFindingDispositionEnvelopeV1,
  computeProtectedRiskPolicyAuthorityDigestV1,
  computeProtectedRiskPolicySnapshotDigestV1,
  type DispositionClassificationInputV1,
  type ProtectedRiskAuthorityContextV1,
} from "./finding-disposition";
import {
  buildRoutingDecisionV1,
  type RoutingPolicyInputV1,
} from "./routing-decision";
import {
  buildBlockingRepairProjectionV1,
  buildRetryIdentityAuthorityProjectionV1,
  computeRetryAttemptRecordDigestV1,
  computeRetryIdentityFromAuthorityV1,
  parseBlockingRepairProjectionV1,
  parseBlockingRepairProjectionStructuralV1,
  validateBlockingRepairProjectionAtEffectBoundaryV1,
  validateRetryAttemptAgainstLedgerV1,
  type RetryAttemptRecordV1,
  type RetryLedgerAuthorityV1,
} from "./blocking-repair-projection";
import {
  appendExecutionConvergenceRevisionWithAuthorityV1,
  buildConvergenceResultRecordV1,
  buildConvergenceStageEvidenceV1,
  type ExecutionConvergenceDossierV1,
} from "./execution-convergence";

const DIGEST_A = `sha256:${"a".repeat(64)}` as const;
const DIGEST_C_SEED = `sha256:${"c".repeat(64)}` as const;

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
  taskIds: ["T-03", "T-01"],
  dependencies: [],
  ownerRole: "apply-backend",
  allowedTargets: [
    "packages/sdd-runtime/src/contracts/blocking-repair-projection.ts",
    "packages/sdd-runtime/src/contracts/finding-disposition.ts",
  ],
  blockedTargets: [
    "packages/sdd-runtime/src/contracts/apply-batch.ts",
    "openspec/changes/runner-capability-standardization",
  ],
  acceptanceObligations: ["REQ-DAVR-MD-01", "REQ-DAVR-BA-01"],
  verificationPlan: [
    { stage: "targeted", checkIds: ["unit"] },
    { stage: "affected_area", checkIds: ["typecheck"] },
    { stage: "broad", checkIds: ["repo-test"] },
  ],
  artifactDigests: { "protected-risk-policy": PROTECTED_RISK_POLICY_DIGEST },
  authorizationGrantRef: DIGEST_A,
  provenance: { actor: "apply-backend", issuedAt: "2026-07-17T00:00:00Z" },
});

const classification: DispositionClassificationInputV1 = {
  classificationPolicyVersion: "finding-disposition-policy-v1",
  baselineFingerprints: [],
  deferPolicyRefs: {},
  advisoryCheckIds: ["lint-style"],
  mandatoryRequirementIds: ["REQ-DAVR-MD-01", "REQ-DAVR-BA-01"],
  mandatoryTaskIds: ["T-03", "T-01"],
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


function makeAuthority(manifestDigest: `sha256:${string}`, overrides: Partial<ProtectedRiskAuthorityContextV1> = {}): ProtectedRiskAuthorityContextV1 {
  const base = {
    batchDigest: batch.digest,
    manifestDigest,
    classificationPolicyVersion: classification.classificationPolicyVersion,
    routingPolicyVersion: policy.routingPolicyVersion,
    artifactDigests: {} as Readonly<Record<string, `sha256:${string}`>>,
    mandatorySecurityRequirementIds: [] as readonly string[],
    mandatorySecurityTaskIds: [] as readonly string[],
    mandatorySecurityCheckIds: [] as readonly string[],
    mandatorySecurityOracleIds: [] as readonly string[],
    mandatoryDataLossRequirementIds: PROTECTED_RISK_POLICY.mandatoryDataLossRequirementIds,
    mandatoryDataLossTaskIds: [] as readonly string[],
    mandatoryDataLossCheckIds: PROTECTED_RISK_POLICY.mandatoryDataLossCheckIds,
    mandatoryDataLossOracleIds: [] as readonly string[],
    ...overrides,
  };
  const { policySnapshotDigest: _d, ...forSnapshot } = base as any;
  return {
    ...forSnapshot,
    policySnapshotDigest: computeProtectedRiskPolicySnapshotDigestV1(forSnapshot),
  };
}

function convergenceHead(): ExecutionConvergenceDossierV1 {
  const payload = {
    schema: "execution-convergence-dossier-v1" as const,
    revision: 1,
    baseDossierDigest: DIGEST_A,
    baseBatchId: batch.batchId,
    baseBatchDigest: batch.digest,
    state: {
      lifecycle: "awaiting_apply_result" as const,
      generation: 0,
      implementationSubjectDigest: DIGEST_C_SEED,
      activeBlockingSetDigest: sha256Digest({ activeBlockingFindingIds: [] }),
    },
    retryLedgerDigests: [] as readonly `sha256:${string}`[],
    invalidationRecordDigests: [] as readonly `sha256:${string}`[],
    roleResultDigests: [] as readonly `sha256:${string}`[],
    registryIntentDigests: [] as readonly `sha256:${string}`[],
  };
  const digest = sha256Digest(payload);
  return {
    ...payload,
    convergenceId: `convergence:v1:${digest.slice(7, 39)}`,
    digest,
  };
}

const INITIAL_CONVERGENCE = convergenceHead();
const DIGEST_C = INITIAL_CONVERGENCE.digest;

const emptyLedger = (
  _revision = INITIAL_CONVERGENCE.revision,
  _digest: `sha256:${string}` = INITIAL_CONVERGENCE.digest,
): RetryLedgerAuthorityV1 => ({
  retryLedgerDigests: [],
  attemptRecords: [],
  currentConvergenceRevision: INITIAL_CONVERGENCE.revision,
  currentConvergenceDigest: INITIAL_CONVERGENCE.digest,
  currentDossier: INITIAL_CONVERGENCE,
  dossierHistory: [],
  transitionReceipts: [],
  convergenceAuthorityRecords: {
    stageEvidence: [],
    invalidations: [],
    resultRecords: [],
  },
  projectionRecords: [],
});

function finding(overrides: Partial<FailureFindingInputV1> = {}): FailureFindingInputV1 {
  return {
    batchId: batch.batchId,
    batchDigest: batch.digest,
    sourcePhase: "verify",
    sourceArtifact: "verify.md",
    severity: "medium",
    category: "assertion",
    rootCause: "implementation",
    requirementIds: ["REQ-DAVR-MD-01"],
    taskIds: ["T-03"],
    locationKeys: ["packages/sdd-runtime/src/contracts/blocking-repair-projection.ts"],
    oracleId: "unit",
    isSecurityRelevant: false,
    status: "open",
    relationship: "batch_related",
    evidence: [{ kind: "check", checkId: "unit", artifact: "out.log" }],
    ...overrides,
  };
}

function setup(findings: FailureFindingInputV1[]) {
  const manifest = buildFailureManifestV1({
    schema: "failure-manifest-v1",
    changeId: batch.changeId,
    batch,
    producerRole: "verify",
    producerInstanceId: "v1",
    producedAt: "2026-07-17T00:00:00Z",
    findings,
  });
  const auth = makeAuthority(manifest.digest);
  const disposition = buildFindingDispositionEnvelopeV1({
    manifest,
    batch,
    classification,
    protectedRiskAuthority: auth,
  });
  const routing = buildRoutingDecisionV1({
    batch,
    manifest,
    disposition,
    policy,
    protectedRiskAuthority: auth,
  });
  return { manifest, disposition, routing, auth };
}

describe("BlockingRepairProjectionV1", () => {
  test("minimal dossier contains only blocking-derived elements", () => {
    const { manifest } = setup([
      finding(),
      finding({
        category: "advice",
        locationKeys: ["packages/sdd-runtime/src/contracts/finding-disposition.ts"],
        requirementIds: [],
        taskIds: [],
        evidence: [{ kind: "check", checkId: "lint-style", artifact: "lint.log" }],
      }),
      finding({
        category: "defer",
        locationKeys: ["packages/sdd-runtime/src/contracts/finding-disposition.ts"],
        requirementIds: ["REQ-OPTIONAL"],
        taskIds: ["T-OPT"],
        evidence: [{ kind: "check", checkId: "optional-check", artifact: "opt.log" }],
      }),
    ]);
    const deferId = manifest.findings.find((f) => f.category === "defer")!.findingId;
    const authDefer = makeAuthority(manifest.digest);
    const dispositionWithDefer = buildFindingDispositionEnvelopeV1({
      manifest,
      batch,
      classification: {
        ...classification,
        deferPolicyRefs: { [deferId]: "defer:policy:optional" },
      },
      protectedRiskAuthority: authDefer,
    });
    const routing2 = buildRoutingDecisionV1({
      batch,
      manifest,
      disposition: dispositionWithDefer,
      policy,
      protectedRiskAuthority: authDefer,
    });
    const blocking = dispositionWithDefer.entries.filter((e) => e.disposition === "blocking");
    expect(blocking).toHaveLength(1);
    const projection = buildBlockingRepairProjectionV1({
      batch,
      manifest,
      disposition: dispositionWithDefer,
      routing: routing2,
      selectedFindingIds: [blocking[0]!.findingId],
      convergenceDossierRevision: 1,
      convergenceDossierDigest: DIGEST_C,
      authorizationRef: DIGEST_A,
      effectCapabilityBinding: "targeted-repair-v1",
      routingPolicyVersion: policy.routingPolicyVersion,
      causalEvidenceRefs: [{ kind: "check", checkId: "unit", artifact: "out.log" }],
    retryLedger: emptyLedger(),
      protectedRiskAuthority: makeAuthority(manifest.digest),
    });
    // Builder binds causal evidence to the selected finding's evidence refs.
    expect(projection.causalEvidenceRefs).toEqual([{ kind: "check", checkId: "unit", artifact: "out.log" }]);
    expect(projection.selectedFindingIds).toEqual([blocking[0]!.findingId]);
    expect(projection.requirementIds).toEqual(["REQ-DAVR-MD-01"]);
    expect(projection.taskIds).toEqual(["T-03"]);
    expect(projection.allowedTargets).toEqual([
      "packages/sdd-runtime/src/contracts/blocking-repair-projection.ts",
    ]);
    expect(projection.checkIds).toEqual(["unit"]);
    expect(JSON.stringify(projection)).not.toContain("lint-style");
    expect(JSON.stringify(projection)).not.toContain("REQ-OPTIONAL");
    // original batch identity unchanged
    expect(projection.originalBatchId).toBe(batch.batchId);
    expect(projection.originalBatchDigest).toBe(batch.digest);
    expect(batch.allowedTargets).toHaveLength(2);
  });

  test("rejects extra anchors/checks/targets at effect boundary", () => {
    const { manifest, disposition, routing } = setup([finding()]);
    const blockingId = disposition.entries.find((e) => e.disposition === "blocking")!.findingId;
    const projection = buildBlockingRepairProjectionV1({
      batch,
      manifest,
      disposition,
      routing,
      selectedFindingIds: [blockingId],
      convergenceDossierRevision: 1,
      convergenceDossierDigest: DIGEST_C,
      authorizationRef: DIGEST_A,
      effectCapabilityBinding: "targeted-repair-v1",
      routingPolicyVersion: policy.routingPolicyVersion,
      causalEvidenceRefs: [{ kind: "check", checkId: "unit", artifact: "out.log" }],
    retryLedger: emptyLedger(1, DIGEST_C),
      protectedRiskAuthority: makeAuthority(manifest.digest),
    });
    const oversized = {
      ...projection,
      allowedTargets: [
        ...projection.allowedTargets,
        "packages/sdd-runtime/src/contracts/finding-disposition.ts",
      ],
    };
    const result = validateBlockingRepairProjectionAtEffectBoundaryV1({
      projection: oversized as typeof projection,
      batch,
      routing,
      manifest,
      disposition,
      expectedConvergenceDossierDigest: DIGEST_C,
      expectedRoutingDecisionDigest: routing.digest,
      expectedAuthorizationRef: DIGEST_A,
      expectedEffectCapabilityBinding: "targeted-repair-v1",
      excludedChangeTargets: ["openspec/changes/runner-capability-standardization"],
    routingPolicyVersion: policy.routingPolicyVersion,
      retryLedger: emptyLedger(),
      protectedRiskAuthority: makeAuthority(manifest.digest),
    });
    expect(result.accepted).toBe(false);
    if (!result.accepted) {
      expect(result.outcome).toBe("invalid-evidence");
      expect(result.rationaleCodes).toContain("OVERSIZED_TARGETS");
    }
  });

  test("rejects same-check different-artifact causal evidence not present on selected findings", () => {
    const { manifest, disposition, routing } = setup([
      finding({
        evidence: [{ kind: "check", checkId: "unit", artifact: "authoritative.log" }],
      }),
    ]);
    const blockingId = disposition.entries.find((e) => e.disposition === "blocking")!.findingId;
    expect(() =>
      buildBlockingRepairProjectionV1({
        batch,
        manifest,
        disposition,
        routing,
        selectedFindingIds: [blockingId],
        convergenceDossierRevision: 1,
        convergenceDossierDigest: DIGEST_C,
        authorizationRef: DIGEST_A,
        effectCapabilityBinding: "targeted-repair-v1",
      routingPolicyVersion: policy.routingPolicyVersion,
        causalEvidenceRefs: [{ kind: "check", checkId: "unit", artifact: "unrelated-safe-artifact.log" }],
      retryLedger: emptyLedger(1, DIGEST_C),
      protectedRiskAuthority: makeAuthority(manifest.digest),
    }),
    ).toThrow("invalid-evidence");
  });

  test("rejects validly rehashed projection with foreign causal evidence at effect boundary", () => {
    const { manifest, disposition, routing } = setup([
      finding({
        evidence: [{ kind: "check", checkId: "unit", artifact: "authoritative.log" }],
      }),
    ]);
    const blockingId = disposition.entries.find((e) => e.disposition === "blocking")!.findingId;
    const projection = buildBlockingRepairProjectionV1({
      batch,
      manifest,
      disposition,
      routing,
      selectedFindingIds: [blockingId],
      convergenceDossierRevision: 1,
      convergenceDossierDigest: DIGEST_C,
      authorizationRef: DIGEST_A,
      effectCapabilityBinding: "targeted-repair-v1",
      routingPolicyVersion: policy.routingPolicyVersion,
      causalEvidenceRefs: [{ kind: "check", checkId: "unit", artifact: "authoritative.log" }],
    retryLedger: emptyLedger(1, DIGEST_C),
      protectedRiskAuthority: makeAuthority(manifest.digest),
    });
    const { projectionId: _pid, digest: _digest, ...rest } = projection;
    const evidenceOnlyPayload = {
      ...rest,
      causalEvidenceRefs: [
        ...projection.causalEvidenceRefs,
        { kind: "check", checkId: "unit", artifact: "foreign-safe-artifact.log" },
      ],
    };
    const rehashedDigest = sha256Digest(evidenceOnlyPayload);
    const rehashed = {
      ...evidenceOnlyPayload,
      projectionId: `repair-projection:v1:${rehashedDigest.slice(7, 39)}` as const,
      digest: rehashedDigest,
    };
    expect(rehashed.digest).toBe(sha256Digest(evidenceOnlyPayload));
    const result = validateBlockingRepairProjectionAtEffectBoundaryV1({
      projection: rehashed as typeof projection,
      batch,
      routing,
      manifest,
      disposition,
      expectedConvergenceDossierDigest: DIGEST_C,
      expectedRoutingDecisionDigest: routing.digest,
      expectedAuthorizationRef: DIGEST_A,
      expectedEffectCapabilityBinding: "targeted-repair-v1",
      excludedChangeTargets: ["openspec/changes/runner-capability-standardization"],
    routingPolicyVersion: policy.routingPolicyVersion,
      retryLedger: emptyLedger(),
      protectedRiskAuthority: makeAuthority(manifest.digest),
    });
    expect(result.accepted).toBe(false);
    if (!result.accepted) {
      expect(result.outcome).toBe("invalid-evidence");
      expect(result.rationaleCodes).toContain("OVERSIZED_EVIDENCE");
      expect(JSON.stringify(result)).not.toMatch(/api[_-]?key|secret|password|token/i);
    }
  });

  test("normalizes line/range location keys to repository paths for target derivation", () => {
    const { manifest, disposition, routing } = setup([
      finding({
        locationKeys: ["packages/sdd-runtime/src/contracts/blocking-repair-projection.ts:12-13"],
      }),
    ]);
    const blockingId = disposition.entries.find((e) => e.disposition === "blocking")!.findingId;
    const projection = buildBlockingRepairProjectionV1({
      batch,
      manifest,
      disposition,
      routing,
      selectedFindingIds: [blockingId],
      convergenceDossierRevision: 1,
      convergenceDossierDigest: DIGEST_C,
      authorizationRef: DIGEST_A,
      effectCapabilityBinding: "targeted-repair-v1",
      routingPolicyVersion: policy.routingPolicyVersion,
      causalEvidenceRefs: [{ kind: "check", checkId: "unit", artifact: "out.log" }],
    retryLedger: emptyLedger(1, DIGEST_C),
      protectedRiskAuthority: makeAuthority(manifest.digest),
    });
    expect(projection.allowedTargets).toEqual([
      "packages/sdd-runtime/src/contracts/blocking-repair-projection.ts",
    ]);
  });

  test("rejects validly rehashed projection with batch-allowed non-derived target", () => {
    const { manifest, disposition, routing } = setup([finding()]);
    const blockingId = disposition.entries.find((e) => e.disposition === "blocking")!.findingId;
    const projection = buildBlockingRepairProjectionV1({
      batch,
      manifest,
      disposition,
      routing,
      selectedFindingIds: [blockingId],
      convergenceDossierRevision: 1,
      convergenceDossierDigest: DIGEST_C,
      authorizationRef: DIGEST_A,
      effectCapabilityBinding: "targeted-repair-v1",
      routingPolicyVersion: policy.routingPolicyVersion,
      causalEvidenceRefs: [{ kind: "check", checkId: "unit", artifact: "out.log" }],
    retryLedger: emptyLedger(1, DIGEST_C),
      protectedRiskAuthority: makeAuthority(manifest.digest),
    });
    // Bypass: widen to another batch-allowed target that is not finding-derived, then rehash.
    const { projectionId: _pid, digest: _digest, ...rest } = projection;
    const widenedPayload = {
      ...rest,
      allowedTargets: [
        ...new Set([
          ...projection.allowedTargets,
          "packages/sdd-runtime/src/contracts/finding-disposition.ts",
        ]),
      ].sort(),
    };
    const rehashedDigest = sha256Digest(widenedPayload);
    const rehashed = {
      ...widenedPayload,
      projectionId: `repair-projection:v1:${rehashedDigest.slice(7, 39)}` as const,
      digest: rehashedDigest,
    };
    // Control: rehash is content-addressed and still batch-subset.
    expect(rehashed.digest).toBe(sha256Digest(widenedPayload));
    expect(
      rehashed.allowedTargets.every((t) => batch.allowedTargets.includes(t)),
    ).toBe(true);
    expect(rehashed.allowedTargets).not.toEqual([...projection.allowedTargets]);

    const result = validateBlockingRepairProjectionAtEffectBoundaryV1({
      projection: rehashed as typeof projection,
      batch,
      routing,
      manifest,
      disposition,
      expectedConvergenceDossierDigest: DIGEST_C,
      expectedRoutingDecisionDigest: routing.digest,
      expectedAuthorizationRef: DIGEST_A,
      expectedEffectCapabilityBinding: "targeted-repair-v1",
      excludedChangeTargets: ["openspec/changes/runner-capability-standardization"],
    routingPolicyVersion: policy.routingPolicyVersion,
      retryLedger: emptyLedger(),
      protectedRiskAuthority: makeAuthority(manifest.digest),
    });
    expect(result.accepted).toBe(false);
    if (!result.accepted) {
      expect(result.outcome).toBe("invalid-evidence");
      expect(result.rationaleCodes).toContain("OVERSIZED_TARGETS");
      // No secret-shaped payload leakage in rejection surface.
      expect(JSON.stringify(result)).not.toMatch(/api[_-]?key|secret|password|token/i);
    }
  });

  test("rejects blocked-target intersection and excluded-change intersection", () => {
    const { manifest, disposition, routing } = setup([
      finding({
        locationKeys: ["packages/sdd-runtime/src/contracts/apply-batch.ts"],
      }),
    ]);
    // location is blocked — build should reject
    expect(() =>
      buildBlockingRepairProjectionV1({
        batch,
        manifest,
        disposition,
        routing,
        selectedFindingIds: [disposition.entries[0]!.findingId],
        convergenceDossierRevision: 1,
        convergenceDossierDigest: DIGEST_C,
        authorizationRef: DIGEST_A,
        effectCapabilityBinding: "targeted-repair-v1",
      routingPolicyVersion: policy.routingPolicyVersion,
        causalEvidenceRefs: [{ kind: "check", checkId: "unit", artifact: "out.log" }],
      retryLedger: emptyLedger(1, DIGEST_C),
      protectedRiskAuthority: makeAuthority(manifest.digest),
    }),
    ).toThrow("invalid-evidence");
  });

  test("rejects stale authorization and mismatched routing digest", () => {
    const { manifest, disposition, routing } = setup([finding()]);
    const projection = buildBlockingRepairProjectionV1({
      batch,
      manifest,
      disposition,
      routing,
      selectedFindingIds: [disposition.entries[0]!.findingId],
      convergenceDossierRevision: 1,
      convergenceDossierDigest: DIGEST_C,
      authorizationRef: DIGEST_A,
      effectCapabilityBinding: "targeted-repair-v1",
      routingPolicyVersion: policy.routingPolicyVersion,
      causalEvidenceRefs: [{ kind: "check", checkId: "unit", artifact: "out.log" }],
    retryLedger: emptyLedger(1, DIGEST_C),
      protectedRiskAuthority: makeAuthority(manifest.digest),
    });
    const staleAuth = validateBlockingRepairProjectionAtEffectBoundaryV1({
      projection,
      batch,
      routing,
      manifest,
      disposition,
      expectedConvergenceDossierDigest: DIGEST_C,
      expectedRoutingDecisionDigest: routing.digest,
      expectedAuthorizationRef: DIGEST_C,
      expectedEffectCapabilityBinding: "targeted-repair-v1",
      excludedChangeTargets: ["openspec/changes/runner-capability-standardization"],
    routingPolicyVersion: policy.routingPolicyVersion,
      retryLedger: emptyLedger(),
      protectedRiskAuthority: makeAuthority(manifest.digest),
    });
    expect(staleAuth.accepted).toBe(false);
    if (!staleAuth.accepted) expect(staleAuth.rationaleCodes).toContain("STALE_AUTHORIZATION");

    const staleRoute = validateBlockingRepairProjectionAtEffectBoundaryV1({
      projection,
      batch,
      routing,
      manifest,
      disposition,
      expectedConvergenceDossierDigest: DIGEST_C,
      expectedRoutingDecisionDigest: DIGEST_C,
      expectedAuthorizationRef: DIGEST_A,
      expectedEffectCapabilityBinding: "targeted-repair-v1",
      excludedChangeTargets: [],
    routingPolicyVersion: policy.routingPolicyVersion,
      retryLedger: emptyLedger(),
      protectedRiskAuthority: makeAuthority(manifest.digest),
    });
    expect(staleRoute.accepted).toBe(false);
    if (!staleRoute.accepted) expect(staleRoute.rationaleCodes).toContain("STALE_ROUTING_DECISION");
  });

  test("rejects non-homogeneous or non-repair routing outcomes", () => {
    const { manifest, disposition, routing } = setup([
      finding(),
      finding({
        category: "architecture",
        rootCause: "architecture",
        locationKeys: ["packages/sdd-runtime/src/contracts/finding-disposition.ts"],
      }),
    ]);
    expect(routing.outcome).toBe("split_required");
    expect(() =>
      buildBlockingRepairProjectionV1({
        batch,
        manifest,
        disposition,
        routing,
        selectedFindingIds: disposition.entries.filter((e) => e.disposition === "blocking").map((e) => e.findingId),
        convergenceDossierRevision: 1,
        convergenceDossierDigest: DIGEST_C,
        authorizationRef: DIGEST_A,
        effectCapabilityBinding: "targeted-repair-v1",
      routingPolicyVersion: policy.routingPolicyVersion,
        causalEvidenceRefs: [],
      retryLedger: emptyLedger(1, DIGEST_C),
      protectedRiskAuthority: makeAuthority(manifest.digest),
    }),
    ).toThrow("invalid-evidence");
  });

  test("rejects secret-shaped causal evidence", () => {
    const { manifest, disposition, routing } = setup([finding()]);
    expect(() =>
      buildBlockingRepairProjectionV1({
        batch,
        manifest,
        disposition,
        routing,
        selectedFindingIds: [disposition.entries[0]!.findingId],
        convergenceDossierRevision: 1,
        convergenceDossierDigest: DIGEST_C,
        authorizationRef: DIGEST_A,
        effectCapabilityBinding: "targeted-repair-v1",
      routingPolicyVersion: policy.routingPolicyVersion,
        causalEvidenceRefs: [
          { kind: "check", checkId: "unit", artifact: "out.log", excerpt: "api_key=super-secret-value" },
        ],
      retryLedger: emptyLedger(1, DIGEST_C),
      protectedRiskAuthority: makeAuthority(manifest.digest),
    }),
    ).toThrow(/unsafe-diagnostic-content|invalid-evidence/);
  });

  test("projection digest is stable and original batch is not mutated", () => {
    const { manifest, disposition, routing, auth } = setup([finding()]);
    const before = JSON.stringify(batch);
    const input = {
      batch,
      manifest,
      disposition,
      routing,
      selectedFindingIds: [disposition.entries[0]!.findingId],
      convergenceDossierRevision: 1,
      convergenceDossierDigest: DIGEST_C,
      authorizationRef: DIGEST_A,
      effectCapabilityBinding: "targeted-repair-v1" as const,
      routingPolicyVersion: policy.routingPolicyVersion,
      causalEvidenceRefs: [{ kind: "check" as const, checkId: "unit", artifact: "out.log" }],
      retryLedger: emptyLedger(),
      protectedRiskAuthority: auth,
    };
    const p1 = buildBlockingRepairProjectionV1(input);
    const p2 = buildBlockingRepairProjectionV1(input);
    expect(p1.digest).toBe(p2.digest);
    expect(p1.projectionId).toBe(p2.projectionId);
    expect(JSON.stringify(batch)).toBe(before);
    const parsed = parseBlockingRepairProjectionV1(p1, batch, routing, {
      routingPolicyVersion: policy.routingPolicyVersion,
      manifest,
      disposition,
      retryLedger: emptyLedger(),
      protectedRiskAuthority: auth,
    });
    expect(parsed.digest).toBe(p1.digest);
    expect(Object.isFrozen(parsed)).toBe(true);
    const ok = validateBlockingRepairProjectionAtEffectBoundaryV1({
      projection: p1,
      batch,
      routing,
      manifest,
      disposition,
      expectedConvergenceDossierDigest: DIGEST_C,
      expectedRoutingDecisionDigest: routing.digest,
      expectedAuthorizationRef: DIGEST_A,
      expectedEffectCapabilityBinding: "targeted-repair-v1",
      excludedChangeTargets: ["openspec/changes/runner-capability-standardization"],
      routingPolicyVersion: policy.routingPolicyVersion,
      retryLedger: emptyLedger(),
      protectedRiskAuthority: auth,
    });
    expect(ok.accepted).toBe(true);
  });

  test("RED RG-05: complete retry identity includes oracle and verification-plan check IDs", () => {
    const { manifest, disposition, routing } = setup([finding()]);
    const blockingId = disposition.entries.find((e) => e.disposition === "blocking")!.findingId;
    const projection = buildBlockingRepairProjectionV1({
      batch,
      manifest,
      disposition,
      routing,
      selectedFindingIds: [blockingId],
      convergenceDossierRevision: 1,
      convergenceDossierDigest: DIGEST_C,
      authorizationRef: DIGEST_A,
      effectCapabilityBinding: "targeted-repair-v1",
      routingPolicyVersion: policy.routingPolicyVersion,
      causalEvidenceRefs: [{ kind: "check", checkId: "unit", artifact: "out.log" }],
    retryLedger: emptyLedger(1, DIGEST_C),
      protectedRiskAuthority: makeAuthority(manifest.digest),
    });
    const authority = buildRetryIdentityAuthorityProjectionV1({
      routingPolicyVersion: policy.routingPolicyVersion,
      batch,
      manifest,
      selectedFindingIds: [blockingId],
      destination: "targeted_repair",
      owner: "apply",
      allowedTargets: projection.allowedTargets,
      requirementIds: projection.requirementIds,
      taskIds: projection.taskIds,
      checkIds: projection.checkIds,
    });
    expect(authority.oracleIds).toEqual(["unit"]);
    expect(authority.verificationPlanCheckIds).toEqual(["repo-test", "typecheck", "unit"]);
    expect(authority.acceptanceObligations).toEqual(["REQ-DAVR-BA-01", "REQ-DAVR-MD-01"]);
    expect(projection.retryIdentity).toBe(computeRetryIdentityFromAuthorityV1(authority));
  });

  test("RED MD-03: replaced retry identity after rehash is rejected at parse", () => {
    const { manifest, disposition, routing } = setup([finding()]);
    const blockingId = disposition.entries.find((e) => e.disposition === "blocking")!.findingId;
    const projection = buildBlockingRepairProjectionV1({
      batch,
      manifest,
      disposition,
      routing,
      selectedFindingIds: [blockingId],
      convergenceDossierRevision: 1,
      convergenceDossierDigest: DIGEST_C,
      authorizationRef: DIGEST_A,
      effectCapabilityBinding: "targeted-repair-v1",
      routingPolicyVersion: policy.routingPolicyVersion,
      causalEvidenceRefs: [{ kind: "check", checkId: "unit", artifact: "out.log" }],
    retryLedger: emptyLedger(1, DIGEST_C),
      protectedRiskAuthority: makeAuthority(manifest.digest),
    });
    const { projectionId: _id, digest: _d, ...rest } = projection;
    const forgedPayload = {
      ...rest,
      retryIdentity: DIGEST_A,
    };
    const rehashedDigest = sha256Digest(forgedPayload);
    const forged = {
      ...forgedPayload,
      projectionId: `repair-projection:v1:${rehashedDigest.slice(7, 39)}` as const,
      digest: rehashedDigest,
    };
    expect(forged.digest).toBe(sha256Digest(forgedPayload));
    expect(() =>
      parseBlockingRepairProjectionV1(forged, batch, routing, {
        routingPolicyVersion: policy.routingPolicyVersion,
        manifest,
        disposition,
        retryLedger: emptyLedger(),
        protectedRiskAuthority: makeAuthority(manifest.digest),
      }),
    ).toThrow(/RETRY_IDENTITY_MISMATCH/);
    // Structural parse alone must not authorize forged identity
    expect(() => parseBlockingRepairProjectionStructuralV1(forged, batch, routing)).not.toThrow();
  });

  test("RED MD-03: attempt ledger bindings reject skip/prior/stale head", () => {
    const { manifest, disposition, routing } = setup([finding()]);
    const blockingId = disposition.entries.find((e) => e.disposition === "blocking")!.findingId;
    const emptyLedgerLocal: RetryLedgerAuthorityV1 = emptyLedger();
    // Attempt 1 with prior digest rejected
    expect(() =>
      buildBlockingRepairProjectionV1({
        batch,
        manifest,
        disposition,
        routing,
        selectedFindingIds: [blockingId],
        convergenceDossierRevision: 1,
        convergenceDossierDigest: DIGEST_C,
        authorizationRef: DIGEST_A,
        effectCapabilityBinding: "targeted-repair-v1",
        routingPolicyVersion: policy.routingPolicyVersion,
        causalEvidenceRefs: [{ kind: "check", checkId: "unit", artifact: "out.log" }],
        attemptNumber: 1,
        priorAttemptDigest: DIGEST_A,
        retryLedger: emptyLedgerLocal,
      protectedRiskAuthority: makeAuthority(manifest.digest),
    }),
    ).toThrow(/RETRY_PRIOR_ATTEMPT_MISMATCH/);

    // Attempt 2 with empty ledger rejected
    expect(() =>
      buildBlockingRepairProjectionV1({
        batch,
        manifest,
        disposition,
        routing,
        selectedFindingIds: [blockingId],
        convergenceDossierRevision: 1,
        convergenceDossierDigest: DIGEST_C,
        authorizationRef: DIGEST_A,
        effectCapabilityBinding: "targeted-repair-v1",
        routingPolicyVersion: policy.routingPolicyVersion,
        causalEvidenceRefs: [{ kind: "check", checkId: "unit", artifact: "out.log" }],
        attemptNumber: 2,
        priorAttemptDigest: DIGEST_A,
        retryLedger: emptyLedgerLocal,
      protectedRiskAuthority: makeAuthority(manifest.digest),
    }),
    ).toThrow(/RETRY_ATTEMPT_NUMBER_MISMATCH/);

    // Stale dossier head rejected
    expect(() =>
      buildBlockingRepairProjectionV1({
        batch,
        manifest,
        disposition,
        routing,
        selectedFindingIds: [blockingId],
        convergenceDossierRevision: 1,
        convergenceDossierDigest: DIGEST_C,
        authorizationRef: DIGEST_A,
        effectCapabilityBinding: "targeted-repair-v1",
        routingPolicyVersion: policy.routingPolicyVersion,
        causalEvidenceRefs: [{ kind: "check", checkId: "unit", artifact: "out.log" }],
        retryLedger: {
          ...emptyLedgerLocal,
          currentConvergenceDigest: DIGEST_A,
        },
      protectedRiskAuthority: makeAuthority(manifest.digest),
    }),
    ).toThrow(/RETRY_LEDGER_MISMATCH/);
  });

  test("GREEN MD-03: attempt 1 with empty ledger accepted; attempt 2 binds prior digest", () => {
    const { manifest, disposition, routing } = setup([finding()]);
    const blockingId = disposition.entries.find((e) => e.disposition === "blocking")!.findingId;
    const firstConvergence = convergenceHead();
    const p1 = buildBlockingRepairProjectionV1({
      batch,
      manifest,
      disposition,
      routing,
      selectedFindingIds: [blockingId],
      convergenceDossierRevision: 1,
      convergenceDossierDigest: firstConvergence.digest,
      authorizationRef: DIGEST_A,
      effectCapabilityBinding: "targeted-repair-v1",
      routingPolicyVersion: policy.routingPolicyVersion,
      causalEvidenceRefs: [{ kind: "check", checkId: "unit", artifact: "out.log" }],
      attemptNumber: 1,
      retryLedger: emptyLedger(firstConvergence.revision, firstConvergence.digest),
    protectedRiskAuthority: makeAuthority(manifest.digest),
    });
    expect(p1.attemptNumber).toBe(1);
    expect(p1.priorAttemptDigest).toBeUndefined();

    const attempt1Fields = {
      retryIdentity: p1.retryIdentity,
      attemptNumber: 1 as const,
      projectionDigest: p1.digest,
      convergenceRevision: 1,
      convergenceDigest: firstConvergence.digest,
      terminalEffectResult: "failed" as const,
    };
    const attempt1: RetryAttemptRecordV1 = {
      ...attempt1Fields,
      digest: computeRetryAttemptRecordDigestV1(attempt1Fields),
    };
    const emptyActive = sha256Digest({ activeBlockingFindingIds: [] });
    const applyResult = buildConvergenceResultRecordV1({
      stage: "apply",
      evidenceDigest: DIGEST_A,
      generation: 1,
      implementationSubjectDigest: DIGEST_A,
      dependencySetDigest: DIGEST_C,
      activeBlockingSetDigest: emptyActive,
    });
    const applyEvidence = buildConvergenceStageEvidenceV1({
      stage: "apply",
      evidenceDigest: DIGEST_A,
      generation: 1,
      implementationSubjectDigest: DIGEST_A,
      dependencySetDigest: DIGEST_C,
      activeBlockingSetDigest: emptyActive,
      referencedResultDigest: applyResult.digest,
    });
    const currentStep = appendExecutionConvergenceRevisionWithAuthorityV1(
      firstConvergence,
      {
        event: "apply_result_accepted",
        activeBlockingSetDigest: emptyActive,
        implementationSubjectDigest: DIGEST_A,
        stageEvidence: applyEvidence,
        expectedDependencySetDigest: DIGEST_C,
        retryLedgerDigests: [attempt1.digest],
      },
      [],
    );
    const currentConvergence = currentStep.dossier;
    const retryLedger: RetryLedgerAuthorityV1 = {
      retryLedgerDigests: [attempt1.digest],
      attemptRecords: [attempt1],
      currentConvergenceRevision: currentConvergence.revision,
      currentConvergenceDigest: currentConvergence.digest,
      currentDossier: currentConvergence,
      dossierHistory: [firstConvergence],
      transitionReceipts: [currentStep.receipt],
      convergenceAuthorityRecords: {
        stageEvidence: [applyEvidence],
        invalidations: [],
        resultRecords: [applyResult],
      },
      projectionRecords: [p1],
    };
    const p2 = buildBlockingRepairProjectionV1({
      batch,
      manifest,
      disposition,
      routing,
      selectedFindingIds: [blockingId],
      convergenceDossierRevision: 2,
      convergenceDossierDigest: currentConvergence.digest,
      authorizationRef: DIGEST_A,
      effectCapabilityBinding: "targeted-repair-v1",
      routingPolicyVersion: policy.routingPolicyVersion,
      causalEvidenceRefs: [{ kind: "check", checkId: "unit", artifact: "out.log" }],
      attemptNumber: 2,
      priorAttemptDigest: attempt1.digest,
      retryLedger,
      protectedRiskAuthority: makeAuthority(manifest.digest),
    });
    expect(p2.attemptNumber).toBe(2);
    expect(p2.priorAttemptDigest).toBe(attempt1.digest);
    expect(p2.retryIdentity).toBe(p1.retryIdentity);
    expect(
      validateRetryAttemptAgainstLedgerV1({
        expectedBatchId: batch.batchId,
        expectedBatchDigest: sha256Digest({ batch: "other" }),
        retryIdentity: p1.retryIdentity,
        attemptNumber: 2,
        priorAttemptDigest: attempt1.digest,
        convergenceDossierRevision: currentConvergence.revision,
        convergenceDossierDigest: currentConvergence.digest,
        ledger: retryLedger,
      }),
    ).toEqual({ ok: false, code: "RETRY_LEDGER_MISMATCH" });
  });

  test("RED RG-05: oracle or verification-plan change creates new identity", () => {
    const { manifest, disposition } = setup([finding()]);
    const blockingId = disposition.entries.find((e) => e.disposition === "blocking")!.findingId;
    const base = buildRetryIdentityAuthorityProjectionV1({
      routingPolicyVersion: policy.routingPolicyVersion,
      batch,
      manifest,
      selectedFindingIds: [blockingId],
      destination: "targeted_repair",
      owner: "apply",
      allowedTargets: ["packages/sdd-runtime/src/contracts/blocking-repair-projection.ts"],
      requirementIds: ["REQ-DAVR-MD-01"],
      taskIds: ["T-03"],
      checkIds: ["unit"],
    });
    const withOracle = { ...base, oracleIds: ["unit", "other-oracle"] };
    expect(computeRetryIdentityFromAuthorityV1(base)).not.toBe(
      computeRetryIdentityFromAuthorityV1(withOracle),
    );
    const withPlan = {
      ...base,
      verificationPlanCheckIds: base.verificationPlanCheckIds.filter((id) => id !== "repo-test"),
    };
    expect(computeRetryIdentityFromAuthorityV1(base)).not.toBe(
      computeRetryIdentityFromAuthorityV1(withPlan),
    );
  });


  test("RED EA-B1: effect rejects omitted protected-risk authority", () => {
    const { manifest, disposition, routing, auth } = setup([finding()]);
    const blockingId = disposition.entries.find((e) => e.disposition === "blocking")!.findingId;
    const projection = buildBlockingRepairProjectionV1({
      batch,
      manifest,
      disposition,
      routing,
      selectedFindingIds: [blockingId],
      convergenceDossierRevision: 1,
      convergenceDossierDigest: DIGEST_C,
      authorizationRef: DIGEST_A,
      effectCapabilityBinding: "targeted-repair-v1",
      routingPolicyVersion: policy.routingPolicyVersion,
      causalEvidenceRefs: [{ kind: "check", checkId: "unit", artifact: "out.log" }],
      retryLedger: emptyLedger(),
      protectedRiskAuthority: auth,
    });
    const result = validateBlockingRepairProjectionAtEffectBoundaryV1({
      projection,
      batch,
      routing,
      manifest,
      disposition,
      expectedConvergenceDossierDigest: DIGEST_C,
      expectedRoutingDecisionDigest: routing.digest,
      expectedAuthorizationRef: DIGEST_A,
      expectedEffectCapabilityBinding: "targeted-repair-v1",
      excludedChangeTargets: ["openspec/changes/runner-capability-standardization"],
      routingPolicyVersion: policy.routingPolicyVersion,
      retryLedger: emptyLedger(),
      protectedRiskAuthority: undefined as never,
    });
    expect(result.accepted).toBe(false);
    if (!result.accepted) {
      expect(result.rationaleCodes).toContain("PROTECTED_RISK_AUTHORITY_AMBIGUOUS");
    }
  });

  test("RED EA-B1: effect rejects a rehashed policy stripped from batch authority", () => {
    const { manifest, disposition, routing, auth } = setup([finding()]);
    const blockingId = disposition.entries.find((e) => e.disposition === "blocking")!.findingId;
    const projection = buildBlockingRepairProjectionV1({
      batch,
      manifest,
      disposition,
      routing,
      selectedFindingIds: [blockingId],
      convergenceDossierRevision: 1,
      convergenceDossierDigest: DIGEST_C,
      authorizationRef: DIGEST_A,
      effectCapabilityBinding: "targeted-repair-v1",
      routingPolicyVersion: policy.routingPolicyVersion,
      causalEvidenceRefs: [{ kind: "check", checkId: "unit", artifact: "out.log" }],
      retryLedger: emptyLedger(),
      protectedRiskAuthority: auth,
    });
    const { policySnapshotDigest: _snapshot, ...strippedFields } = {
      ...auth,
      mandatoryDataLossCheckIds: [] as readonly string[],
    };
    const stripped = {
      ...strippedFields,
      policySnapshotDigest: computeProtectedRiskPolicySnapshotDigestV1(strippedFields),
    };
    const result = validateBlockingRepairProjectionAtEffectBoundaryV1({
      projection,
      batch,
      routing,
      manifest,
      disposition,
      expectedConvergenceDossierDigest: DIGEST_C,
      expectedRoutingDecisionDigest: routing.digest,
      expectedAuthorizationRef: DIGEST_A,
      expectedEffectCapabilityBinding: "targeted-repair-v1",
      excludedChangeTargets: [],
      routingPolicyVersion: policy.routingPolicyVersion,
      retryLedger: emptyLedger(),
      protectedRiskAuthority: stripped,
    });
    expect(result.accepted).toBe(false);
    if (!result.accepted) {
      expect(result.rationaleCodes).toContain("PROTECTED_RISK_AUTHORITY_AMBIGUOUS");
    }
  });

  test("RED EA-B2: forged retry identity accepted at structural parse but rejected at authorizing parse/effect", () => {
    const { manifest, disposition, routing, auth } = setup([finding()]);
    const blockingId = disposition.entries.find((e) => e.disposition === "blocking")!.findingId;
    const projection = buildBlockingRepairProjectionV1({
      batch,
      manifest,
      disposition,
      routing,
      selectedFindingIds: [blockingId],
      convergenceDossierRevision: 1,
      convergenceDossierDigest: DIGEST_C,
      authorizationRef: DIGEST_A,
      effectCapabilityBinding: "targeted-repair-v1",
      routingPolicyVersion: policy.routingPolicyVersion,
      causalEvidenceRefs: [{ kind: "check", checkId: "unit", artifact: "out.log" }],
      retryLedger: emptyLedger(),
      protectedRiskAuthority: auth,
    });
    const { projectionId: _id, digest: _d, ...rest } = projection;
    const forgedPayload = { ...rest, retryIdentity: DIGEST_A };
    const rehashedDigest = sha256Digest(forgedPayload);
    const forged = {
      ...forgedPayload,
      projectionId: `repair-projection:v1:${rehashedDigest.slice(7, 39)}` as const,
      digest: rehashedDigest,
    };
    // Structural integrity alone accepts valid rehash
    expect(parseBlockingRepairProjectionStructuralV1(forged, batch, routing).retryIdentity).toBe(DIGEST_A);
    // Authorizing parse requires identity authority and rejects
    expect(() =>
      parseBlockingRepairProjectionV1(forged, batch, routing, {
        routingPolicyVersion: policy.routingPolicyVersion,
        manifest,
        disposition,
        retryLedger: emptyLedger(),
        protectedRiskAuthority: auth,
      }),
    ).toThrow(/RETRY_IDENTITY_MISMATCH/);
    // Effect without optional policy/ledger must not silently accept
    const effect = validateBlockingRepairProjectionAtEffectBoundaryV1({
      projection: forged as typeof projection,
      batch,
      routing,
      manifest,
      disposition,
      expectedConvergenceDossierDigest: DIGEST_C,
      expectedRoutingDecisionDigest: routing.digest,
      expectedAuthorizationRef: DIGEST_A,
      expectedEffectCapabilityBinding: "targeted-repair-v1",
      excludedChangeTargets: ["openspec/changes/runner-capability-standardization"],
      routingPolicyVersion: policy.routingPolicyVersion,
      retryLedger: emptyLedger(),
      protectedRiskAuthority: auth,
    });
    expect(effect.accepted).toBe(false);
  });

  test("RED EA-B2: attempt ledger recomputes digests and rejects forged records", () => {
    const { manifest, disposition, routing, auth } = setup([finding()]);
    const blockingId = disposition.entries.find((e) => e.disposition === "blocking")!.findingId;
    const p1 = buildBlockingRepairProjectionV1({
      batch,
      manifest,
      disposition,
      routing,
      selectedFindingIds: [blockingId],
      convergenceDossierRevision: 1,
      convergenceDossierDigest: DIGEST_C,
      authorizationRef: DIGEST_A,
      effectCapabilityBinding: "targeted-repair-v1",
      routingPolicyVersion: policy.routingPolicyVersion,
      causalEvidenceRefs: [{ kind: "check", checkId: "unit", artifact: "out.log" }],
      retryLedger: emptyLedger(),
      protectedRiskAuthority: auth,
    });
    const forgedAttempt: RetryAttemptRecordV1 = {
      digest: DIGEST_A, // not recomputed from fields
      retryIdentity: p1.retryIdentity,
      attemptNumber: 1,
      projectionDigest: p1.digest,
      convergenceRevision: 1,
      convergenceDigest: DIGEST_C,
      terminalEffectResult: "failed",
    };
    expect(() =>
      buildBlockingRepairProjectionV1({
        batch,
        manifest,
        disposition,
        routing,
        selectedFindingIds: [blockingId],
        convergenceDossierRevision: 2,
        convergenceDossierDigest: DIGEST_A,
        authorizationRef: DIGEST_A,
        effectCapabilityBinding: "targeted-repair-v1",
        routingPolicyVersion: policy.routingPolicyVersion,
        causalEvidenceRefs: [{ kind: "check", checkId: "unit", artifact: "out.log" }],
        attemptNumber: 2,
        priorAttemptDigest: forgedAttempt.digest,
        retryLedger: {
          retryLedgerDigests: [forgedAttempt.digest],
          attemptRecords: [forgedAttempt],
          currentConvergenceRevision: 2,
          currentConvergenceDigest: DIGEST_A,
        } as never,
        protectedRiskAuthority: auth,
      }),
    ).toThrow(/RETRY_LEDGER_MISMATCH/);
  });

  test("RED EA-B2: a self-consistent fabricated retry history is not source authority", () => {
    const { manifest, disposition, routing, auth } = setup([finding()]);
    const blockingId = disposition.entries.find((e) => e.disposition === "blocking")!.findingId;
    const p1 = buildBlockingRepairProjectionV1({
      batch,
      manifest,
      disposition,
      routing,
      selectedFindingIds: [blockingId],
      convergenceDossierRevision: 1,
      convergenceDossierDigest: DIGEST_C,
      authorizationRef: DIGEST_A,
      effectCapabilityBinding: "targeted-repair-v1",
      routingPolicyVersion: policy.routingPolicyVersion,
      causalEvidenceRefs: [{ kind: "check", checkId: "unit", artifact: "out.log" }],
      retryLedger: emptyLedger(),
      protectedRiskAuthority: auth,
    });
    const fabricatedFields = {
      retryIdentity: p1.retryIdentity,
      attemptNumber: 1,
      projectionDigest: p1.digest,
      convergenceRevision: 999,
      convergenceDigest: DIGEST_A,
      terminalEffectResult: "failed" as const,
    };
    const fabricated: RetryAttemptRecordV1 = {
      ...fabricatedFields,
      digest: computeRetryAttemptRecordDigestV1(fabricatedFields),
    };
    expect(() =>
      buildBlockingRepairProjectionV1({
        batch,
        manifest,
        disposition,
        routing,
        selectedFindingIds: [blockingId],
        convergenceDossierRevision: 2,
        convergenceDossierDigest: DIGEST_A,
        authorizationRef: DIGEST_A,
        effectCapabilityBinding: "targeted-repair-v1",
        routingPolicyVersion: policy.routingPolicyVersion,
        causalEvidenceRefs: [{ kind: "check", checkId: "unit", artifact: "out.log" }],
        attemptNumber: 2,
        priorAttemptDigest: fabricated.digest,
        retryLedger: {
          retryLedgerDigests: [fabricated.digest],
          attemptRecords: [fabricated],
          currentConvergenceRevision: 2,
          currentConvergenceDigest: DIGEST_A,
        } as never,
        protectedRiskAuthority: auth,
      }),
    ).toThrow(/RETRY_LEDGER_MISMATCH/);
  });

  test("RED EA-B2: attempt 1 requires an authority-parsed empty convergence ledger", () => {
    const { manifest, disposition, routing, auth } = setup([finding()]);
    const blockingId = disposition.entries.find((entry) => entry.disposition === "blocking")!.findingId;
    expect(() =>
      buildBlockingRepairProjectionV1({
        batch,
        manifest,
        disposition,
        routing,
        selectedFindingIds: [blockingId],
        convergenceDossierRevision: INITIAL_CONVERGENCE.revision,
        convergenceDossierDigest: INITIAL_CONVERGENCE.digest,
        authorizationRef: DIGEST_A,
        effectCapabilityBinding: "targeted-repair-v1",
        routingPolicyVersion: policy.routingPolicyVersion,
        causalEvidenceRefs: [{ kind: "check", checkId: "unit", artifact: "out.log" }],
        retryLedger: {
          retryLedgerDigests: [],
          attemptRecords: [],
          currentConvergenceRevision: INITIAL_CONVERGENCE.revision,
          currentConvergenceDigest: INITIAL_CONVERGENCE.digest,
        } as never,
        protectedRiskAuthority: auth,
      }),
    ).toThrow(/RETRY_LEDGER_MISMATCH/);
  });
});
