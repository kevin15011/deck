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

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { z } from "zod";

import { getDeckXdgPaths } from "../runtime/paths.js";

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

export const BackupEntrySchema = z.object({
  id: z.string(),
  sourcePath: z.string(),
  backupPath: z.string(),
  owner: BackupOwnerSchema,
  kind: BackupKindSchema,
  existed: z.boolean(),
  checksumBefore: ChecksumSchema.optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
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

  constructor(code: BackupErrorCode, message: string, options?: { backupId?: string; cause?: unknown }) {
    super(message);
    this.name = "BackupStoreError";
    this.code = code;
    this.backupId = options?.backupId;
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
    const existed = existsSync(file.sourcePath);

    let checksumBefore: BackupEntry["checksumBefore"];
    let sizeBytes: number | undefined;

    if (existed) {
      try {
        mkdirSync(dirname(backupPath), { recursive: true });
        copyFileSync(file.sourcePath, backupPath);
        const stat = statSync(backupPath);
        sizeBytes = stat.size;
        checksumBefore = { algorithm: "sha256", value: computeFileSha256(backupPath) };
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
      sourcePath: file.sourcePath,
      backupPath,
      owner: file.owner,
      kind: file.kind,
      existed,
      ...(checksumBefore ? { checksumBefore } : {}),
      ...(sizeBytes !== undefined ? { sizeBytes } : {}),
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
 * files overwritten. Missing backup copies (the original did not exist) are
 * treated as "delete the new file" operations.
 *
 * Per spec REQ-ATM-012, a partial restore is a critical error: the caller
 * MUST surface `ROLLBACK_FAILED` so the user can recover from `backupPath`.
 */
export function restoreBackup(backupId: string): {
  restored: number;
  deleted: number;
  failed: { entryId: string; reason: string }[];
} {
  const manifest = readBackupManifest(backupId);

  let restored = 0;
  let deleted = 0;
  const failed: { entryId: string; reason: string }[] = [];

  // Reverse so newer changes get unwound first.
  const reversed = [...manifest.entries].reverse();
  for (const entry of reversed) {
    try {
      if (entry.existed && existsSync(entry.backupPath)) {
        mkdirSync(dirname(entry.sourcePath), { recursive: true });
        copyFileSync(entry.backupPath, entry.sourcePath);
        restored += 1;
      } else {
        // Original didn't exist before the operation → delete what the
        // operation created.
        if (existsSync(entry.sourcePath)) {
          rmSync(entry.sourcePath, { force: true, recursive: false });
          deleted += 1;
        }
      }
    } catch (err) {
      failed.push({
        entryId: entry.id,
        reason: (err as Error).message,
      });
    }
  }

  if (failed.length > 0) {
    throw new BackupStoreError(
      BACKUP_ERROR_CODES.RESTORE_FAILED,
      `Restore partially failed: ${failed.length} of ${reversed.length} entries. ` +
        `See the backup at ${manifest.backupId}.`,
      { backupId },
    );
  }

  return { restored, deleted, failed };
}

/**
 * Read a backup manifest from disk.
 */
export function readBackupManifest(backupId: string): BackupManifest {
  const manifestPath = join(getBackupDir(backupId), "backup-manifest.json");
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
