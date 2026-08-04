/**
 * Runner-agnostic contract tests for runRunnerReviewPlan.
 * Tests install sequencing and gating with mocked dependencies.
 * Covers: REQ-INSTALL-001, REQ-INSTALL-002, REQ-MCP-001, REQ-MCP-002, REQ-EXE-001
 */

import { describe, expect, test, beforeEach, vi } from "bun:test";
import { runRunnerReviewPlan, type RunnerActionRunnerDependencies } from "../action-runner";
import type { RunnerReviewPlan, RunnerAction, ActionKind, CapabilityId, ToolId, PackageId, ImplementationId, RunnerActionStatus } from "../state";
import { createDefaultRunnerDashboardState } from "../state";

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
  test("keeps Serena authorization, stage ordering, readiness handoff, and fail-closed writes equivalent for Pi and OpenCode", async () => {
    for (const runner of ["pi", "opencode"] as const) {
      const operation = { runner, operationId: `${runner}-contract-operation`, explicitlySelected: true };
      const authorization = {
        kind: "interactive-tui-explicit-selection" as const,
        runner,
        operationId: operation.operationId,
      };
      const executable = `/fixtures/${runner}/tools/serena/bin/serena`;
      const readiness = {
        capabilityId: "serena" as const,
        state: "ready" as const,
        resolvedExecutablePath: executable,
        source: "installed-deck-tool" as const,
        probe: "serena-help" as const,
        fingerprint: `${runner}-fingerprint`,
      };
      const plan = createMinimalPlan({
        automaticInstalls: [createTestAction(
          "capability.serena.install",
          runner === "pi" ? "install-pi-package" : "install-opencode-plugin",
          "Install Serena",
          "serena",
          "serena",
          "serena-agent",
        )],
        configWrites: [createTestAction(
          "capability.serena.mcp-config",
          runner === "pi" ? "write-pi-mcp-config" : "write-mcp-config",
          "Configure Serena MCP",
          "serena",
          "serena",
          "serena-agent",
        )],
      });
      const stages: string[] = [];
      const calls: string[] = [];
      const writes: unknown[] = [];
      const state = createDefaultRunnerDashboardState({
        runnerScope: runner,
        operationId: operation.operationId,
        currentOperation: operation,
        explicitlySelectedCapabilities: { serena: true },
        selectedCapabilities: { serena: true },
        plan,
        planGeneratedForRevision: 0,
      });

      const results = await runRunnerReviewPlan(plan, {
        dashboardState: state,
        runnerId: runner,
        runnerCommand: runner,
        currentOperation: operation,
        serenaAuthorization: authorization,
        onSerenaStage: (stage) => stages.push(stage),
        installPackages: async (_command, packages, _onResult, context) => {
          calls.push(`install:${context?.runnerId}:${context?.operationId}`);
          context?.onSerenaStage?.("installing-serena");
          context?.onSerenaStage?.("validating-serena");
          return [{
            id: packages[0]!.id,
            outcome: "executed" as const,
            success: true,
            message: "Serena installed and validated.",
            serenaBootstrapOutcome: "installed" as const,
            serenaReadiness: readiness,
          }];
        },
        writeMcpConfig: async (options, context) => {
          calls.push(`config:${context?.runnerId}:${context?.operationId}`);
          writes.push({ options, context });
          return { ok: true, path: `/fixtures/${runner}/mcp.json`, diagnostics: [] };
        },
      });

      expect(calls).toEqual([
        `install:${runner}:${operation.operationId}`,
        `config:${runner}:${operation.operationId}`,
      ]);
      expect(stages).toEqual(["preparing-uv", "installing-serena", "validating-serena", "configuring-mcp"]);
      expect(writes).toHaveLength(1);
      expect(writes[0]).toMatchObject({
        options: {
          serverName: "serena",
          command: [executable, "start-mcp-server", "--context", "ide", "--project-from-cwd"],
        },
      });
      expect(JSON.stringify(results)).not.toContain(executable);
      expect(results.find((result) => result.actionId === "capability.serena.mcp-config")?.status).toBe("executed");
    }
  });

  test("rejects default-only or runner-mismatched Serena operations without any writer call", async () => {
    const writes: string[] = [];
    const plan = createMinimalPlan({
      automaticInstalls: [createTestAction("capability.serena.install", "install-pi-package", "Install Serena", "serena", "serena", "serena-agent")],
      configWrites: [createTestAction("capability.serena.mcp-config", "write-pi-mcp-config", "Configure Serena MCP", "serena")],
    });
    const operation = { runner: "opencode" as const, operationId: "opencode-contract-operation", explicitlySelected: true };

    const results = await runRunnerReviewPlan(plan, {
      runnerId: "pi",
      currentOperation: operation,
      serenaAuthorization: {
        kind: "interactive-tui-explicit-selection",
        runner: "opencode",
        operationId: operation.operationId,
      },
      installPackages: async () => [{ id: "serena", outcome: "executed" as const, success: true, message: "must not run" }],
      writeMcpConfig: async () => {
        writes.push("write");
        return { ok: true, path: "/fixtures/mcp.json", diagnostics: [] };
      },
    });

    expect(writes).toEqual([]);
    expect(results.some((result) => result.status === "failed")).toBe(true);
    expect(results.find((result) => result.actionId === "capability.serena.mcp-config")?.status).toBe("failed");
  });

  // Test install failure prevents MCP config write (REQ-MCP-001)
  describe("Install failure gates MCP config (REQ-MCP-001)", () => {
    test("skips MCP config when install failed for same capability", async () => {
      const mockInstallPackages = vi.fn(async (_command: string | undefined, packages: Array<{ id: string }>) => [{ id: packages[0]?.id, outcome: "failed" as const, success: false, message: "Install failed" }]);

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
        runnerId: "opencode",
        currentOperation: { runner: "opencode", operationId: "contract-success", explicitlySelected: true },
        serenaAuthorization: {
          kind: "interactive-tui-explicit-selection",
          runner: "opencode",
          operationId: "contract-success",
        },
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
      const mockInstallPackages = vi.fn(async (_command: string | undefined, packages: Array<{ id: string }>) => [{
        id: packages[0]?.id,
        outcome: "executed" as const,
        success: true,
        message: "Installed",
        serenaBootstrapOutcome: "installed" as const,
        serenaReadiness: {
          capabilityId: "serena" as const,
          state: "ready" as const,
          resolvedExecutablePath: "/fixtures/deck-data/tools/serena/bin/serena",
          source: "installed-deck-tool" as const,
          probe: "serena-help" as const,
          fingerprint: "contract-fingerprint",
        },
      }]);

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
        runnerId: "opencode",
        currentOperation: { runner: "opencode", operationId: "contract-success", explicitlySelected: true },
        serenaAuthorization: {
          kind: "interactive-tui-explicit-selection",
          runner: "opencode",
          operationId: "contract-success",
        },
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
      // Create plan with binary-requiring capability
      const plan = createMinimalPlan({
        automaticInstalls: [],
        configWrites: [
          createTestAction("capability.codebase-memory-mcp.mcp-config", "write-mcp-config", "Write MCP config", "codebase-memory-mcp"),
        ],
      });

       // Don't provide PATH with codebase-memory binary - simulate binary not found
      const originalPath = process.env.PATH;
      process.env.PATH = "/nonexistent"; // Empty PATH without serena

      const dependencies: RunnerActionRunnerDependencies = {
        runnerCommand: "opencode",
        writeMcpConfig: async () => ({ ok: true, path: "/tmp/mcp.json", diagnostics: [] }),
      };

      const results = await runRunnerReviewPlan(plan, dependencies);

      // Restore PATH
      process.env.PATH = originalPath;

      // Find the MCP config action result
      const mcpResult = results.find((r) => r.actionId === "capability.codebase-memory-mcp.mcp-config");

       // MCP config should fail because binary not found on PATH
      expect(mcpResult?.status).toBe("failed");
      expect(mcpResult?.message).toContain("not found on PATH");
    });
  });

  // Test that MCP-only capabilities don't require binary check
  describe("MCP-only capabilities skip binary check", () => {
    test("allows context7 MCP config without binary check", async () => {
      const mockInstallPackages = vi.fn(async (_command: string | undefined, packages: Array<{ id: string }>) => [{ id: packages[0]?.id, outcome: "executed" as const, success: true, message: "Installed" }]);

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

      const mockInstallPackages = vi.fn(async (_command: string | undefined, packages: Array<{ id: string }>) => {
        executionOrder.push("install");
        return [{ id: packages[0]?.id, outcome: "executed" as const, success: true, message: "Installed" }];
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
          createTestAction("capability.context7.install", "install-opencode-plugin", "Install Context7", "context7", "context7", "@upstash/context7-mcp"),
        ],
        configWrites: [],
      });

      const dependencies: RunnerActionRunnerDependencies = {
        runnerCommand: "opencode",
        installPackages: mockInstallPackages,
      };

      const results = await runRunnerReviewPlan(plan, dependencies);

       const installResult = results.find((r) => r.actionId === "capability.context7.install");
      expect(installResult?.status).toBe("failed");
      expect(installResult?.message).toContain("no result");
    });
  });
});

// Helper to create minimal plan for testing
describe("T5 rich package outcome projection and dependency isolation", () => {
  type PackageOutcome = "already-present" | "executed" | "failed" | "skipped";

  function packageResult(
    id: string | undefined,
    outcome: PackageOutcome,
    message: string,
    extra: Record<string, unknown> = {},
  ) {
    return {
      ...(id === undefined ? {} : { id }),
      outcome,
      success: outcome === "already-present" || outcome === "executed",
      message,
      ...extra,
    };
  }

  test("projects already-present as a satisfied skipped action and drops raw captures", async () => {
    const rawCapture = "raw stderr with /home/private/token=do-not-leak";
    const writeMcpConfig = vi.fn(async () => ({ ok: true, path: "/tmp/mcp.json", diagnostics: [] }));
    const installPackages = vi.fn(async (_command: string | undefined, packages: Array<{ id: string }>) => [
      packageResult(packages[0]?.id, "already-present", "codebase-memory already present; installer not run.", {
        cause: "binary is already usable",
        diagnostic: {
          stage: "evidence",
          code: "already-present",
          lines: ["binary is already usable"],
        },
        raw: { stderr: rawCapture },
      }),
    ]);
    const observed: unknown[] = [];

    const results = await runRunnerReviewPlan(createMinimalPlan({
      automaticInstalls: [createTestAction("capability.codebase-memory.install", "install-opencode-plugin", "Install codebase-memory", "codebase-memory", "codebase-memory", "DeusData/codebase-memory-mcp")],
      configWrites: [createTestAction("capability.codebase-memory.mcp-config", "write-mcp-config", "Write codebase-memory MCP config", "codebase-memory")],
    }), {
      runnerCommand: "opencode",
      installPackages: installPackages as never,
      writeMcpConfig,
      onActionResult: (result) => observed.push(result),
    });

    const install = results.find((result) => result.actionId === "capability.codebase-memory.install");
    const config = results.find((result) => result.actionId === "capability.codebase-memory.mcp-config");
    expect(install).toMatchObject({
      status: "skipped",
      packageOutcome: "already-present",
      message: "codebase-memory already present; installer not run.",
    });
    expect(config?.status).toBe("executed");
    expect(writeMcpConfig).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(results)).not.toContain(rawCapture);
    expect(JSON.stringify(observed)).not.toContain(rawCapture);
  });

  test("ordinary skipped outcomes gate only the matching dependent config", async () => {
    const writes: string[] = [];
    const installPackages = vi.fn(async (_command: string | undefined, packages: Array<{ id: string }>) => [
      packageResult(packages[0]?.id, "skipped", "installation was skipped before mutation"),
    ]);
    const results = await runRunnerReviewPlan(createMinimalPlan({
      automaticInstalls: [createTestAction("capability.context7.install", "install-opencode-plugin", "Install Context7", "context7", "context7", "@upstash/context7-mcp")],
      configWrites: [
        createTestAction("capability.context7.mcp-config", "write-mcp-config", "Write Context7 MCP config", "context7"),
        createTestAction("capability.unrelated.mcp-config", "write-mcp-config", "Write unrelated MCP config", "context7"),
      ],
    }), {
      runnerCommand: "opencode",
      installPackages: installPackages as never,
      writeMcpConfig: async ({ serverName }) => {
        writes.push(serverName);
        return { ok: true, path: "/tmp/mcp.json", diagnostics: [] };
      },
    });

    expect(results.find((result) => result.actionId === "capability.context7.mcp-config")).toMatchObject({
      status: "skipped",
      message: expect.stringContaining("install failed"),
    });
    expect(results.find((result) => result.actionId === "capability.unrelated.mcp-config")?.status).toBe("executed");
    expect(writes).toEqual(["context7"]);
  });

  test("rejects missing, unknown, and duplicate package IDs as integrity failures", async () => {
    const cases = [
      ["missing id", [packageResult(undefined, "executed", "installed")] ],
      ["unknown id", [packageResult("rtk", "executed", "installed")] ],
      ["duplicate id", [packageResult("context7", "executed", "installed"), packageResult("context7", "executed", "installed")] ],
    ] as const;

    for (const [label, packageResults] of cases) {
      const results = await runRunnerReviewPlan(createMinimalPlan({
        automaticInstalls: [createTestAction("capability.context7.install", "install-opencode-plugin", "Install Context7", "context7", "context7", "@upstash/context7-mcp")],
      }), {
        runnerCommand: "opencode",
        installPackages: vi.fn(async () => packageResults) as never,
      });
      const result = results[0];
      expect(result?.status, label).toBe("failed");
      expect(result?.message, label).toContain("integrity");
    }
  });

  test("rejects inconsistent outcome and success combinations", async () => {
    const results = await runRunnerReviewPlan(createMinimalPlan({
      automaticInstalls: [createTestAction("capability.context7.install", "install-opencode-plugin", "Install Context7", "context7", "context7", "@upstash/context7-mcp")],
    }), {
      runnerCommand: "opencode",
      installPackages: vi.fn(async () => [{
        id: "context7",
        outcome: "already-present",
        success: false,
        message: "invalid result",
      }]) as never,
    });

    expect(results[0]?.status).toBe("failed");
    expect(results[0]?.message).toContain("integrity");
  });

  test("sanitizes and bounds package diagnostics before action callbacks", async () => {
    const hostile = [
      "\u001b[31merror\u001b[0m /home/private/.config token=super-secret ░░░",
      ...Array.from({ length: 10 }, (_, index) => `failure ${index} ${"x".repeat(300)}`),
    ];
    const results = await runRunnerReviewPlan(createMinimalPlan({
      automaticInstalls: [createTestAction("capability.context7.install", "install-opencode-plugin", "Install Context7", "context7", "context7", "@upstash/context7-mcp")],
    }), {
      runnerCommand: "opencode",
      installPackages: vi.fn(async () => [packageResult("context7", "failed", "Package install failed.", {
        cause: hostile.join("\n"),
        diagnostic: { stage: "install", code: "installer-failed", lines: hostile },
      })]) as never,
    });

    const result = results[0]!;
    const diagnostics = result.diagnostics;
    const serialized = JSON.stringify(result);
    expect(result.status).toBe("failed");
    expect(result.cause).not.toContain("\u001b");
    expect(result.cause).not.toContain("/home/private");
    expect(result.cause).not.toContain("super-secret");
    expect(result.cause).not.toContain("░");
    expect(diagnostics.length).toBeLessThanOrEqual(8);
    expect(diagnostics.every((line) => [...line].length <= 240)).toBe(true);
    expect(Buffer.byteLength(diagnostics.join(""), "utf8")).toBeLessThanOrEqual(1280);
    expect(serialized).not.toContain("do-not-leak");
    expect(result.raw).toMatchObject({ id: "context7", outcome: "failed" });
  });
});

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
