import { describe, expect, test } from "bun:test";

import {
  validateRiskResult,
  DEFAULT_RISK_THRESHOLDS,
  type RiskResult,
  type RiskSignal,
  type RiskTier,
} from "./risk";

describe("risk contract", () => {
  describe("validateRiskResult", () => {
    test("accepts a valid risk result with all required fields", () => {
      const result: RiskResult = {
        score: 45,
        tier: "boundary",
        signals: [{ name: "cross_boundary_integration", weight: 0.7, evidence: "touches two services" }],
        thresholds: DEFAULT_RISK_THRESHOLDS,
        overrides: [],
        recommendedChecks: ["contract-quality"],
        confidence: 0.85,
      };

      const validation = validateRiskResult(result);

      expect(validation.valid).toBe(true);
      expect(validation.errors).toEqual([]);
    });

    test("rejects score below 0", () => {
      const result = {
        score: -5,
        tier: "standard" as RiskTier,
        signals: [],
        thresholds: DEFAULT_RISK_THRESHOLDS,
        overrides: [],
        recommendedChecks: [],
        confidence: 0.9,
      };

      const validation = validateRiskResult(result);

      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain("score must be between 0 and 100");
    });

    test("rejects score above 100", () => {
      const result = {
        score: 150,
        tier: "standard" as RiskTier,
        signals: [],
        thresholds: DEFAULT_RISK_THRESHOLDS,
        overrides: [],
        recommendedChecks: [],
        confidence: 0.9,
      };

      const validation = validateRiskResult(result);

      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain("score must be between 0 and 100");
    });

    test("rejects missing required signals array", () => {
      const result = {
        score: 50,
        tier: "boundary" as RiskTier,
        thresholds: DEFAULT_RISK_THRESHOLDS,
        overrides: [],
        recommendedChecks: [],
        confidence: 0.9,
      };

      const validation = validateRiskResult(result);

      expect(validation.valid).toBe(false);
    });

    test("validates tier matches score range — standard for <30", () => {
      const result: RiskResult = {
        score: 20,
        tier: "standard",
        signals: [],
        thresholds: DEFAULT_RISK_THRESHOLDS,
        overrides: [],
        recommendedChecks: [],
        confidence: 0.9,
      };

      const validation = validateRiskResult(result);

      expect(validation.valid).toBe(true);
    });

    test("validates tier matches score range — critical for >=80", () => {
      const result: RiskResult = {
        score: 85,
        tier: "critical",
        signals: [{ name: "destructive_operation", weight: 0.9, evidence: "drops table" }],
        thresholds: DEFAULT_RISK_THRESHOLDS,
        overrides: [],
        recommendedChecks: ["full-review"],
        confidence: 0.7,
      };

      const validation = validateRiskResult(result);

      expect(validation.valid).toBe(true);
    });
  });

  describe("DEFAULT_RISK_THRESHOLDS", () => {
    test("defines standard threshold at 30, boundary at 60, critical at 80", () => {
      expect(DEFAULT_RISK_THRESHOLDS.standard).toBeLessThan(DEFAULT_RISK_THRESHOLDS.boundary);
      expect(DEFAULT_RISK_THRESHOLDS.boundary).toBeLessThan(DEFAULT_RISK_THRESHOLDS.critical);
      expect(DEFAULT_RISK_THRESHOLDS.standard).toBe(30);
      expect(DEFAULT_RISK_THRESHOLDS.boundary).toBe(60);
      expect(DEFAULT_RISK_THRESHOLDS.critical).toBe(80);
    });
  });

  describe("RiskSignal", () => {
    test("signal requires name, weight, and evidence", () => {
      const signal: RiskSignal = {
        name: "missing_tests",
        weight: 0.5,
        evidence: "no test files found for changed modules",
      };

      expect(signal.name).toBe("missing_tests");
      expect(signal.weight).toBeGreaterThan(0);
      expect(signal.weight).toBeLessThanOrEqual(1);
      expect(signal.evidence.length).toBeGreaterThan(0);
    });
  });
});
