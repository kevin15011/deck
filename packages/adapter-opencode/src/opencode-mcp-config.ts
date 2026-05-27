import { existsSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";

export const SUPERMEMORY_MCP_SERVER_NAME = "supermemory";
export const SUPERMEMORY_MCP_URL = "https://mcp.supermemory.ai/mcp";

export type OpenCodeMcpConfigValidationResult = {
  ok: boolean;
  path: string;
  serverName: string;
  diagnostics: string[];
};

/**
 * Validates the Supermemory MCP server entry in OpenCode's opencode.json.
 *
 * OpenCode MCP format (remote) with Bearer token via env var interpolation:
 *   {
 *     "mcp": {
 *       "supermemory": {
 *         "type": "remote",
 *         "url": "https://mcp.supermemory.ai/mcp",
 *         "oauth": false,
 *         "headers": {
 *           "Authorization": "Bearer {env:SUPERMEMORY_API_KEY}"
 *         }
 *       }
 *     }
 *   }
 *
 * The validator checks structure only — it confirms the entry exists and
 * contains a non-empty bearer token reference pattern ({env:SUPERMEMORY_API_KEY}).
 * It does NOT resolve the env var at runtime.
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

  const headers = (serverEntry as Record<string, unknown>).headers;
  if (!isPlainRecord(headers)) {
    return {
      ok: false,
      path: configPath,
      serverName,
      diagnostics: [`OpenCode MCP server '${serverName}' must have a headers object; Supermemory tools were not injected.`],
    };
  }

  const authHeader = headers.Authorization;
  if (typeof authHeader !== "string" || !authHeader.trim()) {
    return {
      ok: false,
      path: configPath,
      serverName,
      diagnostics: [`OpenCode MCP server '${serverName}' has missing or empty Authorization header; Supermemory tools were not injected.`],
    };
  }

  // Check for Bearer token with {env:SUPERMEMORY_API_KEY} interpolation pattern.
  // The validator checks structure, not runtime env var resolution.
  const hasBearerEnvRef = /^Bearer\s+\{env:SUPERMEMORY_API_KEY\}$/i.test(authHeader.trim());
  if (!hasBearerEnvRef) {
    return {
      ok: false,
      path: configPath,
      serverName,
      diagnostics: [`OpenCode MCP server '${serverName}' Authorization header must use '{env:SUPERMEMORY_API_KEY}' interpolation; Supermemory tools were not injected.`],
    };
  }

  return {
    ok: true,
    path: configPath,
    serverName,
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
      appendFileSync(config.path, exportLine, "utf-8");
      results.push(`Added SUPERMEMORY_API_KEY export to ${config.name}.`);
    } catch {
      allOk = false;
    }
  }

  return { ok: allOk, shellConfigs: results };
}

/**
 * Writes or updates the Supermemory MCP server config in OpenCode's opencode.json.
 *
 * OpenCode MCP format (remote) with Bearer token via env var interpolation:
 *   {
 *     "mcp": {
 *       "supermemory": {
 *         "type": "remote",
 *         "url": "https://mcp.supermemory.ai/mcp",
 *         "oauth": false,
 *         "headers": {
 *           "Authorization": "Bearer {env:SUPERMEMORY_API_KEY}"
 *         }
 *       }
 *     }
 *   }
 *
 * The token is written using OpenCode's env var interpolation syntax {env:VAR_NAME}
 * so OpenCode resolves it at runtime from the SUPERMEMORY_API_KEY environment variable.
 * The token value itself is NOT stored in opencode.json — only the interpolation reference.
 */
export function writeSupermemoryOpenCodeMcpConfig(
  options: {
    token: string;
    serverName?: string;
    configPath?: string;
    homeDir?: string;
  },
): WriteSupermemoryOpenCodeMcpConfigResult {
  const homeDir = options.homeDir ?? process.env.HOME ?? "/home/user";
  const configPath = options.configPath ?? join(homeDir, ".config", "opencode", "opencode.json");
  const serverName = (options.serverName ?? SUPERMEMORY_MCP_SERVER_NAME).trim() || SUPERMEMORY_MCP_SERVER_NAME;
  const token = options.token.trim();

  const diagnostics: string[] = [];

  if (!token) {
    diagnostics.push("Supermemory token is required.");
    return { ok: false, path: configPath, serverName, diagnostics };
  }

  // Token is written using OpenCode's env var interpolation syntax.
  // OpenCode resolves {env:SUPERMEMORY_API_KEY} at runtime from the environment.
  // The raw token value is never stored in opencode.json.

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
    oauth: false,
    headers: {
      Authorization: `Bearer {env:SUPERMEMORY_API_KEY}`,
    },
    enabled: true,
  };

  config.mcp = mcpSection;

  try {
    writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
    diagnostics.push(`Supermemory MCP server '${serverName}' configured in OpenCode at ${configPath}.`);

    // Also write the env var export to shell configs (.zshrc, .bashrc) for cross-platform compatibility.
    const shellResult = appendSupermemoryEnvToShellConfig({ token });
    if (shellResult.ok) {
      shellResult.shellConfigs.forEach((msg) => diagnostics.push(msg));
    } else {
      diagnostics.push("Warning: Could not update shell config files. You may need to manually set SUPERMEMORY_API_KEY.");
    }

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
  /** Path to opencode.json (defaults to ~/.config/opencode/opencode.json) */
  configPath?: string;
  /** Home directory for default path resolution */
  homeDir?: string;
};

export type WriteOpenCodeMcpConfigResult = {
  ok: boolean;
  path: string;
  serverName: string;
  diagnostics: string[];
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

  try {
    writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
    diagnostics.push(`MCP server '${serverName}' configured in OpenCode at ${configPath}.`);

    return { ok: true, path: configPath, serverName, diagnostics };
  } catch (error) {
    diagnostics.push(`Failed to write opencode.json: ${error instanceof Error ? error.message : String(error)}`);
    return { ok: false, path: configPath, serverName, diagnostics };
  }
}
