import { describe, expect, test } from "bun:test";

import { buildApplyBatchContractV1 } from "../contracts/apply-batch";
import { sha256Digest } from "../contracts/canonical";
import { createExecutionDossierV1 } from "../contracts/execution-dossier";
import { buildFailureManifestV1 } from "../contracts/failure-manifest";
import { buildCandidateRefV1, buildQaAuthoritySnapshotV1 } from "../contracts/qa-authority";
import { buildRegistryIntentV1 } from "../contracts/registry-intent";
import { buildVerificationCheckResultV1, buildVerificationStageExecutionPlanV1, buildVerificationWaveExecutionReceiptsV1, joinVerificationStageExecutionV1, type VerificationStageExecutionJoinV1 } from "../contracts/verification-stage-execution";
import { createQaConvergenceAuthorityFixtureV1 } from "../testing/qa-convergence-authority-fixture";
import { buildBroadCausalDispositionEnvelopeV1, buildReviewConvergenceResultV1 } from "./broad-causal-disposition";
import { decideQualityReadinessV1 } from "./quality-readiness";

const digest = (value: string) => sha256Digest(value);
const baselineEvidenceDigest = digest("baseline-evidence");
const registryBase = { stateDigest: digest("state"), eventsDigest: digest("events") };
const batch = buildApplyBatchContractV1({ schema: "apply-batch-v1", changeId: "quality-readiness", taskIds: ["T1"], dependencies: [], ownerRole: "apply-general", allowedTargets: ["packages/sdd-runtime"], blockedTargets: [], acceptanceObligations: ["REQ-1"], verificationPlan: [{ stage: "targeted", checkIds: ["unit"] }], artifactDigests: {}, authorizationGrantRef: digest("grant"), provenance: { actor: "orchestrator", issuedAt: "2026-07-30T00:00:00.000Z" } });
const broadManifest = buildFailureManifestV1({
  schema: "failure-manifest-v1",
  changeId: batch.changeId,
  batch,
  producerRole: "verify",
  producerInstanceId: "verify-broad",
  producedAt: "2026-07-30T00:00:00.000Z",
  findings: [{
    batchId: batch.batchId,
    batchDigest: batch.digest,
    sourcePhase: "verify",
    sourceArtifact: "broad.log",
    severity: "medium",
    category: "assertion",
    rootCause: "environment",
    requirementIds: ["REQ-1"],
    taskIds: ["T1"],
    locationKeys: ["packages/sdd-runtime"],
    oracleId: "broad-check",
    isSecurityRelevant: false,
    status: "pre_existing",
    relationship: "unrelated_baseline",
    evidence: [{ kind: "raw", checkId: "broad-check", artifact: "broad.log", resultCode: "failed" }],
  }],
});
const findingId = broadManifest.findings[0]!.findingId;
const intent = buildRegistryIntentV1({
  schema: "registry-intent-v1",
  idempotencyKey: digest("quality-follow-up"),
  changeId: batch.changeId,
  batchId: batch.batchId,
  batchDigest: batch.digest,
  base: registryBase,
  phase: "verify",
  status: "passed_with_warnings",
  artifact: { kind: "warning-follow-up", path: "follow-up.md", digest: digest("follow-up") },
  provenance: { agent: "orchestrator", model: "test", timestamp: "2026-07-30T00:00:00.000Z" },
  event: { name: "quality.warning-recorded", actor: "orchestrator", timestamp: "2026-07-30T00:00:00.000Z", notes: [findingId] },
});
const candidate = buildCandidateRefV1({ generation: 1, implementationDigest: digest("implementation"), treeDigest: digest("tree"), dependencySetDigest: digest("dependencies"), requirementsDigest: digest("requirements"), environmentDigest: digest("environment"), checkPlanDigest: digest("plan") });
const dossier = createExecutionDossierV1({ schema: "execution-dossier-v1", batch, currentManifest: broadManifest, lane: { schema: "lane-decision-v1", lane: "guarded", riskScore: 1, floorReasons: [], policyOverrides: [], shadowOnly: false }, verification: { schema: "staged-verification-state-v1", batchId: batch.batchId, stages: [] }, causalContext: { schema: "causal-context-v1", batchDigest: batch.digest, priorDecisionDigests: [], activeFindingIds: [], evidenceRefs: [], attemptSummaries: [] }, registryIntents: [intent] });
const reviewFindings = [{ findingId, status: "persistent" as const }];
const review = buildReviewConvergenceResultV1({ candidate, checklistDigest: sha256Digest({ candidateCheckPlanDigest: candidate.checkPlanDigest, reviewCheckIds: ["architecture-review", "security-review"] }), findingSetDigest: sha256Digest(reviewFindings), complete: true, findings: reviewFindings });

function completedJoin(name: string, rawFailureManifestDigest?: `sha256:${string}`): Exclude<VerificationStageExecutionJoinV1, { status: "incomplete" }> {
  const stage = name.startsWith("affected") ? "affected_area" as const : name.startsWith("broad") ? "broad" as const : "targeted" as const;
  const plan = buildVerificationStageExecutionPlanV1({
    stage,
    qaAuthorityDigest: digest(`${name}-authority`),
    generation: candidate.generation,
    implementationSubjectDigest: candidate.implementationDigest,
    dependencySetDigest: candidate.dependencySetDigest,
    checks: [{ checkId: `${name}-check`, capabilityDigest: digest(`${name}-capability`), commandPlanDigest: digest(`${name}-command`), effectProfile: { kind: "repository_read_only" }, dependencyCheckIds: [], exclusiveResourceKeys: [] }],
  });
  const result = buildVerificationCheckResultV1(plan, { checkId: `${name}-check`, producerIdentityDigest: digest(`${name}-producer`), outcome: { kind: "completed", status: "passed", evidence: [] } });
  const executionIdentityDigest = digest(`${name}-executor`);
  const receipts = buildVerificationWaveExecutionReceiptsV1(plan, [result], executionIdentityDigest);
  const joined = joinVerificationStageExecutionV1(plan, [result], rawFailureManifestDigest, receipts, executionIdentityDigest);
  if (joined.status === "incomplete") throw new Error("completed join required");
  return joined;
}

const targetedJoin = completedJoin("targeted");
const affectedAreaJoin = completedJoin("affected-area");
const broadJoin = completedJoin("broad", broadManifest.digest);
const roleResultDigests = { targeted: digest("targeted-role-result"), affectedArea: digest("affected-role-result"), review: digest("review-role-result"), broad: digest("broad-role-result") };

function evidence() {
  const qualityPayload = {
    schema: "quality-disposition-envelope-v1" as const,
    batchId: batch.batchId,
    batchDigest: batch.digest,
    manifestDigest: broadManifest.digest,
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
  const qualityDisposition = { ...qualityPayload, digest: sha256Digest(qualityPayload) };
  const disposition = buildBroadCausalDispositionEnvelopeV1({
    candidate,
    binding: { batchDigest: batch.digest, generation: candidate.generation, implementationSubjectDigest: candidate.implementationDigest, dependencySetDigest: candidate.dependencySetDigest, broadStageJoinDigest: broadJoin.digest, broadManifestDigest: broadManifest.digest, protectedPolicyDigest: digest("protected-policy") },
    review,
    qualityDisposition,
    broadFindingIds: [findingId],
    entries: [{ findingId, classification: "non_candidate_residual", evidenceDigests: [baselineEvidenceDigest], complete: true, protected: false, baselineEvidenceDigest, residualRiskCode: "known-baseline", followUpRef: intent.intentId }],
  });
  return { qualityDisposition, disposition };
}

function authority(lifecycle: "broad_pending" | "registry_commit_pending", broadDigest?: `sha256:${string}`) {
  const convergence = createQaConvergenceAuthorityFixtureV1({
    baseDossier: dossier,
    lifecycle,
    implementationSubjectDigest: candidate.implementationDigest,
    dependencySetDigest: candidate.dependencySetDigest,
    reviewDigest: review.digest,
    stageEvidenceDigests: { targeted: targetedJoin.digest, affected_area: affectedAreaJoin.digest, broad: broadJoin.digest },
    roleResultEnvelopeDigests: { targeted: roleResultDigests.targeted, affected_area: roleResultDigests.affectedArea, review: roleResultDigests.review, broad: roleResultDigests.broad },
    stageVerificationDigests: { broad: digest("verification") },
    registryIntentDigests: [intent.digest],
    ...(lifecycle === "registry_commit_pending" ? { broadDigest } : {}),
  });
  return buildQaAuthoritySnapshotV1({ candidate, changeId: batch.changeId, convergence, freshness: { applyInstanceIds: ["apply-1"], verifyInstanceId: "verify-2", reviewInstanceId: "review-2", priorVerifyInstanceId: "verify-1", priorReviewInstanceId: "review-1", codeModifiedAfterVerify: true, reviewRequired: true, freshReviewTriggers: [], capabilities: { freshAgentScheduling: true, roleIsolation: true } }, executionDossierDigest: dossier.digest, stagedVerificationDigest: dossier.verification.digest, protectedPolicyDigest: digest("protected-policy"), registryBase });
}

function readinessInput(lifecycle: "broad_pending" | "registry_commit_pending") {
  const { qualityDisposition, disposition } = evidence();
  return {
    authority: authority(lifecycle, disposition.digest),
    currentCandidate: candidate,
    batch,
    review,
    targetedJoin,
    affectedAreaJoin,
    broadJoin,
    broadManifest,
    qualityDisposition,
    disposition,
    roleResultDigests,
    orderedIntents: [intent],
  };
}

describe("quality readiness", () => {
  test("allows one exact ordered registry chain only after every current QA join", () => {
    const result = decideQualityReadinessV1(readinessInput("registry_commit_pending"));
    expect(result.kind).toBe("registry_commit_ready");
    if (result.kind !== "registry_commit_ready") throw new Error("expected readiness");
    expect(result.phaseStatus).toBe("passed_with_warnings");
    expect(result.warningFindingIds).toEqual([findingId]);
  });

  test("blocks readiness before registry commit or when an exact join is substituted", () => {
    expect(decideQualityReadinessV1(readinessInput("broad_pending")).kind).toBe("invalid_evidence");
    expect(decideQualityReadinessV1({ ...readinessInput("registry_commit_pending"), targetedJoin: completedJoin("forged-targeted") }).kind).toBe("invalid_evidence");
  });
});
