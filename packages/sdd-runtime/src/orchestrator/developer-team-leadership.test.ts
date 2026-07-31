import { describe, expect, test } from "bun:test";

import { buildApprovalReceiptV1 } from "../contracts/approval-receipt";
import { buildAuthoritativeOutcomeV1 } from "../contracts/authoritative-outcome";
import type { Sha256Digest } from "../contracts/canonical";
import { buildApplyPreflightReceiptV1, buildCandidateRefV1 } from "../contracts/qa-authority";
import { decideDeveloperTeamLeadershipV1 } from "./developer-team-leadership";

const digest = (value: string) => `sha256:${value.repeat(64).slice(0, 64)}` as Sha256Digest;
const posture = {
  uncertaintyResolved: true,
  decisionEnabled: true,
  materialRiskReduced: true,
  expectedCoordinationBenefit: 1,
  expectedCoordinationCost: 5,
  equallySafeDirectPathAvailable: true,
  safetyLane: "fast" as const,
};

describe("developer team leadership authority", () => {
  test("small reversible work takes the direct path without process artifacts", () => {
    const decision = decideDeveloperTeamLeadershipV1({
      posture,
      work: [{ id: "small-fix", writes: ["button.tsx"] }],
    });
    expect(decision.action).toBe("start_direct");
    expect(decision.userInterventionRequired).toBe(false);
    expect(decision.posture.workRationale.skipped).toEqual([
      "specialist_coordination",
      "full_sdd_artifacts",
    ]);
  });

  test("same-file disjoint work coordinates without blocking or user arbitration", () => {
    const decision = decideDeveloperTeamLeadershipV1({
      posture: { ...posture, equallySafeDirectPathAvailable: false, expectedCoordinationBenefit: 8 },
      work: [
        {
          id: "hero",
          writes: ["landing.tsx"],
          base: "candidate",
          modifyingEffects: [{ target: "landing.tsx", start: 1, end: 10, effectDigest: digest("a") }],
        },
        {
          id: "footer",
          writes: ["landing.tsx"],
          base: "candidate",
          modifyingEffects: [{ target: "landing.tsx", start: 50, end: 60, effectDigest: digest("b") }],
        },
      ],
    });
    expect(decision.coordination.classification).toBe("advisory");
    expect(decision.action).not.toBe("blocked");
    expect(decision.userInterventionRequired).toBe(false);
  });

  test("normal visual feedback continues the same candidate with no arbitrary cycle limit", () => {
    const decision = decideDeveloperTeamLeadershipV1({
      posture,
      work: [{ id: "move-hero", writes: ["landing.tsx"] }],
      continuation: {
        sameOutcome: true,
        withinAuthorizedScope: true,
        riskUnchanged: true,
        reversible: true,
      },
    });
    expect(decision.action).toBe("continue_delta");
    expect(decision.reasonCodes).toContain("IN_SCOPE_CONVERSATIONAL_DELTA");
    expect(decision.userInterventionRequired).toBe(false);
  });

  test("a durable approval is consumed once and its exact replay never asks again", () => {
    const receipt = buildApprovalReceiptV1({
      schema: "approval-receipt-v1",
      changeId: "landing",
      gate: "apply",
      subjectDigest: digest("c"),
      decision: "approved",
      actor: "user",
      timestamp: "2026-07-30T00:00:00Z",
      transitionId: "apply-1",
    });
    const first = decideDeveloperTeamLeadershipV1({
      posture,
      work: [],
      approval: {
        receipt,
        request: {
          changeId: "landing",
          gate: "apply",
          subjectDigest: digest("c"),
          transitionId: "apply-1",
        },
      },
    });
    const replay = decideDeveloperTeamLeadershipV1({
      posture,
      work: [],
      approval: {
        receipt,
        request: {
          changeId: "landing",
          gate: "apply",
          subjectDigest: digest("c"),
          transitionId: "apply-1",
        },
        prior: first.approvalConsumption,
      },
    });
    expect(first.approvalStatus).toBe("consumed");
    expect(replay.approvalStatus).toBe("replayed");
    expect(replay.userInterventionRequired).toBe(false);
  });

  test("a matching direct handoff is adopted as the single outcome", () => {
    const direct = buildAuthoritativeOutcomeV1({
      schema: "authoritative-outcome-v1",
      subjectDigest: digest("c"),
      resultDigest: digest("d"),
      protectedRequirementsDigest: digest("e"),
      mode: "direct",
      status: "delivered",
    });
    const decision = decideDeveloperTeamLeadershipV1({
      posture,
      work: [],
      outcomeHandoff: { current: direct, incoming: direct },
    });
    expect(decision.action).toBe("adopt_existing_outcome");
    expect(decision.outcome?.classification).toBe("matching");
  });

  test("routine conflicts stay internal while product, protected, scope, and irreversible decisions ask the user", () => {
    const conflict = decideDeveloperTeamLeadershipV1({
      posture,
      work: [{ id: "a", writes: ["x.ts"] }, { id: "b", writes: ["x.ts"] }],
    });
    expect(conflict.action).toBe("coordinate_internally");
    expect(conflict.userInterventionRequired).toBe(false);

    for (const userDecision of [
      { productDecisionRequired: true },
      { scopeExpansionRequired: true },
      { protectedRiskDecisionRequired: true },
      { irreversibleActionRequired: true },
    ]) {
      const decision = decideDeveloperTeamLeadershipV1({ posture, work: [], userDecision });
      expect(decision.action).toBe("ask_user");
      expect(decision.userInterventionRequired).toBe(true);
    }
  });

  test("authorized governance repair proceeds internally and requires canonical rerun", () => {
    const decision = decideDeveloperTeamLeadershipV1({
      posture,
      work: [],
      governanceRecovery: {
        governanceOracleBroken: true,
        separatelyAuthorizedRepair: true,
        repairTargetsOnlyGovernanceOracle: true,
        containsProductWork: false,
        suppressesProtectedFindings: false,
        canonicalValidationWillRerun: true,
      },
    });
    expect(decision.action).toBe("repair_governance");
    expect(decision.governance?.requiredActions).toEqual(["RERUN_CANONICAL_VALIDATION"]);
    expect(decision.userInterventionRequired).toBe(false);
  });

  test("runs critical preflight before implementation and revises a failed plan internally", () => {
    const candidate = buildCandidateRefV1({
      implementationDigest: digest("a"),
      treeDigest: digest("b"),
      dependencySetDigest: digest("c"),
      requirementsDigest: digest("d"),
      environmentDigest: digest("e"),
      checkPlanDigest: digest("f"),
      generation: 1,
    });
    const missing = decideDeveloperTeamLeadershipV1({
      posture,
      work: [],
      criticalPreflight: { candidate, planDeclaresCriticalPreflight: true },
    });
    const failedReceipt = buildApplyPreflightReceiptV1({
      candidate,
      status: "failed",
      criticalAssumptions: ["platform-integration"],
      evidenceDigests: [digest("1")],
    });
    const failed = decideDeveloperTeamLeadershipV1({
      posture,
      work: [],
      criticalPreflight: {
        candidate,
        planDeclaresCriticalPreflight: true,
        receipt: failedReceipt,
      },
    });
    const passedReceipt = buildApplyPreflightReceiptV1({
      candidate,
      status: "passed",
      criticalAssumptions: ["platform-integration"],
      evidenceDigests: [digest("2")],
    });
    const passed = decideDeveloperTeamLeadershipV1({
      posture,
      work: [],
      criticalPreflight: {
        candidate,
        planDeclaresCriticalPreflight: true,
        receipt: passedReceipt,
      },
    });

    expect(missing.action).toBe("run_preflight");
    expect(missing.userInterventionRequired).toBe(false);
    expect(failed.action).toBe("revise_plan");
    expect(failed.userInterventionRequired).toBe(false);
    expect(passed.preflightStatus).toBe("passed");
    expect(passed.action).toBe("start_direct");
  });

  test("normalizes hostile preflight failures without exposing thrown content", () => {
    const candidate = Object.defineProperty({}, "schema", {
      get() {
        throw new Error("password=do-not-leak");
      },
    });
    const decision = decideDeveloperTeamLeadershipV1({
      posture,
      work: [],
      criticalPreflight: {
        candidate,
        planDeclaresCriticalPreflight: true,
        receipt: {},
      },
    });

    expect(decision.preflightStatus).toBe("invalid");
    expect(decision.reasonCodes).toContain("PREFLIGHT_INVALID");
    expect(decision.reasonCodes.join(" ")).not.toContain("do-not-leak");
  });
});
