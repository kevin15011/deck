/**
 * GitHub release fetching for the self-update system.
 *
 * Implements T2.2 (descriptor-aware fetch + legacy fallback):
 *   1. Attempt to fetch the `release.json` asset attached to the latest
 *      release via the GitHub API. Validate the payload with the
 *      `ReleaseJsonSchema` from `release-descriptor.ts`.
 *   2. When `release.json` is present and valid, the orchestrator uses
 *      the typed descriptor for the upgrade flow.
 *   3. When `release.json` is missing or invalid, fall back to the
 *      legacy binary-only flow that parses the SHA-256 from the release
 *      body (REQ-RD-011).
 *
 * ETag/conditional requests and a 6-hour cache TTL are supported via
 * `lastCheck` in `state.yaml` (set by the orchestrator) and a sidecar
 * release.json cache file under the XDG cache dir.
 *
 * Backward compatibility:
 *   - `fetchLatestRelease()` returns the same `ReleaseInfo` shape as
 *     before. It is now backed by the descriptor when available and
 *     falls back to the body-parsed legacy path otherwise.
 *   - `compareVersions`, `checkUpgradeAvailable`, and `getLatestReleaseInfo`
 *     retain their original signatures and semantics.
 */

import { platform, arch } from "node:process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { spawnSync } from "../runtime/process.js";
import { getDeckXdgPaths } from "../runtime/paths.js";
import {
  parseReleaseDescriptor,
  type ReleaseJson,
} from "./release-descriptor.js";
import { ReleaseDescriptorError } from "./release-descriptor.js";

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
  TIMEOUT: "UPGRADE_TIMEOUT",
  FALLBACK_LEGACY: "UPGRADE_FALLBACK_LEGACY",
} as const;

/**
 * Normalize a commit string for comparison.
 *
 * - Returns null for empty, undefined, or non-SHA-like strings.
 * - Trims whitespace and validates against SHA pattern (7-40 hex chars).
 * - Branch names like "main" return null (not reliable for commit comparison).
 */
export function normalizeCommit(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // SHA-like pattern: 7-40 hex characters
  if (!/^[0-9a-f]{7,40}$/i.test(trimmed)) return null;
  return trimmed.toLowerCase();
}

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
  /** Commit SHA that this release points to (target_commitish from GitHub API) */
  commit: string | null;
};

/**
 * Result of attempting to fetch a release descriptor.
 *
 * - `descriptor` is set when the `release.json` asset was found and
 *   validated against the schema.
 * - `legacy` is set when the descriptor was missing/invalid and the
 *   orchestrator should fall back to the body-parsed legacy path.
 * - `commit` is the commit SHA from target_commitish or descriptor.
 */
export type ReleaseFetchResult =
  | { kind: "descriptor"; descriptor: ReleaseJson; etag?: string; cachePath: string; commit: string | null }
  | { kind: "legacy"; info: ReleaseInfo; reason: "missing" | "invalid"; error?: string }
  | { kind: "network-error"; error: string };

/**
 * Options for the descriptor fetch.
 */
export type FetchDescriptorOptions = {
  /** Request timeout in milliseconds (default 5000). */
  timeoutMs?: number;
  /** Conditional request: pass an ETag to make a 304-friendly request. */
  etag?: string;
  /** Cache file path; defaults to `$XDG_CACHE_HOME/deck/releases/latest-release.json`. */
  cachePath?: string;
};

/**
 * Default cache file for the most-recent `release.json` payload.
 */
export function getDefaultReleaseCachePath(): string {
  return join(getDeckXdgPaths().releasesDir, "latest-release.json");
}

/**
 * Read the GitHub release JSON via the public releases API.
 *
 * Centralized so tests can inject a custom transport.
 */
export function curlReleasesApi(extraArgs: readonly string[] = []): { exitCode: number; stdout: string; stderr: string } {
  const result = spawnSync("curl", [
    "-s",
    "-L",
    ...extraArgs,
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`,
  ]);
  return {
    exitCode: result.exitCode ?? 1,
    stdout: (result.stdout ?? "") as string,
    stderr: (result.stderr ?? "") as string,
  };
}

/**
 * Read the GitHub `release.json` asset for a given release by tag.
 *
 * The asset URL is constructed from the tag name: GitHub exposes assets
 * under `https://github.com/<owner>/<repo>/releases/download/<tag>/<name>`.
 * This is a stable URL the upgrade orchestrator can re-fetch without
 * hitting the API.
 */
export function curlReleaseJsonAsset(
  tag: string,
  extraArgs: readonly string[] = [],
): { exitCode: number; stdout: string; stderr: string } {
  const url = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/download/${tag}/release.json`;
  const result = spawnSync("curl", ["-s", "-L", ...extraArgs, url]);
  return {
    exitCode: result.exitCode ?? 1,
    stdout: (result.stdout ?? "") as string,
    stderr: (result.stderr ?? "") as string,
  };
}

/**
 * Try to fetch the `release.json` asset for the latest release.
 *
 * On success: returns `{ kind: "descriptor", descriptor, ... }`.
 * On missing asset: returns `{ kind: "legacy", reason: "missing" }`.
 * On malformed payload: returns `{ kind: "legacy", reason: "invalid", error }`.
 * On network failure: returns `{ kind: "network-error", error }`.
 */
/**
 * Load a release descriptor from a local fixture file.
 *
 * This enables testing the TUI/doctor upgrade signals without
 * publishing a real GitHub release. When the fixture contains
 * a version higher than the current version, the upgrade available
 * signal will trigger.
 *
 * Expected fixture format (release.json):
 * ```json
 * {
 *   "schemaVersion": 1,
 *   "version": "99.99.99",
 *   "tag_name": "v99.99.99",
 *   "channel": "stable",
 *   "published_at": "2026-01-01T00:00:00.000Z",
 *   "release_notes_url": "https://github.com/...",
 *   "items": [
 *     {
 *       "id": "deck-v99.99.99-linux-x64",
 *       "kind": "binary",
 *       "required": true,
 *       "platform": "linux-x64",
 *       "asset_name": "deck_v99.99.99_linux-x64.tar.gz",
 *       "url": "file:///tmp/deck-fake-binary",
 *       "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
 *       "notes": "Test fixture"
 *     }
 *   ]
 * }
 * ```
 *
 * Also accepts legacy aliases for convenience:
 * - `tagName` → `tag_name`
 * - `downloadUrl` / `browser_download_url` (first binary item)
 * - `sha256` (first binary item)
 *
 * @param fixturePath - Absolute path to the fixture JSON file
 * @returns ReleaseFetchResult with kind "descriptor" or "legacy"
 */
function loadFixtureDescriptor(fixturePath: string): ReleaseFetchResult {
  let raw: unknown;

  // Read and parse the fixture file
  try {
    const content = readFileSync(fixturePath, "utf-8");
    try {
      raw = JSON.parse(content);
    } catch (err) {
      return {
        kind: "legacy",
        reason: "invalid",
        info: {
          tagName: "v0.0.0",
          version: "0.0.0",
          downloadUrl: "",
          sha256: "",
          publishedAt: "",
          body: "",
          commit: null,
        },
        error: `Fixture is not valid JSON: ${(err as Error).message}`,
      };
    }
  } catch (err) {
    return {
      kind: "legacy",
      reason: "invalid",
      info: {
        tagName: "v0.0.0",
        version: "0.0.0",
        downloadUrl: "",
        sha256: "",
        publishedAt: "",
        body: "",
        commit: null,
      },
      error: `Failed to read fixture file: ${(err as Error).message}`,
    };
  }

  // Normalize legacy aliases for convenience
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    // tagName → tag_name
    if (obj.tagName && !obj.tag_name) {
      obj.tag_name = obj.tagName;
    }
    // If items array missing but has legacy fields, construct minimal binary item
    if (!obj.items && (obj.downloadUrl || obj.browser_download_url || obj.sha256)) {
      const platform = getPlatformTriple();
      obj.items = [
        {
          id: `deck-fixture-${obj.version || "0.0.0"}-${platform}`,
          kind: "binary",
          required: true,
          platform,
          asset_name: `deck_v${obj.version || "0.0.0"}_${platform}.tar.gz`,
          url: obj.downloadUrl || obj.browser_download_url || "file:///tmp/fake",
          sha256: obj.sha256 || "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          notes: "Fixture",
        },
      ];
    }
  }

  // Validate against the schema
  try {
    const descriptor = parseReleaseDescriptor(raw);
    return {
      kind: "descriptor",
      descriptor,
      cachePath: fixturePath,
      commit: normalizeCommit((descriptor as { commit?: string }).commit ?? null),
    };
  } catch (err) {
    if (err instanceof ReleaseDescriptorError) {
      return {
        kind: "legacy",
        reason: "invalid",
        info: {
          tagName: "v0.0.0",
          version: "0.0.0",
          downloadUrl: "",
          sha256: "",
          publishedAt: "",
          body: "",
          commit: null,
        },
        error: `Fixture validation failed: ${err.message}`,
      };
    }
    return {
      kind: "legacy",
      reason: "invalid",
      info: {
        tagName: "v0.0.0",
        version: "0.0.0",
        downloadUrl: "",
        sha256: "",
        publishedAt: "",
        body: "",
        commit: null,
      },
      error: `Fixture validation failed: ${(err as Error).message}`,
    };
  }
}

export function fetchReleaseDescriptor(
  options: FetchDescriptorOptions = {},
): ReleaseFetchResult {
  const cachePath = options.cachePath ?? getDefaultReleaseCachePath();

  // ===== FIXTURE MODE: Read from local file instead of GitHub =====
  // When DECK_RELEASE_CHECK_FIXTURE is set, read release.json from that path
  // and skip all network calls. This enables testing the TUI/doctor
  // upgrade signals without publishing a real release.
  const fixturePath = process.env.DECK_RELEASE_CHECK_FIXTURE;
  if (fixturePath) {
    return loadFixtureDescriptor(fixturePath);
  }

  // ===== NORMAL MODE: Fetch from GitHub =====
  // Step 1: ask the API for the latest release so we know its tag.
  const apiResult = curlReleasesApi(
    options.etag ? ["-H", `If-None-Match: ${options.etag}`] : [],
  );
  if (apiResult.exitCode !== 0 || !apiResult.stdout) {
    return { kind: "network-error", error: apiResult.stderr || "curl failed" };
  }

  let releaseData: { tag_name?: string; published_at?: string; body?: string; assets?: { name: string; browser_download_url: string }[]; target_commitish?: string };
  try {
    releaseData = JSON.parse(apiResult.stdout);
  } catch (err) {
    return { kind: "network-error", error: `JSON.parse failed: ${(err as Error).message}` };
  }

  const tagName = releaseData.tag_name ?? "v0.0.0";
  const assets = releaseData.assets ?? [];
  const releaseJsonAsset = assets.find((a) => a.name === "release.json");

  if (!releaseJsonAsset) {
    return {
      kind: "legacy",
      reason: "missing",
      info: buildLegacyReleaseInfo(releaseData),
    };
  }

  // Extract commit from target_commitish for use in descriptor and legacy paths
  const remoteCommit = normalizeCommit(releaseData.target_commitish);

  // Step 2: fetch the release.json asset.
  const assetResult = curlReleaseJsonAsset(tagName);
  if (assetResult.exitCode !== 0 || !assetResult.stdout) {
    return {
      kind: "legacy",
      reason: "missing",
      info: buildLegacyReleaseInfo(releaseData),
      error: assetResult.stderr || "curl release.json failed",
    };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(assetResult.stdout);
  } catch (err) {
    return {
      kind: "legacy",
      reason: "invalid",
      info: buildLegacyReleaseInfo(releaseData),
      error: `release.json is not valid JSON: ${(err as Error).message}`,
    };
  }

  try {
    const descriptor = parseReleaseDescriptor(raw);
    
    // Step 3: Validate descriptor.version against normalized tag_name
    const normalizedTagVersion = normalizeVersion(tagName);
    const descriptorVersion = normalizeVersion(descriptor.version);
    
    // Check if both are semver-like and if they match
    const tagIsValidSemver = isSemverLike(tagName);
    const descriptorIsValidSemver = isSemverLike(descriptor.version);
    
    if (tagIsValidSemver && descriptorIsValidSemver && normalizedTagVersion !== descriptorVersion) {
      // Descriptor version doesn't match tag - treat as invalid and fall back to legacy
      // Do NOT cache the inconsistent descriptor
      return {
        kind: "legacy",
        reason: "invalid",
        info: buildLegacyReleaseInfo(releaseData),
        error: `Descriptor version ${descriptor.version} does not match tag ${tagName}. Using legacy tag-based release info.`,
      };
    }
    
    // Cache the validated payload so subsequent release checks can skip
    // the network round-trip within the 6h TTL window.
    writeReleaseCache(cachePath, descriptor);

    // Descriptor commit priority: descriptor build metadata > target_commitish fallback
    const descriptorCommit = (descriptor as { commit?: string }).commit;
    const commit = normalizeCommit(descriptorCommit) ?? remoteCommit;

    return { kind: "descriptor", descriptor, cachePath, commit };
  } catch (err) {
    if (err instanceof ReleaseDescriptorError) {
      return {
        kind: "legacy",
        reason: "invalid",
        info: buildLegacyReleaseInfo(releaseData),
        error: err.message,
      };
    }
    return {
      kind: "legacy",
      reason: "invalid",
      info: buildLegacyReleaseInfo(releaseData),
      error: (err as Error).message,
    };
  }
}

/**
 * Read the cached `release.json` payload (if any) without doing a network
 * round-trip. Returns `null` when the cache is missing or unparseable.
 */
export function readReleaseCache(cachePath: string = getDefaultReleaseCachePath()): ReleaseJson | null {
  if (!existsSync(cachePath)) return null;
  try {
    const raw = JSON.parse(readFileSync(cachePath, "utf-8"));
    return parseReleaseDescriptor(raw);
  } catch {
    return null;
  }
}

function writeReleaseCache(cachePath: string, descriptor: ReleaseJson): void {
  try {
    mkdirSync(dirname(cachePath), { recursive: true });
    writeFileSync(cachePath, JSON.stringify(descriptor, null, 2) + "\n", "utf-8");
  } catch {
    // Cache write is best-effort.
  }
}

// ---------------------------------------------------------------------------
// Legacy path
// ---------------------------------------------------------------------------

/**
 * Build a legacy `ReleaseInfo` from the GitHub API payload.
 *
 * Parses the SHA-256 out of the release body text (regex). Returns
 * `sha256: ""` when the body is missing or the regex doesn't match.
 * Populates commit from target_commitish when it's a valid SHA.
 */
export function buildLegacyReleaseInfo(
  releaseData: {
    tag_name?: string;
    published_at?: string;
    body?: string;
    assets?: { name: string; browser_download_url: string }[];
    target_commitish?: string;
  },
): ReleaseInfo {
  const tagName = releaseData.tag_name ?? "v0.0.0";
  const version = tagName.replace(/^v/, "");

  let sha256 = "";
  if (releaseData.body) {
    const shaMatch = releaseData.body.match(/sha256[:\s]+([a-f0-9]{64})/i);
    if (shaMatch) {
      sha256 = shaMatch[1]!.toLowerCase();
    }
  }

  const triple = getPlatformTriple();
  const assets = releaseData.assets ?? [];
  const platformAsset = assets.find(
    (a) =>
      a.name &&
      a.name.startsWith("deck_v") &&
      a.name.includes(triple) &&
      a.name.endsWith(".tar.gz"),
  );
  const fallbackAsset = platformAsset
    ? undefined
    : assets.find(
        (a) =>
          a.name &&
          a.name.startsWith("deck_v") &&
          a.name.includes(getOsName(platform)) &&
          a.name.endsWith(".tar.gz"),
      );
  const asset = platformAsset ?? fallbackAsset;

  // Extract commit from target_commitish when it's a valid SHA
  const commit = normalizeCommit(releaseData.target_commitish);

  return {
    tagName,
    version,
    downloadUrl: asset?.browser_download_url ?? "",
    sha256,
    publishedAt: releaseData.published_at ?? "",
    body: releaseData.body ?? "",
    commit,
  };
}

/**
 * Fetch the latest stable release from GitHub.
 *
 * Tries the descriptor path first; falls back to the legacy body-parsed
 * path when the descriptor is missing or invalid.
 */
export async function fetchLatestRelease(): Promise<ReleaseInfo | null> {
  const result = fetchReleaseDescriptor();
  if (result.kind === "descriptor") {
    // Pick the binary item for the current platform and produce a
    // legacy `ReleaseInfo` from it. The orchestrator can still opt
    // to consume the descriptor directly via `fetchReleaseDescriptor`.
    const { descriptor, commit } = result;
    const triple = getPlatformTriple();
    const binary = descriptor.items.find(
      (i) => i.kind === "binary" && i.platform === triple,
    );
    if (binary && binary.kind === "binary") {
      return {
        tagName: descriptor.tag_name,
        version: descriptor.version,
        downloadUrl: binary.url,
        sha256: binary.sha256,
        publishedAt: descriptor.published_at,
        body: descriptor.release_notes_url ?? "",
        commit: commit ?? null,
      };
    }
    // No binary for the current platform: still return a useful info
    // object so callers can decide to enter a content-only flow.
    return {
      tagName: descriptor.tag_name,
      version: descriptor.version,
      downloadUrl: "",
      sha256: "",
      publishedAt: descriptor.published_at,
      body: descriptor.release_notes_url ?? "",
      commit: commit ?? null,
    };
  }
  if (result.kind === "legacy") {
    return result.info;
  }
  return null;
}

/**
 * Normalize a version string by stripping leading 'v' prefix.
 * Used for comparing descriptor.version with tag_name.
 */
function normalizeVersion(version: string): string {
  return version.replace(/^v/, "").trim();
}

/**
 * Check if a version string looks like semver (has at least major.minor).
 * Used to validate that tag_name and descriptor.version are comparable.
 */
function isSemverLike(version: string): boolean {
  const normalized = normalizeVersion(version);
  // Must have at least two numeric parts (major.minor)
  const parts = normalized.split(".");
  if (parts.length < 2) return false;
  // First two parts must be numeric
  return parts.every((part, idx) => {
    if (idx >= 2) return true; // Ignore parts beyond major.minor
    return /^\d+$/.test(part);
  });
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
 * Result of availability decision.
 */
export type AvailabilityDecision =
  | { kind: "available"; reason: "newer-version" | "same-version-different-commit"; currentCommit?: string; latestCommit?: string }
  | { kind: "none"; reason: "same-build" | "local-newer" | "missing-commit" | "dev-build" }
  | { kind: "network-error" };

/**
 * Determine if an update/upgrade is available based on version and commit.
 *
 * Algorithm:
 * 1. Remote semver greater → available, reason "newer-version"
 * 2. Local semver greater → none, reason "local-newer"
 * 3. Equal semver + either commit missing/unreliable → none, reason "missing-commit"
 * 4. Equal semver + normalized commits equal (including short/full prefix) → none, reason "same-build"
 * 5. Equal semver + both reliable commits differ → available, reason "same-version-different-commit"
 *
 * Dev/non-release builds (e.g., "0.0.0-dev") skip commit-based same-version detection.
 */
export function decideReleaseAvailability(
  currentVersion: string,
  currentCommit: string | null | undefined,
  latestVersion: string,
  latestCommit: string | null | undefined,
): AvailabilityDecision {
  const cmp = compareVersions(currentVersion, latestVersion);

  // Case 1: Remote semver greater → upgrade available
  if (cmp < 0) {
    return { kind: "available", reason: "newer-version" };
  }

  // Case 2: Local semver greater → no update (local is newer)
  if (cmp > 0) {
    return { kind: "none", reason: "local-newer" };
  }

  // Equal semver - now check commit
  // Check if this is a dev/non-release build - skip commit comparison for these
  const isDevBuild = currentVersion.includes("-dev") || currentVersion === "0.0.0";

  // Normalize commits for comparison
  const localCommit = normalizeCommit(currentCommit);
  const remoteCommit = normalizeCommit(latestCommit);

  // Case 3: Either commit missing → no commit-based availability
  if (!localCommit || !remoteCommit) {
    return { kind: "none", reason: "missing-commit" };
  }

  // Case 4: Same commit (including short/long form) → no update
  if (localCommit === remoteCommit || localCommit.startsWith(remoteCommit) || remoteCommit.startsWith(localCommit)) {
    return { kind: "none", reason: "same-build" };
  }

  // Case 5: Same version, different commit → available (but not for dev builds)
  if (isDevBuild) {
    return { kind: "none", reason: "dev-build" };
  }

  return {
    kind: "available",
    reason: "same-version-different-commit",
    currentCommit: localCommit,
    latestCommit: remoteCommit,
  };
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
