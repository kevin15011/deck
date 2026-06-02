/**
 * Unit tests for the manifest store.
 *
 * Covers design §2 manifest schemas, atomic writes, v1→v2 migration, and
 * checksum/drift detection.
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
  buildDefaultManifest,
  CURRENT_MANIFEST_SCHEMA_VERSION,
  detectManifestDrift,
  getManifestPath,
  ManifestJsonV2Schema,
  ManifestStoreError,
  MANIFEST_ERROR_CODES,
  migrateManifestV1ToV2,
  readManifest,
  removeManifestFile,
  upsertManifestFile,
  writeManifest,
} from "../manifest-store.js";

describe("manifest-store", () => {
  let workDir: string;
  const saved: Record<string, string | undefined> = {};

  function setXdg(
    name: "XDG_CONFIG_HOME" | "XDG_STATE_HOME" | "XDG_CACHE_HOME",
    value: string,
  ): void {
    saved[name] = process.env[name];
    process.env[name] = value;
    _resetDeckPathCache();
  }

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), "deck-manifest-store-"));
    setXdg("XDG_CONFIG_HOME", join(workDir, "config"));
    setXdg("XDG_STATE_HOME", join(workDir, "state"));
    setXdg("XDG_CACHE_HOME", join(workDir, "cache"));
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

  // --- Defaults --------------------------------------------------------

  describe("buildDefaultManifest", () => {
    it("returns schemaVersion=2, empty files, deckVersion=argument", () => {
      const m = buildDefaultManifest("9.9.9");
      expect(m.schemaVersion).toBe(2);
      expect(m.deckVersion).toBe("9.9.9");
      expect(m.files).toEqual([]);
    });

    it("current schema version constant is 2", () => {
      expect(CURRENT_MANIFEST_SCHEMA_VERSION).toBe(2);
    });
  });

  // --- Round trip ------------------------------------------------------

  describe("readManifest / writeManifest", () => {
    it("returns default when no file exists", () => {
      const m = readManifest("1.0.0");
      expect(m.schemaVersion).toBe(2);
      expect(m.deckVersion).toBe("1.0.0");
      expect(m.files).toEqual([]);
    });

    it("writes then reads the same manifest (round trip)", () => {
      const original = buildDefaultManifest("2.0.0");
      writeManifest(original);

      const read = readManifest("placeholder");
      expect(read.schemaVersion).toBe(2);
      expect(read.deckVersion).toBe("2.0.0");
    });

    it("atomic write uses a temp file then renames (no .tmp file remains)", () => {
      writeManifest(buildDefaultManifest("1.0.0"));
      const tmpLeft = readdirContains(workDir, ".tmp-");
      expect(tmpLeft).toBe(false);
    });
  });

  // --- Schema validation ----------------------------------------------

  describe("schema validation", () => {
    it("rejects an unknown future schemaVersion (read-only fail-safe)", () => {
      const path = getManifestPath();
      mkdirSync(join(workDir, "state", "deck"), { recursive: true });
      writeFileSync(
        path,
        JSON.stringify({ schemaVersion: 99, generatedAt: new Date().toISOString(), deckVersion: "x", files: [] }),
      );

      expect(() => readManifest("placeholder")).toThrow(ManifestStoreError);
      try {
        readManifest("placeholder");
      } catch (err) {
        expect((err as ManifestStoreError).code).toBe(
          MANIFEST_ERROR_CODES.UNSUPPORTED_FUTURE_SCHEMA,
        );
      }
    });

    it("rejects invalid JSON", () => {
      const path = getManifestPath();
      mkdirSync(join(workDir, "state", "deck"), { recursive: true });
      writeFileSync(path, "{ not valid json");
      expect(() => readManifest("placeholder")).toThrow(ManifestStoreError);
    });

    it("accepts a valid v2 manifest", () => {
      const ok = ManifestJsonV2Schema.safeParse(buildDefaultManifest("1.0.0"));
      expect(ok.success).toBe(true);
    });
  });

  // --- v1→v2 migration ------------------------------------------------

  describe("migrateManifestV1ToV2", () => {
    it("preserves v1 file paths and checksums", () => {
      const v1 = {
        schemaVersion: 1 as const,
        generatedAt: "2025-01-01T00:00:00.000Z",
        deckVersion: "0.9.0",
        files: [
          {
            path: "/etc/deck/config.json",
            owner: "deck",
            checksum: {
              algorithm: "sha256",
              value: "0".repeat(64),
            },
            deckVersion: "0.9.0",
            kind: "config",
          },
        ],
      };
      const v2 = migrateManifestV1ToV2(v1);
      expect(v2.schemaVersion).toBe(2);
      expect(v2.files).toHaveLength(1);
      expect(v2.files[0]?.path).toBe("/etc/deck/config.json");
      expect(v2.files[0]?.checksum.value).toBe("0".repeat(64));
      expect(v2.files[0]?.kind).toBe("config");
      expect(v2.files[0]?.deck_version).toBe("0.9.0");
    });

    it("falls back to deck_version when deckVersion is missing", () => {
      const v1 = {
        schemaVersion: 1 as const,
        files: [
          {
            path: "/etc/a",
            deck_version: "0.5.0",
          },
        ],
      };
      const v2 = migrateManifestV1ToV2(v1 as never);
      expect(v2.files[0]?.deck_version).toBe("0.5.0");
    });

    it("marks unknown kind as 'content'", () => {
      const v1 = {
        schemaVersion: 1 as const,
        files: [{ path: "/etc/a", kind: "weird" }],
      };
      const v2 = migrateManifestV1ToV2(v1 as never);
      expect(v2.files[0]?.kind).toBe("content");
    });

    it("on-disk v1 manifest is migrated and persisted to v2", () => {
      const path = getManifestPath();
      mkdirSync(join(workDir, "state", "deck"), { recursive: true });
      const v1 = {
        schemaVersion: 1,
        generatedAt: "2025-01-01T00:00:00.000Z",
        deckVersion: "0.9.0",
        files: [
          {
            path: "/etc/deck/config.json",
            owner: "deck",
            checksum: { algorithm: "sha256", value: "0".repeat(64) },
            deckVersion: "0.9.0",
            kind: "config",
          },
        ],
      };
      writeFileSync(path, JSON.stringify(v1));

      const migrated = readManifest("1.0.0");
      expect(migrated.schemaVersion).toBe(2);
      expect(migrated.files[0]?.path).toBe("/etc/deck/config.json");

      // The disk file should now be v2.
      const onDisk = JSON.parse(readFileSync(path, "utf-8"));
      expect(onDisk.schemaVersion).toBe(2);
    });
  });

  // --- upsert / remove / drift ---------------------------------------

  describe("upsertManifestFile", () => {
    it("inserts a file entry with a fresh checksum", () => {
      const file = join(workDir, "config.json");
      writeFileSync(file, "v1 contents");
      const upserted = upsertManifestFile(
        buildDefaultManifest("1.0.0"),
        {
          path: file,
          owner: "deck",
          deck_version: "1.0.0",
          kind: "config",
        },
        "1.0.0",
      );
      expect(upserted.files).toHaveLength(1);
      expect(upserted.files[0]?.path).toBe(file);
      expect(upserted.files[0]?.checksum.value).toMatch(/^[a-f0-9]{64}$/);
    });

    it("replaces an existing entry for the same path", () => {
      const file = join(workDir, "config.json");
      writeFileSync(file, "first");
      const first = upsertManifestFile(
        buildDefaultManifest("1.0.0"),
        { path: file, owner: "deck", deck_version: "1.0.0", kind: "config" },
        "1.0.0",
      );
      writeFileSync(file, "second");
      const second = upsertManifestFile(
        first,
        { path: file, owner: "deck", deck_version: "1.0.0", kind: "config" },
        "1.0.0",
      );
      expect(second.files).toHaveLength(1);
      expect(second.files[0]?.checksum.value).not.toBe(first.files[0]?.checksum.value);
    });
  });

  describe("removeManifestFile", () => {
    it("removes the entry by path", () => {
      const file = join(workDir, "config.json");
      writeFileSync(file, "x");
      const one = upsertManifestFile(
        buildDefaultManifest("1.0.0"),
        { path: file, owner: "deck", deck_version: "1.0.0", kind: "config" },
        "1.0.0",
      );
      const two = removeManifestFile(one, file);
      expect(two.files).toHaveLength(0);
    });
  });

  describe("detectManifestDrift", () => {
    it("reports a missing file", () => {
      const file = join(workDir, "config.json");
      writeFileSync(file, "x");
      const one = upsertManifestFile(
        buildDefaultManifest("1.0.0"),
        { path: file, owner: "deck", deck_version: "1.0.0", kind: "config" },
        "1.0.0",
      );
      rmSync(file, { force: true });
      const drift = detectManifestDrift(one);
      expect(drift.missing).toContain(file);
    });

    it("reports a changed file", () => {
      const file = join(workDir, "config.json");
      writeFileSync(file, "v1");
      const one = upsertManifestFile(
        buildDefaultManifest("1.0.0"),
        { path: file, owner: "deck", deck_version: "1.0.0", kind: "config" },
        "1.0.0",
      );
      writeFileSync(file, "v2 — different content");
      const drift = detectManifestDrift(one);
      expect(drift.changed).toHaveLength(1);
      expect(drift.changed[0]?.path).toBe(file);
    });

    it("reports ok files", () => {
      const file = join(workDir, "config.json");
      writeFileSync(file, "v1");
      const one = upsertManifestFile(
        buildDefaultManifest("1.0.0"),
        { path: file, owner: "deck", deck_version: "1.0.0", kind: "config" },
        "1.0.0",
      );
      const drift = detectManifestDrift(one);
      expect(drift.ok).toContain(file);
    });
  });
});

function readdirContains(root: string, needle: string): boolean {
  // Walks a small tree looking for `needle` in any filename. Bounded to
  // the test tmp dir.
  const { readdirSync, statSync } = require("node:fs") as typeof import("node:fs");
  const stack: string[] = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries: string[] = [];
    try {
      entries = readdirSync(dir) as string[];
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.includes(needle)) return true;
      const full = join(dir, entry);
      try {
        if (statSync(full).isDirectory()) stack.push(full);
      } catch {
        // skip
      }
    }
  }
  return false;
}
