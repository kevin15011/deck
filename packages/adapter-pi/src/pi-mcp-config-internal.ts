import { readFileSync } from "node:fs";
import {
  SUPERMEMORY_API_KEY_HEADER,
  type SupermemoryPiMcpPublicServer,
  type ValidateSupermemoryPiMcpConfigOptions,
  validateSupermemoryPiMcpConfig,
} from "./pi-mcp-config";

type JsonRecord = Record<string, unknown>;

export type SupermemoryPiMcpRuntimeServer = SupermemoryPiMcpPublicServer & {
  headers: Record<string, string>;
};

/**
 * Internal-only helper for runtime validation. It intentionally returns
 * credential-bearing headers and must not be re-exported from the package API.
 */
export function extractValidatedSupermemoryPiMcpRuntimeServer(
  options?: ValidateSupermemoryPiMcpConfigOptions,
): SupermemoryPiMcpRuntimeServer {
  const validation = validateSupermemoryPiMcpConfig(options);
  if (!validation.ok) {
    throw new Error(validation.diagnostics.map((diagnostic) => diagnostic.message).join(" "));
  }

  const parsed = JSON.parse(readFileSync(validation.path, "utf-8")) as JsonRecord;
  const mcpServers = parsed.mcpServers as JsonRecord;
  const server = mcpServers[validation.serverName] as JsonRecord;
  const headers = server.headers as JsonRecord;
  return {
    path: validation.path,
    serverName: validation.serverName,
    endpoint: String(server.url),
    headers: { [SUPERMEMORY_API_KEY_HEADER]: String(headers[SUPERMEMORY_API_KEY_HEADER]) },
  };
}
