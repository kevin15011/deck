import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { clearPublishedMemoryHandoff, readPublishedMemoryHandoff } from "../shared/memory-handoff";
import { createDeckMemoryExtension } from "./extension";

const TOKEN = "deck-loopback-test-token";
const ADVISORY = "<DECK_ADAPTIVE_CONTEXT_JSON_V1>\nadvisory\n{\"items\":[\"remember X\"]}\n</DECK_ADAPTIVE_CONTEXT_JSON_V1>";

type Recorded = { auth: string | null; body: Record<string, any> };
let dir: string;
let server: ReturnType<typeof Bun.serve>;
let received: Recorded[];
let behavior: { advisory?: string; recallOk?: boolean; delayMs?: number; delayEvents?: string[] };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "deck-memory-ext-"));
  received = [];
  behavior = { advisory: ADVISORY };
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const body = JSON.parse(await request.text());
      if (behavior.delayMs && (!behavior.delayEvents || behavior.delayEvents.includes(body.event))) await Bun.sleep(behavior.delayMs);
      received.push({ auth: request.headers.get("authorization"), body });
      const recall = ["session_start", "recall", "role_start"].includes(body.event);
      if (recall && behavior.recallOk === false) return Response.json({ ok: false, diagnostics: ["provider_error"] });
      return Response.json(recall ? { ok: true, advisoryText: behavior.advisory, diagnostics: [] } : { ok: true, diagnostics: [] });
    },
  });
  clearPublishedMemoryHandoff();
});
afterEach(() => {
  server.stop(true);
  rmSync(dir, { recursive: true, force: true });
  clearPublishedMemoryHandoff();
});

const endpoint = () => `http://127.0.0.1:${server.port}/deck-runner-memory/v1`;
function tokenFile(): string {
  const path = join(dir, "token");
  writeFileSync(path, `${TOKEN}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
  return path;
}

type Handler = (event: any, ctx: any) => unknown;
function load(overrides: Record<string, string | undefined> = {}, options: Parameters<typeof createDeckMemoryExtension>[0] = {}) {
  const env: Record<string, string | undefined> = { DECK_PI_SESSION: "1", DECK_PI_ROLE: "lead", DECK_RUNNER_MEMORY_ENDPOINT: endpoint(), DECK_RUNNER_MEMORY_TOKEN_FILE: tokenFile(), ...overrides };
  const handlers: Record<string, Handler[]> = {};
  createDeckMemoryExtension({ env, requestTimeoutMs: 1500, drainTimeoutMs: 1500, ...options })({ on: (name: string, handler: Handler) => { (handlers[name] ??= []).push(handler); } } as never);
  const notices: string[] = [];
  const ctx = { sessionManager: { getSessionId: () => "sess-1" }, hasUI: true, ui: { notify: (message: string) => notices.push(message) } };
  const fire = async (name: string, event: any) => {
    let result: unknown;
    for (const handler of handlers[name] ?? []) result = (await handler({ type: name, ...event }, ctx)) ?? result;
    return result as any;
  };
  return { env, handlers, fire, notices };
}

const eventsOf = (name: string) => received.filter((entry) => entry.body.event === name).map((entry) => entry.body);
const sha = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const start = (prompt: string, systemPrompt = "BASE") => ({ prompt, systemPrompt, systemPromptOptions: {} });

describe("transport and credential isolation", () => {
  test("authenticates with the token read from the 0600 file and sends the loopback v1 schema without scope fields", async () => {
    const { fire } = load();
    await fire("before_agent_start", start("hello"));
    const startEntry = received.find((entry) => entry.body.event === "session_start")!;
    expect(startEntry.auth).toBe(`Bearer ${TOKEN}`);
    expect(startEntry.body).toMatchObject({ schema: "deck-runner-memory-loopback-v1", runnerId: "pi", event: "session_start", sessionId: "sess-1", role: "lead", query: "hello" });
    for (const entry of received) expect(JSON.stringify(entry.body)).not.toMatch(/containerTag|projectScope|"scope"/);
  });

  test("scrubs the token variables from the environment after load and publishes only endpoint and token-file path", () => {
    const { env } = load({ DECK_RUNNER_MEMORY_TOKEN: "should-not-survive" });
    expect(Object.keys(env).filter((key) => key.startsWith("DECK_RUNNER_MEMORY_TOKEN"))).toEqual([]);
    const published = readPublishedMemoryHandoff();
    expect(published?.endpoint).toBe(endpoint());
    expect(published?.tokenFile).toContain("token");
    expect(JSON.stringify(published)).not.toContain(TOKEN);
  });

  test("a non-loopback endpoint is refused", async () => {
    const { handlers, notices } = load({ DECK_RUNNER_MEMORY_ENDPOINT: "http://example.com/deck-runner-memory/v1" });
    expect(handlers.before_agent_start).toBeUndefined();
    await handlers.session_start![0]!({ type: "session_start", reason: "startup" }, { hasUI: true, ui: { notify: (m: string) => notices.push(m) } });
    expect(notices).toHaveLength(1);
  });

  test("without the endpoint no memory handlers are registered and one diagnostic is emitted", async () => {
    const { handlers, notices } = load({ DECK_RUNNER_MEMORY_ENDPOINT: undefined });
    expect(Object.keys(handlers)).toEqual(["session_start"]);
    const ctx = { hasUI: true, ui: { notify: (m: string) => notices.push(m) } };
    await handlers.session_start![0]!({ type: "session_start", reason: "startup" }, ctx);
    await handlers.session_start![0]!({ type: "session_start", reason: "reload" }, ctx);
    expect(notices).toHaveLength(1);
    expect(received).toHaveLength(0);
  });

  test("when the launcher disabled adaptive memory the extension stays completely silent", async () => {
    const { handlers, notices, env } = load({ DECK_PI_MEMORY: "disabled" });
    expect(Object.keys(handlers)).toEqual([]);
    expect(notices).toEqual([]);
    expect(Object.keys(env).filter((key) => key.startsWith("DECK_RUNNER_MEMORY_TOKEN"))).toEqual([]);
  });

  test("an unreadable token file also degrades to a single diagnostic", async () => {
    const { handlers, notices } = load({ DECK_RUNNER_MEMORY_TOKEN_FILE: join(dir, "missing") });
    expect(handlers.before_agent_start).toBeUndefined();
    await handlers.session_start![0]!({ type: "session_start", reason: "startup" }, { hasUI: true, ui: { notify: (m: string) => notices.push(m) } });
    expect(notices).toHaveLength(1);
  });
});

describe("lead recall", () => {
  test("first prompt sends session_start and injects the recall once through an ephemeral systemPrompt (never a message)", async () => {
    const { fire } = load();
    const result = await fire("before_agent_start", start("what do we know?", "BASE PROMPT"));
    expect(result.message).toBeUndefined();
    expect(result.systemPrompt).toBe(`BASE PROMPT\n\n${ADVISORY}`);
    expect(result.systemPrompt.split("DECK_ADAPTIVE_CONTEXT_JSON_V1>").length - 1).toBe(2);
    expect(eventsOf("session_start")).toHaveLength(1);
    expect(eventsOf("recall")).toHaveLength(0);
  });

  test("later prompts send recall (not session_start) and each is acknowledged with the injected receipt", async () => {
    const { fire } = load();
    await fire("before_agent_start", start("one"));
    await fire("before_agent_start", start("two"));
    await fire("session_shutdown", { reason: "quit" });
    expect(eventsOf("session_start")).toHaveLength(1);
    expect(eventsOf("recall").map((event) => event.query)).toEqual(["two"]);
    const acks = eventsOf("injection_ack");
    expect(acks).toHaveLength(2);
    expect(acks[1]).toMatchObject({ sessionId: "sess-1", injectedByteCount: Buffer.byteLength(ADVISORY, "utf8"), injectedSha256: sha(ADVISORY), snapshotGeneration: 2 });
    expect(acks[1]!.logicalTurnId).toBe(eventsOf("recall")[0]!.logicalTurnId);
    expect(eventsOf("recall")[0]).toMatchObject({ snapshotGeneration: 2 });
  });

  test("recall is applied on every agent start, including right after a compaction", async () => {
    const { fire } = load();
    await fire("before_agent_start", start("a"));
    await fire("session_before_compact", {});
    const after = await fire("before_agent_start", start("b", "FRESH BASE"));
    expect(after.systemPrompt).toBe(`FRESH BASE\n\n${ADVISORY}`);
  });

  test("a recall failure is non-fatal: the turn proceeds without context and a diagnostic is shown once", async () => {
    behavior.recallOk = false;
    const { fire, notices } = load();
    expect(await fire("before_agent_start", start("x"))).toBeUndefined();
    expect(await fire("before_agent_start", start("y"))).toBeUndefined();
    expect(notices).toHaveLength(1);
    expect(eventsOf("injection_ack")).toHaveLength(0);
  });

  test("a recall that exceeds the request timeout does not block the turn", async () => {
    behavior.delayMs = 600;
    behavior.delayEvents = ["session_start"];
    const { fire } = load({}, { requestTimeoutMs: 100 });
    const started = Date.now();
    expect(await fire("before_agent_start", start("slow"))).toBeUndefined();
    expect(Date.now() - started).toBeLessThan(500);
  });

  test("an empty recall result injects nothing", async () => {
    behavior.advisory = undefined;
    const { fire } = load();
    expect(await fire("before_agent_start", start("x"))).toBeUndefined();
  });
});

describe("capture", () => {
  test("captures the user prompt, buffers assistant text from turn_end and captures the last one on agent_end", async () => {
    const { fire } = load();
    await fire("before_agent_start", start("PROMPT P"));
    await fire("turn_end", { message: { role: "assistant", content: [{ type: "text", text: "intermediate" }, { type: "toolCall", id: "1", name: "x", arguments: {} }] } });
    await fire("turn_end", { message: { role: "assistant", content: [{ type: "text", text: "FINAL " }, { type: "text", text: "ANSWER A" }] } });
    await fire("turn_end", { message: { role: "toolResult", content: [{ type: "text", text: "ignored" }] } });
    await fire("agent_end", { messages: [] });
    await fire("session_shutdown", { reason: "quit" });
    const captures = received.filter((entry) => entry.body.event === "capture").map((entry) => entry.body);
    expect(captures.map((c) => [c.source, c.content])).toEqual([["trusted-user-prompt", "PROMPT P"], ["trusted-final-assistant", "FINAL ANSWER A"]]);
  });

  test("a run with no assistant text captures only the prompt, and the buffer does not leak into the next run", async () => {
    const { fire } = load();
    await fire("before_agent_start", start("one"));
    await fire("turn_end", { message: { role: "assistant", content: [{ type: "text", text: "A1" }] } });
    await fire("agent_end", { messages: [] });
    await fire("before_agent_start", start("two"));
    await fire("agent_end", { messages: [] });
    await fire("session_shutdown", { reason: "quit" });
    const finals = received.filter((entry) => entry.body.source === "trusted-final-assistant").map((entry) => entry.body.content);
    expect(finals).toEqual(["A1"]);
  });

  test("capture event ids are stable for identical content in the same turn", async () => {
    const first = load();
    await first.fire("before_agent_start", start("same prompt"));
    await first.fire("session_shutdown", { reason: "quit" });
    const idOne = received.find((entry) => entry.body.event === "capture")!.body.eventId;
    received.length = 0;
    const second = load();
    await second.fire("before_agent_start", start("same prompt"));
    await second.fire("session_shutdown", { reason: "quit" });
    expect(received.find((entry) => entry.body.event === "capture")!.body.eventId).toBe(idOne);
    expect(idOne).toMatch(/^[A-Za-z0-9_.:-]{1,160}$/);
  });

  test("oversized content is truncated below the 64 KiB host limit and marked", async () => {
    const { fire } = load();
    await fire("before_agent_start", start("é".repeat(100_000)));
    await fire("session_shutdown", { reason: "quit" });
    const content = received.find((entry) => entry.body.event === "capture")!.body.content as string;
    expect(Buffer.byteLength(content, "utf8")).toBeLessThan(64 * 1024);
    expect(content).toContain("[truncated by Deck memory]");
    expect(content).not.toContain("�");
  });

  test("a capture that fails once is retried with the same event id", async () => {
    let calls = 0;
    const flaky = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
      const body = JSON.parse(await request.text());
      if (body.event === "capture" && calls++ === 0) return new Response("boom", { status: 500 });
      received.push({ auth: request.headers.get("authorization"), body });
      return Response.json({ ok: true, diagnostics: [] });
    } });
    try {
      const { fire } = load({ DECK_RUNNER_MEMORY_ENDPOINT: `http://127.0.0.1:${flaky.port}/deck-runner-memory/v1` });
      await fire("before_agent_start", start("retry me"));
      await fire("session_shutdown", { reason: "quit" });
      expect(received.filter((entry) => entry.body.event === "capture")).toHaveLength(1);
      expect(calls).toBe(2);
    } finally {
      flaky.stop(true);
    }
  });
});

describe("compaction and shutdown", () => {
  test("session_before_compact drains in-flight captures and never cancels the compaction", async () => {
    behavior.delayMs = 250;
    behavior.delayEvents = ["capture"];
    const { fire } = load();
    await fire("before_agent_start", start("slow capture"));
    expect(received.filter((entry) => entry.body.event === "capture")).toHaveLength(0);
    const result = await fire("session_before_compact", {});
    expect(result).toBeUndefined();
    expect(received.filter((entry) => entry.body.event === "capture")).toHaveLength(1);
  });

  test("the compaction drain is bounded", async () => {
    behavior.delayMs = 2000;
    behavior.delayEvents = ["capture"];
    const { fire } = load({}, { drainTimeoutMs: 150, requestTimeoutMs: 3000 });
    await fire("before_agent_start", start("stuck"));
    const started = Date.now();
    expect(await fire("session_before_compact", {})).toBeUndefined();
    expect(Date.now() - started).toBeLessThan(900);
  });

  test("shutdown flushes pending assistant text and makes shutdown_flush the last event", async () => {
    const { fire } = load();
    await fire("before_agent_start", start("p"));
    await fire("turn_end", { message: { role: "assistant", content: [{ type: "text", text: "unsent final" }] } });
    await fire("session_shutdown", { reason: "quit" });
    const names = received.map((entry) => entry.body.event);
    expect(names.at(-1)).toBe("shutdown_flush");
    expect(received.some((entry) => entry.body.content === "unsent final")).toBe(true);
  });

  test("a reload keeps the session open: captures drain but no shutdown_flush is sent", async () => {
    const { fire } = load();
    await fire("before_agent_start", start("p"));
    await fire("session_shutdown", { reason: "reload" });
    expect(eventsOf("shutdown_flush")).toHaveLength(0);
    expect(eventsOf("capture")).toHaveLength(1);
  });
});

describe("subagent child", () => {
  const child = { DECK_PI_CHILD: "1", DECK_PI_ROLE: "investigate" };

  test("sends role_start with the role and the task, injects ephemerally, acknowledges and never captures", async () => {
    const { fire } = load(child);
    const result = await fire("before_agent_start", start("Task: map it", "ROLE BASE"));
    expect(result.systemPrompt).toBe(`ROLE BASE\n\n${ADVISORY}`);
    await fire("turn_end", { message: { role: "assistant", content: [{ type: "text", text: "child answer" }] } });
    await fire("agent_end", { messages: [] });
    await fire("session_shutdown", { reason: "quit" });
    expect(eventsOf("role_start")).toHaveLength(1);
    expect(eventsOf("role_start")[0]).toMatchObject({ role: "investigate", query: "Task: map it" });
    expect(eventsOf("injection_ack")).toHaveLength(1);
    expect(eventsOf("capture")).toHaveLength(0);
    expect(eventsOf("session_start")).toHaveLength(0);
    expect(eventsOf("recall")).toHaveLength(0);
  });

  test("a later agent start in the same child re-applies the cached recall without another request", async () => {
    const { fire } = load(child);
    await fire("before_agent_start", start("Task: a"));
    const again = await fire("before_agent_start", start("Task: b", "NEXT"));
    expect(again.systemPrompt).toBe(`NEXT\n\n${ADVISORY}`);
    expect(eventsOf("role_start")).toHaveLength(1);
  });
});
