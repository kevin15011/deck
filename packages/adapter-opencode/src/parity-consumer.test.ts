/**
 * Tests for OpenCode adapter consuming Core registry/parity helpers.
 * Validates that OpenCode correctly maps to canonical capabilities and
 * that parity resolution works without critical gaps.
 */

// @ts-expect-error - vitest types are available at runtime via bun
import { describe, it, expect } from "vitest";
import { resolveRunnerParity, getParityGaps } from "@deck/core/runner-capability-parity";
import {
  validateOpenCodeCatalogAgainstRegistry,
  getCanonicalCapabilityId,
  OPENCODE_RUNNER_CAPABILITY_IDS,
  getOpenCodeRunnerCapability,
} from "./capability-catalog";
import { OPENCODE_INSTALLABLE_TOOLS } from "./installation-plan";
import type { CanonicalCapabilityId } from "./capability-catalog";

describe("OpenCode Registry Consumption", () => {
  describe("validateOpenCodeCatalogAgainstRegistry", () => {
    it("should have no warnings when catalog entries map to registry", () => {
      const warnings = validateOpenCodeCatalogAgainstRegistry();
      expect(warnings).toHaveLength(0);
    });
  });

  describe("getCanonicalCapabilityId", () => {
    it("should return canonical ID for rtk", () => {
      const canonicalId = getCanonicalCapabilityId("rtk");
      expect(canonicalId).toBe("rtk");
    });

    it("should return canonical ID for context-mode", () => {
      const canonicalId = getCanonicalCapabilityId("context-mode");
      expect(canonicalId).toBe("context-mode");
    });

    it("should return canonical ID for codebase-memory", () => {
      const canonicalId = getCanonicalCapabilityId("codebase-memory");
      expect(canonicalId).toBe("codebase-memory");
    });

    it("should return canonical ID for serena", () => {
      const canonicalId = getCanonicalCapabilityId("serena");
      expect(canonicalId).toBe("serena");
    });

    it("should return canonical ID for context7", () => {
      const canonicalId = getCanonicalCapabilityId("context7");
      expect(canonicalId).toBe("context7");
    });

    it("should return canonical ID for opencode-mermaid", () => {
      const canonicalId = getCanonicalCapabilityId("opencode-mermaid");
      expect(canonicalId).toBe("opencode-mermaid");
    });
  });

  describe("OPENCODE_RUNNER_CAPABILITY_IDS", () => {
    it("should contain all expected capability IDs", () => {
      const expectedIds = ["context-mode", "codebase-memory", "rtk", "serena", "context7"];
      expect(OPENCODE_RUNNER_CAPABILITY_IDS).toEqual(expect.arrayContaining(expectedIds));
      expect(OPENCODE_RUNNER_CAPABILITY_IDS).toHaveLength(5);
    });
  });

  describe("OPENCODE_INSTALLABLE_TOOLS", () => {
    it("should have capabilityId for all tools", () => {
      for (const tool of OPENCODE_INSTALLABLE_TOOLS) {
        expect(tool.capabilityId).toBeDefined();
        expect(tool.capabilityId).toBeTruthy();
      }
    });

    it("should have matching capabilityId to catalog canonical IDs", () => {
      const catalogCanonicalIds = new Set<CanonicalCapabilityId>();

      // Collect canonical IDs from all capability entries
      for (const capabilityId of OPENCODE_RUNNER_CAPABILITY_IDS) {
        const entry = getOpenCodeRunnerCapability(capabilityId as any);
        if (entry?.canonicalCapabilityId) {
          catalogCanonicalIds.add(entry.canonicalCapabilityId);
        }
      }

      for (const tool of OPENCODE_INSTALLABLE_TOOLS) {
        // capabilityId is optional in InstallableOpenCodeTool, but if present it should be valid
        if (tool.capabilityId) {
          expect(catalogCanonicalIds.has(tool.capabilityId)).toBe(true);
        }
      }
    });
  });
});

describe("OpenCode Parity Resolution", () => {
  describe("resolveRunnerParity with realistic runtime hints", () => {
    it("should not have critical gaps for OpenCode with realistic runtime hints", () => {
      const runtimeHints = {
        binariesInPath: ["rtk", "context-mode", "codebase-memory-mcp"],
        mcpServersConfigured: ["context-mode", "codebase-memory", "context7", "serena"],
        projectIndexVerified: true,
      };

      const report = resolveRunnerParity("opencode", runtimeHints);

      // For debugging: log all gaps
      if (report.gaps.length > 0) {
        console.log("Gaps found:", JSON.stringify(report.gaps, null, 2));
      }

      // OpenCode should have no gaps with realistic hints
      // Note: Some capabilities may still show as gaps if not all conditions are met
      // Exclude Pi-specific capabilities that are expected to show as gaps in OpenCode
      const criticalGaps = report.gaps.filter((g) =>
        g.severity === "error" &&
        !g.capabilityId.startsWith("pi-")
      );

      // Allow some warnings but not errors (except Pi-specific which are expected)
      expect(criticalGaps).toHaveLength(0);
    });

    it("should report all capabilities in the report", () => {
      const runtimeHints = {
        binariesInPath: ["rtk", "context-mode", "codebase-memory-mcp"],
        mcpServersConfigured: ["context-mode", "codebase-memory", "context7", "serena"],
      };

      const report = resolveRunnerParity("opencode", runtimeHints);

      // Should have capabilities for OpenCode
      expect(report.capabilities.length).toBeGreaterThan(0);
      expect(report.runnerId).toBe("opencode");
    });

    it("should identify codebase-memory by name in the report", () => {
      const runtimeHints = {
        binariesInPath: ["codebase-memory-mcp"],
        mcpServersConfigured: ["codebase-memory"],
      };

      const report = resolveRunnerParity("opencode", runtimeHints);

      const cbEntries = report.capabilities.filter(
        (c) => c.capabilityId === "codebase-memory" || c.capabilityId === "codebase-memory-mcp"
      );
      expect(cbEntries.length).toBeGreaterThan(0);
    });

    it("should identify rtk by name in the report", () => {
      const runtimeHints = {
        binariesInPath: ["rtk"],
        mcpServersConfigured: [],
      };

      const report = resolveRunnerParity("opencode", runtimeHints);

      const rtkEntries = report.capabilities.filter((c) => c.capabilityId === "rtk");
      expect(rtkEntries.length).toBeGreaterThan(0);
    });
  });

  describe("opencode-mermaid as runner-specific", () => {
    it("should appear as runner-specific, not as gap", () => {
      const runtimeHints = {
        binariesInPath: [],
        mcpServersConfigured: [],
      };

      const report = resolveRunnerParity("opencode", runtimeHints);

      const mermaidEntry = report.capabilities.find((c) => c.capabilityId === "opencode-mermaid");
      expect(mermaidEntry).toBeDefined();
      expect(mermaidEntry?.status).toBe("runner-specific");
    });

    it("should not appear in gaps", () => {
      const runtimeHints = {
        binariesInPath: [],
        mcpServersConfigured: [],
      };

      const report = resolveRunnerParity("opencode", runtimeHints);
      const mermaidInGaps = report.gaps.filter((g) => g.capabilityId === "opencode-mermaid");

      // Runner-specific silent packages should NOT appear in gaps
      expect(mermaidInGaps).toHaveLength(0);
    });

    it("should appear in silentPackages", () => {
      const runtimeHints = {
        binariesInPath: [],
        mcpServersConfigured: [],
      };

      const report = resolveRunnerParity("opencode", runtimeHints);

      const silentPackage = report.silentPackages.find((s) => s.capabilityId === "opencode-mermaid");
      expect(silentPackage).toBeDefined();
    });
  });

  describe("getParityGaps", () => {
    it("should return only non-info entries", () => {
      const runtimeHints = {
        binariesInPath: ["rtk", "context-mode", "codebase-memory-mcp"],
        mcpServersConfigured: ["context-mode", "codebase-memory", "context7", "serena"],
      };

      const gaps = getParityGaps("opencode");

      // All gaps should have severity warning or error
      for (const gap of gaps) {
        expect(["warning", "error"]).toContain(gap.severity);
      }
    });
  });
});

describe("OpenCode Actions Shape Preservation", () => {
  // This test ensures that the existing action shape is preserved
  // The capability-plan.ts should still return the same structure

  it("should maintain backward-compatible action structure", () => {
    // Import the actual function to verify structure
    const { buildOpenCodeRunnerReviewPlan } = require("./capability-plan");

    const state = {
      selectedCapabilities: {
        rtk: true,
        "context-mode": true,
        "codebase-memory": true,
        serena: true,
        context7: true,
      },
    };

    // Minimal inventory with ready status
    const inventory = {
      rtk: { status: "ready", commands: ["rtk"], mcpServers: [] },
      "context-mode": { status: "ready", commands: ["context-mode"], mcpServers: ["context-mode"] },
      "codebase-memory": { status: "ready", commands: ["codebase-memory-mcp"], mcpServers: ["codebase-memory"] },
      serena: { status: "ready", commands: ["serena"], mcpServers: ["serena"] },
      context7: { status: "ready", commands: [], mcpServers: ["context7"] },
      "opencode-mermaid": { status: "ready", commands: [], mcpServers: [] },
    };

    const plan = buildOpenCodeRunnerReviewPlan(state as any, inventory as any);

    // Verify the plan has the expected structure
    expect(plan).toHaveProperty("groups");
    expect(plan).toHaveProperty("diagnostics");
    expect(plan).toHaveProperty("ready");
    expect(plan).toHaveProperty("parity"); // New field but optional

    // Verify groups structure is preserved
    expect(plan.groups).toHaveProperty("automaticInstalls");
    expect(plan.groups).toHaveProperty("manualSteps");
    expect(plan.groups).toHaveProperty("configWrites");
    expect(plan.groups).toHaveProperty("teamApplications");
    expect(plan.groups).toHaveProperty("validations");

    // Verify actions have expected fields
    const allActions = [
      ...plan.groups.automaticInstalls,
      ...plan.groups.manualSteps,
      ...plan.groups.configWrites,
      ...plan.groups.teamApplications,
      ...plan.groups.validations,
    ];

    for (const action of allActions) {
      expect(action).toHaveProperty("id");
      expect(action).toHaveProperty("kind");
      expect(action).toHaveProperty("title");
      expect(action).toHaveProperty("status");
    }
  });
});
