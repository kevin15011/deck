import { describe, expect, test } from "bun:test";
import { buildCodexMcpServers, inspectCodexSupermemoryMcpState, mergeCodexMcpServers, redactCodexMcpDiagnostic } from "./mcp-config";

describe("Codex MCP semantic configuration", () => {
  test("writes Supermemory as a credential-free native OAuth streamable HTTP server", () => {
    const desired = buildCodexMcpServers({ packageIds: ["context-mode", "codebase-memory", "serena", "context7"], memoryProvider: "supermemory", supermemoryProjectScope: "sm_project_v1_kevin15011_deck" });
    const merged = mergeCodexMcpServers("[mcp_servers.user]\ncommand = \"user-mcp\"\n", desired.servers);
    expect(merged.status).toBe("updated");
    expect(merged.content).toContain("[mcp_servers.context-mode]");
    expect(merged.content).toContain('url = "https://mcp.supermemory.ai/mcp"');
    expect(merged.content).toContain('"x-sm-project" = "sm_project_v1_kevin15011_deck"');
    expect(merged.content).not.toContain("bearer_token_env_var");
    expect(merged.content).not.toContain("SUPERMEMORY_API_KEY");
    expect(merged.content).not.toContain("secret-value");
    expect(merged.content).toContain("[mcp_servers.user]");
  });

  test("serializes the portable Deck Serena proxy without user-specific paths or shell", () => {
    const desired = buildCodexMcpServers({ packageIds: ["serena"], memoryProvider: "none", serenaLauncherAvailable: true, serenaProxyAvailable: true });
    const merged = mergeCodexMcpServers("", desired.servers);

    expect(desired.gaps).toEqual([]);
    expect(merged).toMatchObject({ status: "updated" });
    expect(merged.content).toContain('command = "deck"');
    expect(merged.content).toContain('args = ["internal", "serena-mcp"]');
    expect(merged.content).toContain('env_vars = ["HOME", "PATH", "XDG_DATA_HOME"]');
    expect(merged.content).not.toMatch(/\/home\/dev|serena\/bin|\$\{|sh -c/);
  });


  test("migrates marker-owned bare and absolute Serena entries but blocks unmanaged collisions", () => {
    const desired = buildCodexMcpServers({
      packageIds: ["serena"],
      memoryProvider: "none",
      serenaLauncherAvailable: true,
      serenaProxyAvailable: true,
    });
    const legacySources = [
      '# deck-codex-mcp:serena\n[mcp_servers.serena]\ncommand = "serena"\nargs = ["start-mcp-server", "--context", "ide", "--project-from-cwd"]\n',
      '# deck-codex-mcp:serena\n[mcp_servers.serena]\ncommand = "/legacy/user/tools/serena/bin/serena"\nargs = ["start-mcp-server", "--context", "ide", "--project-from-cwd"]\n',
    ];

    for (const source of legacySources) {
      const migrated = mergeCodexMcpServers(source, desired.servers);
      expect(migrated).toMatchObject({ status: "updated" });
      expect(migrated.content).toContain('command = "deck"');
      expect(migrated.content).not.toContain("/legacy/user");
    }

    const unmanaged = mergeCodexMcpServers(
      '[mcp_servers.serena]\ncommand = "/user-owned/serena"\nargs = ["serve"]\n',
      desired.servers,
    );
    expect(unmanaged).toMatchObject({ status: "blocked", collisions: ["serena"] });
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

  test("keeps disabled memory explicit and redacts credential-like diagnostics", () => {
    expect(buildCodexMcpServers({ packageIds: [], memoryProvider: "none" })).toEqual({ servers: [], gaps: [] });
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

  test("rejects invalid Supermemory project scopes instead of serializing legacy/default containers", () => {
    const desired = buildCodexMcpServers({ packageIds: [], memoryProvider: "supermemory", supermemoryProjectScope: "sm_project_default" });

    expect(desired.servers).toEqual([]);
    expect(desired.gaps).toContain("supermemory-project-scope-invalid");
  });

  test("classifies Codex Supermemory scope failures with provider-specific blocking codes", () => {
    expect(inspectCodexSupermemoryMcpState(`
[mcp_servers.supermemory]
url = "https://mcp.supermemory.ai/mcp"

[mcp_servers.supermemory.http_headers]
x-sm-project = "sm_project_v1_kevin15011_deck"
`)).toMatchObject({ ok: true, scope: "sm_project_v1_kevin15011_deck" });
    expect(inspectCodexSupermemoryMcpState(`
[mcp_servers.supermemory]
url = "https://mcp.supermemory.ai/mcp"
http_headers = { "x-sm-project" = "sm_project_default" }
`)).toMatchObject({ ok: false, code: "supermemory-project-scope-invalid" });
    expect(inspectCodexSupermemoryMcpState(`
[mcp_servers.supermemory]
url = "https://mcp.supermemory.ai/mcp"
`)).toMatchObject({ ok: false, code: "supermemory-project-scope-missing" });
  });
});
