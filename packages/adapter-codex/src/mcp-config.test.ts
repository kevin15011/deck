import { describe, expect, test } from "bun:test";
import { buildCodexMcpServers, mergeCodexMcpServers, redactCodexMcpDiagnostic } from "./mcp-config";

describe("Codex MCP semantic configuration", () => {
  test("writes Supermemory as a credential-free native OAuth streamable HTTP server", () => {
    const desired = buildCodexMcpServers({ packageIds: ["context-mode", "codebase-memory", "serena", "context7"], memoryProvider: "supermemory" });
    const merged = mergeCodexMcpServers("[mcp_servers.user]\ncommand = \"user-mcp\"\n", desired.servers);
    expect(merged.status).toBe("updated");
    expect(merged.content).toContain("[mcp_servers.context-mode]");
    expect(merged.content).toContain('url = "https://mcp.supermemory.ai/mcp"');
    expect(merged.content).not.toContain("bearer_token_env_var");
    expect(merged.content).not.toContain("SUPERMEMORY_API_KEY");
    expect(merged.content).not.toContain("secret-value");
    expect(merged.content).toContain("[mcp_servers.user]");
  });

  test("is semantically idempotent and blocks same-ID collisions", () => {
    const desired = buildCodexMcpServers({ packageIds: ["context-mode"], memoryProvider: "none" });
    const first = mergeCodexMcpServers("", desired.servers);
    expect(first.status).toBe("updated");
    expect(mergeCodexMcpServers(first.content, desired.servers).status).toBe("unchanged");
    const removed = mergeCodexMcpServers(first.content, []);
    expect(removed.status).toBe("updated");
    expect(removed.content).not.toContain("mcp_servers.context-mode");
    const collision = mergeCodexMcpServers('[mcp_servers.context-mode]\ncommand = "other"\n', desired.servers);
    expect(collision).toMatchObject({ status: "blocked", collisions: ["context-mode"] });
  });

  test("keeps Engram explicit and redacts credential-like diagnostics", () => {
    expect(buildCodexMcpServers({ packageIds: [], memoryProvider: "none" })).toEqual({ servers: [], gaps: [] });
    expect(buildCodexMcpServers({ packageIds: [], memoryProvider: "engram" }).gaps).toEqual(["engram-codex-deferred"]);
    expect(redactCodexMcpDiagnostic("token=very-secret-value failed")).toBe("token=[REDACTED] failed");
  });

  test("rejects manual Supermemory bearer configuration so Codex OAuth remains native", () => {
    const merged = mergeCodexMcpServers("", [{
      id: "supermemory",
      transport: "streamable-http",
      url: "https://mcp.supermemory.ai/mcp",
      bearerTokenEnvVar: "SUPERMEMORY_API_KEY",
    }]);

    expect(merged).toMatchObject({ status: "blocked" });
    expect(JSON.stringify(merged)).not.toContain("SUPERMEMORY_API_KEY");
  });
});
