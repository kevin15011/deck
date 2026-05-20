import { describe, expect, test } from "bun:test";

import {
  createProjectDiscoveryAdapter,
  type ProjectDiscoveryInput,
  type ProjectDiscoveryResult,
  DEFAULT_DISCOVERY_CONFIG,
} from "./project-discovery";

describe("project-discovery", () => {
  describe("createProjectDiscoveryAdapter", () => {
    test("detects available capabilities from input", () => {
      const input: ProjectDiscoveryInput = {
        testCommands: ["bun test"],
        buildCommands: ["bun run build"],
        typeCheckCommands: ["tsc --noEmit"],
        lintCommands: [],
        deployCommands: [],
      };

      const adapter = createProjectDiscoveryAdapter(input, DEFAULT_DISCOVERY_CONFIG);

      expect(adapter.capabilities.hasTestRunner).toBe(true);
      expect(adapter.capabilities.hasBuildTool).toBe(true);
      expect(adapter.capabilities.hasTypeChecker).toBe(true);
      expect(adapter.capabilities.hasLinter).toBe(false);
      expect(adapter.capabilities.detectedCapabilities).toContain("bun test");
      expect(adapter.capabilities.detectedCapabilities).toContain("tsc --noEmit");
    });

    test("degrades gracefully when no capabilities found", () => {
      const input: ProjectDiscoveryInput = {
        testCommands: [],
        buildCommands: [],
        typeCheckCommands: [],
        lintCommands: [],
        deployCommands: [],
      };

      const adapter = createProjectDiscoveryAdapter(input, DEFAULT_DISCOVERY_CONFIG);

      expect(adapter.capabilities.hasTestRunner).toBe(false);
      expect(adapter.capabilities.hasTypeChecker).toBe(false);
      expect(adapter.capabilities.detectedCapabilities).toEqual([]);
      expect(adapter.warnings.length).toBeGreaterThan(0);
    });

    test("does not name specific tools in risk signals", () => {
      const input: ProjectDiscoveryInput = {
        testCommands: [],
        buildCommands: [],
        typeCheckCommands: [],
        lintCommands: [],
        deployCommands: [],
      };

      const adapter = createProjectDiscoveryAdapter(input, DEFAULT_DISCOVERY_CONFIG);

      for (const signal of adapter.riskSignals) {
        expect(signal.evidence).not.toContain("jest");
        expect(signal.evidence).not.toContain("vitest");
        expect(signal.evidence).not.toContain("eslint");
      }
    });
  });
});
