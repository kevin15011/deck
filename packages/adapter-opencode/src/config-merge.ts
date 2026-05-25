/**
 * Safe read/merge/write for `~/.config/opencode/opencode.json`.
 *
 * Algorithm:
 * 1. readConfig   — parse existing JSON (or {} if absent)
 * 2. backupConfig — write timestamped copy before any write
 * 3. mergeConfig  — inject agent entries + plugin entries, preserve rest
 * 4. writeConfigAtomic — temp-file-then-rename
 * 5. validateConfig — re-read and parse to verify valid JSON
 * 6. on validation failure: restore backup, throw
 */

import { dirname, join } from "node:path";
import type { AgentEntry, OpenCodeConfig } from "./types";

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export class ConfigMergeError extends Error {
  readonly code: "READ" | "WRITE" | "VALIDATION" | "BACKUP";
  constructor(code: ConfigMergeError["code"], message: string) {
    super(message);
    this.name = "ConfigMergeError";
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MergeOptions = {
  configPath: string;
  agentEntries: Record<string, AgentEntry>;
  pluginsToAdd?: string[];
  readFile?: (path: string, encoding: "utf-8") => string;
  writeFile?: (path: string, content: string) => void;
  renameFile?: (from: string, to: string) => void;
  exists?: (path: string) => boolean;
  now?: () => Date;
};

export type MergeResult = {
  status: "created" | "updated" | "unchanged";
  backupPath: string;
  agentKeysWritten: string[];
  pluginsAdded: string[];
};

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export function readConfig(configPath: string, readFile?: (path: string, encoding: "utf-8") => string): OpenCodeConfig {
  const read = readFile ?? defaultReadFile;
  try {
    const content = read(configPath, "utf-8");
    if (content.trim() === "") return {};
    return JSON.parse(content) as OpenCodeConfig;
  } catch (error) {
    if (error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new ConfigMergeError("READ", `Failed to read opencode.json: ${message}`);
  }
}

function defaultReadFile(path: string, _encoding: "utf-8"): string {
  // lazy import to avoid circular — caller provides DI in tests
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("node:fs").readFileSync(path, "utf-8");
}

// ---------------------------------------------------------------------------
// Backup
// ---------------------------------------------------------------------------

export function backupConfig(
  configPath: string,
  writeFile?: (path: string, content: string) => void,
  now?: () => Date,
): string {
  const write = writeFile ?? defaultWriteFile;
  const timeProvider = now ?? (() => new Date());
  const timestamp = timeProvider().toISOString().replace(/[:.]/g, "-");
  const backupPath = `${configPath}.bak.${timestamp}`;
  try {
    const content = defaultReadFile(configPath, "utf-8");
    write(backupPath, content);
  } catch (error) {
    if (error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT") {
      // No existing file — nothing to backup
    } else {
      throw new ConfigMergeError("BACKUP", `Failed to create backup: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return backupPath;
}

function defaultWriteFile(path: string, content: string): void {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("node:fs").writeFileSync(path, content, "utf-8");
}

// ---------------------------------------------------------------------------
// Merge
// ---------------------------------------------------------------------------

export function mergeConfig(
  existing: OpenCodeConfig,
  agentEntries: Record<string, AgentEntry>,
  pluginsToAdd: string[] = [],
): OpenCodeConfig {
  // Deep clone to avoid mutation
  const merged: OpenCodeConfig = JSON.parse(JSON.stringify(existing));

  // Ensure agent object exists
  if (merged.agent === undefined || merged.agent === null) {
    merged.agent = {};
  }

  // Inject agent entries under deck-developer-* keys only (replace-by-key)
  for (const [key, entry] of Object.entries(agentEntries)) {
    merged.agent[key] = entry;
  }

  // Ensure plugin array exists
  if (!Array.isArray(merged.plugin)) {
    merged.plugin = [];
  }

  // Append plugins if not already present
  for (const plugin of pluginsToAdd) {
    if (!merged.plugin.includes(plugin)) {
      merged.plugin.push(plugin);
    }
  }

  return merged;
}

// ---------------------------------------------------------------------------
// Atomic Write
// ---------------------------------------------------------------------------

export function writeConfigAtomic(
  configPath: string,
  content: string,
  writeFile?: (path: string, content: string) => void,
  renameFile?: (from: string, to: string) => void,
): void {
  const write = writeFile ?? defaultWriteFile;
  const rename = renameFile ?? defaultRenameFile;
  const tmpPath = `${configPath}.tmp`;

  try {
    write(tmpPath, content);
    rename(tmpPath, configPath);
  } catch (error) {
    // Clean up temp file on failure
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require("node:fs").unlinkSync(tmpPath);
    } catch {
      // ignore cleanup failure
    }
    throw new ConfigMergeError("WRITE", `Failed to write config: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function defaultRenameFile(from: string, to: string): void {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("node:fs").renameSync(from, to);
}

// ---------------------------------------------------------------------------
// Validate
// ---------------------------------------------------------------------------

export function validateConfig(configPath: string, readFile?: (path: string, encoding: "utf-8") => string): OpenCodeConfig {
  const read = readFile ?? defaultReadFile;
  try {
    const content = read(configPath, "utf-8");
    return JSON.parse(content) as OpenCodeConfig;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ConfigMergeError("VALIDATION", `Post-write validation failed: ${message}`);
  }
}

// ---------------------------------------------------------------------------
// Rollback
// ---------------------------------------------------------------------------

export function rollbackConfig(backupPath: string, configPath: string): void {
  try {
    defaultRenameFile(backupPath, configPath);
  } catch (error) {
    // Rollback failure is catastrophic — surface it
    throw new ConfigMergeError("BACKUP", `Rollback failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// ---------------------------------------------------------------------------
// High-level merge-and-write
// ---------------------------------------------------------------------------

export function mergeAndWrite(options: MergeOptions): MergeResult {
  const { configPath, agentEntries, pluginsToAdd = [] } = options;
  const readFile = options.readFile ?? defaultReadFile;
  const writeFile = options.writeFile ?? defaultWriteFile;
  const renameFile = options.renameFile ?? defaultRenameFile;
  const exists = options.exists ?? defaultExists;

  // 1. Read existing config
  const existing = readConfig(configPath, readFile);

  // Detect whether config is new or existing
  const isNew = !exists(configPath);

  // 2. Backup (only if file exists)
  const backupPath = backupConfig(configPath, writeFile, options.now);

  // 3. Merge
  const merged = mergeConfig(existing, agentEntries, pluginsToAdd);

  // 4. Check if content actually changed
  const newContent = JSON.stringify(merged, null, 2);
  const existingContent = Object.keys(existing).length > 0 ? JSON.stringify(existing, null, 2) : null;
  const contentChanged = existingContent !== newContent;

  // 5. Atomic write (only if content changed)
  if (contentChanged) {
    writeConfigAtomic(configPath, newContent, writeFile, renameFile);
  }

  // 6. Post-write validation
  if (contentChanged) {
    try {
      validateConfig(configPath, readFile);
    } catch (error) {
      // Rollback on validation failure
      if (backupPath && exists(backupPath)) {
        try {
          rollbackConfig(backupPath, configPath);
        } catch {
          // Rollback itself failed — surface original error
        }
      }
      throw error;
    }
  }

  return {
    status: contentChanged ? (isNew ? "created" : "updated") : "unchanged",
    backupPath,
    agentKeysWritten: Object.keys(agentEntries),
    pluginsAdded: pluginsToAdd,
  };
}

function defaultExists(path: string): boolean {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("node:fs").existsSync(path);
}