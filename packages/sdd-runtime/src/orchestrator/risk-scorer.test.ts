import { describe, expect, test } from "bun:test";

import {
  computeRiskScore,
  type RiskScorerConfig,
  type ProjectCapabilities,
  DEFAULT_SCORER_CONFIG,
} from "./risk-scorer";

describe("risk-scorer", () => {
  describe("computeRiskScore", () => {
    test("returns low score for simple change with no risk signals", () => {
      const result = computeRiskScore(
        { ambiguity: [], riskSignals: [], confidence: 0.95 },
        DEFAULT_SCORER_CONFIG,
      );

      expect(result.score).toBeLessThan(30);
      expect(result.tier).toBe("standard");
    });

    test("elevates score when cross-boundary integration is present", () => {
      const result = computeRiskScore(
        {
          ambiguity: ["unclear boundary between auth and billing"],
          riskSignals: [{ name: "cross_boundary_integration", weight: 0.7, evidence: "touches two services" }],
          confidence: 0.6,
        },
        DEFAULT_SCORER_CONFIG,
      );

      expect(result.score).toBeGreaterThanOrEqual(30);
      expect(result.signals.length).toBeGreaterThanOrEqual(1);
    });

    test("reaches critical tier for destructive operations with missing tests", () => {
      const result = computeRiskScore(
        {
          ambiguity: [],
          riskSignals: [
            { name: "destructive_operation", weight: 0.9, evidence: "drops and recreates table" },
            { name: "missing_tests", weight: 0.8, evidence: "no test coverage for migration" },
            { name: "data_migration", weight: 0.7, evidence: "schema change requires migration" },
          ],
          confidence: 0.3,
        },
        DEFAULT_SCORER_CONFIG,
      );

      expect(result.score).toBeGreaterThanOrEqual(80);
      expect(result.tier).toBe("critical");
    });

    test("adapts weights when project has no test capabilities", () => {
      const capabilities: ProjectCapabilities = {
        hasTestRunner: false,
        hasTypeChecker: false,
        hasLinter: false,
        hasBuildTool: false,
        detectedCapabilities: [],
      };

      const result = computeRiskScore(
        {
          ambiguity: [],
          riskSignals: [{ name: "state_mutation", weight: 0.5, evidence: "modifies shared state" }],
          confidence: 0.7,
        },
        { ...DEFAULT_SCORER_CONFIG, projectCapabilities: capabilities },
      );

      expect(result.score).toBeGreaterThan(
        computeRiskScore(
          { ambiguity: [], riskSignals: [{ name: "state_mutation", weight: 0.5, evidence: "modifies shared state" }], confidence: 0.7 },
          DEFAULT_SCORER_CONFIG,
        ).score,
      );
    });

    test("records all contributing signals in result", () => {
      const signals = [
        { name: "cross_boundary_integration", weight: 0.6, evidence: "a" },
        { name: "missing_tests", weight: 0.5, evidence: "b" },
      ];

      const result = computeRiskScore(
        { ambiguity: [], riskSignals: signals, confidence: 0.8 },
        DEFAULT_SCORER_CONFIG,
      );

      expect(result.signals).toHaveLength(2);
      expect(result.signals.map((s) => s.name)).toEqual(
        expect.arrayContaining(["cross_boundary_integration", "missing_tests"]),
      );
    });

    test("low confidence elevates score", () => {
      const highConfidence = computeRiskScore(
        { ambiguity: [], riskSignals: [], confidence: 0.95 },
        DEFAULT_SCORER_CONFIG,
      );

      const lowConfidence = computeRiskScore(
        { ambiguity: [], riskSignals: [], confidence: 0.2 },
        DEFAULT_SCORER_CONFIG,
      );

      expect(lowConfidence.score).toBeGreaterThan(highConfidence.score);
    });

    test("clamps score to 0..100 range", () => {
      const result = computeRiskScore(
        {
          ambiguity: [],
          riskSignals: Array.from({ length: 20 }, (_, i) => ({
            name: `signal_${i}`,
            weight: 1.0,
            evidence: `evidence ${i}`,
          })),
          confidence: 0.1,
        },
        DEFAULT_SCORER_CONFIG,
      );

      expect(result.score).toBeLessThanOrEqual(100);
      expect(result.score).toBeGreaterThanOrEqual(0);
    });
  });
});
