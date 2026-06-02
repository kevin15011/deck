/**
 * Manifest store for the self-update system.
 *
 * Implements `manifest.json` under `$XDG_STATE_HOME/deck/manifest.json`.
 * The manifest is the Deck-owned file inventory used for rollback and
 * drift detection. Each entry records:
 *   - The absolute path of a file Deck wrote.
 *   - The owning adapter (`deck` or `runner:<id>`).
 *   - A SHA-256 checksum of the file at write time.
 *   - The Deck version that produced the file.
 *   - A `kind` that drives rollback semantics.
 *
 * Design reference: `openspec/changes/add-self-update-system/design.md` §2
 * ("Schemas → manifest.json — `~/.local/state/deck/manifest.json`").
 *
 * Migration strategy:
 *   - `schemaVersion` migrates one version at a time through pure functions
 *     (`migrateManifestV1ToV2`, etc.).
 *   - On schema upgrade, the pre-migration file is copied to
 *     `$XDG_CACHE_HOME/deck/backups/<ts>/manifest.pre-migration.json`.
 *   - The new manifest is written to `manifest.json.tmp` and then atomically
 *     renamed to `manifest.json`.
 *   - Unknown future schemaVersion values are rejected with
 *     `MANIFEST_UNSUPPORTED_FUTURE_SCHEMA`.
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";

import { z } from "zod";

import { getDeckXdgPaths } from "../runtime/paths.js";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

/** Current manifest schema version. */
export const CURRENT_MANIFEST_SCHEMA_VERSION = 2;

/** Set of supported manifest schema versions. */
export const SUPPORTED_MANIFEST_SCHEMA_VERSIONS = [1, 2] as const;
export type SupportedManifestSchemaVersion =
  (typeof SUPPORTED_MANIFEST_SCHEMA_VERSIONS)[number];

const Sha256ValueSchema = z.string().regex(/^[a-f0-9]{64}$/);

export const ManifestOwnerSchema = z.union([
  z.enum(["deck", "runner:pi", "runner:opencode"]),
  z.string().regex(/^runner:/),
]);
export type ManifestOwner = z.infer<typeof ManifestOwnerSchema>;

export const ManifestFileKindSchema = z.enum([
  "binary",
  "config",
  "prompt",
  "skill",
  "subagent",
  "mcp",
  "state",
  "content",
]);
export type ManifestFileKind = z.infer<typeof ManifestFileKindSchema>;

export const ManifestFileSchema = z.object({
  path: z.string().min(1),
  owner: ManifestOwnerSchema,
  checksum: z.object({
    algorithm: z.literal("sha256"),
    value: Sha256ValueSchema,
  }),
  deck_version: z.string().min(1),
  kind: ManifestFileKindSchema,
  sourceItemId: z.string().optional(),
  lastWrittenAt: z.string().datetime(),
});
export type ManifestFile = z.infer<typeof ManifestFileSchema>;

/**
 * v2 manifest schema (current).
 * Source: design.md §2 "manifest.json — `~/.local/state/deck/manifest.json`".
 */
export const ManifestJsonV2Schema = z.object({
  schemaVersion: z.literal(2),
  generatedAt: z.string().datetime(),
  deckVersion: z.string().min(1),
  files: z.array(ManifestFileSchema),
});
export type ManifestJsonV2 = z.infer<typeof ManifestJsonV2Schema>;

/**
 * v1 manifest schema (legacy) — minimal shape that may exist on disk for
 * upgrades predating `add-self-update-system`. We accept the bare minimum
 * (path + checksum) and produce a v2 entry on migration.
 */
export const ManifestFileV1Schema = z.object({
  path: z.string().min(1),
  owner: z.string().optional(),
  checksum: z
    .object({
      algorithm: z.string().optional(),
      value: z.string().optional(),
    })
    .optional(),
  deckVersion: z.string().optional(),
  deck_version: z.string().optional(),
  kind: z.string().optional(),
});
export type ManifestFileV1 = z.infer<typeof ManifestFileV1Schema>;

export const ManifestJsonV1Schema = z.object({
  schemaVersion: z.literal(1),
  generatedAt: z.string().optional(),
  deckVersion: z.string().optional(),
  files: z.array(ManifestFileV1Schema),
});
export type ManifestJsonV1 = z.infer<typeof ManifestJsonV1Schema>;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export const MANIFEST_ERROR_CODES = {
  /** Manifest file is present but the schemaVersion is from a future build. */
  UNSUPPORTED_FUTURE_SCHEMA: "MANIFEST_UNSUPPORTED_FUTURE_SCHEMA",
  /** Manifest file is present but invalid JSON or schema. */
  INVALID: "MANIFEST_INVALID",
  /** Atomic write of the manifest failed. */
  WRITE_FAILED: "MANIFEST_WRITE_FAILED",
  /** Migration to a newer schema version failed. */
  MIGRATION_FAILED: "MANIFEST_MIGRATION_FAILED",
} as const;

export type ManifestErrorCode =
  (typeof MANIFEST_ERROR_CODES)[keyof typeof MANIFEST_ERROR_CODES];

export class ManifestStoreError extends Error {
  readonly code: ManifestErrorCode;
  readonly path?: string;

  constructor(
    code: ManifestErrorCode,
    message: string,
    options?: { path?: string; cause?: unknown },
  ) {
    super(message);
    this.name = "ManifestStoreError";
    this.code = code;
    this.path = options?.path;
    if (options?.cause !== undefined) {
      this.cause = options.cause;
    }
  }
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the absolute path of the manifest file under the XDG state dir.
 */
export function getManifestPath(): string {
  return getDeckXdgPaths().manifestPath;
}

// ---------------------------------------------------------------------------
// Migration
// ---------------------------------------------------------------------------

/**
 * Pure function: migrate a v1 manifest to v2.
 *
 * - All v1 entries are mapped to v2 entries with the strict shape.
 * - Missing `checksum.value` produces an "unmanaged" entry that the rest
 *   of the system treats as no-op (it gets re-checksummed on next write).
 * - `deckVersion` falls back to `deck_version` then to "unknown".
 * - `lastWrittenAt` is recorded as the migration time so consumers can
 *   tell when each entry last changed.
 */
export function migrateManifestV1ToV2(
  v1: ManifestJsonV1,
  migrationTime: Date = new Date(),
): ManifestJsonV2 {
  const v2Files: ManifestFile[] = [];
  for (const entry of v1.files) {
    const checksum = entry.checksum?.value && /^[a-f0-9]{64}$/.test(entry.checksum.value)
      ? { algorithm: "sha256" as const, value: entry.checksum.value }
      : { algorithm: "sha256" as const, value: "0".repeat(64) };
    const owner: ManifestOwner = (entry.owner && /^runner:|^deck$/.test(entry.owner))
      ? (entry.owner as ManifestOwner)
      : "deck";
    const kind: ManifestFileKind = ((): ManifestFileKind => {
      switch (entry.kind) {
        case "binary":
        case "config":
        case "prompt":
        case "skill":
        case "subagent":
        case "mcp":
        case "state":
        case "content":
          return entry.kind;
        default:
          return "content";
      }
    })();
    v2Files.push({
      path: entry.path,
      owner,
      checksum,
      deck_version: entry.deck_version ?? entry.deckVersion ?? "unknown",
      kind,
      lastWrittenAt: migrationTime.toISOString(),
    });
  }
  return {
    schemaVersion: 2,
    generatedAt: migrationTime.toISOString(),
    deckVersion: v1.deckVersion ?? v1.files[0]?.deck_version ?? v1.files[0]?.deckVersion ?? "unknown",
    files: v2Files,
  };
}

// ---------------------------------------------------------------------------
// Default manifest
// ---------------------------------------------------------------------------

/**
 * Build an empty v2 manifest for fresh installs.
 */
export function buildDefaultManifest(deckVersion: string): ManifestJsonV2 {
  return {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    deckVersion,
    files: [],
  };
}

// ---------------------------------------------------------------------------
// Read / write (atomic)
// ---------------------------------------------------------------------------

type AnyManifest = ManifestJsonV1 | ManifestJsonV2;

/**
 * Read the manifest from disk. If the file is missing, returns a default
 * empty manifest for the supplied version. Throws on malformed content or
 * a schema version newer than `CURRENT_MANIFEST_SCHEMA_VERSION`.
 *
 * If a v1 manifest is on disk, it is migrated to v2 in-memory AND a
 * backup is written under `$XDG_CACHE_HOME/deck/backups/<ts>/manifest.pre-migration.json`
 * before the v2 manifest is atomically written back to disk.
 */
export function readManifest(deckVersion: string): ManifestJsonV2 {
  const path = getManifestPath();
  if (!existsSync(path)) {
    return buildDefaultManifest(deckVersion);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf-8"));
  } catch (err) {
    throw new ManifestStoreError(
      MANIFEST_ERROR_CODES.INVALID,
      `Manifest is not valid JSON: ${(err as Error).message}`,
      { path, cause: err },
    );
  }

  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new ManifestStoreError(
      MANIFEST_ERROR_CODES.INVALID,
      "Manifest must be a JSON object at the top level.",
      { path },
    );
  }

  const version = (raw as { schemaVersion?: unknown }).schemaVersion;
  if (version !== 1 && version !== 2) {
    if (typeof version === "number" && version > CURRENT_MANIFEST_SCHEMA_VERSION) {
      throw new ManifestStoreError(
        MANIFEST_ERROR_CODES.UNSUPPORTED_FUTURE_SCHEMA,
        `Manifest schemaVersion=${version} is from a newer Deck; refusing to read.`,
        { path },
      );
    }
    throw new ManifestStoreError(
      MANIFEST_ERROR_CODES.INVALID,
      `Manifest schemaVersion=${String(version)} is not supported.`,
      { path },
    );
  }

  if (version === 2) {
    const result = ManifestJsonV2Schema.safeParse(raw);
    if (!result.success) {
      throw new ManifestStoreError(
        MANIFEST_ERROR_CODES.INVALID,
        `Manifest failed schema validation: ${result.error.message}`,
        { path, cause: result.error },
      );
    }
    return result.data;
  }

  // v1 → migrate in memory and persist the migrated copy.
  const v1 = ManifestJsonV1Schema.safeParse(raw);
  if (!v1.success) {
    throw new ManifestStoreError(
      MANIFEST_ERROR_CODES.INVALID,
      `v1 manifest failed schema validation: ${v1.error.message}`,
      { path, cause: v1.error },
    );
  }
  const migrated = migrateManifestV1ToV2(v1.data);
  try {
    backupPreMigrationManifest(path);
  } catch (err) {
    throw new ManifestStoreError(
      MANIFEST_ERROR_CODES.MIGRATION_FAILED,
      `Failed to back up pre-migration manifest: ${(err as Error).message}`,
      { path, cause: err },
    );
  }
  try {
    writeManifest(migrated);
  } catch (err) {
    throw new ManifestStoreError(
      MANIFEST_ERROR_CODES.MIGRATION_FAILED,
      `Failed to persist migrated manifest: ${(err as Error).message}`,
      { path, cause: err },
    );
  }
  return migrated;
}

/**
 * Write the manifest atomically. The new payload is written to
 * `<path>.tmp-<pid>-<ts>` and then renamed over the destination.
 */
export function writeManifest(manifest: ManifestJsonV2): void {
  const path = getManifestPath();
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  const tmpPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  try {
    writeFileSync(tmpPath, JSON.stringify(manifest, null, 2) + "\n", "utf-8");
    renameSync(tmpPath, path);
  } catch (err) {
    try {
      if (existsSync(tmpPath)) unlinkSync(tmpPath);
    } catch {
      // best-effort cleanup
    }
    throw new ManifestStoreError(
      MANIFEST_ERROR_CODES.WRITE_FAILED,
      `Failed to write manifest: ${(err as Error).message}`,
      { path, cause: err },
    );
  }
}

function backupPreMigrationManifest(manifestPath: string): void {
  const cache = getDeckXdgPaths();
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const backupDir = join(cache.backupsDir, `manifest-migration-${ts}`);
  mkdirSync(backupDir, { recursive: true });
  copyFileSync(manifestPath, join(backupDir, "manifest.pre-migration.json"));
}

// ---------------------------------------------------------------------------
// File management helpers
// ---------------------------------------------------------------------------

/**
 * Compute a SHA-256 checksum of a file. The hash is used to populate
 * `ManifestFile.checksum` so rollback can verify integrity.
 */
export function computeManifestFileSha256(filePath: string): string {
  const hash = createHash("sha256");
  hash.update(readFileSync(filePath));
  return hash.digest("hex");
}

/**
 * Add or update a single file entry in the manifest. Re-checksums the file
 * on disk so the entry reflects the current contents.
 */
export function upsertManifestFile(
  manifest: ManifestJsonV2,
  entry: Omit<ManifestFile, "checksum" | "lastWrittenAt"> & {
    checksum?: { algorithm: "sha256"; value: string };
  },
  deckVersion: string,
): ManifestJsonV2 {
  const checksum = entry.checksum ?? {
    algorithm: "sha256" as const,
    value: computeManifestFileSha256(entry.path),
  };
  const fullEntry: ManifestFile = {
    ...entry,
    checksum,
    lastWrittenAt: new Date().toISOString(),
  };
  const next = manifest.files.filter((f) => f.path !== entry.path);
  next.push(fullEntry);
  return {
    ...manifest,
    generatedAt: new Date().toISOString(),
    deckVersion,
    files: next,
  };
}

/**
 * Remove a file entry from the manifest. Does NOT touch the file on disk.
 */
export function removeManifestFile(
  manifest: ManifestJsonV2,
  path: string,
): ManifestJsonV2 {
  return {
    ...manifest,
    files: manifest.files.filter((f) => f.path !== path),
  };
}

/**
 * Detect drift between the manifest and the actual files on disk. Returns
 * a summary of mismatches: files that are missing, files that have changed
 * since the manifest was last written, and files in the manifest that no
 * longer exist on disk.
 */
export function detectManifestDrift(
  manifest: ManifestJsonV2,
): {
  missing: readonly string[];
  changed: readonly { path: string; expected: string; actual: string }[];
  ok: readonly string[];
} {
  const missing: string[] = [];
  const changed: { path: string; expected: string; actual: string }[] = [];
  const ok: string[] = [];
  for (const file of manifest.files) {
    if (!existsSync(file.path)) {
      missing.push(file.path);
      continue;
    }
    const actual = computeManifestFileSha256(file.path);
    if (actual !== file.checksum.value) {
      changed.push({ path: file.path, expected: file.checksum.value, actual });
    } else {
      ok.push(file.path);
    }
  }
  return { missing, changed, ok };
}

// ---------------------------------------------------------------------------
// Cleanup (used by retention step)
// ---------------------------------------------------------------------------

/**
 * Best-effort cleanup helper used by orchestrator test suites. Removes the
 * manifest file from disk. Tests should call this in their teardown.
 */
export function _deleteManifestForTests(): void {
  const path = getManifestPath();
  if (existsSync(path)) {
    try {
      rmSync(path, { force: true });
    } catch {
      // best-effort
    }
  }
}
