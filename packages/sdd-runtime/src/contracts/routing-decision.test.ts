import { describe, expect, test } from "bun:test";
import { buildApplyBatchContractV1 } from "./apply-batch";
import { buildFailureManifestV1, type FailureFindingInputV1, type FailureRootCause } from "./failure-manifest";
import {
  buildFindingDispositionEnvelopeV1,
  computeProtectedRiskPolicyAuthorityDigestV1,
  computeProtectedRiskPolicySnapshotDigestV1,
  type DispositionClassificationInputV1,
  type ProtectedRiskAuthorityContextV1,
} from "./finding-disposition";
import { sha256Digest } from "./canonical";
import {
  buildRoutingDecisionV1,
  parseRoutingDecisionV1,
  routeActiveBlockerV1,
  type RoutingPolicyInputV1,
  type RoutingDestinationV1,
  type RoutingOwnerV1,
} from "./routing-decision";

const DIGEST_A = `sha256:${"a".repeat(64)}` as const;

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
  taskIds: ["T-02"],
  dependencies: [],
  ownerRole: "apply-backend",
  allowedTargets: ["packages/sdd-runtime/src/contracts/routing-decision.ts"],
  blockedTargets: ["packages/sdd-runtime/src/contracts/execution-decision.ts"],
  acceptanceObligations: ["REQ-DAVR-RD-01"],
  verificationPlan: [{ stage: "targeted", checkIds: ["unit"] }],
  artifactDigests: { "protected-risk-policy": PROTECTED_RISK_POLICY_DIGEST },
  authorizationGrantRef: DIGEST_A,
  provenance: { actor: "apply-backend", issuedAt: "2026-07-17T00:00:00Z" },
});

const classification: DispositionClassificationInputV1 = {
  classificationPolicyVersion: "finding-disposition-policy-v1",
  baselineFingerprints: [],
  deferPolicyRefs: {},
  advisoryCheckIds: [],
  mandatoryRequirementIds: ["REQ-DAVR-RD-01"],
  mandatoryTaskIds: ["T-02"],
  mandatoryCheckIds: ["unit"],
};

const basePolicy: RoutingPolicyInputV1 = {
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

function finding(rootCause: FailureRootCause, loc: string): FailureFindingInputV1 {
  return {
    batchId: batch.batchId,
    batchDigest: batch.digest,
    sourcePhase: "verify",
    sourceArtifact: "verify.md",
    severity: "medium",
    category: rootCause,
    rootCause,
    requirementIds: ["REQ-DAVR-RD-01"],
    taskIds: ["T-02"],
    locationKeys: [loc],
    oracleId: "unit",
    isSecurityRelevant: rootCause === "security",
    status: "open",
    relationship: "batch_related",
    evidence: [{ kind: "check", checkId: "unit", artifact: "out.log" }],
  };
}

function routeOne(rootCause: FailureRootCause, policy: RoutingPolicyInputV1 = basePolicy) {
  const manifest = buildFailureManifestV1({
    schema: "failure-manifest-v1",
    changeId: batch.changeId,
    batch,
    producerRole: "verify",
    producerInstanceId: "v1",
    producedAt: "2026-07-17T00:00:00Z",
    findings: [finding(rootCause, `${rootCause}.ts`)],
  });
  const base = {
    batchDigest: batch.digest,
    manifestDigest: manifest.digest,
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
  };
  const auth: ProtectedRiskAuthorityContextV1 = {
    ...base,
    policySnapshotDigest: computeProtectedRiskPolicySnapshotDigestV1(base),
  };
  const disposition = buildFindingDispositionEnvelopeV1({
    manifest,
    batch,
    classification,
    protectedRiskAuthority: auth,
  });
  return buildRoutingDecisionV1({
    batch,
    manifest,
    disposition,
    policy,
    protectedRiskAuthority: auth,
  });
}

const ALL_ROOT_CAUSES: FailureRootCause[] = [
  "implementation",
  "environment",
  "transport",
  "capability",
  "oracle",
  "requirement",
  "architecture",
  "batch_shape",
  "authorization",
  "security",
  "git_safety",
  "unknown",
];

describe("RoutingDecisionV1", () => {
  test("total table covers all 12 root causes with stable destination+owner", () => {
    const expected: Record<FailureRootCause, { destination: RoutingDestinationV1; owner: RoutingOwnerV1 }> = {
      implementation: { destination: "targeted_repair", owner: "apply" },
      environment: { destination: "verify_runtime_diagnosis", owner: "verify-runtime" },
      transport: { destination: "verify_runtime_diagnosis", owner: "verify-runtime" },
      capability: { destination: "verify_runtime_diagnosis", owner: "verify-runtime" },
      oracle: { destination: "correct_oracle", owner: "verify-runtime" },
      requirement: { destination: "replan_spec", owner: "spec" },
      architecture: { destination: "replan_design", owner: "design" },
      batch_shape: { destination: "replan_tasks", owner: "tasks" },
      authorization: { destination: "stop", owner: "coordinator" },
      security: { destination: "escalate", owner: "human" },
      git_safety: { destination: "stop", owner: "coordinator" },
      unknown: { destination: "verify_runtime_diagnosis", owner: "verify-runtime" },
    };
    for (const root of ALL_ROOT_CAUSES) {
      const decision = routeOne(root);
      expect(decision.routes).toHaveLength(1);
      expect(decision.routes[0]!.destination).toBe(expected[root].destination);
      expect(decision.routes[0]!.owner).toBe(expected[root].owner);
    }
  });

  function authorityFor(
    manifestDigest: `sha256:${string}`,
    overrides: Partial<ProtectedRiskAuthorityContextV1> = {},
  ): ProtectedRiskAuthorityContextV1 {
    const base = {
      batchDigest: batch.digest,
      manifestDigest,
      classificationPolicyVersion: classification.classificationPolicyVersion,
      routingPolicyVersion: basePolicy.routingPolicyVersion,
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

  test("security and data-loss protected risk escalate and never target repair", () => {
    const security = routeOne("security");
    expect(security.routes[0]!.destination).toBe("escalate");
    expect(security.outcome).toBe("escalate");
    // Data-loss via mandatory policy authority (not caller flags)
    const manifest = buildFailureManifestV1({
      schema: "failure-manifest-v1",
      changeId: batch.changeId,
      batch,
      producerRole: "verify",
      producerInstanceId: "v1",
      producedAt: "2026-07-17T00:00:00Z",
      findings: [{
        ...finding("implementation", "impl.ts"),
        evidence: [{ kind: "check", checkId: "data-loss-check", artifact: "out.log" }],
      }],
    });
    const disposition = buildFindingDispositionEnvelopeV1({
      manifest,
      batch,
      classification,
      protectedRiskAuthority: authorityFor(manifest.digest),
    });
    const dataLoss = buildRoutingDecisionV1({
      batch,
      manifest,
      disposition,
      policy: basePolicy,
      protectedRiskAuthority: authorityFor(manifest.digest),
    });
    expect(dataLoss.routes[0]!.destination).toBe("escalate");
    expect(dataLoss.routes[0]!.owner).toBe("human");
  });

  test("authorization and git-safety stop", () => {
    expect(routeOne("authorization").routes[0]!.destination).toBe("stop");
    expect(routeOne("git_safety").routes[0]!.destination).toBe("stop");
    expect(routeOne("implementation", { ...basePolicy, authorityState: "missing" }).routes[0]!.destination).toBe("stop");
    expect(routeOne("implementation", { ...basePolicy, gitSafetyState: "confirmation-required" }).routes[0]!.destination).toBe("stop");
  });

  test("environment/transport/capability never blind-repair; non-diagnosable escalates", () => {
    for (const root of ["environment", "transport", "capability"] as const) {
      expect(routeOne(root).routes[0]!.destination).toBe("verify_runtime_diagnosis");
      expect(routeOne(root, { ...basePolicy, diagnosableRuntime: false }).routes[0]!.destination).toBe("escalate");
    }
  });

  test("unknown without diagnosable evidence stops or escalates fail-closed", () => {
    const diagnosable = routeOne("unknown", { ...basePolicy, diagnosableRuntime: true });
    expect(diagnosable.routes[0]!.destination).toBe("verify_runtime_diagnosis");
    const not = routeOne("unknown", { ...basePolicy, diagnosableRuntime: false });
    expect(["escalate", "stop"]).toContain(not.routes[0]!.destination);
    expect(not.routes[0]!.destination).not.toBe("targeted_repair");
  });

  test("mixed-owner blocking set yields split_required and no homogeneous repair", () => {
    const manifest = buildFailureManifestV1({
      schema: "failure-manifest-v1",
      changeId: batch.changeId,
      batch,
      producerRole: "verify",
      producerInstanceId: "v1",
      producedAt: "2026-07-17T00:00:00Z",
      findings: [finding("implementation", "impl.ts"), finding("architecture", "arch.ts")],
    });
    const disposition = buildFindingDispositionEnvelopeV1({ manifest, batch, classification, protectedRiskAuthority: authorityFor(manifest.digest),
    });
    const decision = buildRoutingDecisionV1({ batch, manifest, disposition, policy: basePolicy, protectedRiskAuthority: authorityFor(manifest.digest),
    });
    expect(decision.outcome).toBe("split_required");
    expect(decision.routes).toHaveLength(2);
    const destinations = new Set(decision.routes.map((r) => r.destination));
    expect(destinations.has("targeted_repair")).toBe(true);
    expect(destinations.has("replan_design")).toBe(true);
  });

  test("mixed anchored and unanchored implementation blockers route per finding", () => {
    const anchored = finding("implementation", "anchored.ts");
    const unanchored: FailureFindingInputV1 = {
      ...finding("implementation", "unanchored.ts"),
      requirementIds: [],
      taskIds: [],
      evidence: [{ kind: "check", checkId: "other-check", artifact: "other.log" }],
    };
    const manifest = buildFailureManifestV1({
      schema: "failure-manifest-v1",
      changeId: batch.changeId,
      batch,
      producerRole: "verify",
      producerInstanceId: "v1",
      producedAt: "2026-07-17T00:00:00Z",
      findings: [anchored, unanchored],
    });
    const disposition = buildFindingDispositionEnvelopeV1({ manifest, batch, classification, protectedRiskAuthority: authorityFor(manifest.digest),
    });
    // Global fullyAnchored=true must not authorize the unanchored finding.
    const decision = buildRoutingDecisionV1({
      batch,
      manifest,
      disposition,
      policy: { ...basePolicy, fullyAnchored: true },
    protectedRiskAuthority: authorityFor(manifest.digest),
    });
    expect(decision.routes).toHaveLength(2);
    const byLoc = new Map(
      decision.routes.map((r) => {
        const f = manifest.findings.find((x) => x.findingId === r.findingId)!;
        return [f.locationKeys[0], r.destination] as const;
      }),
    );
    expect(byLoc.get("anchored.ts")).toBe("targeted_repair");
    expect(byLoc.get("unanchored.ts")).toBe("replan_tasks");
    expect(decision.outcome).toBe("split_required");
  });

  test("mixed protected-risk is finding-specific via intrinsic security; unsupported caller flag fails closed", () => {
    const safe = finding("implementation", "safe.ts");
    const risky: FailureFindingInputV1 = {
      ...finding("implementation", "risky.ts"),
      isSecurityRelevant: true,
    };
    const manifest = buildFailureManifestV1({
      schema: "failure-manifest-v1",
      changeId: batch.changeId,
      batch,
      producerRole: "verify",
      producerInstanceId: "v1",
      producedAt: "2026-07-17T00:00:00Z",
      findings: [safe, risky],
    });
    const auth = authorityFor(manifest.digest);
    const disposition = buildFindingDispositionEnvelopeV1({
      manifest,
      batch,
      classification,
      protectedRiskAuthority: auth,
    });
    const mixed = buildRoutingDecisionV1({
      batch,
      manifest,
      disposition,
      policy: basePolicy,
      protectedRiskAuthority: auth,
    });
    const destByLoc = new Map(
      mixed.routes.map((r) => {
        const f = manifest.findings.find((x) => x.findingId === r.findingId)!;
        return [f.locationKeys[0], r.destination] as const;
      }),
    );
    expect(destByLoc.get("safe.ts")).toBe("targeted_repair");
    expect(destByLoc.get("risky.ts")).toBe("escalate");
    expect(mixed.outcome).toBe("escalate");

    // Caller protectedRisk:true without derived authority is ambiguous → stop (not Apply)
    const mOnly = buildFailureManifestV1({
      schema: "failure-manifest-v1",
      changeId: batch.changeId,
      batch,
      producerRole: "verify",
      producerInstanceId: "v1",
      producedAt: "2026-07-17T00:00:00Z",
      findings: [finding("implementation", "only.ts")],
    });
    const dOnly = buildFindingDispositionEnvelopeV1({
      manifest: mOnly,
      batch,
      classification,
      protectedRiskAuthority: authorityFor(mOnly.digest),
    });
    const stopDecision = buildRoutingDecisionV1({
      batch,
      manifest: mOnly,
      disposition: dOnly,
      policy: { ...basePolicy, protectedRisk: true },
      protectedRiskAuthority: authorityFor(mOnly.digest),
    });
    expect(stopDecision.routes[0]!.destination).toBe("stop");
    expect(stopDecision.routes[0]!.rationaleCodes).toContain("PROTECTED_RISK_AUTHORITY_AMBIGUOUS");
  });

  test("implementation missing anchors or scope growth routes to replan_tasks", () => {
    expect(routeOne("implementation", { ...basePolicy, fullyAnchored: false }).routes[0]!.destination).toBe("replan_tasks");
    expect(routeOne("implementation", { ...basePolicy, scopeValid: false }).routes[0]!.destination).toBe("replan_tasks");
  });

  test("excluded-target intersection stops", () => {
    const decision = routeOne("implementation", { ...basePolicy, excludedTargetIntersection: true });
    expect(decision.routes[0]!.destination).toBe("stop");
    expect(decision.outcome).toBe("stop");
  });

  test("semantic decision digest excludes prose, producer identity, and timestamps", () => {
    const m1 = buildFailureManifestV1({
      schema: "failure-manifest-v1",
      changeId: batch.changeId,
      batch,
      producerRole: "verify",
      producerInstanceId: "agent-a",
      producedAt: "2026-07-17T00:00:00Z",
      findings: [finding("implementation", "x.ts")],
    });
    const m2 = buildFailureManifestV1({
      schema: "failure-manifest-v1",
      changeId: batch.changeId,
      batch,
      producerRole: "review",
      producerInstanceId: "agent-b",
      producedAt: "2026-07-19T00:00:00Z",
      findings: [{ ...finding("implementation", "x.ts"), summary: "different prose", sourcePhase: "review" }],
    });
    const d1 = buildRoutingDecisionV1({
      batch,
      manifest: m1,
      disposition: buildFindingDispositionEnvelopeV1({
        manifest: m1,
        batch,
        classification,
        protectedRiskAuthority: authorityFor(m1.digest),
      }),
      policy: basePolicy,
      protectedRiskAuthority: authorityFor(m1.digest),
    });
    const d2 = buildRoutingDecisionV1({
      batch,
      manifest: m2,
      disposition: buildFindingDispositionEnvelopeV1({
        manifest: m2,
        batch,
        classification,
        protectedRiskAuthority: authorityFor(m2.digest),
      }),
      policy: basePolicy,
      protectedRiskAuthority: authorityFor(m2.digest),
    });
    expect(d1.semanticDecisionDigest).toBe(d2.semanticDecisionDigest);
    expect(d1.routes[0]!.destination).toBe(d2.routes[0]!.destination);
    const disp1 = buildFindingDispositionEnvelopeV1({ manifest: m1, batch, classification, protectedRiskAuthority: authorityFor(m1.digest),
    });
    const parsed = parseRoutingDecisionV1(
      d1,
      m1,
      disp1,
      batch,
      basePolicy,
      authorityFor(m1.digest),
    );
    expect(parsed.digest).toBe(d1.digest);
    expect(Object.isFrozen(parsed)).toBe(true);
  });

  test("rejects validly rehashed routing decision that claims complete with active blockers", () => {
    const decision = routeOne("implementation");
    expect(decision.routes).toHaveLength(1);
    expect(decision.outcome).not.toBe("complete");

    const forgedRoutes: never[] = [];
    const outcome = "complete" as const;
    const rationaleCodes = ["NO_ACTIVE_BLOCKERS"];
    const semanticDecisionDigest = sha256Digest({
      dispositionSemanticDigest: decision.dispositionSemanticDigest,
      activeBlockingSetDigest: decision.activeBlockingSetDigest,
      policyInputDigest: decision.policyInputDigest,
      routes: forgedRoutes,
      outcome,
      rationaleCodes,
    });
    const payload = {
      schema: "routing-decision-v1" as const,
      batchId: decision.batchId,
      batchDigest: decision.batchDigest,
      dispositionSemanticDigest: decision.dispositionSemanticDigest,
      activeBlockingSetDigest: decision.activeBlockingSetDigest,
      policyInputDigest: decision.policyInputDigest,
      routes: forgedRoutes,
      outcome,
      rationaleCodes,
      semanticDecisionDigest,
    };
    const digest = sha256Digest(payload);
    const forged = {
      ...payload,
      decisionId: `routing:v1:${digest.slice(7, 39)}` as const,
      digest,
    };
    expect(forged.digest).toBe(sha256Digest(payload));
    expect(forged.outcome).toBe("complete");
    expect(forged.routes).toHaveLength(0);

    const manifest = buildFailureManifestV1({
      schema: "failure-manifest-v1",
      changeId: batch.changeId,
      batch,
      producerRole: "verify",
      producerInstanceId: "v1",
      producedAt: "2026-07-17T00:00:00Z",
      findings: [finding("implementation", "implementation.ts")],
    });
    const disposition = buildFindingDispositionEnvelopeV1({ manifest, batch, classification, protectedRiskAuthority: authorityFor(manifest.digest),
    });
    expect(() =>
      parseRoutingDecisionV1(
        forged,
        manifest,
        disposition,
        batch,
        basePolicy,
        authorityFor(manifest.digest),
      ),
    ).toThrow("invalid-evidence");
  });

  test("routeActiveBlockerV1 is pure and total for recognized combinations", () => {
    const route = routeActiveBlockerV1({
      rootCause: "implementation",
      policy: basePolicy,
    });
    expect(route.destination).toBe("targeted_repair");
    expect(route.owner).toBe("apply");
    expect(() =>
      routeActiveBlockerV1({
        rootCause: "not-a-cause" as FailureRootCause,
        policy: basePolicy,
      }),
    ).toThrow();
  });

  test("RED SEC-03: forged security→targeted_repair routing rejected at parse", () => {
    const decision = routeOne("security");
    expect(decision.routes[0]!.destination).toBe("escalate");
    const forgedRoutes = decision.routes.map((r) => ({
      ...r,
      destination: "targeted_repair" as const,
      owner: "apply" as const,
      rationaleCodes: ["IMPLEMENTATION_SCOPED_REPAIR"],
    }));
    const outcome = "homogeneous" as const;
    const rationaleCodes = ["HOMOGENEOUS_REPAIR"];
    const semanticDecisionDigest = sha256Digest({
      dispositionSemanticDigest: decision.dispositionSemanticDigest,
      activeBlockingSetDigest: decision.activeBlockingSetDigest,
      policyInputDigest: decision.policyInputDigest,
      routes: forgedRoutes,
      outcome,
      rationaleCodes,
    });
    const payload = {
      schema: "routing-decision-v1" as const,
      batchId: decision.batchId,
      batchDigest: decision.batchDigest,
      dispositionSemanticDigest: decision.dispositionSemanticDigest,
      activeBlockingSetDigest: decision.activeBlockingSetDigest,
      policyInputDigest: decision.policyInputDigest,
      routes: forgedRoutes,
      outcome,
      rationaleCodes,
      semanticDecisionDigest,
    };
    const digest = sha256Digest(payload);
    const forged = {
      ...payload,
      decisionId: `routing:v1:${digest.slice(7, 39)}` as const,
      digest,
    };
    const manifest = buildFailureManifestV1({
      schema: "failure-manifest-v1",
      changeId: batch.changeId,
      batch,
      producerRole: "verify",
      producerInstanceId: "v1",
      producedAt: "2026-07-17T00:00:00Z",
      findings: [finding("security", "security.ts")],
    });
    const disposition = buildFindingDispositionEnvelopeV1({
      manifest,
      batch,
      classification,
      protectedRiskAuthority: authorityFor(manifest.digest),
    });
    expect(() =>
      parseRoutingDecisionV1(
        forged,
        manifest,
        disposition,
        batch,
        basePolicy,
        authorityFor(manifest.digest),
      ),
    ).toThrow(/ROUTING_PROTECTED_RISK_MISMATCH|invalid-evidence/);
  });

  test("RED EA-B1: omitted protected-risk authority at routing build rejects", () => {
    const manifest = buildFailureManifestV1({
      schema: "failure-manifest-v1",
      changeId: batch.changeId,
      batch,
      producerRole: "verify",
      producerInstanceId: "v1",
      producedAt: "2026-07-17T00:00:00Z",
      findings: [{
        ...finding("implementation", "impl.ts"),
        evidence: [{ kind: "check", checkId: "data-loss-check", artifact: "out.log" }],
      }],
    });
    const auth = authorityFor(manifest.digest);
    const disposition = buildFindingDispositionEnvelopeV1({
      manifest,
      batch,
      classification,
      protectedRiskAuthority: auth,
    });
    expect(() =>
      buildRoutingDecisionV1({
        batch,
        manifest,
        disposition,
        policy: basePolicy,
        protectedRiskAuthority: undefined,
      }),
    ).toThrow(/PROTECTED_RISK_AUTHORITY_AMBIGUOUS/);
    // With authority present, data-loss routes to escalate not targeted_repair
    const routed = buildRoutingDecisionV1({
      batch,
      manifest,
      disposition,
      policy: basePolicy,
      protectedRiskAuthority: auth,
    });
    expect(routed.routes[0]!.destination).toBe("escalate");
  });

  test("RED SEC-03: missing protected-risk authority at authoritative parse rejects", () => {
    const manifest = buildFailureManifestV1({
      schema: "failure-manifest-v1",
      changeId: batch.changeId,
      batch,
      producerRole: "verify",
      producerInstanceId: "v1",
      producedAt: "2026-07-17T00:00:00Z",
      findings: [finding("implementation", "impl.ts")],
    });
    const auth = authorityFor(manifest.digest);
    const disposition = buildFindingDispositionEnvelopeV1({
      manifest,
      batch,
      classification,
      protectedRiskAuthority: auth,
    });
    const decision = buildRoutingDecisionV1({
      batch,
      manifest,
      disposition,
      policy: basePolicy,
      protectedRiskAuthority: auth,
    });
    // Explicit undefined authority argument triggers mandatory authority gate
    expect(() =>
      parseRoutingDecisionV1(decision, manifest, disposition, batch, basePolicy, undefined),
    ).toThrow(/PROTECTED_RISK_AUTHORITY_AMBIGUOUS/);
  });
});
