import { existsSync } from "node:fs";
import { createToolStatus, type EnvironmentToolStatus } from "./tool-status";

export type RequiredToolStatus = {
  name: string;
  installed: boolean;
};

export type PiRequiredToolsReview = {
  installedPackages: string[];
  requiredTools: RequiredToolStatus[];
  tools: EnvironmentToolStatus[];
  error?: string;
};

type CommandResult = {
  exitCode: number;
  stdout: string;
  stderr?: string;
};

type ReviewPiRequiredToolsOptions = {
  command: string;
  runCommand?: (command: string, args: string[]) => CommandResult;
  commandExists?: (command: string) => boolean;
};

const REQUIRED_TOOLS = [
  { name: "sub-agents", packageNames: ["sub-agents", "subagents", "pi-subagents"] },
  { name: "MCP packages", packageNames: ["mcp", "mcp-packages", "pi-mcp-adapter"] },
  { name: "context-mode", packageNames: ["context-mode"] },
  { name: "codebase-memory", packageNames: ["codebase-memory", "codebase-memory-mcp"] },
  { name: "RTK", packageNames: ["rtk"] },
  { name: "Context7", packageNames: ["context7", "pi-context7", "@dreki-gg/pi-context7"] },
  { name: "Engram memory", packageNames: ["engram"] },
];

export function reviewPiRequiredTools(options: ReviewPiRequiredToolsOptions): PiRequiredToolsReview {
  const runCommand = options.runCommand ?? runCommandSync;
  const commandExists = options.commandExists ?? commandExistsInPath;
  const result = runCommand(options.command, ["list"]);

  if (result.exitCode !== 0) {
    return {
      installedPackages: [],
      requiredTools: REQUIRED_TOOLS.map((tool) => ({ name: tool.name, installed: false })),
      tools: REQUIRED_TOOLS.map((tool) => createToolStatus(tool.name, "missing", "missing")),
      error: result.stderr?.trim() || result.stdout.trim() || "Unable to list Pi packages.",
    };
  }

  const installedPackages = parsePiList(result.stdout);
  if (commandExists("rtk")) {
    installedPackages.push("rtk");
  }
  if (commandExists("codebase-memory-mcp")) {
    installedPackages.push("codebase-memory-mcp");
  }
  if (commandExists("engram")) {
    installedPackages.push("engram");
  }
  const normalizedInstalled = new Set(installedPackages.map(normalizePackageName));

  const requiredTools = REQUIRED_TOOLS.map((tool) => ({
    name: tool.name,
    installed: tool.packageNames.some((packageName) => normalizedInstalled.has(normalizePackageName(packageName))),
  }));

  return {
    installedPackages,
    requiredTools,
    tools: requiredTools.map((tool) => createToolStatus(tool.name, tool.installed ? "found" : "missing", tool.installed ? "configured" : "missing")),
  };
}

function parsePiList(output: string): string[] {
  if (output.toLowerCase().includes("no packages installed")) {
    return [];
  }

  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.toLowerCase().endsWith("packages:"))
    .filter((line) => !line.startsWith("/"))
    .map((line) => line.replace(/^[-*•]\s*/, ""))
    .map((line) => line.replace(/^npm:/, ""));
}

function normalizePackageName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function commandExistsInPath(command: string): boolean {
  const path = process.env.PATH ?? "";
  return path.split(":").some((directory) => existsSync(`${directory}/${command}`));
}

function runCommandSync(command: string, args: string[]): CommandResult {
  try {
    const result = Bun.spawnSync([command, ...args], {
      stdout: "pipe",
      stderr: "pipe",
    });

    return {
      exitCode: result.exitCode,
      stdout: result.stdout.toString(),
      stderr: result.stderr.toString(),
    };
  } catch (error) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: error instanceof Error ? error.message : "Unable to run command.",
    };
  }
}
