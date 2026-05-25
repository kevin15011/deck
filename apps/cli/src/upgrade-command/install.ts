/**
 * Installation logic for upgrade command.
 *
 * Handles downloading, tarball extraction, checksum verification, and atomic replace
 * with backup and rollback.
 */

import { basename, dirname, join } from "node:path";
import { existsSync, mkdirSync, renameSync, unlinkSync, chmodSync, rmdirSync } from "node:fs";

import { spawnAsync } from "../runtime/process.js";
import { UPGRADE_ERROR_CODES } from "./github-release.js";

/**
 * Installation error class.
 */
export class InstallError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "InstallError";
    this.code = code;
  }
}

/**
 * Paths involved in installation.
 */
export type InstallPaths = {
  /** Downloaded archive path */
  archivePath: string;
  /** Extracted binary path */
  extractedPath: string;
  /** Temporary extraction directory */
  tempDir: string;
  /** Backup of current binary */
  backupPath: string;
  /** Where the new binary should be installed */
  targetPath: string;
};

/**
 * Calculate SHA-256 hash of a file using Node.js crypto.
 */
async function calculateSha256(filePath: string): Promise<string> {
  return new Promise(async (resolve, reject) => {
    try {
      const { createReadStream } = await import("node:fs");
      const { createHash } = await import("node:crypto");

      const hash = createHash("sha256");
      const stream = createReadStream(filePath);

      stream.on("data", (chunk) => hash.update(chunk));
      stream.on("end", () => resolve(hash.digest("hex")));
      stream.on("error", reject);
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Download file from URL to a specific path.
 */
async function downloadFile(url: string, destPath: string): Promise<void> {
  const result = await spawnAsync("curl", ["-L", "-o", destPath, url]);

  if (result.exitCode !== 0) {
    throw new InstallError(
      UPGRADE_ERROR_CODES.NETWORK_ERROR,
      `Download failed: ${result.stderr}`
    );
  }

  if (!existsSync(destPath)) {
    throw new InstallError(
      UPGRADE_ERROR_CODES.NETWORK_ERROR,
      "Downloaded file not found"
    );
  }
}

/**
 * Extract the binary from a tar.gz archive.
 *
 * @param archivePath - Path to the .tar.gz file
 * @param destDir - Directory to extract to
 * @returns Path to the extracted binary
 */
async function extractTarball(archivePath: string, destDir: string): Promise<string> {
  const result = await spawnAsync("tar", ["-xzf", archivePath, "-C", destDir]);

  if (result.exitCode !== 0) {
    throw new InstallError(
      UPGRADE_ERROR_CODES.EXTRACT_FAILED,
      `Failed to extract archive: ${result.stderr}`
    );
  }

  // Find the extracted 'deck' binary in destDir
  const fs = await import("node:fs");
  const entries = fs.readdirSync(destDir);

  const deckBinary = entries.find((name) => name === "deck");
  if (!deckBinary) {
    throw new InstallError(
      UPGRADE_ERROR_CODES.EXTRACT_FAILED,
      "Extracted archive does not contain 'deck' binary"
    );
  }

  return join(destDir, deckBinary);
}

/**
 * Clean up a directory recursively.
 */
function cleanupDir(dirPath: string): void {
  if (existsSync(dirPath)) {
    try {
      rmdirSync(dirPath, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Make file executable.
 */
function makeExecutable(filePath: string): void {
  try {
    chmodSync(filePath, 0o755);
  } catch {
    throw new InstallError(
      UPGRADE_ERROR_CODES.REPLACE_FAILED,
      "Could not make downloaded file executable"
    );
  }
}

/**
 * Atomic replace with backup.
 *
 * 1. Rename current binary to .backup
 * 2. Move new binary to target
 * 3. Remove backup on success
 * 4. On failure, restore from backup
 */
async function atomicReplace(
  extractedPath: string,
  targetPath: string,
  backupPath: string
): Promise<void> {
  const targetDir = dirname(targetPath);

  // Ensure target directory exists
  if (!existsSync(targetDir)) {
    try {
      mkdirSync(targetDir, { recursive: true });
    } catch {
      // Ignore - might already exist
    }
  }

  // Step 1: Backup current binary if it exists
  if (existsSync(targetPath)) {
    try {
      // Remove old backup if exists
      if (existsSync(backupPath)) {
        unlinkSync(backupPath);
      }
      // Rename current to backup
      renameSync(targetPath, backupPath);
    } catch (err) {
      throw new InstallError(
        UPGRADE_ERROR_CODES.REPLACE_FAILED,
        `Backup failed: ${err}`
      );
    }
  }

  // Step 2: Rename extracted binary to target (single rename, same filesystem)
  try {
    renameSync(extractedPath, targetPath);
  } catch (err) {
    // Restore from backup on failure
    if (existsSync(backupPath)) {
      try {
        renameSync(backupPath, targetPath);
      } catch {
        // Rollback failed - critical failure
      }
    }
    throw new InstallError(
      UPGRADE_ERROR_CODES.REPLACE_FAILED,
      `Install failed: ${err}`
    );
  }

  // Step 3: Remove backup on success
  try {
    if (existsSync(backupPath)) {
      unlinkSync(backupPath);
    }
  } catch {
    // Best-effort cleanup - backup will be overwritten on next upgrade
  }
}

/**
 * Verify checksum of downloaded/extracted file.
 *
 * @param filePath - Path to file
 * @param expectedHash - Expected SHA-256 hash
 * @param allowMissing - If true, missing hash is allowed in dev mode
 */
async function verifyChecksum(
  filePath: string,
  expectedHash: string,
  allowMissing?: boolean
): Promise<boolean> {
  if (!expectedHash) {
    if (allowMissing) {
      // Dev/test mode: warn but continue
      console.warn("No SHA-256 checksum provided - skipping verification");
      return true;
    }
    // Binary mode: fail closed
    throw new InstallError(
      UPGRADE_ERROR_CODES.CHECKSUM_MISMATCH,
      "No SHA-256 checksum provided - refusing to install without verification"
    );
  }

  const actualHash = await calculateSha256(filePath);

  if (actualHash !== expectedHash.toLowerCase()) {
    throw new InstallError(
      UPGRADE_ERROR_CODES.CHECKSUM_MISMATCH,
      `Checksum mismatch: expected ${expectedHash}, got ${actualHash}`
    );
  }

  return true;
}

/**
 * Perform the upgrade.
 *
 * @param release - Release info from GitHub
 * @param currentBinaryPath - Path to current binary
 * @param opts - Optional flags
 * @returns True if upgrade succeeded
 */
export async function performUpgrade(
  release: { downloadUrl: string; sha256: string },
  currentBinaryPath: string,
  opts?: { allowMissingChecksum?: boolean }
): Promise<boolean> {
  const targetDir = dirname(currentBinaryPath);
  const now = Date.now();
  const tempDir = join(targetDir, `.deck-upgrade-${now}`);
  const archivePath = join(tempDir, "download.tar.gz");
  const extractedPath = join(tempDir, "deck");
  const backupPath = currentBinaryPath + ".backup";

  // Create temp directory
  mkdirSync(tempDir, { recursive: true });

  const paths: InstallPaths = {
    archivePath,
    extractedPath,
    tempDir,
    backupPath,
    targetPath: currentBinaryPath,
  };

  try {
    // Step 1: Download archive to temp dir
    console.log("Downloading...");
    await downloadFile(release.downloadUrl, archivePath);

    // Step 2: Extract tarball
    console.log("Extracting...");
    const binaryPath = await extractTarball(archivePath, tempDir);

    // Step 3: Verify checksum of extracted binary
    console.log("Verifying checksum...");
    await verifyChecksum(binaryPath, release.sha256, opts?.allowMissingChecksum);

    // Step 4: Make executable
    console.log("Making executable...");
    makeExecutable(binaryPath);

    // Step 5: Atomic replace
    console.log("Installing...");
    await atomicReplace(binaryPath, currentBinaryPath, backupPath);

    // Step 6: Clean up temp directory
    cleanupDir(tempDir);

    console.log("Upgrade complete!");
    return true;
  } catch (err) {
    console.error("Upgrade failed:", err);
    cleanupDir(tempDir);
    throw err;
  }
}

/**
 * Cancel upgrade and restore from backup.
 */
export function cancelUpgrade(backupPath: string, targetPath: string): void {
  if (existsSync(backupPath)) {
    try {
      if (existsSync(targetPath)) {
        unlinkSync(targetPath);
      }
      renameSync(backupPath, targetPath);
      console.log("Restored from backup.");
    } catch {
      console.error("Could not restore from backup.");
    }
  }
}