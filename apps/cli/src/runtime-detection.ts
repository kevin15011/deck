import { accessSync, constants } from "node:fs";
import { delimiter, join } from "node:path";

export type EnvironmentId = "pi-development" | "opencode-development" | "claude-development" | "codex-development";

export type RuntimeStatus = {
  environment: string;
  runtime: "pi" | "opencode" | "claude" | "codex";
  installed: boolean;
  command?: string;
};

type DetectRuntimeOptions = {
  commandExists?: (command: string) => boolean;
};

const ENVIRONMENT_RUNTIME_MAP: Record<EnvironmentId, Omit<RuntimeStatus, "installed" | "command"> & { candidates: string[] }> = {
  "pi-development": {
    environment: "Pi Development Environment",
    runtime: "pi",
    candidates: ["pi"],
  },
  "opencode-development": {
    environment: "OpenCode Development Environment",
    runtime: "opencode",
    candidates: ["opencode"],
  },
  "claude-development": {
    environment: "Claude Development Environment",
    runtime: "claude",
    candidates: ["claude"],
  },
  "codex-development": {
    environment: "Codex Development Environment",
    runtime: "codex",
    candidates: ["codex"],
  },
};

export function detectSelectedRuntimes(
  environments: EnvironmentId[],
  options: DetectRuntimeOptions = {},
): RuntimeStatus[] {
  const commandExists = options.commandExists ?? commandExistsInPath;

  return environments.map((environmentId) => {
    const definition = ENVIRONMENT_RUNTIME_MAP[environmentId];
    const command = definition.candidates.find((candidate) => commandExists(candidate));

    return {
      environment: definition.environment,
      runtime: definition.runtime,
      installed: Boolean(command),
      ...(command ? { command } : {}),
    };
  });
}

function commandExistsInPath(command: string): boolean {
  const path = process.env.PATH ?? "";

  return path.split(delimiter).some((directory) => {
    try {
      accessSync(join(directory, command), constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}
