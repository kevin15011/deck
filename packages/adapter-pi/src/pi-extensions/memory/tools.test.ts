import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { clearPublishedMemoryHandoff } from "../shared/memory-handoff";
import { createDeckMemoryExtension } from "./extension";

const TOKEN = "deck-loopback-tools-token";
type Recorded = { auth: string | null; body: Record<string, any> };
let dir: string;
let server: ReturnType<typeof Bun.serve>;
let received: Recorded[];
let respond: (body: Record<string, any>) => Record<string, unknown>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "deck-memory-tools-"));
  received = [];
  const bucket = received;
  respond = (body) => body.event === "search" ? { ok: true, advisoryText: "<DECK_ADAPTIVE_CONTEXT_JSON_V1>\nFACT_A\n</DECK_ADAPTIVE_CONTEXT_JSON_V1>", resultCount: 1, diagnostics: [] } : { ok: true, diagnostics: [] };
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const body = JSON.parse(await request.text());
      bucket.push({ auth: request.headers.get("authorization"), body });
      return Response.json(respond(body));
    },
  });
  clearPublishedMemoryHandoff();
});
afterEach(() => { server.stop(true); rmSync(dir, { recursive: true, force: true }); clearPublishedMemoryHandoff(); });

const endpoint = () => `http://127.0.0.1:${server.port}/deck-runner-memory/v1`;
function tokenFile(): string {
  const path = join(dir, "token");
  writeFileSync(path, `${TOKEN}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
  return path;
}

type Tool = { name: string; description: string; parameters: any; execute: (id: string, params: any, signal: AbortSignal | undefined, onUpdate: undefined, ctx: any) => Promise<{ content: { type: string; text: string }[]; details: any }> };
function load(overrides: Record<string, string | undefined> = {}) {
  const env: Record<string, string | undefined> = { DECK_PI_SESSION: "1", DECK_PI_ROLE: "lead", DECK_RUNNER_MEMORY_ENDPOINT: endpoint(), DECK_RUNNER_MEMORY_TOKEN_FILE: tokenFile(), ...overrides };
  const tools: Tool[] = [];
  createDeckMemoryExtension({ env, requestTimeoutMs: 1500, drainTimeoutMs: 500 })({ on() {}, registerTool: (tool: Tool) => { tools.push(tool); } } as never);
  const ctx = { sessionManager: { getSessionId: () => "sess-tools" } };
  const call = (name: string, params: any) => tools.find((tool) => tool.name === name)!.execute("call-1", params, undefined, undefined, ctx);
  return { tools, call, names: () => tools.map((tool) => tool.name).sort() };
}

describe("deck-memory explicit tools", () => {
  test("the lead gets memory_search and memory_save with closed JSON schemas", () => {
    const { tools, names } = load();
    expect(names()).toEqual(["memory_save", "memory_search"]);
    for (const tool of tools) {
      expect(tool.parameters.type).toBe("object");
      expect(tool.parameters.additionalProperties).toBe(false);
      expect(tool.description.length).toBeGreaterThan(40);
    }
    expect(tools.find((tool) => tool.name === "memory_search")!.parameters.required).toEqual(["query"]);
    expect(tools.find((tool) => tool.name === "memory_save")!.parameters.required).toEqual(["content"]);
  });

  test("read-only roles are offered search only; apply-fast is offered save only; write roles get both", () => {
    expect(load({ DECK_PI_ROLE: "investigate", DECK_PI_CHILD: "1" }).names()).toEqual(["memory_search"]);
    expect(load({ DECK_PI_ROLE: "deck-quality", DECK_PI_CHILD: "1" }).names()).toEqual(["memory_search"]);
    expect(load({ DECK_PI_ROLE: "apply-fast", DECK_PI_CHILD: "1" }).names()).toEqual(["memory_save"]);
    expect(load({ DECK_PI_ROLE: "apply-deep", DECK_PI_CHILD: "1" }).names()).toEqual(["memory_save", "memory_search"]);
  });

  test("no tools are registered when memory is disabled or the handoff is missing or unusable", () => {
    expect(load({ DECK_PI_MEMORY: "disabled" }).names()).toEqual([]);
    expect(load({ DECK_RUNNER_MEMORY_ENDPOINT: undefined }).names()).toEqual([]);
    expect(load({ DECK_RUNNER_MEMORY_TOKEN_FILE: join(dir, "missing") }).names()).toEqual([]);
    expect(load({ DECK_RUNNER_MEMORY_ENDPOINT: "http://example.com/x" }).names()).toEqual([]);
  });

  test("memory_search sends a search event with the role and returns the bounded advisory text", async () => {
    const { call } = load({ DECK_PI_ROLE: "investigate", DECK_PI_CHILD: "1" });
    const result = await call("memory_search", { query: "loopback convention", limit: 3 });
    expect(result.content[0]!.text).toContain("FACT_A");
    const sent = received.at(-1)!;
    expect(sent.auth).toBe(`Bearer ${TOKEN}`);
    expect(sent.body).toMatchObject({ schema: "deck-runner-memory-loopback-v1", runnerId: "pi", event: "search", role: "investigate", sessionId: "sess-tools", query: "loopback convention", limit: 3 });
    expect(JSON.stringify(sent.body)).not.toMatch(/containerTag|"scope"/);
  });

  test("memory_search says so when nothing matches and relays a role refusal without throwing", async () => {
    const { call } = load();
    respond = () => ({ ok: true, resultCount: 0, diagnostics: [] });
    expect((await call("memory_search", { query: "unknown" })).content[0]!.text).toMatch(/no matching project memory/i);
    respond = () => ({ ok: false, diagnostics: ["role-not-permitted"] });
    expect((await call("memory_search", { query: "unknown" })).content[0]!.text).toMatch(/not permitted for this role/i);
  });

  test("memory_save sends a save event with a unique event id per call and reports success or the reason", async () => {
    const { call } = load();
    expect((await call("memory_save", { content: "Decision: use the loopback for explicit memory.", kind: "decision" })).content[0]!.text).toMatch(/saved/i);
    respond = () => ({ ok: false, diagnostics: ["Capture skipped because content contains high-confidence secret material."] });
    const refused = await call("memory_save", { content: "API_KEY=abc" });
    expect(refused.content[0]!.text).toMatch(/not saved/i);
    expect(refused.content[0]!.text).toContain("secret material");
    const saves = received.filter((entry) => entry.body.event === "save");
    expect(saves[0]!.body).toMatchObject({ event: "save", role: "lead", kind: "decision", content: "Decision: use the loopback for explicit memory." });
    expect(new Set(saves.map((entry) => entry.body.eventId)).size).toBe(2);
  });

  test("an unreachable host yields a fail-open message instead of an exception", async () => {
    const { call } = load();
    server.stop(true);
    expect((await call("memory_search", { query: "anything" })).content[0]!.text).toMatch(/unavailable/i);
    expect((await call("memory_save", { content: "Decision: this cannot reach the host right now." })).content[0]!.text).toMatch(/not saved/i);
  });

  test("invalid parameters never reach the host", async () => {
    const { call } = load();
    expect((await call("memory_search", { query: "   " })).content[0]!.text).toMatch(/query/i);
    expect((await call("memory_search", { query: "ok", limit: 9 })).content[0]!.text).toMatch(/limit/i);
    expect((await call("memory_save", { content: "" })).content[0]!.text).toMatch(/content/i);
    expect(received).toHaveLength(0);
  });
});
