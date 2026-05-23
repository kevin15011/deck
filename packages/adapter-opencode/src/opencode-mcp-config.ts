import { existsSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";

export const SUPERMEMORY_MCP_SERVER_NAME = "supermemory";
export const SUPERMEMORY_MCP_URL = "https://mcp.supermemory.ai/mcp";

export type WriteSupermemoryOpenCodeMcpConfigResult = {
  ok: boolean;
  path: string;
  serverName: string;
  diagnostics: Array<{ message: string }>;
};

/**
 * Appends the SUPERMEMORY_API_KEY export statement to ~/.bashrc.
 * This ensures the env var is available in future terminal sessions.
 */
export function appendSupermemoryEnvToBashrc(
  options: { token: string; homeDir?: string } = {},
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

  const diagnostics: Array<{ message: string } > = [];

  if (!token) {
    diagnostics.push({ message: "Supermemory token is required." });
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
      diagnostics.push({ message: `Unable to parse existing opencode.json: ${error instanceof Error ? error.message : String(error)}` });
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
    diagnostics.push({ message: `Supermemory MCP server '${serverName}' configured in OpenCode at ${configPath}.` });

    // Also write the env var export to ~/.bashrc so it's available in future shells.
    const bashrcResult = appendSupermemoryEnvToBashrc({ token });
    if (bashrcResult.ok) {
      diagnostics.push({ message: `Added SUPERMEMORY_API_KEY export to ~/.bashrc.` });
    }

    return { ok: true, path: configPath, serverName, diagnostics };
  } catch (error) {
    diagnostics.push({ message: `Failed to write opencode.json: ${error instanceof Error ? error.message : String(error)}` });
    return { ok: false, path: configPath, serverName, diagnostics };
  }
}
