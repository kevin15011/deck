import { describe, expect, test } from "bun:test";
import { buildCodexMcpServers, isCodexDeckMemoryMcpConfigured,
  isCodexSerenaMcpConfigured, inspectCodexMcpServerCommand, inspectCodexSupermemoryMcpState, mergeCodexMcpServers, redactCodexMcpDiagnostic } from "./mcp-config";

describe("Codex MCP semantic configuration", () => {
  test("selected repair preserves unowned standard entries and their tool policies", () => { const source = '# personal config\n[mcp_servers.codebase-memory]\ncommand="codebase-memory-mcp"\n[mcp_servers.codebase-memory.tools.search_code]\napproval_mode="approve"\n[mcp_servers.other]\ncommand="custom"\n'; const desired = buildCodexMcpServers({ packageIds: ['codebase-memory'], memoryProvider: 'none', codebaseMemoryCommand: '/verified/codebase-memory-mcp' }).servers; expect(mergeCodexMcpServers(source, desired, { repairSelectedToolIds: ['codebase-memory'] })).toMatchObject({ status: 'blocked', content: source }); });

  test("selected repair preserves custom invocations and returns original bytes if any collision remains", () => {
    const desired = buildCodexMcpServers({ packageIds: ["context-mode", "codebase-memory"], memoryProvider: "none", contextModeCommand: "/opt/bin/context-mode", codebaseMemoryCommand: "/opt/deck/codebase-memory-mcp" }).servers;
    for (const custom of ['command = "wrapper"', 'command = "codebase-memory-mcp"\nargs = ["--custom"]', 'command = "codebase-memory-mcp"\nenv = { TOKEN = "sensitive-value" }']) {
      const source = `[mcp_servers.context-mode]\ncommand = "context-mode"\n[mcp_servers.codebase-memory]\n${custom}\n`;
      const merged = mergeCodexMcpServers(source, desired, { repairSelectedToolIds: ["context-mode", "codebase-memory"] });
      expect(merged).toMatchObject({ status: "blocked", content: source, collisions: ["codebase-memory"] });
      if (merged.status === "blocked") expect(merged.diagnostics.join(" ")).not.toContain("sensitive-value");
    }
    const source = '[mcp_servers.context-mode]\ncommand = "context-mode"\n[mcp_servers.codebase-memory]\ncommand = "codebase-memory-mcp"\n';
    expect(mergeCodexMcpServers(source, desired, { repairSelectedToolIds: ["context-mode"] })).toMatchObject({ status: "blocked", content: source, collisions: ["codebase-memory"] });
  });

  test("does not materialize raw Supermemory MCP because scope would be model-selectable", () => {
    const desired = buildCodexMcpServers({ packageIds: ["context-mode", "codebase-memory", "serena", "context7"], memoryProvider: "supermemory", supermemoryProjectScope: "sm_project_v1_kevin15011_deck", contextModeCommand: "/opt/deck/context-mode", codebaseMemoryCommand: "/opt/deck/codebase-memory-mcp" });
    const merged = mergeCodexMcpServers("[mcp_servers.user]\ncommand = \"user-mcp\"\n", desired.servers);
    expect(desired.gaps).toContain("supermemory-raw-mcp-disabled");
    expect(merged.content).not.toContain("[mcp_servers.context-mode]");
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
    const retired = mergeCodexMcpServers(stale, desired.servers, { ownedServerIds: ["supermemory"] });
    expect(retired).toMatchObject({ status: "updated" });
    expect(retired.content).not.toContain("mcp_servers.supermemory");

    const external = '[mcp_servers.supermemory]\nurl = "https://mcp.supermemory.ai/mcp"\nhttp_headers = { "x-sm-project" = "sm_project_v1_other_repo" }\n';
    const preserved = mergeCodexMcpServers(external, desired.servers);
    expect(preserved).toMatchObject({ status: "unchanged" });
    expect(preserved.content).toBe(external);
    expect(inspectCodexSupermemoryMcpState(external)).toMatchObject({ ok: false, code: "supermemory-mcp-unmanaged" });
  });

  test("retired Serena cannot serialize a proxy", () => { const desired = buildCodexMcpServers({ packageIds: ['context-mode', 'serena'], memoryProvider: 'none', contextModeCommand: '/verified/context-mode', serenaLauncherAvailable: true, serenaProxyAvailable: true }); expect(desired).toEqual({ servers: [], gaps: [] }); const source = '# deck-codex-mcp:serena\n[mcp_servers.serena]\ncommand="user-or-legacy"\n'; expect(mergeCodexMcpServers(source, desired.servers)).toMatchObject({ status: 'unchanged', content: source }); });


  test("legacy Serena markers alone never authorize migration", () => { const desired = buildCodexMcpServers({ packageIds: ['context-mode', 'serena'], memoryProvider: 'none', contextModeCommand: '/verified/context-mode', serenaLauncherAvailable: true, serenaProxyAvailable: true }); expect(desired).toEqual({ servers: [], gaps: [] }); const source = '# deck-codex-mcp:serena\n[mcp_servers.serena]\ncommand="user-or-legacy"\n'; expect(mergeCodexMcpServers(source, desired.servers)).toMatchObject({ status: 'unchanged', content: source }); });

  test("is semantically idempotent and blocks same-ID collisions", () => { const desired = buildCodexMcpServers({ packageIds: ['context7'], memoryProvider: 'none' }); const first = mergeCodexMcpServers('', desired.servers); expect(first.status).toBe('updated'); expect(mergeCodexMcpServers(first.content, desired.servers).status).toBe('unchanged'); expect(mergeCodexMcpServers(first.content, [], { ownedServerIds: ['context7'] }).content).not.toContain('mcp_servers.context7'); const source = '[mcp_servers.context7]\ncommand="user"\n'; expect(mergeCodexMcpServers(source, desired.servers)).toMatchObject({ status: 'blocked', content: source, collisions: ['context7'] }); });

  test("pins explicit Codebase while ignoring retired Context Mode", () => { const pinned = buildCodexMcpServers({ packageIds: ['context-mode', 'codebase-memory'], memoryProvider: 'none', contextModeCommand: '/verified/context-mode', codebaseMemoryCommand: '/verified/codebase-memory-mcp' }); expect(pinned.gaps).toEqual([]); expect(pinned.servers.map(server => server.id)).toEqual(['codebase-memory']); const merged = mergeCodexMcpServers('', pinned.servers); expect(merged.content).toContain('command = "/verified/codebase-memory-mcp"'); expect(merged.content).not.toContain('context-mode'); expect(buildCodexMcpServers({ packageIds: ['context-mode', 'codebase-memory'], memoryProvider: 'none' })).toEqual({ servers: [], gaps: ['codebase-memory-not-ready'] }); });

  test("retiring a managed MCP block never swallows the ownership marker of the hook block that follows it", () => {
    const source = '# deck-codex-mcp:context7\n[mcp_servers.context7]\nurl = "https://mcp.context7.com/mcp"\n\n# deck-codex-hook:rtk:start\n[[hooks.PreToolUse]]\nmatcher = "^Bash$"\n# deck-codex-hook:rtk:end\n';
    const retired = mergeCodexMcpServers(source, [], { ownedServerIds: ["context7"] });
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

 test("retired Serena ignores reviewed proxy invocations", () => { const desired = buildCodexMcpServers({ packageIds: ['context-mode', 'serena'], memoryProvider: 'none', contextModeCommand: '/verified/context-mode', serenaLauncherAvailable: true, serenaProxyAvailable: true }); expect(desired).toEqual({ servers: [], gaps: [] }); const source = '# deck-codex-mcp:serena\n[mcp_servers.serena]\ncommand="user-or-legacy"\n'; expect(mergeCodexMcpServers(source, desired.servers)).toMatchObject({ status: 'unchanged', content: source }); });

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
    const retired = mergeCodexMcpServers(withMemory.content, buildCodexMcpServers({ packageIds: [], memoryProvider: "none" }).servers, { ownedServerIds: ["deck-memory"] });
    expect(retired.content).not.toContain("deck-memory");

    const user = '[mcp_servers.deck-memory]\ncommand = "mine"\n';
    const collision = mergeCodexMcpServers(user, buildCodexMcpServers({ packageIds: [], memoryProvider: "supermemory", deckMemoryCommand: ["/opt/deck/bin/deck", "internal", "memory-mcp"] }).servers);
    expect(collision.status).toBe("blocked");
  });
});

test('legacy retired selections cannot materialize MCP servers or readiness gaps', () => {
  expect(buildCodexMcpServers({ packageIds: ['context-mode', 'serena'], memoryProvider: 'none', contextModeCommand: '/verified/context-mode', serenaLauncherAvailable: true, serenaProxyAvailable: true })).toEqual({ servers: [], gaps: [] });
});


test("task-directory commands do not resemble inline credentials", () => {
  const command = "/private/tasks/task-c8ce6be1-3c47-402b-a4ac-d47799b81b69/tools/codebase-memory-mcp";
  const result = mergeCodexMcpServers("", [{ id: "codebase-memory", transport: "stdio", command }]);
  expect(result.status).not.toBe("blocked");
  expect(result.content).toContain(command);
  for (const credential of ["sk-synthetic12345678", "Bearer synthetic12345678"]) {
    expect(mergeCodexMcpServers("", [{ id: "codebase-memory", transport: "stdio", command: "/safe/codebase-memory-mcp", args: [credential] }]).status).toBe("blocked");
  }
});

test("explicit Codebase forwards private runtime environment names through generated TOML", () => {
  const desired = buildCodexMcpServers({
    packageIds: ["codebase-memory"],
    memoryProvider: "none",
    codebaseMemoryCommand: "/verified/codebase-memory-mcp",
  });
  const merged = mergeCodexMcpServers("", desired.servers);
  expect(merged.status).toBe("updated");
  const config = Bun.TOML.parse(merged.content) as {
    mcp_servers: Record<string, { command: string; env_vars: string[]; env?: unknown }>;
  };
  expect(config.mcp_servers["codebase-memory"]).toEqual({
    command: "/verified/codebase-memory-mcp",
    env_vars: ["CBM_RUNTIME_DIR", "CBM_CACHE_DIR", "XDG_CACHE_HOME", "XDG_RUNTIME_DIR", "TMPDIR"],
  });
  expect(mergeCodexMcpServers(merged.content, desired.servers)).toMatchObject({
    status: "unchanged", content: merged.content,
  });
});

test("available Codebase executable does not opt default selection into MCP preparation", () => {
  const desired = buildCodexMcpServers({
    packageIds: [],
    memoryProvider: "none",
    codebaseMemoryCommand: "/verified/codebase-memory-mcp",
  });
  expect(desired).toEqual({ servers: [], gaps: [] });
  expect(mergeCodexMcpServers("", desired.servers)).toMatchObject({
    status: "unchanged", content: "",
  });
});
