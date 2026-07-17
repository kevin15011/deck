import { describe, expect, test } from "bun:test";

import type { RiskResult, RiskTier } from "../contracts/risk";
import {
  adaptLaneToCheckPlanV1,
  assignExecutionLaneCohortV1,
  selectExecutionLaneV1,
  type ExecutionLaneFactsV1,
  type SelectExecutionLaneInputV1,
} from "./execution-lane-router";

function risk(score: number, tier: RiskTier = score >= 80 ? "critical" : score >= 60 ? "high" : score >= 30 ? "boundary" : "standard", confidence = 0.95): RiskResult {
  return {
    score,
    tier,
    confidence,
    signals: [],
    thresholds: { standard: 30, boundary: 60, critical: 80 },
    overrides: [],
    recommendedChecks: [],
  };
}

const facts = (changes: Partial<ExecutionLaneFactsV1> = {}): ExecutionLaneFactsV1 => ({
  explicitAcceptance: true,
  explicitFullSdd: false,
  boundedTargetCount: 1,
  fileCount: 1,
  packageCount: 1,
  affectedAreaKnown: true,
  checksKnown: true,
  incident: false,
  generatedSource: false,
  security: false,
  authorization: false,
  privacy: false,
  dataLoss: false,
  migration: false,
  destructive: false,
  publicApi: false,
  crossPackageArchitecture: false,
  registrySemantics: false,
  unknownProtectedScope: false,
  materialRepair: false,
  ...changes,
});

const input = (changes: Partial<SelectExecutionLaneInputV1> = {}): SelectExecutionLaneInputV1 => ({
  risk: risk(10),
  facts: facts(),
  policy: { minimumLane: "fast", allowFast: true, requireReview: false },
  routePolicy: "risk-lanes",
  ...changes,
});

describe("deterministic execution lane selection", () => {
  test("selects Fast only for bounded accepted low-risk work", () => {
    const decision = selectExecutionLaneV1(input());
    expect(decision.lane).toBe("fast");
    expect(decision.policyVersion).toBe("execution-lane-policy-v1");
    expect(decision.shadowOnly).toBe(false);
    expect(decision.floorReasons).toEqual([]);
  });

  test("selects Guarded for medium, multi-file, uncertain, generated, and incident work", () => {
    const cases: Array<[Partial<SelectExecutionLaneInputV1>, string]> = [
      [{ risk: risk(30) }, "BOUNDARY_RISK"],
      [{ facts: facts({ fileCount: 2 }) }, "MULTI_FILE"],
      [{ facts: facts({ affectedAreaKnown: false }) }, "AFFECTED_AREA_UNKNOWN"],
      [{ facts: facts({ generatedSource: true }) }, "GENERATED_SOURCE"],
      [{ facts: facts({ incident: true }) }, "INCIDENT"],
      [{ facts: facts({ materialRepair: true }) }, "MATERIAL_REPAIR"],
    ];
    for (const [changes, rationale] of cases) {
      const decision = selectExecutionLaneV1(input(changes));
      expect(decision.lane).toBe("guarded");
      expect(decision.floorReasons).toContain(rationale);
    }
  });

  test("applies every non-configurable Full-SDD floor", () => {
    const signals: Array<[keyof ExecutionLaneFactsV1, string]> = [
      ["explicitFullSdd", "EXPLICIT_FULL_SDD"],
      ["security", "SECURITY_FLOOR"],
      ["authorization", "AUTHORIZATION_FLOOR"],
      ["privacy", "PRIVACY_FLOOR"],
      ["dataLoss", "DATA_LOSS_FLOOR"],
      ["migration", "MIGRATION_FLOOR"],
      ["destructive", "DESTRUCTIVE_FLOOR"],
      ["publicApi", "PUBLIC_API_FLOOR"],
      ["crossPackageArchitecture", "CROSS_PACKAGE_ARCHITECTURE_FLOOR"],
      ["registrySemantics", "REGISTRY_SEMANTICS_FLOOR"],
      ["unknownProtectedScope", "UNKNOWN_PROTECTED_SCOPE"],
    ];
    for (const [signal, rationale] of signals) {
      const decision = selectExecutionLaneV1(input({ facts: facts({ [signal]: true }) }));
      expect(decision.lane).toBe("full_sdd");
      expect(decision.floorReasons).toContain(rationale);
    }
    expect(selectExecutionLaneV1(input({ risk: risk(60, "high") })).lane).toBe("full_sdd");
    expect(selectExecutionLaneV1(input({ risk: risk(80, "critical") })).lane).toBe("full_sdd");
    expect(selectExecutionLaneV1(input({ risk: risk(10, "standard", 0.79) })).floorReasons).toContain("LOW_CONFIDENCE_FLOOR");
  });

  test("allows policy and user choice to raise but never lower a lane", () => {
    const raised = selectExecutionLaneV1(input({
      policy: { minimumLane: "guarded", userMinimumLane: "full_sdd", allowFast: true, requireReview: true },
    }));
    expect(raised.lane).toBe("full_sdd");
    expect(raised.policyOverrides).toContain("USER_MINIMUM_FULL_SDD");
    const retained = selectExecutionLaneV1(input({ currentLane: "full_sdd" }));
    expect(retained.lane).toBe("full_sdd");
    expect(retained.policyOverrides).toContain("NO_DOWNGRADE_FULL_SDD");
  });

  test("escalates immediately when new evidence raises the floor", () => {
    const initial = selectExecutionLaneV1(input());
    const escalated = selectExecutionLaneV1(input({ currentLane: initial.lane, facts: facts({ authorization: true }) }));
    expect(initial.lane).toBe("fast");
    expect(escalated.lane).toBe("full_sdd");
    expect(escalated.floorReasons).toContain("AUTHORIZATION_FLOOR");
  });

  test("replays deterministically and keeps shadow/active semantics equal", () => {
    const value = input({ facts: facts({ fileCount: 3 }) });
    expect(selectExecutionLaneV1(value)).toEqual(selectExecutionLaneV1(value));
    const shadow = selectExecutionLaneV1({ ...value, routePolicy: "shadow-risk-lanes" });
    const active = selectExecutionLaneV1({ ...value, routePolicy: "risk-lanes" });
    expect(shadow.lane).toBe(active.lane);
    expect(shadow.floorReasons).toEqual(active.floorReasons);
    expect(shadow.shadowOnly).toBe(true);
    expect(active.shadowOnly).toBe(false);
  });

  test("assigns cohorts deterministically at exact boundaries", () => {
    expect(assignExecutionLaneCohortV1("change-a", 0)).toBe(false);
    expect(assignExecutionLaneCohortV1("change-a", 100)).toBe(true);
    expect(assignExecutionLaneCohortV1("change-a", 25)).toBe(assignExecutionLaneCohortV1("change-a", 25));
    expect(() => assignExecutionLaneCohortV1("change-a", 101)).toThrow("invalid-cohort-percent");
  });

  test("rejects incomplete, contradictory, and invalid policy evidence", () => {
    expect(() => selectExecutionLaneV1(input({ risk: risk(80, "standard") }))).toThrow("invalid-evidence: execution lane input");
    expect(() => selectExecutionLaneV1(input({ currentLane: "lower" as never }))).toThrow("invalid-evidence: execution lane input");
    expect(() => selectExecutionLaneV1(input({ policy: { minimumLane: "lower" as never, allowFast: true, requireReview: false } })))
      .toThrow("invalid-evidence: execution lane input");
    const { security: _security, ...incomplete } = facts();
    expect(() => selectExecutionLaneV1(input({ facts: incomplete as ExecutionLaneFactsV1 }))).toThrow("invalid-evidence: execution lane input");
  });
});

describe("lane check plans", () => {
  test("keeps authorization, Verify, Review, and broad floors by lane", () => {
    const fast = adaptLaneToCheckPlanV1(selectExecutionLaneV1(input()), {
      affectedAreaAvailable: true,
      broadAvailable: false,
      policyRequiresReview: false,
    });
    expect(fast).toMatchObject({ targeted: "required", affectedArea: "required", broad: "not_available", independentVerify: true, independentReview: false });
    const guarded = adaptLaneToCheckPlanV1(selectExecutionLaneV1(input({ facts: facts({ fileCount: 2 }) })), {
      affectedAreaAvailable: true,
      broadAvailable: true,
      policyRequiresReview: false,
    });
    expect(guarded).toMatchObject({ broad: "policy_deferrable", independentReview: true });
    const full = adaptLaneToCheckPlanV1(selectExecutionLaneV1(input({ facts: facts({ security: true }) })), {
      affectedAreaAvailable: false,
      broadAvailable: false,
      policyRequiresReview: false,
    });
    expect(full).toMatchObject({ affectedArea: "not_available", broad: "mandatory", independentReview: true, freshFinalReview: true });
  });

  test("never makes broad verification deferrable after an incident or material repair", () => {
    for (const signal of ["incident", "materialRepair"] as const) {
      const plan = adaptLaneToCheckPlanV1(selectExecutionLaneV1(input({ facts: facts({ [signal]: true }) })), {
        affectedAreaAvailable: true,
        broadAvailable: true,
        policyRequiresReview: false,
      });
      expect(plan.lane).toBe("guarded");
      expect(plan.broad).toBe("mandatory");
      expect(plan.freshFinalReview).toBe(true);
    }
  });
});
