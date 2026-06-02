/**
 * Unit tests for runtime/paths.ts
 *
 * Tests XDG split path resolution, defaults, env-variable overrides, and
 * legacy path fallback. Uses Bun's `bun:test` runner.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";

describe("runtime/paths.ts", () => {
  type Module = typeof import("../paths");
  let mod: Module;

  const savedEnv: Record<string, string | undefined> = {};

  function setEnv(name: string, value: string | undefined): void {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }

  beforeEach(async () => {
    mod = await import("../paths");
    // The module caches XDG path lookups; reset the cache so each test
    // can manipulate the environment and observe fresh resolutions.
    mod._resetDeckPathCache();
    savedEnv.XDG_CONFIG_HOME = process.env.XDG_CONFIG_HOME;
    savedEnv.XDG_STATE_HOME = process.env.XDG_STATE_HOME;
    savedEnv.XDG_CACHE_HOME = process.env.XDG_CACHE_HOME;
  });

  afterEach(() => {
    setEnv("XDG_CONFIG_HOME", savedEnv.XDG_CONFIG_HOME);
    setEnv("XDG_STATE_HOME", savedEnv.XDG_STATE_HOME);
    setEnv("XDG_CACHE_HOME", savedEnv.XDG_CACHE_HOME);
  });

  // --- XDG split paths --------------------------------------------------

  describe("getDeckConfigDir", () => {
    it("defaults to ~/.config/deck when XDG_CONFIG_HOME is unset", () => {
      setEnv("XDG_CONFIG_HOME", undefined);
      const dir = mod.getDeckConfigDir();
      expect(dir.endsWith(".config/deck")).toBe(true);
    });

    it("respects XDG_CONFIG_HOME when set to an absolute path", () => {
      setEnv("XDG_CONFIG_HOME", "/tmp/custom-xdg-config");
      const dir = mod.getDeckConfigDir();
      expect(dir).toBe("/tmp/custom-xdg-config/deck");
    });
  });

  describe("getDeckStateDir", () => {
    it("defaults to ~/.local/state/deck when XDG_STATE_HOME is unset", () => {
      setEnv("XDG_STATE_HOME", undefined);
      const dir = mod.getDeckStateDir();
      expect(dir.endsWith(".local/state/deck")).toBe(true);
    });

    it("respects XDG_STATE_HOME when set to an absolute path", () => {
      setEnv("XDG_STATE_HOME", "/tmp/custom-xdg-state");
      const dir = mod.getDeckStateDir();
      expect(dir).toBe("/tmp/custom-xdg-state/deck");
    });
  });

  describe("getDeckCacheDir", () => {
    it("defaults to ~/.cache/deck when XDG_CACHE_HOME is unset", () => {
      setEnv("XDG_CACHE_HOME", undefined);
      const dir = mod.getDeckCacheDir();
      expect(dir.endsWith(".cache/deck")).toBe(true);
    });

    it("respects XDG_CACHE_HOME when set to an absolute path", () => {
      setEnv("XDG_CACHE_HOME", "/tmp/custom-xdg-cache");
      const dir = mod.getDeckCacheDir();
      expect(dir).toBe("/tmp/custom-xdg-cache/deck");
    });
  });

  describe("getDeckXdgPaths", () => {
    it("returns the full split-path bundle with correct suffixes", () => {
      setEnv("XDG_CONFIG_HOME", undefined);
      setEnv("XDG_STATE_HOME", undefined);
      setEnv("XDG_CACHE_HOME", undefined);
      const paths = mod.getDeckXdgPaths();
      expect(paths.configDir.endsWith(".config/deck")).toBe(true);
      expect(paths.configPath.endsWith(".config/deck/config.json")).toBe(true);
      expect(paths.configYamlPath.endsWith(".config/deck/config.yaml")).toBe(true);
      expect(paths.stateDir.endsWith(".local/state/deck")).toBe(true);
      expect(paths.statePath.endsWith(".local/state/deck/state.yaml")).toBe(true);
      expect(paths.manifestPath.endsWith(".local/state/deck/manifest.json")).toBe(true);
      expect(paths.logsDir.endsWith(".local/state/deck/logs")).toBe(true);
      expect(paths.cacheDir.endsWith(".cache/deck")).toBe(true);
      expect(paths.releasesDir.endsWith(".cache/deck/releases")).toBe(true);
      expect(paths.backupsDir.endsWith(".cache/deck/backups")).toBe(true);
    });
  });

  // --- Legacy compat ----------------------------------------------------

  describe("getLegacyDeckConfigDir", () => {
    it("returns ~/.config/.deck when XDG_CONFIG_HOME is unset", () => {
      setEnv("XDG_CONFIG_HOME", undefined);
      const dir = mod.getLegacyDeckConfigDir();
      expect(dir.endsWith(".config/.deck")).toBe(true);
    });

    it("respects XDG_CONFIG_HOME when set to an absolute path", () => {
      setEnv("XDG_CONFIG_HOME", "/tmp/custom-xdg-config");
      const dir = mod.getLegacyDeckConfigDir();
      expect(dir).toBe("/tmp/custom-xdg-config/.deck");
    });
  });

  describe("getGlobalDeckConfigDir", () => {
    it("now resolves to the new XDG config dir (post-migration target)", () => {
      const dir = mod.getGlobalDeckConfigDir();
      expect(dir.endsWith(".config/deck")).toBe(true);
    });
  });

  describe("getGlobalDeckConfigPath", () => {
    it("returns a full path ending in config.json", () => {
      const path = mod.getGlobalDeckConfigPath();
      expect(path.endsWith("config.json")).toBe(true);
    });

    it("resolves to ~/.config/deck/config.json by default", () => {
      setEnv("XDG_CONFIG_HOME", undefined);
      const path = mod.getGlobalDeckConfigPath();
      expect(path.endsWith(".config/deck/config.json")).toBe(true);
    });
  });

  describe("getRunnerConfigDir", () => {
    it("returns ~/.config/opencode for backward compatibility", () => {
      const runnerDir = mod.getRunnerConfigDir();
      expect(runnerDir.endsWith(".config/opencode")).toBe(true);
    });
  });

  describe("getAllConfigPaths", () => {
    it("returns an array of config paths", () => {
      const paths = mod.getAllConfigPaths();
      expect(Array.isArray(paths)).toBe(true);
      expect(paths.length).toBeGreaterThanOrEqual(3);
    });

    it("puts the new XDG path first (preferred read order)", () => {
      const paths = mod.getAllConfigPaths();
      expect(paths[0]?.configDir.endsWith(".config/deck")).toBe(true);
    });

    it("each path has configDir and configPath", () => {
      const paths = mod.getAllConfigPaths();
      for (const p of paths) {
        expect(typeof p.configDir).toBe("string");
        expect(typeof p.configPath).toBe("string");
      }
    });
  });

  describe("globalDeckConfigExists", () => {
    it("returns boolean", () => {
      const exists = mod.globalDeckConfigExists();
      expect(typeof exists).toBe("boolean");
    });
  });

  describe("resolveExistingGlobalConfigPath", () => {
    it("returns string or undefined", () => {
      const path = mod.resolveExistingGlobalConfigPath();
      expect(path === undefined || typeof path === "string").toBe(true);
    });
  });
});
