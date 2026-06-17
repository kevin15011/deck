/**
 * Upgrade command orchestrator.
 *
 * Main entry point that coordinates version checking, GitHub fetching,
 * and installation.
 *
 * Delegates to the shared self-upgrade workflow when a release is available.
 */

import { existsSync } from "node:fs";
import { argv } from "node:process";

import { getBuildInfo } from "../runtime/build-info.js";
import {
  checkUpgradeAvailable,
  compareVersions,
  getLatestReleaseInfo,
  UPGRADE_ERROR_CODES,
  type ReleaseInfo,
} from "./github-release.js";
import { performUpgrade, InstallError } from "./install.js";
import { runSelfUpgradeWorkflow, detectInstallKind } from "./orchestrator.js";

/**
 * CLI flags for upgrade command.
 */
export type UpgradeFlags = {
  /** Skip confirmation prompts */
  yes: boolean;
  /** Show version without upgrading */
  version: boolean;
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

/**
 * Run the upgrade process.
 */
export async function runUpgrade(
  argsOrCurrentVersion: string[] | string,
  latestReleaseOrCurrentVersion?: string,
  currentBinaryPath?: string,
): Promise<number> {
  // Support both call signatures:
  // 1. runUpgrade(["--version", "--yes"]) — CLI/test style with args array
  // 2. runUpgrade(currentVersion, latestRelease, currentBinaryPath) — programmatic style
  let args: string[] = [];
  let currentVersion: string;
  let latestRelease: ReleaseInfo | undefined;
  let binaryPath: string;

  if (Array.isArray(argsOrCurrentVersion)) {
    // CLI/test style: runUpgrade(["--version"])
    args = argsOrCurrentVersion;
    // For CLI mode, we need to fetch release info
    currentVersion = "0.0.0"; // Will be fetched from build-info
    binaryPath = ""; // Will be determined
    latestRelease = undefined;
  } else {
    // Programmatic style: runUpgrade(currentVersion, latestRelease, currentBinaryPath)
    currentVersion = argsOrCurrentVersion;
    // Accept ReleaseInfo or string (for backward compatibility)
    latestRelease = typeof latestReleaseOrCurrentVersion === "object"
      ? latestReleaseOrCurrentVersion as ReleaseInfo
      : undefined;
    binaryPath = currentBinaryPath || "";
  }

  // Parse flags early to handle --version
  const flags = parseArgs(args);

  if (flags.version) {
    // Just show version and exit successfully
    // Try to get version from build-info, fallback to unknown
    try {
      const { getBuildInfo } = await import("../runtime/build-info.js");
      const buildInfo = getBuildInfo();
      console.log(`deck version ${buildInfo.version}`);
    } catch {
      console.log("deck version unknown");
    }
    return 0;
  }

  // For CLI mode, fetch release info now
  if (Array.isArray(argsOrCurrentVersion)) {
    try {
      const { getBuildInfo } = await import("../runtime/build-info.js");
      const buildInfo = getBuildInfo();
      currentVersion = buildInfo.version;

      // Use process.execPath as binary path (same as orchestrator does)
      binaryPath = process.execPath || process.argv[0] || "";
    } catch {
      currentVersion = "unknown";
      binaryPath = "";
    }

    try {
      const release = await getLatestReleaseInfo();
      latestRelease = release ?? undefined;
    } catch {
      latestRelease = undefined;
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

  // If no valid download URL, there's nothing to upgrade
  if (!latestRelease.downloadUrl) {
    console.log("No upgrade package available for this platform.");
    return 0;
  }

  // Detect install kind to decide which path to use
  const installKind = detectInstallKind(binaryPath);

  // Try to use the shared workflow for all install kinds
  // The workflow handles skipped-homebrew internally (skips binary replace, allows content sync)
  try {
    const result = await runSelfUpgradeWorkflow({
      descriptor: latestRelease,
      targetVersion: latestRelease.version,
      currentVersion: currentVersion,
    });

    if (result.status === "completed") {
      console.log(`Upgrade to ${latestRelease.version} completed.`);
      if (result.content.status === "completed") {
        console.log("Runner content synchronized.");
      } else if (result.content.status === "partial_failure") {
        console.log("Runner content partially synced - some runners may have issues.");
      }
      return 0;
    } else if (result.status === "rolled_back") {
      console.error("Upgrade failed and was rolled back.");
      return 1;
    } else if (result.status === "partial_failure") {
      // Partial failure means binary was replaced but some runners failed
      console.log("Upgrade completed with some runner sync failures.");
      if (result.content.outcomes) {
        for (const [runnerId, outcome] of Object.entries(result.content.outcomes)) {
          if (outcome.status === "failed") {
            console.error(`  - ${runnerId}: ${outcome.diagnostics.join(", ")}`);
          }
        }
      }
      return 0; // Not a complete failure
    }
  } catch (workflowErr) {
    // Log the error for diagnostics before falling back
    console.warn(`Workflow failed: ${(workflowErr as Error).message}`);
    console.log("Falling back to legacy upgrade path...");
  }

  // Legacy path: binary only (fallback for when workflow is unavailable)
  await performUpgrade(
    {
      downloadUrl: latestRelease.downloadUrl,
      sha256: latestRelease.sha256,
    },
    binaryPath
  );

  console.log("Restart deck to use the new version.");
  return 0;
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
