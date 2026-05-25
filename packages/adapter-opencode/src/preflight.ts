import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawnSync as nodeSpawnSync } from "node:child_process";

export type OpenCodePreflightResult = {
  version: string;
  configDirectory?: string;
  packageManifest?: string;
  existingConfiguration: boolean;
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
};

export function inspectOpenCodeEnvironment(options: InspectOpenCodeEnvironmentOptions): OpenCodePreflightResult {
  const homeDirectory = options.homeDirectory ?? homedir();
  const runCommand = options.runCommand ?? runDefaultCommandSync;
  const pathExists = options.pathExists ?? existsSync;

  const versionResult = runCommand(options.command, ["--version"]);
  const versionOutput = versionResult.stdout.trim() || versionResult.stderr?.trim();
  const version = versionResult.exitCode === 0 && versionOutput ? versionOutput : "unknown";
  const configDirectory = getConfigDirectoryCandidates(homeDirectory).find((candidate) => pathExists(candidate));
  const packageManifest = configDirectory ? join(configDirectory, "package.json") : undefined;

  return {
    version,
    configDirectory,
    packageManifest: packageManifest && pathExists(packageManifest) ? packageManifest : undefined,
    existingConfiguration: Boolean(configDirectory),
  };
}

function getConfigDirectoryCandidates(homeDirectory: string): string[] {
  return [join(homeDirectory, ".config", "opencode"), join(homeDirectory, ".opencode")];
}

function runDefaultCommandSync(command: string, args: string[]): CommandResult {
  const result = nodeSpawnSync(command, args, { stdout: "pipe", stderr: "pipe", windowsHide: true });
  return { exitCode: result.status ?? 1, stdout: result.stdout?.toString() ?? "", stderr: result.stderr?.toString() };
}
