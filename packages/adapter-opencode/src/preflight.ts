import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawnSync as nodeSpawnSync } from "node:child_process";
import type {
  RunnerInstallPreflightCheck,
  RunnerInstallPreflightSummary,
} from "@deck/core";
import { computePreflightSummary } from "@deck/core";

export type OpenCodePreflightResult = {
  version: string;
  configDirectory?: string;
  packageManifest?: string;
  existingConfiguration: boolean;
  checks?: RunnerInstallPreflightCheck[];
  summary?: RunnerInstallPreflightSummary;
};

type CommandResult = {
  exitCode: number;
  stdout: string;
  stderr?: string;
};

type InspectOpenCodeEnvironmentOptions = {
  command: string;
  homeDirectory?: string;
  runCommand?: (command: string, args: string[]) => CommandResult;
  pathExists?: (path: string) => boolean;
  readDir?: (path: string) => string[];
  /** Read file as string */
  readFile?: (path: string) => string;
  getStat?: (path: string) => { isDirectory: () => boolean; isFile: () => boolean };
  /** Enable structured preflight checks */
  includeChecks?: boolean;
};

export function inspectOpenCodeEnvironment(options: InspectOpenCodeEnvironmentOptions): OpenCodePreflightResult {
  const homeDirectory = options.homeDirectory ?? homedir();
  const runCommand = options.runCommand ?? runDefaultCommandSync;
  const pathExists = options.pathExists ?? existsSync;
  const readDir = options.readDir ?? readdirSync;
  const defaultReadFile = (path: string): string => {
    try {
      return readFileSync(path, "utf-8");
    } catch {
      return "";
    }
  };
  const readFile = options.readFile ?? defaultReadFile;
  const getStat = options.getStat ?? statSync;

  const versionResult = runCommand(options.command, ["--version"]);
  const versionOutput = versionResult.stdout.trim() || versionResult.stderr?.trim();
  const version = versionResult.exitCode === 0 && versionOutput ? versionOutput : "unknown";
  const configDirectory = getConfigDirectoryCandidates(homeDirectory).find((candidate) => pathExists(candidate));
  const packageManifest = configDirectory ? join(configDirectory, "package.json") : undefined;

  // Run structured preflight checks if enabled
  const checks = options.includeChecks
    ? runOpenCodePreflightChecks({
        homeDirectory,
        configDirectory,
        version,
        pathExists,
        readDir,
        readFile,
        getStat,
      })
    : undefined;

  const summary = checks ? computePreflightSummary(checks) : undefined;

  return {
    version,
    configDirectory,
    packageManifest: packageManifest && pathExists(packageManifest) ? packageManifest : undefined,
    existingConfiguration: Boolean(configDirectory),
    checks,
    summary,
  };
}

function getConfigDirectoryCandidates(homeDirectory: string): string[] {
  return [join(homeDirectory, ".config", "opencode"), join(homeDirectory, ".opencode")];
}

function runDefaultCommandSync(command: string, args: string[]): CommandResult {
  const result = nodeSpawnSync(command, args, { stdio: "pipe" as const, windowsHide: true });
  return { exitCode: result.status ?? 1, stdout: result.stdout?.toString() ?? "", stderr: result.stderr?.toString() ?? "" };
}

/**
 * Run OpenCode-specific preflight checks for installation readiness.
 */
function runOpenCodePreflightChecks(params: {
  homeDirectory: string;
  configDirectory?: string;
  version: string;
  pathExists: (path: string) => boolean;
  readDir: (path: string) => string[];
  readFile: (path: string) => string;
  getStat: (path: string) => { isDirectory: () => boolean; isFile: () => boolean };
}): RunnerInstallPreflightCheck[] {
  const checks: RunnerInstallPreflightCheck[] = [];
  const { homeDirectory, configDirectory, version, pathExists, readDir, readFile, getStat } = params;

  // 1. Config manifest presence check
  const packageManifestPath = configDirectory
    ? join(configDirectory, "package.json")
    : undefined;
  const manifestExists = packageManifestPath ? pathExists(packageManifestPath) : false;
  checks.push({
    id: "config-manifest-presence",
    runner: "opencode",
    status: manifestExists ? "pass" : "warn",
    severity: manifestExists ? "info" : "warning",
    message: manifestExists
      ? "OpenCode package.json exists."
      : "OpenCode package.json not found.",
    path: packageManifestPath,
    remediation: manifestExists
      ? undefined
      : "Run 'opencode init' to create configuration.",
  });

  // 2. Nested skills cleanup check (if skills directory exists)
  const skillsDir = join(homeDirectory, ".opencode", "skills");
  const nestedSkillsFound = checkNestedSkillsDirectory(skillsDir, pathExists, readDir, getStat);
  checks.push({
    id: "nested-skills-cleanup",
    runner: "opencode",
    status: nestedSkillsFound ? "warn" : "pass",
    severity: nestedSkillsFound ? "warning" : "info",
    message: nestedSkillsFound
      ? "Nested skills directory detected."
      : "No nested skills directories found.",
    path: nestedSkillsFound ? skillsDir : undefined,
    remediation: nestedSkillsFound
      ? "Remove nested SKILL.md directories in skills folder."
      : undefined,
  });

  // 3. Legacy SDD cleanup check (check in .opencode directories)
  const legacyFilesFound = checkLegacySddFiles(homeDirectory, pathExists, readDir);
  checks.push({
    id: "legacy-sdd-cleanup",
    runner: "opencode",
    status: legacyFilesFound ? "warn" : "pass",
    severity: legacyFilesFound ? "warning" : "info",
    message: legacyFilesFound
      ? "Legacy SDD agent files detected."
      : "No legacy SDD files found.",
    remediation: legacyFilesFound
      ? "Remove legacy sdd-*.md files."
      : undefined,
    diagnostics: legacyFilesFound ? ["Check .opencode/ for sdd-*.md"] : undefined,
  });

  // 4. Shared binary usability check
  const binaryUsable = version !== "unknown";
  checks.push({
    id: "shared-binary-usability",
    runner: "opencode",
    status: binaryUsable ? "pass" : "fail",
    severity: binaryUsable ? "info" : "error",
    message: binaryUsable
      ? `OpenCode binary usable (version ${version}).`
      : "OpenCode binary not found or not executable.",
    remediation: binaryUsable
      ? undefined
      : "Install OpenCode: npm install -g opencode",
  });

  return checks;
}

/**
 * Check for nested SKILL.md/SKILL.md directories in skills folder.
 */
function checkNestedSkillsDirectory(
  skillsDir: string,
  pathExists: (path: string) => boolean,
  readDir: (path: string) => string[],
  getStat: (path: string) => { isDirectory: () => boolean; isFile: () => boolean },
): boolean {
  if (!pathExists(skillsDir)) return false;

  try {
    const entries = readDir(skillsDir);
    for (const entry of entries) {
      const entryPath = join(skillsDir, entry);
      const nestedSkillMd = join(entryPath, "SKILL.md", "SKILL.md");
      if (pathExists(nestedSkillMd)) {
        return true;
      }
    }
  } catch {
    // Ignore errors
  }
  return false;
}

/**
 * Check for legacy SDD agent files (sdd-*.md).
 */
function checkLegacySddFiles(
  homeDirectory: string,
  pathExists: (path: string) => boolean,
  readDir: (path: string) => string[],
): boolean {
  const searchDirs = [join(homeDirectory, ".opencode")];

  for (const dir of searchDirs) {
    if (!pathExists(dir)) continue;
    try {
      const entries = readDir(dir);
      for (const entry of entries) {
        if (entry.startsWith("sdd-") && entry.endsWith(".md")) {
          return true;
        }
      }
    } catch {
      // Ignore errors
    }
  }
  return false;
}
