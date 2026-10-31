import { withIdleRunnerMutation, RunnerMutationDeferredError, RunnerMutationCleanupError } from "@deck/session-host";
import { createInterface } from "node:readline/promises";
import { cleanupRoots, planRunnerCleanup, runRunnerCleanupUpdate, type CleanupRoots } from "../runner-cleanup-command";
import type { RunnerMutationAdmission } from "../runner-mutation-admission";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { isAbsolute } from 'node:path';
import { prepareBackupPostimages, readBackupManifest } from './backup-store.js';
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
  getEnabledCapabilityInstructionIds,
  prepareAndBuildDeveloperTeamInstallPlan,
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
  status: "synced" | "skipped" | "failed" | "deferred";
  /** Files the sync wrote, in the order they were applied. */
  filesWritten: readonly string[];
  /** Diagnostics surfaced by the adapter or this module. */
  diagnostics: readonly string[];
  /** Backup that should be retained while this sync outcome is current. */
  adapterBackup: unknown;
  /** True when the sync was a no-op because the runner is not installed. */
  skippedReason?: "not-detected";
};

/**
 * Full result returned by `runRunnerSync`.
 */
export type RunnerSyncResult = {
  /** An unrecognized/unsafe apply output has no verified postimage. */
  backupRecoveryRequired?: boolean;
  /** Post-admission failure, retaining the callback outcome and original errors. Never replay automatically. */
  recoveryError?: RunnerMutationCleanupError;
  outcomes: readonly RunnerSyncOutcome[];
  /** Updated manifest entries (paths + metadata) per file written. */
  manifestEntries: readonly ManifestFile[];
  /** Previously managed runner paths removed by an ownership-verified delete. */
  manifestRemovals?: readonly { path: string; owner: `runner:${string}` }[];
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
  /** Existing upgrade backup; receipts are captured at this plan's apply boundary. */
  backupId?: string;
  mutationAdmission?: RunnerMutationAdmission;
  retirement?: false | {roots: CleanupRoots; ask?: (question:string)=>Promise<string>};
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
  const progress = {outcomes:[] as RunnerSyncOutcome[],manifestEntries:[] as ManifestFile[],manifestRemovals:[] as Array<{path:string;owner:`runner:${string}`}>};
  try { return await (input.mutationAdmission ?? withIdleRunnerMutation)(async()=>{
    const result = await runAdmittedRunnerSync(input,progress);
    const entries = input.backupId ? readBackupManifest(input.backupId).entries : [];
    const unresolved = entries.filter(entry=>!entry.postimage);
    for (const outcome of result.outcomes) if (unresolved.some(entry=>entry.owner === `runner:${outcome.runnerId}`)) {
      outcome.status = 'failed';
      outcome.diagnostics = [...outcome.diagnostics,'Applied backup postimage is unknown; preserve files, receipts and unresolved recovery before retrying.'];
    }
    const incompleteWrites = entries.some(entry=>result.outcomes.some(outcome=>outcome.status === 'failed' && entry.owner === `runner:${outcome.runnerId}`)
      && entry.postimage?.sha256 !== (entry.checksumBefore?.value ?? null));
    return {...result,...(unresolved.length || incompleteWrites ? {backupRecoveryRequired:true} : {})};
  }); }
  catch (error) {
    if (error instanceof RunnerMutationCleanupError) {
      const diagnostic = error.operation.status === 'rejected'
        ? `${error.message} Original operation error: ${String(error.operation.reason)}` : error.message;
      // Keep completed receipts, removals, file lists and adapter backups even if
      // a later runner/manifest step threw. Cleanup failure is never a deferral.
      for (const outcome of progress.outcomes) {
        if (outcome.status !== 'skipped') outcome.status = 'failed';
        outcome.diagnostics = [...outcome.diagnostics,diagnostic];
      }
      for (const runnerId of input.runnerIds ?? input.registry.list().map(adapter=>adapter.runnerId)) {
        if (!progress.outcomes.some(outcome=>outcome.runnerId===runnerId)) progress.outcomes.push({runnerId,status:'failed',filesWritten:[],diagnostics:[diagnostic],adapterBackup:undefined});
      }
      return {...progress,recoveryError:error};
    }
    if (!(error instanceof RunnerMutationDeferredError)) throw error;
    return {outcomes:(input.runnerIds ?? input.registry.list().map(adapter=>adapter.runnerId)).map(runnerId=>({runnerId,status:'deferred',filesWritten:[],diagnostics:[error.message],adapterBackup:undefined})),manifestEntries:[]};
  }
}
async function runAdmittedRunnerSync(input: RunnerSyncInput, progress: {outcomes:RunnerSyncOutcome[];manifestEntries:ManifestFile[];manifestRemovals:Array<{path:string;owner:`runner:${string}`}>}): Promise<RunnerSyncResult> {
  const { config, registry, projectRoot, deckVersion } = input;
  const ids = input.runnerIds ?? registry.list().map((a) => a.runnerId);
  const {outcomes,manifestEntries,manifestRemovals} = progress;

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
    if (!detection.installed && !detection.replacementRequired) {
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

    let retirementDiagnostics: string[] = [];
    if (input.retirement !== false) {
      const roots = input.retirement?.roots ?? cleanupRoots();
      const preview = planRunnerCleanup(roots,[runnerId]);
      let rl: ReturnType<typeof createInterface> | undefined;
      const ask = input.retirement?.ask ?? (process.stdin.isTTY && process.stdout.isTTY
        ? (rl = createInterface({input:process.stdin,output:process.stdout}), (question:string)=>rl!.question(question)) : undefined);
      try {
        if (ask && preview.plans.some(plan=>plan.entries.length)) console.log(JSON.stringify(preview,null,2));
        const cleanup = await runRunnerCleanupUpdate(roots,[runnerId],{ask,admission:effect=>Promise.resolve(effect())});
        retirementDiagnostics = cleanup.flatMap(result=>result.status === 'complete' ? [] : [`Retirement ${result.status}: ${result.remaining} retained entries. ${result.diagnostic}`]);
        if (cleanup.some(result=>result.status === 'recovery-required' || result.status === 'deferred')) {
          outcomes.push({runnerId,status:'failed',filesWritten:[],diagnostics:retirementDiagnostics,adapterBackup:undefined});continue;
        }
      } finally {rl?.close();}
    }

    // 2. Read the user's package selections for this runner.
    const enabledIds: CapabilityInstructionPackageId[] =
      getEnabledCapabilityInstructionIds(config, runnerId);
    // 3. Build the capability instruction bundle. An empty selection still
    // synchronizes base roles, skills, bootstrap content, and instructions.
    const capabilityInstructions = enabledIds.includes("adaptive-memory")
      ? undefined
      : buildCapabilityInstructionBundle(enabledIds);

    // 4. Plan → backup → apply → verify.
    const plan: RunnerDeveloperTeamInstallPlan = await safeBuildPlan(adapter, {
      projectRoot,
      environmentId: (adapter.environmentIds[0] ?? "opencode-development") as never,
      deckConfig: config,
      capabilityInstructions,
      materializationScope: "content-only",
    });

    const adapterBackup = safeBackup(adapter, plan);
    // Retain recovery evidence before apply; subsequent accounting can fail too.
    const outcome: RunnerSyncOutcome = {runnerId,status:'failed',filesWritten:[],diagnostics:[],adapterBackup};
    outcomes.push(outcome);
    let applyResult: DeveloperTeamApplyResult;
    let account: (()=>void) | undefined;
    try {
      // Previews use physical adapter targets and include selection, settings and
      // ownership writes absent from the display files (which may be virtual).
      const changes = plan.mutationPreview?.map(m=>({sourcePath:m.path,sha256:m.postimage === 'absent' ? null : m.postimage}))
        ?? plan.files.map(file=>({sourcePath:file.path,sha256:createHash('sha256').update(file.content).digest('hex')}));
      if (input.backupId && changes.some(change=>!isAbsolute(change.sourcePath))) throw new Error('Backup requires absolute physical adapter targets; relative display paths cannot authorize recovery.');
      const accounts: Array<()=>void> = [];
      const beforeMetadataWrite: DeveloperTeamApplyInput['beforeMetadataWrite'] = input.backupId ? (path,sha256)=>{
        const next = prepareBackupPostimages(input.backupId!,[{sourcePath:path,sha256,owner:`runner:${runnerId}`,kind:'state'}]);
        accounts.push(next); return next;
      } : undefined;
      if (input.backupId) {
        accounts.push(prepareBackupPostimages(input.backupId,changes.map(change=>({...change,owner:`runner:${runnerId}` as const,kind:'config' as const}))));
        account = ()=>{ for (const next of accounts) next(); };
      }
      try { applyResult = await safeApply(adapter, {
        projectRoot,
        plan,
        environmentId: (adapter.environmentIds[0] ?? "opencode-development") as never,
        beforeMetadataWrite,
      }); } catch (applyError) {
        try { account?.(); } catch (accountError) {
          throw new AggregateError([applyError,accountError],`Apply failed: ${String(applyError)}; backup accounting failed: ${String(accountError)}`);
        }
        throw applyError;
      }
      account?.();
    } catch (err) {
      const diagnostics = [`applyDeveloperTeamInstall failed: ${(err as Error).message}`];
      if (adapterBackup !== undefined) {
        try {
          const rollback = await adapter.rollbackDeveloperTeamFiles(adapterBackup);
          account?.();
          if (rollback.status === "conflict") diagnostics.push(rollback.diagnostics.join("; ") || `Rollback conflicts: ${rollback.conflicts.join(", ")}`);
        } catch (rollbackError) {
          diagnostics.push(`rollbackDeveloperTeamFiles failed: ${(rollbackError as Error).message}`);
        }
      }
      Object.assign(outcome,{
        runnerId,
        status: "failed",
        filesWritten: [],
        diagnostics,
        adapterBackup,
      });
      continue;
    }

    const verify = await safeVerify(adapter, plan);

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
          const rollback = await adapter.rollbackDeveloperTeamFiles(adapterBackup);
          account?.();
          if (rollback.status === "conflict") throw new Error(rollback.diagnostics.join("; ") || `Rollback conflicts: ${rollback.conflicts.join(", ")}`);
        } catch (err) {
          Object.assign(outcome,{
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
      Object.assign(outcome,{
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
    const releasedPaths = new Set(plan.ownershipReleases ?? []);
    for (const path of releasedPaths) manifestRemovals.push({ path, owner: `runner:${runnerId}` });
    const filePaths: string[] = plan.files.filter(file => !releasedPaths.has(file.path)).map(file => file.path);
    outcome.filesWritten = filePaths;
    // The per-runner manifest owns granular contributions. The upgrade inventory only references
    // that verified manifest; shared user files must never become whole-file ownership records.
    if (applyResult.contributionManifestPath) {
      const path = applyResult.contributionManifestPath;
      manifestEntries.push({ path, owner: `runner:${runnerId}`, checksum: { algorithm: "sha256", value: createHash("sha256").update(readFileSync(path)).digest("hex") },
        deck_version: deckVersion, kind: "state", lastWrittenAt: new Date().toISOString() });
    }
    for (const mutation of plan.mutationPreview ?? []) {
      if (mutation.action === "delete") manifestRemovals.push({ path: mutation.path, owner: `runner:${runnerId}` });
    }

    Object.assign(outcome,{
      runnerId,
      status: "synced",
      filesWritten: filePaths,
      diagnostics: [...(verify.diagnostics ?? []), ...retirementDiagnostics],
      adapterBackup,
    });
  }

  return { outcomes, manifestEntries, manifestRemovals };
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
  let next = {
    ...manifest,
    files: manifest.files.filter((file) => !(result.manifestRemovals ?? []).some((removal) => removal.path === file.path && removal.owner === file.owner)),
  };
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

async function safeBuildPlan(
  adapter: RunnerAdapter,
  input: {
    projectRoot: string;
    environmentId: never;
    deckConfig: NormalizedDeckConfig;
    capabilityInstructions?: CapabilityInstructionBundle;
    materializationScope: "content-only";
  },
): Promise<RunnerDeveloperTeamInstallPlan> {
  try {
    return (await prepareAndBuildDeveloperTeamInstallPlan(adapter, input as never)).plan;
  } catch {
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

async function safeVerify(
  adapter: RunnerAdapter,
  plan: unknown,
): Promise<{ valid: boolean; diagnostics: readonly string[] }> {
  try {
    return await adapter.verifyDeveloperTeamInstall(plan);
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
