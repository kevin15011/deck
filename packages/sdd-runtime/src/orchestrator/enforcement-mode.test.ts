import { describe, expect, test } from "bun:test";

import {
  resolveEnforcementMode,
  applyEnforcement,
  type EnforcementConfig,
  DEFAULT_ENFORCEMENT_CONFIG,
  type EnforcementMode,
} from "./enforcement-mode";

describe("enforcement-mode", () => {
  describe("resolveEnforcementMode", () => {
    test("defaults to report-only mode", () => {
      const mode = resolveEnforcementMode({});
      expect(mode).toBe("report-only");
    });

    test("resolves to conditional-routing when enabled", () => {
      const mode = resolveEnforcementMode({ conditionalRoutingEnabled: true });
      expect(mode).toBe("conditional-routing");
    });

    test("resolves to full-enforcement when locks required", () => {
      const mode = resolveEnforcementMode({
        conditionalRoutingEnabled: true,
        locksRequired: true,
      });
      expect(mode).toBe("full-enforcement");
    });
  });

  describe("applyEnforcement", () => {
    test("report-only: contracts optional, scoring logs warnings but does not gate", () => {
      const result = applyEnforcement(
        "report-only",
        { auditValid: false, riskScore: 85 },
        DEFAULT_ENFORCEMENT_CONFIG,
      );

      expect(result.blocked).toBe(false);
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    test("conditional-routing: thresholds gate quality invocation", () => {
      const result = applyEnforcement(
        "conditional-routing",
        { auditValid: true, riskScore: 70 },
        DEFAULT_ENFORCEMENT_CONFIG,
      );

      expect(result.blocked).toBe(false);
      expect(result.qualityGated).toBe(true);
    });

    test("conditional-routing: blocks on missing audit", () => {
      const result = applyEnforcement(
        "conditional-routing",
        { auditValid: false, riskScore: 30 },
        DEFAULT_ENFORCEMENT_CONFIG,
      );

      expect(result.blocked).toBe(true);
    });

    test("full-enforcement: requires locks/events", () => {
      const result = applyEnforcement(
        "full-enforcement",
        { auditValid: true, riskScore: 30, hasValidLock: false },
        DEFAULT_ENFORCEMENT_CONFIG,
      );

      expect(result.blocked).toBe(true);
      expect(result.warnings.some((w) => w.toLowerCase().includes("lock"))).toBe(true);
    });

    test("full-enforcement: passes with valid lock", () => {
      const result = applyEnforcement(
        "full-enforcement",
        { auditValid: true, riskScore: 30, hasValidLock: true },
        DEFAULT_ENFORCEMENT_CONFIG,
      );

      expect(result.blocked).toBe(false);
    });
  });
});
