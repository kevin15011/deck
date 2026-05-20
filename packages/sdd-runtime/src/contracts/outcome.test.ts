import { describe, expect, test } from "bun:test";

import {
  validatePhaseOutcome,
  type PhaseOutcome,
  type OutcomeStatus,
} from "./outcome";

describe("outcome contract", () => {
  describe("validatePhaseOutcome", () => {
    test("accepts a successful outcome with artifact refs and hashes", () => {
      const outcome: PhaseOutcome = {
        status: "success",
        phase: "spec",
        artifactRefs: [{ path: "openspec/changes/foo/spec.md", hash: "abc123" }],
        validationResult: { valid: true, errors: [] },
        timestamp: new Date().toISOString(),
      };

      const validation = validatePhaseOutcome(outcome);

      expect(validation.valid).toBe(true);
    });

    test("accepts transport_unknown status with no artifact refs", () => {
      const outcome: PhaseOutcome = {
        status: "transport_unknown",
        phase: "apply",
        artifactRefs: [],
        validationResult: { valid: false, errors: ["artifact not found"] },
        timestamp: new Date().toISOString(),
      };

      const validation = validatePhaseOutcome(outcome);

      expect(validation.valid).toBe(true);
    });

    test("accepts budget_exceeded status with partial artifact", () => {
      const outcome: PhaseOutcome = {
        status: "budget_exceeded",
        phase: "design",
        artifactRefs: [{ path: "openspec/changes/foo/design.md", hash: "partial456" }],
        validationResult: { valid: false, errors: ["incomplete sections"] },
        phaseBudgetReport: { used: 45000, limit: 40000, unit: "tokens" },
        timestamp: new Date().toISOString(),
      };

      const validation = validatePhaseOutcome(outcome);

      expect(validation.valid).toBe(true);
    });

    test("rejects invalid status values", () => {
      const outcome = {
        status: "unknown_status",
        phase: "spec",
        artifactRefs: [],
        validationResult: { valid: true, errors: [] },
        timestamp: new Date().toISOString(),
      };

      const validation = validatePhaseOutcome(outcome as PhaseOutcome);

      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain("invalid status");
    });

    test("rejects missing phase", () => {
      const outcome = {
        status: "success" as OutcomeStatus,
        artifactRefs: [],
        validationResult: { valid: true, errors: [] },
        timestamp: new Date().toISOString(),
        phase: "",
      };

      const validation = validatePhaseOutcome(outcome as PhaseOutcome);

      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain("missing phase");
    });

    test("partial status is valid with at least one artifact ref", () => {
      const outcome: PhaseOutcome = {
        status: "partial",
        phase: "apply",
        artifactRefs: [{ path: "openspec/changes/foo/apply-progress.md", hash: "partial" }],
        validationResult: { valid: false, errors: ["2 of 5 tasks incomplete"] },
        timestamp: new Date().toISOString(),
      };

      const validation = validatePhaseOutcome(outcome);

      expect(validation.valid).toBe(true);
    });

    test("failed status is valid with error details in validation result", () => {
      const outcome: PhaseOutcome = {
        status: "failed",
        phase: "verify",
        artifactRefs: [],
        validationResult: { valid: false, errors: ["3 tests failed", "build error"] },
        timestamp: new Date().toISOString(),
      };

      const validation = validatePhaseOutcome(outcome);

      expect(validation.valid).toBe(true);
    });
  });
});
