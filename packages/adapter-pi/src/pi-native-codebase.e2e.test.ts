import { expect, test } from "bun:test";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

// Exercise Pi's real native MCP lifecycle plus the shipped Node extension, with only transport faked.
test("native MCP connection failure omits tools and shipped policy falls back; restoration exposes real tools", async () => {
  const sdk = dirname(import.meta.resolve("@earendil-works/pi-coding-agent").replace("file://", ""));
  const { createMcpExtension } = await import(join(sdk, "extensions/mcp/index.js"));
  const policyPath = join(import.meta.dir, "../assets/pi/extensions/deck-tool-policy.generated.js");
  const root = mkdtempSync(join(tmpdir(), "deck-pi-native-codebase-"));
  // Bun's production file-asset import caches this source path as a filename. Execute an exact copy.
  const executablePolicy = join(root, "policy.mjs");
  copyFileSync(policyPath, executablePolicy);
  const { createDeckToolPolicyExtension } = await import(executablePolicy);
  const policy = createDeckToolPolicyExtension({ reviewedReadiness: () => true });
  const prior = process.env.DECK_PI_SESSION;
  process.env.DECK_PI_SESSION = "1";
  try {
    for (const available of [false, true]) {
      const handlers: Record<string, Array<(event: any, ctx: any) => any>> = {};
      const definitions = new Map<string, any>();
      const notices: string[] = [];
      let active: string[] = [];
      const api = {
        on(name: string, handler: any) { (handlers[name] ??= []).push(handler); },
        getMcpServers: () => [], registerCommand() {},
        registerTool(tool: any) { definitions.set(tool.name, tool); if (tool.exposure === "direct" && !active.includes(tool.name)) active.push(tool.name); },
        getActiveTools: () => active, setActiveTools: (tools: string[]) => { active = tools; },
        getAllTools: () => [...definitions.values()],
      };
      createMcpExtension({
        logPath: join(root, "mcp.log"), startupWaitMs: 1000,
        loadConfig: () => ({ servers: [{ name: "codebase-memory", source: join(root, "mcp.json"), scope: "global", config: { command: "/missing/codebase-memory-mcp", exposure: "direct" } }], errors: [] }),
        createTransport: () => {
          if (!available) throw Object.assign(new Error("fixture executable missing"), { code: "ENOENT" });
          // In-memory JSON-RPC fixture: no process, provider, network, or artifact acquisition.
          const transport: any = {
            onMessage(handler: any) { transport.onmessage = handler; return () => {}; },
            onError() { return () => {}; }, onClose() { return () => {}; },
            start: async () => {}, close: async () => {},
            send: async (message: any) => {
              if (message.id === undefined) return;
              const result = message.method === "initialize"
                ? { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "fixture", version: "1" } }
                : message.method === "tools/list"
                  ? { tools: ["search_graph", "trace_path", "get_code_snippet", "search_code"].map(name => ({ name, inputSchema: { type: "object" } })) }
                  : {};
              queueMicrotask(() => transport.onmessage?.({ jsonrpc: "2.0", id: message.id, result }));
            },
          };
          return transport;
        },
      })(api);
      policy(api);
      const ctx = { cwd: root, hasUI: true, ui: { notify: (text: string) => notices.push(text) }, signal: new AbortController().signal };
      const dispatch = async (name: string, event: any) => {
        let result: any;
        for (const handler of handlers[name] ?? []) result = await handler(event, ctx) ?? result;
        return result;
      };
      try {
        await dispatch("session_start", {});
        const result = await dispatch("before_agent_start", { systemPrompt: "Native profile", systemPromptOptions: { sections: {} } });
        expect({ active, notices: available ? notices : [] }).toMatchObject(available ? { active: expect.arrayContaining(["mcp__codebase_memory__search_graph"]) } : { active: [] });
        if (available) expect(result).toBeUndefined();
        else {
          expect(result.systemPrompt).toContain("Use file listing, rg searches");
          expect(notices.filter(text => text.startsWith("Deck: Codebase Memory"))).toHaveLength(1);
        }
      } finally { await dispatch("session_shutdown", {}); }
    }
  } finally {
    if (prior === undefined) delete process.env.DECK_PI_SESSION; else process.env.DECK_PI_SESSION = prior;
    rmSync(root, { recursive: true, force: true });
  }
});
