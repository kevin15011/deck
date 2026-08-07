/**
 * Tests for Runner Capability Parity Resolver
 *
 * Validates parity resolution, gaps, blockers, and error codes.
 */

import { describe, it, expect } from "bun:test";
import {
  resolveRunnerParity as resolveCoreRunnerParity,
  getParityGaps as getCoreParityGaps,
  type ParityReport,
  type ParityReportEntry,
} from "./runner-capability-parity";
import { defineRunnerCapabilityContribution } from "./runner-capability-registry";
import { PI_RUNNER_CAPABILITY_CONTRIBUTION } from "@deck/adapter-pi";
import { OPENCODE_RUNNER_CAPABILITY_CONTRIBUTION } from "@deck/adapter-opencode";

const adapterContributions = [PI_RUNNER_CAPABILITY_CONTRIBUTION, OPENCODE_RUNNER_CAPABILITY_CONTRIBUTION] as const;
const resolveRunnerParity = (runnerId: string, runtimeHints?: Parameters<typeof resolveCoreRunnerParity>[1]) =>
  resolveCoreRunnerParity(runnerId, runtimeHints, adapterContributions);
const getParityGaps = (runnerId: string) => getCoreParityGaps(runnerId, adapterContributions);

describe("Runner Capability Parity Resolver", () => {
  it("uses runner-neutral codes and identifies the runner and capability in failures", () => {
    const contribution = defineRunnerCapabilityContribution({
      runnerId: "codex",
      mappings: [
        { capabilityId: "context-mode", runnerId: "codex", status: "shared", detectors: { commands: ["context-mode"], mcpServerNames: ["context-mode"] }, parityChecks: ["binary-usable", "mcp-config-present"] },
        { capabilityId: "codebase-memory", runnerId: "codex", status: "shared", detectors: { commands: ["codebase-memory-mcp"], mcpServerNames: ["codebase-memory"] }, parityChecks: ["binary-usable", "mcp-config-present"] },
      ],
    });
    const report = resolveCoreRunnerParity("codex", {
      binariesInPath: ["context-mode", "codebase-memory-mcp"],
      mcpServersConfigured: ["codebase-memory"],
      projectIndexVerified: false,
    }, [contribution]);

    expect(report.capabilities.find((entry) => entry.capabilityId === "context-mode")).toMatchObject({
      runnerId: "codex",
      code: "capability-mcp-not-configured",
    });
    expect(report.capabilities.find((entry) => entry.capabilityId === "codebase-memory")).toMatchObject({
      runnerId: "codex",
      code: "capability-index-unverified",
    });
    for (const entry of report.capabilities.filter((candidate) => candidate.code)) {
      expect(entry.code).not.toMatch(/^pi-/);
      expect(entry.message).toContain(`Runner codex capability ${entry.capabilityId}`);
    }
  });

  it("uses the same neutral context-mode, RTK, Serena, MCP, and index failures for a synthetic runner", () => {
    const contribution = defineRunnerCapabilityContribution({
      runnerId: "synthetic",
      mappings: [
        { capabilityId: "context-mode", runnerId: "synthetic", status: "shared" },
        { capabilityId: "rtk", runnerId: "synthetic", status: "gap" },
        { capabilityId: "serena", runnerId: "synthetic", status: "shared" },
        { capabilityId: "codebase-memory", runnerId: "synthetic", status: "shared" },
        { capabilityId: "codebase-memory-mcp", runnerId: "synthetic", status: "shared" },
      ],
    });
    const report = resolveCoreRunnerParity("synthetic", {
      binariesInPath: ["context-mode", "codebase-memory-mcp"],
      mcpServersConfigured: ["codebase-memory"],
      projectIndexVerified: false,
    }, [contribution]);

    expect(report.capabilities.find((entry) => entry.capabilityId === "context-mode")?.code).toBe("capability-mcp-not-configured");
    expect(report.capabilities.find((entry) => entry.capabilityId === "rtk")?.code).toBe("capability-mapping-gap");
    expect(report.capabilities.find((entry) => entry.capabilityId === "serena")?.code).toBe("capability-binary-not-usable");
    expect(report.capabilities.find((entry) => entry.capabilityId === "codebase-memory")?.code).toBe("capability-index-unverified");
    const mcpReport = resolveCoreRunnerParity("synthetic", {
      binariesInPath: ["context-mode", "codebase-memory-mcp"],
      mcpServersConfigured: [],
    }, [contribution]);
    expect(mcpReport.capabilities.find((entry) => entry.capabilityId === "codebase-memory-mcp")?.code).toBe("capability-mcp-not-configured");
  });

  it("required protected capabilities omitted by an adapter are explicit error gaps", () => {
    const contribution = defineRunnerCapabilityContribution({ runnerId: "synthetic", mappings: [] });
    const report = resolveCoreRunnerParity("synthetic", undefined, [contribution]);
    for (const capabilityId of ["trusted-runner-host-bridge", "invocation-authorization", "execution-dossier", "controlled-effects", "registry-coordination", "bound-verification"]) {
      expect(report.gaps).toContainEqual(expect.objectContaining({
        capabilityId,
        status: "gap",
        severity: "error",
        code: "missing-runner-mapping",
      }));
    }
  });
  describe("OpenCode with full runtime hints", () => {
    it("should have minimal gaps for OpenCode with binaries in PATH", () => {
      const report = resolveRunnerParity("opencode", {
        binariesInPath: ["rtk", "context-mode", "codebase-memory-mcp", "serena"],
        mcpServersConfigured: ["context-mode", "codebase-memory", "context7", "serena", "supermemory"],
        supermemoryConfigured: true,
      });

      // OpenCode has minimal gaps - deck-init doesn't have binary requirement
      // The key is that core capabilities like rtk, context-mode, codebase-memory are OK
      const coreGaps = report.gaps.filter(
        (g) => g.severity === "error" &&
          ["rtk", "context-mode", "codebase-memory", "codebase-memory-mcp", "serena", "context7", "supermemory-tool-bindings"].includes(g.capabilityId)
      );
      expect(coreGaps.length).toBe(0);
    });

    it("should identify rtk as shared when binary is in PATH", () => {
      const report = resolveRunnerParity("opencode", {
        binariesInPath: ["rtk"],
      });

      const rtkEntry = report.capabilities.find((c) => c.capabilityId === "rtk");
      expect(rtkEntry?.status).toBe("shared");
    });

    it("should identify codebase-memory as supported when MCP configured", () => {
      const report = resolveRunnerParity("opencode", {
        binariesInPath: ["codebase-memory-mcp"],
        mcpServersConfigured: ["codebase-memory"],
        projectIndexVerified: true,
      });

      const cbmEntry = report.capabilities.find((c) => c.capabilityId === "codebase-memory");
      expect(cbmEntry).toBeDefined();
      // OpenCode has codebase-memory as "supported" in the mapping
      expect(["supported", "shared"]).toContain(cbmEntry!.status);
    });
  });

  describe("Pi with missing capabilities", () => {
    it("should identify Serena gap when not in PATH", () => {
      const report = resolveRunnerParity("pi", {
        binariesInPath: [],
        mcpServersConfigured: [],
      });

      const serenaEntry = report.capabilities.find((c) => c.capabilityId === "serena");
      expect(serenaEntry?.status).toBe("gap");
      expect(serenaEntry?.code).toBe("capability-binary-not-usable");
    });

    it("should identify Context7 gap when MCP not configured", () => {
      const report = resolveRunnerParity("pi", {
        binariesInPath: [],
        mcpServersConfigured: [],
      });

      const context7Entry = report.capabilities.find((c) => c.capabilityId === "context7");
      expect(context7Entry?.status).toBe("gap");
    });

    it("should identify Supermemory gap when not configured", () => {
      const report = resolveRunnerParity("pi", {
        binariesInPath: [],
        mcpServersConfigured: [],
        supermemoryConfigured: false,
      });

      const supermemoryEntry = report.capabilities.find(
        (c) => c.capabilityId === "supermemory-tool-bindings"
      );
      expect(supermemoryEntry?.status).toBe("gap");
      expect(supermemoryEntry?.code).toBe("capability-mcp-not-configured");
    });
  });

  describe("Pi with shared binaries", () => {
    it("should identify rtk as shared when binary is in PATH", () => {
      const report = resolveRunnerParity("pi", {
        binariesInPath: ["rtk"],
        mcpServersConfigured: [],
      });

      const rtkEntry = report.capabilities.find((c) => c.capabilityId === "rtk");
      expect(rtkEntry?.status).toBe("shared");
    });

    it("should identify context-mode as shared when binary and MCP configured", () => {
      const report = resolveRunnerParity("pi", {
        binariesInPath: ["context-mode"],
        mcpServersConfigured: ["context-mode"],
      });

      const contextModeEntry = report.capabilities.find((c) => c.capabilityId === "context-mode");
      expect(contextModeEntry?.status).toBe("shared");
    });

    it("should identify codebase-memory as gap when binary missing", () => {
      const report = resolveRunnerParity("pi", {
        binariesInPath: [],
        mcpServersConfigured: [],
      });

      const cbmEntry = report.capabilities.find((c) => c.capabilityId === "codebase-memory");
      expect(cbmEntry?.status).toBe("gap");
      expect(cbmEntry?.code).toBe("capability-binary-not-usable");
    });
  });

  describe("Silent packages", () => {
    it("should not report opencode-mermaid as gap", () => {
      const report = resolveRunnerParity("opencode");

      const mermaidEntry = report.capabilities.find((c) => c.capabilityId === "opencode-mermaid");
      expect(mermaidEntry?.status).toBe("runner-specific");
      expect(report.gaps).not.toContainEqual(
        expect.objectContaining({ capabilityId: "opencode-mermaid" })
      );
    });

    it("should not report pi-mermaid as gap", () => {
      const report = resolveRunnerParity("pi");

      const mermaidEntry = report.capabilities.find((c) => c.capabilityId === "pi-mermaid");
      expect(mermaidEntry?.status).toBe("runner-specific");
      expect(report.gaps).not.toContainEqual(
        expect.objectContaining({ capabilityId: "pi-mermaid" })
      );
    });

    it("should include silent packages in report", () => {
      const report = resolveRunnerParity("pi");

      expect(report.silentPackages.length).toBeGreaterThan(0);
      const hasMermaid = report.silentPackages.some((s) => s.capabilityId === "pi-mermaid");
      expect(hasMermaid).toBe(true);
    });
  });

  describe("Codebase-memory-mcp specific", () => {
    it("should report gap when codebase-memory-mcp missing but binary present", () => {
      const report = resolveRunnerParity("pi", {
        binariesInPath: ["codebase-memory-mcp"], // binary exists
        mcpServersConfigured: [], // but MCP not configured
      });

      const cbmMcpEntry = report.capabilities.find(
        (c) => c.capabilityId === "codebase-memory-mcp"
      );
      expect(cbmMcpEntry?.status).toBe("gap");
      expect(cbmMcpEntry?.code).toBe("capability-mcp-not-configured");
    });

    it("should report gap when codebase-memory-mcp binary not usable", () => {
      const report = resolveRunnerParity("pi", {
        binariesInPath: [],
        mcpServersConfigured: ["codebase-memory"],
      });

      const cbmEntry = report.capabilities.find((c) => c.capabilityId === "codebase-memory");
      expect(cbmEntry?.status).toBe("gap");
    });
  });

  describe("getParityGaps", () => {
    it("should return only gaps for Pi", () => {
      const gaps = getParityGaps("pi");

      // Should contain gaps for serena, context7, supermemory, etc.
      expect(gaps.length).toBeGreaterThan(0);
      // Should not contain info-only entries
      const hasOnlyInfo = gaps.every((g) => g.severity === "info");
      expect(hasOnlyInfo).toBe(false);
    });

    it("should return minimal gaps for OpenCode with all binaries", () => {
      const report = resolveRunnerParity("opencode", {
        binariesInPath: ["rtk", "context-mode", "codebase-memory-mcp", "serena"],
        mcpServersConfigured: ["context-mode", "codebase-memory", "context7", "serena", "supermemory"],
        supermemoryConfigured: true,
      });

      // Key core capabilities should not have gaps
      const coreGaps = report.gaps.filter(
        (g) => g.severity === "error" &&
          ["rtk", "context-mode", "codebase-memory", "codebase-memory-mcp", "serena", "context7", "supermemory-tool-bindings"].includes(g.capabilityId)
      );
      expect(coreGaps.length).toBe(0);
    });
  });

  describe("Index verification", () => {
    it("should report warning when project index not verified", () => {
      const report = resolveRunnerParity("pi", {
        binariesInPath: ["codebase-memory-mcp"],
        mcpServersConfigured: ["codebase-memory"],
        projectIndexVerified: false,
      });

      const cbmEntry = report.capabilities.find((c) => c.capabilityId === "codebase-memory");
      expect(cbmEntry?.code).toBe("capability-index-unverified");
      expect(cbmEntry?.severity).toBe("warning");
    });
  });

  describe("Report structure", () => {
    it("should include runnerId in report", () => {
      const report = resolveRunnerParity("pi");
      expect(report.runnerId).toBe("pi");
    });

    it("should include all capabilities in report", () => {
      const report = resolveRunnerParity("opencode");
      expect(report.capabilities.length).toBeGreaterThan(10);
    });

    it("should categorize gaps and blockers separately", () => {
      const report = resolveRunnerParity("pi", {
        binariesInPath: [],
        mcpServersConfigured: [],
      });

      expect(Array.isArray(report.gaps)).toBe(true);
      expect(Array.isArray(report.blockers)).toBe(true);
      expect(Array.isArray(report.silentPackages)).toBe(true);
    });
  });
});
