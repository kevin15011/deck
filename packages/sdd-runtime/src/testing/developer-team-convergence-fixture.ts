import { afterEach, expect } from "bun:test";
import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseRegistryDocumentPairV1 } from "@deck/core/spec-registry";

import { createFileSystemRegistryStoreV1 } from "../artifact-state/filesystem-registry-store";
import { createRegistryCoordinatorV1 } from "../artifact-state/registry-coordinator";
import { buildApplyBatchContractV1 } from "../contracts/apply-batch";
import { sha256Digest } from "../contracts/canonical";
import { createExecutionDossierV1, reviseExecutionDossierV1, type ExecutionDossierV1 } from "../contracts/execution-dossier";
import { buildFailureManifestV1, type FailureFindingInputV1, type FailureManifestV1 } from "../contracts/failure-manifest";
import { buildRegistryIntentV1 } from "../contracts/registry-intent";
import { buildStagedVerificationStateV1 } from "../contracts/verification-state";
import { buildCandidateRefV1, buildQaAuthoritySnapshotV1 } from "../contracts/qa-authority";
import { buildVerificationCheckResultV1, buildVerificationStageExecutionPlanV1, buildVerificationWaveExecutionReceiptsV1, joinVerificationStageExecutionV1, type VerificationStageExecutionJoinV1 } from "../contracts/verification-stage-execution";
import { computeFailureDeltaV1 } from "../orchestrator/failure-delta";
import { buildBroadCausalDispositionEnvelopeV1, buildReviewConvergenceResultV1 } from "../orchestrator/broad-causal-disposition";
import { decideQualityReadinessV1 } from "../orchestrator/quality-readiness";
import { createQaConvergenceAuthorityFixtureV1 } from "./qa-convergence-authority-fixture";
import type { FreshnessPolicyInputV1 } from "../orchestrator/freshness-policy";
import { createRunnerHostFixtureV1, type BridgeFactory, type RunnerId } from "./developer-team-runner-host-fixture";
import {
  bindExecutionPlanQaAuthorityV1,
  commitExecutionRegistryIntentsV1,
  consumeExecutionRoleResultV1,
  planExecutionDecisionV1,
  scheduleExecutionRoleInvocationV1 as scheduleExecutionRoleInvocationRawV1,
  type ExecutionPlanV1,
  type ExecutionRoleInvocationV1,
  type ExecutionRoleSchedulingInputV1,
} from "../execution/execution-control-plane";

const roots: string[] = [];

function scheduleExecutionRoleInvocationV1(
  plan: ExecutionPlanV1,
  input: Omit<ExecutionRoleSchedulingInputV1, "currentCandidate">,
) {
  return scheduleExecutionRoleInvocationRawV1(plan, {
    ...input,
    ...(plan.qaExecutionAuthority === undefined ? {} : { currentCandidate: plan.qaExecutionAuthority.candidate }),
  });
}
const sha = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}` as const;
const verificationPolicy = {
  lane: "guarded" as const,
  broadRequired: true,
  mandatoryBroadReasons: [] as const,
  broadDeferralPolicyIds: [] as const,
};

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

function evidence(checkId: string, artifact = "verify-report.md") {
  return { kind: "check" as const, checkId, artifact, resultCode: "passed" };
}

function plan(
  dossier: ExecutionDossierV1,
  history: readonly ExecutionDossierV1[] = [],
  lifecycle?: "targeted_pending" | "affected_pending" | "review_pending" | "broad_pending" | "registry_commit_pending",
  acceptedReviewDigest?: `sha256:${string}`,
  acceptedBroadDigest?: `sha256:${string}`,
  acceptedEvidence?: {
    readonly targetedJoinDigest: `sha256:${string}`;
    readonly affectedAreaJoinDigest: `sha256:${string}`;
    readonly broadJoinDigest: `sha256:${string}`;
    readonly targetedRoleResultDigest: `sha256:${string}`;
    readonly affectedAreaRoleResultDigest: `sha256:${string}`;
    readonly reviewRoleResultDigest: `sha256:${string}`;
    readonly broadRoleResultDigest: `sha256:${string}`;
    readonly broadVerificationDigest: `sha256:${string}`;
    readonly registryIntentDigests: readonly `sha256:${string}`[];
  },
): ExecutionPlanV1 {
  const executionPlan = planExecutionDecisionV1(
    "active",
    dossier,
    {
      state: "authorized",
      capabilityDigest: sha("capability"),
      reference: { validation: "accepted" },
    },
    { state: "not-required", policyDigest: sha("git-policy") },
    { kind: "none" },
    { kind: "none" },
    history,
  );
  const candidate = buildCandidateRefV1({
    generation: 1,
    implementationDigest: sha(`implementation:${dossier.batch.digest}`),
    treeDigest: sha(`tree:${dossier.batch.digest}`),
    dependencySetDigest: sha(`dependencies:${dossier.batch.digest}`),
    requirementsDigest: sha(`requirements:${dossier.batch.digest}`),
    environmentDigest: sha("fixture-environment"),
    checkPlanDigest: sha(`checks:${dossier.batch.digest}`),
  });
  const inferredLifecycle = lifecycle ?? (
    dossier.verification.nextStage === "targeted" ? "targeted_pending" :
      dossier.verification.nextStage === "affected_area" ? "affected_pending" :
        dossier.verification.nextStage === "broad" ? "review_pending" : "registry_commit_pending"
  );
  const reviewConvergence = buildReviewConvergenceResultV1({
    candidate,
    checklistDigest: sha256Digest({ candidateCheckPlanDigest: candidate.checkPlanDigest, reviewCheckIds: ["architecture-review", "security-review"] }),
    findingSetDigest: sha256Digest([]),
    complete: true,
    findings: [],
  });
  const reviewDigest = acceptedReviewDigest ?? reviewConvergence.digest;
  const freshnessAuthority = inferredLifecycle === "targeted_pending"
    ? freshness("verify-stage-1", "verify-repair")
    : inferredLifecycle === "affected_pending"
      ? freshness("verify-stage-2", "verify-stage-1")
      : inferredLifecycle === "review_pending"
        ? freshness("verify-review-proxy", "verify-stage-2", "review-final")
        : freshness("verify-stage-3", "verify-stage-2");
  const convergence = createQaConvergenceAuthorityFixtureV1({
    baseDossier: dossier,
    ...(history.length === 0 ? {} : { baseDossierHistory: history }),
    lifecycle: inferredLifecycle,
    implementationSubjectDigest: candidate.implementationDigest,
    dependencySetDigest: candidate.dependencySetDigest,
    ...(inferredLifecycle === "broad_pending" || inferredLifecycle === "registry_commit_pending" ? { reviewDigest } : {}),
    ...(inferredLifecycle === "registry_commit_pending" ? { broadDigest: acceptedBroadDigest } : {}),
    ...(acceptedEvidence === undefined ? {} : {
      stageEvidenceDigests: {
        targeted: acceptedEvidence.targetedJoinDigest,
        affected_area: acceptedEvidence.affectedAreaJoinDigest,
        broad: acceptedEvidence.broadJoinDigest,
      },
      roleResultEnvelopeDigests: {
        targeted: acceptedEvidence.targetedRoleResultDigest,
        affected_area: acceptedEvidence.affectedAreaRoleResultDigest,
        review: acceptedEvidence.reviewRoleResultDigest,
        broad: acceptedEvidence.broadRoleResultDigest,
      },
      stageVerificationDigests: { broad: acceptedEvidence.broadVerificationDigest },
      registryIntentDigests: acceptedEvidence.registryIntentDigests,
    }),
  });
  return bindExecutionPlanQaAuthorityV1(executionPlan, buildQaAuthoritySnapshotV1({
    candidate,
    changeId: dossier.batch.changeId,
    convergence,
    freshness: freshnessAuthority,
    executionDossierDigest: dossier.digest,
    stagedVerificationDigest: dossier.verification.digest,
    protectedPolicyDigest: sha("fixture-protected-policy"),
    registryBase: dossier.registryIntents[0]?.base ?? { stateDigest: sha("fixture-state"), eventsDigest: sha("fixture-events") },
  }));
}

function freshness(
  verifyInstanceId: string,
  priorVerifyInstanceId: string,
  reviewInstanceId = "review-final",
): FreshnessPolicyInputV1 {
  return {
    applyInstanceIds: ["apply-1"],
    verifyInstanceId,
    reviewInstanceId,
    priorVerifyInstanceId,
    priorReviewInstanceId: "review-prior",
    codeModifiedAfterVerify: true,
    reviewRequired: true,
    freshReviewTriggers: [],
    capabilities: { freshAgentScheduling: true, roleIsolation: true },
  };
}

function stagePlan(plan: ExecutionPlanV1) {
  if (!plan.dossier || !plan.qaExecutionAuthority) throw new Error("QA plan required");
  const actionStage = plan.qaExecutionAuthority.lifecycle === "targeted_pending"
    ? "targeted" as const
    : plan.qaExecutionAuthority.lifecycle === "affected_pending"
      ? "affected_area" as const
      : "broad" as const;
  const stage = plan.dossier.verification.stages.find((entry) => entry.stage === actionStage);
  if (!stage) throw new Error("verification stage required");
  return buildVerificationStageExecutionPlanV1({
    stage: actionStage,
    qaAuthorityDigest: plan.qaExecutionAuthority.digest,
    generation: plan.qaExecutionAuthority.generation,
    implementationSubjectDigest: plan.qaExecutionAuthority.implementationSubjectDigest,
    dependencySetDigest: plan.qaExecutionAuthority.dependencySetDigest,
    checks: stage.checkIds.map((checkId) => ({
      checkId,
      capabilityDigest: sha(`capability:${checkId}`),
      commandPlanDigest: sha(`command:${checkId}`),
      effectProfile: { kind: "repository_read_only" as const },
      dependencyCheckIds: [],
      exclusiveResourceKeys: [],
    })),
  });
}

function reviewConvergence(invocation: ExecutionRoleInvocationV1) {
  if (invocation.qaAuthority.kind !== "convergence") throw new Error("convergence authority required");
  return buildReviewConvergenceResultV1({
    candidate: invocation.qaAuthority.snapshot.candidate,
    checklistDigest: invocation.qaAuthority.snapshot.reviewChecklistDigest,
    findingSetDigest: sha256Digest([]),
    complete: true,
    findings: [],
  });
}

function allGreenQualityDisposition(invocation: ExecutionRoleInvocationV1, manifestDigest = sha("fixture-empty-manifest")) {
  const payload = {
    schema: "quality-disposition-envelope-v1" as const,
    batchId: invocation.batchId,
    batchDigest: invocation.dependencies.batchDigest,
    manifestDigest,
    verificationDigest: invocation.dependencies.verificationDigest,
    findingDispositionDigest: sha("fixture-empty-finding-disposition"),
    baselineEvidenceDigests: [] as const,
    mandatoryExecutionComplete: true as const,
    status: "passed" as const,
    warningFindingIds: [] as const,
    blockingFindingIds: [] as const,
    producerRole: "verify" as const,
    producerInstanceId: invocation.agentInstanceId,
    producedAt: "2026-07-16T12:00:00.000Z",
  };
  return { ...payload, digest: sha256Digest(payload) };
}

function passedResult(
  invocation: ExecutionRoleInvocationV1,
  registryIntents: readonly ReturnType<typeof buildRegistryIntentV1>[] = [],
  failureManifest?: FailureManifestV1,
) {
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
    ? allGreenQualityDisposition(invocation, failureManifest?.digest)
    : undefined;
  const executionIdentityDigest = sha256Digest({ invocationId: invocation.invocationId, role: invocation.role, agentInstanceId: invocation.agentInstanceId });
  const verificationJoin = qualityDisposition === undefined || verificationCheckResults === undefined || verificationWaveReceipts === undefined || failureManifest === undefined
    ? undefined
    : joinVerificationStageExecutionV1(invocation.verificationPlan!, verificationCheckResults, failureManifest.digest, verificationWaveReceipts, executionIdentityDigest);
  const causalDisposition = qualityDisposition === undefined || invocation.qaAuthority.kind !== "convergence" || verificationJoin === undefined || verificationJoin.status === "incomplete" || failureManifest === undefined
    ? undefined
    : buildBroadCausalDispositionEnvelopeV1({
        candidate: invocation.qaAuthority.snapshot.candidate,
        binding: {
          batchDigest: invocation.dependencies.batchDigest,
          generation: invocation.qaAuthority.snapshot.generation,
          implementationSubjectDigest: invocation.qaAuthority.snapshot.implementationSubjectDigest,
          dependencySetDigest: invocation.qaAuthority.snapshot.dependencySetDigest,
          broadStageJoinDigest: verificationJoin.digest,
          broadManifestDigest: failureManifest.digest,
          protectedPolicyDigest: invocation.qaAuthority.snapshot.protectedPolicyDigest,
        },
        review: reviewConvergence(invocation),
        qualityDisposition,
        broadFindingIds: [],
        entries: [],
      });
  const payload = {
    schema: "execution-role-result-v1",
    invocationId: invocation.invocationId,
    role: invocation.role,
    agentInstanceId: invocation.agentInstanceId,
    batchId: invocation.batchId,
    ...(invocation.stage === undefined ? {} : { stage: invocation.stage }),
    status: "passed",
    evidence: verificationCheckResults?.flatMap((result) => result.outcome.evidence) ?? invocation.checkIds.map((checkId) => evidence(
      checkId,
      invocation.role === "review" ? "review-report.md" : "verify-report.md",
    )),
    ...(verificationCheckResults === undefined ? {} : { verificationCheckResults }),
    ...(verificationWaveReceipts === undefined ? {} : { verificationWaveReceipts }),
    ...(failureManifest === undefined ? {} : { failureManifest }),
    ...(reviewResult === undefined ? {} : { reviewConvergence: reviewResult }),
    ...(causalDisposition === undefined ? {} : { broadCausalDisposition: causalDisposition }),
    ...(qualityDisposition === undefined ? {} : { qualityDisposition }),
    provenance: {
      role: invocation.role,
      agentInstanceId: invocation.agentInstanceId,
      issuedAt: "2026-07-16T12:00:00.000Z",
    },
    dependencies: invocation.dependencies,
    registryIntents,
  };
  return { ...payload, digest: sha256Digest(payload) };
}

function causalInput(dossier: ExecutionDossierV1) {
  const { digest: _digest, ...causalContext } = dossier.causalContext;
  return causalContext;
}

async function registryFixture(changeId: string) {
  const root = await fs.mkdtemp(join(tmpdir(), "deck-convergence-e2e-"));
  roots.push(root);
  const directory = join(root, "openspec", "changes", changeId);
  await fs.mkdir(directory, { recursive: true });
  const stateSource = `# retained state history\nschema: spec-registry-v1\nchangeId: ${changeId}\ncurrentPhase: apply\nstatus: in_progress\nartifacts:\n  apply: apply-progress.md\nprovenance:\n  - phase: apply\n    agent: apply-general\n    model: fixture-model\n    timestamp: "2026-07-16T00:00:00.000Z"\n    registryWrite: non-deferred\n`;
  const eventsSource = `# retained event history\nschema: spec-registry-events-v1\nevents:\n  - phase: apply\n    status: in_progress\n    event: apply.started\n    artifact: apply-progress.md\n    timestamp: "2026-07-16T00:00:00.000Z"\n    actor: apply-general\n`;
  await fs.writeFile(join(directory, "state.yaml"), stateSource, "utf8");
  await fs.writeFile(join(directory, "events.yaml"), eventsSource, "utf8");
  await fs.writeFile(join(directory, "apply-progress.md"), "apply complete\n", "utf8");
  const reviewReport = "fresh review accepted\n";
  await fs.writeFile(join(directory, "review-report.md"), reviewReport, "utf8");
  const store = createFileSystemRegistryStoreV1({ projectRoot: root });
  return { root, directory, reviewReport, stateSource, eventsSource, store, snapshot: await store.read(changeId) };
}

export async function runDeveloperTeamConvergenceE2EV1(runnerId: RunnerId, factory: BridgeFactory): Promise<void> {
  const batch = buildApplyBatchContractV1({
    schema: "apply-batch-v1",
    changeId: "developer-team-convergence-e2e",
    taskIds: ["EG8-T2"],
    dependencies: [],
    ownerRole: "apply-general",
    allowedTargets: ["packages/sdd-runtime"],
    blockedTargets: ["openspec/archive"],
    acceptanceObligations: ["REQ-VERIFY-001", "REQ-REGISTRY-001"],
    verificationPlan: [
      { stage: "targeted", checkIds: ["targeted-check"] },
      { stage: "affected_area", checkIds: ["affected-check"] },
      { stage: "broad", checkIds: ["broad-check"] },
    ],
    artifactDigests: { "tasks.md": sha("tasks") },
    authorizationGrantRef: sha("authorization"),
    provenance: { actor: "apply-general", issuedAt: "2026-07-16T00:00:00.000Z" },
  });
  const finding = (severity: "critical" | "low"): FailureFindingInputV1 => ({
    batchId: batch.batchId,
    batchDigest: batch.digest,
    sourcePhase: "verify",
    sourceArtifact: "verify-report.md",
    severity,
    category: "e2e-repair",
    rootCause: "implementation",
    requirementIds: ["REQ-VERIFY-001"],
    taskIds: ["EG8-T2"],
    locationKeys: ["packages/sdd-runtime"],
    oracleId: "e2e-repair-finding",
    isSecurityRelevant: false,
    status: "open",
    relationship: "batch_related",
    evidence: [evidence("repair-finding")],
  });
  const manifest = (severity: "critical" | "low", producedAt: string) => buildFailureManifestV1({
    schema: "failure-manifest-v1",
    changeId: batch.changeId,
    batch,
    producerRole: "verify",
    producerInstanceId: "verify-repair",
    producedAt,
    findings: [finding(severity)],
  });
  const priorManifest = manifest("critical", "2026-07-15T00:00:00.000Z");
  const repairedManifest = manifest("low", "2026-07-16T00:00:00.000Z");
  const verification = buildStagedVerificationStateV1({
    schema: "staged-verification-state-v1",
    batchId: batch.batchId,
    stages: [
      { stage: "targeted", status: "pending", checkIds: ["targeted-check"], evidence: [] },
      { stage: "affected_area", status: "pending", checkIds: ["affected-check"], evidence: [] },
      { stage: "broad", status: "pending", checkIds: ["broad-check"], evidence: [] },
    ],
    nextStage: "targeted",
  });
  let dossier = createExecutionDossierV1({
    schema: "execution-dossier-v1",
    batch,
    priorManifest,
    currentManifest: repairedManifest,
    delta: computeFailureDeltaV1(priorManifest, repairedManifest),
    lane: {
      schema: "lane-decision-v1",
      lane: "guarded",
      riskScore: 30,
      floorReasons: [],
      policyOverrides: [],
      shadowOnly: false,
    },
    verification,
    causalContext: {
      schema: "causal-context-v1",
      batchDigest: batch.digest,
      priorDecisionDigests: [],
      activeFindingIds: repairedManifest.findings.map((entry) => entry.findingId),
      evidenceRefs: [],
      attemptSummaries: [{ attempt: 1, outcomeCode: "repair", artifact: "apply-progress.md" }],
    },
    registryIntents: [],
  });
  const runnerHost = createRunnerHostFixtureV1(runnerId, factory, { dossier });
  const repairOutcome = await runnerHost.bridge.execute(runnerHost.event());
  expect(repairOutcome.code).toBe("executed");
  expect(runnerHost.delegationCount()).toBe(1);
  if (!repairOutcome.composition) throw new Error("expected runner bridge composition");
  const repairPlan = repairOutcome.composition.plan;
  expect(repairPlan.decision?.action).toBe("targeted_repair");

  const clearedManifest = buildFailureManifestV1({
    schema: "failure-manifest-v1",
    changeId: batch.changeId,
    batch,
    producerRole: "verify",
    producerInstanceId: "verify-repair",
    producedAt: "2026-07-16T01:00:00.000Z",
    findings: [],
  });
  const ancestors: ExecutionDossierV1[] = [];
  let nextDossier = reviseExecutionDossierV1(dossier, {
    currentManifest: clearedManifest,
    delta: computeFailureDeltaV1(repairedManifest, clearedManifest),
    causalContext: {
      ...causalInput(dossier),
      priorDecisionDigests: [repairPlan.decision!.digest],
      activeFindingIds: [],
      attemptSummaries: [
        ...dossier.causalContext.attemptSummaries,
        { attempt: 2, outcomeCode: "repair-accepted", artifact: "verify-report.md" },
      ],
    },
  }, ancestors);
  ancestors.push(dossier);
  dossier = nextDossier;

  const stages = ["targeted", "affected_area"] as const;
  const acceptedStageJoins: Partial<Record<(typeof stages)[number], Exclude<VerificationStageExecutionJoinV1, { status: "incomplete" }>>> = {};
  const acceptedRoleResultDigests: Partial<Record<(typeof stages)[number], `sha256:${string}`>> = {};
  let priorVerify = "verify-repair";
  let currentPlan = plan(dossier, ancestors);
  for (let index = 0; index < stages.length; index += 1) {
    const agentInstanceId = `verify-stage-${index + 1}`;
    expect(currentPlan.decision?.action).toBe("advance_verification");
    expect(currentPlan.decision?.requiredVerificationStage).toBe(stages[index]);
    const scheduled = scheduleExecutionRoleInvocationV1(currentPlan, {
      role: "verify",
      agentInstanceId,
      freshness: freshness(agentInstanceId, priorVerify),
      verificationPlan: stagePlan(currentPlan),
    });
    expect(scheduled.code).toBe("scheduled");
    if (!("invocation" in scheduled)) throw new Error("expected scheduled Verify invocation");
    const consumed = consumeExecutionRoleResultV1(
      currentPlan,
      scheduled.invocation,
      passedResult(scheduled.invocation),
      verificationPolicy,
    );
    expect(consumed.code).toBe("accepted");
    if (consumed.code !== "accepted") throw new Error("expected accepted Verify result");
    if (!consumed.verification) throw new Error("expected advanced verification state");
    if (!consumed.verificationJoin || consumed.verificationJoin.status === "incomplete") throw new Error("expected completed stage join");
    acceptedStageJoins[stages[index]!] = consumed.verificationJoin;
    acceptedRoleResultDigests[stages[index]!] = consumed.result.digest;
    nextDossier = reviseExecutionDossierV1(dossier, {
      verification: consumed.verification,
      causalContext: {
        ...causalInput(dossier),
        priorDecisionDigests: [...dossier.causalContext.priorDecisionDigests, currentPlan.decision!.digest],
      },
    }, ancestors);
    ancestors.push(dossier);
    dossier = nextDossier;
    priorVerify = agentInstanceId;
    currentPlan = plan(dossier, ancestors);
  }

  expect(currentPlan.decision?.action).toBe("advance_verification");
  expect(currentPlan.decision?.requiredVerificationStage).toBe("broad");
  const review = scheduleExecutionRoleInvocationV1(currentPlan, {
    role: "review",
    agentInstanceId: "review-final",
    freshness: freshness("verify-review-proxy", priorVerify, "review-final"),
  });
  expect(review.code).toBe("scheduled");
  if (!("invocation" in review)) throw new Error("expected scheduled Review invocation");

  const registry = await registryFixture(batch.changeId);
  const intent = buildRegistryIntentV1({
    schema: "registry-intent-v1",
    idempotencyKey: sha("review-completion"),
    changeId: batch.changeId,
    batchId: batch.batchId,
    batchDigest: batch.digest,
    decisionDigest: currentPlan.decision!.digest,
    base: {
      stateDigest: registry.snapshot.stateDigest,
      eventsDigest: registry.snapshot.eventsDigest,
    },
    phase: "review",
    status: "completed",
    artifact: {
      kind: "review-report",
      path: "review-report.md",
      digest: sha(registry.reviewReport),
    },
    provenance: {
      agent: "review",
      model: "fixture-model",
      timestamp: "2026-07-16T12:00:00.000Z",
      note: "Fresh architecture and security review accepted",
    },
    event: {
      name: "review.completed",
      actor: "review",
      timestamp: "2026-07-16T12:00:00.000Z",
      notes: ["Fresh review accepted"],
    },
  });
  const reviewed = consumeExecutionRoleResultV1(
    currentPlan,
    review.invocation,
    passedResult(review.invocation, [intent]),
    verificationPolicy,
  );
  expect(reviewed.code).toBe("accepted");
  if (reviewed.code !== "accepted") throw new Error("expected accepted Review result");
  expect(reviewed.registryIntents).toEqual([intent]);

  currentPlan = plan(dossier, ancestors, "broad_pending", reviewed.result.reviewConvergence?.digest);
  const broad = scheduleExecutionRoleInvocationV1(currentPlan, {
    role: "verify",
    agentInstanceId: "verify-stage-3",
    freshness: freshness("verify-stage-3", priorVerify),
    verificationPlan: stagePlan(currentPlan),
  });
  expect(broad.code).toBe("scheduled");
  if (!("invocation" in broad)) throw new Error("expected scheduled BROAD invocation");
  const broadManifest = buildFailureManifestV1({
    schema: "failure-manifest-v1",
    changeId: batch.changeId,
    batch,
    producerRole: "verify",
    producerInstanceId: broad.invocation.agentInstanceId,
    findings: [],
    producedAt: "2026-07-16T12:00:00.000Z",
  });
  const broadened = consumeExecutionRoleResultV1(
    currentPlan,
    broad.invocation,
    passedResult(broad.invocation, [], broadManifest),
    verificationPolicy,
  );
  expect(broadened.code).toBe("accepted");
  if (broadened.code !== "accepted" || !broadened.verification) throw new Error("expected completed BROAD verification");
  if (!broadened.verificationJoin || broadened.verificationJoin.status === "incomplete") throw new Error("expected completed BROAD join");
  nextDossier = reviseExecutionDossierV1(dossier, {
    decision: currentPlan.decision,
    verification: broadened.verification,
    registryIntents: reviewed.registryIntents,
    causalContext: { ...causalInput(dossier), priorDecisionDigests: [...dossier.causalContext.priorDecisionDigests, currentPlan.decision!.digest] },
  }, ancestors);
  ancestors.push(dossier);
  dossier = nextDossier;
  currentPlan = plan(
    dossier,
    ancestors,
    "registry_commit_pending",
    broadened.result.broadCausalDisposition?.reviewDigest,
    broadened.result.broadCausalDisposition?.digest,
    {
      targetedJoinDigest: acceptedStageJoins.targeted!.digest,
      affectedAreaJoinDigest: acceptedStageJoins.affected_area!.digest,
      broadJoinDigest: broadened.verificationJoin.digest,
      targetedRoleResultDigest: acceptedRoleResultDigests.targeted!,
      affectedAreaRoleResultDigest: acceptedRoleResultDigests.affected_area!,
      reviewRoleResultDigest: reviewed.result.digest,
      broadRoleResultDigest: broadened.result.digest,
      broadVerificationDigest: broadened.result.dependencies.verificationDigest,
      registryIntentDigests: reviewed.registryIntents.map((entry) => entry.digest),
    },
  );
  if (
    !currentPlan.qaExecutionAuthority || !broadened.result.broadCausalDisposition || !broadened.result.qualityDisposition ||
    !reviewed.result.reviewConvergence
  ) throw new Error("expected quality readiness evidence");
  const readinessInput = {
    authority: currentPlan.qaExecutionAuthority,
    currentCandidate: currentPlan.qaExecutionAuthority.candidate,
    batch,
    review: reviewed.result.reviewConvergence,
    targetedJoin: acceptedStageJoins.targeted!,
    affectedAreaJoin: acceptedStageJoins.affected_area!,
    broadJoin: broadened.verificationJoin,
    broadManifest,
    qualityDisposition: broadened.result.qualityDisposition,
    disposition: broadened.result.broadCausalDisposition,
    roleResultDigests: {
      targeted: acceptedRoleResultDigests.targeted!,
      affectedArea: acceptedRoleResultDigests.affected_area!,
      review: reviewed.result.digest,
      broad: broadened.result.digest,
    },
    orderedIntents: reviewed.registryIntents,
  };
  const readiness = decideQualityReadinessV1(readinessInput);
  expect(readiness.kind).toBe("registry_commit_ready");

  const coordinator = createRegistryCoordinatorV1({
    mode: "centralized",
    store: registry.store,
    createTransactionId: () => "registry-tx-eg8-e2e",
  });
  expect((await commitExecutionRegistryIntentsV1(currentPlan, coordinator, readiness)).status).toBe("blocked");
  expect((await commitExecutionRegistryIntentsV1(currentPlan, {
    commit: async () => ({ code: "committed" }),
    commitAll: async () => [],
    commitAtomicChain: async () => ({
      outcomes: reviewed.registryIntents.map((entry) => ({
        code: "committed" as const,
        intentId: entry.intentId,
        transactionId: "forged-transaction",
        stateDigest: sha("forged-state"),
        eventsDigest: sha("forged-events"),
      })),
    }),
  }, readinessInput)).status).toBe("blocked");
  expect((await commitExecutionRegistryIntentsV1(currentPlan, coordinator, readinessInput)).status).toBe("committed");
  const stateAfterCommit = await fs.readFile(join(registry.directory, "state.yaml"), "utf8");
  const eventsAfterCommit = await fs.readFile(join(registry.directory, "events.yaml"), "utf8");
  expect((await commitExecutionRegistryIntentsV1(currentPlan, coordinator, readinessInput)).outcomes.map((outcome) => outcome.code)).toEqual(["replayed"]);
  expect(await fs.readFile(join(registry.directory, "state.yaml"), "utf8")).toBe(stateAfterCommit);
  expect(await fs.readFile(join(registry.directory, "events.yaml"), "utf8")).toBe(eventsAfterCommit);

  const pair = parseRegistryDocumentPairV1({
    stateSource: stateAfterCommit,
    eventsSource: eventsAfterCommit,
    expectedChangeId: batch.changeId,
  });
  expect(pair.state.source).toContain("# retained state history");
  expect(pair.events.source).toContain("# retained event history");
  expect(JSON.stringify(pair.events.data).match(new RegExp(intent.intentId, "g"))).toHaveLength(1);
  expect(dossier.batch.digest).toBe(batch.digest);
  expect(dossier.revision).toBe(5);
}
