import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { spawnSync as nodeSpawnSync } from "node:child_process";
import type {
  RunnerInstallPreflightCheck,
  RunnerInstallPreflightSummary,
} from "@deck/core";
import {
  createEmptyPreflightSummary,
  computePreflightSummary,
} from "@deck/core";

export type PiPreflightResult = {
  version: string;
  configDirectory?: string;
  existingConfiguration: boolean;
  checks?: RunnerInstallPreflightCheck[];
  summary?: RunnerInstallPreflightSummary;
};

type CommandResult = {
  exitCode: number;
  stdout: string;
  stderr?: string;
};

type InspectPiEnvironmentOptions = {
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

export function inspectPiEnvironment(options: InspectPiEnvironmentOptions): PiPreflightResult {
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

  const configDirectory = getPiConfigCandidates(homeDirectory).find((candidate) => pathExists(candidate));

  // Run structured preflight checks if enabled
  const checks = options.includeChecks
    ? runPiPreflightChecks({
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
    existingConfiguration: Boolean(configDirectory),
    checks,
    summary,
  };
}

function getPiConfigCandidates(homeDirectory: string): string[] {
  return [join(homeDirectory, ".pi", "agent"), join(homeDirectory, ".config", "pi"), join(homeDirectory, ".pi")];
}

function runDefaultCommandSync(command: string, args: string[]): CommandResult {
  const result = nodeSpawnSync(command, args, { stdio: "pipe" as const, windowsHide: true });
  return { exitCode: result.status ?? 1, stdout: result.stdout?.toString() ?? "", stderr: result.stderr?.toString() ?? "" };
}

/**
 * Run Pi-specific preflight checks for installation readiness.
 */
function runPiPreflightChecks(params: {
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

  // 1. MCP config persistence check
  const mcpConfigPath = join(homeDirectory, ".pi", "mcp.json");
  const mcpConfigExists = configDirectory ? pathExists(join(configDirectory, "mcp.json")) : false;
  checks.push({
    id: "mcp-config-persistence",
    runner: "pi",
    status: mcpConfigExists ? "pass" : "fail",
    severity: mcpConfigExists ? "info" : "error",
    message: mcpConfigExists
      ? "Pi MCP config file exists."
      : "Pi MCP config file not found.",
    path: mcpConfigExists ? join(configDirectory ?? "", "mcp.json") : undefined,
    remediation: mcpConfigExists
      ? undefined
      : "Run 'pi init' to create MCP configuration.",
  });

  // 2. Stale package replacement check
  const settingsPath = configDirectory ? join(configDirectory, "settings.json") : undefined;
  let stalePackageFound = false;
  let staleDiagnostics: string[] = [];
  if (settingsPath && pathExists(settingsPath)) {
    try {
      const content = readFile(settingsPath);
      if (content.includes("@dreki-gg/pi-context7")) {
        stalePackageFound = true;
        staleDiagnostics.push("Found stale package: @dreki-gg/pi-context7");
      }
    } catch {
      // Ignore read errors
    }
  }
  checks.push({
    id: "stale-package-replacement",
    runner: "pi",
    status: stalePackageFound ? "warn" : "pass",
    severity: stalePackageFound ? "warning" : "info",
    message: stalePackageFound
      ? "Stale package reference found in settings."
      : "No stale packages detected.",
    path: settingsPath,
    remediation: stalePackageFound
      ? "Run 'pi doctor' to replace stale packages."
      : undefined,
    diagnostics: staleDiagnostics,
  });

  // 3. Nested skills cleanup check
  const skillsDir = join(homeDirectory, ".pi", "skills");
  const nestedSkillsFound = checkNestedSkillsDirectory(skillsDir, pathExists, readDir, getStat);
  checks.push({
    id: "nested-skills-cleanup",
    runner: "pi",
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

  // 4. Legacy SDD cleanup check
  const legacyFilesFound = checkLegacySddFiles(homeDirectory, pathExists, readDir);
  checks.push({
    id: "legacy-sdd-cleanup",
    runner: "pi",
    status: legacyFilesFound ? "warn" : "pass",
    severity: legacyFilesFound ? "warning" : "info",
    message: legacyFilesFound
      ? "Legacy SDD agent files detected."
      : "No legacy SDD files found.",
    remediation: legacyFilesFound
      ? "Remove legacy sdd-*.md files."
      : undefined,
    diagnostics: legacyFilesFound ? ["Check .pi/agent/ and skills/ for sdd-*.md"] : undefined,
  });

  // 5. Shared binary usability check
  const binaryUsable = version !== "unknown";
  checks.push({
    id: "shared-binary-usability",
    runner: "pi",
    status: binaryUsable ? "pass" : "fail",
    severity: binaryUsable ? "info" : "error",
    message: binaryUsable
      ? `Pi binary usable (version ${version}).`
      : "Pi binary not found or not executable.",
    remediation: binaryUsable
      ? undefined
      : "Install Pi: npm install -g @dreki-gg/pi-agent",
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
  const searchDirs = [
    join(homeDirectory, ".pi", "agent"),
    join(homeDirectory, ".pi", "skills"),
  ];

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
