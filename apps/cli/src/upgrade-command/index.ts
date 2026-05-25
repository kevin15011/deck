/**
 * Upgrade command orchestrator.
 *
 * Main entry point that coordinates version checking, GitHub fetching,
 * and installation.
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
export async function runUpgrade(args: string[]): Promise<number> {
  const flags = parseArgs(args);

  // Get current version
  const buildInfo = getBuildInfo();
  const currentVersion = buildInfo.version;

  console.log(`Current version: ${currentVersion}`);

  // Check version flag
  if (flags.version) {
    return 0;
  }

  // Check for dev mode - refuse to upgrade when running via bun run
  const currentArgvZero = process.argv[0];
  if (
    currentArgvZero.includes("bun") ||
    currentArgvZero.includes("deno") ||
    currentArgvZero.includes("node")
  ) {
    console.error(
      "Refusing to upgrade: deck is running in development mode. " +
        "Please install the binary and run it directly to upgrade."
    );
    return 1;
  }

  // Fetch latest release from GitHub
  console.log("Checking for updates...");
  const latestRelease = await getLatestReleaseInfo();

  if (!latestRelease) {
    console.log("Could not fetch latest release. You may have a pre-release version.");
    return 0;
  }

  console.log(`Latest version: ${latestRelease.version}`);

  // Compare versions
  const cmp = compareVersions(currentVersion, latestRelease.version);

  if (cmp === 0) {
    console.log("You are already on the latest version!");
    return 0;
  }

  if (cmp > 0) {
    console.log("You are on a newer version than the latest release. Refusing to downgrade.");
    return 1; // Refuse downgrade
  }

  console.log(`Upgrading from ${currentVersion} to ${latestRelease.version}...`);

  // Confirm upgrade
  const confirmed = await confirm(
    `Upgrade to ${latestRelease.version}?`,
    flags.yes
  );

  if (!confirmed) {
    console.log("Upgrade cancelled.");
    return 0;
  }

  // Get current binary path
  const currentBinaryPath = process.argv[0];

  if (!currentBinaryPath || !existsSync(currentBinaryPath)) {
    console.error("Could not determine current binary path.");
    return 1;
  }

  try {
    await performUpgrade(
      {
        downloadUrl: latestRelease.downloadUrl,
        sha256: latestRelease.sha256,
      },
      currentBinaryPath
    );

    console.log("Restart deck to use the new version.");
    return 0;
  } catch (err) {
    if (err instanceof InstallError) {
      console.error(`Upgrade failed: ${err.message}`);
      return 1;
    }

    console.error("Unknown upgrade error:", err);
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