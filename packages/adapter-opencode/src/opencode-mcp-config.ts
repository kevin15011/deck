import { beginRunnerContributions, canonicalContributionJson, contributionHash, hasRunnerContributionProof } from "@deck/core";
import { chmodSync, existsSync, readFileSync, statSync, writeFileSync, appendFileSync, renameSync, unlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  SERENA_MCP_ARGS,
  validateSerenaReadinessEvidence,
  type SerenaReadinessEvidence,
  type SerenaMcpWriteStatus,
} from "@deck/core";
import { execSync } from "node:child_process";

export type OpenCodeMcpConfigValidationResult = {
  ok: boolean;
  path: string;
  serverName: string;
  projectScope?: string;
  diagnostics: string[];
};

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// Generic MCP server config writer
// ---------------------------------------------------------------------------

export type OpenCodeMcpServerType = "local" | "remote";

export type WriteOpenCodeMcpConfigOptions = {
  /** Exact shared candidates discovered for this reviewed operation, including rejected builds. */
  codebasePreviousCommands?: readonly string[];
  /** Name of the MCP server (e.g., "context7", "web-search") */
  serverName: string;
  /** Whether the server is local (npx command) or remote (URL) */
  type: OpenCodeMcpServerType;
  /** For local servers: the command to run (e.g., ["npx", "-y", "@upstash/context7-mcp"]) */
  command?: string[];
  /** For remote servers: the URL of the MCP server */
  url?: string;
  /** For remote servers: optional headers (e.g., Authorization) */
  headers?: Record<string, string>;
  /** Plugins to remove from the `plugin` array when writing MCP config (used for migration from plugin to MCP) */
  pluginsToRemove?: string[];
  /** Path to opencode.json (defaults to ~/.config/opencode/opencode.json) */
  configPath?: string;
  /** Home directory for default path resolution */
  homeDir?: string;
  /** Serena-only validated readiness handoff. Generic MCP callers do not use this. */
  serenaReadiness?: SerenaReadinessEvidence;
  /** Serena-only Deck-owned root used for containment validation. */
  ownedRoot?: string;
  /** Serena-only injectable atomic file boundary. */
  fileSystem?: OpenCodeMcpConfigFileSystem;
};

export type WriteOpenCodeMcpConfigResult = {
  ok: boolean;
  path: string;
  serverName: string;
  code?: string;
  diagnostics: string[];
  status?: SerenaMcpWriteStatus;
};

export type OpenCodeMcpConfigFileSystem = {
  exists: (path: string) => boolean;
  readFile: (path: string) => string;
  writeFile: (path: string, content: string, options?: { mode?: number }) => void;
  rename: (from: string, to: string) => void;
  unlink?: (path: string) => void;
  temporaryPath?: (configPath: string) => string;
  statMode?: (path: string) => number;
  chmod?: (path: string, mode: number) => void;
};

export type WriteSerenaOpenCodeMcpConfigOptions = {
  configPath?: string;
  homeDir?: string;
  serverName?: string;
  ownedRoot: string;
  readiness: SerenaReadinessEvidence;
  command: readonly string[];
  fileSystem?: OpenCodeMcpConfigFileSystem;
};

/**
 * Writes or updates a generic MCP server entry in OpenCode's opencode.json.
 *
 * Supports both local MCP servers (using command) and remote MCP servers (using url).
 *
 * Local example (context7):
 *   {
 *     "mcp": {
 *       "context7": {
 *         "type": "local",
 *         "command": ["npx", "-y", "@upstash/context7-mcp"],
 *         "enabled": true
 *       }
 *     }
 *   }
 *
 * Remote example:
 *   {
 *     "mcp": {
 *       "my-remote": {
 *         "type": "remote",
 *         "url": "https://mcp.example.com",
 *         "headers": { "Authorization": "Bearer {env:MY_TOKEN}" },
 *         "enabled": true
 *       }
 *     }
 *   }
 */
export function writeOpenCodeMcpConfig(
  options: WriteOpenCodeMcpConfigOptions,
): WriteOpenCodeMcpConfigResult {
  const homeDir = options.homeDir ?? process.env.HOME ?? "/home/user";
  const configPath = options.configPath ?? join(homeDir, ".config", "opencode", "opencode.json");
  const serverName = options.serverName.trim();

  const diagnostics: string[] = [];
  if (serverName === "serena" || serverName === "context-mode") return { ok: false, path: configPath, serverName, diagnostics: ["Retired capability is disabled; no configuration written."] };

  if (!serverName) {
    diagnostics.push("MCP server name is required.");
    return { ok: false, path: configPath, serverName: options.serverName, diagnostics };
  }

  if (serverName === "serena") {
    return writeSerenaOpenCodeMcpConfigInternal({
      configPath,
      serverName,
      ownedRoot: options.ownedRoot,
      readiness: options.serenaReadiness,
      command: options.command,
      fileSystem: options.fileSystem,
    });
  }

  if (options.type === "local" && !options.command) {
    diagnostics.push("Local MCP server requires a command array.");
    return { ok: false, path: configPath, serverName, diagnostics };
  }

  if (options.type === "remote" && !options.url) {
    diagnostics.push("Remote MCP server requires a URL.");
    return { ok: false, path: configPath, serverName, diagnostics };
  }

  let config: Record<string, unknown> = {};
  if (existsSync(configPath)) {
    try {
      const content = readFileSync(configPath, "utf-8");
      config = JSON.parse(content) as Record<string, unknown>;
    } catch (error) {
      diagnostics.push(`Unable to parse existing opencode.json: ${error instanceof Error ? error.message : String(error)}`);
      return { ok: false, path: configPath, serverName, diagnostics };
    }
  }

  if (serverName === "codebase-memory" && (!isPlainRecord(config) || config.mcp !== undefined && !isPlainRecord(config.mcp))) {
    return { ok: false, path: configPath, serverName, diagnostics: ["Codebase Memory MCP config is malformed; it was preserved."] };
  }

  const mcpSection = (config.mcp ?? {}) as Record<string, unknown>;

  if (serverName === "codebase-memory" && mcpSection[serverName] !== undefined) {
    const previous = mcpSection[serverName];
    const oldCommand = isPlainRecord(previous) && Array.isArray(previous.command) ? previous.command : [];
    const sameCommand = JSON.stringify(oldCommand) === JSON.stringify(options.command);
    const legacyCommand = oldCommand.length === 1 && (oldCommand[0] === "codebase-memory-mcp" || oldCommand[0] === join(homeDir, ".local", "bin", "codebase-memory-mcp") || (options.codebasePreviousCommands ?? []).includes(oldCommand[0] as string));
    const standard = isPlainRecord(previous) && previous.type === "local" && previous.enabled !== false
      && Object.keys(previous).every(key => ["type", "command", "enabled"].includes(key));
    if (!standard || !sameCommand && !legacyCommand) {
      return { ok: false, path: configPath, serverName, diagnostics: ["Codebase Memory MCP entry is custom or ambiguous; it was preserved."] };
    }
  }

  const serverEntry: Record<string, unknown> = {
    type: options.type,
    enabled: true,
  };

  if (options.type === "local" && options.command) {
    serverEntry.command = options.command;
  }

  if (options.type === "remote" && options.url) {
    serverEntry.url = options.url;
    serverEntry.oauth = false;
    if (options.headers) {
      serverEntry.headers = options.headers;
    }
  }

  mcpSection[serverName] = serverEntry;
  config.mcp = mcpSection;

  // Clean up legacy plugin entries if pluginsToRemove is specified
  // This handles migration from opencode-plugin to MCP server
  if (options.pluginsToRemove && options.pluginsToRemove.length > 0) {
    const existingPlugins = Array.isArray(config.plugin) ? config.plugin : [];
    const cleanedPlugins = existingPlugins.filter((p) => {
      if (typeof p !== "string" || !options.pluginsToRemove!.includes(p)) return true;
      const proven = hasRunnerContributionProof(join(dirname(configPath), "deck/manifest.json"), { path: configPath, selector: { kind: "json-array", keys: ["plugin"], identity: canonicalContributionJson(p) } });
      if (!proven) diagnostics.push(`Preserved ambiguous plugin entry in ${configPath}; review it individually before removal.`);
      return !proven;
    });

    if (cleanedPlugins.length > 0) {
      config.plugin = cleanedPlugins;
    } else if (existingPlugins.length > 0) {
      // If plugin array becomes empty after cleanup, keep as empty array
      // Don't delete the key to preserve explicit empty state
      config.plugin = [];
    }
  }

  const nextContent = JSON.stringify(config, null, 2);
  if (existsSync(configPath)) {
    try {
      if (readFileSync(configPath, "utf-8") === nextContent) {
        diagnostics.push(`MCP server '${serverName}' already configured in OpenCode at ${configPath}; no changes were written.`);
        return { ok: true, path: configPath, serverName, status: "unchanged", diagnostics };
      }
    } catch (error) {
      diagnostics.push(`Unable to re-read existing opencode.json before write: ${error instanceof Error ? error.message : String(error)}`);
      return { ok: false, path: configPath, serverName, diagnostics };
    }
  }

  try {
    const root = dirname(configPath);
    const accounting = beginRunnerContributions({ runnerId: "opencode", root, manifestPath: join(root, "deck/manifest.json"), deckVersion: "0.13.0",
      targets: [{ path: configPath, selector: { kind: "json", keys: ["mcp", serverName] }, expectedHash: contributionHash(canonicalContributionJson(serverEntry)), sourceItemId: `mcp:${serverName}` }] });
    const temporary = `${configPath}.deck-mcp-${process.pid}.tmp`;
    try {
      writeFileSync(temporary, nextContent, { encoding: "utf8", mode: 0o600, flag: "wx" });
      require("node:fs").renameSync(temporary, configPath);
      accounting.commit();
    } catch (error) { accounting.abandon(); throw error; } finally { if (existsSync(temporary)) require("node:fs").unlinkSync(temporary); }
    diagnostics.push(`MCP server '${serverName}' configured in OpenCode at ${configPath}.`);

    return { ok: true, path: configPath, serverName, diagnostics };
  } catch (error) {
    diagnostics.push(`Failed to write opencode.json: ${error instanceof Error ? error.message : String(error)}`);
    return { ok: false, path: configPath, serverName, diagnostics };
  }
}

/**
 * Atomically creates or updates only the Serena entry in OpenCode's MCP map.
 * The validated resolved executable is serialized verbatim; a bare `serena`
 * token is never accepted by this boundary.
 */
export function writeSerenaOpenCodeMcpConfig(
  options: WriteSerenaOpenCodeMcpConfigOptions,
): WriteOpenCodeMcpConfigResult {
  const homeDir = options.homeDir ?? process.env.HOME ?? "/home/user";
  const configPath = options.configPath ?? join(homeDir, ".config", "opencode", "opencode.json");
  const serverName = (options.serverName ?? "serena").trim();
  return writeSerenaOpenCodeMcpConfigInternal({
    configPath,
    serverName,
    ownedRoot: options.ownedRoot,
    readiness: options.readiness,
    command: options.command,
    fileSystem: options.fileSystem,
  });
}

function writeSerenaOpenCodeMcpConfigInternal(options: {
  configPath: string;
  serverName: string;
  ownedRoot?: string;
  readiness?: SerenaReadinessEvidence;
  command?: readonly string[];
  fileSystem?: OpenCodeMcpConfigFileSystem;
}): WriteOpenCodeMcpConfigResult {
  const fail = (code: string, message: string): WriteOpenCodeMcpConfigResult => ({
    ok: false,
    path: options.configPath,
    serverName: options.serverName,
    code,
    diagnostics: [message],
  });

  if (options.serverName !== "serena") return fail("invalid-server", "Serena writer requires server name 'serena'.");
  if (!options.ownedRoot || !options.readiness || !Array.isArray(options.command)) {
    return fail("invalid-readiness-evidence", "Serena configuration requires validated readiness evidence and an exact command array.");
  }
  if (!isSafeOwnedRoot(options.ownedRoot)) return fail("root-invalid", "Serena configuration requires a contained Deck-owned root.");

  const evidence = validateSerenaReadinessEvidence(options.readiness, options.ownedRoot);
  if (!evidence.valid) return fail(evidence.code, evidence.diagnostic.message);

  const command = [...options.command];
  if (
    command.length !== SERENA_MCP_ARGS.length + 1
    || command[0] !== evidence.evidence.resolvedExecutablePath
    || command.slice(1).some((arg, index) => arg !== SERENA_MCP_ARGS[index])
  ) {
    return fail("invalid-command", "Serena configuration requires the resolved executable and fixed MCP arguments.");
  }

  const fileSystem = options.fileSystem ?? defaultOpenCodeMcpConfigFileSystem();
  let existed = false;
  let config: Record<string, unknown> = {};
  try {
    existed = fileSystem.exists(options.configPath);
    if (existed) {
      const parsed: unknown = JSON.parse(fileSystem.readFile(options.configPath));
      if (!isPlainRecord(parsed)) return fail("malformed-config", "OpenCode MCP config must be a JSON object.");
      config = parsed;
    }
  } catch {
    return fail("malformed-config", "OpenCode MCP config could not be read or parsed.");
  }

  let mcp: Record<string, unknown> = {};
  if (Object.prototype.hasOwnProperty.call(config, "mcp")) {
    if (!isPlainRecord(config.mcp)) return fail("malformed-config", "OpenCode MCP config must contain an object 'mcp' map.");
    mcp = config.mcp;
  }

  const existing = mcp.serena;
  if (isKnownGoodSerenaEntry(existing, command)) {
    return {
      ok: true,
      path: options.configPath,
      serverName: options.serverName,
      status: "unchanged",
      diagnostics: [],
    };
  }

  const nextConfig: Record<string, unknown> = {
    ...config,
    mcp: {
      ...mcp,
      serena: {
        type: "local",
        command,
        enabled: true,
      },
    },
  };
  const tempPath = fileSystem.temporaryPath?.(options.configPath) ?? `${options.configPath}.deck-serena.tmp`;
  if (resolve(dirname(tempPath)) !== resolve(dirname(options.configPath))) {
    return fail("temporary-path-invalid", "Serena configuration temporary storage must share the config directory.");
  }

  try {
    fileSystem.writeFile(tempPath, JSON.stringify(nextConfig, null, 2));
    fileSystem.rename(tempPath, options.configPath);
  } catch {
    try { fileSystem.unlink?.(tempPath); } catch { /* preserve the known-good config */ }
    return fail("config-write-failed", "Serena MCP configuration was not changed.");
  }

  return {
    ok: true,
    path: options.configPath,
    serverName: options.serverName,
    status: existed ? "updated" : "created",
    diagnostics: [],
  };
}

function defaultOpenCodeMcpConfigFileSystem(): OpenCodeMcpConfigFileSystem {
  return {
    exists: existsSync,
    readFile: (path) => readFileSync(path, "utf8"),
    writeFile: (path, content, options) => writeFileSync(path, content, { encoding: "utf8", mode: options?.mode }),
    rename: renameSync,
    unlink: unlinkSync,
    statMode: (path) => statSync(path).mode,
    chmod: chmodSync,
  };
}

function isKnownGoodSerenaEntry(value: unknown, command: readonly string[]): boolean {
  if (!isPlainRecord(value)) return false;
  if (value.type !== "local" || value.enabled === false) return false;
  return Array.isArray(value.command)
    && value.command.length === command.length
    && value.command.every((part, index) => part === command[index]);
}

function isSafeOwnedRoot(root: string): boolean {
  if (!root.startsWith("/") || root === "/" || root.includes("\0") || root.split("/").some((part) => part === "..")) return false;
  return !new Set(["/bin", "/sbin", "/usr", "/opt", "/etc", "/var", "/root"]).has(root.replace(/\/$/u, ""));
}
