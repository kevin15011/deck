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
  renameSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

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
  prepareBackupPostimages,
  BACKUP_ERROR_CODES,
} from "../backup-store.js";
import { createHash } from 'node:crypto';

describe("backup-store", () => {
  let workDir: string;
  const saved: Record<string, string | undefined> = {};
  const prepare = (backupId:string, sourcePath:string, content:string|null) => prepareBackupPostimages(backupId,[{
    sourcePath,sha256:content === null ? null : createHash('sha256').update(content).digest('hex'),owner:'deck',kind:'config',
  }]);

  it('keeps adapter metadata enlisted between content preparation and accounting', async () => {
    const content = join(workDir,'content'), metadata = join(workDir,'manifest');
    writeFileSync(content,'old content'); writeFileSync(metadata,'old receipt');
    const backup = createBackup({operationId:'op',deckVersionBefore:'1',reason:'upgrade',files:[]});
    const accountContent = prepare(backup.backupId,content,'new content');
    writeFileSync(content,'new content');
    const accountMetadata = prepare(backup.backupId,metadata,'new receipt');
    writeFileSync(metadata,'new receipt'); accountMetadata(); accountContent();
    const entries = readBackupManifest(backup.backupId).entries;
    expect(entries).toHaveLength(2);
    expect(entries.every(entry=>entry.postimage?.sha256 === createHash('sha256').update(readFileSync(entry.sourcePath)).digest('hex'))).toBe(true);
    expect(await restoreBackup(backup.backupId)).toMatchObject({restored:2,deleted:0});
    expect(readFileSync(content,'utf8')).toBe('old content'); expect(readFileSync(metadata,'utf8')).toBe('old receipt');
  });

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
    it('persists physical source paths independently of the rollback working directory', () => {
      const source = join(workDir,'content'); writeFileSync(source,'original');
      const backup = createBackup({operationId:'op',deckVersionBefore:'1',reason:'upgrade',files:[{
        id:'content',sourcePath:relative(process.cwd(),source),owner:'deck',kind:'content',
      }]});
      expect(backup.manifest.entries[0]!.sourcePath).toBe(source);
    });
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
    it("restores the original file content", async () => {
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
      const account = prepare(backupId,source,'MODIFIED');
      writeFileSync(source, "MODIFIED");
      account();
      expect(readFileSync(source, "utf-8")).toBe("MODIFIED");

      const stats = await restoreBackup(backupId);
      expect(stats.restored).toBe(1);
      expect(readFileSync(source, "utf-8")).toBe("ORIGINAL");
    });

    it("deletes files that didn't exist before the operation", async () => {
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
      const account = prepare(backupId,source,'new');
      writeFileSync(source, "new");
      account();
      expect(existsSync(source)).toBe(true);

      const stats = await restoreBackup(backupId);
      expect(stats.deleted).toBe(1);
      expect(existsSync(source)).toBe(false);
    });

    it("throws NOT_FOUND when the backup doesn't exist", async () => {
      try {
        await restoreBackup("no-such-backup");
        throw new Error("expected throw");
      } catch (err) {
        expect(err).toBeInstanceOf(BackupStoreError);
        expect((err as BackupStoreError).code).toBe(BACKUP_ERROR_CODES.NOT_FOUND);
      }
    });

    for (const created of [false,true]) it(`preserves drift in ${created ? 'created' : 'overwritten'} files, then retries verified content`, async()=>{
      const source=join(workDir,'file'); if (!created) writeFileSync(source,'original');
      const backup=createBackup({operationId:'op',deckVersionBefore:'1',reason:'upgrade',files:[{id:'file',sourcePath:source,owner:'deck',kind:'config'}]});
      const account=prepare(backup.backupId,source,'applied');writeFileSync(source,'applied');account();
      writeFileSync(source,'later edit');
      await expect(restoreBackup(backup.backupId)).rejects.toMatchObject({code:BACKUP_ERROR_CODES.RESTORE_FAILED});
      expect(readFileSync(source,'utf8')).toBe('later edit');expect(existsSync(backup.manifestPath)).toBe(true);
      writeFileSync(source,'applied'); // explicit fixture reconciliation, same recorded path
      await restoreBackup(backup.backupId);
      if (created) expect(existsSync(source)).toBe(false); else expect(readFileSync(source,'utf8')).toBe('original');
      expect(await restoreBackup(backup.backupId)).toMatchObject({restored:0,deleted:0});
    });

    for (const failure of ['missing-postimage','unknown-output','missing-backup','corrupt-backup','symlink','ancestor-symlink','ancestor-replacement','file-replacement','deleted-target'] as const) it(`refuses ${failure} without overwriting or deleting content`, async()=>{
      const dir=join(workDir,'runner');mkdirSync(dir);
      const source=join(dir,'file');writeFileSync(source,'original');
      const backup=createBackup({operationId:'op',deckVersionBefore:'1',reason:'upgrade',files:[{id:'file',sourcePath:source,owner:'deck',kind:'config'}]});
      const account=prepare(backup.backupId,source,'applied');writeFileSync(source,failure==='unknown-output'?'unrecognized partial write':'applied');account();
      const originalCopy=backup.manifest.entries[0]!.backupPath;
      if (failure==='missing-postimage') {const manifest=readBackupManifest(backup.backupId);delete manifest.entries[0]!.postimage;writeFileSync(backup.manifestPath,JSON.stringify(manifest));}
      if (failure==='missing-backup') rmSync(originalCopy);
      if (failure==='corrupt-backup') writeFileSync(originalCopy,'wrong original');
      if (failure==='symlink') {renameSync(source,join(workDir,'external'));symlinkSync(join(workDir,'external'),source);}
      if (failure==='ancestor-symlink') {renameSync(dir,join(workDir,'external-dir'));symlinkSync(join(workDir,'external-dir'),dir);}
      if (failure==='ancestor-replacement') {renameSync(dir,join(workDir,'old-dir'));mkdirSync(dir);writeFileSync(source,'applied');}
      if (failure==='file-replacement') {writeFileSync(join(dir,'replacement'),'applied');renameSync(join(dir,'replacement'),source);}
      if (failure==='deleted-target') rmSync(source);
      await expect(restoreBackup(backup.backupId)).rejects.toMatchObject({code:BACKUP_ERROR_CODES.RESTORE_FAILED});
      if (failure==='deleted-target') expect(existsSync(source)).toBe(false);
      else expect(readFileSync(source,'utf8')).toBe(failure==='unknown-output'?'unrecognized partial write':'applied');
      expect(existsSync(backup.manifestPath)).toBe(true);
    });

    it('retains partial restore receipts and retries only unresolved entries', async()=>{
      const original=join(workDir,'original'), created=join(workDir,'created');writeFileSync(original,'original');
      const backup=createBackup({operationId:'op',deckVersionBefore:'1',reason:'upgrade',files:[
        {id:'original',sourcePath:original,owner:'deck',kind:'config'},{id:'created',sourcePath:created,owner:'deck',kind:'config'},
      ]});
      const finishOriginal=prepare(backup.backupId,original,'applied');writeFileSync(original,'applied');finishOriginal();
      const finishCreated=prepare(backup.backupId,created,'created');writeFileSync(created,'created');finishCreated();
      writeFileSync(original,'later edit');
      await expect(restoreBackup(backup.backupId)).rejects.toMatchObject({code:BACKUP_ERROR_CODES.RESTORE_FAILED});
      expect(existsSync(created)).toBe(false);expect(readFileSync(original,'utf8')).toBe('later edit');
      const receipt=readFileSync(backup.manifestPath,'utf8');
      await expect(restoreBackup(backup.backupId)).rejects.toMatchObject({code:BACKUP_ERROR_CODES.RESTORE_FAILED});
      expect(readFileSync(backup.manifestPath,'utf8')).toBe(receipt);
      writeFileSync(original,'applied');
      expect(await restoreBackup(backup.backupId)).toMatchObject({restored:1,deleted:0});
      expect(readFileSync(original,'utf8')).toBe('original');
    });


    it("includes failed entry diagnostics when restore partially fails", async () => {
      const source = join(workDir, "binary");
      writeFileSync(source, "ORIGINAL");
      const { backupId } = createBackup({
        operationId: "op-1",
        deckVersionBefore: "1.0.0",
        reason: "upgrade",
        files: [{ id: "binary", sourcePath: source, owner: "deck", kind: "binary" }],
      });

      const manifest = readBackupManifest(backupId);
      const badBackupPath = join(workDir, "not-a-file");
      mkdirSync(badBackupPath, { recursive: true });
      writeFileSync(
        join(getBackupDir(backupId), "backup-manifest.json"),
        JSON.stringify(
          {
            ...manifest,
            entries: manifest.entries.map((entry) =>
              entry.id === "binary" ? { ...entry, backupPath: badBackupPath } : entry,
            ),
          },
          null,
          2,
        ),
      );

      try {
        await restoreBackup(backupId);
        throw new Error("expected restore failure");
      } catch (err) {
        expect(err).toBeInstanceOf(BackupStoreError);
        const backupError = err as BackupStoreError;
        expect(backupError.code).toBe(BACKUP_ERROR_CODES.RESTORE_FAILED);
        expect(backupError.message).toContain("binary");
        expect(backupError.message).toContain(source);
        expect(backupError.failedEntries?.[0]?.entryId).toBe("binary");
        expect(backupError.failedEntries?.[0]?.sourcePath).toBe(source);
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
