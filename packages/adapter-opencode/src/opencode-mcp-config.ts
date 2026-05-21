import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const SUPERMEMORY_MCP_SERVER_NAME = "supermemory";
export const SUPERMEMORY_MCP_URL = "https://supermemory-new.stlmcp.com";

export type WriteSupermemoryOpenCodeMcpConfigResult = {
  ok: boolean;
  path: string;
  serverName: string;
  diagnostics: Array<{ message: string } >;
};

/**
 * Writes or updates the Supermemory MCP server config in OpenCode's opencode.json.
 *
 * OpenCode MCP format (remote):
 *   {
 *     "mcp": {
 *       "supermemory": {
 *         "type": "remote",
 *         "url": "https://supermemory-new.stlmcp.com",
 *         "enabled": true
 *       }
 *     }
 *   }
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
    enabled: true,
  };

  config.mcp = mcpSection;

  try {
    writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
    diagnostics.push({ message: `Supermemory MCP server '${serverName}' configured in OpenCode at ${configPath}.` });
    return { ok: true, path: configPath, serverName, diagnostics };
  } catch (error) {
    diagnostics.push({ message: `Failed to write opencode.json: ${error instanceof Error ? error.message : String(error)}` });
    return { ok: false, path: configPath, serverName, diagnostics };
  }
}
