import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { validateDeckConfig } from "@deck/core";
import { resolveCanonicalSupermemoryProjectScope } from "@deck/core";
import { CLAUDE_SUPERMEMORY_COMMIT, installClaudeSupermemoryArtifact, inspectClaudeSupermemoryArtifact } from "../../../packages/adapter-claude/src/supermemory-artifact";
import { CLAUDE_SUPERMEMORY_MCP_ID } from "../../../packages/adapter-claude/src/supermemory-transport";
import { buildClaudeTurnLaunch } from "../../../packages/adapter-claude/src/session-driver/launch";
import { prepareSessionNativeMemory } from "./session-native-memory";

// Protects actual production composition: modern metadata survives stdio/HTTP,
// the pinned plugin keeps scoping/hooks, legacy sessions and notification replies
// survive, and ordinary MCP servers remain alongside exactly one memory server.
// Oracle: MCP 2026-07-28 HTTP headers plus legacy negotiated-version/session rules.
// Red evidence: actual Claude 2.1.309 discovery returned -32020 before the adapter.
test("prepared Claude transport preserves plugin behavior across modern and legacy HTTP", async () => {
  const home = mkdtempSync(join(tmpdir(), "deck-claude-transport-"));
  const observed: any[] = [];
  let subscriptionCancelled = false;
  const upstream = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(req) {
    const body: any = await req.json();
    const headers = Object.fromEntries(req.headers);
    observed.push({ body, headers });
    if (headers["mcp-method"] !== body.method) return Response.json({ error: "missing method" }, { status: 400 });
    if (!Object.hasOwn(body, "id")) return new Response(null, { status: 202 });
    if (body.method === "subscriptions/listen") return new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: ' + JSON.stringify({ jsonrpc: "2.0", method: "notifications/subscriptions/acknowledged", params: { _meta: { "io.modelcontextprotocol/subscriptionId": body.id }, notifications: { toolsListChanged: true } } }) + '\r\n\r\n'));
        controller.enqueue(new TextEncoder().encode(': keepalive\r\ndata: {"jsonrpc":"2.0",\r\n'));
        controller.enqueue(new TextEncoder().encode('data: "method":"notifications/tools/list_changed", "params":{"_meta":{"io.modelcontextprotocol/subscriptionId":8}}}\r\n\r\n'));
      }, cancel() { subscriptionCancelled = true; },
    }), { headers: { "content-type": "text/event-stream" } });
    const result = body.method === "initialize" ? { protocolVersion: "2025-06-18", capabilities: {}, serverInfo: { name: "fake", version: "1" } }
      : body.method === "tools/list" ? { tools: [{ name: "search_memory", inputSchema: { type: "object" } }] }
      : { content: [{ type: "text", text: "retained provider reply" }] };
    const reply = JSON.stringify({ jsonrpc: "2.0", id: body.id, result });
    return body.method === "initialize" ? new Response(`event: message\ndata: ${reply}\n\n`, { headers: { "content-type": "text/event-stream", "mcp-session-id": "legacy-session" } }) : Response.json(JSON.parse(reply));
  } });
  try {
    const cwd = join(home, "project"), unpack = join(home, "unpack"), parent = join(home, ".local/share/deck/claude");
    for (const directory of [cwd, unpack, parent]) mkdirSync(directory, { recursive: true, mode: 0o700 });
    expect(Bun.spawnSync(["git", "init", "-q", cwd]).exitCode).toBe(0);
    expect(Bun.spawnSync(["git", "-C", cwd, "remote", "add", "origin", "https://github.com/decktest/transport.git"]).exitCode).toBe(0);
    const scope = resolveCanonicalSupermemoryProjectScope({ projectRoot: cwd, remotes: [] });
    if (!scope.ok) throw Error("fixture identity missing");
    const archive = new URL(`../../../packages/adapter-claude/src/fixtures/claude-supermemory-${CLAUDE_SUPERMEMORY_COMMIT.slice(0, 12)}.tgz`, import.meta.url).pathname;
    expect(Bun.spawnSync(["tar", "-xzf", archive, "-C", unpack]).exitCode).toBe(0);
    const root = join(parent, `official-supermemory-${CLAUDE_SUPERMEMORY_COMMIT.slice(0, 12)}`);
    await installClaudeSupermemoryArtifact(root, { fetchFile: async path => readFileSync(join(unpack, path)) });
    const environment = { HOME: home, PATH: process.env.PATH! };
    const prepared = prepareSessionNativeMemory("claude", cwd, validateDeckConfig({ adaptiveMemory: { enabled: true, activeProvider: "supermemory" } }), environment,
      { credential: () => ({ token: "test-secret-not-in-output", canonicalRepoTag: scope.scope }) })!;
    expect(prepared.nativeMemory.status).toBe("ready");
    const files = new Map<string, string>();
    const launch = buildClaudeTurnLaunch({ taskId: "transport", memberId: "apply-deep", cwd, assignment: { runnerId: "claude", modelId: "fake" }, rolePrompt: "", prompt: "", mcp: { servers: ["ordinary"], sessionTools: [] }, mcpServerSpecs: { ordinary: { command: "ordinary-tool", args: [], env: {} } }, credentialFile: "/unused", approvals: "runner-default", disableNativeDelegation: true, nativeSessionId: crypto.randomUUID(), nativeMemory: prepared.nativeMemory },
      { writePrivateFile: (name, content) => { files.set(name, content); return join(home, name); } }, { baseEnv: environment });
    const servers = JSON.parse(files.get("mcp-config.json")!).mcpServers;
    expect(launch.expectedMcpServers).toEqual(["ordinary", CLAUDE_SUPERMEMORY_MCP_ID]);
    expect(servers.ordinary.command).toBe("ordinary-tool");
    expect(launch.args).toContain(root);
    expect(prepared.nativeMemory.plugin?.hooks).toEqual(JSON.parse(readFileSync(join(root, "hooks/hooks.json"), "utf8")).hooks);
    const modern = { "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientCapabilities": {} };
    const messages = [
      { id: 1, method: "server/discover", params: { _meta: modern } },
      { id: 2, method: "tools/list", params: { _meta: modern } },
      { id: 3, method: "tools/call", params: { name: "search_memory", arguments: { query: "test" }, _meta: modern } },
      { id: 4, method: "resources/read", params: { uri: "file:///mémory", _meta: modern } },
      { id: 5, method: "prompts/get", params: { name: "=?base64?literal?=", _meta: modern } },
      { id: 6, method: "initialize", params: { protocolVersion: "2025-11-25" } },
      { method: "notifications/initialized" },
      { id: 7, method: "tools/list" },
    ];
    const spec = servers[CLAUDE_SUPERMEMORY_MCP_ID];
    const child = Bun.spawn([spec.command, ...spec.args], { cwd, env: { ...environment, ...prepared.envOverlay, SUPERMEMORY_MCP_URL: `http://127.0.0.1:${upstream.port}/mcp` }, stdin: new Blob([messages.map(message => JSON.stringify({ jsonrpc: "2.0", ...message })).join("\n") + "\n"]), stdout: "pipe", stderr: "pipe" });
    const timer = setTimeout(() => child.kill("SIGKILL"), 4000);
    const [output, error, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]); clearTimeout(timer);
    expect(code).toBe(0); expect(error).toBe(""); expect(output).not.toContain("test-secret-not-in-output");
    const replies = output.trim().split("\n").map(line => JSON.parse(line));
    expect(replies.map(reply => reply.id)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(replies.every(reply => !reply.error)).toBe(true);
    expect(replies[2].result.content[0].text).toBe("retained provider reply");
    expect(observed).toHaveLength(8);
    for (const entry of observed.slice(0, 5)) expect(entry.headers["mcp-protocol-version"]).toBe("2026-07-28");
    expect(observed[2].headers["mcp-name"]).toBe("search_memory");
    expect(observed[2].body.params.arguments.containerTag).toBe(scope.scope);
    expect(observed[3].headers["mcp-name"]).toBe("=?base64?" + Buffer.from("file:///mémory").toString("base64") + "?=");
    expect(observed[4].headers["mcp-name"]).toBe("=?base64?" + Buffer.from("=?base64?literal?=").toString("base64") + "?=");
    for (const entry of observed.slice(6)) { expect(entry.headers["mcp-protocol-version"]).toBe("2025-06-18"); expect(entry.headers["mcp-session-id"]).toBe("legacy-session"); }
    // A live subscription must neither block discovery nor lose framed events.
    const streaming = Bun.spawn([spec.command, ...spec.args], { cwd, env: { ...environment, ...prepared.envOverlay, SUPERMEMORY_MCP_URL: `http://127.0.0.1:${upstream.port}/mcp` }, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
    const deadline = setTimeout(() => streaming.kill("SIGKILL"), 4000);
    const seen: any[] = [];
    const collecting = (async () => {
      let buffer = "";
      for await (const chunk of streaming.stdout) {
        buffer += new TextDecoder().decode(chunk);
        while (buffer.includes("\n")) {
          const end = buffer.indexOf("\n"); seen.push(JSON.parse(buffer.slice(0, end))); buffer = buffer.slice(end + 1);
        }
        if (seen.some(frame => frame.id === 9) && seen.some(frame => frame.method === "notifications/tools/list_changed")) {
          streaming.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 8 } }) + "\n");
          streaming.stdin.end();
        }
      }
    })();
    for (const [id, method] of [[8, "subscriptions/listen"], [9, "tools/list"]] as const) streaming.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params: { _meta: modern } }) + "\n");
    const [streamExit, streamError] = await Promise.all([streaming.exited, new Response(streaming.stderr).text(), collecting]); clearTimeout(deadline);
    expect(streamExit).toBe(0); expect(streamError).toBe("");
    expect(seen.some(frame => frame.id === 9 && frame.result.tools.length === 1)).toBe(true);
    expect(seen.some(frame => frame.method === "notifications/tools/list_changed")).toBe(true);
    expect(seen.find(frame => frame.method === "notifications/subscriptions/acknowledged")?.params._meta["io.modelcontextprotocol/subscriptionId"]).toBe(8);
    expect(subscriptionCancelled).toBe(true);
    expect(observed.some(entry => entry.body.method === "notifications/cancelled")).toBe(false);
    expect(inspectClaudeSupermemoryArtifact(root)).toBe("ready");
  } finally { upstream.stop(true); rmSync(home, { recursive: true, force: true }); }
});
