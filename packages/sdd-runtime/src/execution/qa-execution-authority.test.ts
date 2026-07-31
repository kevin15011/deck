import { describe, expect, test } from "bun:test";
import { buildApplyBatchContractV1 } from "../contracts/apply-batch";
import { sha256Digest } from "../contracts/canonical";
import { createExecutionDossierV1 } from "../contracts/execution-dossier";
import { buildCandidateRefV1, buildQaAuthoritySnapshotV1 } from "../contracts/qa-authority";
import { createQaConvergenceAuthorityFixtureV1 } from "../testing/qa-convergence-authority-fixture";
import { decideQaNextActionV1, type QaConvergenceLifecycleV1 } from "./qa-execution-authority";

const digest = (value: string) => sha256Digest(value);
const candidate = buildCandidateRefV1({ generation: 1, implementationDigest: digest("implementation"), treeDigest: digest("tree"), dependencySetDigest: digest("deps"), requirementsDigest: digest("requirements"), environmentDigest: digest("environment"), checkPlanDigest: digest("plan") });
const batch = buildApplyBatchContractV1({ schema: "apply-batch-v1", changeId: "qa-authority", taskIds: ["T1"], dependencies: [], ownerRole: "apply-general", allowedTargets: ["packages/sdd-runtime"], blockedTargets: [], acceptanceObligations: ["REQ-1"], verificationPlan: [{ stage: "targeted", checkIds: ["unit"] }], artifactDigests: {}, authorizationGrantRef: digest("grant"), provenance: { actor: "orchestrator", issuedAt: "2026-07-30T00:00:00.000Z" } });
const dossier = createExecutionDossierV1({ schema: "execution-dossier-v1", batch, lane: { schema: "lane-decision-v1", lane: "guarded", riskScore: 1, floorReasons: [], policyOverrides: [], shadowOnly: false }, verification: { schema: "staged-verification-state-v1", batchId: batch.batchId, stages: [] }, causalContext: { schema: "causal-context-v1", batchDigest: batch.digest, priorDecisionDigests: [], activeFindingIds: [], evidenceRefs: [], attemptSummaries: [] }, registryIntents: [] });
const snapshot = (lifecycle: QaConvergenceLifecycleV1) => {
  if (lifecycle === "awaiting_apply_result" || lifecycle === "complete" || lifecycle === "routing_pending" || lifecycle === "repair_pending" || lifecycle === "diagnosis_pending" || lifecycle === "replan_required" || lifecycle === "escalated" || lifecycle === "stopped" || lifecycle === "recovery_required") throw new Error("unsupported test lifecycle");
  const convergence = createQaConvergenceAuthorityFixtureV1({ baseDossier: dossier, lifecycle, implementationSubjectDigest: candidate.implementationDigest, dependencySetDigest: candidate.dependencySetDigest, ...(lifecycle === "broad_pending" || lifecycle === "registry_commit_pending" ? { reviewDigest: digest("review") } : {}), ...(lifecycle === "registry_commit_pending" ? { broadDigest: digest("broad") } : {}) });
  return buildQaAuthoritySnapshotV1({ candidate, changeId: batch.changeId, convergence, freshness: { applyInstanceIds: ["apply-1"], verifyInstanceId: "verify-2", reviewInstanceId: "review-2", priorVerifyInstanceId: "verify-1", priorReviewInstanceId: "review-1", codeModifiedAfterVerify: true, reviewRequired: true, freshReviewTriggers: [], capabilities: { freshAgentScheduling: true, roleIsolation: true } }, executionDossierDigest: dossier.digest, stagedVerificationDigest: dossier.verification.digest, protectedPolicyDigest: digest("protected-policy"), registryBase: { stateDigest: digest("state"), eventsDigest: digest("events") } });
};

describe("QA execution authority", () => {
  test("uses convergence lifecycle rather than a caller-selected role", () => {
    expect(decideQaNextActionV1({ snapshot: snapshot("affected_pending") })).toMatchObject({ kind: "run_verify_stage", stage: "affected_area" });
    expect(decideQaNextActionV1({ snapshot: snapshot("review_pending") })).toMatchObject({ kind: "run_review" });
    expect(decideQaNextActionV1({ snapshot: snapshot("broad_pending") })).toMatchObject({ kind: "run_verify_stage", stage: "broad" });
  });
});
