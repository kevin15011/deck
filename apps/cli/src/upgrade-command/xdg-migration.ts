/**
 * One-shot XDG migration of legacy `~/.config/.deck/` configuration.
 *
 * Implements `add-self-update-system` requirements:
 *   - REQ-XDG-004: migrate legacy `~/.config/.deck/` data to the new XDG split paths
 *   - REQ-XDG-005: one-shot and idempotent (marker file prevents re-execution)
 *   - REQ-XDG-006: preserve `packageInstructions`, `adaptiveMemory`,
 *     `orchestratorPersonality`, and `profiles`
 *   - REQ-XDG-007: abort on failure with a clear error
 *   - REQ-MIG-001: detect legacy and trigger migration before any other Deck op
 *   - REQ-MIG-002: create a full backup of `~/.config/.deck/` before moving
 *   - REQ-MIG-003: write the migration marker only after all steps succeed
 *
 * Design reference: `openspec/changes/add-self-update-system/design.md` §5 D6
 * and §6 (XDG migration failure keeps legacy files intact).
 */

import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

import {
  getDeckConfigDir,
  getDeckCacheDir,
  getDeckStateDir,
  getLegacyDeckConfigDir,
} from "../runtime/paths.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Error codes for the XDG migration. Aligned with spec §Error Contracts.
 */
export type XdgMigrationErrorCode =
  | "MIGRATION_FAILED"
  | "LEGACY_INVALID_JSON"
  | "LEGACY_BACKUP_FAILED"
  | "LEGACY_NOT_FOUND"
  | "MARKER_WRITE_FAILED"
  | "TARGET_DIR_CREATE_FAILED";

/**
 * Thrown when the legacy `~/.config/.deck/` → XDG migration aborts.
 *
 * `code` is the `MIGRATION_FAILED` family code from spec §Error Contracts.
 * The class carries the `backupPath` (legacy backup location) so callers can
 * surface the manual-recovery instructions from spec §Error Contracts.
 */
export class XdgMigrationError extends Error {
  readonly code: XdgMigrationErrorCode;
  readonly backupPath?: string;

  constructor(
    code: XdgMigrationErrorCode,
    message: string,
    options?: { backupPath?: string; cause?: unknown },
  ) {
    super(message);
    this.name = "XdgMigrationError";
    this.code = code;
    this.backupPath = options?.backupPath;
    if (options?.cause !== undefined) {
      this.cause = options.cause;
    }
  }
}

/** Summary of a successful migration. */
export type XdgMigrationResult = {
  /** Whether a migration actually happened in this invocation. */
  migrated: boolean;
  /** Path to the migration marker file (always written on success). */
  markerPath: string;
  /** Path to the full backup of the legacy directory, if one was created. */
  backupPath?: string;
  /** New XDG config directory. */
  newConfigDir: string;
  /** Legacy directory that was migrated (or skipped, if nothing to do). */
  legacyDir: string;
  /** Number of files that were moved/copied from legacy to new XDG layout. */
  movedFileCount: number;
};

/** Options for `migrateLegacyDeckConfig`. */
export type XdgMigrationOptions = {
  /** Override the default migration marker path. Mostly for tests. */
  markerPath?: string;
  /** Override the default backup directory. Mostly for tests. */
  backupDir?: string;
  /** Skip filesystem writes (validation only). Mostly for tests. */
  dryRun?: boolean;
  /** Force re-migration even if a marker already exists. */
  force?: boolean;
};

// ---------------------------------------------------------------------------
// Marker handling
// ---------------------------------------------------------------------------

/**
 * Default migration marker file location.
 *
 * The marker lives inside the new XDG state directory so it is detected
 * after a normal launch and is the single source of truth for "has migration
 * already run?".
 */
export function getMigrationMarkerPath(): string {
  return join(getDeckStateDir(), "xdg-migration.marker");
}

/**
 * Check whether the migration marker already exists.
 */
export function isMigrationComplete(markerPath: string = getMigrationMarkerPath()): boolean {
  return existsSync(markerPath);
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

/**
 * Detect whether the legacy `~/.config/.deck/` directory exists.
 *
 * Returns the absolute path of the legacy directory when present, otherwise
 * `undefined`. Used to short-circuit migration when no legacy data exists.
 */
export function detectLegacyDeckConfig(): string | undefined {
  const legacyDir = getLegacyDeckConfigDir();
  return existsSync(legacyDir) ? legacyDir : undefined;
}

// ---------------------------------------------------------------------------
// Migration core
// ---------------------------------------------------------------------------

const LEGACY_FILES_TO_MIGRATE = ["config.json", "config.yaml"] as const;

/**
 * Read the legacy `config.json` and validate it is parseable JSON.
 *
 * Spec REQ-XDG-007 requires migration to abort with a clear error if the
 * legacy file is corrupted.
 */
function readLegacyConfigJson(legacyConfigPath: string): Record<string, unknown> {
  let text: string;
  try {
    text = readFileSync(legacyConfigPath, "utf-8");
  } catch (err) {
    throw new XdgMigrationError(
      "LEGACY_NOT_FOUND",
      `Could not read legacy config: ${(err as Error).message}`,
      { cause: err },
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new XdgMigrationError(
      "LEGACY_INVALID_JSON",
      `Legacy config is not valid JSON: ${(err as Error).message}. Backup will be retained at the legacy directory.`,
      { cause: err },
    );
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new XdgMigrationError(
      "LEGACY_INVALID_JSON",
      "Legacy config must be a JSON object (top-level).",
    );
  }

  return parsed as Record<string, unknown>;
}

/**
 * Validate that all required user-choice fields are preserved through the
 * migration. Spec REQ-XDG-006 lists `packageInstructions`, `adaptiveMemory`,
 * `orchestratorPersonality`, and `profiles`. We surface a clear error when any
 * of these top-level keys present in the source is missing from the target.
 */
function assertUserChoicesPreserved(
  source: Record<string, unknown>,
  target: Record<string, unknown>,
): void {
  const required = [
    "packageInstructions",
    "adaptiveMemory",
    "orchestratorPersonality",
    "profiles",
  ];

  const missing: string[] = [];
  for (const key of required) {
    if (key in source && !(key in target)) {
      missing.push(key);
    }
  }

  if (missing.length > 0) {
    throw new XdgMigrationError(
      "MIGRATION_FAILED",
      `Migration would lose required fields: ${missing.join(", ")}`,
    );
  }
}

/**
 * One-shot migration from `~/.config/.deck/` to the new XDG layout.
 *
 * Behavior:
 *   - If the legacy directory does not exist: write the marker (idempotent) and
 *     return `{ migrated: false }`.
 *   - If the marker already exists (and `force` is not set): return
 *     `{ migrated: false }`.
 *   - Otherwise: copy the legacy directory to a timestamped backup, move the
 *     user-known files into the new XDG layout, validate user choices were
 *     preserved, then write the migration marker.
 *
 * Throws `XdgMigrationError` on any failure. The legacy directory and backup
 * are NEVER removed on failure (spec §6).
 */
export function migrateLegacyDeckConfig(
  options: XdgMigrationOptions = {},
): XdgMigrationResult {
  const markerPath = options.markerPath ?? getMigrationMarkerPath();
  const newConfigDir = getDeckConfigDir();
  const newStateDir = getDeckStateDir();
  const newCacheDir = getDeckCacheDir();
  const legacyDir = getLegacyDeckConfigDir();

  // Idempotency: marker wins.
  if (!options.force && existsSync(markerPath)) {
    return {
      migrated: false,
      markerPath,
      newConfigDir,
      legacyDir,
      movedFileCount: 0,
    };
  }

  // Nothing to migrate: write the marker and exit (idempotent on bare
  // installs).
  const detected = detectLegacyDeckConfig();
  if (detected === undefined) {
    if (!options.dryRun) {
      try {
        mkdirSync(newStateDir, { recursive: true });
        writeFileSync(
          markerPath,
          JSON.stringify(
            {
              schemaVersion: 1,
              migrated: false,
              reason: "no-legacy-config",
              completedAt: new Date().toISOString(),
            },
            null,
            2,
          ) + "\n",
          "utf-8",
        );
      } catch (err) {
        throw new XdgMigrationError(
          "MARKER_WRITE_FAILED",
          `Failed to write migration marker: ${(err as Error).message}`,
          { cause: err },
        );
      }
    }
    return {
      migrated: false,
      markerPath,
      newConfigDir,
      legacyDir,
      movedFileCount: 0,
    };
  }

  // --- Backup before mutating (REQ-MIG-002) ------------------------------
  // We copy the legacy directory to a timestamped backup, leaving the legacy
  // dir intact for the subsequent file-move step. The backup is what
  // guarantees a safe rollback if anything goes wrong after this point.
  const backupRoot =
    options.backupDir ?? join(getDeckCacheDir(), "backups", "xdg-migration");
  const backupId = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = join(backupRoot, backupId);

  try {
    if (!options.dryRun) {
      mkdirSync(backupPath, { recursive: true });
      // Recursive copy — preserves the full legacy directory state.
      cpSync(legacyDir, backupPath, { recursive: true, dereference: false });
    }
  } catch (err) {
    throw new XdgMigrationError(
      "LEGACY_BACKUP_FAILED",
      `Failed to back up legacy config directory: ${(err as Error).message}`,
      { backupPath, cause: err },
    );
  }

  // --- Move known files into the new XDG layout -------------------------
  let movedFileCount = 0;
  try {
    if (!options.dryRun) {
      mkdirSync(newConfigDir, { recursive: true });
      mkdirSync(newStateDir, { recursive: true });
      mkdirSync(newCacheDir, { recursive: true });
    }

    for (const fileName of LEGACY_FILES_TO_MIGRATE) {
      const sourcePath = join(legacyDir, fileName);
      if (!existsSync(sourcePath)) continue;

      const targetPath = join(newConfigDir, fileName);
      if (existsSync(targetPath)) {
        // Don't clobber: keep the target's value but still count the file
        // as "migrated metadata".
        movedFileCount += 1;
        continue;
      }

      if (!options.dryRun) {
        // Copy from legacy (which is still intact) to the new XDG location.
        // After this, both legacy and backup contain the original file.
        cpSync(sourcePath, targetPath);
        // Now safe to remove the legacy file; the backup is the source of truth.
        rmSync(sourcePath, { force: true });
      }
      movedFileCount += 1;
    }
  } catch (err) {
    throw new XdgMigrationError(
      "MIGRATION_FAILED",
      `Failed to migrate legacy files into XDG layout: ${(err as Error).message}. Legacy backup retained at ${backupPath}.`,
      { backupPath, cause: err },
    );
  }

  // --- Validate preservation of user choices (REQ-XDG-006) --------------
  // Only run validation when this invocation actually moved a file. A re-run
  // on an already-migrated legacy directory would try to read the original
  // file from a backup that no longer has it.
  if (!options.dryRun && movedFileCount > 0 && existsSync(join(newConfigDir, "config.json"))) {
    const sourceOriginal = readLegacyConfigJson(join(backupPath, "config.json"));
    const targetText = readFileSync(join(newConfigDir, "config.json"), "utf-8");
    const targetOriginal = JSON.parse(targetText) as Record<string, unknown>;
    assertUserChoicesPreserved(sourceOriginal, targetOriginal);
  }

  // --- Write migration marker only after full success (REQ-MIG-003) ----
  // `migrated: true` requires that at least one file was actually moved. A
  // re-run where the legacy dir still exists but its files have already been
  // moved (e.g. after a `force: true` re-invocation) is recorded as a
  // no-op migration so the marker does not lie about file movement.
  const actuallyMigrated = movedFileCount > 0;
  try {
    if (!options.dryRun) {
      mkdirSync(newStateDir, { recursive: true });
      writeFileSync(
        markerPath,
        JSON.stringify(
          {
            schemaVersion: 1,
            migrated: actuallyMigrated,
            backupPath: actuallyMigrated ? backupPath : undefined,
            movedFileCount,
            completedAt: new Date().toISOString(),
          },
          null,
          2,
        ) + "\n",
        "utf-8",
      );
    }
  } catch (err) {
    throw new XdgMigrationError(
      "MARKER_WRITE_FAILED",
      `Migration succeeded but marker write failed: ${(err as Error).message}. Backup retained at ${backupPath}.`,
      { backupPath, cause: err },
    );
  }

  return {
    migrated: actuallyMigrated,
    markerPath,
    backupPath: actuallyMigrated ? backupPath : undefined,
    newConfigDir,
    legacyDir,
    movedFileCount,
  };
}

/**
 * Internal helper used only by tests to clear migration side effects
 * (marker file and any backups in the test directory).
 *
 * @internal
 */
export function _clearXdgMigrationForTests(removeDirs: string[]): void {
  for (const dir of removeDirs) {
    try {
      if (existsSync(dir)) {
        rmSync(dir, { recursive: true, force: true });
      }
    } catch {
      // Best-effort cleanup; tests run on tmpfs.
    }
  }
}
