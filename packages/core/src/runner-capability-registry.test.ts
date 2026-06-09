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
  type CanonicalCapabilityCategory,
} from "./runner-capability-registry";

describe("Runner Capability Registry", () => {
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

    it("should include pi-orchestrator-prompt-persistence", () => {
      const capability = getCanonicalCapability("pi-orchestrator-prompt-persistence");
      expect(capability).toBeDefined();
      expect(capability?.id).toBe("pi-orchestrator-prompt-persistence");
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
      expect(CANONICAL_CATEGORIES.length).toBe(8);
    });

    it("should have runner-silent-packages category", () => {
      const capabilities = getCanonicalRunnerCapabilities();
      const silentPackages = capabilities.filter(
        (c) => c.category === "runner-silent-packages"
      );
      expect(silentPackages.length).toBeGreaterThan(0);
    });
  });

  describe("Silent Packages", () => {
    it("should have opencode-mermaid in runner-silent-packages", () => {
      const capability = getCanonicalCapability("opencode-mermaid");
      expect(capability).toBeDefined();
      expect(capability?.category).toBe("runner-silent-packages");
      expect(capability?.userFacing).toBe(false);
    });

    it("should have pi-mermaid in runner-silent-packages", () => {
      const capability = getCanonicalCapability("pi-mermaid");
      expect(capability).toBeDefined();
      expect(capability?.category).toBe("runner-silent-packages");
      expect(capability?.userFacing).toBe(false);
    });
  });

  describe("Per-Runner Mappings", () => {
    it("should have mappings for opencode", () => {
      const mappings = getRunnerMappings("opencode");
      expect(mappings.length).toBeGreaterThan(0);
    });

    it("should have mappings for pi", () => {
      const mappings = getRunnerMappings("pi");
      expect(mappings.length).toBeGreaterThan(0);
    });

    it("should find specific capability mapping", () => {
      const mapping = getRunnerCapabilityMapping("rtk", "opencode");
      expect(mapping).toBeDefined();
      expect(mapping?.capabilityId).toBe("rtk");
      expect(mapping?.runnerId).toBe("opencode");
    });

    it("should return undefined for non-existent mapping", () => {
      const mapping = getRunnerCapabilityMapping("non-existent", "opencode");
      expect(mapping).toBeUndefined();
    });

    it("should have codebase-memory mapping for pi", () => {
      const mapping = getRunnerCapabilityMapping("codebase-memory", "pi");
      expect(mapping).toBeDefined();
      expect(mapping?.status).toBe("shared");
    });

    it("should have rtk mapping for pi", () => {
      const mapping = getRunnerCapabilityMapping("rtk", "pi");
      expect(mapping).toBeDefined();
      expect(mapping?.status).toBe("shared");
    });

    it("should have pi-mermaid as runner-specific for pi", () => {
      const mapping = getRunnerCapabilityMapping("pi-mermaid", "pi");
      expect(mapping).toBeDefined();
      expect(mapping?.status).toBe("runner-specific");
    });

    it("should have opencode-mermaid as runner-specific for opencode", () => {
      const mapping = getRunnerCapabilityMapping("opencode-mermaid", "opencode");
      expect(mapping).toBeDefined();
      expect(mapping?.status).toBe("runner-specific");
    });
  });

  describe("Support Statuses", () => {
    it("should have all 7 support statuses defined", () => {
      expect(SUPPORT_STATUSES).toContain("supported");
      expect(SUPPORT_STATUSES).toContain("runner-specific");
      expect(SUPPORT_STATUSES).toContain("shared");
      expect(SUPPORT_STATUSES).toContain("manual-verified");
      expect(SUPPORT_STATUSES).toContain("gap");
      expect(SUPPORT_STATUSES).toContain("blocked");
      expect(SUPPORT_STATUSES).toContain("not-applicable");
      expect(SUPPORT_STATUSES.length).toBe(7);
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
