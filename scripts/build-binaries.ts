#!/usr/bin/env bun
/// <reference types="bun" />
/**
 * Build Binaries Script.
 *
 * Compiles deck CLI into standalone tar.gz archives for distribution.
 *
 * Usage:
 *   bun run scripts/build-binaries.ts [--dry-run | --target <os-arch>]
 *
 * Options:
 *   --dry-run          Run on host platform only, don't build all targets
 *   --target <target>  Build one supported release target
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

export const ROOT = path.resolve(import.meta.dir, "..");
export const CLI_DIR = path.join(ROOT, "apps/cli");
export const OUTPUT_DIR = path.join(ROOT, "dist");
export const DIST_CLI_DIR = path.join(OUTPUT_DIR, "cli");

// Build targets: [os, arch, bunTarget]
export const BUILD_TARGETS = [
  ["linux", "x64", "bun-linux-x64"],
  ["linux", "arm64", "bun-linux-arm64"],
  ["darwin", "x64", "bun-darwin-x64"],
  ["darwin", "arm64", "bun-darwin-arm64"],
] as const;

export type BuildTarget = (typeof BUILD_TARGETS)[number];
export type EmbeddedBuildInfo = {
  version: string;
  commit: string;
  date: string;
  target: string;
  channel: "stable" | "beta" | "dev";
};

export interface BuildArgs {
  dryRun: boolean;
  help: boolean;
  target?: string;
}

export function getBuildTarget(targetName: string): BuildTarget {
  const target = BUILD_TARGETS.find(([osName, archName]) => `${osName}-${archName}` === targetName);
  if (!target) {
    throw new Error(`Unsupported build target: ${targetName}. Expected one of: ${BUILD_TARGETS.map(([osName, archName]) => `${osName}-${archName}`).join(", ")}.`);
  }
  return target;
}

export function parseBuildArgs(argv: string[]): BuildArgs {
  const args: BuildArgs = { dryRun: false, help: false };
  const rawArgs = argv.slice(2);

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index]!;
    if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else if (arg === "--dry-run") {
      args.dryRun = true;
    } else if (arg === "--target") {
      const target = rawArgs[index + 1];
      if (!target || target.startsWith("-")) throw new Error("--target requires a build target.");
      getBuildTarget(target);
      args.target = target;
      index += 1;
    } else if (arg.startsWith("--target=")) {
      const target = arg.slice("--target=".length);
      getBuildTarget(target);
      args.target = target;
    } else {
      throw new Error(`Unknown build argument: ${arg}`);
    }
  }

  if (args.dryRun && args.target) throw new Error("--dry-run cannot be combined with --target.");

  return args;
}

/**
 * Get version from package.json.
 */
export function getVersion(): string {
  const pkgPath = path.join(ROOT, "package.json");
  const content = fs.readFileSync(pkgPath, "utf-8");
  const pkg = JSON.parse(content);
  return pkg.version || "0.0.0";
}

export function getGitCommit(spawnSync: typeof Bun.spawnSync = Bun.spawnSync): string {
  const result = spawnSync({
    cmd: ["git", "rev-parse", "--short", "HEAD"],
    cwd: ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });
  return result.success ? new TextDecoder().decode(result.stdout).trim() || "unknown" : "unknown";
}

/**
 * Run generate-build-info for a specific target.
 */
export async function generateBuildInfo(target: string, version: string, commit?: string): Promise<void> {
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
      ...(commit ? ["--commit", commit] : []),
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
export async function generateSkillBundle(): Promise<void> {
  console.log(`  Generating skill bundle...`);
  const proc = Bun.spawnSync({
    cmd: ["bun", "run", path.join(ROOT, "scripts/generate-skill-bundle.ts")],
    cwd: ROOT,
  });

  if (!proc.success) {
    throw new Error(`generate-skill-bundle failed: ${new TextDecoder().decode(proc.stderr)}`);
  }
}

export async function generateRunnerExecutionAssets(): Promise<void> {
  const proc = Bun.spawnSync({
    cmd: ["bun", "run", path.join(ROOT, "scripts/generate-runner-execution-assets.ts")],
    cwd: ROOT,
  });
  if (!proc.success) {
    throw new Error(`generate-runner-execution-assets failed: ${new TextDecoder().decode(proc.stderr)}`);
  }
}

export function getHostBuildTarget(platform: NodeJS.Platform = os.platform(), arch: string = os.arch()): BuildTarget {
  const osName = platform === "darwin" ? "darwin" : platform === "linux" ? "linux" : undefined;
  const archName = arch === "x64" ? "x64" : arch === "arm64" ? "arm64" : undefined;
  const target = BUILD_TARGETS.find(([candidateOs, candidateArch]) => candidateOs === osName && candidateArch === archName);
  if (!target) throw new Error(`No target mapping for ${platform}-${arch}`);
  return target;
}

export async function prepareStandaloneBinaryBuild(target: BuildTarget, version: string): Promise<void> {
  await generateRunnerExecutionAssets();
  await generateBuildInfo(`${target[0]}-${target[1]}`, version);
  await generateSkillBundle();
}

/**
 * Build binary for a specific target.
 *
 * Release builds use 'deck' inside the archive for consistent extraction.
 * Developer-only canary builds may pass a different binaryName/outputDir;
 * release callers must keep the defaults so archive contents stay stable.
 * The archive filename follows the format: deck_v{VERSION}_{OS}-{ARCH}.tar.gz
 */
export async function buildBinary(
  osName: string,
  archName: string,
  bunTarget: string,
  version: string,
  options: {
    binaryName?: string;
    outputDir?: string;
    buildInfo?: EmbeddedBuildInfo;
    spawnSync?: typeof Bun.spawnSync;
  } = {},
): Promise<string> {
  const targetName = `${osName}-${archName}`;
  console.log(`  Building ${targetName} (${bunTarget})...`);

  // Default remains 'deck' for release archive compatibility.
  const binaryName = options.binaryName ?? "deck";
  const outputDir = options.outputDir ?? DIST_CLI_DIR;
  const outputPath = path.join(outputDir, binaryName);

  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Build the actual binary
  const cmd = [
      "bun",
      "build",
      "--compile",
      `--target=${bunTarget}`,
      "--outfile",
      outputPath,
  ];
  let env: NodeJS.ProcessEnv | undefined;
  if (options.buildInfo) {
    cmd.push("--env=DECK_COMPILED_BUILD_*");
    env = {
      ...process.env,
      DECK_COMPILED_BUILD_VERSION: options.buildInfo.version,
      DECK_COMPILED_BUILD_COMMIT: options.buildInfo.commit,
      DECK_COMPILED_BUILD_DATE: options.buildInfo.date,
      DECK_COMPILED_BUILD_TARGET: options.buildInfo.target,
      DECK_COMPILED_BUILD_CHANNEL: options.buildInfo.channel,
    };
  }
  cmd.push(path.join(CLI_DIR, "src/main.tsx"));

  const proc = (options.spawnSync ?? Bun.spawnSync)({
    cmd,
    cwd: ROOT,
    ...(env ? { env } : {}),
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
export function codeSign(
  binaryPath: string,
  deps: { platform?: NodeJS.Platform; spawnSync?: typeof Bun.spawnSync } = {},
): void {
  if ((deps.platform ?? os.platform()) !== "darwin") {
    throw new Error(`Cannot code sign Darwin binary on ${deps.platform ?? os.platform()}.`);
  }

  console.log(`  Codesigning ${path.basename(binaryPath)}...`);
  const spawnSync = deps.spawnSync ?? Bun.spawnSync;

  // Bun 1.3.12 emits a malformed placeholder signature on compiled Mach-O
  // binaries. Remove it before applying the release's ad-hoc signature.
  const remove = spawnSync({
    cmd: ["codesign", "--remove-signature", binaryPath],
    stdout: "pipe",
    stderr: "pipe",
  });
  if (!remove.success) {
    throw new Error(`codesign signature removal failed for ${binaryPath}: ${new TextDecoder().decode(remove.stderr).trim()}`);
  }

  const sign = spawnSync({
    cmd: ["codesign", "--force", "--sign", "-", binaryPath],
    stdout: "pipe",
    stderr: "pipe",
  });
  if (!sign.success) {
    throw new Error(`codesign failed for ${binaryPath}: ${new TextDecoder().decode(sign.stderr).trim()}`);
  }

  const verify = spawnSync({
    cmd: ["codesign", "--verify", "--deep", "--strict", "--verbose=2", binaryPath],
    stdout: "pipe",
    stderr: "pipe",
  });
  if (!verify.success) {
    throw new Error(`codesign verification failed for ${binaryPath}: ${new TextDecoder().decode(verify.stderr).trim()}`);
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
  await generateRunnerExecutionAssets();

  for (const [osName, archName, bunTarget] of targets) {
    const targetName = `${osName}-${archName}`;
    const buildInfo: EmbeddedBuildInfo = {
      version,
      commit: getGitCommit(),
      date: new Date().toISOString().split("T")[0]!,
      target: targetName,
      channel: "stable",
    };
    console.log(`=== Building ${targetName} ===`);

    // Step 1: Generate build info
    await generateBuildInfo(targetName, version, buildInfo.commit);

    // Step 2: Generate skill bundle
    await generateSkillBundle();

    // Step 3: Build binary
    const binaryPath = await buildBinary(osName, archName, bunTarget, version, { buildInfo });

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
  const args = parseBuildArgs(process.argv);

  if (args.help) {
    console.log(`Build deck binary releases.

Usage:
  bun run scripts/build-binaries.ts [options]

Options:
  --dry-run          Build only for current platform (testing)
  --target <target>  Build one of: ${BUILD_TARGETS.map(([osName, archName]) => `${osName}-${archName}`).join(", ")}
  --help, -h         Show this help message

Examples:
  bun run scripts/build-binaries.ts
  bun run scripts/build-binaries.ts --dry-run
  bun run scripts/build-binaries.ts --target darwin-arm64
`);
    process.exit(0);
  }

  const version = getVersion();
  console.log(`Version: ${version}`);

  if (args.target) {
    await buildBinaries([getBuildTarget(args.target)], version);
  } else if (args.dryRun) {
    // Dry run on host platform only
    const currentOs = os.platform();
    const currentArch = os.arch();

    const key = `${currentOs}-${currentArch}`;
    let target: BuildTarget;
    try {
      target = getBuildTarget(key);
    } catch {
      console.error(`No target mapping for ${key}`);
      process.exit(1);
    }

    console.log(`Dry run: ${key}`);
    await buildBinaries([target], version);

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
