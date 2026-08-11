/**
 * Unit tests for runtime/paths.ts
 *
 * Tests XDG split path resolution, defaults, env-variable overrides, and
 * migration-only legacy candidate paths. Uses Bun's `bun:test` runner.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";

describe("runtime/paths.ts", () => {
  type Module = typeof import("../paths");
  let mod: Module;
  let tmpDir: string;
  let originalHome: string | undefined;

  const savedEnv: Record<string, string | undefined> = {};

  function setEnv(name: string, value: string | undefined): void {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }

  beforeEach(async () => {
    // Create temp dir and stub HOME to avoid reading real user config
    tmpDir = join("/tmp", `deck-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
    originalHome = process.env.HOME;
    process.env.HOME = tmpDir;

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
    // Restore HOME and cleanup temp dir
    if (originalHome !== undefined) {
      process.env.HOME = originalHome;
    } else {
      delete process.env.HOME;
    }
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
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

  // --- Migration-only legacy candidates ---------------------------------

  describe("getDeckConfigMigrationCandidateDir", () => {
    it("returns ~/.config/.deck when XDG_CONFIG_HOME is unset", () => {
      setEnv("XDG_CONFIG_HOME", undefined);
      const dir = mod.getDeckConfigMigrationCandidateDir();
      expect(dir.endsWith(".config/.deck")).toBe(true);
    });

    it("respects XDG_CONFIG_HOME when set to an absolute path", () => {
      setEnv("XDG_CONFIG_HOME", "/tmp/custom-xdg-config");
      const dir = mod.getDeckConfigMigrationCandidateDir();
      expect(dir).toBe("/tmp/custom-xdg-config/.deck");
    });
  });

  describe("getGlobalDeckConfigDir", () => {
    it("now resolves to the new XDG config dir (post-migration target)", () => {
      setEnv("XDG_CONFIG_HOME", undefined);
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

  describe("getDeckConfigMigrationCandidatePaths", () => {
    it("returns only migration candidates, not the canonical path", () => {
      const paths = mod.getDeckConfigMigrationCandidatePaths();
      expect(Array.isArray(paths)).toBe(true);
      expect(paths.length).toBeGreaterThanOrEqual(2);
      expect(paths.map((path) => path.configPath)).not.toContain(mod.getGlobalDeckConfigPath());
    });

    it("labels candidate kind as migration metadata", () => {
      const paths = mod.getDeckConfigMigrationCandidatePaths();
      expect(paths.map((path) => path.kind)).toEqual(expect.arrayContaining(["home-config-dot-deck", "home-dot-deck"]));
    });

    it("each path has configDir and configPath", () => {
      const paths = mod.getDeckConfigMigrationCandidatePaths();
      for (const p of paths) {
        expect(typeof p.configDir).toBe("string");
        expect(typeof p.configPath).toBe("string");
      }
    });
  });

  describe("canonicalGlobalDeckConfigExists", () => {
    it("checks only the canonical global config path", () => {
      setEnv("XDG_CONFIG_HOME", join(tmpDir, "xdg-empty"));
      mod._resetDeckPathCache();
      mkdirSync(join(tmpDir, ".deck"), { recursive: true });
      writeFileSync(join(tmpDir, ".deck", "config.json"), "{}\n");

      const exists = mod.canonicalGlobalDeckConfigExists();
      expect(typeof exists).toBe("boolean");
      expect(exists).toBe(false);
    });
  });

  describe("resolveExistingDeckConfigMigrationCandidatePath", () => {
    it("returns only existing legacy migration candidates", () => {
      setEnv("XDG_CONFIG_HOME", join(tmpDir, "xdg-empty"));
      mod._resetDeckPathCache();
      mkdirSync(join(tmpDir, ".config", "deck"), { recursive: true });
      mkdirSync(join(tmpDir, ".deck"), { recursive: true });
      writeFileSync(join(tmpDir, ".config", "deck", "config.json"), "{}\n");
      writeFileSync(join(tmpDir, ".deck", "config.json"), "{}\n");

      const path = mod.resolveExistingDeckConfigMigrationCandidatePath();
      expect(path).toBe(join(tmpDir, ".deck", "config.json"));
    });
  });
});
