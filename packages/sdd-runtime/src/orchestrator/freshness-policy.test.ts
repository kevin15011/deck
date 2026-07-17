import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";

import { buildApplyBatchContractV1 } from "../contracts/apply-batch";
import { createExecutionDossierV1 } from "../contracts/execution-dossier";
import { buildCausalContextV1 } from "../contracts/causal-context";
import { evaluateFreshnessPolicyV1, projectCausalContextForRoleV1, type FreshReviewTriggerV1 } from "./freshness-policy";

const sha = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}` as const;
const base = () => ({
  applyInstanceIds: ["apply:1"],
  verifyInstanceId: "verify:1",
  reviewInstanceId: "review:1",
  codeModifiedAfterVerify: false,
  reviewRequired: true,
  freshReviewTriggers: [] as FreshReviewTriggerV1[],
  capabilities: { freshAgentScheduling: true, roleIsolation: true },
});

describe("freshness and role independence", () => {
  test("accepts independent Apply, Verify, and Review identities", () => {
    expect(evaluateFreshnessPolicyV1(base())).toEqual({
      code: "accepted",
      freshVerifyRequired: false,
      freshReviewRequired: true,
      rationaleCodes: [],
    });
  });

  test("rejects identity collisions and stale post-modification Verify", () => {
    expect(evaluateFreshnessPolicyV1({ ...base(), verifyInstanceId: "apply:1" }).rationaleCodes)
      .toContain("APPLY_VERIFY_IDENTITY_COLLISION");
    expect(evaluateFreshnessPolicyV1({ ...base(), reviewInstanceId: "verify:1" }).rationaleCodes)
      .toContain("REVIEW_IDENTITY_COLLISION");
    const stale = evaluateFreshnessPolicyV1({ ...base(), codeModifiedAfterVerify: true, priorVerifyInstanceId: "verify:1" });
    expect(stale.code).toBe("verification-evidence-required");
    expect(stale.rationaleCodes).toContain("FRESH_VERIFY_REQUIRED");
  });

  test("requires fresh final Review for every incident and material trigger", () => {
    const triggers: FreshReviewTriggerV1[] = [
      "incident", "security_finding", "architecture_finding", "authorization_rejection",
      "generated_artifact_correction", "public_contract_repair", "migration_repair",
      "cross_package_repair", "multi_package_repair", "material_repair", "high_risk_repair",
    ];
    for (const trigger of triggers) {
      const stale = evaluateFreshnessPolicyV1({ ...base(), freshReviewTriggers: [trigger], priorReviewInstanceId: "review:1" });
      expect(stale.code).toBe("verification-evidence-required");
      expect(stale.rationaleCodes).toContain("FRESH_REVIEW_REQUIRED");
      const fresh = evaluateFreshnessPolicyV1({ ...base(), freshReviewTriggers: [trigger], priorReviewInstanceId: "review:old" });
      expect(fresh.code).toBe("accepted");
    }
  });

  test("remains shadow and raises to Full-SDD when capability proof is absent", () => {
    const outcome = evaluateFreshnessPolicyV1({
      ...base(),
      codeModifiedAfterVerify: true,
      priorVerifyInstanceId: "verify:old",
      capabilities: { freshAgentScheduling: false, roleIsolation: false },
    });
    expect(outcome.code).toBe("shadow-full-sdd");
    expect(outcome.rationaleCodes).toContain("FRESH_AGENT_SCHEDULING_UNPROVEN");
    expect(outcome.rationaleCodes).toContain("ROLE_ISOLATION_UNPROVEN");
  });

  test("requires proof of the prior Verify and fresh scheduling for required Review", () => {
    const unknownPrior = evaluateFreshnessPolicyV1({ ...base(), codeModifiedAfterVerify: true });
    expect(unknownPrior.code).toBe("verification-evidence-required");
    expect(unknownPrior.rationaleCodes).toContain("PRIOR_VERIFY_IDENTITY_REQUIRED");

    const unsupportedReview = evaluateFreshnessPolicyV1({
      ...base(),
      capabilities: { freshAgentScheduling: false, roleIsolation: true },
    });
    expect(unsupportedReview.code).toBe("shadow-full-sdd");
    expect(unsupportedReview.rationaleCodes).toContain("FRESH_AGENT_SCHEDULING_UNPROVEN");
  });
});

test("causal projection retains safe dossier evidence without sharing Apply attempt summaries", () => {
  const batch = buildApplyBatchContractV1({
    schema: "apply-batch-v1",
    changeId: "freshness-projection",
    taskIds: ["EG6-T1"],
    dependencies: [],
    ownerRole: "apply-general",
    allowedTargets: ["packages/sdd-runtime/src/orchestrator/freshness-policy.ts"],
    blockedTargets: ["openspec/archive"],
    acceptanceObligations: ["REQ-VERIFY-003"],
    verificationPlan: [{ stage: "targeted", checkIds: ["freshness"] }],
    artifactDigests: { "tasks.md": sha("tasks") },
    authorizationGrantRef: sha("authorization"),
    provenance: { actor: "apply-general", issuedAt: "2026-07-16T00:00:00.000Z" },
  });
  const causalContext = buildCausalContextV1({
    schema: "causal-context-v1",
    batchDigest: batch.digest,
    priorDecisionDigests: [sha("decision")],
    activeFindingIds: [],
    evidenceRefs: [{ kind: "check", checkId: "failed-check", artifact: "verify-report.md", resultCode: "failed" }],
    attemptSummaries: [{ attempt: 1, outcomeCode: "repair", artifact: "apply-progress.md" }],
  });
  const dossier = createExecutionDossierV1({
    schema: "execution-dossier-v1",
    batch,
    lane: { schema: "lane-decision-v1", lane: "guarded", riskScore: 40, floorReasons: [], policyOverrides: [], shadowOnly: false },
    verification: { schema: "staged-verification-state-v1", batchId: batch.batchId, stages: [] },
    causalContext,
    registryIntents: [],
  });
  expect(projectCausalContextForRoleV1(dossier, "apply")).toEqual(dossier.causalContext);
  const verify = projectCausalContextForRoleV1(dossier, "verify");
  const review = projectCausalContextForRoleV1(dossier, "review");
  expect(verify.evidenceRefs).toEqual(causalContext.evidenceRefs);
  expect(verify.attemptSummaries).toEqual([]);
  expect(review.attemptSummaries).toEqual([]);
  expect(JSON.stringify(review)).not.toContain("transcript");
});
