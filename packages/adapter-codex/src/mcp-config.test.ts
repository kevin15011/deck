import { describe, expect, test } from "bun:test";
import { buildCodexMcpServers,
  isCodexSerenaMcpConfigured, inspectCodexMcpServerCommand, mergeCodexMcpServers, redactCodexMcpDiagnostic } from "./mcp-config";

describe("Codex MCP semantic configuration", () => {
  test("selected repair preserves unowned standard entries and their tool policies", () => { const source = '# personal config\n[mcp_servers.codebase-memory]\ncommand="codebase-memory-mcp"\n[mcp_servers.codebase-memory.tools.search_code]\napproval_mode="approve"\n[mcp_servers.other]\ncommand="custom"\n'; const desired = buildCodexMcpServers({ packageIds: ['codebase-memory'], codebaseMemoryCommand: '/verified/codebase-memory-mcp' }).servers; expect(mergeCodexMcpServers(source, desired, { repairSelectedToolIds: ['codebase-memory'] })).toMatchObject({ status: 'blocked', content: source }); });

  test("selected repair preserves custom invocations and returns original bytes if any collision remains", () => {
    const desired = buildCodexMcpServers({ packageIds: ["context-mode", "codebase-memory"], contextModeCommand: "/opt/bin/context-mode", codebaseMemoryCommand: "/opt/deck/codebase-memory-mcp" }).servers;
    for (const custom of ['command = "wrapper"', 'command = "codebase-memory-mcp"\nargs = ["--custom"]', 'command = "codebase-memory-mcp"\nenv = { TOKEN = "sensitive-value" }']) {
      const source = `[mcp_servers.context-mode]\ncommand = "context-mode"\n[mcp_servers.codebase-memory]\n${custom}\n`;
      const merged = mergeCodexMcpServers(source, desired, { repairSelectedToolIds: ["context-mode", "codebase-memory"] });
      expect(merged).toMatchObject({ status: "blocked", content: source, collisions: ["codebase-memory"] });
      if (merged.status === "blocked") expect(merged.diagnostics.join(" ")).not.toContain("sensitive-value");
    }
    const source = '[mcp_servers.context-mode]\ncommand = "context-mode"\n[mcp_servers.codebase-memory]\ncommand = "codebase-memory-mcp"\n';
    expect(mergeCodexMcpServers(source, desired, { repairSelectedToolIds: ["context-mode"] })).toMatchObject({ status: "blocked", content: source, collisions: ["codebase-memory"] });
  });

  test("retired Serena cannot serialize a proxy", () => { const desired = buildCodexMcpServers({ packageIds: ['context-mode', 'serena'], contextModeCommand: '/verified/context-mode', serenaLauncherAvailable: true, serenaProxyAvailable: true }); expect(desired).toEqual({ servers: [], gaps: [] }); const source = '# deck-codex-mcp:serena\n[mcp_servers.serena]\ncommand="user-or-legacy"\n'; expect(mergeCodexMcpServers(source, desired.servers)).toMatchObject({ status: 'unchanged', content: source }); });


  test("legacy Serena markers alone never authorize migration", () => { const desired = buildCodexMcpServers({ packageIds: ['context-mode', 'serena'], contextModeCommand: '/verified/context-mode', serenaLauncherAvailable: true, serenaProxyAvailable: true }); expect(desired).toEqual({ servers: [], gaps: [] }); const source = '# deck-codex-mcp:serena\n[mcp_servers.serena]\ncommand="user-or-legacy"\n'; expect(mergeCodexMcpServers(source, desired.servers)).toMatchObject({ status: 'unchanged', content: source }); });

  test("is semantically idempotent and blocks same-ID collisions", () => { const desired = buildCodexMcpServers({ packageIds: ['context7'], context7Command: '/verified/context7-mcp' }); const first = mergeCodexMcpServers('', desired.servers); expect(first.status).toBe('updated'); expect(mergeCodexMcpServers(first.content, desired.servers).status).toBe('unchanged'); expect(mergeCodexMcpServers(first.content, [], { ownedServerIds: ['context7'] }).content).not.toContain('mcp_servers.context7'); const source = '[mcp_servers.context7]\ncommand="user"\n'; expect(mergeCodexMcpServers(source, desired.servers)).toMatchObject({ status: 'blocked', content: source, collisions: ['context7'] }); });

  test("pins explicit Codebase while ignoring retired Context Mode", () => { const pinned = buildCodexMcpServers({ packageIds: ['context-mode', 'codebase-memory'], contextModeCommand: '/verified/context-mode', codebaseMemoryCommand: '/verified/codebase-memory-mcp' }); expect(pinned.gaps).toEqual([]); expect(pinned.servers.map(server => server.id)).toEqual(['codebase-memory']); const merged = mergeCodexMcpServers('', pinned.servers); expect(merged.content).toContain('command = "/verified/codebase-memory-mcp"'); expect(merged.content).not.toContain('context-mode'); expect(buildCodexMcpServers({ packageIds: ['context-mode', 'codebase-memory'], })).toEqual({ servers: [], gaps: ['codebase-memory-not-ready'] }); });

  test("retiring a managed MCP block never swallows the ownership marker of the hook block that follows it", () => {
    const source = '# deck-codex-mcp:context7\n[mcp_servers.context7]\nurl = "https://mcp.context7.com/mcp"\n\n# deck-codex-hook:rtk:start\n[[hooks.PreToolUse]]\nmatcher = "^Bash$"\n# deck-codex-hook:rtk:end\n';
    const retired = mergeCodexMcpServers(source, [], { ownedServerIds: ["context7"] });
    expect(retired.status).toBe("updated");
    expect(retired.content).not.toContain("mcp_servers.context7");
    expect(retired.content).toContain("# deck-codex-hook:rtk:start");
    expect(retired.content).toContain("# deck-codex-hook:rtk:end");
  });

  test("keeps disabled memory explicit and redacts credential-like diagnostics", () => {
    expect(buildCodexMcpServers({ packageIds: [], })).toEqual({ servers: [], gaps: [] });
    expect(redactCodexMcpDiagnostic("token=very-secret-value failed")).toBe("token=[REDACTED] failed");
  });
});

 test("retired Serena ignores reviewed proxy invocations", () => { const desired = buildCodexMcpServers({ packageIds: ['context-mode', 'serena'], contextModeCommand: '/verified/context-mode', serenaLauncherAvailable: true, serenaProxyAvailable: true }); expect(desired).toEqual({ servers: [], gaps: [] }); const source = '# deck-codex-mcp:serena\n[mcp_servers.serena]\ncommand="user-or-legacy"\n'; expect(mergeCodexMcpServers(source, desired.servers)).toMatchObject({ status: 'unchanged', content: source }); });

test('legacy retired selections cannot materialize MCP servers or readiness gaps', () => {
  expect(buildCodexMcpServers({ packageIds: ['context-mode', 'serena'], contextModeCommand: '/verified/context-mode', serenaLauncherAvailable: true, serenaProxyAvailable: true })).toEqual({ servers: [], gaps: [] });
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
    codebaseMemoryCommand: "/verified/codebase-memory-mcp",
  });
  expect(desired).toEqual({ servers: [], gaps: [] });
  expect(mergeCodexMcpServers("", desired.servers)).toMatchObject({
    status: "unchanged", content: "",
  });
});

 test("legacy Codebase upgrade respects recorded ownership and custom fields", () => {
  const source = '# deck-codex-mcp:codebase-memory\n[mcp_servers.codebase-memory]\ncommand = "/tools/codebase-memory-mcp"\n';
  const desired = buildCodexMcpServers({ packageIds: ["codebase-memory"], codebaseMemoryCommand: "/tools/codebase-memory-mcp" }).servers;
  expect(mergeCodexMcpServers(source, desired, { ownedServerIds: ["codebase-memory"], recordedServerIds: ["codebase-memory"] }).status).toBe("updated");
  for (const current of [source, source + 'args = ["custom"]\n', source.replace('/tools/codebase-memory-mcp', '/user/custom')]) {
    expect(mergeCodexMcpServers(current, desired, { recordedServerIds: ["codebase-memory"] })).toMatchObject({ status: "blocked", content: current });
  }
  expect(mergeCodexMcpServers(source + 'args = ["custom"]\n', desired).status).toBe("blocked");
  expect(mergeCodexMcpServers(source, desired, { allowLegacyMigration: false }).status).toBe("blocked");
 });

describe("Context7 local migration", () => {
  const legacy = '# deck-codex-mcp:context7\n[mcp_servers.context7]\nurl = "https://mcp.context7.com/mcp"\nenv_http_headers = { "X-Context7-API-Key" = "CONTEXT7_API_KEY" }\n';
  const desired = [{ id: "context7" as const, transport: "stdio" as const, command: "/verified/context7-mcp" }];
  test("adopts only the exact marked legacy remote entry and remains idempotent", () => {
    const result = mergeCodexMcpServers(legacy, desired);
    expect(result).toMatchObject({ status: "updated", adoptedServerIds: ["context7"] });
    expect(Bun.TOML.parse(result.content)).toEqual({ mcp_servers: { context7: { command: "/verified/context7-mcp" } } });
    expect(mergeCodexMcpServers(result.content, desired).status).toBe("unchanged");
    expect(mergeCodexMcpServers(legacy, desired, { ownedServerIds: ["context7"], recordedServerIds: ["context7"] }).status).toBe("updated");
  });
  test("preserves customized, unmarked and receipt-mismatched remote entries", () => {
    for (const source of [legacy + 'enabled = false\n', legacy.replace('https://mcp.context7.com/mcp', 'https://custom.example/mcp'), legacy.replace('# deck-codex-mcp:context7\n', '')]) {
      expect(mergeCodexMcpServers(source, desired)).toMatchObject({ status: "blocked", content: source });
    }
    expect(mergeCodexMcpServers(legacy, desired, { recordedServerIds: ["context7"] })).toMatchObject({ status: "blocked", content: legacy });
  });
});

for (const id of ["context7", "codebase-memory"] as const) {
  for (const policy of ['approval_mode = "approve"', 'enabled = false']) {
    test(`preserves nested ${policy} in legacy ${id} during migration`, () => {
      // Protects user tool policy: a marker cannot authorize deleting nested customization.
      const launch = id === "context7"
        ? 'url = "https://mcp.context7.com/mcp"\nenv_http_headers = { "X-Context7-API-Key" = "CONTEXT7_API_KEY" }\n'
        : 'command = "/tools/codebase-memory-mcp"\n';
      const source = `# deck-codex-mcp:${id}\n[mcp_servers.${id}]\n${launch}[mcp_servers.${id}.tools.resolve-library-id]\n${policy}\n`;
      const desired = buildCodexMcpServers({ packageIds: [id], context7Command: "/tools/context7-mcp", codebaseMemoryCommand: "/tools/codebase-memory-mcp" }).servers;
      for (const options of [{}, { recordedServerIds: [id] }]) {
        expect(mergeCodexMcpServers(source, desired, options)).toMatchObject({ status: "blocked", content: source });
      }
    });
  }
}
