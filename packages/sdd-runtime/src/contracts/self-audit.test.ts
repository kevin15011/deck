import { describe, expect, test } from "bun:test";

import {
  validateSelfAudit,
  type SelfAudit,
  type SpecAudit,
  type DesignAudit,
  type TasksAudit,
} from "./self-audit";

describe("self-audit contract", () => {
  describe("validateSelfAudit", () => {
    test("rejects missing required fields — missing invariants", () => {
      const audit: Partial<SelfAudit> = {
        boundaries: "API boundary between X and Y",
        ambiguity: [],
        riskSignals: [],
        confidence: 0.8,
      };

      const result = validateSelfAudit(audit, "spec");

      expect(result.valid).toBe(false);
      expect(result.missingFields).toContain("invariants");
    });

    test("accepts a complete spec audit with all required fields", () => {
      const audit: SpecAudit = {
        invariants: "Users must be authenticated for all writes",
        boundaries: "REST API boundary between client and server",
        externalContracts: [],
        sensitiveData: [],
        testDirection: "unit-first",
        ambiguity: [],
        riskSignals: [],
        confidence: 0.9,
      };

      const result = validateSelfAudit(audit, "spec");

      expect(result.valid).toBe(true);
      expect(result.missingFields).toEqual([]);
    });

    test("accepts a complete design audit with risk surface per decision", () => {
      const audit: DesignAudit = {
        invariants: "Event sourcing preserves all state transitions",
        boundaries: "Domain boundary between orders and payments",
        riskSurface: [{ decision: "event sourcing", risk: "storage growth", impact: "medium" }],
        stateMutation: ["order status transitions"],
        compatibility: "backward-compatible with v1 events",
        rollback: "replay events from snapshot",
        observability: ["event log", "saga status"],
        ambiguity: [],
        riskSignals: [],
        confidence: 0.85,
      };

      const result = validateSelfAudit(audit, "design");

      expect(result.valid).toBe(true);
    });

    test("accepts a complete tasks audit with readiness and splitability", () => {
      const audit: TasksAudit = {
        invariants: "Each task maps to exactly one deliverable",
        boundaries: "No task touches more than one bounded context",
        taskReadiness: [{ taskId: "1.1", ready: true, blockers: [] }],
        splitability: [{ taskId: "2.1", splittable: false, reason: "atomic operation" }],
        boundaryTests: ["risk scorer threshold boundaries"],
        rollbackStep: "revert commit per task",
        blockers: [],
        placeholders: [],
        ambiguity: [],
        riskSignals: [],
        confidence: 0.75,
      };

      const result = validateSelfAudit(audit, "tasks");

      expect(result.valid).toBe(true);
    });

    test("rejects empty invariants string", () => {
      const audit = {
        invariants: "",
        boundaries: "defined",
        ambiguity: [],
        riskSignals: [],
        confidence: 0.5,
      };

      const result = validateSelfAudit(audit, "spec");

      expect(result.valid).toBe(false);
      expect(result.missingFields).toContain("invariants");
    });

    test("rejects negative confidence", () => {
      const audit = {
        invariants: "defined",
        boundaries: "defined",
        ambiguity: [],
        riskSignals: [],
        confidence: -0.1,
      };

      const result = validateSelfAudit(audit, "spec");

      expect(result.valid).toBe(false);
      expect(result.invalidFields).toContain("confidence");
    });

    test("rejects confidence above 1.0", () => {
      const audit = {
        invariants: "defined",
        boundaries: "defined",
        ambiguity: [],
        riskSignals: [],
        confidence: 1.5,
      };

      const result = validateSelfAudit(audit, "spec");

      expect(result.valid).toBe(false);
      expect(result.invalidFields).toContain("confidence");
    });

    test("rejects missing design-specific fields when type is design", () => {
      const audit = {
        invariants: "defined",
        boundaries: "defined",
        ambiguity: [],
        riskSignals: [],
        confidence: 0.8,
      };

      const result = validateSelfAudit(audit, "design");

      expect(result.valid).toBe(false);
      expect(result.missingFields).toContain("riskSurface");
      expect(result.missingFields).toContain("stateMutation");
      expect(result.missingFields).toContain("rollback");
      expect(result.missingFields).toContain("compatibility");
      expect(result.missingFields).toContain("observability");
    });

    test("rejects missing tasks-specific fields when type is tasks", () => {
      const audit = {
        invariants: "defined",
        boundaries: "defined",
        ambiguity: [],
        riskSignals: [],
        confidence: 0.8,
      };

      const result = validateSelfAudit(audit, "tasks");

      expect(result.valid).toBe(false);
      expect(result.missingFields).toContain("taskReadiness");
      expect(result.missingFields).toContain("rollbackStep");
      expect(result.missingFields).toContain("splitability");
      expect(result.missingFields).toContain("boundaryTests");
      expect(result.missingFields).toContain("blockers");
      expect(result.missingFields).toContain("placeholders");
    });

    // ── Hardened validation tests ──

    test("rejects null input", () => {
      const result = validateSelfAudit(null, "spec");

      expect(result.valid).toBe(false);
      expect(result.missingFields.length).toBeGreaterThan(0);
    });

    test("rejects undefined input", () => {
      const result = validateSelfAudit(undefined, "spec");

      expect(result.valid).toBe(false);
      expect(result.missingFields.length).toBeGreaterThan(0);
    });

    test("rejects primitive string input", () => {
      const result = validateSelfAudit("not an audit", "spec");

      expect(result.valid).toBe(false);
      expect(result.missingFields.length).toBeGreaterThan(0);
    });

    test("rejects primitive number input", () => {
      const result = validateSelfAudit(42, "spec");

      expect(result.valid).toBe(false);
    });

    test("rejects array input", () => {
      const result = validateSelfAudit([{ invariants: "x" }], "spec");

      expect(result.valid).toBe(false);
    });

    test("rejects non-string invariants (wrong type)", () => {
      const audit = {
        invariants: 123,
        boundaries: "defined",
        ambiguity: [],
        riskSignals: [],
        confidence: 0.8,
      };

      const result = validateSelfAudit(audit, "spec");

      expect(result.valid).toBe(false);
      expect(result.invalidFields).toContain("invariants");
    });

    test("rejects non-string boundaries (wrong type)", () => {
      const audit = {
        invariants: "defined",
        boundaries: true,
        ambiguity: [],
        riskSignals: [],
        confidence: 0.8,
      };

      const result = validateSelfAudit(audit, "spec");

      expect(result.valid).toBe(false);
      expect(result.invalidFields).toContain("boundaries");
    });

    test("rejects non-array ambiguity", () => {
      const audit = {
        invariants: "defined",
        boundaries: "defined",
        ambiguity: "not an array",
        riskSignals: [],
        confidence: 0.8,
      };

      const result = validateSelfAudit(audit, "spec");

      expect(result.valid).toBe(false);
      expect(result.invalidFields).toContain("ambiguity");
    });

    test("rejects non-array riskSignals", () => {
      const audit = {
        invariants: "defined",
        boundaries: "defined",
        ambiguity: [],
        riskSignals: "not an array",
        confidence: 0.8,
      };

      const result = validateSelfAudit(audit, "spec");

      expect(result.valid).toBe(false);
      expect(result.invalidFields).toContain("riskSignals");
    });

    test("rejects malformed risk signal (missing name)", () => {
      const audit = {
        invariants: "defined",
        boundaries: "defined",
        ambiguity: [],
        riskSignals: [{ evidence: "has evidence but no name" }],
        confidence: 0.8,
      };

      const result = validateSelfAudit(audit, "spec");

      expect(result.valid).toBe(false);
      expect(result.invalidFields).toContain("riskSignals[0]");
    });

    test("rejects malformed risk signal (null entry)", () => {
      const audit = {
        invariants: "defined",
        boundaries: "defined",
        ambiguity: [],
        riskSignals: [null],
        confidence: 0.8,
      };

      const result = validateSelfAudit(audit, "spec");

      expect(result.valid).toBe(false);
      expect(result.invalidFields).toContain("riskSignals[0]");
    });

    test("rejects NaN confidence", () => {
      const audit = {
        invariants: "defined",
        boundaries: "defined",
        ambiguity: [],
        riskSignals: [],
        confidence: NaN,
      };

      const result = validateSelfAudit(audit, "spec");

      expect(result.valid).toBe(false);
      expect(result.invalidFields).toContain("confidence");
    });

    test("rejects string confidence", () => {
      const audit = {
        invariants: "defined",
        boundaries: "defined",
        ambiguity: [],
        riskSignals: [],
        confidence: "0.8",
      };

      const result = validateSelfAudit(audit, "spec");

      expect(result.valid).toBe(false);
      expect(result.invalidFields).toContain("confidence");
    });

    // ── Design-specific field omission tests ──

    test("rejects design audit missing compatibility", () => {
      const audit = {
        invariants: "defined",
        boundaries: "defined",
        riskSurface: [],
        stateMutation: [],
        rollback: "revert",
        observability: [],
        ambiguity: [],
        riskSignals: [],
        confidence: 0.8,
      };

      const result = validateSelfAudit(audit, "design");

      expect(result.valid).toBe(false);
      expect(result.missingFields).toContain("compatibility");
    });

    test("rejects design audit missing observability", () => {
      const audit = {
        invariants: "defined",
        boundaries: "defined",
        riskSurface: [],
        stateMutation: [],
        compatibility: "backward-compatible",
        rollback: "revert",
        ambiguity: [],
        riskSignals: [],
        confidence: 0.8,
      };

      const result = validateSelfAudit(audit, "design");

      expect(result.valid).toBe(false);
      expect(result.missingFields).toContain("observability");
    });

    test("rejects design audit with malformed riskSurface entry (missing decision)", () => {
      const audit = {
        invariants: "defined",
        boundaries: "defined",
        riskSurface: [{ risk: "storage growth", impact: "medium" }],
        stateMutation: [],
        compatibility: "backward-compatible",
        rollback: "revert",
        observability: [],
        ambiguity: [],
        riskSignals: [],
        confidence: 0.8,
      };

      const result = validateSelfAudit(audit, "design");

      expect(result.valid).toBe(false);
      expect(result.invalidFields).toContain("riskSurface[0]");
    });

    test("rejects design audit with malformed riskSurface entry (null)", () => {
      const audit = {
        invariants: "defined",
        boundaries: "defined",
        riskSurface: [null],
        stateMutation: [],
        compatibility: "backward-compatible",
        rollback: "revert",
        observability: [],
        ambiguity: [],
        riskSignals: [],
        confidence: 0.8,
      };

      const result = validateSelfAudit(audit, "design");

      expect(result.valid).toBe(false);
      expect(result.invalidFields).toContain("riskSurface[0]");
    });

    test("rejects design audit with empty compatibility string", () => {
      const audit = {
        invariants: "defined",
        boundaries: "defined",
        riskSurface: [],
        stateMutation: [],
        compatibility: "",
        rollback: "revert",
        observability: [],
        ambiguity: [],
        riskSignals: [],
        confidence: 0.8,
      };

      const result = validateSelfAudit(audit, "design");

      expect(result.valid).toBe(false);
      expect(result.invalidFields).toContain("compatibility");
    });

    test("rejects design audit with non-string compatibility", () => {
      const audit = {
        invariants: "defined",
        boundaries: "defined",
        riskSurface: [],
        stateMutation: [],
        compatibility: 42,
        rollback: "revert",
        observability: [],
        ambiguity: [],
        riskSignals: [],
        confidence: 0.8,
      };

      const result = validateSelfAudit(audit, "design");

      expect(result.valid).toBe(false);
      expect(result.invalidFields).toContain("compatibility");
    });

    test("rejects design audit with non-array observability", () => {
      const audit = {
        invariants: "defined",
        boundaries: "defined",
        riskSurface: [],
        stateMutation: [],
        compatibility: "backward-compatible",
        rollback: "revert",
        observability: "not an array",
        ambiguity: [],
        riskSignals: [],
        confidence: 0.8,
      };

      const result = validateSelfAudit(audit, "design");

      expect(result.valid).toBe(false);
      expect(result.invalidFields).toContain("observability");
    });

    test("rejects design audit with empty rollback string", () => {
      const audit = {
        invariants: "defined",
        boundaries: "defined",
        riskSurface: [],
        stateMutation: [],
        compatibility: "backward-compatible",
        rollback: "",
        observability: [],
        ambiguity: [],
        riskSignals: [],
        confidence: 0.8,
      };

      const result = validateSelfAudit(audit, "design");

      expect(result.valid).toBe(false);
      expect(result.invalidFields).toContain("rollback");
    });

    test("rejects design audit with non-array stateMutation", () => {
      const audit = {
        invariants: "defined",
        boundaries: "defined",
        riskSurface: [],
        stateMutation: "not an array",
        compatibility: "backward-compatible",
        rollback: "revert",
        observability: [],
        ambiguity: [],
        riskSignals: [],
        confidence: 0.8,
      };

      const result = validateSelfAudit(audit, "design");

      expect(result.valid).toBe(false);
      expect(result.invalidFields).toContain("stateMutation");
    });

    // ── Tasks-specific field omission tests ──

    test("rejects tasks audit missing splitability", () => {
      const audit = {
        invariants: "defined",
        boundaries: "defined",
        taskReadiness: [],
        boundaryTests: [],
        rollbackStep: "revert",
        blockers: [],
        placeholders: [],
        ambiguity: [],
        riskSignals: [],
        confidence: 0.8,
      };

      const result = validateSelfAudit(audit, "tasks");

      expect(result.valid).toBe(false);
      expect(result.missingFields).toContain("splitability");
    });

    test("rejects tasks audit missing boundaryTests", () => {
      const audit = {
        invariants: "defined",
        boundaries: "defined",
        taskReadiness: [],
        splitability: [],
        rollbackStep: "revert",
        blockers: [],
        placeholders: [],
        ambiguity: [],
        riskSignals: [],
        confidence: 0.8,
      };

      const result = validateSelfAudit(audit, "tasks");

      expect(result.valid).toBe(false);
      expect(result.missingFields).toContain("boundaryTests");
    });

    test("rejects tasks audit missing blockers", () => {
      const audit = {
        invariants: "defined",
        boundaries: "defined",
        taskReadiness: [],
        splitability: [],
        boundaryTests: [],
        rollbackStep: "revert",
        placeholders: [],
        ambiguity: [],
        riskSignals: [],
        confidence: 0.8,
      };

      const result = validateSelfAudit(audit, "tasks");

      expect(result.valid).toBe(false);
      expect(result.missingFields).toContain("blockers");
    });

    test("rejects tasks audit missing placeholders", () => {
      const audit = {
        invariants: "defined",
        boundaries: "defined",
        taskReadiness: [],
        splitability: [],
        boundaryTests: [],
        rollbackStep: "revert",
        blockers: [],
        ambiguity: [],
        riskSignals: [],
        confidence: 0.8,
      };

      const result = validateSelfAudit(audit, "tasks");

      expect(result.valid).toBe(false);
      expect(result.missingFields).toContain("placeholders");
    });

    test("rejects tasks audit with malformed taskReadiness entry (missing taskId)", () => {
      const audit = {
        invariants: "defined",
        boundaries: "defined",
        taskReadiness: [{ ready: true, blockers: [] }],
        splitability: [],
        boundaryTests: [],
        rollbackStep: "revert",
        blockers: [],
        placeholders: [],
        ambiguity: [],
        riskSignals: [],
        confidence: 0.8,
      };

      const result = validateSelfAudit(audit, "tasks");

      expect(result.valid).toBe(false);
      expect(result.invalidFields).toContain("taskReadiness[0]");
    });

    test("rejects tasks audit with malformed taskReadiness entry (non-boolean ready)", () => {
      const audit = {
        invariants: "defined",
        boundaries: "defined",
        taskReadiness: [{ taskId: "1.1", ready: "yes", blockers: [] }],
        splitability: [],
        boundaryTests: [],
        rollbackStep: "revert",
        blockers: [],
        placeholders: [],
        ambiguity: [],
        riskSignals: [],
        confidence: 0.8,
      };

      const result = validateSelfAudit(audit, "tasks");

      expect(result.valid).toBe(false);
      expect(result.invalidFields).toContain("taskReadiness[0]");
    });

    test("rejects tasks audit with malformed splitability entry (missing reason)", () => {
      const audit = {
        invariants: "defined",
        boundaries: "defined",
        taskReadiness: [],
        splitability: [{ taskId: "2.1", splittable: false }],
        boundaryTests: [],
        rollbackStep: "revert",
        blockers: [],
        placeholders: [],
        ambiguity: [],
        riskSignals: [],
        confidence: 0.8,
      };

      const result = validateSelfAudit(audit, "tasks");

      expect(result.valid).toBe(false);
      expect(result.invalidFields).toContain("splitability[0]");
    });

    test("rejects tasks audit with null splitability entry", () => {
      const audit = {
        invariants: "defined",
        boundaries: "defined",
        taskReadiness: [],
        splitability: [null],
        boundaryTests: [],
        rollbackStep: "revert",
        blockers: [],
        placeholders: [],
        ambiguity: [],
        riskSignals: [],
        confidence: 0.8,
      };

      const result = validateSelfAudit(audit, "tasks");

      expect(result.valid).toBe(false);
      expect(result.invalidFields).toContain("splitability[0]");
    });

    test("rejects tasks audit with non-array boundaryTests", () => {
      const audit = {
        invariants: "defined",
        boundaries: "defined",
        taskReadiness: [],
        splitability: [],
        boundaryTests: "not an array",
        rollbackStep: "revert",
        blockers: [],
        placeholders: [],
        ambiguity: [],
        riskSignals: [],
        confidence: 0.8,
      };

      const result = validateSelfAudit(audit, "tasks");

      expect(result.valid).toBe(false);
      expect(result.invalidFields).toContain("boundaryTests");
    });

    test("rejects tasks audit with non-array blockers", () => {
      const audit = {
        invariants: "defined",
        boundaries: "defined",
        taskReadiness: [],
        splitability: [],
        boundaryTests: [],
        rollbackStep: "revert",
        blockers: "not an array",
        placeholders: [],
        ambiguity: [],
        riskSignals: [],
        confidence: 0.8,
      };

      const result = validateSelfAudit(audit, "tasks");

      expect(result.valid).toBe(false);
      expect(result.invalidFields).toContain("blockers");
    });

    test("rejects tasks audit with non-array placeholders", () => {
      const audit = {
        invariants: "defined",
        boundaries: "defined",
        taskReadiness: [],
        splitability: [],
        boundaryTests: [],
        rollbackStep: "revert",
        blockers: [],
        placeholders: "not an array",
        ambiguity: [],
        riskSignals: [],
        confidence: 0.8,
      };

      const result = validateSelfAudit(audit, "tasks");

      expect(result.valid).toBe(false);
      expect(result.invalidFields).toContain("placeholders");
    });

    test("rejects tasks audit with empty rollbackStep string", () => {
      const audit = {
        invariants: "defined",
        boundaries: "defined",
        taskReadiness: [],
        splitability: [],
        boundaryTests: [],
        rollbackStep: "",
        blockers: [],
        placeholders: [],
        ambiguity: [],
        riskSignals: [],
        confidence: 0.8,
      };

      const result = validateSelfAudit(audit, "tasks");

      expect(result.valid).toBe(false);
      expect(result.invalidFields).toContain("rollbackStep");
    });

    // ── Spec-specific shape tests ──

    test("rejects spec audit with non-array externalContracts", () => {
      const audit = {
        invariants: "defined",
        boundaries: "defined",
        externalContracts: "not an array",
        sensitiveData: [],
        testDirection: "unit-first",
        ambiguity: [],
        riskSignals: [],
        confidence: 0.8,
      };

      const result = validateSelfAudit(audit, "spec");

      expect(result.valid).toBe(false);
      expect(result.invalidFields).toContain("externalContracts");
    });

    test("rejects spec audit with empty testDirection string", () => {
      const audit = {
        invariants: "defined",
        boundaries: "defined",
        externalContracts: [],
        sensitiveData: [],
        testDirection: "",
        ambiguity: [],
        riskSignals: [],
        confidence: 0.8,
      };

      const result = validateSelfAudit(audit, "spec");

      expect(result.valid).toBe(false);
      expect(result.invalidFields).toContain("testDirection");
    });

    // ── String-array element type validation (Third Review) ──

    test("rejects ambiguity with non-string element [123]", () => {
      const audit = {
        invariants: "defined",
        boundaries: "defined",
        ambiguity: [123],
        riskSignals: [],
        confidence: 0.8,
      };

      const result = validateSelfAudit(audit, "spec");

      expect(result.valid).toBe(false);
      expect(result.invalidFields).toContain("ambiguity[0]");
    });

    test("rejects externalContracts with non-string element [false]", () => {
      const audit = {
        invariants: "defined",
        boundaries: "defined",
        externalContracts: [false],
        sensitiveData: [],
        testDirection: "unit-first",
        ambiguity: [],
        riskSignals: [],
        confidence: 0.8,
      };

      const result = validateSelfAudit(audit, "spec");

      expect(result.valid).toBe(false);
      expect(result.invalidFields).toContain("externalContracts[0]");
    });

    test("rejects sensitiveData with non-string element [{}]", () => {
      const audit = {
        invariants: "defined",
        boundaries: "defined",
        externalContracts: [],
        sensitiveData: [{}],
        testDirection: "unit-first",
        ambiguity: [],
        riskSignals: [],
        confidence: 0.8,
      };

      const result = validateSelfAudit(audit, "spec");

      expect(result.valid).toBe(false);
      expect(result.invalidFields).toContain("sensitiveData[0]");
    });

    test("rejects stateMutation with non-string element [null]", () => {
      const audit = {
        invariants: "defined",
        boundaries: "defined",
        riskSurface: [],
        stateMutation: [null],
        compatibility: "backward-compatible",
        rollback: "revert",
        observability: [],
        ambiguity: [],
        riskSignals: [],
        confidence: 0.8,
      };

      const result = validateSelfAudit(audit, "design");

      expect(result.valid).toBe(false);
      expect(result.invalidFields).toContain("stateMutation[0]");
    });

    test("rejects observability with non-string element [42]", () => {
      const audit = {
        invariants: "defined",
        boundaries: "defined",
        riskSurface: [],
        stateMutation: [],
        compatibility: "backward-compatible",
        rollback: "revert",
        observability: [42],
        ambiguity: [],
        riskSignals: [],
        confidence: 0.8,
      };

      const result = validateSelfAudit(audit, "design");

      expect(result.valid).toBe(false);
      expect(result.invalidFields).toContain("observability[0]");
    });

    test("rejects taskReadiness blockers with non-string element [123]", () => {
      const audit = {
        invariants: "defined",
        boundaries: "defined",
        taskReadiness: [{ taskId: "1.1", ready: true, blockers: [123] }],
        splitability: [],
        boundaryTests: [],
        rollbackStep: "revert",
        blockers: [],
        placeholders: [],
        ambiguity: [],
        riskSignals: [],
        confidence: 0.8,
      };

      const result = validateSelfAudit(audit, "tasks");

      expect(result.valid).toBe(false);
      expect(result.invalidFields).toContain("taskReadiness[0]");
    });

    test("rejects boundaryTests with non-string element", () => {
      const audit = {
        invariants: "defined",
        boundaries: "defined",
        taskReadiness: [],
        splitability: [],
        boundaryTests: [null],
        rollbackStep: "revert",
        blockers: [],
        placeholders: [],
        ambiguity: [],
        riskSignals: [],
        confidence: 0.8,
      };

      const result = validateSelfAudit(audit, "tasks");

      expect(result.valid).toBe(false);
      expect(result.invalidFields).toContain("boundaryTests[0]");
    });

    test("rejects blockers with non-string element", () => {
      const audit = {
        invariants: "defined",
        boundaries: "defined",
        taskReadiness: [],
        splitability: [],
        boundaryTests: [],
        rollbackStep: "revert",
        blockers: [true],
        placeholders: [],
        ambiguity: [],
        riskSignals: [],
        confidence: 0.8,
      };

      const result = validateSelfAudit(audit, "tasks");

      expect(result.valid).toBe(false);
      expect(result.invalidFields).toContain("blockers[0]");
    });

    test("rejects placeholders with non-string element", () => {
      const audit = {
        invariants: "defined",
        boundaries: "defined",
        taskReadiness: [],
        splitability: [],
        boundaryTests: [],
        rollbackStep: "revert",
        blockers: [],
        placeholders: [{}],
        ambiguity: [],
        riskSignals: [],
        confidence: 0.8,
      };

      const result = validateSelfAudit(audit, "tasks");

      expect(result.valid).toBe(false);
      expect(result.invalidFields).toContain("placeholders[0]");
    });
  });
});
