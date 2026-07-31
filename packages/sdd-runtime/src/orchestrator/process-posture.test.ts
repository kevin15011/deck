import { describe, expect, test } from "bun:test";

import { evaluateProcessPostureV1 } from "./process-posture";

const evidence = (overrides = {}) => ({
  uncertaintyResolved: true,
  decisionEnabled: true,
  materialRiskReduced: true,
  expectedCoordinationBenefit: 1,
  expectedCoordinationCost: 2,
  equallySafeDirectPathAvailable: true,
  safetyLane: "guarded" as const,
  ...overrides,
});

describe("ProcessPostureDecisionV1", () => {
  test("chooses the equally safe direct path and records why specialist work was skipped", () => {
    const decision = evaluateProcessPostureV1(evidence());

    expect(decision.process).toBe("direct");
    expect(decision.safetyLane).toBe("guarded");
    expect(decision.rationaleCodes).toContain("EQUALLY_SAFE_DIRECT_PATH");
    expect(decision.workRationale).toEqual(expect.objectContaining({ skipped: expect.any(Array) }));
  });

  test("upshifts to full SDD only when unresolved uncertainty, disabled decision, and material risk justify its coordination cost", () => {
    const decision = evaluateProcessPostureV1(evidence({
      uncertaintyResolved: false,
      decisionEnabled: false,
      materialRiskReduced: false,
      expectedCoordinationBenefit: 8,
      expectedCoordinationCost: 3,
      equallySafeDirectPathAvailable: false,
    }));

    expect(decision.process).toBe("full_sdd");
    expect(decision.rationaleCodes).toContain("UNRESOLVED_MATERIAL_RISK");
  });

  test("downshifts process depth as evidence resolves while never downgrading the independent safety lane", () => {
    const decision = evaluateProcessPostureV1(evidence({
      previousProcess: "full_sdd" as const,
      previousSafetyLane: "full_sdd" as const,
      safetyLane: "guarded" as const,
    }));

    expect(decision.process).toBe("direct");
    expect(decision.safetyLane).toBe("full_sdd");
    expect(decision.rationaleCodes).toContain("SAFETY_LANE_MONOTONIC");
  });
});
