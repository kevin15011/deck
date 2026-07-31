import { describe, expect, test } from "bun:test";
import { buildApplyBatchContractV1 } from "./apply-batch";
import { sha256Digest } from "./canonical";
import { createExecutionDossierV1 } from "./execution-dossier";
import {
  buildApplyPreflightReceiptV1,
  buildCandidateRefV1,
  buildProtectedRequirementSnapshotV1,
  buildQaAuthoritySnapshotV1,
  deriveQaImpactInvalidationV1,
  parseQaAuthoritySnapshotV1,
  validateCandidateRefV1,
} from "./qa-authority";
import { createQaConvergenceAuthorityFixtureV1 } from "../testing/qa-convergence-authority-fixture";

const digest = (value: string) => sha256Digest(value);
const batch = buildApplyBatchContractV1({ schema: "apply-batch-v1", changeId: "qa-authority", taskIds: ["T1"], dependencies: [], ownerRole: "apply-general", allowedTargets: ["packages/sdd-runtime"], blockedTargets: [], acceptanceObligations: ["REQ-1"], verificationPlan: [{ stage: "targeted", checkIds: ["unit"] }], artifactDigests: {}, authorizationGrantRef: digest("grant"), provenance: { actor: "orchestrator", issuedAt: "2026-07-30T00:00:00.000Z" } });
const dossier = createExecutionDossierV1({ schema: "execution-dossier-v1", batch, lane: { schema: "lane-decision-v1", lane: "guarded", riskScore: 1, floorReasons: [], policyOverrides: [], shadowOnly: false }, verification: { schema: "staged-verification-state-v1", batchId: batch.batchId, stages: [] }, causalContext: { schema: "causal-context-v1", batchDigest: batch.digest, priorDecisionDigests: [], activeFindingIds: [], evidenceRefs: [], attemptSummaries: [] }, registryIntents: [] });
const candidate = () => buildCandidateRefV1({
  implementationDigest: digest("implementation"), treeDigest: digest("tree"),
  dependencySetDigest: digest("dependencies"), requirementsDigest: digest("requirements"),
  environmentDigest: digest("environment"), checkPlanDigest: digest("checks"), generation: 1,
});

describe("QA authority contracts", () => {
  test("binds every quality artifact to one immutable candidate and rejects stale generations", () => {
    const current = candidate();
    expect(validateCandidateRefV1(current, { ...current, generation: 2 })).toEqual({ ok: false, code: "CANDIDATE_GENERATION_STALE" });
    expect(validateCandidateRefV1(current, current)).toEqual({ ok: true });
  });

  test("binds the sole QA action to a content-addressed convergence snapshot", () => {
    const subject = candidate();
    const convergence = createQaConvergenceAuthorityFixtureV1({ baseDossier: dossier, lifecycle: "review_pending", implementationSubjectDigest: subject.implementationDigest, dependencySetDigest: subject.dependencySetDigest });
    const snapshot = buildQaAuthoritySnapshotV1({
      candidate: subject,
      changeId: batch.changeId,
      convergence,
      freshness: { applyInstanceIds: ["apply-1"], verifyInstanceId: "verify-2", reviewInstanceId: "review-2", priorVerifyInstanceId: "verify-1", priorReviewInstanceId: "review-1", codeModifiedAfterVerify: true, reviewRequired: true, freshReviewTriggers: [], capabilities: { freshAgentScheduling: true, roleIsolation: true } },
      executionDossierDigest: dossier.digest,
      stagedVerificationDigest: dossier.verification.digest,
      protectedPolicyDigest: digest("protected-policy"),
      registryBase: { stateDigest: digest("state"), eventsDigest: digest("events") },
    });

    expect(parseQaAuthoritySnapshotV1(snapshot)).toEqual(snapshot);
    expect(() => parseQaAuthoritySnapshotV1({ ...snapshot, lifecycle: "affected_pending" })).toThrow("QA_AUTHORITY_STALE");
    expect(() => buildQaAuthoritySnapshotV1({
      candidate: subject,
      changeId: batch.changeId,
      convergence,
      freshness: snapshot.freshness,
      executionDossierDigest: digest("other-dossier"),
      stagedVerificationDigest: dossier.verification.digest,
      protectedPolicyDigest: digest("protected-policy"),
      registryBase: { stateDigest: digest("state"), eventsDigest: digest("events") },
    })).toThrow("QA_CONVERGENCE_DOSSIER_MISMATCH");
    expect(() => createQaConvergenceAuthorityFixtureV1({ baseDossier: dossier, lifecycle: "broad_pending", implementationSubjectDigest: subject.implementationDigest, dependencySetDigest: subject.dependencySetDigest }))
      .toThrow("QA_REVIEW_BINDING_REQUIRED");
  });

  test("blocks a critical plan when its preflight is missing, failed, or stale", () => {
    const subject = candidate();
    const receipt = buildApplyPreflightReceiptV1({ candidate: subject, status: "passed", criticalAssumptions: ["toolchain"], evidenceDigests: [digest("preflight")] });
    expect(receipt.candidateDigest).toBe(subject.digest);
    expect(() => buildApplyPreflightReceiptV1({ candidate: { ...subject, generation: 2 }, status: "passed", criticalAssumptions: ["toolchain"], evidenceDigests: [digest("preflight")] })).toThrow("CANDIDATE_GENERATION_STALE");
  });

  test("requires an official protected snapshot rather than self-agreeing caller maps", () => {
    const subject = candidate();
    expect(() => buildProtectedRequirementSnapshotV1({
      candidate: subject,
      officialArtifactDigests: { spec: digest("official-spec"), design: digest("official-design"), tasks: digest("official-tasks") },
      suppliedArtifactDigests: { spec: digest("old-spec"), design: digest("official-design"), tasks: digest("official-tasks") },
    })).toThrow("PROTECTED_REQUIREMENTS_RECONCILIATION_REQUIRED");
  });

  test("fails closed on every candidate change until selective impact has an authority", () => {
    const previous = candidate();
    const current = buildCandidateRefV1({
      generation: 2,
      implementationDigest: digest("implementation-2"),
      treeDigest: digest("tree-2"),
      dependencySetDigest: previous.dependencySetDigest,
      requirementsDigest: previous.requirementsDigest,
      environmentDigest: previous.environmentDigest,
      checkPlanDigest: previous.checkPlanDigest,
    });

    const invalidation = deriveQaImpactInvalidationV1({ previousCandidate: previous, currentCandidate: current });
    expect(invalidation.invalidatedStages).toEqual(["targeted", "affected_area", "review", "broad"]);
    expect(invalidation.reuseReceipts).toEqual([]);

    const requirementsChanged = buildCandidateRefV1({
      generation: 2,
      implementationDigest: previous.implementationDigest,
      treeDigest: previous.treeDigest,
      dependencySetDigest: previous.dependencySetDigest,
      requirementsDigest: digest("requirements-2"),
      environmentDigest: previous.environmentDigest,
      checkPlanDigest: previous.checkPlanDigest,
    });
    const protectedInvalidation = deriveQaImpactInvalidationV1({ previousCandidate: previous, currentCandidate: requirementsChanged });
    expect(protectedInvalidation.reason).toBe("protected_requirements_changed");
    expect(protectedInvalidation.invalidatedStages).toEqual(["targeted", "affected_area", "review", "broad"]);
  });
});
