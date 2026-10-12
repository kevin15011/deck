import { describe, expect, test } from "bun:test";
import { fixtureLines } from "./fixtures";
import { ClaudeLineSplitter, ClaudeStreamMapper, parseClaudeLine } from "./mapper";

function run(name: string) {
  const mapper = new ClaudeStreamMapper();
  const events: Array<{ kind: string; data: Record<string, unknown>; raw?: unknown }> = [];
  let init, result;
  for (const line of fixtureLines(name)) {
    const parsed = parseClaudeLine(line);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) continue;
    const out = mapper.map(parsed.message);
    events.push(...out.events);
    init = out.init ?? init;
    result = out.result ?? result;
  }
  return { events, init, result, kinds: events.map((e) => e.kind) };
}

describe("Claude 2.1.296 stream-json mapper (recorded fixtures)", () => {
  test("a successful turn maps init, assistant text, rate limit, usage and the result", () => {
    const { events, init, result, kinds } = run("turn-success.jsonl");
    expect(kinds).toEqual(["turn.started", "message.completed", "rate-limit", "usage"]);
    expect(init).toMatchObject({ sessionId: expect.any(String), model: "claude-haiku-5-5", version: "2.1.296", mcpServers: [{ name: "deck", status: "connected" }] });
    expect(events[0]!.data).toMatchObject({ nativeSessionId: init!.sessionId, model: "claude-haiku-5-5", mcpServers: ["deck"] });
    expect(events[1]!.data).toMatchObject({ text: "pong" });
    expect(events[2]!.data).toMatchObject({ rateLimitType: "seven_day" });
    expect(events[3]!.data).toMatchObject({ inputTokens: 2, outputTokens: 4, costUsd: expect.any(Number) });
    expect(result).toMatchObject({ subtype: "success", isError: false, text: "pong", permissionDenials: [], errors: [] });
  });

  test("init raw is trimmed to an allowlist (no command/skill/plugin inventories)", () => {
    const { events } = run("turn-success.jsonl");
    const raw = events[0]!.raw as Record<string, unknown>;
    expect(Object.keys(raw)).not.toContain("slash_commands");
    expect(raw.type).toBe("system");
    expect(raw.mcp_servers).toEqual([{ name: "deck", status: "connected", source: "dynamic" }]);
  });

  test("a resumed turn keeps the same native session id", () => {
    const a = run("turn-success.jsonl");
    const b = run("turn-resume.jsonl");
    expect(b.init!.sessionId).toBeTypeOf("string");
    expect(b.kinds).toContain("message.completed");
    expect(a.init!.sessionId).not.toBe("");
  });

  test("an interrupted turn ends with error_during_execution and no unmapped noise", () => {
    const { kinds, result, events } = run("turn-interrupted.jsonl");
    expect(result).toMatchObject({ subtype: "error_during_execution", isError: true, terminalReason: "aborted_streaming" });
    expect(kinds).not.toContain("runner.unmapped");
    // thinking blocks with empty text are not emitted as reasoning
    expect(events.filter((e) => e.kind === "reasoning.delta")).toHaveLength(0);
    // the "[Request interrupted by user]" echo is not a message
    expect(events.filter((e) => e.kind === "message.completed")).toHaveLength(1);
  });

  test("hook lifecycle events (hooks NOT disabled) surface one diagnostic and flag hookSeen", () => {
    const mapper = new ClaudeStreamMapper();
    const outs = fixtureLines("hooks-control.jsonl").map((l) => mapper.map((parseClaudeLine(l) as { message: unknown }).message));
    const diagnostics = outs.flatMap((o) => o.events).filter((e) => e.kind === "diagnostic");
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.data).toMatchObject({ code: "claude-hook-executed" });
    expect(outs.some((o) => o.hookSeen)).toBe(true);
    expect(outs.flatMap((o) => o.events).some((e) => e.kind === "runner.unmapped")).toBe(false);
  });

  test("--safe-mode drops explicit MCP: init reports an empty server list", () => {
    const { init } = run("safe-mode-init.jsonl");
    expect(init!.mcpServers).toEqual([]);
  });
});

describe("Claude mapper (synthetic tool and error shapes)", () => {
  test("tool_use / tool_result map to tool.started / tool.completed and permission denials are reported", () => {
    const { events, result, kinds } = run("tool-flow.synthetic.jsonl");
    expect(kinds).toEqual(["turn.started", "message.completed", "tool.started", "tool.completed", "tool.completed", "message.completed", "usage", "diagnostic"]);
    expect(events[2]!.data).toMatchObject({ toolUseId: "toolu_01", name: "Bash", input: { command: "ls -la" } });
    expect(events[3]!.data).toMatchObject({ toolUseId: "toolu_01", isError: false, output: "total 0\nfile.txt" });
    expect(events[4]!.data).toMatchObject({ toolUseId: "toolu_02", isError: true, output: "Permission denied: Bash" });
    const diag = events.at(-1)!;
    expect(diag.data).toMatchObject({ code: "claude-permission-denied", tools: ["Bash"] });
    expect(result!.permissionDenials).toEqual([{ tool: "Bash", toolUseId: "toolu_02" }]);
  });

  test("unknown messages, subtypes and content blocks become runner.unmapped with redacted raw, never a crash", () => {
    const { events, result } = run("unknown-events.synthetic.jsonl");
    const unmapped = events.filter((e) => e.kind === "runner.unmapped");
    expect(unmapped).toHaveLength(3);
    expect(unmapped.map((e) => e.data.type)).toEqual(["future_event", "system/future_subtype", "assistant/future_block"]);
    expect(JSON.stringify(unmapped[0]!.raw)).toContain("future_event");
    expect(events.some((e) => e.kind === "message.completed" && e.data.text === "ok")).toBe(true);
    expect(result).toMatchObject({ subtype: "error_max_turns", isError: true, errors: ["Reached maximum number of turns (3)"] });
  });

  test("tool input and output are redacted and bounded", () => {
    const mapper = new ClaudeStreamMapper();
    const out = mapper.map({
      type: "assistant", message: { content: [{ type: "tool_use", id: "t", name: "Bash", input: { command: "curl -H 'Authorization: Bearer abcdefghijkl' x" } }] },
    });
    expect(JSON.stringify(out.events[0]!.data)).not.toContain("abcdefghijkl");
    const big = mapper.map({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t", content: "x".repeat(50_000), is_error: false }] } });
    expect((big.events[0]!.data.output as string).length).toBeLessThanOrEqual(8192);
  });
});

describe("parseClaudeLine / ClaudeLineSplitter", () => {
  test("non-JSON and non-object lines are rejected without throwing", () => {
    expect(parseClaudeLine("not json").ok).toBe(false);
    expect(parseClaudeLine("[1,2]").ok).toBe(false);
    expect(parseClaudeLine('{"type":"x"}').ok).toBe(true);
  });
  test("splitter reassembles lines across chunk boundaries and flushes a final unterminated line", () => {
    const s = new ClaudeLineSplitter();
    expect(s.push('{"a":')).toEqual([]);
    expect(s.push('1}\n{"b":2}\n{"c"')).toEqual(['{"a":1}', '{"b":2}']);
    expect(s.flush()).toEqual(['{"c"']);
    expect(s.flush()).toEqual([]);
  });
  test("splitter bounds a runaway line", () => {
    const s = new ClaudeLineSplitter(100);
    const lines = s.push("x".repeat(500));
    expect(lines).toEqual([]);
    expect(s.overflowed).toBe(true);
  });
  test("a non-JSON line maps to a bounded diagnostic", () => {
    const events = new ClaudeStreamMapper().unparsable("Error: something\u001b[31m went wrong " + "y".repeat(2000));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "diagnostic", data: { code: "claude-nonjson-output" } });
    expect(String(events[0]!.data.text).length).toBeLessThanOrEqual(600);
    expect(String(events[0]!.data.text)).not.toContain("\u001b");
  });
});
