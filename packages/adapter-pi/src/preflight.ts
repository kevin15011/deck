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
import { resolvePiAgentDir } from "./agent-dir";
import { evaluatePiVersion, PI_UPGRADE_HINT, PI_MIN_VERSION, type PiVersionEvaluation } from "./pi-version";

export type PiPreflightResult = {
  version: string;
  /** Minimum-version evaluation of `pi --version` (Pi >= 1.0.0). */
  versionStatus?: PiVersionEvaluation;
  /** Resolved Pi agent directory (PI_CODING_AGENT_DIR or ~/.pi/agent) when valid. */
  agentDir?: string;
  /** Blocking diagnostic when PI_CODING_AGENT_DIR is empty or relative. */
  agentDirDiagnostic?: string;
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
  /** Environment used to resolve PI_CODING_AGENT_DIR; defaults to process.env. */
  env?: Readonly<Record<string, string | undefined>>;
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
  const env = options.env ?? process.env;
  const homeDirectory = options.homeDirectory ?? env.HOME ?? homedir();
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
  const versionStatus = evaluatePiVersion(versionResult.exitCode === 0 && versionOutput ? versionOutput : undefined);

  const agentDirResolution = resolvePiAgentDir(env, homeDirectory);
  const agentDir = agentDirResolution.ok ? agentDirResolution.dir : undefined;
  const agentDirDiagnostic = agentDirResolution.ok ? undefined : agentDirResolution.message;
  const configDirectory = agentDirResolution.ok
    ? getPiConfigCandidates(homeDirectory, agentDirResolution).find((candidate) => pathExists(candidate))
    : undefined;

  // Run structured preflight checks if enabled
  const checks = options.includeChecks
    ? runPiPreflightChecks({
        homeDirectory,
        agentDir,
        agentDirDiagnostic,
        versionStatus,
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
    versionStatus,
    ...(agentDir ? { agentDir } : {}),
    ...(agentDirDiagnostic ? { agentDirDiagnostic } : {}),
    configDirectory,
    existingConfiguration: Boolean(configDirectory),
    checks,
    summary,
  };
}

function getPiConfigCandidates(homeDirectory: string, resolution: Extract<ReturnType<typeof resolvePiAgentDir>, { ok: true }>): string[] {
  // An explicit PI_CODING_AGENT_DIR is the only candidate; legacy home locations are never consulted then.
  if (resolution.source === "env") return [resolution.dir];
  return [resolution.dir, join(homeDirectory, ".config", "pi"), join(homeDirectory, ".pi")];
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
  agentDir?: string;
  agentDirDiagnostic?: string;
  versionStatus: PiVersionEvaluation;
  configDirectory?: string;
  version: string;
  pathExists: (path: string) => boolean;
  readDir: (path: string) => string[];
  readFile: (path: string) => string;
  getStat: (path: string) => { isDirectory: () => boolean; isFile: () => boolean };
}): RunnerInstallPreflightCheck[] {
  const checks: RunnerInstallPreflightCheck[] = [];
  const { homeDirectory, agentDir, agentDirDiagnostic, versionStatus, configDirectory, version, pathExists, readDir, readFile, getStat } = params;

  // 0. Agent directory and minimum Pi version (blocking)
  checks.push({
    id: "pi-agent-dir",
    runner: "pi",
    status: agentDir ? "pass" : "fail",
    severity: agentDir ? "info" : "error",
    message: agentDir ? `Pi agent directory: ${agentDir}.` : (agentDirDiagnostic ?? "Pi agent directory could not be resolved."),
    path: agentDir,
    remediation: agentDir ? undefined : "Set PI_CODING_AGENT_DIR to an absolute directory or unset it.",
  });
  checks.push({
    id: "pi-min-version",
    runner: "pi",
    status: versionStatus.supported ? "pass" : "fail",
    severity: versionStatus.supported ? "info" : "error",
    message: versionStatus.supported
      ? `Pi ${versionStatus.version} satisfies the minimum version (>= ${PI_MIN_VERSION}).`
      : (versionStatus.diagnostic ?? `Pi >= ${PI_MIN_VERSION} is required.`),
    remediation: versionStatus.supported ? undefined : PI_UPGRADE_HINT,
  });

  // 1. MCP config persistence check
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

  // 3. Nested skills cleanup check (agent-dir skills; the pre-1.0 `~/.pi/skills` only for the default location)
  const effectiveAgentDir = agentDir ?? join(homeDirectory, ".pi", "agent");
  const skillsDirs = [join(effectiveAgentDir, "skills"), ...(agentDir && agentDir !== join(homeDirectory, ".pi", "agent") ? [] : [join(homeDirectory, ".pi", "skills")])];
  const nestedSkillsDir = skillsDirs.find((dir) => checkNestedSkillsDirectory(dir, pathExists, readDir, getStat));
  const nestedSkillsFound = nestedSkillsDir !== undefined;
  checks.push({
    id: "nested-skills-cleanup",
    runner: "pi",
    status: nestedSkillsFound ? "warn" : "pass",
    severity: nestedSkillsFound ? "warning" : "info",
    message: nestedSkillsFound
      ? "Nested skills directory detected."
      : "No nested skills directories found.",
    path: nestedSkillsDir,
    remediation: nestedSkillsFound
      ? "Remove nested SKILL.md directories in skills folder."
      : undefined,
  });

  // 4. Legacy SDD cleanup check
  const legacyFilesFound = checkLegacySddFiles(agentDir ?? join(homeDirectory, ".pi", "agent"), pathExists, readDir);
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
      : PI_UPGRADE_HINT,
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
  agentDir: string,
  pathExists: (path: string) => boolean,
  readDir: (path: string) => string[],
): boolean {
  const searchDirs = [agentDir, join(agentDir, "skills")];

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
