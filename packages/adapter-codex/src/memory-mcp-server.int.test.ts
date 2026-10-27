import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CODEX_MEMORY_MCP_SERVER_ID, createCodexMemoryMcpServer, runCodexMemoryMcpStdio } from "./memory-mcp-server";

const TOKEN = "deck-loopback-codex-mcp-token";
type Recorded = { auth: string | null; body: Record<string, any> };
let dir: string;
let server: ReturnType<typeof Bun.serve>;
let received: Recorded[];
let respond: (body: Record<string, any>) => Record<string, unknown>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "deck-codex-memory-mcp-"));
  received = [];
  const bucket = received;
  respond = (body) => body.event === "search" ? { ok: true, advisoryText: "<DECK_ADAPTIVE_CONTEXT_JSON_V1>\nCODEX_FACT\n</DECK_ADAPTIVE_CONTEXT_JSON_V1>", resultCount: 1, diagnostics: [] } : { ok: true, diagnostics: [] };
  server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) { const body = JSON.parse(await request.text()); bucket.push({ auth: request.headers.get("authorization"), body }); return Response.json(respond(body)); } });
});
afterEach(() => { server.stop(true); rmSync(dir, { recursive: true, force: true }); });

const endpoint = () => `http://127.0.0.1:${server.port}/deck-runner-memory/v1`;
function tokenFile(): string {
  const path = join(dir, "token");
  writeFileSync(path, `${TOKEN}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
  return path;
}
const configured = () => ({ DECK_RUNNER_MEMORY_ENDPOINT: endpoint(), DECK_RUNNER_MEMORY_TOKEN_FILE: tokenFile() });
const rpc = (id: number, method: string, params?: unknown) => ({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) });

describe("Codex Deck memory MCP server", () => {
  test("initialize negotiates the protocol, advertises tools only and names the server", async () => {
    const mcp = createCodexMemoryMcpServer({ env: configured() });
    const response: any = await mcp.handle(rpc(1, "initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "codex", version: "0" } }));
    expect(response).toMatchObject({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: CODEX_MEMORY_MCP_SERVER_ID } } });
    expect(await mcp.handle({ jsonrpc: "2.0", method: "notifications/initialized" })).toBeUndefined();
    expect(await mcp.handle(rpc(2, "ping"))).toEqual({ jsonrpc: "2.0", id: 2, result: {} });
    expect((await mcp.handle(rpc(3, "initialize", { protocolVersion: "1999-01-01" })) as any).result.protocolVersion).toBe("2025-06-18");
  });

  test("tools/list exposes memory_search and memory_save with closed schemas and honest annotations", async () => {
    const mcp = createCodexMemoryMcpServer({ env: configured() });
    const tools = ((await mcp.handle(rpc(1, "tools/list")) as any).result.tools) as any[];
    expect(tools.map((tool) => tool.name).sort()).toEqual(["memory_save", "memory_search"]);
    for (const tool of tools) { expect(tool.inputSchema).toMatchObject({ type: "object", additionalProperties: false }); expect(tool.description.length).toBeGreaterThan(40); }
    expect(tools.find((tool) => tool.name === "memory_search").annotations.readOnlyHint).toBe(true);
    expect(tools.find((tool) => tool.name === "memory_save").annotations.readOnlyHint).toBe(false);
  });

  test("without the loopback handoff the server lists no tools and refuses calls without exposing anything", async () => {
    for (const env of [{}, { DECK_RUNNER_MEMORY_ENDPOINT: endpoint() }, { ...configured(), DECK_RUNNER_MEMORY_ENDPOINT: "http://example.com/x" }, { ...configured(), DECK_RUNNER_MEMORY_TOKEN_FILE: join(dir, "missing") }]) {
      const mcp = createCodexMemoryMcpServer({ env });
      expect((await mcp.handle(rpc(1, "tools/list")) as any).result.tools).toEqual([]);
      const call: any = await mcp.handle(rpc(2, "tools/call", { name: "memory_search", arguments: { query: "x" } }));
      expect(call.result.isError).toBe(true);
    }
    expect(received).toHaveLength(0);
  });

  test("memory_search posts a search event as the lead with the file token and returns the advisory text", async () => {
    const mcp = createCodexMemoryMcpServer({ env: configured() });
    const call: any = await mcp.handle(rpc(5, "tools/call", { name: "memory_search", arguments: { query: "earlier decision", limit: 2 } }));
    expect(call.result.isError).toBeUndefined();
    expect(call.result.content[0].text).toContain("CODEX_FACT");
    expect(received[0]!.auth).toBe(`Bearer ${TOKEN}`);
    expect(received[0]!.body).toMatchObject({ schema: "deck-runner-memory-loopback-v1", runnerId: "codex", event: "search", role: "lead", query: "earlier decision", limit: 2 });
    expect(JSON.stringify(received[0]!.body)).not.toMatch(/containerTag|"scope"/);
    respond = () => ({ ok: true, resultCount: 0, diagnostics: [] });
    expect(((await mcp.handle(rpc(6, "tools/call", { name: "memory_search", arguments: { query: "none" } }))) as any).result.content[0].text).toMatch(/no matching project memory/i);
  });

  test("memory_save posts a save event with a unique event id and surfaces refusals as tool errors", async () => {
    const mcp = createCodexMemoryMcpServer({ env: configured() });
    const ok: any = await mcp.handle(rpc(7, "tools/call", { name: "memory_save", arguments: { content: "Decision: Codex saves through the Deck loopback.", kind: "decision" } }));
    expect(ok.result.content[0].text).toMatch(/saved/i);
    respond = () => ({ ok: false, diagnostics: ["Capture skipped because content contains high-confidence secret material."] });
    const refused: any = await mcp.handle(rpc(8, "tools/call", { name: "memory_save", arguments: { content: "token=abcdefghijklmnop is the key for production." } }));
    expect(refused.result.isError).toBe(true);
    expect(refused.result.content[0].text).toContain("secret material");
    const saves = received.filter((entry) => entry.body.event === "save");
    expect(saves[0]!.body).toMatchObject({ runnerId: "codex", role: "lead", kind: "decision" });
    expect(new Set(saves.map((entry) => entry.body.eventId)).size).toBe(2);
  });

  test("invalid arguments, unknown tools and unknown methods are protocol-correct and never reach the host", async () => {
    const mcp = createCodexMemoryMcpServer({ env: configured() });
    expect(((await mcp.handle(rpc(1, "tools/call", { name: "memory_search", arguments: { query: "  " } }))) as any).result.isError).toBe(true);
    expect(((await mcp.handle(rpc(2, "tools/call", { name: "memory_search", arguments: { query: "ok", limit: 9 } }))) as any).result.isError).toBe(true);
    expect(((await mcp.handle(rpc(3, "tools/call", { name: "memory_save", arguments: { content: "" } }))) as any).result.isError).toBe(true);
    expect(((await mcp.handle(rpc(4, "tools/call", { name: "memory_delete", arguments: {} }))) as any).error.code).toBe(-32602);
    expect(((await mcp.handle(rpc(5, "frobnicate"))) as any).error.code).toBe(-32601);
    expect(received).toHaveLength(0);
  });

  test("an unreachable host is a fail-open tool error, not a crash", async () => {
    const mcp = createCodexMemoryMcpServer({ env: configured(), timeoutMs: 500 });
    server.stop(true);
    const call: any = await mcp.handle(rpc(1, "tools/call", { name: "memory_search", arguments: { query: "anything" } }));
    expect(call.result.isError).toBe(true);
    expect(call.result.content[0].text).toMatch(/unavailable/i);
  });

  test("the stdio loop frames newline-delimited JSON-RPC, tolerates garbage and answers batches", async () => {
    const out: string[] = [];
    const lines = [JSON.stringify(rpc(1, "initialize", { protocolVersion: "2025-06-18" })), "not json", JSON.stringify([rpc(2, "ping"), rpc(3, "tools/list")]), JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })];
    await runCodexMemoryMcpStdio({ input: (async function* () { yield `${lines.slice(0, 2).join("\n")}\n${lines[2]!.slice(0, 10)}`; yield `${lines[2]!.slice(10)}\n${lines[3]}\n`; })(), write: (line) => out.push(line), env: configured() });
    const messages = out.map((line) => JSON.parse(line));
    expect(messages.find((m) => m.id === 1).result.serverInfo.name).toBe(CODEX_MEMORY_MCP_SERVER_ID);
    expect(messages.find((m) => m.error?.code === -32700)).toBeDefined();
    const batch = messages.find((m) => Array.isArray(m));
    expect(batch!.map((m: any) => m.id)).toEqual([2, 3]);
  });
});
