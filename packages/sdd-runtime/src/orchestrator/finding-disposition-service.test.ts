import { describe, expect, test } from "bun:test";
import { buildApplyBatchContractV1 } from "../contracts/apply-batch";
import { sha256Digest } from "../contracts/canonical";
import { buildFailureManifestV1, type FailureFindingInputV1 } from "../contracts/failure-manifest";
import { buildFindingDispositionEnvelopeV1, computeProtectedRiskPolicyAuthorityDigestV1, computeProtectedRiskPolicySnapshotDigestV1, type DispositionClassificationInputV1, type ProtectedRiskAuthorityContextV1 } from "../contracts/finding-disposition";
import { buildBaselineEvidenceEnvelopeV1 } from "../contracts/baseline-evidence";
import { evaluateFindingDispositionBaselineV1 } from "./finding-disposition-service";
import { evidenceInput } from "../contracts/baseline-evidence.test";

const d = (value: string) => sha256Digest(value);
const protectedPolicy = { classificationPolicyVersion: "finding-disposition-policy-v1", routingPolicyVersion: "routing-decision-policy-v1", mandatorySecurityRequirementIds: [] as string[], mandatorySecurityTaskIds: [] as string[], mandatorySecurityCheckIds: [] as string[], mandatorySecurityOracleIds: [] as string[], mandatoryDataLossRequirementIds: [] as string[], mandatoryDataLossTaskIds: [] as string[], mandatoryDataLossCheckIds: [] as string[], mandatoryDataLossOracleIds: [] as string[] };
const batch = buildApplyBatchContractV1({
  schema: "apply-batch-v1", changeId: "baseline-quality", taskIds: ["T06"], dependencies: [], ownerRole: "apply-backend",
  allowedTargets: ["packages/sdd-runtime/src/contracts/baseline-evidence.ts"], blockedTargets: ["openspec/baseline-health.yaml"],
  acceptanceObligations: ["REQ-019"], verificationPlan: [{ stage: "targeted", checkIds: ["unit"] }], artifactDigests: { "protected-risk-policy": computeProtectedRiskPolicyAuthorityDigestV1(protectedPolicy) },
  authorizationGrantRef: d("grant"), provenance: { actor: "orchestrator", issuedAt: "2026-07-01T00:00:00Z" },
});
const policy: DispositionClassificationInputV1 = { classificationPolicyVersion: "finding-disposition-policy-v1", baselineFingerprints: [], deferPolicyRefs: {}, advisoryCheckIds: [], mandatoryRequirementIds: ["REQ-019"], mandatoryTaskIds: ["T06"], mandatoryCheckIds: ["unit"] };

function finding(overrides: Partial<FailureFindingInputV1> = {}): FailureFindingInputV1 {
  return { batchId: batch.batchId, batchDigest: batch.digest, sourcePhase: "verify", sourceArtifact: "verify.md", severity: "medium", category: "assertion", rootCause: "environment", requirementIds: ["REQ-019"], taskIds: ["T06"], locationKeys: ["packages/sdd-runtime/src/example.test.ts"], oracleId: "bun-test", isSecurityRelevant: false, status: "pre_existing", relationship: "unrelated_baseline", evidence: [{ kind: "raw", checkId: "unit", artifact: "targeted.log", resultCode: "failed" }], ...overrides };
}

function manifest(findings: FailureFindingInputV1[]) { return buildFailureManifestV1({ schema: "failure-manifest-v1", changeId: batch.changeId, batch, producerRole: "verify", producerInstanceId: "verify-manifest", findings, producedAt: "2026-07-20T00:00:00Z" }); }
function baselineInput() { const value = evidenceInput(); return { ...value, candidateSubject: { ...value.candidateSubject, batchId: batch.batchId, batchDigest: batch.digest } }; }
function authority(m: ReturnType<typeof manifest>): ProtectedRiskAuthorityContextV1 {
  const value = { batchDigest: batch.digest, manifestDigest: m.digest, classificationPolicyVersion: policy.classificationPolicyVersion, routingPolicyVersion: "routing-decision-policy-v1", artifactDigests: {}, mandatorySecurityRequirementIds: [], mandatorySecurityTaskIds: [], mandatorySecurityCheckIds: [], mandatorySecurityOracleIds: [], mandatoryDataLossRequirementIds: [], mandatoryDataLossTaskIds: [], mandatoryDataLossCheckIds: [], mandatoryDataLossOracleIds: [] };
  return { ...value, policySnapshotDigest: computeProtectedRiskPolicySnapshotDigestV1(value) };
}
function input(overrides: Record<string, unknown> = {}) {
  const m = manifest([finding()]);
  const disposition = buildFindingDispositionEnvelopeV1({ manifest: m, batch, classification: { ...policy, baselineFingerprints: [m.findings[0]!.fingerprint] }, protectedRiskAuthority: authority(m) });
  const evidence = buildBaselineEvidenceEnvelopeV1(baselineInput());
  const { producedAt: _producedAt, expiresAt: _expiresAt, invalidationTriggers: _invalidationTriggers, ...currentEvidenceBindings } = evidence.freshness;
  return {
    schema: "finding-disposition-baseline-evaluation-v1", batch, manifest: m, findingDisposition: disposition,
    verificationDigest: d("verification"), baselineEvidence: [{ findingId: m.findings[0]!.findingId, evidence }],
    mandatoryExecution: ["targeted", "affected_area", "independent_review", "broad"].map((stage, index) => ({ stage, status: "completed", producerInstanceId: `qa-${index}`, producedAt: `2026-07-2${index}T00:00:00Z`, evidenceDigest: d(stage) })),
    currentEvidenceBindings,
    producerRole: "verify", producerInstanceId: "quality-verify", producedAt: "2026-07-24T00:00:00Z", now: "2026-07-24T00:00:00Z", ...overrides,
  };
}

describe("evaluateFindingDispositionBaselineV1", () => {
  test("returns passed_with_warnings while retaining the raw finding", () => {
    const result = evaluateFindingDispositionBaselineV1(input());
    expect(result.qualityDisposition.status).toBe("passed_with_warnings");
    expect(result.stageStatus).toBe("passed");
    expect(result.qualityDisposition.warningFindingIds).toHaveLength(1);
    expect(result.rawFindings).toHaveLength(1);
    expect(result.qualityDisposition.blockingFindingIds).toEqual([]);
    expect(evaluateFindingDispositionBaselineV1(input()).qualityDisposition.digest).toBe(result.qualityDisposition.digest);
  });

  test("preserves all-green compatibility without baseline evidence", () => {
    const value = input();
    const m = manifest([]);
    const disposition = buildFindingDispositionEnvelopeV1({ manifest: m, batch, classification: policy, protectedRiskAuthority: authority(m) });
    const result = evaluateFindingDispositionBaselineV1({ ...value, manifest: m, findingDisposition: disposition, baselineEvidence: [] });
    expect(result.qualityDisposition.status).toBe("passed");
    expect(result.rawFindings).toEqual([]);
  });

  test("blocks insufficient deterministic evidence", () => {
    const value = input();
    const entry = value.baselineEvidence[0]!;
    const raw = baselineInput();
    const evidence = buildBaselineEvidenceEnvelopeV1({ ...raw, baselineObservations: raw.baselineObservations.slice(0, 1) });
    expect(evaluateFindingDispositionBaselineV1({ ...value, baselineEvidence: [{ ...entry, evidence }] }).qualityDisposition.status).toBe("failed");
  });

  test("blocks protected pre-existing findings regardless of durable evidence", () => {
    const base = input();
    const m = manifest([finding({ rootCause: "security", isSecurityRelevant: true })]);
    const disposition = buildFindingDispositionEnvelopeV1({ manifest: m, batch, classification: { ...policy, baselineFingerprints: [m.findings[0]!.fingerprint] }, protectedRiskAuthority: authority(m) });
    expect(evaluateFindingDispositionBaselineV1({ ...base, manifest: m, findingDisposition: disposition, baselineEvidence: [{ findingId: m.findings[0]!.findingId, evidence: base.baselineEvidence[0]!.evidence }] }).qualityDisposition.status).toBe("failed");
  });

  test("enforces flaky five-run threshold and fourteen-day expiry", () => {
    const value = input();
    const raw = baselineInput();
    const runs = (subjectDigest: `sha256:${string}`, matches: number) => [1, 2, 3, 4, 5].map((runIndex) => ({ ...raw.candidateObservations[0]!, runIndex, subjectDigest, outcome: runIndex <= matches ? "matched" as const : "not_matched" as const, normalizedFingerprint: runIndex <= matches ? raw.normalizedFingerprint : undefined }));
    const below = buildBaselineEvidenceEnvelopeV1({ ...raw, findingMode: "flaky", baselineObservations: runs(raw.baselineSubject.digest, 2), candidateObservations: runs(raw.candidateSubject.treeDigest, 3), nonRegression: { ...raw.nonRegression, baselineOccurrenceCount: 2, candidateOccurrenceCount: 3 } });
    expect(evaluateFindingDispositionBaselineV1({ ...value, baselineEvidence: [{ findingId: value.manifest.findings[0]!.findingId, evidence: below }] }).qualityDisposition.status).toBe("failed");
    const valid = buildBaselineEvidenceEnvelopeV1({ ...raw, findingMode: "flaky", baselineObservations: runs(raw.baselineSubject.digest, 4), candidateObservations: runs(raw.candidateSubject.treeDigest, 3), nonRegression: { ...raw.nonRegression, baselineOccurrenceCount: 4, candidateOccurrenceCount: 3 } });
    expect(evaluateFindingDispositionBaselineV1({ ...value, baselineEvidence: [{ findingId: value.manifest.findings[0]!.findingId, evidence: valid }], now: "2026-08-04T00:00:00Z" }).qualityDisposition.status).toBe("failed");
  });

  test("isolates platform cohorts", () => {
    const value = input();
    const raw = baselineInput();
    const evidence = { ...buildBaselineEvidenceEnvelopeV1(raw), environmentEquivalence: { ...raw.environmentEquivalence, candidate: { ...raw.environmentEquivalence.candidate, cohort: { ...raw.environmentEquivalence.candidate.cohort, os: "darwin", arch: "arm64" } } } };
    expect(evaluateFindingDispositionBaselineV1({ ...value, baselineEvidence: [{ findingId: value.manifest.findings[0]!.findingId, evidence }] }).qualityDisposition.status).toBe("failed");
  });

  test("accepts durable baseline-half reuse but blocks causality and metric regression", () => {
    const value = input();
    const raw = baselineInput();
    const reused = buildBaselineEvidenceEnvelopeV1({ ...raw, baselineObservations: [], ledgerAuthority: { ...raw.ledgerAuthority, replacesBaselineRuns: true } });
    const reusedResult = evaluateFindingDispositionBaselineV1({ ...value, baselineEvidence: [{ findingId: value.manifest.findings[0]!.findingId, evidence: reused }] });
    expect(reusedResult.decisions[0]!.reasonCode).toBe("PROVEN_UNRELATED_BASELINE");
    expect(reusedResult.qualityDisposition.status).toBe("passed_with_warnings");
    const related = buildBaselineEvidenceEnvelopeV1({ ...raw, causalIsolation: { ...raw.causalIsolation, credibleCausalPath: true } });
    expect(evaluateFindingDispositionBaselineV1({ ...value, baselineEvidence: [{ findingId: value.manifest.findings[0]!.findingId, evidence: related }] }).decisions[0]!.reasonCode).toBe("CAUSALLY_RELATED");
    const slower = buildBaselineEvidenceEnvelopeV1({ ...raw, nonRegression: { ...raw.nonRegression, candidateDurationMs: 101, candidateResourceUnits: 11 } });
    expect(evaluateFindingDispositionBaselineV1({ ...value, baselineEvidence: [{ findingId: value.manifest.findings[0]!.findingId, evidence: slower }] }).decisions[0]!.reasonCode).toBe("WORSENED_OR_WEAKENED");
  });

  test("invalidates durable evidence when any current binding changes", () => {
    const value = input();
    const result = evaluateFindingDispositionBaselineV1({ ...value, currentEvidenceBindings: { ...value.currentEvidenceBindings, oracleDigest: d("new-oracle") } });
    expect(result.qualityDisposition.status).toBe("failed");
    expect(result.decisions[0]!.reasonCode).toBe("STALE_EVIDENCE_BINDING");
  });

  test("rejects self-admission and stale producer identity", () => {
    const value = input();
    const raw = baselineInput();
    const self = buildBaselineEvidenceEnvelopeV1({ ...raw, ledgerAuthority: { ...raw.ledgerAuthority, approvalCandidateDigest: raw.candidateSubject.treeDigest, approvalIdentity: "quality-verify" } });
    expect(evaluateFindingDispositionBaselineV1({ ...value, baselineEvidence: [{ findingId: value.manifest.findings[0]!.findingId, evidence: self }] }).qualityDisposition.status).toBe("failed");
    expect(() => evaluateFindingDispositionBaselineV1({ ...value, producerInstanceId: "qa-0" })).toThrow("invalid-evidence");
  });
});
