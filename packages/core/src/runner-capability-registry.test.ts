/**
 * Tests for Runner Capability Registry
 *
 * Validates canonical capabilities, categories, and per-runner mappings.
 */

import { describe, it, expect } from "bun:test";
import {
  getCanonicalRunnerCapabilities,
  getCanonicalCapability,
  getRunnerMappings,
  getRunnerCapabilityMapping,
  CANONICAL_CATEGORIES,
  SUPPORT_STATUSES,
  defineRunnerCapabilityContribution,
  RunnerCapabilityCompositionError,
  validateRunnerCapabilitySemantics,
  type CanonicalCapabilityCategory,
} from "./runner-capability-registry";

describe("Runner Capability Registry", () => {
  it("accepts immutable synthetic adapter mappings without core registry edits", () => {
    const contribution = defineRunnerCapabilityContribution({
      runnerId: "synthetic",
      mappings: [{ capabilityId: "context-mode", runnerId: "synthetic", status: "shared", provisionMode: "reuse", detectors: { commands: ["synthetic-context"] }, parityChecks: ["binary-usable"] }],
    });

    expect(Object.isFrozen(contribution)).toBe(true);
    expect(Object.isFrozen(contribution.mappings)).toBe(true);
    expect(getRunnerCapabilityMapping("context-mode", "synthetic", [contribution])).toMatchObject({ status: "shared", provisionMode: "reuse" });
    expect(validateRunnerCapabilitySemantics("synthetic", [{ capabilityId: "context-mode", status: "shared", provisionMode: "reuse", executable: "synthetic-context" }], [contribution])).toEqual([]);
  });

  it("composes contributions deterministically and rejects mapping collisions", () => {
    const first = defineRunnerCapabilityContribution({
      runnerId: "synthetic",
      mappings: [{ capabilityId: "context-mode", runnerId: "synthetic", status: "shared" }],
    });
    const second = defineRunnerCapabilityContribution({
      runnerId: "synthetic",
      mappings: [{ capabilityId: "rtk", runnerId: "synthetic", status: "shared" }],
    });
    expect(getRunnerMappings("synthetic", [first, second])).toEqual(getRunnerMappings("synthetic", [second, first]));

    const collision = defineRunnerCapabilityContribution({
      runnerId: "synthetic",
      mappings: [{ capabilityId: "context-mode", runnerId: "synthetic", status: "supported" }],
    });
    expect(() => getRunnerMappings("synthetic", [first, collision])).toThrow(RunnerCapabilityCompositionError);
    try {
      getRunnerMappings("synthetic", [collision, first]);
      throw new Error("expected collision");
    } catch (error) {
      expect(error).toBeInstanceOf(RunnerCapabilityCompositionError);
      expect((error as RunnerCapabilityCompositionError).code).toBe("duplicate-runner-capability-mapping");
    }
  });

  it("keeps core free of runner-owned mappings and canonical capabilities", () => {
    expect(getRunnerMappings("pi")).toEqual([]);
    expect(getRunnerMappings("opencode")).toEqual([]);
    const ids = getCanonicalRunnerCapabilities().map((capability) => capability.id);
    expect(ids).not.toContain("pi-orchestrator-prompt-persistence");
    expect(ids).not.toContain("opencode-primary-orchestrator");
    expect(ids).not.toContain("pi-mermaid");
    expect(ids).not.toContain("opencode-mermaid");
  });
  describe("Canonical Capabilities", () => {
    it("should have at least 12 capabilities", () => {
      const capabilities = getCanonicalRunnerCapabilities();
      expect(capabilities.length).toBeGreaterThanOrEqual(12);
    });

    it("should have unique IDs", () => {
      const capabilities = getCanonicalRunnerCapabilities();
      const ids = capabilities.map((c) => c.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });

    it("should include codebase-memory as first-class capability", () => {
      const capability = getCanonicalCapability("codebase-memory");
      expect(capability).toBeDefined();
      expect(capability?.id).toBe("codebase-memory");
      expect(capability?.category).toBe("shared-binaries");
      expect(capability?.userFacing).toBe(true);
    });

    it("should include codebase-memory-mcp as first-class capability", () => {
      const capability = getCanonicalCapability("codebase-memory-mcp");
      expect(capability).toBeDefined();
      expect(capability?.id).toBe("codebase-memory-mcp");
      expect(capability?.sharedBinary?.command).toBe("codebase-memory-mcp");
    });

    it("should include rtk as first-class capability", () => {
      const capability = getCanonicalCapability("rtk");
      expect(capability).toBeDefined();
      expect(capability?.id).toBe("rtk");
      expect(capability?.sharedBinary?.command).toBe("rtk");
    });

    it("should include serena as capability", () => {
      const capability = getCanonicalCapability("serena");
      expect(capability).toBeDefined();
      expect(capability?.id).toBe("serena");
    });

    it("should include context7 as capability", () => {
      const capability = getCanonicalCapability("context7");
      expect(capability).toBeDefined();
      expect(capability?.id).toBe("context7");
    });

    it("should include supermemory-tool-bindings", () => {
      const capability = getCanonicalCapability("supermemory-tool-bindings");
      expect(capability).toBeDefined();
      expect(capability?.id).toBe("supermemory-tool-bindings");
    });

  });

  describe("Categories", () => {
    it("should have all 8 canonical categories", () => {
      expect(CANONICAL_CATEGORIES).toContain("agents");
      expect(CANONICAL_CATEGORIES).toContain("skills");
      expect(CANONICAL_CATEGORIES).toContain("mcps");
      expect(CANONICAL_CATEGORIES).toContain("packages");
      expect(CANONICAL_CATEGORIES).toContain("shared-binaries");
      expect(CANONICAL_CATEGORIES).toContain("runner-silent-packages");
      expect(CANONICAL_CATEGORIES).toContain("prompts-profiles");
      expect(CANONICAL_CATEGORIES).toContain("memory-tool-bindings");
      expect(CANONICAL_CATEGORIES).toContain("execution-controls");
      expect(CANONICAL_CATEGORIES.length).toBe(9);
    });

    it("should have runner-silent-packages category", () => {
      const capabilities = getCanonicalRunnerCapabilities();
      const silentPackages = capabilities.filter(
        (c) => c.category === "runner-silent-packages"
      );
      expect(silentPackages).toEqual([]);
    });
  });

  describe("Support Statuses", () => {
    it("should have all 8 support statuses defined", () => {
      expect(SUPPORT_STATUSES).toContain("supported");
      expect(SUPPORT_STATUSES).toContain("runner-specific");
      expect(SUPPORT_STATUSES).toContain("shared");
      expect(SUPPORT_STATUSES).toContain("manual-verified");
      expect(SUPPORT_STATUSES).toContain("gap");
      expect(SUPPORT_STATUSES).toContain("blocked");
      expect(SUPPORT_STATUSES).toContain("unsupported");
      expect(SUPPORT_STATUSES).toContain("not-applicable");
      expect(SUPPORT_STATUSES.length).toBe(8);
    });
  });

  describe("Helper Functions", () => {
    it("getCanonicalCapability should return exact entry", () => {
      const capability = getCanonicalCapability("context-mode");
      expect(capability?.id).toBe("context-mode");
    });

    it("getCanonicalCapability should return undefined for non-existent", () => {
      const capability = getCanonicalCapability("non-existent-capability");
      expect(capability).toBeUndefined();
    });
  });
});
