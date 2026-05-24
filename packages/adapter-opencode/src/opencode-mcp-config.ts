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
 * Appends the SUPERMEMORY_API_KEY export statement to ~/.bashrc.
 * This ensures the env var is available in future terminal sessions.
 */
export function appendSupermemoryEnvToBashrc(
  options: { token: string; homeDir?: string },
): { ok: boolean; bashrcPath: string } {
  const homeDir = options.homeDir ?? process.env.HOME ?? "/home/user";
  const bashrcPath = join(homeDir, ".bashrc");

  const exportLine = `export SUPERMEMORY_API_KEY="${options.token}"\n`;

  try {
    appendFileSync(bashrcPath, exportLine, "utf-8");
    return { ok: true, bashrcPath };
  } catch {
    return { ok: false, bashrcPath };
  }
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

    // Also write the env var export to ~/.bashrc so it's available in future shells.
    const bashrcResult = appendSupermemoryEnvToBashrc({ token });
    if (bashrcResult.ok) {
      diagnostics.push("Added SUPERMEMORY_API_KEY export to ~/.bashrc.");
    }

    return { ok: true, path: configPath, serverName, diagnostics };
  } catch (error) {
    diagnostics.push(`Failed to write opencode.json: ${error instanceof Error ? error.message : String(error)}`);
    return { ok: false, path: configPath, serverName, diagnostics };
  }
}
