import { chmodSync, existsSync, readFileSync, statSync, writeFileSync, appendFileSync, renameSync, unlinkSync } from "node:fs";
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
 * Inspects any present raw Supermemory MCP server entry in OpenCode's
 * opencode.json. Absence is valid because Deck Runtime owns Adaptive Memory
 * project isolation; present raw entries are diagnosed as stale Deck-managed
 * or unmanaged/external-unobservable instead of being treated as readiness.
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
  const absentDiagnostic = `Raw Supermemory MCP entry '${serverName}' is absent; Deck Runtime owns Adaptive Memory project isolation.`;

  if (!existsSync(configPath)) {
    return {
      ok: true,
      path: configPath,
      serverName,
      diagnostics: [absentDiagnostic],
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
      diagnostics: [`OpenCode MCP config contains malformed JSON; raw Supermemory MCP state could not be inspected: ${error instanceof Error ? error.message : String(error)}`],
    };
  }

  if (!isPlainRecord(parsed) || !isPlainRecord(parsed.mcp)) {
    return {
      ok: true,
      path: configPath,
      serverName,
      diagnostics: [absentDiagnostic],
    };
  }

  const mcpSection = parsed.mcp as Record<string, unknown>;
  const serverEntry = mcpSection[serverName];

  if (serverEntry === undefined) {
    return {
      ok: true,
      path: configPath,
      serverName,
      diagnostics: [absentDiagnostic],
    };
  }

  if (isExactDeckManagedOpenCodeSupermemoryEntry(serverEntry)) {
    const projectScope = ((serverEntry as Record<string, unknown>).headers as Record<string, unknown>)["x-sm-project"] as string;
    return {
      ok: false,
      path: configPath,
      serverName,
      projectScope: projectScope.trim(),
      diagnostics: [`OpenCode MCP server '${serverName}' is a stale Deck-managed raw Supermemory MCP entry; retire it because Deck Runtime owns Adaptive Memory project isolation.`],
    };
  }

  if (!isPlainRecord(serverEntry)) {
    return {
      ok: false,
      path: configPath,
      serverName,
      diagnostics: [`OpenCode MCP server '${serverName}' is unmanaged or ambiguous and external-unobservable; Deck Runtime did not authorize it as project memory.`],
    };
  }

  if ((serverEntry as Record<string, unknown>).type !== "remote") {
    return {
      ok: false,
      path: configPath,
      serverName,
      diagnostics: [`OpenCode MCP server '${serverName}' is unmanaged or ambiguous and external-unobservable; expected raw Supermemory entries to use type 'remote'.`],
    };
  }

  const url = (serverEntry as Record<string, unknown>).url;
  if (typeof url !== "string" || !url.trim()) {
    return {
      ok: false,
      path: configPath,
      serverName,
      diagnostics: [`OpenCode MCP server '${serverName}' has missing or empty URL; raw Supermemory MCP is unmanaged and external-unobservable.`],
    };
  }

  const trimmedUrl = url.trim().toLowerCase();
  const validUrls = ["https://mcp.supermemory.ai/mcp"];
  const deprecatedUrls = [
    "https://supermemory-new.stlmcp.com",
    "https://supermemory.stlmcp.com",
  ];

  if (validUrls.includes(trimmedUrl)) {
    // Valid Supermemory endpoint; continue classifying the present raw entry.
  } else if (deprecatedUrls.includes(trimmedUrl)) {
    return {
      ok: false,
      path: configPath,
      serverName,
      diagnostics: [`OpenCode MCP server '${serverName}' uses deprecated URL; raw Supermemory MCP is unmanaged/external-unobservable and should not be used for project memory. Use Deck Runtime instead of '${SUPERMEMORY_MCP_URL}' raw MCP materialization.`],
    };
  } else {
    return {
      ok: false,
      path: configPath,
      serverName,
      diagnostics: [`OpenCode MCP server '${serverName}' uses unrecognized URL; raw Supermemory MCP is unmanaged and external-unobservable.`],
    };
  }

  if ((serverEntry as Record<string, unknown>).oauth === false) {
    return {
      ok: false,
      path: configPath,
      serverName,
      diagnostics: [`OpenCode MCP server '${serverName}' has oauth: false; raw Supermemory MCP is unmanaged and external-unobservable.`],
    };
  }

  const headers = (serverEntry as Record<string, unknown>).headers;
  if (!isPlainRecord(headers)) {
    return {
      ok: false,
      path: configPath,
      serverName,
      diagnostics: [`OpenCode MCP server '${serverName}' has no headers object; raw Supermemory MCP is unmanaged and external-unobservable.`],
    };
  }

  if (Object.prototype.hasOwnProperty.call(headers, "Authorization")) {
    return {
      ok: false,
      path: configPath,
      serverName,
      diagnostics: [`OpenCode MCP server '${serverName}' must not persist an Authorization header; OpenCode OAuth credentials must stay outside opencode.json, and raw Supermemory MCP is unmanaged and external-unobservable.`],
    };
  }

  const projectHeader = headers["x-sm-project"];
  if (typeof projectHeader !== "string" || !CANONICAL_SUPERMEMORY_PROJECT_SCOPE.test(projectHeader.trim())) {
    return {
      ok: false,
      path: configPath,
      serverName,
      diagnostics: [`OpenCode MCP server '${serverName}' is missing canonical 'x-sm-project' header; raw Supermemory MCP is unmanaged and external-unobservable.`],
    };
  }

  return {
    ok: false,
    path: configPath,
    serverName,
    projectScope: projectHeader.trim(),
    diagnostics: [`OpenCode MCP server '${serverName}' is an unmanaged raw Supermemory MCP entry and external-unobservable; Deck Runtime did not authorize it as project memory.`],
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

function isExactDeckManagedOpenCodeSupermemoryEntry(entry: unknown): boolean {
  if (!isPlainRecord(entry)) return false;
  const keys = Object.keys(entry).sort();
  const allowed = ["enabled", "headers", "type", "url"];
  if (JSON.stringify(keys) !== JSON.stringify(allowed)) return false;
  if (entry.type !== "remote" || entry.url !== SUPERMEMORY_MCP_URL || entry.enabled !== true) return false;
  if (!isPlainRecord(entry.headers)) return false;
  const headerKeys = Object.keys(entry.headers);
  if (headerKeys.length !== 1 || headerKeys[0] !== "x-sm-project") return false;
  if (typeof entry.headers["x-sm-project"] !== "string") return false;
  if (!CANONICAL_SUPERMEMORY_PROJECT_SCOPE.test(entry.headers["x-sm-project"].trim())) return false;
  return true;
}

function writeJsonAtomically(configPath: string, originalContent: string, config: Record<string, unknown>, fileSystem: OpenCodeMcpConfigFileSystem): void {
  const tempPath = fileSystem.temporaryPath?.(configPath) ?? `${configPath}.deck-supermemory.tmp`;
  if (resolve(dirname(tempPath)) !== resolve(dirname(configPath))) throw new Error("temporary path must share the config directory");
  const rollbackPath = `${tempPath}.rollback`;
  const mode = safeExistingFileMode(configPath, fileSystem) ?? 0o600;
  const nextContent = JSON.stringify(config, null, 2);
  let replaced = false;
  try {
    fileSystem.writeFile(tempPath, nextContent, { mode });
    fileSystem.chmod?.(tempPath, mode);
    if (fileSystem.readFile(configPath) !== originalContent) throw new Error("OpenCode MCP config changed while Deck was retiring stale Supermemory MCP; no changes were written.");
    fileSystem.rename(tempPath, configPath);
    replaced = true;
    fileSystem.chmod?.(configPath, mode);
    verifyRetiredSupermemoryConfig(configPath, nextContent, fileSystem);
  } catch (error) {
    try { fileSystem.unlink?.(tempPath); } catch { /* preserve original config */ }
    try { fileSystem.unlink?.(rollbackPath); } catch { /* preserve original config */ }
    if (replaced && fileSystem.exists(configPath)) {
      try {
        const current = fileSystem.readFile(configPath);
        if (current !== originalContent && current !== nextContent) {
          fileSystem.writeFile(rollbackPath, originalContent, { mode });
          fileSystem.chmod?.(rollbackPath, mode);
          fileSystem.rename(rollbackPath, configPath);
          fileSystem.chmod?.(configPath, mode);
        }
      } catch {
        try { fileSystem.unlink?.(rollbackPath); } catch { /* preserve original config */ }
      }
    }
    throw error;
  }
}

function safeExistingFileMode(configPath: string, fileSystem: OpenCodeMcpConfigFileSystem): number | undefined {
  try {
    const mode = fileSystem.statMode?.(configPath);
    return typeof mode === "number" && Number.isFinite(mode) ? mode & 0o777 : undefined;
  } catch {
    return undefined;
  }
}

function verifyRetiredSupermemoryConfig(configPath: string, expectedContent: string, fileSystem: OpenCodeMcpConfigFileSystem): void {
  const actual = fileSystem.readFile(configPath);
  if (actual !== expectedContent) throw new Error("OpenCode MCP config replacement verification failed.");
  const parsed = JSON.parse(actual) as unknown;
  if (!isPlainRecord(parsed)) throw new Error("OpenCode MCP config replacement did not produce a JSON object.");
}

/**
 * Retires only exact stale Deck-managed Supermemory MCP server config in
 * OpenCode's opencode.json. It never creates a fresh raw Supermemory MCP entry.
 *
 * CONTRACT:
 * - Deck Runtime owns Supermemory project memory and secret storage.
 * - Raw OpenCode Supermemory MCP is optional ad-hoc surface only.
 * - Absence is safe; exact stale Deck-managed entries may be retired.
 * - Unmanaged or ambiguous entries are preserved and reported.
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
    /** Injectable atomic file boundary for hermetic tests. */
    fileSystem?: OpenCodeMcpConfigFileSystem;
  },
): WriteSupermemoryOpenCodeMcpConfigResult {
  const homeDir = options.homeDir ?? process.env.HOME ?? "/home/user";
  const configPath = options.configPath ?? join(homeDir, ".config", "opencode", "opencode.json");
  const serverName = (options.serverName ?? SUPERMEMORY_MCP_SERVER_NAME).trim() || SUPERMEMORY_MCP_SERVER_NAME;
  const fileSystem = options.fileSystem ?? defaultOpenCodeMcpConfigFileSystem();
  const diagnostics: string[] = [];

  const projectDerivation = options.explicitProjectId?.trim()
    ? { projectId: options.explicitProjectId.trim(), derived: true }
    : deriveSmProjectIdentifier(options.projectRoot);
  if (projectDerivation.diagnostic) diagnostics.push(projectDerivation.diagnostic);
  const projectId = projectDerivation.projectId;
  if (projectId && !CANONICAL_SUPERMEMORY_PROJECT_SCOPE.test(projectId)) {
    diagnostics.push("Canonical x-sm-project scope is required; raw Supermemory MCP configuration was not written.");
    return { ok: false, path: configPath, serverName, diagnostics };
  }

  if (!fileSystem.exists(configPath)) {
    diagnostics.push("Raw Supermemory MCP is disabled; no OpenCode MCP configuration was written.");
    return { ok: false, path: configPath, serverName, diagnostics };
  }

  let config: Record<string, unknown>;
  let originalContent: string;
  try {
    originalContent = fileSystem.readFile(configPath);
    config = JSON.parse(originalContent) as Record<string, unknown>;
  } catch (error) {
    diagnostics.push(`Unable to parse existing opencode.json: ${error instanceof Error ? error.message : String(error)}`);
    return { ok: false, path: configPath, serverName, diagnostics };
  }

  const mcpSection = config.mcp;
  if (!isPlainRecord(mcpSection)) {
    diagnostics.push("Raw Supermemory MCP is disabled; no OpenCode MCP entry was present to retire.");
    return { ok: false, path: configPath, serverName, diagnostics };
  }

  const existing = mcpSection[serverName];
  if (existing === undefined) {
    diagnostics.push("Raw Supermemory MCP is disabled; no OpenCode MCP entry was present to retire.");
    return { ok: false, path: configPath, serverName, diagnostics };
  }
  if (!isExactDeckManagedOpenCodeSupermemoryEntry(existing)) {
    diagnostics.push(`Existing OpenCode Supermemory MCP entry '${serverName}' is unmanaged or ambiguous; Deck left it unchanged and did not authorize raw Supermemory MCP.`);
    return { ok: false, path: configPath, serverName, diagnostics };
  }

  const nextMcp = { ...mcpSection };
  delete nextMcp[serverName];
  config.mcp = nextMcp;

  try {
    writeJsonAtomically(configPath, originalContent, config, fileSystem);
    diagnostics.push(`Retired stale Deck-managed OpenCode Supermemory MCP entry '${serverName}'; raw Supermemory MCP is no longer authorized by Deck.`);
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
    writeFileSync(configPath, nextContent, "utf-8");
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
