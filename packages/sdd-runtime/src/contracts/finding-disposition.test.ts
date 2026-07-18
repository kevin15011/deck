import { describe, expect, test } from "bun:test";
import { buildApplyBatchContractV1 } from "./apply-batch";
import { buildFailureManifestV1, type FailureFindingInputV1 } from "./failure-manifest";
import { sha256Digest } from "./canonical";
import {
  buildFindingDispositionEnvelopeV1,
  computeProtectedRiskPolicyAuthorityDigestV1,
  computeProtectedRiskPolicySnapshotDigestV1,
  deriveProtectedRiskV1,
  parseFindingDispositionEnvelopeV1,
  projectFindingDispositionV1,
  type DispositionClassificationInputV1,
  type FindingDispositionEntryV1,
  type ProtectedRiskAuthorityContextV1,
} from "./finding-disposition";

const DIGEST_A = `sha256:${"a".repeat(64)}` as const;
const DIGEST_B = `sha256:${"b".repeat(64)}` as const;

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
  taskIds: ["T-01"],
  dependencies: [],
  ownerRole: "apply-backend",
  allowedTargets: ["packages/sdd-runtime/src/contracts/finding-disposition.ts"],
  blockedTargets: ["packages/sdd-runtime/src/contracts/failure-manifest.ts"],
  acceptanceObligations: ["REQ-DAVR-FD-01"],
  verificationPlan: [{ stage: "targeted", checkIds: ["unit"] }],
  artifactDigests: { "protected-risk-policy": PROTECTED_RISK_POLICY_DIGEST },
  authorizationGrantRef: DIGEST_A,
  provenance: { actor: "apply-backend", issuedAt: "2026-07-17T00:00:00Z" },
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
    requirementIds: ["REQ-DAVR-FD-01"],
    taskIds: ["T-01"],
    locationKeys: ["finding-disposition.ts"],
    oracleId: "unit",
    isSecurityRelevant: false,
    status: "open",
    relationship: "batch_related",
    evidence: [{ kind: "check", checkId: "unit", artifact: "out.log" }],
    ...overrides,
  };
}

function manifest(findings: FailureFindingInputV1[]) {
  return buildFailureManifestV1({
    schema: "failure-manifest-v1",
    changeId: batch.changeId,
    batch,
    producerRole: "verify",
    producerInstanceId: "verify-1",
    producedAt: "2026-07-17T00:00:00Z",
    findings,
  });
}


function makeAuthority(
  m: ReturnType<typeof manifest>,
  overrides: Partial<ProtectedRiskAuthorityContextV1> = {},
): ProtectedRiskAuthorityContextV1 {
  const base = {
    batchDigest: batch.digest,
    manifestDigest: m.digest,
    classificationPolicyVersion: emptyPolicy.classificationPolicyVersion,
    routingPolicyVersion: "routing-decision-policy-v1",
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
  const { policySnapshotDigest: _drop, ...forSnapshot } = base as any;
  return {
    ...forSnapshot,
    policySnapshotDigest: computeProtectedRiskPolicySnapshotDigestV1(forSnapshot),
  };
}

const emptyPolicy: DispositionClassificationInputV1 = {
  classificationPolicyVersion: "finding-disposition-policy-v1",
  baselineFingerprints: [],
  deferPolicyRefs: {},
  advisoryCheckIds: [],
  mandatoryRequirementIds: ["REQ-DAVR-FD-01"],
  mandatoryTaskIds: ["T-01"],
  mandatoryCheckIds: ["unit"],
};

describe("FindingDispositionEnvelopeV1", () => {
  test("reaches all four dispositions with one entry per finding", () => {
    const m = manifest([
      finding({ category: "impl", locationKeys: ["a.ts"] }),
      finding({
        category: "baseline",
        status: "pre_existing",
        relationship: "unrelated_baseline",
        locationKeys: ["b.ts"],
        evidence: [{ kind: "baseline", checkId: "baseline", artifact: "baseline.yaml", resultCode: "known" }],
      }),
      finding({
        category: "advice",
        locationKeys: ["c.ts"],
        requirementIds: [],
        taskIds: [],
        evidence: [{ kind: "check", checkId: "lint-style", artifact: "lint.log" }],
      }),
      finding({
        category: "defer",
        locationKeys: ["d.ts"],
        requirementIds: ["REQ-OPTIONAL"],
        taskIds: ["T-OPT"],
        evidence: [{ kind: "check", checkId: "optional-check", artifact: "optional.log" }],
      }),
    ]);
    const baselineFinding = m.findings.find((f) => f.relationship === "unrelated_baseline")!;
    const adviceFinding = m.findings.find((f) => f.category === "advice")!;
    const deferFinding = m.findings.find((f) => f.category === "defer")!;
    const policy: DispositionClassificationInputV1 = {
      ...emptyPolicy,
      baselineFingerprints: [baselineFinding.fingerprint],
      advisoryCheckIds: ["lint-style"],
      deferPolicyRefs: {
        [deferFinding.findingId]: "defer:policy:optional-non-mandatory",
      },
    };
    const envelope = buildFindingDispositionEnvelopeV1({ manifest: m, batch, classification: policy, protectedRiskAuthority: makeAuthority(m) });
    const dispositions = new Set(envelope.entries.map((e) => e.disposition));
    expect(dispositions).toEqual(new Set(["blocking", "recommendation", "deferred", "pre-existing"]));
    expect(envelope.entries).toHaveLength(4);
    expect(envelope.entries.map((e) => e.findingId)).toEqual(
      [...m.findings].sort((a, b) => a.findingId.localeCompare(b.findingId)).map((f) => f.findingId),
    );
    expect(adviceFinding).toBeDefined();
  });

  test("classification is stable across prose, producer identity, and timestamps", () => {
    const f = finding({ summary: "first wording", severity: "low" });
    const one = manifest([f]);
    const two = buildFailureManifestV1({
      schema: "failure-manifest-v1",
      changeId: batch.changeId,
      batch,
      producerRole: "review",
      producerInstanceId: "review-other",
      producedAt: "2026-07-18T00:00:00Z",
      findings: [{ ...f, summary: "different wording", severity: "high", sourcePhase: "review" }],
    });
    const e1 = buildFindingDispositionEnvelopeV1({ manifest: one, batch, classification: emptyPolicy, protectedRiskAuthority: makeAuthority(one) });
    const e2 = buildFindingDispositionEnvelopeV1({ manifest: two, batch, classification: emptyPolicy, protectedRiskAuthority: makeAuthority(two) });
    expect(e1.entries[0]!.disposition).toBe(e2.entries[0]!.disposition);
    expect(e1.entries[0]!.findingId).toBe(e2.entries[0]!.findingId);
    expect(e1.semanticDigest).toBe(e2.semanticDigest);
    expect(one.findings[0]!.findingId).toBe(two.findings[0]!.findingId);
  });

  test("ambiguous findings default to blocking", () => {
    const m = manifest([finding()]);
    const disposition = projectFindingDispositionV1(m.findings[0]!, emptyPolicy);
    expect(disposition.disposition).toBe("blocking");
    expect(disposition.classificationReasonCode).toBe("AMBIGUOUS_OR_ACTIVE_BLOCKING");
  });

  test("V1 baseline projects to pre-existing without changing finding id or manifest digest", () => {
    const m = manifest([
      finding({
        status: "pre_existing",
        relationship: "unrelated_baseline",
        evidence: [{ kind: "baseline", checkId: "baseline", artifact: "baseline.yaml", resultCode: "known" }],
      }),
    ]);
    const beforeDigest = m.digest;
    const beforeId = m.findings[0]!.findingId;
    const envelope = buildFindingDispositionEnvelopeV1({
      manifest: m,
      batch,
      classification: {
        ...emptyPolicy,
        baselineFingerprints: [m.findings[0]!.fingerprint],
      },
      protectedRiskAuthority: makeAuthority(m),
    });
    expect(envelope.entries[0]!.disposition).toBe("pre-existing");
    expect(m.digest).toBe(beforeDigest);
    expect(m.findings[0]!.findingId).toBe(beforeId);
    expect(envelope.manifestDigest).toBe(beforeDigest);
  });

  test("rejects missing, duplicate, or foreign finding IDs", () => {
    const m = manifest([finding()]);
    const good = buildFindingDispositionEnvelopeV1({ manifest: m, batch, classification: emptyPolicy, protectedRiskAuthority: makeAuthority(m) });
    expect(() =>
      parseFindingDispositionEnvelopeV1(
        {
          ...good,
          entries: [],
        },
        m,
        batch,
        emptyPolicy,
        makeAuthority(m),
      ),
    ).toThrow("invalid-evidence");
    expect(() =>
      parseFindingDispositionEnvelopeV1(
        {
          ...good,
          entries: [
            good.entries[0]!,
            { ...good.entries[0]!, findingId: "finding:v1:deadbeefdeadbeefdeadbeefdeadbeef" as const },
          ],
        },
        m,
        batch,
        emptyPolicy,
        makeAuthority(m),
      ),
    ).toThrow("invalid-evidence");
  });

  test("rejects validly rehashed disposition that downgrades a mandatory open blocker", () => {
    const m = manifest([finding()]);
    const good = buildFindingDispositionEnvelopeV1({ manifest: m, batch, classification: emptyPolicy, protectedRiskAuthority: makeAuthority(m) });
    expect(good.entries[0]!.disposition).toBe("blocking");
    expect(good.entries[0]!.classificationReasonCode).toBe("AMBIGUOUS_OR_ACTIVE_BLOCKING");

    const downgradedEntries: FindingDispositionEntryV1[] = good.entries.map((e) => ({
      findingId: e.findingId,
      disposition: "recommendation",
      requirementIds: e.requirementIds,
      taskIds: e.taskIds,
      checkIds: e.checkIds,
      classificationReasonCode: "ADVISORY_RECOMMENDATION",
    }));
    const semanticDigest = sha256Digest({
      classificationPolicyVersion: good.classificationPolicyVersion,
      changeId: good.changeId,
      batchDigest: good.batchDigest,
      entries: downgradedEntries.map((e) => ({
        findingId: e.findingId,
        disposition: e.disposition,
        requirementIds: e.requirementIds,
        taskIds: e.taskIds,
        checkIds: e.checkIds,
        classificationReasonCode: e.classificationReasonCode,
      })),
    });
    const payload = {
      schema: "finding-disposition-envelope-v1" as const,
      classificationPolicyVersion: good.classificationPolicyVersion,
      changeId: good.changeId,
      batchId: good.batchId,
      batchDigest: good.batchDigest,
      manifestDigest: good.manifestDigest,
      entries: downgradedEntries,
      semanticDigest,
    };
    const digest = sha256Digest(payload);
    const forged = {
      ...payload,
      envelopeId: `disposition:v1:${digest.slice(7, 39)}` as const,
      digest,
    };

    // Control: self-consistent content digests
    expect(forged.digest).toBe(sha256Digest(payload));
    expect(forged.entries[0]!.disposition).toBe("recommendation");

    expect(() => parseFindingDispositionEnvelopeV1(forged, m, batch, emptyPolicy, makeAuthority(m))).toThrow(
      "invalid-evidence",
    );
  });

  test("rejects non-disposition schema and preserves V1 identity on projection", () => {
    const m = manifest([finding()]);
    expect(() =>
      buildFindingDispositionEnvelopeV1({
        manifest: m,
        batch,
        classification: { ...emptyPolicy, classificationPolicyVersion: "" },
      } as never),
    ).toThrow();
    const envelope = buildFindingDispositionEnvelopeV1({ manifest: m, batch, classification: emptyPolicy, protectedRiskAuthority: makeAuthority(m) });
    expect(envelope.schema).toBe("finding-disposition-envelope-v1");
    expect(envelope.entries[0]!.findingId).toBe(m.findings[0]!.findingId);
    const parsed = parseFindingDispositionEnvelopeV1(envelope, m, batch, emptyPolicy, makeAuthority(m));
    expect(parsed.digest).toBe(envelope.digest);
    expect(Object.isFrozen(parsed)).toBe(true);
  });

  test("unrelated baseline cannot become blocking by severity alone", () => {
    const m = manifest([
      finding({
        severity: "critical",
        status: "pre_existing",
        relationship: "unrelated_baseline",
        isSecurityRelevant: false,
        evidence: [{ kind: "baseline", checkId: "baseline", artifact: "baseline.yaml", resultCode: "known" }],
      }),
    ]);
    const envelope = buildFindingDispositionEnvelopeV1({
      manifest: m,
      batch,
      classification: {
        ...emptyPolicy,
        baselineFingerprints: [m.findings[0]!.fingerprint],
      },
      protectedRiskAuthority: makeAuthority(m),
    });
    expect(envelope.entries[0]!.disposition).toBe("pre-existing");
  });

  function emptyAuthority(
    m: ReturnType<typeof manifest>,
    overrides: Partial<ProtectedRiskAuthorityContextV1> = {},
  ): ProtectedRiskAuthorityContextV1 {
    return makeAuthority(m, overrides);
  }

  test("RED/GREEN FD-03: security finding under advisory policy remains blocking", () => {
    const m = manifest([
      finding({
        rootCause: "security",
        isSecurityRelevant: true,
        requirementIds: [],
        taskIds: [],
        evidence: [{ kind: "check", checkId: "lint-style", artifact: "lint.log" }],
      }),
    ]);
    const policy: DispositionClassificationInputV1 = {
      ...emptyPolicy,
      advisoryCheckIds: ["lint-style"],
      mandatoryRequirementIds: [],
      mandatoryTaskIds: [],
      mandatoryCheckIds: [],
    };
    const envelope = buildFindingDispositionEnvelopeV1({
      manifest: m,
      batch,
      classification: policy,
      protectedRiskAuthority: emptyAuthority(m),
    });
    expect(envelope.entries[0]!.disposition).toBe("blocking");
    expect(deriveProtectedRiskV1(m.findings[0]!, emptyAuthority(m))).toBe("security");
  });

  test("RED/GREEN FD-03: data-loss authority blocks despite caller-omitted flags", () => {
    const m = manifest([
      finding({
        rootCause: "implementation",
        isSecurityRelevant: false,
        requirementIds: ["REQ-DATA-LOSS"],
        taskIds: ["T-01"],
        evidence: [{ kind: "check", checkId: "data-loss-check", artifact: "out.log" }],
      }),
    ]);
    const authority = emptyAuthority(m);
    const disposition = projectFindingDispositionV1(m.findings[0]!, emptyPolicy, authority);
    expect(disposition.disposition).toBe("blocking");
    expect(deriveProtectedRiskV1(m.findings[0]!, authority)).toBe("data_loss");
    // Caller false/omitted cannot clear: authority alone drives class
    expect(deriveProtectedRiskV1(m.findings[0]!, authority)).not.toBe("none");
  });

  test("RED FD-03: conflicting security root without security flag is ambiguous blocking", () => {
    const m = manifest([
      finding({
        rootCause: "security",
        isSecurityRelevant: false,
        requirementIds: [],
        taskIds: [],
        evidence: [{ kind: "check", checkId: "lint-style", artifact: "lint.log" }],
      }),
    ]);
    const policy: DispositionClassificationInputV1 = {
      ...emptyPolicy,
      advisoryCheckIds: ["lint-style"],
      mandatoryRequirementIds: [],
      mandatoryTaskIds: [],
      mandatoryCheckIds: [],
    };
    expect(deriveProtectedRiskV1(m.findings[0]!)).toBe("ambiguous");
    const envelope = buildFindingDispositionEnvelopeV1({ manifest: m, batch, classification: policy, protectedRiskAuthority: makeAuthority(m) });
    expect(envelope.entries[0]!.disposition).toBe("blocking");
  });

  test("RED SEC-03: forged security→recommendation envelope rejected at parse", () => {
    const m = manifest([
      finding({
        rootCause: "security",
        isSecurityRelevant: true,
      }),
    ]);
    const good = buildFindingDispositionEnvelopeV1({
      manifest: m,
      batch,
      classification: emptyPolicy,
      protectedRiskAuthority: emptyAuthority(m),
    });
    expect(good.entries[0]!.disposition).toBe("blocking");
    const downgradedEntries: FindingDispositionEntryV1[] = good.entries.map((e) => ({
      findingId: e.findingId,
      disposition: "recommendation",
      requirementIds: e.requirementIds,
      taskIds: e.taskIds,
      checkIds: e.checkIds,
      classificationReasonCode: "ADVISORY_RECOMMENDATION",
    }));
    const semanticDigest = sha256Digest({
      classificationPolicyVersion: good.classificationPolicyVersion,
      changeId: good.changeId,
      batchDigest: good.batchDigest,
      entries: downgradedEntries.map((e) => ({
        findingId: e.findingId,
        disposition: e.disposition,
        requirementIds: e.requirementIds,
        taskIds: e.taskIds,
        checkIds: e.checkIds,
        classificationReasonCode: e.classificationReasonCode,
      })),
    });
    const payload = {
      schema: "finding-disposition-envelope-v1" as const,
      classificationPolicyVersion: good.classificationPolicyVersion,
      changeId: good.changeId,
      batchId: good.batchId,
      batchDigest: good.batchDigest,
      manifestDigest: good.manifestDigest,
      entries: downgradedEntries,
      semanticDigest,
    };
    const digest = sha256Digest(payload);
    const forged = {
      ...payload,
      envelopeId: `disposition:v1:${digest.slice(7, 39)}` as const,
      digest,
    };
    expect(() =>
      parseFindingDispositionEnvelopeV1(forged, m, batch, emptyPolicy, emptyAuthority(m)),
    ).toThrow(/DISPOSITION_PROTECTED_RISK_MISMATCH|invalid-evidence/);
  });

  test("isSecurityRelevant baseline cannot remain pre-existing", () => {
    const m = manifest([
      finding({
        severity: "critical",
        status: "pre_existing",
        relationship: "unrelated_baseline",
        isSecurityRelevant: true,
        evidence: [{ kind: "baseline", checkId: "baseline", artifact: "baseline.yaml", resultCode: "known" }],
      }),
    ]);
    const envelope = buildFindingDispositionEnvelopeV1({
      manifest: m,
      batch,
      classification: {
        ...emptyPolicy,
        baselineFingerprints: [m.findings[0]!.fingerprint],
      },
      protectedRiskAuthority: makeAuthority(m),
    });
    expect(envelope.entries[0]!.disposition).toBe("blocking");
  });

  test("semanticDigest excludes producer identity and wall-clock timestamps", () => {
    const m1 = buildFailureManifestV1({
      schema: "failure-manifest-v1",
      changeId: batch.changeId,
      batch,
      producerRole: "verify",
      producerInstanceId: "a",
      producedAt: "2026-07-17T00:00:00Z",
      findings: [finding()],
    });
    const m2 = buildFailureManifestV1({
      schema: "failure-manifest-v1",
      changeId: batch.changeId,
      batch,
      producerRole: "review",
      producerInstanceId: "b",
      producedAt: "2026-07-19T00:00:00Z",
      findings: [finding({ sourcePhase: "review", summary: "other" })],
    });
    const e1 = buildFindingDispositionEnvelopeV1({ manifest: m1, batch, classification: emptyPolicy, protectedRiskAuthority: makeAuthority(m1) });
    const e2 = buildFindingDispositionEnvelopeV1({ manifest: m2, batch, classification: emptyPolicy, protectedRiskAuthority: makeAuthority(m2) });
    expect(e1.semanticDigest).toBe(e2.semanticDigest);
    expect(e1.digest).not.toBe(DIGEST_B);
  });
  test("RED EA-B1: omitted protected-risk authority rejects at authorizing disposition build", () => {
    const m = manifest([
      finding({
        rootCause: "implementation",
        isSecurityRelevant: false,
        requirementIds: ["REQ-DATA-LOSS"],
        evidence: [{ kind: "check", checkId: "data-loss-check", artifact: "out.log" }],
        taskIds: ["T-01"],
      }),
    ]);
    expect(() =>
      buildFindingDispositionEnvelopeV1({
        manifest: m,
        batch,
        classification: emptyPolicy,
        protectedRiskAuthority: undefined,
      }),
    ).toThrow(/PROTECTED_RISK_AUTHORITY_AMBIGUOUS/);
  });

  test("RED EA-B1: incomplete Spec/Design/Tasks artifact map rejects when batch binds them", () => {
    const batchWithArtifacts = buildApplyBatchContractV1({
      schema: "apply-batch-v1",
      changeId: "deterministic-apply-verify-review-flow",
      taskIds: ["T-01"],
      dependencies: [],
      ownerRole: "apply-backend",
      allowedTargets: ["packages/sdd-runtime/src/contracts/finding-disposition.ts"],
      blockedTargets: ["packages/sdd-runtime/src/contracts/failure-manifest.ts"],
      acceptanceObligations: ["REQ-DAVR-FD-01"],
      verificationPlan: [{ stage: "targeted", checkIds: ["unit"] }],
      artifactDigests: {
        spec: DIGEST_A,
        design: DIGEST_B,
        tasks: DIGEST_A,
        "protected-risk-policy": PROTECTED_RISK_POLICY_DIGEST,
      },
      authorizationGrantRef: DIGEST_A,
      provenance: { actor: "apply-backend", issuedAt: "2026-07-17T00:00:00Z" },
    });
    const m = buildFailureManifestV1({
      schema: "failure-manifest-v1",
      changeId: batchWithArtifacts.changeId,
      batch: batchWithArtifacts,
      producerRole: "verify",
      producerInstanceId: "verify-1",
      producedAt: "2026-07-17T00:00:00Z",
      findings: [
        {
          batchId: batchWithArtifacts.batchId,
          batchDigest: batchWithArtifacts.digest,
          sourcePhase: "verify",
          sourceArtifact: "verify.md",
          severity: "medium",
          category: "assertion",
          rootCause: "implementation",
          requirementIds: ["REQ-DAVR-FD-01"],
          taskIds: ["T-01"],
          locationKeys: ["finding-disposition.ts"],
          oracleId: "unit",
          isSecurityRelevant: false,
          status: "open",
          relationship: "batch_related",
          evidence: [{ kind: "check", checkId: "unit", artifact: "out.log" }],
        },
      ],
    });
    const incomplete = makeAuthority(m, { artifactDigests: {} });
    // rebuild authority with batch digest of new batch
    const base = {
      batchDigest: batchWithArtifacts.digest,
      manifestDigest: m.digest,
      classificationPolicyVersion: emptyPolicy.classificationPolicyVersion,
      routingPolicyVersion: "routing-decision-policy-v1",
      artifactDigests: {},
      mandatorySecurityRequirementIds: [],
      mandatorySecurityTaskIds: [],
      mandatorySecurityCheckIds: [],
      mandatorySecurityOracleIds: [],
      mandatoryDataLossRequirementIds: [],
      mandatoryDataLossTaskIds: [],
      mandatoryDataLossCheckIds: [],
      mandatoryDataLossOracleIds: [],
    };
    const auth = {
      ...base,
      policySnapshotDigest: computeProtectedRiskPolicySnapshotDigestV1(base),
    };
    expect(() =>
      buildFindingDispositionEnvelopeV1({
        manifest: m,
        batch: batchWithArtifacts,
        classification: emptyPolicy,
        protectedRiskAuthority: auth,
      }),
    ).toThrow(/PROTECTED_RISK_AUTHORITY_AMBIGUOUS/);
  });

  test("GREEN EA-B1: complete artifact bindings + data-loss policy classifies blocking", () => {
    const m = manifest([
      finding({
        rootCause: "implementation",
        isSecurityRelevant: false,
        requirementIds: ["REQ-DATA-LOSS"],
        taskIds: ["T-01"],
        evidence: [{ kind: "check", checkId: "data-loss-check", artifact: "out.log" }],
      }),
    ]);
    const auth = makeAuthority(m);
    const envelope = buildFindingDispositionEnvelopeV1({
      manifest: m,
      batch,
      classification: emptyPolicy,
      protectedRiskAuthority: auth,
    });
    expect(envelope.entries[0]!.disposition).toBe("blocking");
    expect(deriveProtectedRiskV1(m.findings[0]!, auth)).toBe("data_loss");
  });

  test("RED EA-B1: a rehashed stripped policy cannot replace the batch-authoritative policy", () => {
    const m = manifest([
      finding({
        rootCause: "implementation",
        isSecurityRelevant: false,
        requirementIds: ["REQ-DATA-LOSS"],
        evidence: [{ kind: "check", checkId: "data-loss-check", artifact: "out.log" }],
      }),
    ]);
    const stripped = makeAuthority(m, { mandatoryDataLossCheckIds: [] });
    const { policySnapshotDigest: _snapshot, ...strippedPolicy } = stripped;
    expect(stripped.policySnapshotDigest).toBe(
      computeProtectedRiskPolicySnapshotDigestV1(strippedPolicy),
    );
    expect(() =>
      buildFindingDispositionEnvelopeV1({
        manifest: m,
        batch,
        classification: emptyPolicy,
        protectedRiskAuthority: stripped,
      }),
    ).toThrow(/PROTECTED_RISK_AUTHORITY_AMBIGUOUS/);
  });

});
