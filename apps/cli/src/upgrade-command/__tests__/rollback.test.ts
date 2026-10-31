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
  prepareBackupPostimages,
  recordBackupInventoryChanges,
  BACKUP_ERROR_CODES,
} from "../backup-store.js";
import { createHash } from 'node:crypto';
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
import { buildDefaultManifest, readManifest, removeManifestFile, upsertManifestFile, writeManifest } from '../manifest-store.js';

describe("rollback", () => {
  let workDir: string;
  const saved: Record<string, string | undefined> = {};
  function applyFixture(backupId:string, files:readonly [string,string][]) {
    const account=prepareBackupPostimages(backupId,files.map(([sourcePath,content])=>({sourcePath,sha256:createHash('sha256').update(content).digest('hex'),owner:'deck',kind:'config'})));
    for (const [path,content] of files) writeFileSync(path,content);
    account();
  }

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
    it("restores the binary and runner file from the most recent backup", async () => {
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
      applyFixture(backup.backupId,[[binary,'v2-binary'],[config,'{"version":2}']]);

      const result = await rollbackLatest("2.0.0");

      expect(result.backupId).toBe(backup.backupId);
      expect(result.rolledBackTo).toBe("1.0.0");
      expect(readFileSync(binary, "utf-8")).toBe("v1-binary");
      expect(readFileSync(config, "utf-8")).toBe('{"version":1}');
    });

    it("updates state.yaml so currentVersion reflects the rolled-back version", async () => {
      const binary = join(workDir, "deck");
      writeFileSync(binary, "v1-binary");
      const backup=createBackup({
        operationId: "op-1",
        deckVersionBefore: "1.0.0",
        targetVersion: "2.0.0",
        reason: "upgrade",
        files: [{ id: "binary", sourcePath: binary, owner: "deck", kind: "binary" }],
      });
      applyFixture(backup.backupId,[[binary,'v2-binary']]);

      await rollbackLatest("2.0.0");
      const state = readState("placeholder");
      expect(state.currentVersion).toBe("1.0.0");
    });

    it("clears the active operation and lock in state.yaml", async () => {
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

      await rollbackLatest("2.0.0");
      const after = readState("placeholder");
      expect(after.activeOperation).toBeUndefined();
    });
  });

  // --- Edge cases ---------------------------------------------------

  describe("rollbackLatest (edge cases)", () => {
    it("throws NOT_FOUND when no backups exist", async () => {
      try {
        await rollbackLatest("1.0.0");
        throw new Error("expected throw");
      } catch (err) {
        expect(err).toBeInstanceOf(RollbackError);
        expect((err as RollbackError).code).toBe(ROLLBACK_ERROR_CODES.NOT_FOUND);
      }
    });

    it("refuses to roll back a backup that is referenced by the active operation", async () => {
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
        await rollbackLatest("2.0.0");
        throw new Error("expected throw");
      } catch (err) {
        expect(err).toBeInstanceOf(RollbackError);
        expect((err as RollbackError).code).toBe(ROLLBACK_ERROR_CODES.PROTECTED);
      }
    });

    it("honors force=true to roll back a protected backup", async () => {
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
      applyFixture(backupId,[[binary,'v2']]);

      const result = await rollbackLatest("2.0.0", { force: true });
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
    it('restores an inventory entry removed by the transaction without adopting unrelated drift', async () => {
      const target = join(workDir,'receipt'), unrelated = join(workDir,'unrelated');
      writeFileSync(target,'original receipt'); writeFileSync(unrelated,'original tool');
      let before = upsertManifestFile(buildDefaultManifest('1'),{path:target,owner:'deck',deck_version:'1',kind:'state'},'1');
      before = upsertManifestFile(before,{path:unrelated,owner:'deck',deck_version:'1',kind:'content'},'1');
      const backup = createBackup({operationId:'remove-receipt',deckVersionBefore:'1',targetVersion:'2',reason:'upgrade',files:[{id:'receipt',sourcePath:target,owner:'deck',kind:'state'}]});
      const account = prepareBackupPostimages(backup.backupId,[{sourcePath:target,sha256:null,owner:'deck',kind:'state'}]);
      rmSync(target); account();
      const after = removeManifestFile(before,target);
      recordBackupInventoryChanges(backup.backupId,before,after); writeManifest(after);
      writeFileSync(unrelated,'later user edit');
      await rollbackBackup(backup.manifest,'2');
      expect(readFileSync(target,'utf8')).toBe('original receipt');
      expect(readManifest('1').files).toContainEqual(before.files[0]!);
      expect(readManifest('1').files).toContainEqual(before.files[1]!);
      expect(readFileSync(unrelated,'utf8')).toBe('later user edit');
    });

    it('retains recovery when old inventory evidence cannot prove the applied hash', async () => {
      const target = join(workDir,'receipt'); writeFileSync(target,'original receipt');
      const backup = createBackup({operationId:'missing-inventory-proof',deckVersionBefore:'1',targetVersion:'2',reason:'upgrade',files:[{id:'receipt',sourcePath:target,owner:'deck',kind:'state'}]});
      applyFixture(backup.backupId,[[target,'upgraded receipt']]);
      writeManifest(upsertManifestFile(buildDefaultManifest('2'),{path:target,owner:'deck',deck_version:'2',kind:'state'},'2'));
      const inventory = readManifest('2');
      const recorded = JSON.parse(readFileSync(backup.manifestPath,'utf8'));
      delete recorded.entries[0].postimage;
      writeFileSync(backup.manifestPath,JSON.stringify(recorded));
      await expect(rollbackBackup(backup.manifest,'2')).rejects.toMatchObject({code:ROLLBACK_ERROR_CODES.INVALID});
      expect(readFileSync(target,'utf8')).toBe('upgraded receipt');
      expect(readManifest('2')).toEqual(inventory);
      expect(readState('2').activeOperation?.backupId).toBe(backup.backupId);
    });

    it("rolls back the specified backup even when newer backups exist", async () => {
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
      applyFixture(second.backupId,[[binary,'v2']]);

      const result = await rollbackBackup(second.manifest, "2.0.0");
      expect(result.backupId).toBe(second.backupId);

      // A later edit is outside op-1; selecting an older backup must preserve it.
      writeFileSync(binary, "v1.5");
      await expect(rollbackBackup(first.manifest, "1.5.0")).rejects.toMatchObject({code:BACKUP_ERROR_CODES.RESTORE_FAILED});
      expect(readFileSync(binary,'utf8')).toBe('v1.5');
    });
  });
});
