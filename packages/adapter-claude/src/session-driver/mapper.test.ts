import { describe, expect, test } from "bun:test";
import { fixtureLines } from "./fixtures";
import { ClaudeLineSplitter, ClaudeStreamMapper, parseClaudeLine } from "./mapper";

test('Claude context uses the latest main assistant API input and exact-model result capacity', () => {
  const mapper = new ClaudeStreamMapper(undefined, 'session', 'execution');
  const assistant = { type: 'assistant', session_id: 'session', parent_tool_use_id: null, message: { id: 'msg1', model: 'claude-model', content: [], usage: { input_tokens: 2, cache_creation_input_tokens: 381, cache_read_input_tokens: 3485, output_tokens: 900 } } };
  const result = { type: 'result', session_id: 'session', subtype: 'success', usage: { input_tokens: 99999, output_tokens: 999, cache_read_input_tokens: 99999 }, modelUsage: { 'claude-model': { contextWindow: 200000 }, other: { contextWindow: 1000000 } } };
  expect(mapper.map(result).events[0].data.context).toBeUndefined();
  expect(mapper.map(assistant).events.at(-1)?.data.context).toMatchObject({ basis: 'claude-last-request-input', tokens: 3868, capacity: null, modelId: 'claude-model', nativeThreadId: 'session', nativeTurnId: 'execution' });
  expect(mapper.map(result).events[0].data).toMatchObject({ inputTokens: 99999, context: { tokens: 3868, capacity: 200000 } });
  expect(mapper.map({ ...result, modelUsage: { alias: { contextWindow: 999999 } } }).events[0].data.context).toMatchObject({ tokens: 3868, capacity: null });
  for (const patch of [{ session_id: 'foreign' }, { parent_tool_use_id: 'subagent' }]) expect(mapper.map({ ...assistant, ...patch }).events.some(e => e.kind === 'usage')).toBe(false);
  expect(mapper.map({ ...result, session_id: 'foreign' }).events[0].data.context).toBeUndefined();
  mapper.map({ ...assistant, message: { ...assistant.message, id: 'msg2', model: 'new-model', usage: { input_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 10 } } });
  expect(mapper.map(result).events[0].data.context).toMatchObject({ tokens: 15, capacity: null, modelId: 'new-model' });
  mapper.map({ type: 'system', subtype: 'compact_boundary', session_id: 'foreign' });
  expect(mapper.map(result).events[0].data.context).toBeDefined();
  mapper.map({ type: 'system', subtype: 'compact_boundary', session_id: 'session' });
  expect(mapper.map(assistant).events.some(e => e.data.context)).toBe(false);
  expect(mapper.map(result).events[0].data.context).toBeUndefined();
});

test('Claude sanitized fixture has per-call usage distinct from result accounting', () => {
  const messages = fixtureLines('turn-success.jsonl').map(line => JSON.parse(line));
  const mapper = new ClaudeStreamMapper(undefined, messages.find(m => m.type === 'assistant').session_id, 'execution');
  const observations = messages.flatMap(m => mapper.map(m).events).filter(e => e.data.context);
  expect(observations).toHaveLength(2);
  expect(observations[0].data.context).toMatchObject({ tokens: 3868, capacity: null, basis: 'claude-last-request-input', modelId: 'claude-haiku-5-5' });
  expect(observations[1].data.context).toMatchObject({ tokens: 3868, capacity: 1000000 });
});

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
    const hooks = outs.flatMap(o => o.events).filter(e => e.kind.startsWith("hook."));
    expect(hooks.filter(e => e.kind === "hook.started")).toHaveLength(4);
    expect(hooks.filter(e => e.kind === "hook.completed")).toHaveLength(4);
    expect(hooks[0]!.data).toMatchObject({ hookId: expect.any(String), hookEvent: "SessionStart", hookName: "SessionStart", status: "running", provenance: "claude-stream-json" });
    expect(hooks.find(e => e.kind === "hook.completed")!.data).toMatchObject({ status: "completed", exitCode: 0 });
    expect(hooks.every(e => e.data.provider === undefined && e.raw === undefined)).toBe(true);
  });

  test("--safe-mode drops explicit MCP: init reports an empty server list", () => {
    const { init } = run("safe-mode-init.jsonl");
    expect(init!.mcpServers).toEqual([]);
  });
});

describe("Claude mapper (synthetic tool and error shapes)", () => {
  test("future hook subtypes remain metadata-only and preserve ordinary unknown raw policy", () => {
    const mapper = new ClaudeStreamMapper();
    const out = mapper.map({ type: "system", subtype: "hook_future token=synthetic-method-secret " + "x".repeat(1000), output: "private recalled context", stdout: "private hook output", hook_name: "node /private/script.js" });
    expect(out.events).toMatchObject([{ kind: "runner.unmapped", data: { type: expect.any(String) } }]);
    expect(out.events[0]!.raw).toBeUndefined();
    expect(String(out.events[0]!.data.type).length).toBeLessThanOrEqual(128);
    expect(JSON.stringify(out)).not.toContain("private");
    expect(JSON.stringify(out)).not.toContain("synthetic-method-secret");
    const raw = { type: "system", subtype: "future", payload: "regular data" };
    expect(mapper.map(raw).events[0]!.raw).toBe(raw);
  });
  test("hook attribution requires an exclusive trusted event set and never exposes hook context", () => {
    const nativeMemory = { provider: "supermemory", integration: "runner-plugin", status: "ready", plugin: { root: "/trusted/plugin", exclusiveHookEvents: ["SessionStart"] } } as const;
    const mapper = new ClaudeStreamMapper(nativeMemory);
    const events = mapper.map({ type: "system", subtype: "hook_response", hook_id: "h1", hook_event: "SessionStart", hook_name: "node /private/plugin/hook.js token=synthetic-secret", exit_code: 0, outcome: "success", output: "private recalled context", stdout: "private context", stderr: "token=synthetic-secret" }).events;
    const hook = events.find(e => e.kind === "hook.completed")!;
    expect(hook.data).toMatchObject({ provider: "supermemory", integration: "runner-plugin", status: "completed" });
    expect(JSON.stringify(hook)).not.toContain("private");
    expect(JSON.stringify(hook)).not.toContain("synthetic-secret");
    expect(JSON.stringify(events)).not.toContain("/private/");
    expect(JSON.stringify(events)).not.toContain("synthetic-secret");
    expect(mapper.map({ type: "system", subtype: "hook_started", hook_id: "h2", hook_event: "Stop", hook_name: "other" }).events.find(e => e.kind === "hook.started")!.data.provider).toBeUndefined();
    expect(new ClaudeStreamMapper().map({ type: "system", subtype: "hook_response", hook_id: "h3", hook_event: "Stop", exit_code: 1, outcome: "error" }).events.find(e => e.kind === "hook.completed")!.data.status).toBe("failed");
  });
  test("thinking snapshots retain message and block identity and sanitize exposed text", () => {
    const mapper = new ClaudeStreamMapper();
    const events = mapper.map({ type: "assistant", message: { id: "m1", content: [
      { type: "thinking", thinking: "Inspect source token=synthetic-secret\u001b[31m" },
      { type: "thinking", thinking: "Check tests" },
    ] } }).events;
    expect(events[0]!.data).toMatchObject({ messageId: "m1", blockIndex: 0, partId: "0", format: "snapshot", reasoningKind: "text" });
    expect(events[1]!.data).toMatchObject({ messageId: "m1", blockIndex: 1, partId: "1", text: "Check tests" });
    expect(events[0]!.data.text).not.toContain("synthetic-secret");
    expect(events[0]!.data.text).not.toContain("\u001b");
    expect(String(mapper.map({ type: "assistant", message: { content: [{ type: "thinking", thinking: "x".repeat(50000) }] } }).events[0]!.data.text).length).toBeLessThanOrEqual(8192);
  });
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
    expect(() => s.push("x".repeat(500))).toThrow("claude-line-too-long");
    expect(s.push('{"type":"result"}\n')).toEqual([]);
    expect(s.flush()).toEqual([]);
  });
  test("splitter counts UTF-8 across split surrogate pairs and fails closed at the byte boundary", () => {
    const s = new ClaudeLineSplitter(7);
    expect(s.push('€\ud83d')).toEqual([]);
    expect(s.push('\ude00\n{}\n')).toEqual(['€😀', '{}']);
    expect(() => s.push('€😀x\n')).toThrow('claude-line-too-long');
    expect(s.push('{}\n')).toEqual([]);
  });
  test("a non-JSON line maps to a bounded diagnostic", () => {
    const events = new ClaudeStreamMapper().unparsable("Error: something\u001b[31m went wrong " + "y".repeat(2000));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "diagnostic", data: { code: "claude-nonjson-output" } });
    expect(String(events[0]!.data.text).length).toBeLessThanOrEqual(600);
    expect(String(events[0]!.data.text)).not.toContain("\u001b");
  });
});


describe("Claude partial message stream", () => {
  test("text deltas arrive before an authoritative final snapshot; tools and thinking stay separate", () => {
    const mapper = new ClaudeStreamMapper();
    const partial = (event: unknown) => mapper.map({ type: "stream_event", event }).events;
    expect(partial({ type: "message_start", message: { id: "msg_partial" } })).toEqual([]);
    expect(partial({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } })).toEqual([]);
    expect(partial({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello " } })).toMatchObject([{ kind: "message.delta", data: { messageId: "msg_partial", text: "Hello " } }]);
    expect(partial({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "world" } })).toMatchObject([{ kind: "message.delta", data: { messageId: "msg_partial", text: "world" } }]);
    expect(partial({ type: "content_block_delta", index: 1, delta: { type: "thinking_delta", thinking: "private reasoning" } })).toEqual([]);
    expect(partial({ type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: "{}" } })).toEqual([]);
    expect(partial({ type: "content_block_stop", index: 0 })).toEqual([]);
    expect(partial({ type: "message_stop" })).toEqual([]);
    const final = mapper.map({ type: "assistant", message: { id: "msg_partial", content: [{ type: "text", text: "Hello world" }, { type: "tool_use", id: "tool_1", name: "Bash", input: { command: "pwd" } }] } }).events;
    expect(final.map(event => event.kind)).toEqual(["message.completed", "tool.started"]);
    expect(final[0]!.data).toMatchObject({ messageId: "msg_partial", text: "Hello world" });
    expect(partial({ type: "message_start", message: { id: "msg_next" } })).toEqual([]);
    expect(partial({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Next" } })[0]!.data.messageId).toBe("msg_next");
  });
  test("unknown stream shapes remain inspectable rather than becoming assistant text", () => {
    const mapper = new ClaudeStreamMapper();
    expect(mapper.map({ type: "stream_event", event: { type: "future_stream" } }).events).toMatchObject([{ kind: "runner.unmapped", data: { type: "stream_event/future_stream" } }]);
  });
});


test('Claude incomplete, invalid or overflowing per-call usage does not carry the previous call', () => {
  for (const usage of [undefined, { input_tokens: 1 }, ...[NaN, Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER].map(input_tokens => ({ input_tokens, cache_creation_input_tokens: 1, cache_read_input_tokens: 0 }))]) {
    const mapper = new ClaudeStreamMapper(undefined, 's', 'execution');
    const message = { type: 'assistant', session_id: 's', message: { model: 'model', usage: { input_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } };
    mapper.map(message);
    expect(mapper.map({ ...message, message: { model: 'model', usage } }).events.at(-1)?.data.context).toMatchObject({ tokens: null, capacity: null });
    expect(mapper.map({ type: 'result', session_id: 's', usage: { input_tokens: 99999 }, modelUsage: { model: { contextWindow: 200000 } } }).events[0].data.context).toMatchObject({ tokens: null, capacity: 200000 });
  }
});

test('recorded synthetic API error shape preserves the last valid context and visible error; genuine zero is valid', () => {
  // Reviewed retained seq27013 fields; identifiers/text are sanitized, no history read.
  const error = JSON.parse(fixtureLines('context-synthetic-api-error.jsonl')[0]!);
  for (const patch of [{}, { is_api_error_message: true, message: { ...error.message, model: 'model' } }, { is_api_error_message: false }, { is_api_error_message: false, message: { ...error.message, model: 'model' }, error: 'rate_limit', api_error_status: 429, api_error_origin: 'first_party' }]) {
    const mapper = new ClaudeStreamMapper(undefined, 'session', 'execution');
    mapper.map({ type: 'assistant', session_id: 'session', message: { model: 'model', usage: { input_tokens: 148000, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } });
    const out = mapper.map({ ...error, ...patch });
    expect(out.events.some(e => e.kind === 'usage')).toBe(false);
    expect(out.events.find(e => e.kind === 'message.completed')?.data.text).toBe('Sanitized API failure');
    const result = mapper.map({ type: 'result', session_id: 'session', subtype: 'error_during_execution', is_error: true, terminal_reason: 'api_error', usage: { input_tokens: 0 }, modelUsage: { model: { contextWindow: 200000 } } });
    expect(result.events[0].data.context).toMatchObject({ tokens: 148000, capacity: 200000, modelId: 'model' });
    if ('error' in patch) expect(result.result?.failure).toMatchObject({ category: 'rate-limit', httpStatus: 429 });
    expect(mapper.map({ ...error, is_api_error_message: false, message: { ...error.message, model: 'model' } }).events.find(e => e.kind === 'usage')?.data.context).toMatchObject({ tokens: 0, modelId: 'model' });
  }
});

test('continuity input is last main request with cache and real identity; later failure invalidates it without changing UI',()=>{
 const mapper=new ClaudeStreamMapper(undefined,'s','turn');
 const message={type:'assistant',session_id:'s',message:{id:'r',model:'m',content:[],usage:{input_tokens:1,cache_creation_input_tokens:2,cache_read_input_tokens:3}}};
 expect(mapper.map(message).events.find(e=>e.kind==='usage')?.data.requestInput).toMatchObject({tokens:6,nativeRequestId:'r',final:false});
 expect(mapper.map({...message,parent_tool_use_id:'nested'}).events.some(e=>e.data.requestInput)).toBe(false);
 expect(mapper.map({type:'result',session_id:'s',subtype:'success'}).events).toContainEqual({kind:'diagnostic',data:{code:'request.input-finalized',nativeThreadId:'s',nativeTurnId:'turn',nativeRequestId:'r'}});
 const error=mapper.map({...message,is_api_error_message:true});expect(error.events.some(e=>e.data.code==='request.input-invalidated')).toBe(true);expect(error.events.some(e=>e.kind==='usage')).toBe(false);
});
test.each(['Edit','Write','NotebookEdit'])('successful correlated %s records edits; nested/failed results do not',name=>{
 const mapper=new ClaudeStreamMapper(undefined,'s','turn');
 const assistant={type:'assistant',session_id:'s',message:{id:'r',model:'m',content:[{type:'tool_use',id:'edit',name,input:{file_path:'/project/a.ts',notebook_path:'/project/a.ipynb'}}]}};
 mapper.map(assistant);
 const result={type:'user',session_id:'s',message:{content:[{type:'tool_result',tool_use_id:'edit',is_error:false,content:'success'}]}};
 expect(mapper.map(result).events.find(e=>e.kind==='tool.completed')?.data).toMatchObject({requestId:'r',edits:[{path:name==='NotebookEdit'?'/project/a.ipynb':'/project/a.ts'}]});
 mapper.map(assistant);expect(mapper.map({...result,message:{content:[{...result.message.content[0],is_error:true}]}}).events.find(e=>e.kind==='tool.completed')?.data.edits).toBeUndefined();
 mapper.map({...assistant,parent_tool_use_id:'nested'});expect(mapper.map({...result,parent_tool_use_id:'nested'}).events.find(e=>e.kind==='tool.completed')?.data.edits).toBeUndefined();
});

test('a delayed older request snapshot cannot establish continuity input after a newer request',()=>{
 const mapper=new ClaudeStreamMapper(undefined,'s','turn');
 const assistant=(id:string,tokens:number)=>({type:'assistant',session_id:'s',message:{id,model:'m',content:[],usage:{input_tokens:tokens,cache_creation_input_tokens:0,cache_read_input_tokens:0}}});
 mapper.map(assistant('r1',10));mapper.map(assistant('r2',20));
 expect(mapper.map(assistant('r1',10)).events.find(e=>e.kind==='usage')?.data.requestInput).toBeNull();
 expect(mapper.map({type:'result',session_id:'s',subtype:'success'}).events.some(e=>e.data.code==='request.input-finalized')).toBe(false);
});
