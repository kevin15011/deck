import { describe, expect, test } from "bun:test";
import { mapCodexNotification } from "./mapper";

describe("Codex app-server notification mapping", () => {
  test("future hook methods retain only bounded sanitized metadata without inventing lifecycle semantics", () => {
    const method = "hook/future token=synthetic-method-secret " + "x".repeat(1000);
    const events = mapCodexNotification({ method, params: { run: { id: "h", entries: [{ kind: "context", text: "private recalled content" }] }, stdout: "private output" } });
    expect(events).toMatchObject([{ kind: "runner.unmapped", data: { nativeType: expect.any(String) } }]);
    expect(events[0]!.raw).toBeUndefined();
    expect(String(events[0]!.data.nativeType).length).toBeLessThanOrEqual(128);
    expect(JSON.stringify(events)).not.toContain("private");
    expect(JSON.stringify(events)).not.toContain("synthetic-method-secret");
    const raw = { method: "future/event", params: { payload: "regular data" } };
    expect(mapCodexNotification(raw)[0]!.raw).toBe(raw);
  });
  test("malformed known hook identities cannot expose private context through unmapped raw", () => {
    for (const id of [undefined, "", "\u001b[31m"]) {
      const events = mapCodexNotification({ method: "hook/completed", params: { run: { id, eventName: "stop", sourcePath: "/private/plugin/hooks.json", entries: [{ kind: "context", text: "private recalled context" }], statusMessage: "private diagnostic", output: "private output" } } });
      expect(events.every(event => event.raw === undefined)).toBe(true);
      expect(JSON.stringify(events)).not.toContain("private");
      expect(events).toMatchObject([{ kind: "diagnostic", data: { code: "codex-hook-invalid" } }]);
    }
  });
  test("maps actual hook lifecycle and attributes only the trusted native plugin source", () => {
    const nativeMemory = { provider: "supermemory", integration: "runner-plugin", status: "ready", plugin: { root: "/trusted/plugin", hookConfigPath: "/trusted/plugin/hooks/hooks.json" } } as const;
    const run = { id: "h1", eventName: "userPromptSubmit", handlerType: "command", executionMode: "sync", source: "plugin", sourcePath: nativeMemory.plugin.hookConfigPath, status: "running", entries: [{ kind: "context", text: "private recalled content" }] };
    const started = mapCodexNotification({ method: "hook/started", params: { threadId: "th", turnId: "t", run } }, nativeMemory)[0]!;
    expect(started).toMatchObject({ kind: "hook.started", data: { hookId: "h1", hookEvent: "userPromptSubmit", status: "running", provenance: "codex-app-server", executionMode: "sync", handlerType: "command", provider: "supermemory", integration: "runner-plugin" } });
    expect(JSON.stringify(started)).not.toContain("/trusted");
    expect(JSON.stringify(started)).not.toContain("private recalled");
    expect(mapCodexNotification({ method: "hook/completed", params: { run: { ...run, status: "failed", durationMs: 42, statusMessage: "private details" } } }, nativeMemory)[0]).toMatchObject({ kind: "hook.completed", data: { status: "failed", durationMs: 42 } });
    for (const changed of [{ sourcePath: "/other/supermemory/hooks.json" }, { source: "project" }]) {
      expect(mapCodexNotification({ method: "hook/started", params: { run: { ...run, ...changed } } }, nativeMemory)[0]!.data.provider).toBeUndefined();
    }
    expect(mapCodexNotification({ method: "hook/started", params: { run } })[0]!.data.provider).toBeUndefined();
    const exclusive = { ...nativeMemory, plugin: { ...nativeMemory.plugin, exclusiveHookEvents: ["userPromptSubmit"] } };
    expect(mapCodexNotification({ method: "hook/started", params: { run: { ...run, source: "sessionFlags" } } }, exclusive)[0]!.data.provider).toBe("supermemory");
    expect(mapCodexNotification({ method: "hook/started", params: { run: { ...run, source: "sessionFlags", eventName: "stop" } } }, exclusive)[0]!.data.provider).toBeUndefined();
  });
  test("maps native terminal outcomes and unknown payloads", () => {
    expect(mapCodexNotification({ method: "turn/completed", params: { turn: { id: "t", status: "interrupted" } } })[0]?.data.status).toBe("interrupted");
    const raw = { method: "future/event", params: { newField: true } };
    expect(mapCodexNotification(raw)[0]).toEqual({ kind: "runner.unmapped", data: { nativeType: "future/event" }, raw });
  });
  test("maps assistant, reasoning, tool, usage and rate limit frames", () => {
    const kinds = [
      ["item/agentMessage/delta", { delta: "hello" }, "message.delta"],
      ["item/reasoning/summaryTextDelta", { delta: "think" }, "reasoning.delta"],
      ["item/started", { item: { id: "x", type: "commandExecution", command: "echo hi" } }, "tool.started"],
      ["item/completed", { item: { id: "x", type: "agentMessage", text: "hello" } }, "message.completed"],
      ["thread/tokenUsage/updated", { tokenUsage: { total: { inputTokens: 3 } } }, "usage"],
      ["account/rateLimits/updated", { rateLimits: {} }, "rate-limit"],
    ] as const;
    for (const [method, params, kind] of kinds) expect(mapCodexNotification({ method, params })[0]?.kind).toBe(kind);
  });
  test("bounds tool result data while retaining its original envelope for host redaction", () => {
    const raw = { method: "item/completed", params: { item: { type: "commandExecution", aggregatedOutput: "x".repeat(100000) } } };
    const event = mapCodexNotification(raw)[0]!;
    expect(JSON.stringify(event.data).length).toBeLessThan(18000);
    expect(event.raw).toBe(raw);
  });
  test("identifies reasoning deltas and final snapshots by native item, kind and part", () => {
    const delta = mapCodexNotification({ method: "item/reasoning/summaryTextDelta", params: { itemId: "r1", summaryIndex: 0, delta: "Inspect " } })[0]!;
    expect(delta.data).toMatchObject({ messageId: "r1", partId: "summary:0", reasoningKind: "summary", format: "delta", text: "Inspect " });
    const final = mapCodexNotification({ method: "item/completed", params: { item: { id: "r1", type: "reasoning", summary: ["Inspect source"], content: ["Check API"] } } });
    expect(final.map(e => e.data)).toMatchObject([
      { messageId: "r1", partId: "summary:0", reasoningKind: "summary", format: "snapshot", text: "Inspect source" },
      { messageId: "r1", partId: "text:0", reasoningKind: "text", format: "snapshot", text: "Check API" },
    ]);
    expect(mapCodexNotification({ method: "item/reasoning/textDelta", params: { itemId: "r1", contentIndex: 1, delta: "Next" } })[0]!.data).toMatchObject({ partId: "text:1", reasoningKind: "text", format: "delta" });
  });
  test("preserves actual MCP and dynamic tool identity, input, errors and lifecycle", () => {
    const call = { id: "m1", type: "mcpToolCall", tool: "search_graph", server: "codebase", arguments: { query: "Lead" }, status: "inProgress" };
    expect(mapCodexNotification({ method: "item/started", params: { item: call } })[0]!.data).toMatchObject({ toolCallId: "m1", tool: "mcpToolCall", toolName: "search_graph", server: "codebase", input: { query: "Lead" }, status: "running" });
    expect(mapCodexNotification({ method: "item/completed", params: { item: { ...call, status: "failed", error: { message: "Unavailable" }, durationMs: 42 } } })[0]!.data).toMatchObject({ status: "failed", isError: true, output: { message: "Unavailable" }, durationMs: 42 });
    expect(mapCodexNotification({ method: "item/completed", params: { item: { id: "d1", type: "dynamicToolCall", tool: "Skill", arguments: { skill: "frontend" }, status: "completed", success: true, contentItems: [{ type: "inputText", text: "Loaded" }] } } })[0]!.data).toMatchObject({ toolName: "Skill", output: [{ type: "inputText", text: "Loaded" }], status: "completed", isError: false });
    expect(mapCodexNotification({ method: "item/completed", params: { item: { id: "c1", type: "commandExecution", command: "false", exitCode: 1, status: "completed" } } })[0]!.data).toMatchObject({ status: "failed", isError: true, exitCode: 1 });
  });
  test("web search activity retains the native query, action and bounded results", () => {
    const item = { id: "w1", type: "webSearch", query: "Deck runners", action: { type: "search", query: "Deck runners" }, results: [{ title: "Deck", url: "https://example.com" }] };
    expect(mapCodexNotification({ method: "item/completed", params: { item } })[0]!.data).toMatchObject({ input: { query: "Deck runners", action: item.action }, output: item.results });
  });
  test("redacts structured tool input and exposed reasoning without throwing on invalid redacted JSON", () => {
    const call = { id: "m1", type: "mcpToolCall", tool: "search", arguments: { token: "synthetic-secret" }, result: { content: [{ type: "text", text: "Authorization: Bearer synthetic-result" }] } };
    const event = mapCodexNotification({ method: "item/completed", params: { item: call } })[0]!;
    expect(JSON.stringify(event.data)).not.toContain("synthetic-secret");
    expect(JSON.stringify(event.data)).not.toContain("synthetic-result");
    const thought = mapCodexNotification({ method: "item/reasoning/textDelta", params: { delta: "token=synthetic-reasoning\u001b[31m", itemId: "r", contentIndex: 0 } })[0]!;
    expect(thought.data.text).not.toContain("synthetic-reasoning");
    expect(thought.data.text).not.toContain("\u001b");
  });
});

test('maps verified compaction lifecycle with bounded exact correlation identity', () => {
  for (const [method, state] of [['item/started', 'started'], ['item/completed', 'completed']]) {
    const mapped = mapCodexNotification({ method, params: { threadId: 'thread', turnId: 'turn', item: { type: 'contextCompaction', id: 'compact', private: 'not canonical' } } })[0]!;
    expect(mapped).toMatchObject({ kind: 'diagnostic', data: { code: 'context.compaction', state, itemId: 'compact', nativeThreadId: 'thread', nativeTurnId: 'turn' } });
    expect(JSON.stringify(mapped.data)).not.toContain('private');
  }
  for (const id of ['', undefined, 'x'.repeat(257), '\u001b[31m']) {
    expect(mapCodexNotification({ method: 'item/started', params: { threadId: 'thread', turnId: 'turn', item: { type: 'contextCompaction', id } } })[0]?.data.code).not.toBe('context.compaction');
  }
});
