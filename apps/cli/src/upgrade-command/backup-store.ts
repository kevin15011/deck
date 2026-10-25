/**
 * Backup store for the self-update system.
 *
 * Implements REQ-ATM-001 .. REQ-ATM-004:
 *   - Timestamped backup under `$XDG_CACHE_HOME/deck/backups/<backupId>/`.
 *   - `backup-manifest.json` lists every backed-up file with ownership + kind.
 *   - Restore reverses entries in the order recorded.
 *   - Retention: keep latest 5 successful backups; older entries beyond 30
 *     days are pruned; a backup referenced by `state.yaml` is protected.
 *
 * Design reference: `openspec/changes/add-self-update-system/design.md` §2
 * ("Backup schemas — `backup-manifest.json`").
 */

import { constants, copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { assertNoContributionSymlink } from "@deck/core";

import { z } from "zod";
import { withIdleRunnerMutation } from "@deck/session-host";

import { getDeckXdgPaths } from "../runtime/paths.js";
import { ManifestFileSchema, type ManifestJsonV2 } from './manifest-store.js';
import { isDeepStrictEqual } from 'node:util';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const BackupOwnerSchema = z.union([
  z.enum(["deck", "runner:pi", "runner:opencode"]),
  z.string().regex(/^runner:/),
]);
export type BackupOwner = z.infer<typeof BackupOwnerSchema>;

export const BackupKindSchema = z.enum([
  "binary",
  "config",
  "prompt",
  "skill",
  "subagent",
  "mcp",
  "state",
  "manifest",
  "content",
]);
export type BackupKind = z.infer<typeof BackupKindSchema>;

export const ChecksumSchema = z.object({
  algorithm: z.literal("sha256"),
  value: z.string().regex(/^[a-f0-9]{64}$/),
});

// Optional only for reading older backups. Missing evidence never authorizes restore.
const PostimageSchema = z.object({
  sha256: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  paths: z.array(z.object({path:z.string(), dev:z.string(), ino:z.string()})),
});
type Postimage = z.infer<typeof PostimageSchema>;

export const BackupEntrySchema = z.object({
  id: z.string(),
  sourcePath: z.string(),
  backupPath: z.string(),
  owner: BackupOwnerSchema,
  kind: BackupKindSchema,
  existed: z.boolean(),
  checksumBefore: ChecksumSchema.optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
  postimage: PostimageSchema.optional(),
});
export type BackupEntry = z.infer<typeof BackupEntrySchema>;

export const BackupManifestSchema = z.object({
  schemaVersion: z.literal(1),
  backupId: z.string(),
  createdAt: z.string().datetime(),
  operationId: z.string(),
  deckVersionBefore: z.string(),
  targetVersion: z.string().optional(),
  reason: z.enum(["upgrade", "migration", "rollback-test"]),
  entries: z.array(BackupEntrySchema),
  // Exact inventory writes, separate from mutable physical restore progress.
  // Optional for older backups; absence never authorizes guessing ownership.
  inventoryChanges: z.array(z.object({
    path: z.string(),
    before: ManifestFileSchema.optional(),
    after: ManifestFileSchema.optional(),
  })).optional(),
  retention: z.object({
    keepLatest: z.literal(5),
    maxAgeDays: z.literal(30),
    protectIfReferencedByState: z.literal(true),
  }),
});
export type BackupManifest = z.infer<typeof BackupManifestSchema>;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export const BACKUP_ERROR_CODES = {
  /** Backup creation failed. */
  CREATE_FAILED: "BACKUP_CREATE_FAILED",
  /** Manifest write or read failed. */
  MANIFEST_FAILED: "BACKUP_MANIFEST_FAILED",
  /** Restore encountered a problem (partial success leaves the user in a
   * recoverable state; the caller must surface a critical error). */
  RESTORE_FAILED: "BACKUP_RESTORE_FAILED",
  /** No backups available to restore from. */
  NOT_FOUND: "BACKUP_NOT_FOUND",
} as const;

export type BackupErrorCode = (typeof BACKUP_ERROR_CODES)[keyof typeof BACKUP_ERROR_CODES];

export class BackupStoreError extends Error {
  readonly code: BackupErrorCode;
  readonly backupId?: string;
  readonly failedEntries?: { entryId: string; sourcePath: string; reason: string }[];

  constructor(
    code: BackupErrorCode,
    message: string,
    options?: { backupId?: string; cause?: unknown; failedEntries?: { entryId: string; sourcePath: string; reason: string }[] },
  ) {
    super(message);
    this.name = "BackupStoreError";
    this.code = code;
    this.backupId = options?.backupId;
    this.failedEntries = options?.failedEntries;
    if (options?.cause !== undefined) {
      this.cause = options.cause;
    }
  }
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

export function getBackupRoot(): string {
  return getDeckXdgPaths().backupsDir;
}

/**
 * Compose the absolute path of a backup directory.
 */
export function getBackupDir(backupId: string): string {
  return join(getBackupRoot(), backupId);
}

// ---------------------------------------------------------------------------
// Backup creation
// ---------------------------------------------------------------------------

/**
 * Minimal input to `createBackup` — every field is required.
 */
export type CreateBackupInput = {
  /** Operation ID that owns this backup. */
  operationId: string;
  /** Current Deck version before the operation. */
  deckVersionBefore: string;
  /** Target version, if known. */
  targetVersion?: string;
  /** Why the backup is being created. */
  reason: "upgrade" | "migration" | "rollback-test";
  /** Files to back up (id + source path + owner + kind). */
  files: ReadonlyArray<{
    id: string;
    sourcePath: string;
    owner: BackupOwner;
    kind: BackupKind;
  }>;
};

/**
 * Result of `createBackup` — manifest path + entry list.
 */
export type CreateBackupResult = {
  backupId: string;
  backupDir: string;
  manifestPath: string;
  manifest: BackupManifest;
};

/**
 * Create a timestamped backup directory and copy each requested file into
 * it. Files that do not exist are recorded with `existed: false` and
 * skipped during copy (the restore step then knows to delete them).
 */
export function createBackup(input: CreateBackupInput): CreateBackupResult {
  const backupId = makeBackupId();
  const backupDir = getBackupDir(backupId);
  const manifestPath = join(backupDir, "backup-manifest.json");

  try {
    mkdirSync(backupDir, { recursive: true });
  } catch (err) {
    throw new BackupStoreError(
      BACKUP_ERROR_CODES.CREATE_FAILED,
      `Failed to create backup directory: ${(err as Error).message}`,
      { backupId, cause: err },
    );
  }

  const entries: BackupEntry[] = [];
  for (const file of input.files) {
    const backupRelPath = sanitizeBackupPath(file.id, file.sourcePath);
    const backupPath = join(backupDir, backupRelPath);
    const postimage = inspectPostimage(file.sourcePath);
    const existed = postimage.sha256 !== null;

    let checksumBefore: BackupEntry["checksumBefore"];
    let sizeBytes: number | undefined;

    if (existed) {
      try {
        mkdirSync(dirname(backupPath), { recursive: true });
        copyFileSync(file.sourcePath, backupPath);
        const stat = statSync(backupPath);
        sizeBytes = stat.size;
        checksumBefore = { algorithm: "sha256", value: computeFileSha256(backupPath) };
        if (checksumBefore.value !== postimage.sha256 || !samePostimage(inspectPostimage(file.sourcePath),postimage)) throw new Error('Source changed during backup');
      } catch (err) {
        throw new BackupStoreError(
          BACKUP_ERROR_CODES.CREATE_FAILED,
          `Failed to copy ${file.sourcePath} into backup: ${(err as Error).message}`,
          { backupId, cause: err },
        );
      }
    }

    entries.push({
      id: file.id,
      sourcePath: resolve(file.sourcePath),
      backupPath,
      owner: file.owner,
      kind: file.kind,
      existed,
      ...(checksumBefore ? { checksumBefore } : {}),
      ...(sizeBytes !== undefined ? { sizeBytes } : {}),
      postimage,
    });
  }

  const manifest: BackupManifest = {
    schemaVersion: 1,
    backupId,
    createdAt: new Date().toISOString(),
    operationId: input.operationId,
    deckVersionBefore: input.deckVersionBefore,
    ...(input.targetVersion ? { targetVersion: input.targetVersion } : {}),
    reason: input.reason,
    entries,
    retention: {
      keepLatest: 5,
      maxAgeDays: 30,
      protectIfReferencedByState: true,
    },
  };

  try {
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf-8");
  } catch (err) {
    throw new BackupStoreError(
      BACKUP_ERROR_CODES.MANIFEST_FAILED,
      `Failed to write backup manifest: ${(err as Error).message}`,
      { backupId, cause: err },
    );
  }

  return { backupId, backupDir, manifestPath, manifest };
}

function inspectPostimage(path: string): Postimage {
  path = resolve(path);
  assertNoContributionSymlink(path);
  const paths: Postimage['paths'] = [];
  for (let cursor = path;; cursor = dirname(cursor)) {
    try {
      const stat = lstatSync(cursor);
      if (cursor === path && !stat.isFile()) throw new Error(`Recovery target is not a regular file: ${path}`);
      if (cursor !== path && !stat.isDirectory()) throw new Error(`Recovery ancestor is not a directory: ${cursor}`);
      paths.push({path:cursor, dev:String(stat.dev), ino:String(stat.ino)});
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (dirname(cursor) === cursor) break;
  }
  return {sha256:existsSync(path) ? computeFileSha256(path) : null, paths};
}

function samePostimage(a: Postimage, b: Postimage): boolean {
  return a.sha256 === b.sha256 && JSON.stringify(a.paths) === JSON.stringify(b.paths);
}

function sameAncestors(before: Postimage, after: Postimage, path: string): boolean {
  return before.paths.filter(p=>p.path !== resolve(path)).every(p=>
    after.paths.some(a=>a.path === p.path && a.dev === p.dev && a.ino === p.ino));
}

function writeBackupManifest(manifest: BackupManifest): void {
  const path = join(getBackupDir(manifest.backupId), 'backup-manifest.json');
  assertNoContributionSymlink(path);
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, JSON.stringify(manifest,null,2)+'\n', {flag:'wx',mode:0o600});
    assertNoContributionSymlink(path);
    renameSync(temporary,path);
  } finally { if (existsSync(temporary)) unlinkSync(temporary); }
}

/** Persist only inventory changes whose physical targets belong to this backup,
 * before the central inventory writer runs. Whole-file snapshots would overwrite
 * unrelated/later inventory contributions during recovery.
 */
export function recordBackupInventoryChanges(backupId: string, before: ManifestJsonV2, after: ManifestJsonV2): void {
  const backup = readBackupManifest(backupId);
  const paths = new Set([...before.files, ...after.files].map(file => file.path));
  backup.inventoryChanges = [...paths].flatMap(path => {
    const previous = before.files.find(file => file.path === path);
    const next = after.files.find(file => file.path === path);
    if (isDeepStrictEqual(previous, next)) return [];
    if (!backup.entries.some(entry => entry.sourcePath === path && entry.owner === (next ?? previous)?.owner)) return [];
    return [{ path, before: previous, after: next }];
  });
  writeBackupManifest(backup);
}

/** Prepare at the actual writer boundary, then account known outputs immediately
 * after apply (also on partial failure), before verification can run user code.
 * Expected bytes come from the plan/staged binary, never from rollback-time reads.
 * New plan targets join the same backup, before their first mutation.
 */
export function prepareBackupPostimages(backupId: string, changes: ReadonlyArray<{
  sourcePath: string; sha256: string | null; owner: BackupOwner; kind: BackupKind;
}>): () => void {
  const manifest = readBackupManifest(backupId);
  const selected = changes.map(change => {
    let entry = manifest.entries.find(entry => resolve(entry.sourcePath) === resolve(change.sourcePath));
    if (!entry) {
      const sourcePath = resolve(change.sourcePath), postimage = inspectPostimage(sourcePath);
      const backupPath = join(getBackupDir(backupId),`additional-${randomUUID()}`);
      if (postimage.sha256 !== null) {
        copyFileSync(sourcePath,backupPath);
        if (computeFileSha256(backupPath) !== postimage.sha256 || !samePostimage(inspectPostimage(sourcePath),postimage)) throw new Error('Source changed during backup');
      }
      entry = {id:`${change.owner}:${sourcePath}`,sourcePath,backupPath,owner:change.owner,kind:change.kind,
        existed:postimage.sha256 !== null,postimage,
        ...(postimage.sha256 !== null ? {checksumBefore:{algorithm:'sha256' as const,value:postimage.sha256}} : {})};
      manifest.entries.push(entry);
    }
    const before = inspectPostimage(entry.sourcePath);
    if (!entry.postimage || !samePostimage(before,entry.postimage)) throw new Error(`Recovery postimage changed before apply: ${entry.sourcePath}`);
    return {entry,change,before};
  });
  writeBackupManifest(manifest);
  return () => {
    // Adapter side writes can enlist more targets between preparation and
    // accounting. Merge only our selected entries into the latest ledger.
    const latest = readBackupManifest(backupId);
    for (const {entry,change,before} of selected) {
      // Unknown/unsafe output stays unresolved; never bless arbitrary current bytes.
      entry.postimage = undefined;
      try {
        const after = inspectPostimage(entry.sourcePath);
        if (sameAncestors(before,after,entry.sourcePath) && (after.sha256 === change.sha256 || after.sha256 === before.sha256)) entry.postimage = after;
      } catch { /* Preserve unknown postimage for explicit recovery. */ }
      const current = latest.entries.find(candidate=>candidate.sourcePath === entry.sourcePath);
      if (!current) throw new Error(`Recovery entry disappeared: ${entry.sourcePath}`);
      current.postimage = entry.postimage;
    }
    writeBackupManifest(latest);
  };
}

/**
 * Compute a stable relative path under the backup directory. Uses `id` when
 * present (deterministic), otherwise derives a path from the source.
 */
function sanitizeBackupPath(id: string, sourcePath: string): string {
  // Use the id, replacing any path separators with safe chars.
  const safe = id.replace(/[/\\]/g, "__");
  return safe;
}

// Monotonic counter used to break ties when two backups land in the same
// millisecond. The counter is a module-private number that is incremented
// for every `createBackup` call so the resulting `backupId` is strictly
// increasing within a process. This guarantees deterministic ordering
// for `listBackups` / `findLatestBackup` even when back-to-back creates
// share a millisecond `createdAt` timestamp.
let backupSequence = 0;

function makeBackupId(): string {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  // Zero-pad the counter so the lexicographic order on `backupId` matches
  // the chronological order of creation, regardless of clock skew.
  const seq = String(++backupSequence).padStart(10, "0");
  return `${ts}-${seq}`;
}

/**
 * Synchronous SHA-256 of a file using the `node:crypto` module.
 *
 * Exposed for callers that need the same hash that was recorded in the
 * manifest (e.g. post-restoration drift detection).
 */
export function computeFileSha256(filePath: string): string {
  const { createHash } = require("node:crypto") as typeof import("node:crypto");
  const hash = createHash("sha256");
  const text = readFileSync(filePath);
  hash.update(text);
  return hash.digest("hex");
}

// ---------------------------------------------------------------------------
// Restore
// ---------------------------------------------------------------------------

/**
 * Restore every entry in a backup manifest. The restore proceeds in reverse
 * order, so files created during the operation are removed and original
 * files restored only while their recorded postimages and paths still match.
 * Missing or changed evidence is a conflict, including a missing original copy.
 *
 * Per spec REQ-ATM-012, a partial restore is a critical error: the caller
 * MUST surface `ROLLBACK_FAILED` so the user can recover from `backupPath`.
 */
export async function restoreBackup(backupId: string): Promise<{
  restored: number;
  deleted: number;
  failed: { entryId: string; sourcePath: string; reason: string }[];
}> {
  // Guard the lowest public restore entry point, including direct recovery users.
  // The manifest is reread after admission and the reservation covers every write.
  return withIdleRunnerMutation(() => {
    const manifest = readBackupManifest(backupId);

    let restored = 0;
    let deleted = 0;
    const failed: { entryId: string; sourcePath: string; reason: string }[] = [];

    // Reverse so newer changes get unwound first.
    const reversed = [...manifest.entries].reverse();
    for (const entry of reversed) {
      try {
        if (!entry.postimage) throw new Error('Applied postimage is unknown or missing; preserve this entry for explicit recovery');
        // Validate originals even on an already-restored retry. Missing originals
        // must never turn into deletion or successful recovery finalization.
        if (entry.existed) {
          assertNoContributionSymlink(entry.backupPath);
          if (!entry.checksumBefore || !lstatSync(entry.backupPath).isFile() || computeFileSha256(entry.backupPath) !== entry.checksumBefore.value) {
            throw new Error('Original backup is missing or changed');
          }
        }
        const observed = inspectPostimage(entry.sourcePath);
        if (!samePostimage(observed,entry.postimage)) throw new Error('Applied postimage or path changed; newer content preserved');
        const originalHash = entry.existed ? entry.checksumBefore!.value : null;
        if (observed.sha256 === originalHash) continue; // untouched or durable completed restore
        if (entry.existed) {
          const temporary = `${entry.sourcePath}.${randomUUID()}.rollback`;
          try {
            // No recursive mkdir: disappearance/replacement of an ancestor is a conflict.
            copyFileSync(entry.backupPath,temporary,constants.COPYFILE_EXCL);
            if (computeFileSha256(temporary) !== originalHash || !samePostimage(inspectPostimage(entry.sourcePath),observed)) throw new Error('Recovery postimage changed before restore');
            renameSync(temporary,entry.sourcePath);
          } finally { if (existsSync(temporary)) unlinkSync(temporary); }
          restored++;
        } else {
          if (!samePostimage(inspectPostimage(entry.sourcePath),observed)) throw new Error('Recovery postimage changed before delete');
          unlinkSync(entry.sourcePath);
          deleted++;
        }
        // Persist each completed restore before another entry can fail. Retrying
        // checks these bytes/identities too, and never replays completed writes.
        const after = inspectPostimage(entry.sourcePath);
        entry.postimage = after.sha256 === originalHash && sameAncestors(observed,after,entry.sourcePath) ? after : undefined;
        writeBackupManifest(manifest);
        if (!entry.postimage) throw new Error('Recovery postimage changed during restore; preserve unresolved recovery');
      } catch (err) {
        failed.push({
          entryId: entry.id,
          sourcePath: entry.sourcePath,
          reason: (err as Error).message,
        });
      }
    }

    if (failed.length > 0) {
      const details = failed
        .slice(0, 5)
        .map((entry) => `${entry.entryId} (${entry.sourcePath}): ${entry.reason}`)
        .join("; ");
      const suffix = failed.length > 5 ? `; plus ${failed.length - 5} more` : "";
      throw new BackupStoreError(
        BACKUP_ERROR_CODES.RESTORE_FAILED,
        `Restore partially failed: ${failed.length} of ${reversed.length} entries. ` +
          `Failures: ${details}${suffix}. See the backup at ${manifest.backupId}.`,
        { backupId, failedEntries: failed },
      );
    }

    return { restored, deleted, failed };
  });
}

/**
 * Read a backup manifest from disk.
 */
export function readBackupManifest(backupId: string): BackupManifest {
  const manifestPath = join(getBackupDir(backupId), "backup-manifest.json");
  assertNoContributionSymlink(manifestPath);
  if (!existsSync(manifestPath)) {
    throw new BackupStoreError(
      BACKUP_ERROR_CODES.NOT_FOUND,
      `No backup manifest at ${manifestPath}`,
      { backupId },
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(manifestPath, "utf-8"));
  } catch (err) {
    throw new BackupStoreError(
      BACKUP_ERROR_CODES.MANIFEST_FAILED,
      `Backup manifest is not valid JSON: ${(err as Error).message}`,
      { backupId, cause: err },
    );
  }
  const result = BackupManifestSchema.safeParse(raw);
  if (!result.success) {
    throw new BackupStoreError(
      BACKUP_ERROR_CODES.MANIFEST_FAILED,
      `Backup manifest failed schema validation: ${result.error.message}`,
      { backupId, cause: result.error },
    );
  }
  return result.data;
}

// ---------------------------------------------------------------------------
// Retention
// ---------------------------------------------------------------------------

/**
 * Enumerate backup directories sorted newest-first by manifest `createdAt`.
 *
 * Falls back to lexical ID order when the manifest is missing/unreadable so
 * the function is safe even with partially-corrupted state.
 */
export function listBackups(): readonly { backupId: string; manifest: BackupManifest | null }[] {
  const root = getBackupRoot();
  if (!existsSync(root)) return [];
  const ids = readdirSync(root).filter((id) => {
    const full = join(root, id);
    return statSync(full).isDirectory();
  });
  const entries = ids.map((id) => {
    let manifest: BackupManifest | null = null;
    try {
      manifest = readBackupManifest(id);
    } catch {
      manifest = null;
    }
    return { backupId: id, manifest };
  });
  entries.sort((a, b) => {
    const aTs = a.manifest?.createdAt ?? "";
    const bTs = b.manifest?.createdAt ?? "";
    if (aTs && bTs) {
      const tsCmp = bTs.localeCompare(aTs);
      if (tsCmp !== 0) return tsCmp;
    }
    // Stable tiebreaker: `backupId` is `ISO-with-zero-padded-sequence` so
    // a plain lexicographic comparison yields strict insertion order. The
    // reverse ensures the LATEST backup (highest sequence) is first even
    // when two creates share the same millisecond `createdAt`.
    return b.backupId.localeCompare(a.backupId);
  });
  return entries;
}

/**
 * Apply retention policy.
 *
 * Semantics (design §2 backup retention + design §5 D4):
 *   - The latest 5 backups (newest-first by `createdAt`) are ALWAYS kept.
 *   - Anything beyond the latest 5 is pruned, unless explicitly protected
 *     by the caller.
 *   - The 30-day window documented in the design bounds how stale the
 *     "latest 5" can get; in normal operation a busy install rotates
 *     backups faster than 30 days, so the cap is what triggers pruning.
 *     The protection list lets `state.yaml` pin a specific backup (e.g.
 *     the one referenced by `activeOperation` or the latest failed /
 *     rolled_back history entry).
 */
export function applyRetention(
  protectedBackupIds: readonly string[] = [],
): { kept: string[]; pruned: string[] } {
  const backups = listBackups();
  const keepLatestCount = 5;
  const protectedSet = new Set(protectedBackupIds);

  const kept: string[] = [];
  const pruned: string[] = [];

  for (let i = 0; i < backups.length; i += 1) {
    const entry = backups[i]!;
    const isLatest = i < keepLatestCount;
    const isProtected = protectedSet.has(entry.backupId);

    if (isLatest || isProtected) {
      kept.push(entry.backupId);
    } else {
      pruned.push(entry.backupId);
      pruneBackup(entry.backupId);
    }
  }

  return { kept, pruned };
}

/**
 * Remove a backup directory from disk.
 */
export function pruneBackup(backupId: string): void {
  const dir = getBackupDir(backupId);
  if (!existsSync(dir)) return;
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch (err) {
    throw new BackupStoreError(
      BACKUP_ERROR_CODES.MANIFEST_FAILED,
      `Failed to prune backup ${backupId}: ${(err as Error).message}`,
      { backupId, cause: err },
    );
  }
}

/**
 * Return the most-recent backup manifest, or `null` if no backups exist.
 */
export function findLatestBackup(): BackupManifest | null {
  const list = listBackups();
  for (const entry of list) {
    if (entry.manifest) return entry.manifest;
  }
  return null;
}
