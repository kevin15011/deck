/**
 * GitHub release fetching for upgrade command.
 *
 * Fetches release information from GitHub API to check for newer versions.
 */

import { platform, arch } from "node:process";

import { spawnSync } from "../runtime/process.js";

// GitHub repository for deck
const GITHUB_OWNER = "gentleman-programming";
const GITHUB_REPO = "deck";

/**
 * Map Node.js platform to asset OS name.
 *
 * Aligns with CI release naming: linux/darwin (not macos/windows).
 */
function getOsName(platform: string): string {
  switch (platform) {
    case "darwin":
      return "darwin";
    case "win32":
      return "windows";
    case "linux":
    default:
      return "linux";
  }
}

/**
 * Map Node.js arch to asset arch name.
 *
 * Uses x64/arm64 to match CI release naming.
 */
function getArchName(arch: string): string {
  switch (arch) {
    case "x64":
      return "x64";
    case "arm64":
      return "arm64";
    case "ia32":
      return "x86";
    default:
      return arch;
  }
}

/**
 * Get target platform triple for asset lookup.
 *
 * Returns format: {OS}-{ARCH} matching CI release naming.
 * Example: darwin-arm64, linux-x64
 */
function getPlatformTriple(): string {
  const os = getOsName(platform);
  const archStr = getArchName(arch);
  return `${os}-${archStr}`;
}

/**
 * Error codes for upgrade command.
 */
export const UPGRADE_ERROR_CODES = {
  CHECKSUM_MISMATCH: "UPGRADE_CHECKSUM_MISMATCH",
  NETWORK_ERROR: "UPGRADE_NETWORK_ERROR",
  REPLACE_FAILED: "UPGRADE_REPLACE_FAILED",
  EXTRACT_FAILED: "UPGRADE_EXTRACT_FAILED",
} as const;

/**
 * Release information from GitHub API.
 */
export type ReleaseInfo = {
  /** Tag name (e.g., "v1.0.0") */
  tagName: string;
  /** Version number without v prefix */
  version: string;
  /** Download URL for the binary */
  downloadUrl: string;
  /** SHA-256 checksum (if available) */
  sha256: string;
  /** Release date */
  publishedAt: string;
  /** Release notes */
  body: string;
};

/**
 * Fetch the latest stable release from GitHub.
 *
 * @returns Release information or null if unavailable
 */
export async function fetchLatestRelease(): Promise<ReleaseInfo | null> {
  try {
    // Use curl to fetch GitHub API response
    // Using spawnSync for simplicity - avoid async complications
    const result = spawnSync("curl", [
      "-s",
      "-L",
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`,
    ]);

    if (result.exitCode !== 0 || !result.stdout) {
      console.error("Failed to fetch release:", result.stderr);
      return null;
    }

    const releaseData = JSON.parse(result.stdout as string);

    // Parse version and checksum first (before asset search)
    const tagName = releaseData.tag_name ?? "v0.0.0";
    const version = tagName.replace(/^v/, "");

    // Get checksum from release body or assets
    let sha256 = "";
    if (releaseData.body) {
      const shaMatch = releaseData.body.match(/sha256[:\s]+([a-f0-9]{64})/i);
      if (shaMatch) {
        sha256 = shaMatch[1].toLowerCase();
      }
    }

    // Extract asset for current platform
    // Format: deck_v{VERSION}_{OS}-{ARCH}.tar.gz
    // Example: deck_v1.0.0_darwin-x64.tar.gz
    const triple = getPlatformTriple(); // "darwin-x64", "linux-x64", etc.
    const assets = releaseData.assets ?? [];

    // Match: starts with deck_v and contains the platform triple
    const platformAsset = assets.find(
      (a: { name: string }) =>
        a.name &&
        a.name.startsWith("deck_v") &&
        a.name.includes(triple) &&
        a.name.endsWith(".tar.gz")
    );

    if (!platformAsset) {
      // Try fallback: just check for os prefix
      const osPrefix = getOsName(platform);
      const fallback = assets.find(
        (a: { name: string }) =>
          a.name && a.name.startsWith("deck_v") && a.name.includes(osPrefix) && a.name.endsWith(".tar.gz")
      );
      if (!fallback) {
        console.error(`No ${triple} binary found in release`);
        return null;
      }
      return {
        tagName,
        version,
        downloadUrl: fallback.browser_download_url,
        sha256,
        publishedAt: releaseData.published_at,
        body: releaseData.body ?? "",
      };
    }

    return {
      tagName,
      version,
      downloadUrl: platformAsset.browser_download_url,
      sha256,
      publishedAt: releaseData.published_at,
      body: releaseData.body ?? "",
    };
  } catch (err) {
    console.error("Error fetching release:", err);
    return null;
  }
}

/**
 * Compare semantic versions.
 *
 * @returns positive if current > latest, negative if current < latest, 0 if equal
 */
export function compareVersions(current: string, latest: string): number {
  const parseVersion = (v: string) => {
    // Remove v prefix if present
    const cleaned = v.replace(/^v/, "");
    // Split into parts and parse as numbers
    return cleaned.split(".").map((part) => {
      const num = parseInt(part, 10);
      return isNaN(num) ? 0 : num;
    });
  };

  const currentParts = parseVersion(current);
  const latestParts = parseVersion(latest);

  // Compare each part
  for (let i = 0; i < Math.max(currentParts.length, latestParts.length); i++) {
    const cur = currentParts[i] ?? 0;
    const lat = latestParts[i] ?? 0;

    if (cur > lat) return 1;
    if (cur < lat) return -1;
  }

  return 0;
}

/**
 * Check if an upgrade is available.
 *
 * @param currentVersion - The current version string
 * @returns True if upgrade is available
 */
export async function checkUpgradeAvailable(currentVersion: string): Promise<boolean> {
  const latestRelease = await fetchLatestRelease();

  if (!latestRelease) {
    return false;
  }

  // Refuse downgrade
  const cmp = compareVersions(currentVersion, latestRelease.version);
  return cmp < 0;
}

/**
 * Get latest release info.
 *
 * @returns Release info or null
 */
export async function getLatestReleaseInfo(): Promise<ReleaseInfo | null> {
  return fetchLatestRelease();
}