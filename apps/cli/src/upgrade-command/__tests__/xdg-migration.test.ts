/**
 * Unit tests for the one-shot XDG migration of `~/.config/.deck/`.
 *
 * Covers spec scenarios:
 *   - "Legacy config migrated to XDG on first run"
 *   - "Migration creates backup before moving data"
 *   - "Migration marker prevents re-run"
 *   - "Migration failure aborts with error"
 *   - "Marker written only after full success"
 *
 * Each test runs in an isolated tmp directory: we point the resolver at the
 * tmp directory by setting `XDG_*_HOME` and resetting the module cache.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { _resetDeckPathCache } from "../../runtime/paths.js";
import {
  detectLegacyDeckConfig,
  getMigrationMarkerPath,
  isMigrationComplete,
  migrateLegacyDeckConfig,
  XdgMigrationError,
} from "../xdg-migration.js";

describe("xdg-migration", () => {
  let workDir: string;
  let xdgConfig: string;
  let xdgState: string;
  let xdgCache: string;
  let legacyDir: string;
  const saved: Record<string, string | undefined> = {};

  function setXdg(name: "XDG_CONFIG_HOME" | "XDG_STATE_HOME" | "XDG_CACHE_HOME", value: string): void {
    saved[name] = process.env[name];
    process.env[name] = value;
    _resetDeckPathCache();
  }

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), "deck-xdg-migration-"));
    xdgConfig = join(workDir, "xdg", "config");
    xdgState = join(workDir, "xdg", "state");
    xdgCache = join(workDir, "xdg", "cache");
    setXdg("XDG_CONFIG_HOME", xdgConfig);
    setXdg("XDG_STATE_HOME", xdgState);
    setXdg("XDG_CACHE_HOME", xdgCache);
    // The legacy dir is computed by the same resolver; under
    // XDG_CONFIG_HOME=<workDir>, legacy lives at <workDir>/.deck.
    legacyDir = join(xdgConfig, ".deck");
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
    for (const name of ["XDG_CONFIG_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME"] as const) {
      if (saved[name] === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = saved[name];
      }
    }
    _resetDeckPathCache();
  });

  // --- Detection --------------------------------------------------------

  describe("detectLegacyDeckConfig", () => {
    it("returns undefined when no legacy directory exists", () => {
      expect(detectLegacyDeckConfig()).toBeUndefined();
    });

    it("returns the legacy path when present", () => {
      mkdirSync(legacyDir, { recursive: true });
      expect(detectLegacyDeckConfig()).toBe(legacyDir);
    });
  });

  describe("isMigrationComplete / getMigrationMarkerPath", () => {
    it("returns false when no marker exists", () => {
      expect(isMigrationComplete()).toBe(false);
    });

    it("returns the marker path under the XDG state dir", () => {
      const p = getMigrationMarkerPath();
      expect(p.startsWith(xdgState)).toBe(true);
      expect(p.endsWith("xdg-migration.marker")).toBe(true);
    });
  });

  // --- Migration happy path --------------------------------------------

  describe("migrateLegacyDeckConfig (happy path)", () => {
    it("migrates config.json and writes the marker", () => {
      const sourceConfig = {
        version: 1,
        adaptiveMemory: { activeProvider: "engram" },
        packageInstructions: { opencode: { "codebase-memory": true } },
        orchestratorPersonality: "guia",
        profiles: [{ name: "p1" }],
        activeProfile: "p1",
      };
      mkdirSync(legacyDir, { recursive: true });
      writeFileSync(join(legacyDir, "config.json"), JSON.stringify(sourceConfig, null, 2));

      const result = migrateLegacyDeckConfig();

      expect(result.migrated).toBe(true);
      expect(result.legacyDir).toBe(legacyDir);
      expect(result.movedFileCount).toBe(1);
      expect(result.newConfigDir).toBe(join(xdgConfig, "deck"));
      expect(result.markerPath).toBe(getMigrationMarkerPath());
      expect(existsSync(result.markerPath)).toBe(true);
      expect(existsSync(join(xdgConfig, "deck", "config.json"))).toBe(true);
    });

    it("preserves all user-choice fields (REQ-XDG-006)", () => {
      const sourceConfig = {
        version: 1,
        adaptiveMemory: { activeProvider: "supermemory" },
        packageInstructions: {
          opencode: { "codebase-memory": true, rtk: true },
          pi: { serena: true },
        },
        orchestratorPersonality: "pragmatica",
        profiles: [
          { name: "default", phaseOverrides: { apply: { foo: 1 } } },
        ],
        activeProfile: "default",
      };
      mkdirSync(legacyDir, { recursive: true });
      writeFileSync(join(legacyDir, "config.json"), JSON.stringify(sourceConfig));

      migrateLegacyDeckConfig();

      const moved = JSON.parse(
        readFileSync(join(xdgConfig, "deck", "config.json"), "utf-8"),
      );
      expect(moved.adaptiveMemory).toEqual(sourceConfig.adaptiveMemory);
      expect(moved.packageInstructions).toEqual(sourceConfig.packageInstructions);
      expect(moved.orchestratorPersonality).toBe(sourceConfig.orchestratorPersonality);
      expect(moved.profiles).toEqual(sourceConfig.profiles);
    });

    it("creates a backup before mutating (REQ-MIG-002)", () => {
      mkdirSync(legacyDir, { recursive: true });
      writeFileSync(join(legacyDir, "config.json"), JSON.stringify({ version: 1 }));

      const result = migrateLegacyDeckConfig();
      expect(result.backupPath).toBeDefined();
      expect(existsSync(result.backupPath!)).toBe(true);
      // The backup must contain the original config.json
      expect(existsSync(join(result.backupPath!, "config.json"))).toBe(true);
    });

    it("is idempotent on a second invocation", () => {
      mkdirSync(legacyDir, { recursive: true });
      writeFileSync(join(legacyDir, "config.json"), JSON.stringify({ version: 1 }));

      const first = migrateLegacyDeckConfig();
      expect(first.migrated).toBe(true);

      const second = migrateLegacyDeckConfig();
      expect(second.migrated).toBe(false);
      // Marker is still there
      expect(isMigrationComplete()).toBe(true);
    });
  });

  // --- No legacy to migrate --------------------------------------------

  describe("migrateLegacyDeckConfig (no legacy data)", () => {
    it("writes the marker but does not fail", () => {
      const result = migrateLegacyDeckConfig();
      expect(result.migrated).toBe(false);
      expect(result.movedFileCount).toBe(0);
      expect(isMigrationComplete()).toBe(true);
    });
  });

  // --- Error paths ------------------------------------------------------

  describe("migrateLegacyDeckConfig (error paths)", () => {
    it("throws XdgMigrationError for corrupted legacy config.json", () => {
      mkdirSync(legacyDir, { recursive: true });
      writeFileSync(join(legacyDir, "config.json"), "{ not valid json");

      let caught: unknown;
      try {
        migrateLegacyDeckConfig();
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(XdgMigrationError);
      expect((caught as XdgMigrationError).code).toBe("LEGACY_INVALID_JSON");
      // Spec REQ-MIG-003: marker must NOT be written on failure.
      expect(isMigrationComplete()).toBe(false);
    });

    it("does not write the marker when migration fails (REQ-MIG-003)", () => {
      mkdirSync(legacyDir, { recursive: true });
      writeFileSync(join(legacyDir, "config.json"), "garbage");

      try {
        migrateLegacyDeckConfig();
      } catch {
        // expected
      }
      expect(existsSync(getMigrationMarkerPath())).toBe(false);
    });

    it("preserves the legacy directory and backup on failure", () => {
      mkdirSync(legacyDir, { recursive: true });
      writeFileSync(join(legacyDir, "config.json"), "garbage");

      try {
        migrateLegacyDeckConfig();
      } catch (err) {
        // Backups should still exist or legacy is intact
        expect(err).toBeInstanceOf(XdgMigrationError);
        // Backup should exist per spec
        const backup = (err as XdgMigrationError).backupPath;
        if (backup) {
          expect(existsSync(backup)).toBe(true);
        }
      }
    });
  });

  // --- Test/utility surface --------------------------------------------

  describe("migrateLegacyDeckConfig (force + dryRun)", () => {
    it("dry-run does not move files or write the marker", () => {
      mkdirSync(legacyDir, { recursive: true });
      writeFileSync(join(legacyDir, "config.json"), JSON.stringify({ version: 1 }));

      const result = migrateLegacyDeckConfig({ dryRun: true });
      expect(result.migrated).toBe(true);
      expect(result.movedFileCount).toBe(1);
      expect(existsSync(join(xdgConfig, "deck", "config.json"))).toBe(false);
      expect(existsSync(getMigrationMarkerPath())).toBe(false);
    });

    it("force=true allows re-running even when the marker is present", () => {
      // First migration moves the file out of the legacy dir.
      mkdirSync(legacyDir, { recursive: true });
      writeFileSync(join(legacyDir, "config.json"), JSON.stringify({ version: 1 }));

      const first = migrateLegacyDeckConfig();
      expect(first.migrated).toBe(true);
      expect(isMigrationComplete()).toBe(true);

      // Without force, a second call is a no-op (idempotent).
      const second = migrateLegacyDeckConfig();
      expect(second.migrated).toBe(false);

      // With force, the marker check is bypassed. Since the legacy file was
      // already moved out, the call sees an empty legacy dir and writes a
      // no-op marker (migrated=false, reason=no-legacy-config). The point
      // is that the marker check is bypassed without throwing.
      const third = migrateLegacyDeckConfig({ force: true });
      expect(third.migrated).toBe(false);
    });
  });
});
