/**
 * Rollback orchestration.
 *
 * Reads the most-recent backup manifest, restores every file (reversing the
 * order so the most recently mutated files are unwound first), and updates
 * `state.yaml` to reflect the rolled-back version. Also exposes a CLI
 * helper for `deck rollback` that does the same end-to-end and is wired
 * into the upgrade command's runner.
 *
 * Design reference: `openspec/changes/add-self-update-system/design.md` §2
 * ("Backup schemas"), §3 ("rollback flow"), and §4 ("File Impact").
 *
 * REQ-RBK-001, REQ-RBK-003, REQ-RBK-004, REQ-RBK-005.
 */

import { existsSync } from "node:fs";

import {
  applyRetention,
  findLatestBackup,
  getBackupDir,
  listBackups,
  readBackupManifest,
  restoreBackup,
  type BackupManifest,
} from "./backup-store.js";
import {
  appendHistory,
  buildDefaultState,
  clearActiveOperation,
  DeckUpdateStateSchema,
  readState,
  releaseLock,
  writeState,
  type DeckUpdateState,
} from "./state-store.js";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export const ROLLBACK_ERROR_CODES = {
  /** No backup directory exists to roll back to. */
  NOT_FOUND: "ROLLBACK_NOT_FOUND",
  /** Backup manifest is present but invalid. */
  INVALID: "ROLLBACK_INVALID",
  /** Backup is protected (referenced by active state) and cannot be removed. */
  PROTECTED: "ROLLBACK_PROTECTED",
} as const;

export type RollbackErrorCode =
  (typeof ROLLBACK_ERROR_CODES)[keyof typeof ROLLBACK_ERROR_CODES];

export class RollbackError extends Error {
  readonly code: RollbackErrorCode;
  readonly backupId?: string;

  constructor(
    code: RollbackErrorCode,
    message: string,
    options?: { backupId?: string; cause?: unknown },
  ) {
    super(message);
    this.name = "RollbackError";
    this.code = code;
    this.backupId = options?.backupId;
    if (options?.cause !== undefined) {
      this.cause = options.cause;
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type RollbackResult = {
  /** The backup that was restored. */
  backupId: string;
  /** The Deck version recorded in the rolled-back state. */
  rolledBackFrom: string;
  rolledBackTo: string;
  /** Files that were restored from backup. */
  restoredCount: number;
  /** Files that were created by the failed operation and removed. */
  deletedCount: number;
  /** Retention summary that may have pruned older backups. */
  retention: { kept: string[]; pruned: string[] };
};

/**
 * Options for `rollbackLatest`.
 */
export type RollbackOptions = {
  /** Force rollback even if the backup is referenced by `state.yaml`. */
  force?: boolean;
  /** The Deck version to record in the rolled-back state. */
  rolledBackToVersion?: string;
  /** Project root (for runner adapter rollback). */
  projectRoot?: string;
};

/**
 * Roll back the most-recent successful backup.
 *
 * Behavior:
 *   1. Read `state.yaml` (or use a default if missing).
 *   2. Find the most-recent backup manifest.
 *   3. Restore every file in the manifest in reverse order.
 *   4. Update `state.yaml`: clear active operation, set `currentVersion`
 *      to the version recorded in the backup, and append a `rolled_back`
 *      history entry.
 *   5. Apply retention policy (keep latest 5 + protected).
 *
 * Throws `RollbackError` with `NOT_FOUND` when no backup is available.
 */
export function rollbackLatest(
  currentVersion: string,
  options: RollbackOptions = {},
): RollbackResult {
  const latest = findLatestBackup();
  if (!latest) {
    throw new RollbackError(
      ROLLBACK_ERROR_CODES.NOT_FOUND,
      "No backup is available to roll back to.",
    );
  }
  return rollbackBackup(latest, currentVersion, options);
}

/**
 * Roll back a specific backup by id.
 */
export function rollbackBackup(
  manifest: BackupManifest,
  currentVersion: string,
  options: RollbackOptions = {},
): RollbackResult {
  const { backupId } = manifest;
  const state = safeReadState(currentVersion);
  if (state.activeOperation?.backupId === backupId && !options.force) {
    throw new RollbackError(
      ROLLBACK_ERROR_CODES.PROTECTED,
      `Backup ${backupId} is referenced by the active operation. Pass force=true to roll back anyway.`,
      { backupId },
    );
  }

  const stats = restoreBackup(backupId);

  const rolledBackTo = options.rolledBackToVersion ?? manifest.deckVersionBefore;
  const nextState: DeckUpdateState = {
    ...state,
    currentVersion: rolledBackTo,
    activeOperation: undefined,
  };
  const cleared = releaseLock(clearActiveOperation(nextState));
  const validated = DeckUpdateStateSchema.parse(cleared);
  writeState(validated);

  // Append a rolled_back history entry (best-effort — history writes are
  // not fatal because the rollback itself has already succeeded).
  try {
    appendHistory(validated, {
      operationId: manifest.operationId,
      backupId,
      result: "rolled_back",
      previousVersion: currentVersion,
      rolledBackTo,
    });
  } catch {
    // Ignore history write failures; rollback is the priority.
  }

  // Apply retention after rollback so the rolled-back backup stays
  // protected (it's now the only one we have).
  const retention = applyRetention([backupId]);

  return {
    backupId,
    rolledBackFrom: manifest.targetVersion ?? manifest.deckVersionBefore,
    rolledBackTo,
    restoredCount: stats.restored,
    deletedCount: stats.deleted,
    retention: { kept: retention.kept, pruned: retention.pruned },
  };
}

function safeReadState(currentVersion: string): DeckUpdateState {
  try {
    return readState(currentVersion);
  } catch {
    return buildDefaultState(currentVersion);
  }
}

// ---------------------------------------------------------------------------
// CLI helper
// ---------------------------------------------------------------------------

/**
 * Resolve the latest backup manifest, or `null` when none exists.
 *
 * Exposed for CLI / TUI surfaces that need to know "is there something to
 * roll back to?".
 */
export function resolveLatestBackupForCli(): BackupManifest | null {
  return findLatestBackup();
}

/**
 * List backup ids in newest-first order.
 */
export function listBackupIdsForCli(): readonly string[] {
  return listBackups().map((entry) => entry.backupId);
}

/**
 * Resolve a backup directory path by id. Exposed for diagnostics.
 */
export function resolveBackupDirForCli(backupId: string): string {
  return getBackupDir(backupId);
}

/**
 * Indicate whether a backup id is present on disk.
 */
export function backupExists(backupId: string): boolean {
  return existsSync(getBackupDir(backupId));
}

/**
 * Read a backup manifest by id without mutating anything.
 */
export function loadBackupManifest(backupId: string): BackupManifest {
  return readBackupManifest(backupId);
}
