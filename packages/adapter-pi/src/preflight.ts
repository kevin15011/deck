import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawnSync as nodeSpawnSync } from "node:child_process";

export type PiPreflightResult = {
  version: string;
  configDirectory?: string;
  existingConfiguration: boolean;
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
};

export function inspectPiEnvironment(options: InspectPiEnvironmentOptions): PiPreflightResult {
  const homeDirectory = options.homeDirectory ?? homedir();
  const runCommand = options.runCommand ?? runDefaultCommandSync;
  const pathExists = options.pathExists ?? existsSync;

  const versionResult = runCommand(options.command, ["--version"]);
  const versionOutput = versionResult.stdout.trim() || versionResult.stderr?.trim();
  const version = versionResult.exitCode === 0 && versionOutput ? versionOutput : "unknown";

  const configDirectory = getPiConfigCandidates(homeDirectory).find((candidate) => pathExists(candidate));

  return {
    version,
    configDirectory,
    existingConfiguration: Boolean(configDirectory),
  };
}

function getPiConfigCandidates(homeDirectory: string): string[] {
  return [join(homeDirectory, ".pi", "agent"), join(homeDirectory, ".config", "pi"), join(homeDirectory, ".pi")];
}

function runDefaultCommandSync(command: string, args: string[]): CommandResult {
  const result = nodeSpawnSync(command, args, { stdout: "pipe", stderr: "pipe", windowsHide: true });
  return { exitCode: result.status ?? 1, stdout: result.stdout?.toString() ?? "", stderr: result.stderr?.toString() ?? "" };
}
