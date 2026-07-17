import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";

import { buildApplyBatchContractV1 } from "../contracts/apply-batch";
import { createExecutionDossierV1 } from "../contracts/execution-dossier";
import { buildStagedVerificationStateV1 } from "../contracts/verification-state";
import type { FreshnessPolicyInputV1 } from "../orchestrator/freshness-policy";
import {
  consumeExecutionRoleResultV1,
  planExecutionDecisionV1,
  scheduleExecutionRoleInvocationV1,
  type DecisionKernelModeV1,
  type ExecutionRoleInvocationV1,
} from "./execution-control-plane";

const sha = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}` as const;
const evidence = (checkId: string) => ({ kind: "check", checkId, artifact: "verify-report.md", resultCode: "passed" });

function createPlan(mode: Exclude<DecisionKernelModeV1, "legacy">, completed = false) {
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
    artifactDigests: { "tasks.md": sha("tasks") },
    authorizationGrantRef: sha("authorization"),
    provenance: { actor: "apply-general", issuedAt: "2026-07-16T00:00:00.000Z" },
  });
  const verification = buildStagedVerificationStateV1({
    schema: "staged-verification-state-v1",
    batchId: batch.batchId,
    stages: completed
      ? [
          { stage: "targeted", status: "passed", checkIds: ["targeted-check"], evidence: [evidence("targeted-check")] },
          { stage: "affected_area", status: "passed", checkIds: ["affected-check"], evidence: [evidence("affected-check")] },
          { stage: "broad", status: "passed", checkIds: ["broad-check"], evidence: [evidence("broad-check")] },
        ]
      : [
          { stage: "targeted", status: "passed", checkIds: ["targeted-check"], evidence: [evidence("targeted-check")] },
          { stage: "affected_area", status: "pending", checkIds: ["affected-check"], evidence: [] },
          { stage: "broad", status: "pending", checkIds: ["broad-check"], evidence: [] },
        ],
    ...(completed ? {} : { nextStage: "affected_area" as const }),
  });
  const dossier = createExecutionDossierV1({
    schema: "execution-dossier-v1",
    batch,
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
  return planExecutionDecisionV1(
    mode,
    dossier,
    { state: "authorized", capabilityDigest: sha("capability"), reference: { validation: "accepted" } },
    { state: "not-required", policyDigest: sha("policy") },
    { kind: "none" },
    { kind: "none" },
  );
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

function passedResult(invocation: ExecutionRoleInvocationV1) {
  return {
    schema: "execution-role-result-v1",
    invocationId: invocation.invocationId,
    role: invocation.role,
    agentInstanceId: invocation.agentInstanceId,
    batchId: invocation.batchId,
    ...(invocation.stage === undefined ? {} : { stage: invocation.stage }),
    status: "passed",
    evidence: [evidence(invocation.checkIds[0]!)],
    provenance: {
      role: invocation.role,
      agentInstanceId: invocation.agentInstanceId,
      issuedAt: "2026-07-16T01:00:00.000Z",
    },
    dependencies: invocation.dependencies,
    registryIntents: [],
  };
}

const verificationPolicy = {
  lane: "guarded" as const,
  broadRequired: true,
  mandatoryBroadReasons: [],
  broadDeferralPolicyIds: [],
};

describe("execution role scheduler", () => {
  test("schedules the actual next Verify stage with redacted causal context", () => {
    const scheduled = scheduleExecutionRoleInvocationV1(createPlan("active"), {
      role: "verify",
      agentInstanceId: "verify-2",
      freshness: freshness(),
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
    });
    if (!("invocation" in scheduled)) throw new Error("expected invocation");
    const consumed = consumeExecutionRoleResultV1(plan, scheduled.invocation, passedResult(scheduled.invocation), verificationPolicy);
    expect(consumed.code).toBe("accepted");
    if (!("verification" in consumed)) throw new Error("expected verification state");
    expect(consumed.verification?.nextStage).toBe("broad");
    expect(consumed.verification?.stages[1]?.status).toBe("passed");
  });

  test("fails closed for identity collisions and missing host capabilities", () => {
    expect(scheduleExecutionRoleInvocationV1(createPlan("active"), {
      role: "verify",
      agentInstanceId: "apply-1",
      freshness: freshness({ verifyInstanceId: "apply-1" }),
    }).code).toBe("verification-evidence-required");
    expect(scheduleExecutionRoleInvocationV1(createPlan("active"), {
      role: "verify",
      agentInstanceId: "verify-2",
      freshness: freshness({ capabilities: { freshAgentScheduling: false, roleIsolation: true } }),
    }).code).toBe("lane-floor-violation");
  });

  test("rejects a result whose dependency binding was forged", () => {
    const plan = createPlan("active");
    const scheduled = scheduleExecutionRoleInvocationV1(plan, {
      role: "verify",
      agentInstanceId: "verify-2",
      freshness: freshness(),
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
    const plan = createPlan("active", true);
    const scheduled = scheduleExecutionRoleInvocationV1(plan, {
      role: "review",
      agentInstanceId: "review-2",
      freshness: freshness({ codeModifiedAfterVerify: false }),
      reviewCheckIds: ["independent-review"],
    });
    expect(scheduled.code).toBe("scheduled");
    if (!("invocation" in scheduled)) throw new Error("expected invocation");
    expect(scheduled.invocation.stage).toBeUndefined();
    expect(consumeExecutionRoleResultV1(plan, scheduled.invocation, passedResult(scheduled.invocation), verificationPolicy).code)
      .toBe("accepted");
  });

  test("derives mandatory Guarded Review even when the caller omits the policy hint", () => {
    const scheduled = scheduleExecutionRoleInvocationV1(createPlan("active", true), {
      role: "review",
      agentInstanceId: "review-2",
      freshness: freshness({ codeModifiedAfterVerify: false, reviewRequired: false }),
      reviewCheckIds: ["independent-review"],
    });
    expect(scheduled.code).toBe("scheduled");
  });

  test("does not accept Review without evidence for every scheduled check", () => {
    const plan = createPlan("active", true);
    const scheduled = scheduleExecutionRoleInvocationV1(plan, {
      role: "review",
      agentInstanceId: "review-2",
      freshness: freshness({ codeModifiedAfterVerify: false }),
      reviewCheckIds: ["independent-review"],
    });
    if (!("invocation" in scheduled)) throw new Error("expected invocation");
    expect(consumeExecutionRoleResultV1(plan, scheduled.invocation, {
      ...passedResult(scheduled.invocation),
      evidence: [],
    }, verificationPolicy).code).toBe("verification-evidence-required");
  });

  test("does not let Review consume a verification policy below the dossier lane", () => {
    const plan = createPlan("active", true);
    const scheduled = scheduleExecutionRoleInvocationV1(plan, {
      role: "review",
      agentInstanceId: "review-2",
      freshness: freshness({ codeModifiedAfterVerify: false }),
      reviewCheckIds: ["independent-review"],
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
