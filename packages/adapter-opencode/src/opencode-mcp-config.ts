import { existsSync, readFileSync, writeFileSync, appendFileSync, renameSync, unlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  SERENA_MCP_ARGS,
  resolveCanonicalSupermemoryProjectScope,
  validateSerenaReadinessEvidence,
  type SerenaReadinessEvidence,
  type SerenaMcpWriteStatus,
} from "@deck/core";
import { execSync } from "node:child_process";

export const SUPERMEMORY_MCP_SERVER_NAME = "supermemory";
export const SUPERMEMORY_MCP_URL = "https://mcp.supermemory.ai/mcp";
const CANONICAL_SUPERMEMORY_PROJECT_SCOPE = /^sm_project_v1_[a-z0-9]+_[a-z0-9]+(?:_[a-z0-9]+)*$/;

export type OpenCodeMcpConfigValidationResult = {
  ok: boolean;
  path: string;
  serverName: string;
  projectScope?: string;
  diagnostics: string[];
};

/**
 * Validates the Supermemory MCP server entry in OpenCode's opencode.json.
 *
 * OpenCode MCP format (remote) with native OAuth discovery:
 *   {
 *     "mcp": {
 *       "supermemory": {
 *         "type": "remote",
 *         "url": "https://mcp.supermemory.ai/mcp",
 *         "headers": {
 *           "x-sm-project": "sm_project_example"
 *         }
 *       }
 *     }
 *   }
 *
 * OpenCode owns OAuth credentials outside project configuration. Deck only
 * installs the endpoint and project scope; the runner discovers authentication
 * and prompts once through `/connect` or `opencode mcp auth supermemory`.
 *
 * @param options.configPath - Override the default opencode.json path.
 * @param options.serverName - Override the MCP server entry name (default: "supermemory").
 * @param options.homeDir - Override home directory for default path resolution.
 */
export function validateSupermemoryOpenCodeMcpConfig(
  options: { configPath?: string; serverName?: string; homeDir?: string } = {},
): OpenCodeMcpConfigValidationResult {
  const homeDir = options.homeDir ?? process.env.HOME ?? "/home/user";
  const configPath = options.configPath ?? join(homeDir, ".config", "opencode", "opencode.json");
  const serverName = (options.serverName ?? SUPERMEMORY_MCP_SERVER_NAME).trim() || SUPERMEMORY_MCP_SERVER_NAME;

  if (!existsSync(configPath)) {
    return {
      ok: false,
      path: configPath,
      serverName,
      diagnostics: [`OpenCode MCP config is missing at '${configPath}'; Supermemory tools were not injected.`],
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(configPath, "utf-8"));
  } catch (error) {
    return {
      ok: false,
      path: configPath,
      serverName,
      diagnostics: [`OpenCode MCP config contains malformed JSON; Supermemory tools were not injected: ${error instanceof Error ? error.message : String(error)}`],
    };
  }

  if (!isPlainRecord(parsed) || !isPlainRecord(parsed.mcp)) {
    return {
      ok: false,
      path: configPath,
      serverName,
      diagnostics: [`OpenCode MCP config must contain an object 'mcp' map; Supermemory tools were not injected.`],
    };
  }

  const mcpSection = parsed.mcp as Record<string, unknown>;
  const serverEntry = mcpSection[serverName];

  if (!isPlainRecord(serverEntry)) {
    return {
      ok: false,
      path: configPath,
      serverName,
      diagnostics: [`OpenCode MCP config is missing server entry '${serverName}'; Supermemory tools were not injected.`],
    };
  }

  if ((serverEntry as Record<string, unknown>).type !== "remote") {
    return {
      ok: false,
      path: configPath,
      serverName,
      diagnostics: [`OpenCode MCP server '${serverName}' must have type 'remote'; Supermemory tools were not injected.`],
    };
  }

  const url = (serverEntry as Record<string, unknown>).url;
  if (typeof url !== "string" || !url.trim()) {
    return {
      ok: false,
      path: configPath,
      serverName,
      diagnostics: [`OpenCode MCP server '${serverName}' has missing or empty URL; Supermemory tools were not injected.`],
    };
  }

  // Validate URL: reject deprecated/custom URLs (REQ-OMC-004)
  const trimmedUrl = url.trim().toLowerCase();
  const validUrls = ["https://mcp.supermemory.ai/mcp"];
  const deprecatedUrls = [
    "https://supermemory-new.stlmcp.com",
    "https://supermemory.stlmcp.com",
  ];

  if (validUrls.includes(trimmedUrl)) {
    // Valid URL - proceed
  } else if (deprecatedUrls.includes(trimmedUrl)) {
    return {
      ok: false,
      path: configPath,
      serverName,
      diagnostics: [`OpenCode MCP server '${serverName}' uses deprecated URL; please use '${SUPERMEMORY_MCP_URL}' instead.`],
    };
  } else {
    return {
      ok: false,
      path: configPath,
      serverName,
      diagnostics: [`OpenCode MCP server '${serverName}' uses unrecognized URL; expected '${SUPERMEMORY_MCP_URL}'.`],
    };
  }

  if ((serverEntry as Record<string, unknown>).oauth === false) {
    return {
      ok: false,
      path: configPath,
      serverName,
      diagnostics: [`OpenCode MCP server '${serverName}' must leave OAuth enabled; remove 'oauth: false' and authenticate through OpenCode.`],
    };
  }

  const headers = (serverEntry as Record<string, unknown>).headers;
  if (!isPlainRecord(headers)) {
    return {
      ok: false,
      path: configPath,
      serverName,
      diagnostics: [`OpenCode MCP server '${serverName}' must have a headers object containing 'x-sm-project'; Supermemory tools were not injected.`],
    };
  }

  if (Object.prototype.hasOwnProperty.call(headers, "Authorization")) {
    return {
      ok: false,
      path: configPath,
      serverName,
      diagnostics: [`OpenCode MCP server '${serverName}' must not persist an Authorization header; OpenCode manages Supermemory OAuth credentials outside opencode.json.`],
    };
  }

  const projectHeader = headers["x-sm-project"];
  if (typeof projectHeader !== "string" || !CANONICAL_SUPERMEMORY_PROJECT_SCOPE.test(projectHeader.trim())) {
    return {
      ok: false,
      path: configPath,
      serverName,
      diagnostics: [`OpenCode MCP server '${serverName}' must include a canonical 'x-sm-project' header; Supermemory tools were not injected.`],
    };
  }

  return {
    ok: true,
    path: configPath,
    serverName,
    projectScope: projectHeader.trim(),
    diagnostics: [],
  };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type WriteSupermemoryOpenCodeMcpConfigResult = {
  ok: boolean;
  path: string;
  serverName: string;
  diagnostics: string[];
};

/**
 * Appends the SUPERMEMORY_API_KEY export statement to shell config files.
 * Handles both macOS (zsh/.zshrc) and Linux (bash/.bashrc).
 */
export function appendSupermemoryEnvToShellConfig(
  options: { token: string; homeDir?: string },
): { ok: boolean; shellConfigs: string[] } {
  const homeDir = options.homeDir ?? process.env.HOME ?? "/home/user";
  const exportLine = `export SUPERMEMORY_API_KEY="${options.token}"\n`;

  const results: string[] = [];
  let allOk = true;

  // zsh is the default shell on macOS; bash is common on Linux
  // We write to both for maximum compatibility
  const shellConfigs = [
    { path: join(homeDir, ".zshrc"), name: ".zshrc" },
    { path: join(homeDir, ".bashrc"), name: ".bashrc" },
  ];

  for (const config of shellConfigs) {
    // Skip if file doesn't exist on macOS (e.g., .bashrc on a clean macOS install)
    if (!existsSync(config.path)) {
      continue;
    }
    try {
      const existing = readFileSync(config.path, "utf-8");
      if (/^\s*export\s+SUPERMEMORY_API_KEY=/m.test(existing)) {
        results.push(`SUPERMEMORY_API_KEY export already present in ${config.name}.`);
        continue;
      }
      appendFileSync(config.path, exportLine, "utf-8");
      results.push(`Added SUPERMEMORY_API_KEY export to ${config.name}.`);
    } catch {
      allOk = false;
    }
  }

  return { ok: allOk, shellConfigs: results };
}

/**
 * Derives a project identifier from git remote URL or cwd path.
 * CONTRACT: Always returns x-sm-project (required).
 *
 * REQ-R26 (2026-05-29): NO legacy p: prefix. Use project-compatible format:
 * - From git remote: sm_project_{org}-{repo} (e.g., "gentleman-programming-deck")
 * - Fallback to directory: sm_project_{sanitized-dirname}
 * - For explicit override, use value directly (e.g., "my-custom-project" NOT "p:my-custom-project")
 */
function deriveSmProjectIdentifier(cwd?: string): { projectId?: string; derived: boolean; diagnostic?: string } {
  const workDir = cwd;
  if (!workDir) {
    return {
      derived: false,
      diagnostic: "Verified project root is required; Supermemory scope was not derived from ambient cwd.",
    };
  }

  try {
    const remoteUrl = execSync("git remote get-url origin", {
      cwd: workDir,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "ignore"],
    }).trim();
    const resolved = resolveCanonicalSupermemoryProjectScope({ projectRoot: workDir, remotes: remoteUrl ? [remoteUrl] : [] });
    if (resolved.ok) return { projectId: resolved.scope, derived: true };
    return { derived: false, diagnostic: resolved.diagnostics.map((diagnostic) => diagnostic.message).join(" ") };
  } catch {
    return {
      derived: false,
      diagnostic: "Could not resolve canonical x-sm-project from Git remote; Supermemory MCP configuration was not written.",
    };
  }
}

/**
 * Writes or updates the Supermemory MCP server config in OpenCode's opencode.json.
 *
 * CONTRACT (Repair 2026-05-29):
 * - x-sm-project header is REQUIRED (derived from git remote or fallback to directory)
 * - User identity comes from OpenCode-managed OAuth
 * - No manual container tags
 * - NO legacy p: prefix in x-sm-project (use sm_project_ prefix)
 */
export function writeSupermemoryOpenCodeMcpConfig(
  options: {
    /** @deprecated OpenCode uses native OAuth; accepted only for caller compatibility and never persisted. */
    token?: string;
    serverName?: string;
    configPath?: string;
    homeDir?: string;
    /** @deprecated Tests may pass a pre-resolved canonical scope; production should pass projectRoot. */
    explicitProjectId?: string;
    /** Verified project root used for canonical repository identity. */
    projectRoot?: string;
  },
): WriteSupermemoryOpenCodeMcpConfigResult {
  const homeDir = options.homeDir ?? process.env.HOME ?? "/home/user";
  const configPath = options.configPath ?? join(homeDir, ".config", "opencode", "opencode.json");
  const serverName = (options.serverName ?? SUPERMEMORY_MCP_SERVER_NAME).trim() || SUPERMEMORY_MCP_SERVER_NAME;
  const diagnostics: string[] = [];

  const projectDerivation = options.explicitProjectId?.trim()
    ? { projectId: options.explicitProjectId.trim(), derived: true }
    : deriveSmProjectIdentifier(options.projectRoot);
  if (projectDerivation.diagnostic) diagnostics.push(projectDerivation.diagnostic);
  if (!projectDerivation.projectId) {
    return { ok: false, path: configPath, serverName, diagnostics };
  }
  if (!CANONICAL_SUPERMEMORY_PROJECT_SCOPE.test(projectDerivation.projectId)) {
    diagnostics.push("Canonical x-sm-project scope is required; Supermemory MCP configuration was not written.");
    return { ok: false, path: configPath, serverName, diagnostics };
  }
  const smProjectHeader = projectDerivation.projectId;

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

  const mcpSection = (config.mcp ?? {}) as Record<string, unknown>;

  mcpSection[serverName] = {
    type: "remote",
    url: SUPERMEMORY_MCP_URL,
    headers: {
      "x-sm-project": smProjectHeader,
    },
    enabled: true,
  };

  config.mcp = mcpSection;

  try {
    writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
    diagnostics.push(`Supermemory MCP server '${serverName}' configured for native OpenCode OAuth at ${configPath}.`);
    diagnostics.push(`Authenticate once with '/connect' or 'opencode mcp auth ${serverName}'; OpenCode stores OAuth credentials outside this config.`);

    return { ok: true, path: configPath, serverName, diagnostics };
  } catch (error) {
    diagnostics.push(`Failed to write opencode.json: ${error instanceof Error ? error.message : String(error)}`);
    return { ok: false, path: configPath, serverName, diagnostics };
  }
}

// ---------------------------------------------------------------------------
// Generic MCP server config writer
// ---------------------------------------------------------------------------

export type OpenCodeMcpServerType = "local" | "remote";

export type WriteOpenCodeMcpConfigOptions = {
  /** Name of the MCP server (e.g., "context7", "supermemory") */
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
  writeFile: (path: string, content: string) => void;
  rename: (from: string, to: string) => void;
  unlink?: (path: string) => void;
  temporaryPath?: (configPath: string) => string;
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

  const mcpSection = (config.mcp ?? {}) as Record<string, unknown>;

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
    const cleanedPlugins = existingPlugins.filter(
      (p) => typeof p === "string" && !options.pluginsToRemove!.includes(p),
    );

    if (cleanedPlugins.length > 0) {
      config.plugin = cleanedPlugins;
    } else if (existingPlugins.length > 0) {
      // If plugin array becomes empty after cleanup, keep as empty array
      // Don't delete the key to preserve explicit empty state
      config.plugin = [];
    }
  }

  try {
    writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
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
    writeFile: (path, content) => writeFileSync(path, content, "utf8"),
    rename: renameSync,
    unlink: unlinkSync,
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
