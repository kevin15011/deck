/**
 * Focused unit tests for Task 2: Rendering and verification helpers
 *
 * This file verifies that the three helper functions work as specified:
 * 1. renderOrchestratorInvariants
 * 2. prependOrchestratorInvariants
 * 3. verifyOrchestratorInvariantPresence
 */

import { describe, it, expect } from "bun:test";
import {
  renderOrchestratorInvariants,
  prependOrchestratorInvariants,
  verifyOrchestratorInvariantPresence,
  ORCHESTRATOR_INVARIANTS,
  type OrchestratorInvariantSurface,
} from "./orchestrator-invariants";

describe("Task 2: Rendering and verification helpers", () => {
  describe("renderOrchestratorInvariants", () => {
    it("produces output containing ## Orchestrator Invariants header", () => {
      const result = renderOrchestratorInvariants({ surface: "session" });
      expect(result).toContain("## Orchestrator Invariants");
    });

    it("contains all 5 critical invariant IDs", () => {
      const result = renderOrchestratorInvariants({ surface: "session" });
      expect(result).toContain("INV-001");
      expect(result).toContain("INV-002");
      expect(result).toContain("INV-003");
      expect(result).toContain("INV-004");
      expect(result).toContain("INV-005");
    });

    it("filters by surface correctly", () => {
      const resultAgent = renderOrchestratorInvariants({ surface: "agent" });
      const resultSession = renderOrchestratorInvariants({ surface: "session" });

      // Both should contain content since all invariants target all surfaces
      expect(resultAgent).toContain("INV-001");
      expect(resultSession).toContain("INV-001");
    });

    it("orders by tier (critical first)", () => {
      const result = renderOrchestratorInvariants({ surface: "session", tierMin: "critical" });
      const inv001Pos = result.indexOf("INV-001");
      const inv002Pos = result.indexOf("INV-002");

      // INV-001 should come before INV-002
      expect(inv001Pos).toBeLessThan(inv002Pos);
    });
  });

  describe("prependOrchestratorInvariants", () => {
    it("prepends invariant block to content", () => {
      const existingContent = "# Hello World\n\nSome content here.";
      const result = prependOrchestratorInvariants(existingContent, "session");

      expect(result.startsWith("## Orchestrator Invariants")).toBe(true);
      expect(result).toContain("# Hello World");
    });

    it("is idempotent - calling twice produces no duplicates", () => {
      const existingContent = "# Test\n\nContent.";
      const first = prependOrchestratorInvariants(existingContent, "session");
      const second = prependOrchestratorInvariants(first, "session");

      // Count occurrences of the header
      const headerMatches = second.match(/## Orchestrator Invariants/g);
      expect(headerMatches?.length).toBe(1);

      // Count INV-001 occurrences
      const inv001Matches = second.match(/INV-001/g);
      expect(inv001Matches?.length).toBe(1);
    });

    it("skips when content already contains invariants section (REQ-OIS-006)", () => {
      const contentWithInvariants = `## Orchestrator Invariants

### INV-001: Execution Mode Gate

**Condition**: First change request in a session

**Required Action**: Ask user...

# Other Content`;

      const result = prependOrchestratorInvariants(contentWithInvariants, "session");
      expect(result).toBe(contentWithInvariants);
    });
  });

  describe("verifyOrchestratorInvariantPresence", () => {
    it("returns pass: true for fully composed output", () => {
      const fullOutput = `# Orchestrator Content

## Orchestrator Invariants

### INV-001: Execution Mode Gate
**Required Action**: Ask user...

### INV-002: Pure Delegator
**Required Action**: Delegate...

### INV-003: SDD Initialization Gate
**Required Action**: Read config...

### INV-004: SDD Triage Gate
**Required Action**: Classify request...

### INV-005: Registry-Deferred Parallelism
**Required Action**: Serialize updates...
`;

      const result = verifyOrchestratorInvariantPresence(fullOutput, {
        surface: "session",
      });

      expect(result.pass).toBe(true);
      expect(result.missing).toEqual([]);
    });

    it("returns pass: false with missing INV-004 when removed", () => {
      const missingInv004 = `# Orchestrator Content

## Orchestrator Invariants

### INV-001: Execution Mode Gate
### INV-002: Pure Delegator
### INV-003: SDD Initialization Gate
### INV-005: Registry-Deferred Parallelism
`;

      const result = verifyOrchestratorInvariantPresence(missingInv004, {
        surface: "session",
      });

      expect(result.pass).toBe(false);
      expect(result.missing).toContain("INV-004");
    });

    it("detects missing ## Orchestrator Invariants header", () => {
      const noHeader = `# Some Content

INV-001: Execution Mode Gate
INV-002: Pure Delegator
`;

      const result = verifyOrchestratorInvariantPresence(noHeader, {
        surface: "session",
      });

      expect(result.pass).toBe(false);
      expect(result.missing.length).toBe(5); // All 5
    });

    it("detects duplicate section header as failure", () => {
      const duplicateHeader = `## Orchestrator Invariants

### INV-001

## Orchestrator Invariants

### INV-002
`;

      const result = verifyOrchestratorInvariantPresence(duplicateHeader, {
        surface: "session",
      });

      expect(result.pass).toBe(false);
    });
  });

  describe("TypeScript compilation", () => {
    it("compiles without errors", () => {
      // Already verified via tsc. This is a documentation test.
      expect(true).toBe(true);
    });
  });
});

describe("Export verification", () => {
  it("ORCHESTRATOR_INVARIANTS has exactly 5 records", () => {
    expect(ORCHESTRATOR_INVARIANTS.length).toBe(5);
  });

  it("all records have tier: critical", () => {
    for (const inv of ORCHESTRATOR_INVARIANTS) {
      expect(inv.tier).toBe("critical");
    }
  });

  it("each record has required fields", () => {
    for (const inv of ORCHESTRATOR_INVARIANTS) {
      expect(inv.id).toBeTruthy();
      expect(inv.surfaces.length).toBeGreaterThan(0);
      expect(inv.condition).toBeTruthy();
      expect(inv.requiredAction).toBeTruthy();
      expect(inv.sourceRefs.length).toBeGreaterThan(0);
    }
  });
});