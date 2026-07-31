import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";

import { buildApplyBatchContractV1 } from "../contracts/apply-batch";
import { createExecutionDossierV1 } from "../contracts/execution-dossier";
import { buildStagedVerificationStateV1 } from "../contracts/verification-state";
import { buildCandidateRefV1, buildQaAuthoritySnapshotV1 } from "../contracts/qa-authority";
import { buildVerificationCheckResultV1, buildVerificationStageExecutionPlanV1, buildVerificationWaveExecutionReceiptsV1, joinVerificationStageExecutionV1 } from "../contracts/verification-stage-execution";
import type { FreshnessPolicyInputV1 } from "../orchestrator/freshness-policy";
import {
  bindExecutionPlanQaAuthorityV1,
  consumeExecutionRoleResultV1,
  planExecutionDecisionV1,
  scheduleExecutionRoleInvocationV1 as scheduleExecutionRoleInvocationRawV1,
  type DecisionKernelModeV1,
  type ExecutionPlanV1,
  type ExecutionRoleInvocationV1,
  type ExecutionRoleSchedulingInputV1,
} from "./execution-control-plane";

import { buildBaselineEvidenceEnvelopeV1, type QualityDispositionEnvelopeV1 } from "../contracts/baseline-evidence";
import { sha256Digest } from "../contracts/canonical";
import { buildFailureManifestV1, type FailureFindingInputV1 } from "../contracts/failure-manifest";
import { buildRegistryIntentV1 } from "../contracts/registry-intent";
import {
  buildFindingDispositionEnvelopeV1,
  computeProtectedRiskPolicyAuthorityDigestV1,
  computeProtectedRiskPolicySnapshotDigestV1,
  type DispositionClassificationInputV1,
  type ProtectedRiskAuthorityContextV1,
} from "../contracts/finding-disposition";
import { evidenceInput } from "../contracts/baseline-evidence.test";
import { evaluateFindingDispositionBaselineV1 } from "../orchestrator/finding-disposition-service";
import { buildBroadCausalDispositionEnvelopeV1, buildReviewConvergenceResultV1 } from "../orchestrator/broad-causal-disposition";
import { createQaConvergenceAuthorityFixtureV1 } from "../testing/qa-convergence-authority-fixture";
const sha = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}` as const;
const evidence = (checkId: string) => ({ kind: "check", checkId, artifact: "verify-report.md", resultCode: "passed" });

function scheduleExecutionRoleInvocationV1(
  plan: ExecutionPlanV1,
  input: Omit<ExecutionRoleSchedulingInputV1, "currentCandidate">,
) {
  return scheduleExecutionRoleInvocationRawV1(plan, {
    ...input,
    ...(plan.qaExecutionAuthority === undefined ? {} : { currentCandidate: plan.qaExecutionAuthority.candidate }),
  });
}

function createPlan(
  mode: Exclude<DecisionKernelModeV1, "legacy">,
  completed = false,
  findingKind?: "warning" | "protected",
  batchSalt?: string,
  qaLifecycle?: "affected_pending" | "review_pending" | "broad_pending",
) {
  const protectedPolicy = qualityProtectedPolicy();
  const batch = buildApplyBatchContractV1({
    schema: "apply-batch-v1",
    changeId: "role-scheduler",
    taskIds: ["EG6-T1"],
    dependencies: [],
    ownerRole: "apply-general",
    allowedTargets: ["packages/sdd-runtime"],
    blockedTargets: ["openspec/archive"],
    acceptanceObligations: ["REQ-VERIFY-001"],
    verificationPlan: [
      { stage: "targeted", checkIds: ["targeted-check"] },
      { stage: "affected_area", checkIds: ["affected-check"] },
      { stage: "broad", checkIds: ["broad-check"] },
    ],
    artifactDigests: {
      "tasks.md": sha("tasks"),
      ...(batchSalt === undefined ? {} : { "batch-salt": sha(batchSalt) }),
      ...(findingKind === undefined ? {} : { "protected-risk-policy": computeProtectedRiskPolicyAuthorityDigestV1(protectedPolicy) }),
    },
    authorizationGrantRef: sha("authorization"),
    provenance: { actor: "apply-general", issuedAt: "2026-07-16T00:00:00.000Z" },
  });
  const currentManifest = findingKind === undefined
    ? undefined
    : buildFailureManifestV1({
        schema: "failure-manifest-v1",
        changeId: batch.changeId,
        batch,
        producerRole: "verify",
        producerInstanceId: "verify-manifest",
        findings: [qualityFinding(batch, findingKind)],
        producedAt: "2026-07-20T00:00:00.000Z",
      });
  const verification = buildStagedVerificationStateV1({
    schema: "staged-verification-state-v1",
    batchId: batch.batchId,
    stages: completed
      ? [
          { stage: "targeted", status: "passed", checkIds: ["targeted-check"], evidence: [evidence("targeted-check")] },
          { stage: "affected_area", status: "passed", checkIds: ["affected-check"], evidence: [evidence("affected-check")] },
          { stage: "broad", status: "pending", checkIds: ["broad-check"], evidence: [] },
        ]
      : findingKind === undefined
        ? [
            { stage: "targeted", status: "passed", checkIds: ["targeted-check"], evidence: [evidence("targeted-check")] },
            { stage: "affected_area", status: "pending", checkIds: ["affected-check"], evidence: [] },
            { stage: "broad", status: "pending", checkIds: ["broad-check"], evidence: [] },
          ]
        : [
            { stage: "targeted", status: "passed", checkIds: ["targeted-check"], evidence: [evidence("targeted-check")] },
            { stage: "affected_area", status: "passed", checkIds: ["affected-check"], evidence: [evidence("affected-check")] },
            { stage: "broad", status: "pending", checkIds: ["broad-check"], evidence: [] },
          ],
    ...(completed ? { nextStage: "broad" as const } : { nextStage: findingKind === undefined ? "affected_area" as const : "broad" as const }),
  });
  const dossier = createExecutionDossierV1({
    schema: "execution-dossier-v1",
    batch,
    ...(currentManifest === undefined ? {} : { currentManifest }),
    lane: { schema: "lane-decision-v1", lane: "guarded", riskScore: 30, floorReasons: [], policyOverrides: [], shadowOnly: mode === "shadow" },
    verification,
    causalContext: {
      schema: "causal-context-v1",
      batchDigest: batch.digest,
      priorDecisionDigests: [sha("prior-decision")],
      activeFindingIds: [],
      evidenceRefs: [evidence("prior-check")],
      attemptSummaries: [{ attempt: 1, outcomeCode: "repair", artifact: "apply-progress.md" }],
    },
    registryIntents: [],
  });
  const plan = planExecutionDecisionV1(
    mode,
    dossier,
    { state: "authorized", capabilityDigest: sha("capability"), reference: { validation: "accepted" } },
    { state: "not-required", policyDigest: sha("policy") },
    { kind: "none" },
    { kind: "none" },
  );
  if (mode === "shadow") return plan;
  const candidate = buildCandidateRefV1({
    generation: 1,
    implementationDigest: sha(`implementation:${dossier.digest}`),
    treeDigest: sha(`tree:${dossier.digest}`),
    dependencySetDigest: sha(`dependencies:${dossier.digest}`),
    requirementsDigest: sha(`requirements:${batch.digest}`),
    environmentDigest: sha("environment"),
    checkPlanDigest: sha(`checks:${verification.digest}`),
  });
  const lifecycle = qaLifecycle ?? (completed || findingKind !== undefined ? "broad_pending" : "affected_pending");
  const reviewFindings = (currentManifest?.findings ?? []).map((finding) => ({ findingId: finding.findingId, status: "persistent" as const }));
  const reviewConvergence = buildReviewConvergenceResultV1({
    candidate,
    checklistDigest: sha256Digest({ candidateCheckPlanDigest: candidate.checkPlanDigest, reviewCheckIds: ["architecture-review", "security-review"] }),
    findingSetDigest: sha256Digest(reviewFindings),
    complete: true,
    findings: reviewFindings,
  });
  const convergence = createQaConvergenceAuthorityFixtureV1({
    baseDossier: dossier,
    lifecycle,
    implementationSubjectDigest: candidate.implementationDigest,
    dependencySetDigest: candidate.dependencySetDigest,
    ...(lifecycle === "broad_pending" ? { reviewDigest: reviewConvergence.digest } : {}),
  });
  return bindExecutionPlanQaAuthorityV1(plan, buildQaAuthoritySnapshotV1({
    candidate,
    changeId: batch.changeId,
    convergence,
    freshness: freshness(),
    executionDossierDigest: dossier.digest,
    stagedVerificationDigest: verification.digest,
    protectedPolicyDigest: sha("protected-policy"),
    registryBase: { stateDigest: sha("registry-state"), eventsDigest: sha("registry-events") },
  }));
}

function freshness(changes: Partial<FreshnessPolicyInputV1> = {}): FreshnessPolicyInputV1 {
  return {
    applyInstanceIds: ["apply-1"],
    verifyInstanceId: "verify-2",
    reviewInstanceId: "review-2",
    priorVerifyInstanceId: "verify-1",
    priorReviewInstanceId: "review-1",
    codeModifiedAfterVerify: true,
    reviewRequired: true,
    freshReviewTriggers: [],
    capabilities: { freshAgentScheduling: true, roleIsolation: true },
    ...changes,
  };
}

function stagePlan(plan: ReturnType<typeof createPlan>) {
  if (!plan.dossier || !plan.qaExecutionAuthority) throw new Error("QA plan required");
  const stage = plan.qaExecutionAuthority.lifecycle === "targeted_pending"
    ? "targeted" as const
    : plan.qaExecutionAuthority.lifecycle === "affected_pending"
      ? "affected_area" as const
      : "broad" as const;
  const stageState = plan.dossier.verification.stages.find((entry) => entry.stage === stage);
  if (!stageState) throw new Error("verification stage required");
  return buildVerificationStageExecutionPlanV1({
    stage,
    qaAuthorityDigest: plan.qaExecutionAuthority.digest,
    generation: plan.qaExecutionAuthority.generation,
    implementationSubjectDigest: plan.qaExecutionAuthority.implementationSubjectDigest,
    dependencySetDigest: plan.qaExecutionAuthority.dependencySetDigest,
    checks: stageState.checkIds.map((checkId) => ({
      checkId,
      capabilityDigest: sha(`capability:${checkId}`),
      commandPlanDigest: sha(`command:${checkId}`),
      effectProfile: { kind: "repository_read_only" as const },
      dependencyCheckIds: [],
      exclusiveResourceKeys: [],
    })),
  });
}

function reviewConvergence(invocation: ExecutionRoleInvocationV1, findingIds: readonly string[] = []) {
  if (invocation.qaAuthority.kind !== "convergence") throw new Error("convergence authority required");
  return buildReviewConvergenceResultV1({
    candidate: invocation.qaAuthority.snapshot.candidate,
    checklistDigest: invocation.qaAuthority.snapshot.reviewChecklistDigest,
    findingSetDigest: sha256Digest(findingIds.map((findingId) => ({ findingId, status: "persistent" as const }))),
    complete: true,
    findings: findingIds.map((findingId) => ({ findingId, status: "persistent" as const })),
  });
}

function allGreenQualityDisposition(invocation: ExecutionRoleInvocationV1): QualityDispositionEnvelopeV1 {
  const payload = {
    schema: "quality-disposition-envelope-v1" as const,
    batchId: invocation.batchId,
    batchDigest: invocation.dependencies.batchDigest,
    manifestDigest: sha("empty-manifest"),
    verificationDigest: invocation.dependencies.verificationDigest,
    findingDispositionDigest: sha("empty-finding-disposition"),
    baselineEvidenceDigests: [] as const,
    mandatoryExecutionComplete: true as const,
    status: "passed" as const,
    warningFindingIds: [] as const,
    blockingFindingIds: [] as const,
    producerRole: "verify" as const,
    producerInstanceId: invocation.agentInstanceId,
    producedAt: "2026-07-16T01:00:00.000Z",
  };
  return { ...payload, digest: sha256Digest(payload) };
}

function broadDisposition(
  invocation: ExecutionRoleInvocationV1,
  quality: QualityDispositionEnvelopeV1,
  broadStageJoinDigest: `sha256:${string}`,
  broadManifestDigest: `sha256:${string}`,
  registryIntents: readonly ReturnType<typeof buildRegistryIntentV1>[] = [],
) {
  if (invocation.qaAuthority.kind !== "convergence") throw new Error("convergence authority required");
  const findingIds = [...quality.warningFindingIds, ...quality.blockingFindingIds].sort();
  const review = reviewConvergence(invocation, findingIds);
  const baselineEvidenceDigest = quality.baselineEvidenceDigests[0];
  return buildBroadCausalDispositionEnvelopeV1({
    candidate: invocation.qaAuthority.snapshot.candidate,
    binding: {
      batchDigest: invocation.dependencies.batchDigest,
      generation: invocation.qaAuthority.snapshot.generation,
      implementationSubjectDigest: invocation.qaAuthority.snapshot.implementationSubjectDigest,
      dependencySetDigest: invocation.qaAuthority.snapshot.dependencySetDigest,
      broadStageJoinDigest,
      broadManifestDigest,
      protectedPolicyDigest: invocation.qaAuthority.snapshot.protectedPolicyDigest,
    },
    review,
    qualityDisposition: quality,
    broadFindingIds: findingIds,
    entries: findingIds.map((findingId) => quality.warningFindingIds.includes(findingId) ? {
      findingId,
      classification: "non_candidate_residual" as const,
      evidenceDigests: [baselineEvidenceDigest!],
      complete: true,
      protected: false,
      baselineEvidenceDigest: baselineEvidenceDigest!,
      residualRiskCode: "known-baseline",
      followUpRef: registryIntents[0]?.intentId ?? "missing-follow-up-intent",
    } : {
      findingId,
      classification: "unproven" as const,
      evidenceDigests: [],
      complete: false,
      protected: false,
    }),
  });
}

function passedResult(invocation: ExecutionRoleInvocationV1) {
  const verificationCheckResults = invocation.verificationPlan?.checks.map((check) => buildVerificationCheckResultV1(
    invocation.verificationPlan!,
    {
      checkId: check.checkId,
      producerIdentityDigest: sha(`producer:${invocation.agentInstanceId}:${check.checkId}`),
      outcome: { kind: "completed", status: "passed", evidence: [evidence(check.checkId)] },
    },
  ));
  const verificationWaveReceipts = verificationCheckResults === undefined
    ? undefined
    : buildVerificationWaveExecutionReceiptsV1(
        invocation.verificationPlan!,
        verificationCheckResults,
        sha256Digest({ invocationId: invocation.invocationId, role: invocation.role, agentInstanceId: invocation.agentInstanceId }),
      );
  const reviewResult = invocation.role === "review" && invocation.mode === "active"
    ? reviewConvergence(invocation)
    : undefined;
  const qualityDisposition = invocation.role === "verify" && invocation.stage === "broad" && invocation.mode === "active"
    ? allGreenQualityDisposition(invocation)
    : undefined;
  const causalDisposition = undefined;
  const payload = {
    schema: "execution-role-result-v1",
    invocationId: invocation.invocationId,
    role: invocation.role,
    agentInstanceId: invocation.agentInstanceId,
    batchId: invocation.batchId,
    ...(invocation.stage === undefined ? {} : { stage: invocation.stage }),
    status: "passed",
    evidence: verificationCheckResults?.flatMap((result) => result.outcome.evidence) ?? invocation.checkIds.map(evidence),
    ...(verificationCheckResults === undefined ? {} : { verificationCheckResults }),
    ...(verificationWaveReceipts === undefined ? {} : { verificationWaveReceipts }),
    ...(reviewResult === undefined ? {} : { reviewConvergence: reviewResult }),
    ...(causalDisposition === undefined ? {} : { broadCausalDisposition: causalDisposition }),
    ...(qualityDisposition === undefined ? {} : { qualityDisposition }),
    provenance: {
      role: invocation.role,
      agentInstanceId: invocation.agentInstanceId,
      issuedAt: "2026-07-16T01:00:00.000Z",
    },
    dependencies: invocation.dependencies,
    registryIntents: [],
  };
  return { ...payload, digest: sha256Digest(payload) };
}

function qualityProtectedPolicy() {
  return {
    classificationPolicyVersion: "finding-disposition-policy-v1",
    routingPolicyVersion: "routing-decision-policy-v1",
    mandatorySecurityRequirementIds: [] as string[],
    mandatorySecurityTaskIds: [] as string[],
    mandatorySecurityCheckIds: [] as string[],
    mandatorySecurityOracleIds: [] as string[],
    mandatoryDataLossRequirementIds: [] as string[],
    mandatoryDataLossTaskIds: [] as string[],
    mandatoryDataLossCheckIds: [] as string[],
    mandatoryDataLossOracleIds: [] as string[],
  };
}

function qualityFinding(
  batch: ReturnType<typeof buildApplyBatchContractV1>,
  kind: "warning" | "protected",
): FailureFindingInputV1 {
  return {
    batchId: batch.batchId,
    batchDigest: batch.digest,
    sourcePhase: "verify",
    sourceArtifact: "verify-report.md",
    severity: kind === "protected" ? "critical" : "medium",
    category: kind === "protected" ? "credential-exposure" : "assertion",
    rootCause: kind === "protected" ? "security" : "environment",
    requirementIds: ["REQ-VERIFY-001"],
    taskIds: ["EG6-T1"],
    locationKeys: ["packages/sdd-runtime/src/example.test.ts"],
    oracleId: "bun-test",
    isSecurityRelevant: kind === "protected",
    status: "pre_existing",
    relationship: "unrelated_baseline",
    evidence: [{ kind: "raw", checkId: "broad-check", artifact: "broad.log", resultCode: "failed" }],
  };
}

function broadFailureManifest(plan: ReturnType<typeof createPlan>, invocation: ExecutionRoleInvocationV1) {
  if (!plan.dossier) throw new Error("BROAD dossier required");
  const findings = (plan.dossier.currentManifest?.findings ?? []).map((finding) => {
    const { findingId: _findingId, fingerprint: _fingerprint, ...input } = finding;
    return input as FailureFindingInputV1;
  });
  return buildFailureManifestV1({
    schema: "failure-manifest-v1",
    changeId: plan.dossier.batch.changeId,
    batch: plan.dossier.batch,
    producerRole: "verify",
    producerInstanceId: invocation.agentInstanceId,
    findings,
    producedAt: "2026-07-24T00:00:00.000Z",
  });
}

function qualityDisposition(
  plan: ReturnType<typeof createPlan>,
  invocation: ExecutionRoleInvocationV1,
  overrides: { verificationDigest?: `sha256:${string}`; producerInstanceId?: string } = {},
) {
  const dossier = plan.dossier;
  if (!dossier) throw new Error("quality dossier required");
  const { batch, verification } = dossier;
  const manifest = broadFailureManifest(plan, invocation);
  if (manifest.findings.length === 0) throw new Error("quality manifest required");
  const policy: DispositionClassificationInputV1 = {
    classificationPolicyVersion: "finding-disposition-policy-v1",
    baselineFingerprints: [manifest.findings[0]!.fingerprint],
    deferPolicyRefs: {},
    advisoryCheckIds: [],
    mandatoryRequirementIds: ["REQ-VERIFY-001"],
    mandatoryTaskIds: ["EG6-T1"],
    mandatoryCheckIds: ["broad-check"],
  };
  const authorityValue = {
    batchDigest: batch.digest,
    manifestDigest: manifest.digest,
    classificationPolicyVersion: policy.classificationPolicyVersion,
    routingPolicyVersion: "routing-decision-policy-v1",
    artifactDigests: { "tasks.md": batch.artifactDigests["tasks.md"]! },
    mandatorySecurityRequirementIds: [],
    mandatorySecurityTaskIds: [],
    mandatorySecurityCheckIds: [],
    mandatorySecurityOracleIds: [],
    mandatoryDataLossRequirementIds: [],
    mandatoryDataLossTaskIds: [],
    mandatoryDataLossCheckIds: [],
    mandatoryDataLossOracleIds: [],
  };
  const protectedRiskAuthority: ProtectedRiskAuthorityContextV1 = {
    ...authorityValue,
    policySnapshotDigest: computeProtectedRiskPolicySnapshotDigestV1(authorityValue),
  };
  const findingDisposition = buildFindingDispositionEnvelopeV1({
    manifest,
    batch,
    classification: policy,
    protectedRiskAuthority,
  });
  const baseline = evidenceInput();
  const evidenceEnvelope = buildBaselineEvidenceEnvelopeV1({
    ...baseline,
    candidateSubject: {
      ...baseline.candidateSubject,
      batchId: batch.batchId,
      batchDigest: batch.digest,
    },
  });
  const { producedAt: _producedAt, expiresAt: _expiresAt, invalidationTriggers: _invalidationTriggers, ...currentEvidenceBindings } = evidenceEnvelope.freshness;
  return evaluateFindingDispositionBaselineV1({
    schema: "finding-disposition-baseline-evaluation-v1",
    batch,
    manifest,
    findingDisposition,
    verificationDigest: overrides.verificationDigest ?? verification.digest,
    baselineEvidence: [{ findingId: manifest.findings[0]!.findingId, evidence: evidenceEnvelope }],
    mandatoryExecution: ["targeted", "affected_area", "independent_review", "broad"].map((stage, index) => ({
      stage,
      status: "completed",
      producerInstanceId: `qa-${index}`,
      producedAt: `2026-07-2${index}T00:00:00.000Z`,
      evidenceDigest: sha256Digest(stage),
    })),
    currentEvidenceBindings,
    producerRole: invocation.role,
    producerInstanceId: overrides.producerInstanceId ?? invocation.agentInstanceId,
    producedAt: "2026-07-24T00:00:00.000Z",
    now: "2026-07-24T00:00:00.000Z",
  }).qualityDisposition;
}

function qualityResult(
  plan: ReturnType<typeof createPlan>,
  invocation: ExecutionRoleInvocationV1,
  disposition: ReturnType<typeof qualityDisposition>,
  registryIntents: readonly ReturnType<typeof buildRegistryIntentV1>[] = [],
) {
  const failureManifest = broadFailureManifest(plan, invocation);
  const verificationCheckResults = invocation.verificationPlan?.checks.map((check) => buildVerificationCheckResultV1(
    invocation.verificationPlan!,
    {
      checkId: check.checkId,
      producerIdentityDigest: sha(`producer:${invocation.agentInstanceId}:${check.checkId}`),
      outcome: { kind: "completed", status: "failed", evidence: [{ ...evidence(check.checkId), resultCode: "failed" }] },
    },
  ));
  const verificationWaveReceipts = verificationCheckResults === undefined
    ? undefined
    : buildVerificationWaveExecutionReceiptsV1(
        invocation.verificationPlan!,
        verificationCheckResults,
        sha256Digest({ invocationId: invocation.invocationId, role: invocation.role, agentInstanceId: invocation.agentInstanceId }),
      );
  if (verificationCheckResults === undefined || verificationWaveReceipts === undefined || invocation.verificationPlan === undefined) {
    throw new Error("quality verification evidence required");
  }
  const executionIdentityDigest = sha256Digest({ invocationId: invocation.invocationId, role: invocation.role, agentInstanceId: invocation.agentInstanceId });
  const verificationJoin = joinVerificationStageExecutionV1(
    invocation.verificationPlan,
    verificationCheckResults,
    failureManifest.digest,
    verificationWaveReceipts,
    executionIdentityDigest,
  );
  if (verificationJoin.status === "incomplete") throw new Error("quality verification join required");
  const { digest: _digest, ...base } = passedResult(invocation);
  const payload = {
    ...base,
    status: disposition.status === "failed" ? "failed" as const : "passed" as const,
    evidence: verificationCheckResults?.flatMap((result) => result.outcome.evidence) ?? [{ ...evidence(invocation.checkIds[0]!), resultCode: "failed" }],
    ...(verificationCheckResults === undefined ? {} : { verificationCheckResults }),
    ...(verificationWaveReceipts === undefined ? {} : { verificationWaveReceipts }),
    provenance: {
      role: invocation.role,
      agentInstanceId: invocation.agentInstanceId,
      issuedAt: "2026-07-24T00:00:00.000Z",
    },
    failureManifest,
    qualityDisposition: disposition,
    broadCausalDisposition: broadDisposition(invocation, disposition, verificationJoin.digest, failureManifest.digest, registryIntents),
    registryIntents,
  };
  return { ...payload, digest: sha256Digest(payload) };
}

function qualityIntent(plan: ReturnType<typeof createPlan>, status: "passed" | "passed_with_warnings") {
  const dossier = plan.dossier;
  if (!dossier || !plan.decision) throw new Error("quality plan required");
  return buildRegistryIntentV1({
    schema: "registry-intent-v1",
    idempotencyKey: sha(`quality-${status}`),
    changeId: dossier.batch.changeId,
    batchId: dossier.batch.batchId,
    batchDigest: dossier.batch.digest,
    base: { stateDigest: sha("state"), eventsDigest: sha("events") },
    phase: "verify",
    status,
    artifact: { kind: status === "passed_with_warnings" ? "warning-follow-up" : "verify-report", path: "verify-report.md", digest: sha("verify-report") },
    provenance: { agent: "verify", model: "test", timestamp: "2026-07-24T00:00:00.000Z" },
    event: { name: "verify-completed", actor: "verify", timestamp: "2026-07-24T00:00:00.000Z", notes: status === "passed_with_warnings" ? (dossier.currentManifest?.findings.map((finding) => finding.findingId) ?? []) : [] },
    decisionDigest: plan.decision.digest,
  });
}

const verificationPolicy = {
  lane: "guarded" as const,
  broadRequired: true,
  mandatoryBroadReasons: [],
  broadDeferralPolicyIds: [],
};

describe("execution role scheduler", () => {
  test("carries the authority-bound in-stage wave plan into Verify", () => {
    const plan = createPlan("active");
    const verificationPlan = stagePlan(plan);
    const scheduled = scheduleExecutionRoleInvocationV1(plan, {
      role: "verify",
      agentInstanceId: "verify-2",
      freshness: freshness(),
      verificationPlan,
    });

    expect(scheduled.code).toBe("scheduled");
    if (!("invocation" in scheduled)) throw new Error("expected invocation");
    expect(scheduled.invocation.verificationPlan?.digest).toBe(verificationPlan.digest);
  });

  test("lets convergence authority schedule Review before BROAD", () => {
    const plan = createPlan("active", true, undefined, undefined, "review_pending");

    expect(scheduleExecutionRoleInvocationV1(plan, {
      role: "verify",
      agentInstanceId: "verify-2",
      freshness: freshness(),
    }).code).toBe("not-required");
    expect(scheduleExecutionRoleInvocationV1(plan, {
      role: "review",
      agentInstanceId: "review-2",
      freshness: freshness(),
    }).code).toBe("scheduled");
  });

  test("rejects caller-selected Review scope instead of narrowing the authority checklist", () => {
    const plan = createPlan("active", true, undefined, undefined, "review_pending");
    expect(scheduleExecutionRoleInvocationV1(plan, {
      role: "review",
      agentInstanceId: "review-2",
      freshness: freshness(),
      reviewCheckIds: ["narrow-review"],
    } as unknown as ExecutionRoleSchedulingInputV1).code).toBe("invalid-evidence");
  });

  test("fails active legacy scheduling without the control-plane authority binding", () => {
    const active = createPlan("active");
    const { qaExecutionAuthority: _authority, ...legacy } = active;
    expect(scheduleExecutionRoleInvocationV1(legacy, {
      role: "verify",
      agentInstanceId: "verify-2",
      freshness: freshness(),
    }).code).toBe("qa-authority-required");
  });

  test("schedules the actual next Verify stage with redacted causal context", () => {
    const plan = createPlan("active");
    const scheduled = scheduleExecutionRoleInvocationV1(plan, {
      role: "verify",
      agentInstanceId: "verify-2",
      freshness: freshness(),
      verificationPlan: stagePlan(plan),
    });
    expect(scheduled.code).toBe("scheduled");
    if (!("invocation" in scheduled)) throw new Error("expected invocation");
    expect(scheduled.invocation.stage).toBe("affected_area");
    expect(scheduled.invocation.checkIds).toEqual(["affected-check"]);
    expect(scheduled.invocation.requiresFreshAgent).toBe(true);
    expect(scheduled.invocation.causalContext.attemptSummaries).toEqual([]);
    expect(scheduled.invocation.dependencies.decisionDigest).toMatch(/^sha256:/);
  });

  test("consumes a bound result and advances only the scheduled stage", () => {
    const plan = createPlan("active");
    const scheduled = scheduleExecutionRoleInvocationV1(plan, {
      role: "verify",
      agentInstanceId: "verify-2",
      freshness: freshness(),
      verificationPlan: stagePlan(plan),
    });
    if (!("invocation" in scheduled)) throw new Error("expected invocation");
    const result = passedResult(scheduled.invocation) as ReturnType<typeof passedResult> & { digest?: `sha256:${string}` };
    const { digest: _digest, ...unsigned } = result;
    expect(consumeExecutionRoleResultV1(plan, scheduled.invocation, unsigned, verificationPolicy).code).toBe("invalid-evidence");
    const consumed = consumeExecutionRoleResultV1(plan, scheduled.invocation, result, verificationPolicy);
    expect(consumed.code).toBe("accepted");
    if (!("verification" in consumed)) throw new Error("expected verification state");
    expect(consumed.verification?.nextStage).toBe("broad");
    expect(consumed.verification?.stages[1]?.status).toBe("passed");
  });

  test("fails closed when caller identities or host capabilities differ from authority", () => {
    expect(scheduleExecutionRoleInvocationV1(createPlan("active"), {
      role: "verify",
      agentInstanceId: "apply-1",
      freshness: freshness({ verifyInstanceId: "apply-1" }),
    }).code).toBe("invalid-evidence");
    expect(scheduleExecutionRoleInvocationV1(createPlan("active"), {
      role: "verify",
      agentInstanceId: "verify-2",
      freshness: freshness({ capabilities: { freshAgentScheduling: false, roleIsolation: true } }),
    }).code).toBe("invalid-evidence");
  });

  test("rejects a self-consistent freshness identity set that conflicts with QA authority", () => {
    const plan = createPlan("active");
    expect(scheduleExecutionRoleInvocationV1(plan, {
      role: "verify",
      agentInstanceId: "verify-forged",
      freshness: freshness({ verifyInstanceId: "verify-forged" }),
      verificationPlan: stagePlan(plan),
    }).code).toBe("invalid-evidence");
  });

  test("rejects active scheduling after the measured candidate drifts", () => {
    const plan = createPlan("active");
    if (!plan.qaExecutionAuthority) throw new Error("authority required");
    const { schema: _schema, digest: _digest, ...candidateInput } = plan.qaExecutionAuthority.candidate;
    const currentCandidate = buildCandidateRefV1({
      ...candidateInput,
      generation: plan.qaExecutionAuthority.candidate.generation + 1,
      treeDigest: sha("drifted-tree"),
    });
    expect(scheduleExecutionRoleInvocationRawV1(plan, {
      role: "verify",
      agentInstanceId: "verify-2",
      freshness: freshness(),
      currentCandidate,
      verificationPlan: stagePlan(plan),
    }).code).toBe("invalid-evidence");
  });

  test("rejects a result whose dependency binding was forged", () => {
    const plan = createPlan("active");
    const scheduled = scheduleExecutionRoleInvocationV1(plan, {
      role: "verify",
      agentInstanceId: "verify-2",
      freshness: freshness(),
      verificationPlan: stagePlan(plan),
    });
    if (!("invocation" in scheduled)) throw new Error("expected invocation");
    const result = passedResult(scheduled.invocation);
    const consumed = consumeExecutionRoleResultV1(plan, scheduled.invocation, {
      ...result,
      dependencies: { ...result.dependencies, dossierDigest: sha("forged") },
    }, verificationPolicy);
    expect(consumed.code).toBe("invalid-evidence");
  });

  test("schedules independent Review only after staged verification completes", () => {
    const plan = createPlan("active", true, undefined, undefined, "review_pending");
    const scheduled = scheduleExecutionRoleInvocationV1(plan, {
      role: "review",
      agentInstanceId: "review-2",
      freshness: freshness(),
    });
    expect(scheduled.code).toBe("scheduled");
    if (!("invocation" in scheduled)) throw new Error("expected invocation");
    expect(scheduled.invocation.stage).toBeUndefined();
    expect(consumeExecutionRoleResultV1(plan, scheduled.invocation, passedResult(scheduled.invocation), verificationPolicy).code)
      .toBe("accepted");
  });

  test("rejects caller attempts to weaken mandatory Guarded Review freshness", () => {
    const scheduled = scheduleExecutionRoleInvocationV1(createPlan("active", true, undefined, undefined, "review_pending"), {
      role: "review",
      agentInstanceId: "review-2",
      freshness: freshness({ codeModifiedAfterVerify: false, reviewRequired: false }),
    });
    expect(scheduled.code).toBe("invalid-evidence");
  });

  test("does not accept Review without evidence for every scheduled check", () => {
    const plan = createPlan("active", true, undefined, undefined, "review_pending");
    const scheduled = scheduleExecutionRoleInvocationV1(plan, {
      role: "review",
      agentInstanceId: "review-2",
      freshness: freshness(),
    });
    if (!("invocation" in scheduled)) throw new Error("expected invocation");
    const { digest: _digest, ...validResult } = passedResult(scheduled.invocation);
    const missingEvidence = { ...validResult, evidence: [] };
    expect(consumeExecutionRoleResultV1(plan, scheduled.invocation, {
      ...missingEvidence,
      digest: sha256Digest(missingEvidence),
    }, verificationPolicy).code).toBe("verification-evidence-required");
  });

  test("does not let Review consume a verification policy below the dossier lane", () => {
    const plan = createPlan("active", true, undefined, undefined, "review_pending");
    const scheduled = scheduleExecutionRoleInvocationV1(plan, {
      role: "review",
      agentInstanceId: "review-2",
      freshness: freshness(),
    });
    if (!("invocation" in scheduled)) throw new Error("expected invocation");
    expect(consumeExecutionRoleResultV1(plan, scheduled.invocation, passedResult(scheduled.invocation), {
      ...verificationPolicy,
      lane: "fast",
      broadRequired: false,
    }).code).toBe("lane-floor-violation");
  });

  test("keeps shadow results observable but strips commit-ready intents", () => {
    const plan = createPlan("shadow");
    const scheduled = scheduleExecutionRoleInvocationV1(plan, {
      role: "verify",
      agentInstanceId: "verify-2",
      freshness: freshness(),
    });
    expect(scheduled.code).toBe("shadow-only");
    if (!("invocation" in scheduled)) throw new Error("expected invocation");
    const consumed = consumeExecutionRoleResultV1(plan, scheduled.invocation, passedResult(scheduled.invocation), verificationPolicy);
    expect(consumed.code).toBe("shadow-observed");
    if (!("registryIntents" in consumed)) throw new Error("expected normalized result");
    expect(consumed.registryIntents).toEqual([]);
  });
});


describe("quality disposition execution control", () => {
  test("advances mandatory BROAD with a valid warning while retaining raw failure evidence", () => {
    const plan = createPlan("active", false, "warning");
    const scheduled = scheduleExecutionRoleInvocationV1(plan, {
      role: "verify",
      agentInstanceId: "verify-2",
      freshness: freshness(),
      verificationPlan: stagePlan(plan),
    });
    if (!("invocation" in scheduled)) throw new Error("expected invocation");
    expect(scheduled.invocation.stage).toBe("broad");

    const disposition = qualityDisposition(plan, scheduled.invocation);
    expect(disposition.status).toBe("passed_with_warnings");
    expect(consumeExecutionRoleResultV1(
      plan,
      scheduled.invocation,
      { ...qualityResult(plan, scheduled.invocation, disposition, [qualityIntent(plan, "passed_with_warnings")]), failureManifest: undefined },
      verificationPolicy,
    ).code).toBe("invalid-evidence");
    const consumed = consumeExecutionRoleResultV1(
      plan,
      scheduled.invocation,
      qualityResult(plan, scheduled.invocation, disposition, [qualityIntent(plan, "passed_with_warnings")]),
      verificationPolicy,
    );

    expect(consumed.code).toBe("accepted");
    if (!("result" in consumed)) throw new Error("expected accepted quality result");
    expect(consumed.result.status).toBe("passed");
    expect(consumed.phaseStatus).toBe("passed_with_warnings");
    expect(consumed.result.qualityDisposition?.digest).toBe(disposition.digest);
    expect(consumed.registryIntents[0]?.status).toBe("passed_with_warnings");
    expect(consumed.verification?.stages[2]?.status).toBe("passed");
    if (!plan.dossier?.currentManifest) throw new Error("expected raw manifest");
    expect(plan.dossier.currentManifest.findings[0]?.evidence[0]?.resultCode).toBe("failed");
  });

  test("refuses missing, stale, conflicting, cross-batch, and identity-mismatched warning evidence", () => {
    const allGreenPlan = createPlan("active");
    const allGreenScheduled = scheduleExecutionRoleInvocationV1(allGreenPlan, {
      role: "verify",
      agentInstanceId: "verify-2",
      freshness: freshness(),
      verificationPlan: stagePlan(allGreenPlan),
    });
    if (!("invocation" in allGreenScheduled)) throw new Error("expected invocation");
    expect(consumeExecutionRoleResultV1(
      allGreenPlan,
      allGreenScheduled.invocation,
      {
        ...passedResult(allGreenScheduled.invocation),
        evidence: [{ ...evidence(allGreenScheduled.invocation.checkIds[0]!), resultCode: "nonzero" }],
      },
      verificationPolicy,
    ).code).toBe("invalid-evidence");

    const plan = createPlan("active", false, "warning");
    const scheduled = scheduleExecutionRoleInvocationV1(plan, {
      role: "verify",
      agentInstanceId: "verify-2",
      freshness: freshness(),
      verificationPlan: stagePlan(plan),
    });
    if (!("invocation" in scheduled)) throw new Error("expected invocation");

    const valid = qualityDisposition(plan, scheduled.invocation);
    expect(consumeExecutionRoleResultV1(
      plan,
      scheduled.invocation,
      { ...qualityResult(plan, scheduled.invocation, valid), qualityDisposition: undefined },
      verificationPolicy,
    ).code).toBe("invalid-evidence");

    const stale = qualityDisposition(plan, scheduled.invocation, { verificationDigest: sha("stale-verification") });
    expect(consumeExecutionRoleResultV1(
      plan,
      scheduled.invocation,
      qualityResult(plan, scheduled.invocation, stale),
      verificationPolicy,
    ).code).toBe("invalid-evidence");

    expect(consumeExecutionRoleResultV1(
      plan,
      scheduled.invocation,
      { ...qualityResult(plan, scheduled.invocation, valid), status: "failed" },
      verificationPolicy,
    ).code).toBe("invalid-evidence");

    expect(consumeExecutionRoleResultV1(
      plan,
      scheduled.invocation,
      qualityResult(plan, scheduled.invocation, valid, [qualityIntent(plan, "passed")]),
      verificationPolicy,
    ).code).toBe("invalid-evidence");

    const otherPlan = createPlan("active", false, "warning", "other-batch");
    const otherScheduled = scheduleExecutionRoleInvocationV1(otherPlan, {
      role: "verify",
      agentInstanceId: "verify-2",
      freshness: freshness(),
      verificationPlan: stagePlan(otherPlan),
    });
    if (!("invocation" in otherScheduled)) throw new Error("expected invocation");
    const otherBatchDisposition = qualityDisposition(otherPlan, otherScheduled.invocation);
    expect(() => qualityResult(plan, scheduled.invocation, otherBatchDisposition)).toThrow("BROAD_DISPOSITION_BINDING_INVALID");

    const wrongIdentity = qualityDisposition(plan, scheduled.invocation, { producerInstanceId: "verify-other" });
    expect(consumeExecutionRoleResultV1(
      plan,
      scheduled.invocation,
      qualityResult(plan, scheduled.invocation, wrongIdentity),
      verificationPolicy,
    ).code).toBe("invalid-evidence");
  });

  test("keeps protected findings failed and refuses warning routing", () => {
    const plan = createPlan("active", false, "protected");
    const scheduled = scheduleExecutionRoleInvocationV1(plan, {
      role: "verify",
      agentInstanceId: "verify-2",
      freshness: freshness(),
      verificationPlan: stagePlan(plan),
    });
    if (!("invocation" in scheduled)) throw new Error("expected invocation");
    const disposition = qualityDisposition(plan, scheduled.invocation);
    expect(disposition.status).toBe("failed");
    if (!plan.dossier?.currentManifest) throw new Error("expected protected manifest");
    expect(disposition.blockingFindingIds).toEqual([plan.dossier.currentManifest.findings[0]!.findingId]);

    const consumed = consumeExecutionRoleResultV1(
      plan,
      scheduled.invocation,
      qualityResult(plan, scheduled.invocation, disposition),
      verificationPolicy,
    );
    expect(consumed.code).toBe("role-result-failed");
  });

  test("requires an independent Review identity and freezes its complete finding set", () => {
    const plan = createPlan("active", true, "warning", undefined, "review_pending");
    const scheduled = scheduleExecutionRoleInvocationV1(plan, {
      role: "review",
      agentInstanceId: "review-2",
      freshness: freshness(),
    });
    if (!("invocation" in scheduled)) throw new Error("expected invocation");
    const consumed = consumeExecutionRoleResultV1(
      plan,
      scheduled.invocation,
      passedResult(scheduled.invocation),
      verificationPolicy,
    );
    expect(consumed.code).toBe("accepted");
    if (!("result" in consumed)) throw new Error("expected accepted review");
    expect(consumed.phaseStatus).toBe("passed");
    expect(consumed.result.reviewConvergence?.candidateDigest).toBe(plan.qaExecutionAuthority?.candidateDigest);
    expect(consumed.result.qualityDisposition).toBeUndefined();
  });
});
