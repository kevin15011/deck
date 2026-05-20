import { describe, expect, test } from "bun:test";

import {
  routeQuality,
  type QualityRouterConfig,
  DEFAULT_ROUTER_CONFIG,
  type QualityRouteDecision,
} from "./quality-router";

describe("quality-router", () => {
  describe("routeQuality", () => {
    test("low-risk score skips quality agents and logs skip decision", () => {
      const decision = routeQuality(
        { score: 20, tier: "standard", signals: [], thresholds: { standard: 30, boundary: 60, critical: 80 }, overrides: [], recommendedChecks: [], confidence: 0.9 },
        DEFAULT_ROUTER_CONFIG,
      );

      expect(decision.invokeQuality).toBe(false);
      expect(decision.skipReason).toBeTruthy();
      expect(decision.checksToRun).toEqual([]);
    });

    test("boundary-tier score enforces contract quality check", () => {
      const decision = routeQuality(
        { score: 45, tier: "boundary", signals: [{ name: "cross_boundary_integration", weight: 0.6, evidence: "test" }], thresholds: { standard: 30, boundary: 60, critical: 80 }, overrides: [], recommendedChecks: ["contract-quality"], confidence: 0.8 },
        DEFAULT_ROUTER_CONFIG,
      );

      expect(decision.invokeQuality).toBe(true);
      expect(decision.checksToRun).toContain("contract-quality");
    });

    test("high-risk score gates with boundary + security/integration checks", () => {
      const decision = routeQuality(
        { score: 70, tier: "high", signals: [{ name: "secret_handling", weight: 0.8, evidence: "auth flow" }], thresholds: { standard: 30, boundary: 60, critical: 80 }, overrides: [], recommendedChecks: ["security-review", "integration-test"], confidence: 0.6 },
        DEFAULT_ROUTER_CONFIG,
      );

      expect(decision.invokeQuality).toBe(true);
      expect(decision.checksToRun).toContain("security-review");
      expect(decision.checksToRun).toContain("integration-test");
    });

    test("critical-tier requires replan or explicit override", () => {
      const decision = routeQuality(
        { score: 85, tier: "critical", signals: [{ name: "destructive_operation", weight: 0.9, evidence: "drops table" }], thresholds: { standard: 30, boundary: 60, critical: 80 }, overrides: [], recommendedChecks: ["full-review"], confidence: 0.5 },
        DEFAULT_ROUTER_CONFIG,
      );

      expect(decision.invokeQuality).toBe(true);
      expect(decision.requiresReplanOrOverride).toBe(true);
    });

    test("override can downgrade routing but never disables state validation", () => {
      const decision = routeQuality(
        { score: 85, tier: "critical", signals: [{ name: "destructive_operation", weight: 0.9, evidence: "drops table" }], thresholds: { standard: 30, boundary: 60, critical: 80 }, overrides: [{ name: "user-override", scope: "quality-only", expiresAt: "2026-05-21" }], recommendedChecks: [], confidence: 0.5 },
        DEFAULT_ROUTER_CONFIG,
      );

      expect(decision.invokeQuality).toBe(false);
      expect(decision.stateValidationRequired).toBe(true);
    });

    // ── Configured threshold tests (Finding 6) ──

    test("uses configured standard threshold instead of precomputed tier", () => {
      // Score 25, tier "standard" — but config has standardThreshold: 20
      // This means score >= threshold, so quality SHOULD be invoked
      const customConfig: QualityRouterConfig = {
        standardThreshold: 20,
        boundaryThreshold: 60,
        criticalThreshold: 80,
      };

      const decision = routeQuality(
        { score: 25, tier: "standard", signals: [], thresholds: { standard: 30, boundary: 60, critical: 80 }, overrides: [], recommendedChecks: [], confidence: 0.9 },
        customConfig,
      );

      // With threshold 20, score 25 is above it — quality is invoked
      expect(decision.invokeQuality).toBe(true);
    });

    test("uses configured critical threshold instead of precomputed tier", () => {
      // Score 75, tier "high" from precomputed — but config has criticalThreshold: 70
      // This means score >= critical threshold, so it should require replan
      const customConfig: QualityRouterConfig = {
        standardThreshold: 30,
        boundaryThreshold: 60,
        criticalThreshold: 70,
      };

      const decision = routeQuality(
        { score: 75, tier: "high", signals: [], thresholds: { standard: 30, boundary: 60, critical: 80 }, overrides: [], recommendedChecks: ["full-review"], confidence: 0.5 },
        customConfig,
      );

      expect(decision.invokeQuality).toBe(true);
      expect(decision.requiresReplanOrOverride).toBe(true);
    });

    test("custom boundary threshold reclassifies correctly", () => {
      // Score 50, tier "boundary" from precomputed — config has boundaryThreshold: 40
      // With boundaryThreshold 40 and criticalThreshold 80, score 50 is high range
      const customConfig: QualityRouterConfig = {
        standardThreshold: 30,
        boundaryThreshold: 40,
        criticalThreshold: 80,
      };

      const decision = routeQuality(
        { score: 50, tier: "boundary", signals: [], thresholds: { standard: 30, boundary: 60, critical: 80 }, overrides: [], recommendedChecks: ["security-review"], confidence: 0.7 },
        customConfig,
      );

      // Score 50 >= boundaryThreshold 40 AND < criticalThreshold 80 → high tier behavior
      expect(decision.invokeQuality).toBe(true);
    });

    test("score below custom standard threshold skips quality", () => {
      const customConfig: QualityRouterConfig = {
        standardThreshold: 50,
        boundaryThreshold: 70,
        criticalThreshold: 90,
      };

      const decision = routeQuality(
        { score: 40, tier: "boundary", signals: [], thresholds: { standard: 30, boundary: 60, critical: 80 }, overrides: [], recommendedChecks: [], confidence: 0.9 },
        customConfig,
      );

      // Score 40 < custom standardThreshold 50 → skip quality
      expect(decision.invokeQuality).toBe(false);
      expect(decision.skipReason).toContain("50");
    });

    test("expired override is ignored even for critical tier", () => {
      const decision = routeQuality(
        { score: 85, tier: "critical", signals: [{ name: "destructive_operation", weight: 0.9, evidence: "drops table" }], thresholds: { standard: 30, boundary: 60, critical: 80 }, overrides: [{ name: "expired-override", scope: "quality-only", expiresAt: "2020-01-01" }], recommendedChecks: ["full-review"], confidence: 0.5 },
        DEFAULT_ROUTER_CONFIG,
      );

      // Expired override should be ignored
      expect(decision.invokeQuality).toBe(true);
      expect(decision.requiresReplanOrOverride).toBe(true);
    });
  });
});
