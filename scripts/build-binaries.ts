#!/usr/bin/env bun
/**
 * Build Binaries Script.
 *
 * Compiles deck CLI into standalone tar.gz archives for distribution.
 *
 * Usage:
 *   bun run scripts/build-binaries.ts [--dry-run]
 *
 * Options:
 *   --dry-run  Run on host platform only, don't build all targets
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const ROOT = path.resolve(import.meta.dir, "..");
const CLI_DIR = path.join(ROOT, "apps/cli");
const OUTPUT_DIR = path.join(ROOT, "dist");
const DIST_CLI_DIR = path.join(OUTPUT_DIR, "cli");

// Build targets: [os, arch, bunTarget]
const BUILD_TARGETS = [
  ["linux", "x64", "bun-linux-x64"],
  ["linux", "arm64", "bun-linux-arm64"],
  ["darwin", "x64", "bun-darwin-x64"],
  ["darwin", "arm64", "bun-darwin-arm64"],
] as const;

interface Args {
  dryRun: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { dryRun: false, help: false };
  const rawArgs = argv.slice(2);

  for (const arg of rawArgs) {
    if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else if (arg === "--dry-run") {
      args.dryRun = true;
    }
  }

  return args;
}

/**
 * Get version from package.json.
 */
function getVersion(): string {
  const pkgPath = path.join(ROOT, "package.json");
  const content = fs.readFileSync(pkgPath, "utf-8");
  const pkg = JSON.parse(content);
  return pkg.version || "0.0.0";
}

/**
 * Run generate-build-info for a specific target.
 */
async function generateBuildInfo(target: string, version: string): Promise<void> {
  console.log(`  Generating build info for ${target}...`);
  const proc = Bun.spawnSync({
    cmd: [
      "bun",
      "run",
      path.join(ROOT, "scripts/generate-build-info.ts"),
      "--version",
      version,
      "--target",
      target,
    ],
    cwd: ROOT,
  });

  if (!proc.success) {
    throw new Error(`generate-build-info failed for ${target}: ${new TextDecoder().decode(proc.stderr)}`);
  }
}

/**
 * Run generate-skill-bundle.
 */
async function generateSkillBundle(): Promise<void> {
  console.log(`  Generating skill bundle...`);
  const proc = Bun.spawnSync({
    cmd: ["bun", "run", path.join(ROOT, "scripts/generate-skill-bundle.ts")],
    cwd: ROOT,
  });

  if (!proc.success) {
    throw new Error(`generate-skill-bundle failed: ${new TextDecoder().decode(proc.stderr)}`);
  }
}

/**
 * Build binary for a specific target.
 *
 * The binary is always named 'deck' inside the archive for consistent extraction.
 * The archive filename follows the format: deck_v{VERSION}_{OS}-{ARCH}.tar.gz
 */
async function buildBinary(
  osName: string,
  archName: string,
  bunTarget: string,
  version: string
): Promise<string> {
  const targetName = `${osName}-${archName}`;
  console.log(`  Building ${targetName} (${bunTarget})...`);

  // Always use 'deck' as the binary name inside the archive
  const binaryName = "deck";
  const outputPath = path.join(DIST_CLI_DIR, binaryName);

  // Ensure output directory exists
  if (!fs.existsSync(DIST_CLI_DIR)) {
    fs.mkdirSync(DIST_CLI_DIR, { recursive: true });
  }

  // Build the actual binary
  const proc = Bun.spawnSync({
    cmd: [
      "bun",
      "build",
      "--compile",
      `--target=${bunTarget}`,
      "--outfile",
      outputPath,
      path.join(CLI_DIR, "src/main.tsx"),
    ],
    cwd: ROOT,
  });

  if (!proc.success) {
    throw new Error(`Build failed for ${targetName}: ${new TextDecoder().decode(proc.stderr)}`);
  }

  console.log(`  Built: ${binaryName}`);

  return outputPath;
}

/**
 * Get archive filename for a specific target.
 *
 * Format: deck_v{VERSION}_{OS}-{ARCH}.tar.gz
 * Examples: deck_v1.0.0_linux-x64.tar.gz, deck_v1.0.0_darwin-arm64.tar.gz
 */
function getArchiveFilename(version: string, osName: string, archName: string): string {
  return `deck_v${version}_${osName}-${archName}.tar.gz`;
}

/**
 * Code sign binary (macOS only).
 */
function codeSign(binaryPath: string): void {
  if (os.platform() !== "darwin") {
    return;
  }

  console.log(`  Codesigning ${path.basename(binaryPath)}...`);

  // Silent signing: codesign -s - (ad-hoc)
  const proc = Bun.spawnSync({
    cmd: ["codesign", "-s", "-", binaryPath],
  });

  if (!proc.success) {
    console.warn(`  Warning: codesign failed: ${new TextDecoder().decode(proc.stderr)}`);
  }
}

/**
 * Create tar.gz archive from binary.
 *
 * Uses consistent naming: deck_v{VERSION}_{OS}-{ARCH}.tar.gz
 */
function createArchive(binaryPath: string, version: string, osName: string, archName: string): string {
  const archiveName = getArchiveFilename(version, osName, archName);
  const archivePath = path.join(DIST_CLI_DIR, archiveName);

  console.log(`  Creating ${archiveName}...`);

  const proc = Bun.spawnSync({
    cmd: [
      "tar",
      "-czf",
      archivePath,
      "-C",
      DIST_CLI_DIR,
      path.basename(binaryPath),
    ],
  });

  if (!proc.success) {
    throw new Error(`tar failed: ${new TextDecoder().decode(proc.stderr)}`);
  }

  return archivePath;
}

/**
 * Calculate SHA-256 hash of a file.
 */
function sha256(filePath: string): string {
  const proc = Bun.spawnSync({
    cmd: ["sha256sum", filePath],
  });

  if (!proc.success) {
    // Fallback to shasum
    const fallback = Bun.spawnSync({
      cmd: ["shasum", "-a", "256", filePath],
    });
    if (!fallback.success) {
      throw new Error("sha256 calculation failed");
    }
    return new TextDecoder().decode(fallback.stdout).trim().split(" ")[0]!;
  }

  return new TextDecoder().decode(proc.stdout).trim().split(" ")[0]!;
}

/**
 * Main build function.
 */
async function buildBinaries(targets: readonly (readonly [string, string, string])[], version: string): Promise<void> {
  console.log(`Building deck binaries v${version}`);
  console.log(`Targets: ${targets.map(t => t[0] + "-" + t[1]).join(", ")}`);
  console.log("");

  // Ensure output directory exists
  if (!fs.existsSync(DIST_CLI_DIR)) {
    fs.mkdirSync(DIST_CLI_DIR, { recursive: true });
  }

  const checksums: string[] = [];

  for (const [osName, archName, bunTarget] of targets) {
    console.log(`=== Building ${osName}-${archName} ===`);

    // Step 1: Generate build info
    await generateBuildInfo(`${osName}-${archName}`, version);

    // Step 2: Generate skill bundle
    await generateSkillBundle();

    // Step 3: Build binary
    const binaryPath = await buildBinary(osName, archName, bunTarget, version);

    // Step 4: Code sign if macOS
    if (osName === "darwin") {
      codeSign(binaryPath);
    }

    // Step 5: Create archive
    const archivePath = createArchive(binaryPath, version, osName, archName);

    // Step 6: Generate checksum
    const hash = sha256(archivePath);
    const archiveName = path.basename(archivePath);
    checksums.push(`${hash}  ${archiveName}`);

    console.log("");
  }

  // Step 7: Write checksums.txt
  const checksumsPath = path.join(DIST_CLI_DIR, "checksums.txt");
  fs.writeFileSync(checksumsPath, checksums.join("\n") + "\n", "utf-8");
  console.log(`Written: ${checksumsPath}`);
  console.log("");

  console.log("=== Build Complete ===");
  console.log("Outputs:");
  for (const c of checksums) {
    console.log(`  ${c.split("  ")[1]}`);
  }
}

async function main() {
  const args = parseArgs(process.argv);

  if (args.help) {
    console.log(`Build deck binary releases.

Usage:
  bun run scripts/build-binaries.ts [options]

Options:
  --dry-run  Build only for current platform (testing)
  --help, -h  Show this help message

Examples:
  bun run scripts/build-binaries.ts
  bun run scripts/build-binaries.ts --dry-run
`);
    process.exit(0);
  }

  const version = getVersion();
  console.log(`Version: ${version}`);

  if (args.dryRun) {
    // Dry run on host platform only
    const currentOs = os.platform();
    const currentArch = os.arch();

    // Map to bun target
    const bunTargets: Record<string, string> = {
      "linux-x64": "bun-linux-x64",
      "linux-arm64": "bun-linux-arm64",
      "darwin-x64": "bun-darwin-x64",
      "darwin-arm64": "bun-darwin-arm64",
    };

    const key = `${currentOs}-${currentArch}`;
    const bunTarget = bunTargets[key];

    if (!bunTarget) {
      console.error(`No target mapping for ${key}`);
      process.exit(1);
    }

    console.log(`Dry run: ${key}`);
    await buildBinaries([[currentOs, currentArch, bunTarget]], version);

    // Print checksum for verification
    const checksumsPath = path.join(DIST_CLI_DIR, "checksums.txt");
    if (fs.existsSync(checksumsPath)) {
      console.log("");
      console.log("Verification (checksums.txt contents):");
      console.log(fs.readFileSync(checksumsPath, "utf-8"));
    }
  } else {
    // Full build for all targets
    await buildBinaries(BUILD_TARGETS, version);
  }
}

// Run if called directly
if (import.meta.main) {
  main().catch((err) => {
    console.error("Build failed:", err);
    process.exit(1);
  });
}