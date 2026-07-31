import { describe, expect, test } from "bun:test";
import { sha256Digest } from "../contracts/canonical";
import { buildCandidateRefV1 } from "../contracts/qa-authority";
import { buildBroadCausalDispositionEnvelopeV1, buildReviewConvergenceResultV1, parseBroadCausalDispositionEnvelopeV1 } from "./broad-causal-disposition";

const digest = (value: string) => sha256Digest(value);
const candidate = buildCandidateRefV1({ implementationDigest: digest("implementation"), treeDigest: digest("tree"), dependencySetDigest: digest("dependencies"), requirementsDigest: digest("requirements"), environmentDigest: digest("environment"), checkPlanDigest: digest("plan"), generation: 1 });
const findingId = `finding:v1:${digest("finding").slice(7, 39)}` as const;
const secondFindingId = `finding:v1:${digest("finding-2").slice(7, 39)}` as const;
const batchId = `batch:v1:${digest("batch").slice(7, 39)}` as const;
const baselineEvidenceDigest = digest("baseline-evidence");

function blockingQualityDisposition() {
  const payload = {
    schema: "quality-disposition-envelope-v1" as const,
    batchId,
    batchDigest: digest("batch"),
    manifestDigest: digest("manifest"),
    verificationDigest: digest("verification"),
    findingDispositionDigest: digest("finding-disposition"),
    baselineEvidenceDigests: [] as const,
    mandatoryExecutionComplete: true as const,
    status: "failed" as const,
    warningFindingIds: [] as const,
    blockingFindingIds: [findingId],
    producerRole: "orchestrator" as const,
    producerInstanceId: "quality-authority",
    producedAt: "2026-07-30T00:00:00.000Z",
  };
  return { ...payload, digest: sha256Digest(payload) };
}

function warningQualityDisposition() {
  const payload = {
    schema: "quality-disposition-envelope-v1" as const,
    batchId,
    batchDigest: digest("batch"),
    manifestDigest: digest("manifest"),
    verificationDigest: digest("verification"),
    findingDispositionDigest: digest("finding-disposition"),
    baselineEvidenceDigests: [baselineEvidenceDigest],
    mandatoryExecutionComplete: true as const,
    status: "passed_with_warnings" as const,
    warningFindingIds: [findingId],
    blockingFindingIds: [] as const,
    producerRole: "orchestrator" as const,
    producerInstanceId: "quality-authority",
    producedAt: "2026-07-30T00:00:00.000Z",
  };
  return { ...payload, digest: sha256Digest(payload) };
}

function binding(manifestDigest: `sha256:${string}`) {
  return {
    batchDigest: digest("batch"),
    generation: candidate.generation,
    implementationSubjectDigest: candidate.implementationDigest,
    dependencySetDigest: candidate.dependencySetDigest,
    broadStageJoinDigest: digest("broad-join"),
    broadManifestDigest: manifestDigest,
    protectedPolicyDigest: digest("protected-policy"),
  };
}

describe("BROAD causal disposition", () => {
  test("does not stabilize review until its frozen checklist and finding set are complete", () => {
    expect(() => buildReviewConvergenceResultV1({ candidate, checklistDigest: digest("checklist"), findingSetDigest: digest("set"), complete: false, findings: [] })).toThrow("REVIEW_FINDING_SET_INCOMPLETE");
  });

  test("fails closed unless every broad finding has one complete causal classification", () => {
    const findings = [{ findingId, status: "new" as const }];
    const review = buildReviewConvergenceResultV1({ candidate, checklistDigest: digest("checklist"), findingSetDigest: sha256Digest(findings), complete: true, findings });
    expect(() => buildBroadCausalDispositionEnvelopeV1({ candidate, binding: binding(digest("manifest")), review, qualityDisposition: blockingQualityDisposition(), broadFindingIds: [findingId, secondFindingId], entries: [{ findingId, classification: "unproven", evidenceDigests: [digest("evidence")] }] })).toThrow("BROAD_FINDING_SET_INCOMPLETE");
  });

  test("permits warnings only when the baseline evaluator and Review attestation agree", () => {
    const findings = [{ findingId, status: "persistent" as const }];
    const review = buildReviewConvergenceResultV1({ candidate, checklistDigest: digest("checklist"), findingSetDigest: sha256Digest(findings), complete: true, findings });
    const envelope = buildBroadCausalDispositionEnvelopeV1({
      candidate,
      binding: binding(digest("manifest")),
      review,
      qualityDisposition: warningQualityDisposition(),
      broadFindingIds: [findingId],
      entries: [{ findingId, classification: "non_candidate_residual", evidenceDigests: [baselineEvidenceDigest], complete: true, protected: false, baselineEvidenceDigest, residualRiskCode: "known-baseline", followUpRef: "baseline-follow-up" }],
    });
    expect(envelope.entries[0]?.kind).toBe("warning");
  });

  test("rejects a warning that Review did not identify as persistent", () => {
    const review = buildReviewConvergenceResultV1({ candidate, checklistDigest: digest("checklist"), findingSetDigest: sha256Digest([]), complete: true, findings: [] });
    expect(() => buildBroadCausalDispositionEnvelopeV1({
      candidate,
      binding: binding(digest("manifest")),
      review,
      qualityDisposition: warningQualityDisposition(),
      broadFindingIds: [findingId],
      entries: [{ findingId, classification: "non_candidate_residual", evidenceDigests: [baselineEvidenceDigest], complete: true, protected: false, baselineEvidenceDigest, residualRiskCode: "known-baseline", followUpRef: "baseline-follow-up" }],
    })).toThrow("BROAD_WARNING_EVIDENCE_INVALID");
  });

  test("does not let a caller label override a blocking baseline evaluation", () => {
    const findings = [{ findingId, status: "persistent" as const }];
    const review = buildReviewConvergenceResultV1({ candidate, checklistDigest: digest("checklist"), findingSetDigest: sha256Digest(findings), complete: true, findings });
    const envelope = buildBroadCausalDispositionEnvelopeV1({
      candidate,
      binding: binding(digest("manifest")),
      review,
      broadFindingIds: [findingId],
      qualityDisposition: blockingQualityDisposition(),
      entries: [{ findingId, classification: "non_candidate_residual", evidenceDigests: [digest("evidence")], complete: true, protected: false }],
    });

    expect(envelope.entries[0]?.kind).toBe("blocking");
    expect(envelope.entries[0]?.classification).toBe("unproven");
  });

  test("rejects self-consistent envelopes with noncanonical nested entries", () => {
    const findings = [{ findingId, status: "persistent" as const }];
    const review = buildReviewConvergenceResultV1({ candidate, checklistDigest: digest("checklist"), findingSetDigest: sha256Digest(findings), complete: true, findings });
    const envelope = buildBroadCausalDispositionEnvelopeV1({
      candidate,
      binding: binding(digest("manifest")),
      review,
      broadFindingIds: [findingId],
      qualityDisposition: blockingQualityDisposition(),
      entries: [{ findingId, classification: "unproven", evidenceDigests: [digest("evidence")], complete: true }],
    });
    const { digest: _digest, ...payload } = envelope;
    const forgedPayload = { ...payload, entries: [{ ...envelope.entries[0]!, injected: "accepted" }] };
    const forged = { ...forgedPayload, digest: sha256Digest(forgedPayload) };

    expect(() => parseBroadCausalDispositionEnvelopeV1(forged, candidate)).toThrow();
  });
});
