import { afterEach, expect } from "bun:test";
import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseRegistryDocumentPairV1 } from "@deck/core/spec-registry";

import { createFileSystemRegistryStoreV1 } from "../artifact-state/filesystem-registry-store";
import { createRegistryCoordinatorV1 } from "../artifact-state/registry-coordinator";
import { buildApplyBatchContractV1 } from "../contracts/apply-batch";
import { createExecutionDossierV1, reviseExecutionDossierV1, type ExecutionDossierV1 } from "../contracts/execution-dossier";
import { buildFailureManifestV1, type FailureFindingInputV1 } from "../contracts/failure-manifest";
import { buildRegistryIntentV1 } from "../contracts/registry-intent";
import { buildStagedVerificationStateV1 } from "../contracts/verification-state";
import { computeFailureDeltaV1 } from "../orchestrator/failure-delta";
import type { FreshnessPolicyInputV1 } from "../orchestrator/freshness-policy";
import { createRunnerHostFixtureV1, type BridgeFactory, type RunnerId } from "./developer-team-runner-host-fixture";
import {
  consumeExecutionRoleResultV1,
  planExecutionDecisionV1,
  scheduleExecutionRoleInvocationV1,
  type ExecutionPlanV1,
  type ExecutionRoleInvocationV1,
} from "../execution/execution-control-plane";

const roots: string[] = [];
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
): ExecutionPlanV1 {
  return planExecutionDecisionV1(
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

function passedResult(
  invocation: ExecutionRoleInvocationV1,
  registryIntents: readonly ReturnType<typeof buildRegistryIntentV1>[] = [],
) {
  return {
    schema: "execution-role-result-v1",
    invocationId: invocation.invocationId,
    role: invocation.role,
    agentInstanceId: invocation.agentInstanceId,
    batchId: invocation.batchId,
    ...(invocation.stage === undefined ? {} : { stage: invocation.stage }),
    status: "passed",
    evidence: invocation.checkIds.map((checkId) => evidence(
      checkId,
      invocation.role === "review" ? "review-report.md" : "verify-report.md",
    )),
    provenance: {
      role: invocation.role,
      agentInstanceId: invocation.agentInstanceId,
      issuedAt: "2026-07-16T12:00:00.000Z",
    },
    dependencies: invocation.dependencies,
    registryIntents,
  };
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

  const stages = ["targeted", "affected_area", "broad"] as const;
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

  expect(currentPlan.decision?.action).toBe("complete");
  const review = scheduleExecutionRoleInvocationV1(currentPlan, {
    role: "review",
    agentInstanceId: "review-final",
    freshness: freshness(priorVerify, "verify-stage-2", "review-final"),
    reviewCheckIds: ["architecture-review", "security-review"],
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

  const coordinator = createRegistryCoordinatorV1({
    mode: "centralized",
    store: registry.store,
    createTransactionId: () => "registry-tx-eg8-e2e",
  });
  expect((await coordinator.commitAll(reviewed.registryIntents)).map((outcome) => outcome.code)).toEqual(["committed"]);
  const stateAfterCommit = await fs.readFile(join(registry.directory, "state.yaml"), "utf8");
  const eventsAfterCommit = await fs.readFile(join(registry.directory, "events.yaml"), "utf8");
  expect((await coordinator.commitAll(reviewed.registryIntents)).map((outcome) => outcome.code)).toEqual(["replayed"]);
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
