/**
 * Upgrade command orchestrator.
 *
 * Main entry point that coordinates version checking, GitHub fetching,
 * and installation.
 *
 * Delegates to the shared self-upgrade workflow when a release is available.
 */

import { getBuildInfo } from "../runtime/build-info.js";
import {
  fetchReleaseDescriptor,
  type ReleaseFetchResult,
  type ReleaseInfo,
} from "./github-release.js";
import { performUpgrade } from "./install.js";
import { runSelfUpgradeWorkflow, stageReleaseAssets, type OrchestratorResult } from "./orchestrator.js";
import type { ReleaseJson } from "./release-descriptor.js";

/**
 * CLI flags for upgrade command.
 */
export type UpgradeFlags = {
  /** Skip confirmation prompts */
  yes: boolean;
  /** Show version without upgrading */
  version: boolean;
};

type UpgradeRelease =
  | { kind: "descriptor"; descriptor: ReleaseJson }
  | { kind: "legacy"; info: ReleaseInfo };

export type UpgradeCommandDeps = {
  fetchReleaseDescriptor: () => ReleaseFetchResult;
  getBuildInfo: typeof getBuildInfo;
  getBinaryPath: () => string;
  stageReleaseAssets: typeof stageReleaseAssets;
  runSelfUpgradeWorkflow: typeof runSelfUpgradeWorkflow;
  performUpgrade: typeof performUpgrade;
};

const defaultDeps: UpgradeCommandDeps = {
  fetchReleaseDescriptor,
  getBuildInfo,
  getBinaryPath: () => process.execPath || process.argv[0] || "",
  stageReleaseAssets,
  runSelfUpgradeWorkflow,
  performUpgrade,
};

/**
 * Parse CLI arguments.
 */
function parseArgs(argv: string[]): UpgradeFlags {
  const flags: UpgradeFlags = {
    yes: false,
    version: false,
  };

  for (const arg of argv) {
    if (arg === "--yes" || arg === "-y") {
      flags.yes = true;
    } else if (arg === "--version" || arg === "-v") {
      flags.version = true;
    }
  }

  return flags;
}

/**
 * Confirm with user.
 *
 * If --yes flag is set, skip prompt and return true.
 * In non-TTY mode, return true automatically.
 * Otherwise prompt and wait for input.
 */
async function confirm(message: string, skip: boolean): Promise<boolean> {
  // If --yes flag set, skip prompt
  if (skip) {
    return true;
  }

  // Non-interactive mode: assume yes
  if (!process.stdin.isTTY) {
    return true;
  }

  // Prompt user and wait for input
  const readline = await import("node:readline");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(message + " [Y/n] ", (answer) => {
      rl.close();
      const normalized = answer.trim().toLowerCase();
      if (normalized === "n" || normalized === "no") {
        resolve(false);
      }
      // Default to yes for anything else
      resolve(true);
    });
  });
}

function resolveCliRelease(result: ReleaseFetchResult): UpgradeRelease | null {
  if (result.kind === "descriptor") {
    return { kind: "descriptor", descriptor: result.descriptor };
  }

  if (result.kind === "legacy") {
    // Only a release with no descriptor metadata is allowed to use the legacy
    // installer. Invalid or failed descriptor reads are security failures and
    // must not bypass the hardened workflow.
    if (result.reason === "missing" && !result.error) {
      return { kind: "legacy", info: result.info };
    }
    throw new Error(result.error ?? `release descriptor ${result.reason}`);
  }

  return null;
}

function resolveProgrammaticRelease(value: ReleaseInfo | ReleaseJson | string | undefined): UpgradeRelease | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  if (Array.isArray((value as ReleaseJson).items) && typeof (value as ReleaseJson).tag_name === "string") {
    return { kind: "descriptor", descriptor: value as ReleaseJson };
  }

  return { kind: "legacy", info: value as ReleaseInfo };
}

function releaseVersion(release: UpgradeRelease): string {
  return release.kind === "descriptor" ? release.descriptor.version : release.info.version;
}

function handleWorkflowResult(result: OrchestratorResult, version: string): number {
  if (result.status === "completed") {
    console.log(`Upgrade to ${version} completed.`);
    if (result.content.status === "completed") {
      console.log("Runner content synchronized.");
    } else if (result.content.status === "partial_failure") {
      console.log("Runner content partially synced - some runners may have issues.");
    }
    return 0;
  }

  if (result.status === "rolled_back") {
    console.error("Upgrade failed and was rolled back.");
    return 1;
  }

  console.log("Upgrade completed with some runner sync failures.");
  if (result.content.outcomes) {
    for (const [runnerId, outcome] of Object.entries(result.content.outcomes)) {
      if (outcome.status === "failed") {
        console.error(`  - ${runnerId}: ${outcome.diagnostics.join(", ")}`);
      }
    }
  }
  return 0;
}

/**
 * Run the upgrade process.
 */
export async function runUpgrade(
  argsOrCurrentVersion: string[] | string,
  latestReleaseOrCurrentVersion?: ReleaseInfo | ReleaseJson | string,
  currentBinaryPath?: string,
  deps: UpgradeCommandDeps = defaultDeps,
): Promise<number> {
  // Support both call signatures:
  // 1. runUpgrade(["--version", "--yes"]) — CLI/test style with args array
  // 2. runUpgrade(currentVersion, latestRelease, currentBinaryPath) — programmatic style
  let args: string[] = [];
  let currentVersion: string;
  let latestRelease: UpgradeRelease | undefined;
  let binaryPath: string;

  if (Array.isArray(argsOrCurrentVersion)) {
    args = argsOrCurrentVersion;
    currentVersion = "0.0.0";
    binaryPath = "";
  } else {
    currentVersion = argsOrCurrentVersion;
    latestRelease = resolveProgrammaticRelease(latestReleaseOrCurrentVersion);
    binaryPath = currentBinaryPath || "";
  }

  const flags = parseArgs(args);

  if (flags.version) {
    try {
      const buildInfo = deps.getBuildInfo();
      console.log(`deck version ${buildInfo.version}`);
    } catch {
      console.log("deck version unknown");
    }
    return 0;
  }

  if (Array.isArray(argsOrCurrentVersion)) {
    try {
      const buildInfo = deps.getBuildInfo();
      currentVersion = buildInfo.version;
      binaryPath = deps.getBinaryPath();
    } catch {
      currentVersion = "unknown";
      binaryPath = "";
    }

    try {
      latestRelease = resolveCliRelease(deps.fetchReleaseDescriptor()) ?? undefined;
    } catch (err) {
      console.error(`Release descriptor is invalid or unavailable: ${(err as Error).message}`);
      return 1;
    }
  }

  if (!binaryPath) {
    console.error("Could not determine current binary path.");
    return 1;
  }

  if (!latestRelease) {
    console.log("No release available or could not fetch release info.");
    return 0;
  }

  if (latestRelease.kind === "legacy") {
    if (!latestRelease.info.downloadUrl) {
      console.log("No upgrade package available for this platform.");
      return 0;
    }

    await deps.performUpgrade(
      {
        downloadUrl: latestRelease.info.downloadUrl,
        sha256: latestRelease.info.sha256,
      },
      binaryPath,
    );

    console.log("Restart deck to use the new version.");
    return 0;
  }

  const descriptor = latestRelease.descriptor;
  try {
    await deps.stageReleaseAssets(descriptor);
    const result = await deps.runSelfUpgradeWorkflow({
      descriptor,
      targetVersion: descriptor.version,
      currentVersion,
    });

    return handleWorkflowResult(result, releaseVersion(latestRelease));
  } catch (workflowErr) {
    console.error(`Upgrade workflow failed: ${(workflowErr as Error).message}`);
    return 1;
  }
}

/**
 * Main entry point.
 */
if (import.meta.main) {
  // Get args after --
  const args = process.argv.slice(2);
  runUpgrade(args).then((code) => {
    process.exit(code);
  }).catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
