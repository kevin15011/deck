import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

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
  const runCommand = options.runCommand ?? runCommandSync;
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

function runCommandSync(command: string, args: string[]): CommandResult {
  try {
    const result = Bun.spawnSync([command, ...args], { stdout: "pipe", stderr: "pipe" });
    return { exitCode: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
  } catch (error) {
    return { exitCode: 1, stdout: "", stderr: error instanceof Error ? error.message : "Unable to run command." };
  }
}
