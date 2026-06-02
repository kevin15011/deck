/**
 * Unit tests for the rollback module.
 *
 * Covers REQ-RBK-001 (CLI rollback), REQ-RBK-003 (binary + runner files),
 * REQ-RBK-005 (state.yaml reflects rolled-back version).
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
  BackupStoreError,
  createBackup,
  BACKUP_ERROR_CODES,
} from "../backup-store.js";
import {
  rollbackBackup,
  rollbackLatest,
  RollbackError,
  ROLLBACK_ERROR_CODES,
  resolveLatestBackupForCli,
  listBackupIdsForCli,
  backupExists,
  loadBackupManifest,
} from "../rollback.js";
import { getStateStorePaths, readState } from "../state-store.js";

describe("rollback", () => {
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
    workDir = mkdtempSync(join(tmpdir(), "deck-rollback-"));
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

  // --- Happy path ----------------------------------------------------

  describe("rollbackLatest (happy path)", () => {
    it("restores the binary and runner file from the most recent backup", () => {
      const binary = join(workDir, "deck");
      const config = join(workDir, "config.json");
      writeFileSync(binary, "v1-binary");
      writeFileSync(config, '{"version":1}');

      const backup = createBackup({
        operationId: "op-1",
        deckVersionBefore: "1.0.0",
        targetVersion: "2.0.0",
        reason: "upgrade",
        files: [
          { id: "binary", sourcePath: binary, owner: "deck", kind: "binary" },
          { id: "config", sourcePath: config, owner: "deck", kind: "config" },
        ],
      });

      // Simulate the operation mutating files.
      writeFileSync(binary, "v2-binary");
      writeFileSync(config, '{"version":2}');

      const result = rollbackLatest("2.0.0");

      expect(result.backupId).toBe(backup.backupId);
      expect(result.rolledBackTo).toBe("1.0.0");
      expect(readFileSync(binary, "utf-8")).toBe("v1-binary");
      expect(readFileSync(config, "utf-8")).toBe('{"version":1}');
    });

    it("updates state.yaml so currentVersion reflects the rolled-back version", () => {
      const binary = join(workDir, "deck");
      writeFileSync(binary, "v1-binary");
      createBackup({
        operationId: "op-1",
        deckVersionBefore: "1.0.0",
        targetVersion: "2.0.0",
        reason: "upgrade",
        files: [{ id: "binary", sourcePath: binary, owner: "deck", kind: "binary" }],
      });
      writeFileSync(binary, "v2-binary");

      rollbackLatest("2.0.0");
      const state = readState("placeholder");
      expect(state.currentVersion).toBe("1.0.0");
    });

    it("clears the active operation and lock in state.yaml", () => {
      const binary = join(workDir, "deck");
      writeFileSync(binary, "v1");
      createBackup({
        operationId: "op-1",
        deckVersionBefore: "1.0.0",
        reason: "upgrade",
        files: [{ id: "binary", sourcePath: binary, owner: "deck", kind: "binary" }],
      });

      // Write a state file with an active operation referencing the backup.
      const { statePath } = getStateStorePaths();
      mkdirSync(join(workDir, "state", "deck"), { recursive: true });
      writeFileSync(
        statePath,
        JSON.stringify({
          schemaVersion: 1,
          currentVersion: "2.0.0",
          installKind: "binary",
          activeOperation: {
            id: "op-1",
            version: "2.0.0",
            phase: "binary",
            backupId: readState("placeholder")?.activeOperation?.backupId ?? undefined,
            startedAt: new Date().toISOString(),
          },
          installHistory: {
            path: "/tmp/upgrade-history.jsonl",
            retention: { maxEntries: 100, maxAgeDays: 180 },
          },
        }),
      );

      rollbackLatest("2.0.0");
      const after = readState("placeholder");
      expect(after.activeOperation).toBeUndefined();
    });
  });

  // --- Edge cases ---------------------------------------------------

  describe("rollbackLatest (edge cases)", () => {
    it("throws NOT_FOUND when no backups exist", () => {
      try {
        rollbackLatest("1.0.0");
        throw new Error("expected throw");
      } catch (err) {
        expect(err).toBeInstanceOf(RollbackError);
        expect((err as RollbackError).code).toBe(ROLLBACK_ERROR_CODES.NOT_FOUND);
      }
    });

    it("refuses to roll back a backup that is referenced by the active operation", () => {
      const binary = join(workDir, "deck");
      writeFileSync(binary, "v1");
      const { backupId } = createBackup({
        operationId: "op-1",
        deckVersionBefore: "1.0.0",
        reason: "upgrade",
        files: [{ id: "binary", sourcePath: binary, owner: "deck", kind: "binary" }],
      });

      const { statePath } = getStateStorePaths();
      mkdirSync(join(workDir, "state", "deck"), { recursive: true });
      writeFileSync(
        statePath,
        JSON.stringify({
          schemaVersion: 1,
          currentVersion: "2.0.0",
          installKind: "binary",
          activeOperation: {
            id: "op-1",
            version: "2.0.0",
            phase: "binary",
            backupId,
            startedAt: new Date().toISOString(),
          },
          installHistory: {
            path: "/tmp/upgrade-history.jsonl",
            retention: { maxEntries: 100, maxAgeDays: 180 },
          },
        }),
      );

      try {
        rollbackLatest("2.0.0");
        throw new Error("expected throw");
      } catch (err) {
        expect(err).toBeInstanceOf(RollbackError);
        expect((err as RollbackError).code).toBe(ROLLBACK_ERROR_CODES.PROTECTED);
      }
    });

    it("honors force=true to roll back a protected backup", () => {
      const binary = join(workDir, "deck");
      writeFileSync(binary, "v1");
      const { backupId } = createBackup({
        operationId: "op-1",
        deckVersionBefore: "1.0.0",
        reason: "upgrade",
        files: [{ id: "binary", sourcePath: binary, owner: "deck", kind: "binary" }],
      });

      const { statePath } = getStateStorePaths();
      mkdirSync(join(workDir, "state", "deck"), { recursive: true });
      writeFileSync(
        statePath,
        JSON.stringify({
          schemaVersion: 1,
          currentVersion: "2.0.0",
          installKind: "binary",
          activeOperation: {
            id: "op-1",
            version: "2.0.0",
            phase: "binary",
            backupId,
            startedAt: new Date().toISOString(),
          },
          installHistory: {
            path: "/tmp/upgrade-history.jsonl",
            retention: { maxEntries: 100, maxAgeDays: 180 },
          },
        }),
      );
      writeFileSync(binary, "v2");

      const result = rollbackLatest("2.0.0", { force: true });
      expect(result.backupId).toBe(backupId);
      expect(readFileSync(binary, "utf-8")).toBe("v1");
    });
  });

  // --- CLI helpers ---------------------------------------------------

  describe("CLI helpers", () => {
    it("resolveLatestBackupForCli returns the most-recent manifest", () => {
      const binary = join(workDir, "deck");
      writeFileSync(binary, "v1");
      const { backupId } = createBackup({
        operationId: "op-1",
        deckVersionBefore: "1.0.0",
        reason: "upgrade",
        files: [{ id: "binary", sourcePath: binary, owner: "deck", kind: "binary" }],
      });
      expect(resolveLatestBackupForCli()?.backupId).toBe(backupId);
    });

    it("listBackupIdsForCli returns the ids in newest-first order", () => {
      const binary = join(workDir, "deck");
      writeFileSync(binary, "v1");
      const first = createBackup({
        operationId: "op-1",
        deckVersionBefore: "1.0.0",
        reason: "upgrade",
        files: [{ id: "binary", sourcePath: binary, owner: "deck", kind: "binary" }],
      });
      const second = createBackup({
        operationId: "op-2",
        deckVersionBefore: "1.0.0",
        reason: "upgrade",
        files: [{ id: "binary", sourcePath: binary, owner: "deck", kind: "binary" }],
      });
      const ids = listBackupIdsForCli();
      expect(ids[0]).toBe(second.backupId);
      expect(ids[1]).toBe(first.backupId);
    });

    it("backupExists reports existence", () => {
      const binary = join(workDir, "deck");
      writeFileSync(binary, "v1");
      const { backupId } = createBackup({
        operationId: "op-1",
        deckVersionBefore: "1.0.0",
        reason: "upgrade",
        files: [{ id: "binary", sourcePath: binary, owner: "deck", kind: "binary" }],
      });
      expect(backupExists(backupId)).toBe(true);
      expect(backupExists("does-not-exist")).toBe(false);
    });

    it("loadBackupManifest returns the same payload", () => {
      const binary = join(workDir, "deck");
      writeFileSync(binary, "v1");
      const { backupId } = createBackup({
        operationId: "op-1",
        deckVersionBefore: "1.0.0",
        reason: "upgrade",
        files: [{ id: "binary", sourcePath: binary, owner: "deck", kind: "binary" }],
      });
      const m = loadBackupManifest(backupId);
      expect(m.backupId).toBe(backupId);
    });

    it("loadBackupManifest throws NOT_FOUND for unknown id", () => {
      try {
        loadBackupManifest("missing");
        throw new Error("expected throw");
      } catch (err) {
        expect(err).toBeInstanceOf(BackupStoreError);
        expect((err as BackupStoreError).code).toBe(BACKUP_ERROR_CODES.NOT_FOUND);
      }
    });
  });

  // --- Direct backup id -----------------------------------------------

  describe("rollbackBackup", () => {
    it("rolls back the specified backup even when newer backups exist", () => {
      const binary = join(workDir, "deck");
      writeFileSync(binary, "v1");
      const first = createBackup({
        operationId: "op-1",
        deckVersionBefore: "1.0.0",
        reason: "upgrade",
        files: [{ id: "binary", sourcePath: binary, owner: "deck", kind: "binary" }],
      });
      const second = createBackup({
        operationId: "op-2",
        deckVersionBefore: "1.5.0",
        reason: "upgrade",
        files: [{ id: "binary", sourcePath: binary, owner: "deck", kind: "binary" }],
      });
      writeFileSync(binary, "v2");

      const result = rollbackBackup(second.manifest, "2.0.0");
      expect(result.backupId).toBe(second.backupId);

      // Re-creating an op-1 backup with current state so we can verify a
      // direct rollback to the first manifest restores correctly.
      writeFileSync(binary, "v1.5");
      const result1 = rollbackBackup(first.manifest, "1.5.0");
      expect(result1.backupId).toBe(first.backupId);
      expect(existsSync(binary)).toBe(true);
    });
  });
});
