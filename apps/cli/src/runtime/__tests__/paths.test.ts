/**
 * Unit tests for runtime/paths.ts
 *
 * Tests actual path resolution without mocking the filesystem.
 */

import { describe, it, expect, beforeEach } from "bun:test";

describe("runtime/paths.ts", () => {
  let getGlobalDeckConfigDir: () => string;
  let getGlobalDeckConfigPath: () => string;
  let getRunnerConfigDir: () => string;
  let getAllConfigPaths: () => { configDir: string; configPath: string }[];
  let globalDeckConfigExists: () => boolean;
  let resolveExistingGlobalConfigPath: () => string | undefined;

  beforeEach(async () => {
    const module = await import("../paths");
    getGlobalDeckConfigDir = module.getGlobalDeckConfigDir;
    getGlobalDeckConfigPath = module.getGlobalDeckConfigPath;
    getRunnerConfigDir = module.getRunnerConfigDir;
    getAllConfigPaths = module.getAllConfigPaths;
    globalDeckConfigExists = module.globalDeckConfigExists;
    resolveExistingGlobalConfigPath = module.resolveExistingGlobalConfigPath;
  });

  describe("getGlobalDeckConfigDir", () => {
    it("resolves to ~/.config/.deck by default", () => {
      const configDir = getGlobalDeckConfigDir();
      // Should resolve to ~/.config/.deck (the default)
      expect(configDir.endsWith(".config/.deck")).toBe(true);
      expect(configDir).not.toContain("$");
      expect(configDir).not.toContain("{");
    });

    it("does not contain template literal syntax", () => {
      const configDir = getGlobalDeckConfigDir();
      expect(configDir).not.toContain("${");
    });
  });

  describe("getGlobalDeckConfigPath", () => {
    it("returns full path to config.json", () => {
      const configPath = getGlobalDeckConfigPath();
      expect(configPath.endsWith("config.json")).toBe(true);
    });
  });

  describe("getRunnerConfigDir", () => {
    it("returns ~/.config/opencode for backward compatibility", () => {
      const runnerDir = getRunnerConfigDir();
      expect(runnerDir.endsWith(".config/opencode")).toBe(true);
    });
  });

  describe("getAllConfigPaths", () => {
    it("returns array of config paths", () => {
      const paths = getAllConfigPaths();
      expect(Array.isArray(paths)).toBe(true);
      expect(paths.length).toBeGreaterThanOrEqual(2);
    });

    it("each path has configDir and configPath", () => {
      const paths = getAllConfigPaths();
      for (const p of paths) {
        expect(typeof p.configDir).toBe("string");
        expect(typeof p.configPath).toBe("string");
      }
    });
  });

  describe("globalDeckConfigExists", () => {
    it("returns boolean", () => {
      const exists = globalDeckConfigExists();
      expect(typeof exists).toBe("boolean");
    });
  });

  describe("resolveExistingGlobalConfigPath", () => {
    it("returns string or undefined", () => {
      const path = resolveExistingGlobalConfigPath();
      expect(path === undefined || typeof path === "string").toBe(true);
    });
  });
});