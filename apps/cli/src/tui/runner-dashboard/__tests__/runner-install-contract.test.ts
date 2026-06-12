/**
 * Runner-agnostic contract tests for runRunnerReviewPlan.
 * Tests install sequencing and gating with mocked dependencies.
 * Covers: REQ-INSTALL-001, REQ-INSTALL-002, REQ-MCP-001, REQ-MCP-002, REQ-EXE-001
 */

import { describe, expect, test, beforeEach, vi } from "bun:test";
import { runRunnerReviewPlan, type RunnerActionRunnerDependencies } from "../action-runner";
import type { RunnerReviewPlan, RunnerAction, ActionKind, CapabilityId, ToolId, PackageId, ImplementationId, RunnerActionStatus } from "../state";

// Helper to create RunnerAction with required status field
function createTestAction(
  id: string,
  kind: ActionKind,
  title: string,
  capabilityId?: CapabilityId,
  toolId?: ToolId,
  source?: string,
): RunnerAction {
  return {
    id,
    kind,
    title,
    capabilityId,
    toolId,
    source,
    status: "ready",
  };
}

describe("runRunnerReviewPlan contract tests", () => {
  // Test install failure prevents MCP config write (REQ-MCP-001)
  describe("Install failure gates MCP config (REQ-MCP-001)", () => {
    test("skips MCP config when install failed for same capability", async () => {
      const mockInstallPackages = vi.fn(async () => [{ success: false, message: "Install failed" }]);

      const plan = createMinimalPlan({
        automaticInstalls: [
          createTestAction("capability.serena.install", "install-opencode-plugin", "Install Serena", "serena", "serena", "oraios/serena"),
        ],
        configWrites: [
          createTestAction("capability.serena.mcp-config", "write-mcp-config", "Write MCP config", "serena"),
        ],
      });

      const dependencies: RunnerActionRunnerDependencies = {
        runnerCommand: "opencode",
        installPackages: mockInstallPackages,
        writeMcpConfig: async () => ({ ok: true, path: "/tmp/mcp.json", diagnostics: [] }),
      };

      const results = await runRunnerReviewPlan(plan, dependencies);

      // Find the MCP config action result
      const mcpResult = results.find((r) => r.actionId === "capability.serena.mcp-config");

      // MCP config should be skipped because install failed
      expect(mcpResult?.status).toBe("skipped");
      expect(mcpResult?.message).toContain("install failed");
    });

    test("allows MCP config when install succeeded", async () => {
      const mockInstallPackages = vi.fn(async () => [{ success: true, message: "Installed" }]);

      const plan = createMinimalPlan({
        automaticInstalls: [
          createTestAction("capability.serena.install", "install-opencode-plugin", "Install Serena", "serena", "serena", "oraios/serena"),
        ],
        configWrites: [
          createTestAction("capability.serena.mcp-config", "write-mcp-config", "Write MCP config", "serena"),
        ],
      });

      const dependencies: RunnerActionRunnerDependencies = {
        runnerCommand: "opencode",
        installPackages: mockInstallPackages,
        writeMcpConfig: async () => ({ ok: true, path: "/tmp/mcp.json", diagnostics: [] }),
      };

      const results = await runRunnerReviewPlan(plan, dependencies);

      // Find the MCP config action result
      const mcpResult = results.find((r) => r.actionId === "capability.serena.mcp-config");

      // MCP config should succeed because install succeeded
      expect(mcpResult?.status).toBe("executed");
    });
  });

  // Test binary check fails prevents dependent config (REQ-EXE-001)
  describe("Binary check gates MCP config (REQ-EXE-001)", () => {
    test("skips MCP config when binary not found on PATH", async () => {
      const mockInstallPackages = vi.fn(async () => [{ success: true, message: "Installed" }]);

      // Create plan with binary-requiring capability
      const plan = createMinimalPlan({
        automaticInstalls: [
          createTestAction("capability.serena.install", "install-opencode-plugin", "Install Serena", "serena", "serena", "oraios/serena"),
        ],
        configWrites: [
          createTestAction("capability.serena.mcp-config", "write-mcp-config", "Write MCP config", "serena"),
        ],
      });

      // Don't provide PATH with serena binary - simulate binary not found
      const originalPath = process.env.PATH;
      process.env.PATH = "/nonexistent"; // Empty PATH without serena

      const dependencies: RunnerActionRunnerDependencies = {
        runnerCommand: "opencode",
        installPackages: mockInstallPackages,
        writeMcpConfig: async () => ({ ok: true, path: "/tmp/mcp.json", diagnostics: [] }),
      };

      const results = await runRunnerReviewPlan(plan, dependencies);

      // Restore PATH
      process.env.PATH = originalPath;

      // Find the MCP config action result
      const mcpResult = results.find((r) => r.actionId === "capability.serena.mcp-config");

      // MCP config should fail because binary not found on PATH
      expect(mcpResult?.status).toBe("failed");
      expect(mcpResult?.message).toContain("not found on PATH");
    });
  });

  // Test that MCP-only capabilities don't require binary check
  describe("MCP-only capabilities skip binary check", () => {
    test("allows context7 MCP config without binary check", async () => {
      const mockInstallPackages = vi.fn(async () => [{ success: true, message: "Installed" }]);

      const plan = createMinimalPlan({
        automaticInstalls: [
          createTestAction("capability.context7.install", "install-opencode-plugin", "Install Context7", "context7", "context7", "@upstash/context7-mcp"),
        ],
        configWrites: [
          createTestAction("capability.context7.mcp-config", "write-mcp-config", "Write MCP config", "context7"),
        ],
      });

      // Set empty PATH - but context7 is MCP-only so should still work
      const originalPath = process.env.PATH;
      process.env.PATH = "/nonexistent";

      const dependencies: RunnerActionRunnerDependencies = {
        runnerCommand: "opencode",
        installPackages: mockInstallPackages,
        writeMcpConfig: async () => ({ ok: true, path: "/tmp/mcp.json", diagnostics: [] }),
      };

      const results = await runRunnerReviewPlan(plan, dependencies);

      process.env.PATH = originalPath;

      // context7 MCP should execute (doesn't require binary)
      const mcpResult = results.find((r) => r.actionId === "capability.context7.mcp-config");
      expect(mcpResult?.status).toBe("executed");
    });
  });

  // Test install sequencing (REQ-INSTALL-001)
  describe("Install executes before config writes", () => {
    test("runs installs first, then config writes", async () => {
      const executionOrder: string[] = [];

      const mockInstallPackages = vi.fn(async () => {
        executionOrder.push("install");
        return [{ success: true, message: "Installed" }];
      });

      const mockWriteMcpConfig = vi.fn(async () => {
        executionOrder.push("config");
        return { ok: true, path: "/tmp/mcp.json", diagnostics: [] };
      });

      const plan = createMinimalPlan({
        automaticInstalls: [
          createTestAction("capability.context7.install", "install-opencode-plugin", "Install Context7", "context7", "context7", "@upstash/context7-mcp"),
        ],
        configWrites: [
          createTestAction("capability.context7.mcp-config", "write-mcp-config", "Write MCP config", "context7"),
        ],
      });

      // context7 is MCP-only so doesn't require binary check
      const originalPath = process.env.PATH;
      process.env.PATH = "/usr/bin:/bin";

      const dependencies: RunnerActionRunnerDependencies = {
        runnerCommand: "opencode",
        installPackages: mockInstallPackages,
        writeMcpConfig: mockWriteMcpConfig,
      };

      await runRunnerReviewPlan(plan, dependencies);

      process.env.PATH = originalPath;

      // Install should execute before config write
      expect(executionOrder).toEqual(["install", "config"]);
    });
  });

  // Test package install behavior (REQ-INSTALL-002)
  describe("Package install behavior", () => {
    test("reports failure when install returns no result", async () => {
      const mockInstallPackages = vi.fn(async () => []); // Empty results

      const plan = createMinimalPlan({
        automaticInstalls: [
          createTestAction("capability.serena.install", "install-opencode-plugin", "Install Serena", "serena", "serena", "oraios/serena"),
        ],
        configWrites: [],
      });

      const dependencies: RunnerActionRunnerDependencies = {
        runnerCommand: "opencode",
        installPackages: mockInstallPackages,
      };

      const results = await runRunnerReviewPlan(plan, dependencies);

      const installResult = results.find((r) => r.actionId === "capability.serena.install");
      expect(installResult?.status).toBe("failed");
      expect(installResult?.message).toContain("no result");
    });
  });
});

// Helper to create minimal plan for testing
function createMinimalPlan(groups: {
  automaticInstalls?: RunnerAction[];
  manualSteps?: RunnerAction[];
  configWrites?: RunnerAction[];
  teamApplications?: RunnerAction[];
  validations?: RunnerAction[];
}): RunnerReviewPlan {
  return {
    groups: {
      automaticInstalls: groups.automaticInstalls ?? [],
      manualSteps: groups.manualSteps ?? [],
      configWrites: groups.configWrites ?? [],
      teamApplications: groups.teamApplications ?? [],
      validations: groups.validations ?? [],
    },
    diagnostics: [],
    ready: true,
  };
}