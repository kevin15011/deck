/**
 * Upgrade orchestrator — coordinates the full upgrade state machine.
 *
 * Sequence (spec §States and Transitions):
 *   1. Acquire state lock (refuse if held and live).
 *   2. Create a timestamped backup of all files that will be mutated.
 *   3. Download / stage the release assets (when running the real path;
 *      tests inject pre-staged assets).
 *   4. For each `migration` item, record a "migration" history entry
 *      (the orchestrator does not run schema migrations itself; callers
 *      wire in a `migrations` dep if needed).
 *   5. For the platform's `binary` item, atomic-replace the running
 *      binary using the staged asset.
 *   6. For each `content` item, run `runner-sync` to re-apply Deck
 *      content to detected runners.
 *   7. Verify checksum/replacement, write the manifest and history, then
 *      release the lock.
 *
 * On any step failure: auto-rollback from backup. The lock is cleared
 * regardless of outcome.
 *
 * Homebrew behavior: a Homebrew-owned binary refuses the binary item
 * (REQ-REL/Homebrew design §1 D6). Content sync is still allowed when
 * the descriptor has `content` items.
 *
 * REQ-ATM-005, REQ-ATM-006, REQ-ATM-007, REQ-ATM-010, REQ-ATM-011,
 * REQ-ATM-012, REQ-SYNC-001..007, REQ-RD-010, REQ-RD-011.
 */

import { existsSync, readFileSync } from "node:fs";

import {
  parseReleaseDescriptor,
  selectBinaryItemForPlatform,
  selectItemsByKind,
  getCurrentPlatformTriple,
  type ReleaseJson,
  type BinaryReleaseItem,
  type ContentReleaseItem,
  type MigrationReleaseItem,
  type AdvisoryReleaseItem,
  type ChannelEolReleaseItem,
  type ReleaseItem,
} from "./release-descriptor.js";
import { orderReleaseItems } from "./release-descriptor.js";
import {
  acquireLock,
  appendHistory,
  buildDefaultState,
  clearActiveOperation,
  isLockStale,
  readState,
  releaseLock,
  setActiveOperation,
  writeState,
  STATE_ERROR_CODES,
  StateStoreError,
  type ActiveOperation,
  type DeckUpdateState,
} from "./state-store.js";
import {
  computeFileSha256,
  createBackup,
  findLatestBackup,
  getBackupRoot,
  readBackupManifest,
  restoreBackup,
  applyRetention,
  type CreateBackupInput,
  type CreateBackupResult,
} from "./backup-store.js";
import {
  readManifest,
  writeManifest,
  upsertManifestFile,
  buildDefaultManifest,
  type ManifestJsonV2,
  type ManifestFile,
} from "./manifest-store.js";
import {
  runRunnerSync,
  applyRunnerSyncToManifest,
  type RunnerSyncResult,
  type RunnerSyncAdapterRegistry,
} from "./runner-sync.js";
import { rollbackLatest, RollbackError } from "./rollback.js";
import {
  getEnabledPackageInstructionIds,
  buildCapabilityInstructionBundle,
  type CapabilityInstructionBundle,
  type CapabilityInstructionPackageId,
} from "@deck/core";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export const ORCHESTRATOR_ERROR_CODES = {
  /** Lock is held by another live process. */
  UPGRADE_LOCKED: "UPGRADE_LOCKED",
  /** Release descriptor was rejected by the parser. */
  DESCRIPTOR_INVALID: "DESCRIPTOR_INVALID",
  /** Backup creation failed. */
  BACKUP_FAILED: "BACKUP_FAILED",
  /** SHA-256 of the staged asset does not match the descriptor. */
  CHECKSUM_MISMATCH: "CHECKSUM_MISMATCH",
  /** Atomic replace of the binary failed. */
  REPLACE_FAILED: "REPLACE_FAILED",
  /** Rollback itself failed. */
  ROLLBACK_FAILED: "ROLLBACK_FAILED",
  /** Homebrew-owned binary; refuse binary self-upgrade. */
  HOMEBREW_REFUSED: "HOMEBREW_REFUSED",
  /** No binary item was found for the current platform. */
  NO_BINARY_FOR_PLATFORM: "ORCHESTRATOR_NO_BINARY_FOR_PLATFORM",
  /** Runner sync failed for one or more runners. */
  RUNNER_SYNC_PARTIAL_FAILURE: "RUNNER_SYNC_PARTIAL_FAILURE",
  /** Verification failed after upgrade. */
  RUNNER_VERIFY_FAILED: "RUNNER_VERIFY_FAILED",
} as const;

export type OrchestratorErrorCode =
  (typeof ORCHESTRATOR_ERROR_CODES)[keyof typeof ORCHESTRATOR_ERROR_CODES];

export class OrchestratorError extends Error {
  readonly code: OrchestratorErrorCode;
  readonly backupId?: string;
  readonly path?: string;

  constructor(
    code: OrchestratorErrorCode,
    message: string,
    options?: { backupId?: string; path?: string; cause?: unknown },
  ) {
    super(message);
    this.name = "OrchestratorError";
    this.code = code;
    this.backupId = options?.backupId;
    this.path = options?.path;
    if (options?.cause !== undefined) {
      this.cause = options.cause;
    }
  }
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Detect the install kind of the running binary.
 *
 * - `binary` — installed via a release tarball (the default assumption).
 * - `homebrew` — `process.execPath` resolves to a Homebrew Cellar.
 * - `development` — running under `bun run` / `node` / `deno`.
 * - `unknown` — fallback when nothing matches.
 *
 * Note: In compiled Bun binaries, `process.argv[0]` can be the literal "bun"
 * while `process.execPath` contains the actual binary path. We check
 * execPath first to correctly identify installed binaries.
 */
export function detectInstallKind(argv0?: string): "binary" | "homebrew" | "development" | "unknown" {
  // When called with no arguments (production use), prefer process.execPath over process.argv[0]
  // to correctly handle compiled Bun binaries where argv[0] might be "bun" but execPath is the real binary.
  // When called with explicit argv0 (tests), use that value for testing different scenarios.
  let checkPath: string;
  if (argv0 !== undefined) {
    // Explicit argument provided (tests) - use it directly
    checkPath = argv0 || process.execPath || "";
  } else {
    // No argument (production) - prefer execPath over argv[0]
    checkPath = process.execPath || process.argv[0] || "";
  }

  // Check for development mode using the full path
  if (
    checkPath.includes("/bun") ||
    checkPath.includes("/deno") ||
    checkPath.includes("/node") ||
    checkPath === "bun" ||
    checkPath === "deno" ||
    checkPath === "node"
  ) {
    return "development";
  }
  // Check for Homebrew-installed binary
  if (
    checkPath.includes("/Cellar/deck/") ||
    checkPath.includes("/homebrew/bin/deck") ||
    checkPath.includes("/homebrew/Cellar/")
  ) {
    return "homebrew";
  }
  return "binary";
}

/**
 * Input for the binary replacement operation.
 * Used by the `replaceBinary` hook in OrchestratorDeps.
 */
export type ReplaceBinaryInput = {
  /** Path to the staged asset (already verified checksum). */
  stagedAssetPath: string;
  /** Current binary path to replace. */
  currentBinaryPath: string;
  /** Expected SHA-256 of the staged asset. */
  expectedSha256: string;
  /** Optional backup path for atomic safety. */
  backupPath?: string;
  /** Release item identifier. */
  itemId: string;
};

/**
 * Result of the binary replacement operation.
 */
export type ReplaceBinaryResult = {
  /** Whether the binary was replaced. */
  replaced: boolean;
  /** Path to the backup (if created). */
  backupPath?: string;
  /** Diagnostics messages. */
  diagnostics?: string[];
};

export type OrchestratorDeps = {
  /**
   * Resolve the staging directory for a release version. The orchestrator
   * expects asset files to be present at `<stagingDir>/<assetName>` and
   * will verify their SHA-256 against the descriptor.
   */
  resolveStagingDir(version: string): string;
  /**
   * Read the staged asset by name. Returns the absolute path or `null`
   * when the asset is not staged. Tests pre-stage fake tarballs here.
   */
  resolveStagedAsset(version: string, assetName: string): string | null;
  /**
   * Adapter registry. The default uses the real `apps/cli/src/runner-adapters.ts`
   * registry; tests inject fakes.
   */
  adapterRegistry: RunnerSyncAdapterRegistry;
  /**
   * Project root passed to the adapter apply/verify. Defaults to
   * `process.cwd()`.
   */
  projectRoot: string;
  /**
   * Read the normalized Deck config. Defaults to `readGlobalDeckConfig`
   * from `@deck/core` but tests inject a hand-rolled value.
   */
  readDeckConfig: () => import("@deck/core").NormalizedDeckConfig;
  /**
   * Provide the current binary path. Used for the atomic replace step.
   * Defaults to `process.argv[0]`.
   */
  currentBinaryPath: string;
  /**
   * Install kind for the running binary. Defaults to `detectInstallKind()`.
   */
  installKind: "binary" | "homebrew" | "development" | "unknown";
  /**
   * Hook for atomic binary replacement. The orchestrator calls this after
   * verifying the checksum. Default is a no-op that rejects (safe default
   * for tests without injected deps).
   */
  replaceBinary?: (input: ReplaceBinaryInput) => Promise<ReplaceBinaryResult>;
  /**
   * Cleanup hook to remove inline backup after verification succeeds.
   * Called by the orchestrator after successful verification.
   */
  cleanupBinaryBackup?: (backupPath?: string) => Promise<void>;
  /**
   * Pre-flight hook fired before the lock is acquired. The orchestrator
   * does not provide a default; tests use it to fail-fast with a custom
   * error before any side effects.
   */
  beforeAcquireLock?: (state: DeckUpdateState) => void;
};

export type OrchestratorOptions = {
  /** Release descriptor JSON (raw). */
  descriptor: unknown;
  /** Deck version being installed. */
  targetVersion: string;
  /** Current Deck version (used for state.yaml and history). */
  currentVersion: string;
  /** Override default dependencies. */
  deps?: Partial<OrchestratorDeps>;
  /** Operation id. Defaults to a generated string. */
  operationId?: string;
  /** Force the upgrade to ignore install-kind restrictions. */
  force?: boolean;
};

export type OrchestratorResult = {
  status: "completed" | "rolled_back" | "partial_failure";
  /** Backup used for atomic safety; may be undefined for content-only upgrades with nothing to back up. */
  backupId?: string;
  /** Per-kind item outcomes. */
  binary: { status: "skipped" | "completed" | "skipped-homebrew" | "skipped_external" | "no-item-for-platform"; itemId?: string };
  content: { status: "skipped" | "completed" | "partial_failure"; outcomes?: RunnerSyncResult["outcomes"] };
  migration: { status: "skipped" | "completed"; itemIds: string[] };
  advisory: { items: AdvisoryReleaseItem[] };
  channelEol: { items: ChannelEolReleaseItem[] };
  /** The final state written to state.yaml. */
  finalState: DeckUpdateState;
  /** The final manifest written. */
  finalManifest: ManifestJsonV2;
};

// ---------------------------------------------------------------------------
// Default deps factory
// ---------------------------------------------------------------------------

/**
 * Build a default `OrchestratorDeps` from the running process.
 *
 * `readDeckConfig` uses a lazy dynamic import to keep this module loadable
 * in tests that don't have `@deck/core` available at the right path.
 */
/**
 * Build a default `OrchestratorDeps` from the running process.
 *
 * `readDeckConfig` uses a lazy dynamic import to keep this module loadable
 * in tests that don't have `@deck/core` available at the right path.
 */
/**
 * Build a default `OrchestratorDeps` from the running process.
 *
 * `readDeckConfig` uses a lazy dynamic import to keep this module loadable
 * in tests that don't have `@deck/core` available at the right path.
 */
/**
 * Build a default `OrchestratorDeps` from the running process.
 *
 * Uses the real adapter registry and config reader for production.
 * Tests can override these dependencies.
 */
/**
 * Build a default `OrchestratorDeps` from the running process.
 *
 * Uses the real adapter registry and config reader for production.
 * Tests can override these dependencies.
 */
export async function buildDefaultOrchestratorDeps(): Promise<OrchestratorDeps> {
  // Lazy load the config reader - uses default config synchronously
  // For production config, consumers should use readDeckConfig with proper async handling
  const readDeckConfig = (): import("@deck/core").NormalizedDeckConfig => {
    try {
      // Try to get default config (synchronous)
      const { getDefaultDeckConfig } = require("@deck/core") as typeof import("@deck/core");
      return getDefaultDeckConfig();
    } catch {
      // If even default config fails, throw to signal the error
      throw new Error("Could not load default deck config");
    }
  };

  // Lazy load the adapter registry
  let adapterRegistry: OrchestratorDeps["adapterRegistry"];
  try {
    const { createDefaultAdapterRegistry } = require("../runner-adapters.js") as typeof import("../runner-adapters.js");
    adapterRegistry = createDefaultAdapterRegistry();
  } catch {
    // Fall back to empty registry if adapters can't be loaded
    adapterRegistry = {
      list: () => [],
      has: () => false,
      get: () => {
        throw new Error("Default adapter registry unavailable");
      },
    };
  }

  // Productive replaceBinary implementation - atomic replace with backup
  // NOTE: We keep the backup inline until after verification completes.
  // The caller (workflow) is responsible for cleanup via cleanupBinaryBackup().
  const replaceBinary: OrchestratorDeps["replaceBinary"] = async (input) => {
    const { existsSync, renameSync, unlinkSync, chmodSync, mkdirSync } = require("node:fs") as typeof import("node:fs");
    const { dirname } = require("node:path") as typeof import("node:path");

    const targetDir = dirname(input.currentBinaryPath);

    // Ensure target directory exists
    if (!existsSync(targetDir)) {
      mkdirSync(targetDir, { recursive: true });
    }

    const backupPath = input.backupPath ?? (input.currentBinaryPath + ".backup");
    const diagnostics: string[] = [];

    // Step 1: Backup current binary if it exists
    if (existsSync(input.currentBinaryPath)) {
      try {
        // Remove old backup if exists
        if (existsSync(backupPath)) {
          unlinkSync(backupPath);
        }
        // Rename current to backup
        renameSync(input.currentBinaryPath, backupPath);
        diagnostics.push(`Backed up current binary to ${backupPath}`);
      } catch (backupErr) {
        throw new Error(`Backup failed: ${(backupErr as Error).message}`);
      }
    }

    // Step 2: Move new binary to target (single rename, same filesystem)
    try {
      renameSync(input.stagedAssetPath, input.currentBinaryPath);
      diagnostics.push(`Replaced binary at ${input.currentBinaryPath}`);
    } catch (replaceErr) {
      // Restore from backup on failure
      if (existsSync(backupPath)) {
        try {
          renameSync(backupPath, input.currentBinaryPath);
          diagnostics.push("Restored from backup after replace failure");
        } catch {
          // Rollback failed - critical failure
          throw new Error(`Critical: replace failed and rollback failed. Binary may be corrupted.`);
        }
      }
      throw new Error(`Replace failed: ${(replaceErr as Error).message}`);
    }

    // Step 3: Make executable (but keep backup for now - cleanup happens after verify)
    try {
      chmodSync(input.currentBinaryPath, 0o755);
    } catch {
      // Best-effort - binary is already replaced
      diagnostics.push("Note: could not set executable permissions");
    }

    return {
      replaced: true,
      backupPath,
      diagnostics,
    };
  };

  // Cleanup function to remove inline backup after verification
  const cleanupBinaryBackup = async (backupPath?: string) => {
    if (!backupPath) return;
    try {
      const { existsSync, unlinkSync } = require("node:fs") as typeof import("node:fs");
      if (existsSync(backupPath)) {
        unlinkSync(backupPath);
      }
    } catch {
      // Best-effort cleanup
    }
  };

  return {
    resolveStagingDir: (version: string) => {
      const { getDeckXdgPaths } = require("../runtime/paths.js") as typeof import("../runtime/paths.js");
      const xdg = getDeckXdgPaths();
      const { join } = require("node:path") as typeof import("node:path");
      return join(xdg.releasesDir, `v${version}`);
    },
    resolveStagedAsset: (version: string, assetName: string) => {
      const { getDeckXdgPaths } = require("../runtime/paths.js") as typeof import("../runtime/paths.js");
      const xdg = getDeckXdgPaths();
      const { join } = require("node:path") as typeof import("node:path");
      const { existsSync } = require("node:fs") as typeof import("node:fs");
      const full = join(xdg.releasesDir, `v${version}`, assetName);
      return existsSync(full) ? full : null;
    },
    adapterRegistry,
    projectRoot: process.cwd(),
    readDeckConfig,
    // Use process.execPath to correctly identify installed binary path.
    // In compiled Bun binaries, process.argv[0] can be "bun" while
    // process.execPath contains the actual binary path.
    currentBinaryPath: process.execPath ?? process.argv[0] ?? "",
    installKind: detectInstallKind(),
    replaceBinary,
    cleanupBinaryBackup,
  };
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

/**
 * Alias for runUpgradeOrchestrator — preferred name for the self-upgrade workflow.
 * Both exports point to the same implementation for backward compatibility.
 */
export const runSelfUpgradeWorkflow = runUpgradeOrchestrator;

/**
 * Run the upgrade orchestrator.
 *
 * The function is the spec §States and Transitions implementation. On
 * failure of any step past the backup phase, the orchestrator
 * auto-rollbacks from the backup and returns `status: "rolled_back"`.
 */
export async function runUpgradeOrchestrator(
  options: OrchestratorOptions,
): Promise<OrchestratorResult> {
  const deps = await resolveDeps(options.deps);
  const operationId = options.operationId ?? makeOperationId();
  let state = readOrDefaultState(options.currentVersion, deps.installKind);

  // --- Acquire lock ---------------------------------------------------
  let backup: CreateBackupResult | undefined;
  try {
    if (deps.beforeAcquireLock) {
      deps.beforeAcquireLock(state);
    }
    state = acquireLock(state, operationId);
  } catch (err) {
    if (err instanceof StateStoreError && err.code === STATE_ERROR_CODES.LOCK_HELD) {
      throw new OrchestratorError(
        ORCHESTRATOR_ERROR_CODES.UPGRADE_LOCKED,
        err.message,
        { cause: err },
      );
    }
    throw err;
  }

  // --- Parse descriptor -----------------------------------------------
  let descriptor: ReleaseJson;
  try {
    descriptor = parseReleaseDescriptor(options.descriptor);
  } catch (err) {
    state = writeAndRelease(state, {
      ...buildNoOp("DESCRIPTOR_INVALID", `Descriptor invalid: ${(err as Error).message}`),
    });
    throw new OrchestratorError(
      ORCHESTRATOR_ERROR_CODES.DESCRIPTOR_INVALID,
      `Release descriptor is invalid: ${(err as Error).message}`,
      { cause: err },
    );
  }

  // --- Migration items (track ids, no schema work in this change) -----
  const migrationItems = selectItemsByKind(descriptor, "migration");
  const advisoryItems = selectItemsByKind(descriptor, "advisory");
  const channelEolItems = selectItemsByKind(descriptor, "channel_eol");

  // --- Backup ---------------------------------------------------------
  try {
    const binaryItem = selectBinaryItemForPlatform(descriptor, getCurrentPlatformTriple());
    const contentItems = selectItemsByKind(descriptor, "content");

    // Collect backup targets: binary + content + runner files
    const baseTargets = collectBackupTargets(binaryItem, contentItems, deps);
    let runnerTargets: Array<{
      id: string;
      sourcePath: string;
      owner: `runner:${string}`;
      kind: "config" | "prompt" | "skill" | "subagent" | "mcp" | "state" | "manifest";
    }> = [];
    let runnerBackupError: string | undefined;
    try {
      runnerTargets = await collectRunnerBackupTargets(deps);
    } catch (err) {
      // Log error but continue - runner backup is best-effort
      runnerBackupError = (err as Error).message;
      console.error(`Warning: Failed to collect runner backup targets: ${runnerBackupError}`);
      runnerTargets = [];
    }

    // If we couldn't collect runner targets, log a warning but proceed
    // The sync will still work but without per-runner rollback capability
    if (runnerTargets.length === 0 && !runnerBackupError) {
      console.warn("Warning: No runner backup targets collected - skipping runner rollback capability");
    }

    const backupInput: CreateBackupInput = {
      operationId,
      deckVersionBefore: options.currentVersion,
      ...(descriptor.version ? { targetVersion: descriptor.version } : {}),
      reason: "upgrade",
      files: [...baseTargets, ...runnerTargets],
    };
    backup = createBackup(backupInput);
    state = setActiveOperation(state, {
      id: operationId,
      version: descriptor.version,
      phase: "backup",
      ...(backup?.backupId ? { backupId: backup.backupId } : {}),
      startedAt: new Date().toISOString(),
    });
    writeState(state);
  } catch (err) {
    state = releaseLock(clearActiveOperation(state));
    writeState(state);
    throw new OrchestratorError(
      ORCHESTRATOR_ERROR_CODES.BACKUP_FAILED,
      `Backup failed: ${(err as Error).message}`,
      { cause: err },
    );
  }

  // --- Execute items in spec order ------------------------------------
  // Per ITEM_KIND_PRIORITY: advisory → migration → binary → content → channel_eol.
  // Items not requiring execution (advisory, channel_eol) are surfaced
  // in the result without mutating anything.
  let binaryOutcome: OrchestratorResult["binary"] = { status: "skipped" };
  type ContentOutcome = {
    status: "skipped" | "completed" | "partial_failure";
    outcomes?: readonly { runnerId: string; status: string; filesWritten: readonly string[]; diagnostics: readonly string[]; adapterBackup: unknown; skippedReason?: string }[];
    manifest?: ManifestJsonV2;
  };
  let contentOutcome: ContentOutcome = { status: "skipped" };
  let manifest: ManifestJsonV2 = readOrDefaultManifest(options.currentVersion);

  try {
    const ordered = orderReleaseItems(descriptor);

    // Pre-check: is there a binary item for our platform? If not, the
    // binary status should be "no-item-for-platform" rather than the
    // default "skipped" so the result is informative for content-only
    // releases.
    const platformBinary = selectBinaryItemForPlatform(
      descriptor,
      getCurrentPlatformTriple(),
    );
    if (platformBinary === undefined && !descriptor.items.some((i) => i.kind === "binary")) {
      binaryOutcome = { status: "no-item-for-platform" };
    }

    for (const item of ordered) {
      if (item.kind === "advisory") {
        // No mutation. The advisory is surfaced in the result.
        continue;
      }
      if (item.kind === "channel_eol") {
        continue;
      }
      if (item.kind === "migration") {
        // Schema migration is a placeholder in this change. We record
        // the id and continue.
        continue;
      }
      if (item.kind === "binary") {
        if (item.platform !== getCurrentPlatformTriple()) {
          continue;
        }
        binaryOutcome = await runBinaryItem(item, state, deps, options.force === true);
        if (binaryOutcome.status === "completed" && binaryOutcome.itemId) {
          manifest = upsertManifestFile(manifest, {
            path: deps.currentBinaryPath,
            owner: "deck",
            deck_version: descriptor.version,
            kind: "binary",
          }, descriptor.version);
        }
      }
      if (item.kind === "content") {
        const contentResult = await runContentItem(
          item,
          state,
          deps,
          descriptor.version,
          manifest,
        );
        contentOutcome = contentResult;
        if (contentResult.manifest) {
          manifest = contentResult.manifest;
        }
      }
    }
  } catch (err) {
    // Auto-rollback from backup.
    const rolled = tryRollback(backup?.backupId, state, options.currentVersion);
    const finalStatus: OrchestratorResult["status"] = rolled
      ? "rolled_back"
      : "rolled_back";
    state = rolled.nextState;
    writeState(state);
    if (!rolled.success) {
      throw new OrchestratorError(
        ORCHESTRATOR_ERROR_CODES.ROLLBACK_FAILED,
        `Auto-rollback failed: ${rolled.reason}`,
        { backupId: backup?.backupId, cause: err },
      );
    }
    throw new OrchestratorError(
      ORCHESTRATOR_ERROR_CODES.REPLACE_FAILED,
      `Upgrade failed: ${(err as Error).message}. Auto-rolled back from backup ${backup?.backupId ?? "(none)"}.`,
      { backupId: backup?.backupId, cause: err },
    );
  }

  // --- Post-success bookkeeping --------------------------------------
  state = setActiveOperation(state, {
    id: operationId,
    version: descriptor.version,
    phase: "verify",
    ...(backup?.backupId ? { backupId: backup.backupId } : {}),
    startedAt: state.activeOperation?.startedAt ?? new Date().toISOString(),
  });
  state.currentVersion = descriptor.version;
  state = releaseLock(clearActiveOperation(state));
  writeState(state);

  try {
    writeManifest(manifest);
  } catch {
    // Manifest write failure is non-fatal — history still records the
    // outcome.
  }
  try {
    appendHistory(state, {
      operationId,
      result: "completed",
      targetVersion: descriptor.version,
      backupId: backup?.backupId,
    });
  } catch {
    // History is best-effort.
  }

  // Apply retention: keep the new backup, prune older ones.
  if (backup) {
    try {
      applyRetention([backup.backupId]);
    } catch {
      // Retention is best-effort.
    }
  }

  // Cleanup inline backup after successful verification
  // This is safe because we have the backup-store copy for rollback
  if (deps.cleanupBinaryBackup) {
    // Get the backup path from the replace result stored in state
    const replaceResult = state.activeOperation?.metadata?.replaceResult as ReplaceBinaryResult | undefined;
    if (replaceResult?.backupPath) {
      try {
        await deps.cleanupBinaryBackup(replaceResult.backupPath);
      } catch {
        // Cleanup is best-effort - we still have the backup-store copy
      }
    }
  }

  // Compute content status: partial_failure when at least one runner
  // sync reported failure, completed when all sync'd or skipped cleanly.
  const hasFailures = (contentOutcome.outcomes ?? []).some((o) => o.status === "failed");
  const finalStatus: OrchestratorResult["status"] = hasFailures ? "partial_failure" : "completed";

  // Map the wider local ContentOutcome to the public OrchestratorResult shape.
  const publicContent: OrchestratorResult["content"] = {
    status: contentOutcome.status,
    ...(contentOutcome.outcomes
      ? {
          outcomes: contentOutcome.outcomes.map(
            (o) =>
              o as unknown as OrchestratorResult["content"]["outcomes"] extends readonly (infer T)[] ? T : never,
          ),
        }
      : {}),
  };

  return {
    status: finalStatus,
    ...(backup?.backupId ? { backupId: backup.backupId } : {}),
    binary: binaryOutcome,
    content: publicContent,
    migration: {
      status: migrationItems.length > 0 ? "completed" : "skipped",
      itemIds: migrationItems.map((m: MigrationReleaseItem) => m.id),
    },
    advisory: { items: [...advisoryItems] },
    channelEol: { items: [...channelEolItems] },
    finalState: state,
    finalManifest: manifest,
  };
}

// ---------------------------------------------------------------------------
// Step helpers
// ---------------------------------------------------------------------------

async function runBinaryItem(
  item: BinaryReleaseItem,
  state: DeckUpdateState,
  deps: OrchestratorDeps,
  force: boolean,
): Promise<OrchestratorResult["binary"]> {
  if (deps.installKind === "development") {
    throw new OrchestratorError(
      ORCHESTRATOR_ERROR_CODES.REPLACE_FAILED,
      "Refusing to upgrade: deck is running in development mode.",
    );
  }
  // Homebrew refuses binary self-upgrade regardless of --force
  // (spec §6 / design §1 D6). force only matters for staging-presence
  // fallbacks below.
  if (deps.installKind === "homebrew") {
    return { status: "skipped-homebrew", itemId: item.id };
  }

  const staged = deps.resolveStagedAsset(item.asset_name, item.asset_name);
  if (staged === null) {
    // Allow tests to inject a staged asset; for production callers, the
    // upstream download step is responsible for staging.
    if (force) {
      return { status: "skipped", itemId: item.id };
    }
    throw new OrchestratorError(
      ORCHESTRATOR_ERROR_CODES.NO_BINARY_FOR_PLATFORM,
      `Staged asset for ${item.asset_name} not found. Did the download step run?`,
      { path: item.asset_name },
    );
  }

  // Verify checksum (spec REQ-RD-010).
  const actual = computeFileSha256(staged);
  if (actual !== item.sha256) {
    throw new OrchestratorError(
      ORCHESTRATOR_ERROR_CODES.CHECKSUM_MISMATCH,
      `Checksum mismatch for ${item.asset_name}: expected ${item.sha256}, got ${actual}`,
      { path: staged },
    );
  }

  // Mark phase=before atomic replace so an interrupted run can detect it.
  state = setActiveOperation(state, {
    ...(state.activeOperation ?? {
      id: "binary",
      version: "0",
      phase: "binary",
      startedAt: new Date().toISOString(),
    }),
    phase: "binary",
  });
  writeState(state);

  // Atomic replace: delegate to replaceBinary hook if provided
  // The hook is responsible for the actual file replacement.
  // If no hook provided, skip the replace (tests can inject the hook).
  if (deps.replaceBinary) {
    try {
      const replaceInput: ReplaceBinaryInput = {
        stagedAssetPath: staged,
        currentBinaryPath: deps.currentBinaryPath,
        expectedSha256: item.sha256,
        itemId: item.id,
      };
      const replaceResult = await deps.replaceBinary(replaceInput);
      // Store replace result for cleanup after verify
      state = setActiveOperation(state, {
        ...(state.activeOperation ?? {
          id: "binary",
          version: "0",
          phase: "binary",
          startedAt: new Date().toISOString(),
        }),
        metadata: { replaceResult },
      });
      // If the hook reports replaced=false, treat as skipped (e.g., external manager)
      if (!replaceResult.replaced) {
        return { status: "skipped_external", itemId: item.id };
      }
    } catch (replaceErr) {
      // Rollback on replace failure: restore from backup if available
      throw new OrchestratorError(
        ORCHESTRATOR_ERROR_CODES.REPLACE_FAILED,
        `Binary replacement failed: ${(replaceErr as Error).message}`,
        { cause: replaceErr },
      );
    }
  }

  return { status: "completed", itemId: item.id };
}

async function runContentItem(
  _item: ContentReleaseItem,
  state: DeckUpdateState,
  deps: OrchestratorDeps,
  targetVersion: string,
  manifest: ManifestJsonV2,
): Promise<{
  status: "skipped" | "completed" | "partial_failure";
  outcomes?: readonly { runnerId: string; status: string; filesWritten: readonly string[]; diagnostics: readonly string[]; adapterBackup: unknown; skippedReason?: string }[];
  manifest: ManifestJsonV2;
}> {
  state = setActiveOperation(state, {
    ...(state.activeOperation ?? {
      id: "content",
      version: targetVersion,
      phase: "content",
      startedAt: new Date().toISOString(),
    }),
    phase: "content",
  });
  writeState(state);

  const config = deps.readDeckConfig();
  const syncResult = await runRunnerSync({
    config,
    registry: deps.adapterRegistry,
    projectRoot: deps.projectRoot,
    deckVersion: targetVersion,
  });
  const nextManifest = applyRunnerSyncToManifest(manifest, syncResult, targetVersion);
  return {
    status: syncResult.outcomes.some((o) => o.status === "failed")
      ? "partial_failure"
      : "completed",
    outcomes: syncResult.outcomes,
    manifest: nextManifest,
  };
}

function collectBackupTargets(
  binaryItem: BinaryReleaseItem | undefined,
  contentItems: readonly ContentReleaseItem[],
  deps: OrchestratorDeps,
): CreateBackupInput["files"] {
  const files: Array<{
    id: string;
    sourcePath: string;
    owner: "deck" | "runner:pi" | "runner:opencode" | `runner:${string}`;
    kind: "binary" | "config" | "prompt" | "skill" | "subagent" | "mcp" | "state" | "manifest" | "content";
  }> = [];
  if (binaryItem && deps.currentBinaryPath && existsSync(deps.currentBinaryPath)) {
    files.push({
      id: "binary",
      sourcePath: deps.currentBinaryPath,
      owner: "deck",
      kind: "binary",
    });
  }
  for (const item of contentItems) {
    // The content asset itself is a tarball; backup target is any file
    // referenced in the plan once the sync step has run. For pre-backup
    // safety we record the asset name so the restore step can no-op on
    // tarballs.
    files.push({
      id: `content-${item.id}`,
      sourcePath: deps.resolveStagedAsset(item.asset_name, item.asset_name) ?? "(none)",
      owner: "deck",
      kind: "content",
    });
  }
  return files;
}

/**
 * Collect backup targets for all runners that are both installed and have enabled
 * package instructions. This is used by the orchestrator to pre-populate the
 * backup with all mutable files before any mutation occurs.
 *
 * For each runner in the registry:
 *   1. Check `detectDeckInstall` — if not installed, skip.
 *   2. Check `getEnabledPackageInstructionIds` — if empty, skip.
 *   3. Build the capability bundle and install plan.
 *   4. Map `plan.files` to backup targets with owner `runner:${runnerId}`.
 *
 * This helper is intentionally side-effect-free: it only computes targets.
 * The caller decides when and how to create the backup.
 */
export async function collectRunnerBackupTargets(
  deps: OrchestratorDeps,
): Promise<
  Array<{
    id: string;
    sourcePath: string;
    owner: `runner:${string}`;
    kind: "config" | "prompt" | "skill" | "subagent" | "mcp" | "state" | "manifest";
  }>
> {
  const targets: Array<{
    id: string;
    sourcePath: string;
    owner: `runner:${string}`;
    kind: "config" | "prompt" | "skill" | "subagent" | "mcp" | "state" | "manifest";
  }> = [];

  const config = deps.readDeckConfig();
  const runnerIds = deps.adapterRegistry.list().map((a) => a.runnerId);

  for (const runnerId of runnerIds) {
    // 1. Check if the runner has Deck installed.
    const adapter = deps.adapterRegistry.get(runnerId);
    const detection = await safeDetectDeckInstall(adapter, deps.projectRoot);
    if (!detection.installed) {
      continue;
    }

    // 2. Check if there are enabled package instructions.
    const enabledIds = getEnabledPackageInstructionIds(config, runnerId);
    if (enabledIds.length === 0) {
      continue;
    }

    // 3. Build the capability bundle and install plan.
    const bundle = buildCapabilityInstructionBundle(enabledIds);
    const plan = safeBuildDeveloperTeamPlan(adapter, {
      projectRoot: deps.projectRoot,
      environmentId: (adapter.environmentIds[0] ?? "opencode-development") as never,
      capabilityInstructions: bundle,
    });

    if (!plan.files || plan.files.length === 0) {
      continue;
    }

    // 4. Map plan.files to backup targets.
    for (const file of plan.files) {
      // Classify the file kind based on its path pattern.
      const kind = classifyFileKind(file.path);
      targets.push({
        id: `${runnerId}:${file.path}`,
        sourcePath: file.path,
        owner: `runner:${runnerId}` as const,
        kind,
      });
    }
  }

  return targets;
}

/**
 * Safe wrapper for adapter.detectDeckInstall — returns a safe result
 * when the method is missing or throws.
 */
async function safeDetectDeckInstall(
  adapter: RunnerSyncAdapterRegistry extends { get(runnerId: string): infer T } ? T : never,
  projectRoot: string,
): Promise<{ installed: boolean; managedPaths: readonly string[] }> {
  if (typeof (adapter as any).detectDeckInstall !== "function") {
    return { installed: false, managedPaths: [] };
  }
  try {
    return await (adapter as any).detectDeckInstall({ projectRoot });
  } catch {
    return { installed: false, managedPaths: [] };
  }
}

/**
 * Safe wrapper for adapter.buildDeveloperTeamInstallPlan — returns a safe plan
 * when the method is missing or throws.
 */
function safeBuildDeveloperTeamPlan(
  adapter: RunnerSyncAdapterRegistry extends { get(runnerId: string): infer T } ? T : never,
  input: {
    projectRoot: string;
    environmentId: string;
    capabilityInstructions: CapabilityInstructionBundle;
  },
): { files?: Array<{ path: string }> } {
  if (typeof (adapter as any).buildDeveloperTeamInstallPlan !== "function") {
    return { files: [] };
  }
  try {
    return (adapter as any).buildDeveloperTeamInstallPlan(input.projectRoot, {
      environmentId: input.environmentId,
      capabilityInstructions: input.capabilityInstructions,
    });
  } catch {
    return { files: [] };
  }
}

/**
 * Classify a runner file path into a backup `kind`.
 * Used by `collectRunnerBackupTargets` to categorize files for the backup manifest.
 */
function classifyFileKind(
  filePath: string,
): "config" | "prompt" | "skill" | "subagent" | "mcp" | "state" | "manifest" {
  const lower = filePath.toLowerCase();
  if (lower.includes("packageinstructions") || lower.includes(".json")) {
    return "config";
  }
  if (lower.includes("/prompts/") || lower.includes("prompts\\")) {
    return "prompt";
  }
  if (lower.includes("/skills/") || lower.includes("skills\\")) {
    return "skill";
  }
  if (lower.includes("/subagents/") || lower.includes("subagents\\") || lower.includes("/agents/") || lower.includes("agents\\")) {
    return "subagent";
  }
  if (lower.includes("/mcp/") || lower.includes("mcp\\")) {
    return "mcp";
  }
  if (lower.includes("/state") || lower.includes("\\state") || lower.includes(".db")) {
    return "state";
  }
  if (lower.includes("/manifest") || lower.includes("\\manifest")) {
    return "manifest";
  }
  // Default to config for unknown files (safe default).
  return "config";
}

function tryRollback(
  backupId: string | undefined,
  state: DeckUpdateState,
  currentVersion: string,
): { success: boolean; nextState: DeckUpdateState; reason: string } {
  if (!backupId) {
    return { success: false, nextState: state, reason: "no backup id recorded" };
  }
  try {
    const result = rollbackLatest(currentVersion, { force: true });
    return { success: true, nextState: readOrDefaultState(result.rolledBackTo, "binary"), reason: "ok" };
  } catch (err) {
    return { success: false, nextState: state, reason: (err as Error).message };
  }
}

// ---------------------------------------------------------------------------
// State / manifest defaults
// ---------------------------------------------------------------------------

function readOrDefaultState(
  currentVersion: string,
  installKind: OrchestratorDeps["installKind"],
): DeckUpdateState {
  try {
    return readState(currentVersion, installKind);
  } catch (err) {
    // A stale lock owned by a dead process should be auto-recovered.
    if (err instanceof StateStoreError && err.code === STATE_ERROR_CODES.LOCK_HELD) {
      const fresh = buildDefaultState(currentVersion, installKind);
      // Best-effort: if the persisted lock is stale, drop it and start fresh.
      if (fresh.lock && isLockStale(fresh.lock)) {
        return { ...fresh, lock: undefined };
      }
    }
    return buildDefaultState(currentVersion, installKind);
  }
}

function readOrDefaultManifest(deckVersion: string): ManifestJsonV2 {
  try {
    return readManifest(deckVersion);
  } catch {
    return buildDefaultManifest(deckVersion);
  }
}

function writeAndRelease(state: DeckUpdateState, op: ActiveOperation | undefined): DeckUpdateState {
  const next = setActiveOperation(state, op ?? {
    id: "error",
    version: state.currentVersion,
    phase: "staging",
    startedAt: new Date().toISOString(),
  });
  writeState(next);
  return releaseLock(clearActiveOperation(next));
}

function buildNoOp(_code: string, _msg: string): ActiveOperation {
  return {
    id: "noop",
    version: "0.0.0",
    phase: "staging",
    startedAt: new Date().toISOString(),
  };
}

async function resolveDeps(overrides: Partial<OrchestratorDeps> | undefined): Promise<OrchestratorDeps> {
  const base = await buildDefaultOrchestratorDeps();
  return { ...base, ...(overrides ?? {}) };
}

function makeOperationId(): string {
  return `op-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ---------------------------------------------------------------------------
// Re-exports for the orchestrator's test surface
// ---------------------------------------------------------------------------

export type { ReleaseItem, ReleaseJson, ManifestFile };
export { readBackupManifest, getBackupRoot, restoreBackup, findLatestBackup };
export { RollbackError };
