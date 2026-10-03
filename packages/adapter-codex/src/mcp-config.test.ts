import { describe, expect, test } from "bun:test";
import { buildCodexMcpServers, isCodexDeckMemoryMcpConfigured,
  isCodexSerenaMcpConfigured, inspectCodexMcpServerCommand, inspectCodexSupermemoryMcpState, mergeCodexMcpServers, redactCodexMcpDiagnostic } from "./mcp-config";

describe("Codex MCP semantic configuration", () => {
  test("does not materialize raw Supermemory MCP because scope would be model-selectable", () => {
    const desired = buildCodexMcpServers({ packageIds: ["context-mode", "codebase-memory", "serena", "context7"], memoryProvider: "supermemory", supermemoryProjectScope: "sm_project_v1_kevin15011_deck", contextModeCommand: "/opt/deck/context-mode", codebaseMemoryCommand: "/opt/deck/codebase-memory-mcp" });
    const merged = mergeCodexMcpServers("[mcp_servers.user]\ncommand = \"user-mcp\"\n", desired.servers);
    expect(desired.gaps).toContain("supermemory-raw-mcp-disabled");
    expect(merged.content).toContain("[mcp_servers.context-mode]");
    expect(merged.content).not.toContain("mcp.supermemory.ai");
    expect(merged.content).not.toContain("sm_project_v1_kevin15011_deck");
    expect(merged.content).not.toContain("bearer_token_env_var");
    expect(merged.content).not.toContain("SUPERMEMORY_API_KEY");
    expect(merged.content).not.toContain("secret-value");
    expect(merged.content).toContain("[mcp_servers.user]");
  });

  test("retires only marker-owned stale Supermemory blocks and preserves unmarked external entries", () => {
    const desired = buildCodexMcpServers({ packageIds: [], memoryProvider: "supermemory", supermemoryProjectScope: "sm_project_v1_kevin15011_deck" });
    const stale = '# deck-codex-mcp:supermemory\n[mcp_servers.supermemory]\nurl = "https://mcp.supermemory.ai/mcp"\nhttp_headers = { "x-sm-project" = "sm_project_v1_kevin15011_deck" }\n';
    const retired = mergeCodexMcpServers(stale, desired.servers);
    expect(retired).toMatchObject({ status: "updated" });
    expect(retired.content).not.toContain("mcp_servers.supermemory");

    const external = '[mcp_servers.supermemory]\nurl = "https://mcp.supermemory.ai/mcp"\nhttp_headers = { "x-sm-project" = "sm_project_v1_other_repo" }\n';
    const preserved = mergeCodexMcpServers(external, desired.servers);
    expect(preserved).toMatchObject({ status: "unchanged" });
    expect(preserved.content).toBe(external);
    expect(inspectCodexSupermemoryMcpState(external)).toMatchObject({ ok: false, code: "supermemory-mcp-unmanaged" });
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
    const desired = buildCodexMcpServers({ packageIds: ["context-mode"], memoryProvider: "none", contextModeCommand: "/opt/deck/context-mode" });
    const first = mergeCodexMcpServers("", desired.servers);
    expect(first.status).toBe("updated");
    expect(mergeCodexMcpServers(first.content, desired.servers).status).toBe("unchanged");
    const removed = mergeCodexMcpServers(first.content, []);
    expect(removed.status).toBe("updated");
    expect(removed.content).not.toContain("mcp_servers.context-mode");
    const collision = mergeCodexMcpServers('[mcp_servers.context-mode]\ncommand = "other"\n', desired.servers);
    expect(collision).toMatchObject({ status: "blocked", collisions: ["context-mode"] });
  });

  test("pins Context Mode and Codebase Memory to verified absolute commands and never writes bare PATH names", () => {
    const pinned = buildCodexMcpServers({ packageIds: ["context-mode", "codebase-memory"], memoryProvider: "none", contextModeCommand: "/opt/deck/context-mode", codebaseMemoryCommand: "/opt/deck/codebase-memory-mcp" });
    expect(pinned.gaps).toEqual([]);
    const merged = mergeCodexMcpServers("", pinned.servers);
    expect(merged.content).toContain('command = "/opt/deck/context-mode"');
    expect(merged.content).toContain('command = "/opt/deck/codebase-memory-mcp"');
    expect(inspectCodexMcpServerCommand(merged.content, "context-mode")).toBe("/opt/deck/context-mode");

    const missing = buildCodexMcpServers({ packageIds: ["context-mode", "codebase-memory"], memoryProvider: "none", contextModeCommand: "context-mode", codebaseMemoryCommand: undefined });
    expect(missing.servers).toEqual([]);
    expect(missing.gaps).toEqual(["context-mode-not-ready", "codebase-memory-not-ready"]);

    // A previously written bare Deck-owned entry is replaced by the pinned one; a user entry is a collision.
    const legacy = '# deck-codex-mcp:context-mode\n[mcp_servers.context-mode]\ncommand = "context-mode"\nargs = ["mcp"]\n';
    const upgraded = mergeCodexMcpServers(legacy, pinned.servers.filter((server) => server.id === "context-mode"));
    expect(upgraded.status).toBe("updated");
    expect(upgraded.content).toContain('command = "/opt/deck/context-mode"');
    expect(upgraded.content).not.toContain('command = "context-mode"');
  });

  test("retiring a managed MCP block never swallows the ownership marker of the hook block that follows it", () => {
    const source = '# deck-codex-mcp:context7\n[mcp_servers.context7]\nurl = "https://mcp.context7.com/mcp"\n\n# deck-codex-hook:rtk:start\n[[hooks.PreToolUse]]\nmatcher = "^Bash$"\n# deck-codex-hook:rtk:end\n';
    const retired = mergeCodexMcpServers(source, []);
    expect(retired.status).toBe("updated");
    expect(retired.content).not.toContain("mcp_servers.context7");
    expect(retired.content).toContain("# deck-codex-hook:rtk:start");
    expect(retired.content).toContain("# deck-codex-hook:rtk:end");
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

  test("classifies Codex Supermemory scope failures with provider-specific blocking codes", () => {
    expect(inspectCodexSupermemoryMcpState(`
# deck-codex-mcp:supermemory
[mcp_servers.supermemory]
url = "https://mcp.supermemory.ai/mcp"

[mcp_servers.supermemory.http_headers]
x-sm-project = "sm_project_v1_kevin15011_deck"
`)).toMatchObject({ ok: true, scope: "sm_project_v1_kevin15011_deck" });
    expect(inspectCodexSupermemoryMcpState(`
[mcp_servers.supermemory]
url = "https://mcp.supermemory.ai/mcp"
http_headers = { "x-sm-project" = "sm_project_default" }
`)).toMatchObject({ ok: false, code: "supermemory-mcp-unmanaged" });
    expect(inspectCodexSupermemoryMcpState(`
# deck-codex-mcp:supermemory
[mcp_servers.supermemory]
url = "https://mcp.supermemory.ai/mcp"
http_headers = { "x-sm-project" = "sm_project_default" }
`)).toMatchObject({ ok: false, code: "supermemory-project-scope-invalid" });
    expect(inspectCodexSupermemoryMcpState(`
# deck-codex-mcp:supermemory
[mcp_servers.supermemory]
url = "https://mcp.supermemory.ai/mcp"
`)).toMatchObject({ ok: false, code: "supermemory-project-scope-missing" });
  });
});

 test("pins Serena to the reviewed invocation and migrates only owned configs", () => {
  const route = ["/opt/Deck Canary/deck-canary", "internal", "serena-mcp"];
  const desired = buildCodexMcpServers({ packageIds: ["serena"], memoryProvider: "none", serenaLauncherAvailable: true, serenaProxyAvailable: true, serenaProxyCommand: route });
  const merged = mergeCodexMcpServers("", desired.servers);
  expect(merged.content).toContain('command = "/opt/Deck Canary/deck-canary"');
  expect(isCodexSerenaMcpConfigured(merged.content, route)).toBe(true);
  expect(isCodexSerenaMcpConfigured(merged.content)).toBe(false);
  const old = mergeCodexMcpServers("", buildCodexMcpServers({ packageIds: ["serena"], memoryProvider: "none", serenaLauncherAvailable: true, serenaProxyAvailable: true }).servers).content;
  expect(mergeCodexMcpServers(old, desired.servers)).toMatchObject({ status: "updated", content: merged.content });
  const unmanaged = old.replace("# deck-codex-mcp:serena\n", "");
  expect(mergeCodexMcpServers(unmanaged, desired.servers)).toMatchObject({ status: "blocked", content: unmanaged });

});

describe("Codex Deck memory MCP entry", () => {
  test("registers the Deck-owned memory MCP server only for Supermemory with names-only env forwarding", () => {
    const command = ["/opt/deck/bin/deck", "internal", "memory-mcp"];
    const desired = buildCodexMcpServers({ packageIds: [], memoryProvider: "supermemory", deckMemoryCommand: command });
    expect(desired.gaps).toEqual(["supermemory-raw-mcp-disabled"]);
    const merged = mergeCodexMcpServers("[mcp_servers.user]\ncommand = \"user-mcp\"\n", desired.servers);
    expect(merged.content).toContain("# deck-codex-mcp:deck-memory\n[mcp_servers.deck-memory]");
    expect(merged.content).toContain('command = "/opt/deck/bin/deck"');
    expect(merged.content).toContain('args = ["internal", "memory-mcp"]');
    expect(merged.content).toContain('env_vars = ["DECK_RUNNER_MEMORY_ENDPOINT", "DECK_RUNNER_MEMORY_TOKEN_FILE"]');
    expect(merged.content).not.toMatch(/DECK_RUNNER_MEMORY_TOKEN"|bearer|sk-|supermemory/i);
    expect(merged.content).toContain("[mcp_servers.user]");
    expect(isCodexDeckMemoryMcpConfigured(merged.content, command)).toBe(true);
    expect(isCodexDeckMemoryMcpConfigured(merged.content, ["/other/deck", "internal", "memory-mcp"])).toBe(false);
    expect(mergeCodexMcpServers(merged.content, desired.servers).status).toBe("unchanged");

    for (const input of [{ memoryProvider: "none" as const, deckMemoryCommand: command }, { memoryProvider: "supermemory" as const }]) {
      expect(buildCodexMcpServers({ packageIds: [], ...input }).servers.map((server) => server.id)).not.toContain("deck-memory");
    }
  });

  test("retires the marker-owned memory entry when memory is switched off and preserves a user entry of the same name", () => {
    const withMemory = mergeCodexMcpServers("", buildCodexMcpServers({ packageIds: [], memoryProvider: "supermemory", deckMemoryCommand: ["/opt/deck/bin/deck", "internal", "memory-mcp"] }).servers);
    const retired = mergeCodexMcpServers(withMemory.content, buildCodexMcpServers({ packageIds: [], memoryProvider: "none" }).servers);
    expect(retired.content).not.toContain("deck-memory");

    const user = '[mcp_servers.deck-memory]\ncommand = "mine"\n';
    const collision = mergeCodexMcpServers(user, buildCodexMcpServers({ packageIds: [], memoryProvider: "supermemory", deckMemoryCommand: ["/opt/deck/bin/deck", "internal", "memory-mcp"] }).servers);
    expect(collision.status).toBe("blocked");
  });
});
