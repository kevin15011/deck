/**
 * State store for the self-update system.
 *
 * Persists `$XDG_STATE_HOME/deck/state.yaml` (or the resolved XDG state
 * directory) with the schema described in
 * `openspec/changes/add-self-update-system/design.md` §2.
 *
 * Responsibilities:
 *   - Atomic read/write via temp-file + rename.
 *   - Lock file with PID and stale-after detection (REQ-ATM-005, REQ-ATM-006).
 *   - `activeOperation` tracking for interrupted-state recovery.
 *   - `installHistory` JSONL append with rotation (latest 100 / ≤180 days).
 *
 * Future `schemaVersion` values are rejected with a read-only fail-safe so
 * older Deck versions never silently mutate state.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { z } from "zod";

import { getDeckXdgPaths } from "../runtime/paths.js";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const STALE_AFTER_SECONDS = 900; // 15 minutes (REQ-ATM-005, REQ-ATM-006)

export const InstallKindSchema = z.enum(["binary", "homebrew", "development", "unknown"]);
export type InstallKind = z.infer<typeof InstallKindSchema>;

export const ReleaseChannelSchema = z.enum(["stable", "beta", "dev"]);

export const ActivePhaseSchema = z.enum([
  "staging",
  "backup",
  "migration",
  "binary",
  "content",
  "verify",
  "rollback",
]);

export const LockSchema = z.object({
  active: z.boolean(),
  pid: z.number().int().positive().optional(),
  operationId: z.string().optional(),
  startedAt: z.string().datetime().optional(),
  staleAfterSeconds: z.number().int().positive().min(STALE_AFTER_SECONDS).max(STALE_AFTER_SECONDS),
});
export type StateLock = z.infer<typeof LockSchema>;

export const LastCheckResultSchema = z.enum([
  "available",
  "none",
  "network-error",
  "blocked",
]);

export const LastCheckSchema = z.object({
  checkedAt: z.string().datetime(),
  channel: ReleaseChannelSchema,
  latestVersion: z.string().optional(),
  releaseJsonCachePath: z.string().optional(),
  etag: z.string().optional(),
  result: LastCheckResultSchema,
});
export type LastCheck = z.infer<typeof LastCheckSchema>;

export const ActiveOperationSchema = z.object({
  id: z.string(),
  version: z.string(),
  phase: ActivePhaseSchema,
  backupId: z.string().optional(),
  releaseCachePath: z.string().optional(),
  startedAt: z.string().datetime(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type ActiveOperation = z.infer<typeof ActiveOperationSchema>;

export const InstallHistorySchema = z.object({
  path: z.string(),
  retention: z.object({
    maxEntries: z.literal(100),
    maxAgeDays: z.literal(180),
  }),
});

export const DeckUpdateStateSchema = z.object({
  schemaVersion: z.literal(1),
  currentVersion: z.string().min(1),
  installKind: InstallKindSchema,
  lock: LockSchema.optional(),
  lastCheck: LastCheckSchema.optional(),
  activeOperation: ActiveOperationSchema.optional(),
  installHistory: InstallHistorySchema,
});
export type DeckUpdateState = z.infer<typeof DeckUpdateStateSchema>;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export const STATE_ERROR_CODES = {
  /** Lock is held by another live process. */
  LOCK_HELD: "STATE_LOCK_HELD",
  /** `state.yaml` exists but the schemaVersion is from a future build. */
  UNSUPPORTED_FUTURE_SCHEMA: "STATE_UNSUPPORTED_FUTURE_SCHEMA",
  /** `state.yaml` exists but is invalid YAML/JSON. */
  INVALID: "STATE_INVALID",
  /** Atomic write failed (rename error, disk full, etc.). */
  WRITE_FAILED: "STATE_WRITE_FAILED",
} as const;

export type StateErrorCode = (typeof STATE_ERROR_CODES)[keyof typeof STATE_ERROR_CODES];

export class StateStoreError extends Error {
  readonly code: StateErrorCode;
  readonly path?: string;

  constructor(code: StateErrorCode, message: string, options?: { path?: string; cause?: unknown }) {
    super(message);
    this.name = "StateStoreError";
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

export type StateStorePaths = {
  statePath: string;
  stateDir: string;
  historyPath: string;
  historyDir: string;
};

export function getStateStorePaths(): StateStorePaths {
  const xdg = getDeckXdgPaths();
  return {
    statePath: xdg.statePath,
    stateDir: xdg.stateDir,
    historyPath: join(xdg.stateDir, "history", "upgrade-history.jsonl"),
    historyDir: join(xdg.stateDir, "history"),
  };
}

// ---------------------------------------------------------------------------
// Default state
// ---------------------------------------------------------------------------

/**
 * Build a default `state.yaml` payload for fresh installs.
 */
export function buildDefaultState(
  currentVersion: string,
  installKind: InstallKind = "unknown",
): DeckUpdateState {
  const { historyPath } = getStateStorePaths();
  return {
    schemaVersion: 1,
    currentVersion,
    installKind,
    installHistory: {
      path: historyPath,
      retention: { maxEntries: 100, maxAgeDays: 180 },
    },
  };
}

// ---------------------------------------------------------------------------
// Read / write (atomic)
// ---------------------------------------------------------------------------

/**
 * Read `state.yaml` from disk. Returns the default state if the file does
 * not exist; throws `StateStoreError` on malformed content or unsupported
 * future schemaVersion.
 */
export function readState(currentVersion: string, installKind: InstallKind = "unknown"): DeckUpdateState {
  const { statePath } = getStateStorePaths();

  if (!existsSync(statePath)) {
    return buildDefaultState(currentVersion, installKind);
  }

  let text: string;
  try {
    text = readFileSync(statePath, "utf-8");
  } catch (err) {
    throw new StateStoreError(
      STATE_ERROR_CODES.INVALID,
      `Could not read state file: ${(err as Error).message}`,
      { path: statePath, cause: err },
    );
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new StateStoreError(
      STATE_ERROR_CODES.INVALID,
      `State file is not valid JSON: ${(err as Error).message}`,
      { path: statePath, cause: err },
    );
  }

  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new StateStoreError(
      STATE_ERROR_CODES.INVALID,
      "State file must be a JSON object at the top level.",
      { path: statePath },
    );
  }

  // Future-schema reject: a newer Deck that bumped the version writes a
  // higher schemaVersion. We refuse to read it to avoid corrupting it on
  // the next write.
  const rawVersion = (raw as { schemaVersion?: unknown }).schemaVersion;
  if (typeof rawVersion === "number" && rawVersion > 1) {
    throw new StateStoreError(
      STATE_ERROR_CODES.UNSUPPORTED_FUTURE_SCHEMA,
      `State file schemaVersion=${rawVersion} is from a newer Deck; refusing to read.`,
      { path: statePath },
    );
  }

  const result = DeckUpdateStateSchema.safeParse(raw);
  if (!result.success) {
    throw new StateStoreError(
      STATE_ERROR_CODES.INVALID,
      `State file failed schema validation: ${result.error.message}`,
      { path: statePath, cause: result.error },
    );
  }
  return result.data;
}

/**
 * Write `state.yaml` atomically (temp file + rename).
 */
export function writeState(state: DeckUpdateState): void {
  const { statePath } = getStateStorePaths();
  const dir = dirname(statePath);
  mkdirSync(dir, { recursive: true });
  const tmpPath = `${statePath}.tmp-${process.pid}-${Date.now()}`;
  try {
    writeFileSync(tmpPath, JSON.stringify(state, null, 2) + "\n", "utf-8");
    renameSync(tmpPath, statePath);
  } catch (err) {
    try {
      if (existsSync(tmpPath)) unlinkSync(tmpPath);
    } catch {
      // best-effort
    }
    throw new StateStoreError(
      STATE_ERROR_CODES.WRITE_FAILED,
      `Failed to write state file: ${(err as Error).message}`,
      { path: statePath, cause: err },
    );
  }
}

// ---------------------------------------------------------------------------
// Lock management
// ---------------------------------------------------------------------------

/**
 * Check whether `pid` is a live process. Uses `process.kill(pid, 0)` which
 * succeeds for a live process and throws ESRCH for a dead one. Returns
 * `false` on any other error (e.g. EPERM means "live but not ours").
 */
export function isPidAlive(pid: number | undefined): boolean {
  if (pid === undefined) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ESRCH") return false;
    // EPERM or other — treat as live so we do not stomp on a sibling.
    return true;
  }
}

/**
 * Check whether a recorded lock is stale (owner dead or age beyond
 * `STALE_AFTER_SECONDS`).
 */
export function isLockStale(lock: StateLock, now: Date = new Date()): boolean {
  if (!lock.active) return true;
  if (lock.pid !== undefined && !isPidAlive(lock.pid)) return true;
  if (lock.startedAt) {
    const started = Date.parse(lock.startedAt);
    if (Number.isFinite(started)) {
      const ageSeconds = (now.getTime() - started) / 1000;
      if (ageSeconds >= lock.staleAfterSeconds) return true;
    }
  }
  return false;
}

/**
 * Acquire the state-store lock. Throws `StateStoreError` with code
 * `LOCK_HELD` if the lock is held by a live, fresh owner.
 */
export function acquireLock(
  state: DeckUpdateState,
  operationId: string,
  now: Date = new Date(),
): DeckUpdateState {
  if (state.lock?.active && !isLockStale(state.lock, now)) {
    throw new StateStoreError(
      STATE_ERROR_CODES.LOCK_HELD,
      `Another upgrade is in progress. Remove ${getStateStorePaths().statePath} lock only if you are sure no other upgrade is running.`,
      { path: getStateStorePaths().statePath },
    );
  }
  return {
    ...state,
    lock: {
      active: true,
      pid: process.pid,
      operationId,
      startedAt: now.toISOString(),
      staleAfterSeconds: STALE_AFTER_SECONDS,
    },
  };
}

/**
 * Release the state-store lock. Idempotent: releasing a non-active lock is a
 * no-op so callers don't have to special-case "did I acquire it first?".
 */
export function releaseLock(state: DeckUpdateState): DeckUpdateState {
  if (!state.lock?.active) return state;
  return { ...state, lock: undefined };
}

// ---------------------------------------------------------------------------
// Active operation + history
// ---------------------------------------------------------------------------

/**
 * Set the active operation. The caller is responsible for writing the state
 * afterwards via `writeState`.
 */
export function setActiveOperation(
  state: DeckUpdateState,
  op: ActiveOperation,
): DeckUpdateState {
  return { ...state, activeOperation: op };
}

/**
 * Clear the active operation (called on completion or rollback).
 */
export function clearActiveOperation(state: DeckUpdateState): DeckUpdateState {
  return { ...state, activeOperation: undefined };
}

/**
 * Append a single JSONL entry to the history file, then rotate if the file
 * exceeds `maxEntries` or contains entries older than `maxAgeDays`.
 *
 * The entry is opaque to the state schema; orchestrator code decides its
 * shape. Returns the number of entries written.
 */
export function appendHistory(
  state: DeckUpdateState,
  entry: Record<string, unknown>,
): { entries: number; rotated: boolean } {
  const { historyPath, historyDir } = getStateStorePaths();
  mkdirSync(historyDir, { recursive: true });
  const line = JSON.stringify({ ...entry, writtenAt: new Date().toISOString() }) + "\n";
  try {
    writeFileSync(historyPath, line, { flag: "a", encoding: "utf-8" });
  } catch (err) {
    throw new StateStoreError(
      STATE_ERROR_CODES.WRITE_FAILED,
      `Failed to append history entry: ${(err as Error).message}`,
      { path: historyPath, cause: err },
    );
  }

  const rotated = rotateHistory(state);
  const entries = countHistoryLines();
  return { entries, rotated };
}

function countHistoryLines(): number {
  const { historyPath } = getStateStorePaths();
  if (!existsSync(historyPath)) return 0;
  const text = readFileSync(historyPath, "utf-8");
  return text.split("\n").filter((l) => l.length > 0).length;
}

/**
 * Rotate the history file: keep only the latest `maxEntries` lines and only
 * entries newer than `maxAgeDays` from the file's writtenAt timestamps.
 */
export function rotateHistory(state: DeckUpdateState): boolean {
  const { historyPath } = getStateStorePaths();
  if (!existsSync(historyPath)) return false;

  const text = readFileSync(historyPath, "utf-8");
  const lines = text.split("\n").filter((l) => l.length > 0);
  if (lines.length === 0) return false;

  const cutoff = Date.now() - state.installHistory.retention.maxAgeDays * 24 * 60 * 60 * 1000;
  const parsed: Array<{ writtenAt: string; line: string }> = [];
  for (const line of lines) {
    try {
      const obj = JSON.parse(line) as { writtenAt?: string };
      const writtenAt = obj.writtenAt ?? new Date(0).toISOString();
      parsed.push({ writtenAt, line });
    } catch {
      // Skip malformed lines silently — history rotation must be non-fatal.
    }
  }
  parsed.sort((a, b) => b.writtenAt.localeCompare(a.writtenAt));

  const kept = parsed.filter((p) => {
    const ts = Date.parse(p.writtenAt);
    if (!Number.isFinite(ts)) return true;
    return ts >= cutoff;
  }).slice(0, state.installHistory.retention.maxEntries);

  if (kept.length === lines.length) return false;

  writeFileSync(historyPath, kept.map((p) => p.line).join("\n") + "\n", "utf-8");
  return true;
}

/**
 * Read the JSONL history entries. Returns the parsed objects.
 */
export function readHistory(): readonly Record<string, unknown>[] {
  const { historyPath } = getStateStorePaths();
  if (!existsSync(historyPath)) return [];
  const text = readFileSync(historyPath, "utf-8");
  const out: Record<string, unknown>[] = [];
  for (const line of text.split("\n")) {
    if (line.length === 0) continue;
    try {
      out.push(JSON.parse(line) as Record<string, unknown>);
    } catch {
      // Skip malformed lines.
    }
  }
  return out;
}
