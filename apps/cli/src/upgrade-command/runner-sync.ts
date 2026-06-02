/**
 * Runner sync — content-only re-application of Deck files to installed
 * runners, driven by user selections in `config.json`.
 *
 * Responsibilities:
 *   1. Detect which runners have Deck-managed artifacts installed
 *      (via `RunnerAdapter.detectDeckInstall`).
 *   2. For each detected runner, read the user's `packageInstructions[runnerId]`
 *      from the normalized Deck config.
 *   3. Build a `CapabilityInstructionBundle` from the enabled package IDs.
 *   4. Re-run the adapter's developer-team install flow in `--sync` mode:
 *      no package installs, only the content artifacts Deck owns
 *      (prompts/skills/subagents/MCP/packageInstructions).
 *   5. Record per-runner results so the orchestrator can build a manifest
 *      entry and decide whether to mark the upgrade `partial_failure`.
 *
 * REQ-SYNC-001 .. REQ-SYNC-007
 *   - REQ-SYNC-001: After a `binary` upgrade, run sync.
 *   - REQ-SYNC-002: Sync rewrites prompts, skills, subagents, config.
 *   - REQ-SYNC-003: Sync MUST NOT reinstall packages.
 *   - REQ-SYNC-004: Read selections from `packageInstructions[runnerId]`.
 *   - REQ-SYNC-005: Sync preserves model/memory settings.
 *   - REQ-SYNC-006: Content-only release works without binary upgrade.
 *   - REQ-SYNC-007: Migration items require backup (handled in orchestrator).
 *
 * The actual package-reinstall ban is enforced by the orchestrator
 * (which never calls `runAction` with `kind=install-*` during sync). The
 * runner-sync module is intentionally pure with respect to package
 * installation: it only invokes `buildDeveloperTeamInstallPlan`,
 * `applyDeveloperTeamInstall`, and `verifyDeveloperTeamInstall`.
 */

import type { NormalizedDeckConfig } from "@deck/core";
import {
  buildCapabilityInstructionBundle,
  getEnabledPackageInstructionIds,
  type CapabilityInstructionBundle,
  type CapabilityInstructionPackageId,
} from "@deck/core";

import type {
  RunnerAdapter,
  RunnerDeveloperTeamInstallPlan,
  DeveloperTeamApplyInput,
  DeveloperTeamApplyResult,
} from "@deck/core";
import type { RunnerDeckInstallStatus } from "@deck/core";

import {
  upsertManifestFile,
  type ManifestFile,
  type ManifestJsonV2,
} from "./manifest-store.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Per-runner sync result recorded by the orchestrator.
 */
export type RunnerSyncOutcome = {
  runnerId: string;
  status: "synced" | "skipped" | "failed";
  /** Files the sync wrote, in the order they were applied. */
  filesWritten: readonly string[];
  /** Diagnostics surfaced by the adapter or this module. */
  diagnostics: readonly string[];
  /** Backup that should be retained while this sync outcome is current. */
  adapterBackup: unknown;
  /** True when the sync was a no-op because the runner is not installed. */
  skippedReason?: "not-detected" | "no-selections";
};

/**
 * Full result returned by `runRunnerSync`.
 */
export type RunnerSyncResult = {
  outcomes: readonly RunnerSyncOutcome[];
  /** Updated manifest entries (paths + metadata) per file written. */
  manifestEntries: readonly ManifestFile[];
};

/**
 * Adapter registry subset the sync needs.
 *
 * Kept narrow so tests can supply a hand-rolled fake. The real registry
 * is `apps/cli/src/runner-adapters.ts` and exposes the same shape.
 */
export type RunnerSyncAdapterRegistry = {
  list(): readonly RunnerAdapter[];
  has(runnerId: string): boolean;
  get(runnerId: string): RunnerAdapter;
};

/**
 * Inputs to `runRunnerSync`.
 */
export type RunnerSyncInput = {
  /** The current Deck config (source of truth for selections). */
  config: NormalizedDeckConfig;
  /** The adapter registry to drive each runner sync. */
  registry: RunnerSyncAdapterRegistry;
  /** Project root passed to the adapter apply/verify. */
  projectRoot: string;
  /** Deck version recorded in the manifest entries. */
  deckVersion: string;
  /**
   * Optional override: restrict the sync to a specific list of runner ids.
   * Defaults to "every registered adapter".
   */
  runnerIds?: readonly string[];
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run content-only sync across the detected Deck-installed runners.
 *
 * The function is deliberately side-effect-isolated: it returns a result
 * that describes what was done. The caller (orchestrator) is responsible
 * for writing the manifest, appending history, and releasing locks.
 */
export async function runRunnerSync(
  input: RunnerSyncInput,
): Promise<RunnerSyncResult> {
  const { config, registry, projectRoot, deckVersion } = input;
  const ids = input.runnerIds ?? registry.list().map((a) => a.runnerId);
  const outcomes: RunnerSyncOutcome[] = [];
  const manifestEntries: ManifestFile[] = [];

  for (const runnerId of ids) {
    if (!registry.has(runnerId)) {
      outcomes.push({
        runnerId,
        status: "skipped",
        filesWritten: [],
        diagnostics: [`Runner ${runnerId} is not registered; skipping sync.`],
        adapterBackup: undefined,
        skippedReason: "not-detected",
      });
      continue;
    }

    const adapter = registry.get(runnerId);

    // 1. Detect Deck-managed artifacts.
    const detection = await safeDetect(adapter, projectRoot);
    if (!detection.installed) {
      outcomes.push({
        runnerId,
        status: "skipped",
        filesWritten: [],
        diagnostics: detection.diagnostics ?? [
          `Runner ${runnerId} has no Deck-managed artifacts; skipping sync.`,
        ],
        adapterBackup: undefined,
        skippedReason: "not-detected",
      });
      continue;
    }

    // 2. Read the user's package selections for this runner.
    const enabledIds: CapabilityInstructionPackageId[] =
      getEnabledPackageInstructionIds(config, runnerId);
    if (enabledIds.length === 0) {
      outcomes.push({
        runnerId,
        status: "skipped",
        filesWritten: [],
        diagnostics: [`Runner ${runnerId} has no enabled package instructions; skipping sync.`],
        adapterBackup: undefined,
        skippedReason: "no-selections",
      });
      continue;
    }

    // 3. Build the capability instruction bundle.
    const bundle: CapabilityInstructionBundle = buildCapabilityInstructionBundle(enabledIds);

    // 4. Plan → backup → apply → verify.
    const plan: RunnerDeveloperTeamInstallPlan = safeBuildPlan(adapter, {
      projectRoot,
      environmentId: (adapter.environmentIds[0] ?? "opencode-development") as never,
      capabilityInstructions: bundle,
    });

    const adapterBackup = safeBackup(adapter, plan);
    let applyResult: DeveloperTeamApplyResult;
    try {
      applyResult = await safeApply(adapter, {
        projectRoot,
        plan,
        environmentId: (adapter.environmentIds[0] ?? "opencode-development") as never,
      });
    } catch (err) {
      outcomes.push({
        runnerId,
        status: "failed",
        filesWritten: [],
        diagnostics: [
          `applyDeveloperTeamInstall failed: ${(err as Error).message}`,
        ],
        adapterBackup,
      });
      continue;
    }

    const verify = safeVerify(adapter, plan);

    // The orchestrator treats the sync as failed when verify returns
    // invalid OR the apply produced no results at all (an empty
    // results array is the apply-side equivalent of "nothing happened").
    const applyLooksSuccessful =
      (applyResult.results?.length ?? 0) > 0 ||
      (applyResult.changedCount ?? 0) + (applyResult.unchangedCount ?? 0) > 0;
    const failed = !verify.valid || !applyLooksSuccessful;

    if (failed) {
      // Partial failure: try to roll back via the adapter backup if present.
      if (adapterBackup !== undefined) {
        try {
          adapter.rollbackDeveloperTeamFiles(adapterBackup);
        } catch (err) {
          outcomes.push({
            runnerId,
            status: "failed",
            filesWritten: [],
            diagnostics: [
              `verify or apply failed and rollback also failed: ${(err as Error).message}`,
            ],
            adapterBackup,
          });
          continue;
        }
      }
      outcomes.push({
        runnerId,
        status: "failed",
        filesWritten: [],
        diagnostics: [
          ...(verify.diagnostics ?? []),
          `Apply result: changedCount=${applyResult.changedCount}, unchangedCount=${applyResult.unchangedCount}`,
        ],
        adapterBackup,
      });
      continue;
    }

    // 5. Record files in the manifest.
    const filePaths: string[] = [];
    for (const file of plan.files) {
      manifestEntries.push({
        path: file.path,
        owner: `runner:${runnerId}` as const,
        checksum: { algorithm: "sha256", value: "0".repeat(64) },
        deck_version: deckVersion,
        kind: classifyFile(file.path),
        lastWrittenAt: new Date().toISOString(),
      });
      filePaths.push(file.path);
    }

    outcomes.push({
      runnerId,
      status: "synced",
      filesWritten: filePaths,
      diagnostics: verify.diagnostics ?? [],
      adapterBackup,
    });
  }

  return { outcomes, manifestEntries };
}

// ---------------------------------------------------------------------------
// Manifest application helper
// ---------------------------------------------------------------------------

/**
 * Apply a `RunnerSyncResult` to a manifest, returning the new manifest.
 *
 * The runner-sync module does NOT touch disk state directly; the orchestrator
 * passes in the existing manifest and writes back the result.
 */
export function applyRunnerSyncToManifest(
  manifest: ManifestJsonV2,
  result: RunnerSyncResult,
  deckVersion: string,
): ManifestJsonV2 {
  let next = manifest;
  for (const file of result.manifestEntries) {
    next = upsertManifestFile(
      next,
      {
        path: file.path,
        owner: file.owner,
        deck_version: file.deck_version,
        kind: file.kind,
        checksum: file.checksum,
      },
      deckVersion,
    );
  }
  return next;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function safeDetect(
  adapter: RunnerAdapter,
  projectRoot: string,
): Promise<RunnerDeckInstallStatus> {
  if (typeof adapter.detectDeckInstall !== "function") {
    return { installed: false, managedPaths: [] };
  }
  try {
    return await adapter.detectDeckInstall({ projectRoot });
  } catch {
    return { installed: false, managedPaths: [] };
  }
}

function safeBuildPlan(
  adapter: RunnerAdapter,
  input: {
    projectRoot: string;
    environmentId: never;
    capabilityInstructions: CapabilityInstructionBundle;
  },
): RunnerDeveloperTeamInstallPlan {
  try {
    return adapter.buildDeveloperTeamInstallPlan(input as never);
  } catch (err) {
    return { files: [] };
  }
}

function safeBackup(adapter: RunnerAdapter, plan: unknown): unknown {
  try {
    return adapter.backupDeveloperTeamFiles(plan);
  } catch {
    return undefined;
  }
}

async function safeApply(
  adapter: RunnerAdapter,
  input: DeveloperTeamApplyInput,
): Promise<DeveloperTeamApplyResult> {
  return adapter.applyDeveloperTeamInstall(input);
}

function safeVerify(
  adapter: RunnerAdapter,
  plan: unknown,
): { valid: boolean; diagnostics: readonly string[] } {
  try {
    return adapter.verifyDeveloperTeamInstall(plan);
  } catch (err) {
    return { valid: false, diagnostics: [(err as Error).message] };
  }
}

/**
 * Best-effort classification of a plan file path into a manifest kind.
 *
 * The plan file paths are relative; we classify by suffix and known
 * segment names. Unknown paths default to `content`.
 */
function classifyFile(path: string): ManifestFile["kind"] {
  if (path.includes("skill")) return "skill";
  if (path.includes("prompt")) return "prompt";
  if (path.includes("subagent") || path.includes("agent")) return "subagent";
  if (path.includes("mcp")) return "mcp";
  if (path.endsWith("config.json") || path.endsWith("config.yaml")) return "config";
  return "content";
}

// Re-export the config type so consumers can build their input without
// importing from `@deck/core` directly.
export type { NormalizedDeckConfig };
