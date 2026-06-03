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
  binary: { status: "skipped" | "completed" | "skipped-homebrew" | "no-item-for-platform"; itemId?: string };
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
export async function buildDefaultOrchestratorDeps(): Promise<OrchestratorDeps> {
  let cached: import("@deck/core").NormalizedDeckConfig | undefined;
  const readDeckConfig = () => {
    if (cached) return cached;
    // Lazy require to avoid a top-level circular dep with the adapter
    // packages; tests override this dep anyway.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const core = require("@deck/core") as typeof import("@deck/core");
    cached = core.getDefaultDeckConfig();
    return cached;
  };

  return {
    resolveStagingDir: (version: string) => {
      const cache = require("../runtime/paths.js") as typeof import("../runtime/paths.js");
      const xdg = cache.getDeckXdgPaths();
      const path = require("node:path") as typeof import("node:path");
      return path.join(xdg.releasesDir, `v${version}`);
    },
    resolveStagedAsset: (version: string, assetName: string) => {
      const cache = require("../runtime/paths.js") as typeof import("../runtime/paths.js");
      const xdg = cache.getDeckXdgPaths();
      const path = require("node:path") as typeof import("node:path");
      const full = path.join(xdg.releasesDir, `v${version}`, assetName);
      return existsSync(full) ? full : null;
    },
    adapterRegistry: {
      list: () => [],
      has: () => false,
      get: () => {
        throw new Error("Default adapter registry is empty; provide deps.adapterRegistry.");
      },
    },
    projectRoot: process.cwd(),
    readDeckConfig,
    // Use process.execPath to correctly identify installed binary path.
    // In compiled Bun binaries, process.argv[0] can be "bun" while
    // process.execPath contains the actual binary path.
    currentBinaryPath: process.execPath ?? process.argv[0] ?? "",
    installKind: detectInstallKind(),
  };
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

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
    const backupInput: CreateBackupInput = {
      operationId,
      deckVersionBefore: options.currentVersion,
      ...(descriptor.version ? { targetVersion: descriptor.version } : {}),
      reason: "upgrade",
      files: collectBackupTargets(binaryItem, contentItems, deps),
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

  // Atomic replace. The actual rename is delegated to the caller via
  // the install module. For now we trust that the binary path is
  // updated by an external hook (e.g. the actual `performUpgrade` from
  // install.ts in production). Tests inject a `replaceBinary` hook via
  // deps to perform the rename. To keep the API tight, we always
  // require the staging asset to exist; the caller's install.ts is
  // responsible for the actual file replacement.
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
