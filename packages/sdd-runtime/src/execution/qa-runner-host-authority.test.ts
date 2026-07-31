import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";

import { buildApplyBatchContractV1 } from "../contracts/apply-batch";
import { sha256Digest } from "../contracts/canonical";
import { createExecutionDossierV1 } from "../contracts/execution-dossier";
import { buildCandidateRefV1, buildQaAuthoritySnapshotV1 } from "../contracts/qa-authority";
import { buildVerificationCheckResultV1, buildVerificationStageExecutionPlanV1 } from "../contracts/verification-stage-execution";
import { buildStagedVerificationStateV1 } from "../contracts/verification-state";
import { buildReviewConvergenceResultV1 } from "../orchestrator/broad-causal-disposition";
import type { FreshnessPolicyInputV1 } from "../orchestrator/freshness-policy";
import type { StagedVerificationPolicyV1 } from "../orchestrator/staged-verification";
import { createQaConvergenceAuthorityFixtureV1 } from "../testing/qa-convergence-authority-fixture";
import {
  bindExecutionPlanQaAuthorityV1,
  planExecutionDecisionV1,
  scheduleExecutionRoleInvocationV1,
  type ExecutionPlanV1,
  type ExecutionRoleInvocationV1,
} from "./execution-control-plane";
import {
  createQaRunnerHostAuthorityV1,
  type QaRunnerHostExecutionContextV1,
} from "./qa-runner-host-authority";

const sha = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}` as const;
const evidence = (checkId: string) => ({ kind: "check" as const, checkId, artifact: "verify-report.md", resultCode: "passed" });

function freshness(): FreshnessPolicyInputV1 {
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
  };
}

const verificationPolicy: StagedVerificationPolicyV1 = {
  lane: "guarded",
  broadRequired: true,
  mandatoryBroadReasons: [],
  broadDeferralPolicyIds: [],
};

function createContext(stage: "affected_area" | "broad" = "affected_area"): QaRunnerHostExecutionContextV1 {
  const batch = buildApplyBatchContractV1({
    schema: "apply-batch-v1",
    changeId: "qa-host",
    taskIds: ["QA-HOST-T1"],
    dependencies: [],
    ownerRole: "apply-general",
    allowedTargets: ["packages/sdd-runtime"],
    blockedTargets: ["openspec/archive"],
    acceptanceObligations: ["REQ-QA-HOST-001"],
    verificationPlan: [
      { stage: "targeted", checkIds: ["targeted-check"] },
      { stage: "affected_area", checkIds: ["affected-check"] },
      { stage: "broad", checkIds: ["broad-check"] },
    ],
    artifactDigests: { "tasks.md": sha("tasks") },
    authorizationGrantRef: sha("authorization"),
    provenance: { actor: "apply-general", issuedAt: "2026-07-30T00:00:00.000Z" },
  });
  const verification = buildStagedVerificationStateV1({
    schema: "staged-verification-state-v1",
    batchId: batch.batchId,
    stages: stage === "broad"
      ? [
          { stage: "targeted", status: "passed", checkIds: ["targeted-check"], evidence: [evidence("targeted-check")] },
          { stage: "affected_area", status: "passed", checkIds: ["affected-check"], evidence: [evidence("affected-check")] },
          { stage: "broad", status: "pending", checkIds: ["broad-check"], evidence: [] },
        ]
      : [
          { stage: "targeted", status: "passed", checkIds: ["targeted-check"], evidence: [evidence("targeted-check")] },
          { stage: "affected_area", status: "pending", checkIds: ["affected-check"], evidence: [] },
          { stage: "broad", status: "pending", checkIds: ["broad-check"], evidence: [] },
        ],
    nextStage: stage,
  });
  const dossier = createExecutionDossierV1({
    schema: "execution-dossier-v1",
    batch,
    lane: { schema: "lane-decision-v1", lane: "guarded", riskScore: 30, floorReasons: [], policyOverrides: [], shadowOnly: false },
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
  const basePlan = planExecutionDecisionV1(
    "active",
    dossier,
    { state: "authorized", capabilityDigest: sha("capability"), reference: { validation: "accepted" } },
    { state: "not-required", policyDigest: sha("policy") },
    { kind: "none" },
    { kind: "none" },
  );
  const candidate = buildCandidateRefV1({
    generation: 1,
    implementationDigest: sha(`implementation:${dossier.digest}`),
    treeDigest: sha(`tree:${dossier.digest}`),
    dependencySetDigest: sha(`dependencies:${dossier.digest}`),
    requirementsDigest: sha(`requirements:${batch.digest}`),
    environmentDigest: sha("environment"),
    checkPlanDigest: sha(`checks:${verification.digest}`),
  });
  const review = buildReviewConvergenceResultV1({
    candidate,
    checklistDigest: sha256Digest({ candidateCheckPlanDigest: candidate.checkPlanDigest, reviewCheckIds: ["architecture-review", "security-review"] }),
    findingSetDigest: sha256Digest([]),
    complete: true,
    findings: [],
  });
  const convergence = createQaConvergenceAuthorityFixtureV1({
    baseDossier: dossier,
    lifecycle: stage === "broad" ? "broad_pending" : "affected_pending",
    implementationSubjectDigest: candidate.implementationDigest,
    dependencySetDigest: candidate.dependencySetDigest,
    ...(stage === "broad" ? { reviewDigest: review.digest } : {}),
  });
  const plan = bindExecutionPlanQaAuthorityV1(basePlan, buildQaAuthoritySnapshotV1({
    candidate,
    changeId: batch.changeId,
    convergence,
    freshness: freshness(),
    executionDossierDigest: dossier.digest,
    stagedVerificationDigest: verification.digest,
    protectedPolicyDigest: sha("protected-policy"),
    registryBase: { stateDigest: sha("registry-state"), eventsDigest: sha("registry-events") },
  }));
  const checkId = stage === "broad" ? "broad-check" : "affected-check";
  const verificationPlan = buildVerificationStageExecutionPlanV1({
    stage,
    qaAuthorityDigest: plan.qaExecutionAuthority!.digest,
    generation: plan.qaExecutionAuthority!.generation,
    implementationSubjectDigest: plan.qaExecutionAuthority!.implementationSubjectDigest,
    dependencySetDigest: plan.qaExecutionAuthority!.dependencySetDigest,
    checks: [{
      checkId,
      capabilityDigest: sha(`capability:${checkId}`),
      commandPlanDigest: sha(`command:${checkId}`),
      effectProfile: { kind: "repository_read_only" },
      dependencyCheckIds: [],
      exclusiveResourceKeys: [],
    }],
  });
  return { plan, agentInstanceId: "verify-2", freshness: freshness(), candidate, verificationPlan, verificationPolicy };
}

function scheduledInvocation(context: QaRunnerHostExecutionContextV1): ExecutionRoleInvocationV1 {
  const scheduled = scheduleExecutionRoleInvocationV1(context.plan, {
    role: "verify",
    agentInstanceId: context.agentInstanceId,
    freshness: context.freshness,
    currentCandidate: context.candidate,
    verificationPlan: context.verificationPlan,
  });
  if (scheduled.code !== "scheduled") throw new Error("test scheduling failed");
  return scheduled.invocation;
}

function executorFor(invocation: ExecutionRoleInvocationV1, onExecute?: () => void) {
  const identity = sha256Digest({ invocationId: invocation.invocationId, role: invocation.role, agentInstanceId: invocation.agentInstanceId });
  return {
    execute(plan: NonNullable<ExecutionRoleInvocationV1["verificationPlan"]>, descriptor: NonNullable<ExecutionRoleInvocationV1["verificationPlan"]>["checks"][number]) {
      onExecute?.();
      return buildVerificationCheckResultV1(plan, {
        checkId: descriptor.checkId,
        producerIdentityDigest: identity,
        outcome: { kind: "completed", status: "passed", evidence: [evidence(descriptor.checkId)] },
      });
    },
  };
}

function resultFor(prepared: Awaited<ReturnType<ReturnType<typeof createQaRunnerHostAuthorityV1>["prepare"]>>) {
  const { invocation, verificationExecution } = prepared.reference;
  if (!verificationExecution) throw new Error("verification execution required");
  const payload = {
    schema: "execution-role-result-v1" as const,
    invocationId: invocation.invocationId,
    role: invocation.role,
    agentInstanceId: invocation.agentInstanceId,
    batchId: invocation.batchId,
    ...(invocation.stage === undefined ? {} : { stage: invocation.stage }),
    status: "passed" as const,
    evidence: verificationExecution.results.flatMap((entry) => entry.outcome.evidence),
    verificationCheckResults: verificationExecution.results,
    verificationWaveReceipts: verificationExecution.receipts,
    provenance: { role: invocation.role, agentInstanceId: invocation.agentInstanceId, issuedAt: "2026-07-30T01:00:00.000Z" },
    dependencies: invocation.dependencies,
    registryIntents: [],
  };
  return { ...payload, digest: sha256Digest(payload) };
}

describe("QA runner host authority", () => {
  test("rejects a requested role that differs from lifecycle authority", async () => {
    const context = createContext();
    const authority = createQaRunnerHostAuthorityV1({
      resolveContext: () => ({ ...context, verificationPlan: undefined, verificationCheckExecutor: undefined }),
      recordConsumption: () => undefined,
    });

    await expect(authority.prepare({ runnerId: "opencode", sessionId: "session-1", invocationId: "call-1", requestedRole: "review" }))
      .rejects.toThrow("QA_HOST_ROLE_NOT_AUTHORIZED");
  });

  test("executes trusted Verify checks and returns a frozen prepared reference", async () => {
    const context = createContext();
    let executions = 0;
    const invocation = scheduledInvocation(context);
    const authority = createQaRunnerHostAuthorityV1({
      resolveContext: () => ({ ...context, verificationCheckExecutor: executorFor(invocation, () => { executions += 1; }) }),
      recordConsumption: () => undefined,
    });

    const prepared = await authority.prepare({ runnerId: "opencode", sessionId: "session-1", invocationId: "call-1", requestedRole: "verify" });

    expect(executions).toBe(1);
    expect(Object.isFrozen(prepared)).toBe(true);
    expect(Object.isFrozen(prepared.reference)).toBe(true);
    expect(Object.isFrozen(prepared.reference.verificationExecution)).toBe(true);
    expect(prepared.digest).toBe(prepared.reference.digest);
  });

  test("rejects tampered executor evidence before control-plane consumption", async () => {
    const context = createContext();
    let recordings = 0;
    const invocation = scheduledInvocation(context);
    const authority = createQaRunnerHostAuthorityV1({
      resolveContext: () => ({ ...context, verificationCheckExecutor: executorFor(invocation) }),
      recordConsumption: () => { recordings += 1; },
    });
    const prepared = await authority.prepare({ runnerId: "opencode", sessionId: "session-1", invocationId: "call-1", requestedRole: "verify" });
    const result = resultFor(prepared);

    await expect(authority.consume(prepared.reference, { ...result, verificationCheckResults: [] })).rejects.toThrow("QA_HOST_EXECUTION_EVIDENCE_MISMATCH");
    expect(recordings).toBe(0);
  });

  test("accepts only the exact prepared reference once", async () => {
    const context = createContext();
    let recordings = 0;
    const invocation = scheduledInvocation(context);
    const authority = createQaRunnerHostAuthorityV1({
      resolveContext: () => ({ ...context, verificationCheckExecutor: executorFor(invocation) }),
      recordConsumption: () => { recordings += 1; },
    });
    const prepared = await authority.prepare({ runnerId: "opencode", sessionId: "session-1", invocationId: "call-1", requestedRole: "verify" });
    const result = resultFor(prepared);

    await expect(authority.consume({ ...prepared.reference }, result)).rejects.toThrow("QA_HOST_REFERENCE_INVALID");
    expect((await authority.consume(prepared.reference, result)).code).toBe("accepted");
    await expect(authority.consume(prepared.reference, result)).rejects.toThrow("QA_HOST_REFERENCE_REPLAYED");
    await expect(authority.prepare({ runnerId: "opencode", sessionId: "session-1", invocationId: "call-1", requestedRole: "verify" }))
      .rejects.toThrow("QA_HOST_DUPLICATE_PREPARE");
    expect(recordings).toBe(1);
  });

  test("fails closed when trusted evidence wraps a control-plane-invalid result", async () => {
    const context = createContext();
    let recordings = 0;
    const invocation = scheduledInvocation(context);
    const authority = createQaRunnerHostAuthorityV1({
      resolveContext: () => ({ ...context, verificationCheckExecutor: executorFor(invocation) }),
      recordConsumption: () => { recordings += 1; },
    });
    const prepared = await authority.prepare({ runnerId: "opencode", sessionId: "session-1", invocationId: "call-invalid", requestedRole: "verify" });
    const result = resultFor(prepared);

    await expect(authority.consume(prepared.reference, { ...result, digest: sha("invalid-role-result") }))
      .rejects.toThrow("QA_HOST_CONTROL_PLANE_FAILED");
    expect(recordings).toBe(0);
  });

  test("invalidates all pending references when a session is cleared", async () => {
    const context = createContext();
    let cleared = 0;
    const invocation = scheduledInvocation(context);
    const authority = createQaRunnerHostAuthorityV1({
      resolveContext: () => ({ ...context, verificationCheckExecutor: executorFor(invocation) }),
      recordConsumption: () => undefined,
      clearSession: () => { cleared += 1; },
    });
    const prepared = await authority.prepare({ runnerId: "pi", sessionId: "session-1", invocationId: "call-1", requestedRole: "verify" });

    authority.clearSession("session-1");

    expect(cleared).toBe(1);
    await expect(authority.consume(prepared.reference, resultFor(prepared))).rejects.toThrow("QA_HOST_SESSION_CLEARED");
  });

  test("runs the trusted BROAD finalizer only after the checks complete", async () => {
    const context = createContext("broad");
    const events: string[] = [];
    const invocation = scheduledInvocation(context);
    const authority = createQaRunnerHostAuthorityV1({
      resolveContext: () => ({
        ...context,
        verificationCheckExecutor: executorFor(invocation, () => { events.push("check"); }),
        broadFailureManifestFinalizer: {
          finalize: () => {
            events.push("finalizer");
            return Object.freeze({ schema: "failure-manifest-v1", digest: sha("raw-failure-manifest") });
          },
        },
      }),
      recordConsumption: () => undefined,
    });

    const prepared = await authority.prepare({ runnerId: "opencode", sessionId: "session-1", invocationId: "call-1", requestedRole: "verify" });

    expect(events).toEqual(["check", "finalizer"]);
    const execution = prepared.reference.verificationExecution;
    if (!execution || execution.join.status === "incomplete") throw new Error("broad execution join required");
    expect(execution.join.rawFailureManifestDigest).toBe(sha("raw-failure-manifest"));
    expect(execution.failureManifest).toEqual({ schema: "failure-manifest-v1", digest: sha("raw-failure-manifest") });
  });
});
