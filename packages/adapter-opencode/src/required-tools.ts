import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createToolStatus, type EnvironmentToolStatus } from "./tool-status";

export type OpenCodeToolStatus = {
  name: string;
  installed: boolean;
};

export type OpenCodeToolsReview = {
  installedPackages: string[];
  tools: OpenCodeToolStatus[];
  toolStatuses: EnvironmentToolStatus[];
  error?: string;
};

type ReviewOpenCodeToolsOptions = {
  homeDirectory?: string;
  packageManifest?: string;
  configPath?: string;
  commandExists?: (command: string) => boolean;
  pathExists?: (path: string) => boolean;
  readFile?: (path: string) => string;
};

const OPENCODE_TOOLS = [
  { name: "RTK", packageNames: ["rtk"] },
  { name: "context-mode", packageNames: ["context-mode"] },
  { name: "codebase-memory", packageNames: ["codebase-memory", "codebase-memory-mcp"] },
  { name: "Context7", packageNames: ["context7", "@upstash/context7-mcp", "ctx7"] },
  { name: "Engram memory", packageNames: ["engram"] },
];

export function reviewOpenCodeTools(options: ReviewOpenCodeToolsOptions = {}): OpenCodeToolsReview {
  const homeDirectory = options.homeDirectory ?? homedir();
  const pathExists = options.pathExists ?? existsSync;
  const commandExists = options.commandExists ?? commandExistsInPath;
  const readFile = options.readFile ?? ((path: string) => readFileSync(path, "utf8"));
  const packageManifest = options.packageManifest ?? join(homeDirectory, ".config", "opencode", "package.json");
  const configPath = options.configPath ?? join(homeDirectory, ".config", "opencode", "opencode.json");

  if (!pathExists(packageManifest) && !pathExists(configPath)) {
    return {
      installedPackages: [],
      tools: OPENCODE_TOOLS.map((tool) => ({ name: tool.name, installed: false })),
      toolStatuses: OPENCODE_TOOLS.map((tool) => createToolStatus(tool.name, "missing", "missing")),
      error: "OpenCode package manifest not found.",
    };
  }

  try {
    const installedPackages = [
      ...(pathExists(packageManifest) ? readPackageManifestPackages(readFile(packageManifest)) : []),
      ...(pathExists(configPath) ? readOpenCodeConfigPackages(readFile(configPath)) : []),
      ...(commandExists("rtk") ? ["rtk"] : []),
      ...(commandExists("codebase-memory-mcp") ? ["codebase-memory-mcp"] : []),
      ...(commandExists("engram") ? ["engram"] : []),
    ];
    const normalizedInstalled = new Set(installedPackages.map(normalizePackageName));

    const tools = OPENCODE_TOOLS.map((tool) => ({
      name: tool.name,
      installed: tool.packageNames.some((packageName) => normalizedInstalled.has(normalizePackageName(packageName))),
    }));

    return {
      installedPackages,
      tools,
      toolStatuses: tools.map((tool) => createToolStatus(tool.name, tool.installed ? "found" : "missing", tool.installed ? "configured" : "missing")),
    };
  } catch (error) {
    return {
      installedPackages: [],
      tools: OPENCODE_TOOLS.map((tool) => ({ name: tool.name, installed: false })),
      toolStatuses: OPENCODE_TOOLS.map((tool) => createToolStatus(tool.name, "missing", "missing")),
      error: error instanceof Error ? error.message : "Unable to read OpenCode package manifest.",
    };
  }
}

function commandExistsInPath(command: string): boolean {
  const path = process.env.PATH ?? "";
  return path.split(":").some((directory) => {
    try {
      return existsSync(join(directory, command));
    } catch {
      return false;
    }
  });
}

function readPackageManifestPackages(content: string): string[] {
  const parsed = JSON.parse(content) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  return Object.keys({ ...(parsed.dependencies ?? {}), ...(parsed.devDependencies ?? {}) });
}

function readOpenCodeConfigPackages(content: string): string[] {
  const parsed = JSON.parse(content) as { mcp?: Record<string, unknown>; plugin?: string[] };
  return [...Object.keys(parsed.mcp ?? {}), ...(parsed.plugin ?? [])];
}

function normalizePackageName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9@/]+/g, "-").replace(/^-|-$/g, "");
}
