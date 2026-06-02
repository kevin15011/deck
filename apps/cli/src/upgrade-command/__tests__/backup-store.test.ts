/**
 * Unit tests for the backup/retention store (REQ-ATM-001 .. REQ-ATM-004).
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
  applyRetention,
  BackupManifestSchema,
  BackupStoreError,
  createBackup,
  findLatestBackup,
  getBackupDir,
  listBackups,
  readBackupManifest,
  restoreBackup,
  BACKUP_ERROR_CODES,
} from "../backup-store.js";

describe("backup-store", () => {
  let workDir: string;
  const saved: Record<string, string | undefined> = {};

  function setXdg(name: "XDG_CONFIG_HOME" | "XDG_STATE_HOME" | "XDG_CACHE_HOME", value: string): void {
    saved[name] = process.env[name];
    process.env[name] = value;
    _resetDeckPathCache();
  }

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), "deck-backup-store-"));
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

  // --- Creation --------------------------------------------------------

  describe("createBackup", () => {
    it("creates a manifest and copies the requested files", () => {
      const source = join(workDir, "binary");
      writeFileSync(source, "v1 binary content");
      const sourceConfig = join(workDir, "config.json");
      writeFileSync(sourceConfig, '{"version":1}');

      const result = createBackup({
        operationId: "op-1",
        deckVersionBefore: "1.0.0",
        targetVersion: "2.0.0",
        reason: "upgrade",
        files: [
          { id: "binary", sourcePath: source, owner: "deck", kind: "binary" },
          { id: "config", sourcePath: sourceConfig, owner: "deck", kind: "config" },
        ],
      });

      expect(existsSync(result.manifestPath)).toBe(true);
      expect(result.manifest.entries).toHaveLength(2);
      expect(result.manifest.entries[0]?.existed).toBe(true);
      expect(result.manifest.reason).toBe("upgrade");
      // Manifest must satisfy the schema
      const check = BackupManifestSchema.safeParse(result.manifest);
      expect(check.success).toBe(true);
    });

    it("records `existed: false` for files that were not present at backup time", () => {
      const result = createBackup({
        operationId: "op-1",
        deckVersionBefore: "1.0.0",
        reason: "migration",
        files: [
          { id: "missing", sourcePath: join(workDir, "does-not-exist"), owner: "deck", kind: "config" },
        ],
      });
      expect(result.manifest.entries).toHaveLength(1);
      expect(result.manifest.entries[0]?.existed).toBe(false);
    });
  });

  // --- Restore ---------------------------------------------------------

  describe("restoreBackup", () => {
    it("restores the original file content", () => {
      const source = join(workDir, "binary");
      writeFileSync(source, "ORIGINAL");

      const { backupId } = createBackup({
        operationId: "op-1",
        deckVersionBefore: "1.0.0",
        reason: "upgrade",
        files: [
          { id: "binary", sourcePath: source, owner: "deck", kind: "binary" },
        ],
      });

      // Simulate the operation mutating the file
      writeFileSync(source, "MODIFIED");
      expect(readFileSync(source, "utf-8")).toBe("MODIFIED");

      const stats = restoreBackup(backupId);
      expect(stats.restored).toBe(1);
      expect(readFileSync(source, "utf-8")).toBe("ORIGINAL");
    });

    it("deletes files that didn't exist before the operation", () => {
      const source = join(workDir, "newly-created");
      // Backup before the file exists
      const { backupId } = createBackup({
        operationId: "op-1",
        deckVersionBefore: "1.0.0",
        reason: "upgrade",
        files: [
          { id: "newly-created", sourcePath: source, owner: "deck", kind: "config" },
        ],
      });

      // Simulate the operation creating the file
      writeFileSync(source, "new");
      expect(existsSync(source)).toBe(true);

      const stats = restoreBackup(backupId);
      expect(stats.deleted).toBe(1);
      expect(existsSync(source)).toBe(false);
    });

    it("throws NOT_FOUND when the backup doesn't exist", () => {
      try {
        restoreBackup("no-such-backup");
        throw new Error("expected throw");
      } catch (err) {
        expect(err).toBeInstanceOf(BackupStoreError);
        expect((err as BackupStoreError).code).toBe(BACKUP_ERROR_CODES.NOT_FOUND);
      }
    });
  });

  // --- Retention -------------------------------------------------------

  describe("applyRetention", () => {
    it("keeps the latest 5 backups and prunes older ones", () => {
      // Create 7 backups
      const ids: string[] = [];
      for (let i = 0; i < 7; i += 1) {
        const result = createBackup({
          operationId: `op-${i}`,
          deckVersionBefore: "1.0.0",
          reason: "upgrade",
          files: [
            { id: `f-${i}`, sourcePath: join(workDir, `file-${i}`), owner: "deck", kind: "binary" },
          ],
        });
        ids.push(result.backupId);
      }

      const summary = applyRetention([]);
      // The two oldest should be pruned; the rest kept.
      expect(summary.pruned.length).toBeGreaterThanOrEqual(2);
      expect(summary.kept.length).toBeLessThanOrEqual(5);
      // Pruned backups are removed from disk.
      for (const pruned of summary.pruned) {
        expect(existsSync(getBackupDir(pruned))).toBe(false);
      }
    });

    it("protects backups listed in `protectedBackupIds` from pruning", () => {
      const ids: string[] = [];
      for (let i = 0; i < 7; i += 1) {
        const result = createBackup({
          operationId: `op-${i}`,
          deckVersionBefore: "1.0.0",
          reason: "upgrade",
          files: [
            { id: `f-${i}`, sourcePath: join(workDir, `file-${i}`), owner: "deck", kind: "binary" },
          ],
        });
        ids.push(result.backupId);
      }
      const oldest = ids[ids.length - 1]!;
      // Force the oldest to be very old by rewriting its manifest
      const oldManifest = readBackupManifest(oldest);
      const staleCreatedAt = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
      writeFileSync(
        join(getBackupDir(oldest), "backup-manifest.json"),
        JSON.stringify({ ...oldManifest, createdAt: staleCreatedAt }, null, 2),
        "utf-8",
      );

      const summary = applyRetention([oldest]);
      expect(summary.kept).toContain(oldest);
      expect(summary.pruned).not.toContain(oldest);
      expect(existsSync(getBackupDir(oldest))).toBe(true);
    });
  });

  // --- Listing + latest lookup -----------------------------------------

  describe("listBackups / findLatestBackup", () => {
    it("returns an empty list when no backups exist", () => {
      expect(listBackups()).toEqual([]);
      expect(findLatestBackup()).toBeNull();
    });

    it("returns the most recent backup first", () => {
      const first = createBackup({
        operationId: "op-1",
        deckVersionBefore: "1.0.0",
        reason: "upgrade",
        files: [],
      });
      const second = createBackup({
        operationId: "op-2",
        deckVersionBefore: "1.0.0",
        reason: "upgrade",
        files: [],
      });

      const list = listBackups();
      expect(list[0]?.backupId).toBe(second.backupId);
      expect(list[1]?.backupId).toBe(first.backupId);

      const latest = findLatestBackup();
      expect(latest?.backupId).toBe(second.backupId);
    });

    // Regression test for the same-millisecond backup ordering flake:
    // when two `createBackup` calls land in the same millisecond, the
    // monotonic sequence embedded in the backupId must guarantee a
    // deterministic newest-first order. We create 20 backups in a tight
    // loop to maximize the chance of sharing timestamps.
    it("orders many same-millisecond backups deterministically (newest first)", () => {
      const ids: string[] = [];
      for (let i = 0; i < 20; i += 1) {
        const result = createBackup({
          operationId: `op-tight-${i}`,
          deckVersionBefore: "1.0.0",
          reason: "upgrade",
          files: [],
        });
        ids.push(result.backupId);
      }

      const list = listBackups();
      // listBackups returns newest first; the last created backup must
      // be at index 0 regardless of millisecond collisions.
      expect(list[0]?.backupId).toBe(ids[ids.length - 1]);
      // Every id must appear exactly once in the list.
      const listed = list.map((e) => e.backupId).sort();
      expect(listed).toEqual([...ids].sort());

      // findLatestBackup must match the newest id.
      expect(findLatestBackup()?.backupId).toBe(ids[ids.length - 1]);
    });
  });
});
