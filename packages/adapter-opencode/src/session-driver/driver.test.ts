import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, truncateSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DriverEvent, DriverHostIo, DriverTaskInput, SupervisedChildExit, DriverDecision } from "@deck/core/session/driver";
import { createOpenCodeSessionDriver as productionDriver } from "./driver";
import { buildOpenCodeLaunch as productionLaunch } from "./launch";
import { OpenCodeSseParser, mapOpenCodeEvent } from "./mapper";

const dirs: string[] = [];
// Fake-server contracts must never read the invoking shell's HOME/XDG configuration.
function fixtureEnv() { const home=mkdtempSync(join(tmpdir(),"deck-oc-env-"));dirs.push(home);return {HOME:home,XDG_CONFIG_HOME:join(home,"config"),XDG_DATA_HOME:join(home,"data"),XDG_CACHE_HOME:join(home,"cache")}; }
function createOpenCodeSessionDriver(options: Parameters<typeof productionDriver>[0] = {}) { return productionDriver({...options,baseEnv:{...fixtureEnv(),...options.baseEnv}}); }
function buildOpenCodeLaunch(...args: Parameters<typeof productionLaunch>) { return productionLaunch(args[0],args[1],{...args[2],baseEnv:{...fixtureEnv(),...args[2]?.baseEnv}}); }

afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
const input = (): DriverTaskInput => ({ taskId: "t", memberId: "lead", cwd: "/project", assignment: { runnerId: "opencode", modelId: "opencode/big-pickle", thinking: "high" }, rolePrompt: "role", prompt: "hello", mcp: { servers: ["deck"], sessionTools: [] }, mcpServerSpecs: { deck: { command: "deck", args: ["internal", "session-mcp"], env: { DECK_SESSION_CREDENTIAL_FILE: "/private/credential" } } }, approvals: "relay", credentialFile: "/private/credential", disableNativeDelegation: true });
function privateIo() {
  const dir = mkdtempSync(join(tmpdir(), "deck-oc-driver-")); dirs.push(dir);
  const events: DriverEvent[] = [];
  const io = { writePrivateFile(name: string, content: string) { const path = join(dir, name); writeFileSync(path, content, { mode: 0o600 }); return path; }, emit(e: DriverEvent) { events.push(e); }, approval: async () => ({ decision: "deny" as const }) };
  return { io, events, dir };
}

describe("OpenCode isolated launch", () => {
  test("preserves native user configuration and protects only the task listener and pending project boundary", () => {
    const h = privateIo();
    const launch = buildOpenCodeLaunch(input(), h.io, { baseEnv: { HOME: "/user", XDG_DATA_HOME: "/user/data", XDG_CONFIG_HOME: "/user/config", OPENCODE_CONFIG: "/user/custom.json", OPENCODE_CONFIG_CONTENT: '{"plugin":["file:///user/plugin.mjs"]}', OPENCODE_SERVER_PASSWORD: "old" } });
    expect(launch.args).toEqual(["serve", "--hostname", "127.0.0.1", "--port", "0"]);
    expect(launch.env.HOME).toBe("/user"); expect(launch.env.XDG_DATA_HOME).toBe("/user/data");expect(launch.env.XDG_CONFIG_HOME).toBe("/user/config");expect(launch.env.OPENCODE_CONFIG).toBe("/user/custom.json");expect(launch.env.OPENCODE_DISABLE_PROJECT_CONFIG).toBe("true");expect(launch.env.OPENCODE_SERVER_PASSWORD).not.toBe("old");
    const cfg=JSON.parse(launch.env.OPENCODE_CONFIG_CONTENT!);expect(cfg.plugin).toEqual(["file:///user/plugin.mjs"]);expect(cfg.mcp.deck.command).toEqual(["deck","internal","session-mcp"]);
  });
  test("refuses missing explicit MCP specs", () => { const h = privateIo(); expect(() => buildOpenCodeLaunch({ ...input(), mcpServerSpecs: {} }, h.io)).toThrow("deck"); });
});

describe("OpenCode SSE", () => {
  test("reassembles arbitrary chunks, CRLF, multiline data and ignores comments", () => {
    const parser = new OpenCodeSseParser();
    expect(parser.push(": heartbeat\r\ndata: {\"type\":\"future\",\r")).toEqual([]);
    expect(parser.push("\ndata: \"properties\":{}}\r\n\r\n")).toEqual([{ type: "future", properties: {} }]);
  });
  test("bounds malformed streams", () => { expect(() => new OpenCodeSseParser(32).push("x".repeat(33))).toThrow("opencode-sse-frame-too-large"); });
  test('SSE byte boundary includes wire separators and split multibyte characters; rejection poisons the parser', () => {
    const wire = 'data: {"x":"€😀"}\r\n\r\n';
    const p = new OpenCodeSseParser(Buffer.byteLength(wire));
    const at = wire.indexOf('😀') + 1;
    expect(p.push(wire.slice(0, at))).toEqual([]);
    expect(p.push(wire.slice(at) + 'data: {}\n\n')).toEqual([{ x: '€😀' }, {}]);
    const over = new OpenCodeSseParser(Buffer.byteLength(wire) - 1);
    expect(() => over.push(wire)).toThrow('opencode-sse-frame-too-large');
    expect(over.push('data: {}\n\n')).toEqual([]);
  });
  test('invalid SSE JSON fails explicitly without preserving native payload', () => {
    const p = new OpenCodeSseParser();
    expect(() => p.push('data: PRIVATE_TRANSPORT_SECRET\n\ndata: {}\n\n')).toThrow('opencode-sse-invalid-frame');
    expect(p.push('data: {}\n\n')).toEqual([]);
  });
  test('SSE accumulates multiline data and comments, with exact size only at the frame terminator', () => {
    const wire = ': heartbeat\r\ndata: {"x":\r\ndata: 1}\r\n\r\n';
    const size = Buffer.byteLength(wire), accepted = new OpenCodeSseParser(size), rejected = new OpenCodeSseParser(size-1);
    expect(accepted.push(wire+'data: {}\n\n')).toEqual([{x:1},{}]);
    let failure: unknown;
    try { for (const character of wire) rejected.push(character); } catch (error) { failure = error; }
    expect(failure).toMatchObject({code:'opencode-sse-frame-too-large',size:{frameBytes:size,frameBytesKind:'exact',maxFrameBytes:size-1}});
  });
  test("maps text, reasoning and unknown events with raw payload", () => {
    expect(mapOpenCodeEvent({ type: "message.part.delta", properties: { field: "text", delta: "hi" } })[0]?.kind).toBe("runner.unmapped");
    expect(mapOpenCodeEvent({ type: "message.part.updated", properties: { part: { type: "reasoning", text: "thought" } } })[0]?.kind).toBe("reasoning.delta");
    expect(mapOpenCodeEvent({ type: "future", properties: { foo: 1 } })[0]).toMatchObject({ kind: "runner.unmapped", raw: { type: "future" } });
  });
});

function fakeServer(options: { contextUsage?: boolean; catalog?: unknown; hangCatalog?: boolean; nativeModel?: string; compacted?: boolean; personal?: boolean; extraMcp?: boolean; mutatedMcp?: boolean; nativePermissions?: Array<{permission:string;pattern:string;action:string}>; hang?: boolean; pending?: boolean; abortError?: boolean; failMessage?: boolean; messageError?: unknown; hangEvent?: boolean; resumeStatus?: number; plugins?: readonly string[]; memoryTool?: boolean; pendingQuestions?: unknown[]; questionReplyStatus?: number; pendingPermissions?: unknown[]; permissionReplyStatus?: number } = {}) {
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  const requests: Array<{ path: string; body: any; auth: string | null }> = [];
  let messages = 0;
  const blocked: Array<(r: Response) => void> = [];
  const event = (type: string, properties: Record<string, unknown>) => stream?.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ type, properties })}\n\n`));
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, idleTimeout: 0, async fetch(req) {
    const path = new URL(req.url).pathname; const body = req.method === "POST" ? await req.json().catch(() => ({})) : undefined;
    requests.push({ path, body, auth: req.headers.get("authorization") });
    if (path === "/provider") return options.hangCatalog ? new Promise<Response>(resolve => { blocked.push(resolve); }) : Response.json(options.catalog ?? { all: [{ id: "p", models: { m: { limit: { context: 1000 } }, other: { limit: { context: 2000 } } } }] });
    if (path === "/event" && options.hangEvent) return new Promise<Response>(resolve => { blocked.push(resolve); });
    if (path === "/event") return new Response(new ReadableStream({ start(c) { stream = c; c.enqueue(new TextEncoder().encode('data: {"type":"server.connected","properties":{}}\n\n')); }, cancel() {} }), { headers: { "content-type": "text/event-stream" } });
    if (path === "/mcp") return Response.json({ deck: { status: "connected" }, ...(options.personal ? {personal:{status:"failed",error:"PRIVATE_FAILURE_SENTINEL"}} : {}), ...(options.extraMcp ? { unwanted: { status: "connected" } } : {}) });
    if (path === "/config") return Response.json({ mcp:{deck:{type:"local",command:[options.mutatedMcp ? "foreign" : "deck","internal","session-mcp"],environment:{DECK_SESSION_CREDENTIAL_FILE:"/private/credential"},enabled:true}}, plugin: options.plugins ?? [] });
    if (path === "/agent") return Response.json([{name:"build",permission:options.nativePermissions ?? [{permission:"*",pattern:"*",action:"allow"}]}]);
    if (path === "/experimental/tool/ids") return Response.json(options.memoryTool ? ["bash", "supermemory"] : ["bash"]);
    if (path === "/session") return Response.json({ id: "ses_native" });
    if (path === "/session/ses_native") return Response.json({ id: "ses_native" }, { status: options.resumeStatus ?? 200 });
    if (path === "/permission") return Response.json(options.pendingPermissions ?? (options.pending ? [{ id: "perm1", sessionID: "ses_native", permission: "bash", patterns: ["echo hello"] }] : []));
    if (path === "/question") return Response.json(options.pendingQuestions ?? []);
    if (path.startsWith("/question/")) return Response.json(true, { status: options.questionReplyStatus ?? 200 });
    if (path.endsWith("/reply")) return Response.json(true, { status: options.permissionReplyStatus ?? 200 });
    if (path.endsWith("/abort")) { if (options.abortError) event("session.error", { sessionID: "ses_native", error: { name: "MessageAbortedError" } }); else if (!options.hang) event("session.idle", { sessionID: "ses_native" }); return Response.json(true); }
    if (path.endsWith("/message")) {
      messages++;
      if (options.hang || options.abortError) return new Promise<Response>(resolve => { blocked.push(resolve); });
      event("message.part.updated", { sessionID: "ses_native", part: { id: "text1", messageID: `msg${messages}`, type: "text", text: "" } });
      event("message.part.delta", { sessionID: "ses_native", messageID: `msg${messages}`, partID: "text1", field: "text", delta: "OK" });
      if (options.contextUsage) {
        event('message.updated', { info: { role: 'assistant', sessionID: 'ses_native', parentID: 'old', providerID: 'p', modelID: 'wrong', tokens: { input: 999999 } } });
        if (options.compacted) {
          event('session.compacted', { sessionID: 'ses_native' });
          // Exercise the ordered stream-before-response case. Separate core
          // coverage handles invalidation delivered after a terminal response.
          await new Promise(resolve => setTimeout(resolve, 10));
        }
      }
      return Response.json({ info: { id: `msg${messages}`, ...(options.contextUsage ? { role: 'assistant', sessionID: 'ses_native', parentID: `user${messages}`, providerID: 'p', modelID: options.nativeModel ?? 'm', tokens: { input: 100, output: 10, reasoning: 5, cache: { read: 80, write: 20 } } } : {}), ...(options.failMessage || options.messageError ? { error: options.messageError ?? { name: "APIError" } } : {}) }, parts: [{ type: "text", text: "OK" }] });
    }
    return Response.json({ healthy: true });
  } });
  let finish!: (exit: SupervisedChildExit) => void; let stdout!: (chunk: string) => void;
  let terminated = 0;
  const exited = new Promise<SupervisedChildExit>(r => { finish = r; });
  const child = { ready: Promise.resolve({ workerPid: 123 }), exited, onStdout(fn: (c: string) => void) { stdout = fn; queueMicrotask(() => stdout(`opencode server listening on http://127.0.0.1:${server.port}\n`)); }, onStderr() {}, writeStdin() {}, endStdin() {}, interrupt() { return true; }, async terminateGroup() { terminated++; finish({ ok: false, code: null, signal: "SIGTERM", drained: true, anchorLost: false }); } };
  return { requests, child, event, completeMessages() { for (const resolve of blocked.splice(0)) resolve(Response.json({ info: { id: "completed" }, parts: [] })); }, disconnect() { stream.close(); }, get terminated() { return terminated; }, async stop() { for (const resolve of blocked) resolve(Response.json({ info: { id: "stopped" }, parts: [] })); await server.stop(true); } };
}

test('OpenCode admits >1 MiB escaped tool completion, preserves following controls and completes its HTTP turn', async () => {
  const s = fakeServer({ hang: true }); const h = privateIo();
  let approvals = 0;
  try {
    const task = await createOpenCodeSessionDriver().startTask(input(), { ...h.io, spawn: async () => s.child, approval: async () => { approvals++; return { decision: 'allow' }; } });
    s.event('message.part.updated', { sessionID: 'ses_native', part: { id: 'large', messageID: 'msg', callID: 'large-tool', type: 'tool', tool: 'bash', state: { status: 'completed', output: '€😀"\\\n'.repeat(150000) } } });
    s.event('permission.asked', { id: 'after-large', sessionID: 'ses_native', permission: 'bash', patterns: ['echo fixture'] });
    for (let n = 0; n < 100 && !s.requests.some(r => r.path === '/permission/after-large/reply'); n++) await Bun.sleep(5);
    expect(approvals).toBe(1);
    expect(h.events.find(e => e.kind === 'tool.completed')?.data).toMatchObject({ toolUseId: 'large-tool', status: 'completed' });
    s.completeMessages(); expect(await task.done).toEqual({ status: 'completed' });
    const next = task.send('next');
    for (let n = 0; n < 100 && s.requests.filter(r => r.path.endsWith('/message')).length < 2; n++) await Bun.sleep(5);
    s.completeMessages(); expect(await next).toEqual({ status: 'completed' }); await task.close();
  } finally { await s.stop(); }
});

test.each(['cleanup-reject', 'truncated-utf8', 'interrupt-race', 'coalesced', 'coalesced-utf8', 'split-utf8'] as const)('OpenCode transport review regression: %s', async mode => {
  const s = fakeServer({hang:true}), h = privateIo(), originalFetch = globalThis.fetch;
  let controller!: ReadableStreamDefaultController<Uint8Array>, release!: () => void, started = false;
  const held = new Promise<void>(r => { release = r; });
  globalThis.fetch = (async (url, init) => String(url).endsWith('/event') ? new Response(new ReadableStream<Uint8Array>({start(c){controller=c;}})) : originalFetch(url,init)) as typeof fetch;
  try {
    const task = await createOpenCodeSessionDriver({escalationMs:1}).startTask(input(), {...h.io,spawn:async()=>({...s.child,async terminateGroup(){
      started = true;
      if(mode==='cleanup-reject') throw new Error('fixture cleanup rejected');
      await held; await s.child.terminateGroup();
    }})});
    if(mode==='interrupt-race') { await task.interrupt(); for(let n=0;n<100&&!started;n++)await Bun.sleep(2); expect(started).toBe(true); }
    const valid = 'data: '+JSON.stringify({type:'message.part.updated',properties:{sessionID:'ses_native',part:{id:'part',messageID:'msg',callID:'before-error',type:'tool',tool:'bash',state:{status:'completed',output:'OK'}}}})+'\n\n';
    if(mode==='truncated-utf8') {controller.enqueue(new Uint8Array([0xe2]));controller.close();}
    else if(mode==='coalesced-utf8'||mode==='split-utf8') {
      if(mode==='split-utf8'){controller.enqueue(new TextEncoder().encode(valid));await Bun.sleep(2);}
      controller.enqueue(Buffer.concat([Buffer.from(mode==='coalesced-utf8'?valid:''),new Uint8Array([0xff]),Buffer.from(valid)]));
    } else controller.enqueue(new TextEncoder().encode((mode==='coalesced'?valid:'')+'data: PRIVATE_BAD_FRAME\n\n'+valid));
    for(let n=0;n<100&&!h.events.some(e=>e.data.code==='opencode-sse-invalid-frame');n++)await Bun.sleep(2);
    expect(h.events.some(e=>e.data.code==='opencode-sse-invalid-frame')).toBe(true);
    if(mode!=='cleanup-reject') {let settled=false;void task.done.then(()=>{settled=true;});await Bun.sleep(2);expect(settled).toBe(false);}
    release();
    expect(await task.done).toMatchObject({status:'failed',error:'opencode-sse-invalid-frame'});
    expect(h.events.filter(e=>e.kind==='tool.completed')).toHaveLength(['coalesced','coalesced-utf8','split-utf8'].includes(mode)?1:0);
    if(mode==='cleanup-reject') {
      let exited=false;void s.child.exited.then(()=>{exited=true;});await Promise.resolve();expect(exited).toBe(false);
      await expect(task.close()).rejects.toThrow('fixture cleanup rejected');
      await expect(task.close()).rejects.toThrow('fixture cleanup rejected');
    } else await task.close();
  } finally { release();globalThis.fetch=originalFetch;await s.child.terminateGroup();await s.stop(); }
});

test('OpenCode SSE overflow is local, cancels pending HTTP/control work and drains before completion', async () => {
  const s = fakeServer({ hang: true }); const h = privateIo();
  let decide!: (value: DriverDecision) => void, asked = 0;
  const decision = new Promise<DriverDecision>(r => { decide = r; });
  let drain!: () => void; const drained = new Promise<void>(r => { drain = r; });
  try {
    const task = await createOpenCodeSessionDriver().startTask(input(), { ...h.io, spawn: async () => ({...s.child, async terminateGroup() { await drained; await s.child.terminateGroup(); }}), approval: () => {asked++;return decision;} });
    s.event('permission.asked', { id: 'pending-control', sessionID: 'ses_native', permission: 'bash', patterns: ['echo fixture'] });
    for(let n=0;n<100&&!asked;n++)await Bun.sleep(5);expect(asked).toBe(1);
    s.event('future', { sessionID: 'ses_native', text: 'TRANSPORT_SECRET' + 'x'.repeat(16 * 1024 * 1024) });
    for (let n = 0; n < 100 && !h.events.some(e => e.data.code === 'opencode-sse-frame-too-large'); n++) await Bun.sleep(5);
    let settled = false; void task.done.then(() => { settled = true; });
    s.completeMessages(); decide({decision:'allow'}); await Bun.sleep(5);
    expect(settled).toBe(false); drain();
    expect(await task.done).toMatchObject({ status: 'failed', error: 'opencode-sse-frame-too-large', failure: { category: 'deck', origin: 'deck', certainty: 'reported' } });
    expect(s.terminated).toBe(1);
    const diag = h.events.find(e => e.data.code === 'opencode-sse-frame-too-large');
    expect(diag?.data).toMatchObject({ maxFrameBytes: 16 * 1024 * 1024, frameBytesKind: 'lower-bound' });
    expect(JSON.stringify(h.events)).not.toContain('TRANSPORT_SECRET');
    decide({ decision: 'allow' }); await Bun.sleep(5);
    expect(s.requests.some(r => r.path === '/permission/pending-control/reply')).toBe(false);
    expect((await task.send('next')).status).toBe('failed');
    await task.close(); expect(s.terminated).toBe(1);
    const fresh = fakeServer();
    try {
      const next = await createOpenCodeSessionDriver().startTask({...input(),prompt:'next fixture',resume:{nativeSessionId:'ses_native'}},{...privateIo().io,spawn:async()=>fresh.child});
      expect(await next.done).toEqual({status:'completed'});
      expect(fresh.requests.filter(r=>r.path.endsWith('/message'))).toHaveLength(1);await next.close();
    } finally { await fresh.stop(); }
  } finally { drain(); decide?.({ decision: 'deny' }); await s.stop(); }
});

test('OpenCode accepts a maximum-capacity SSE tool record before the correlated HTTP result', async () => {
  const s = fakeServer({ hang: true }); const h = privateIo();
  try {
    const task = await createOpenCodeSessionDriver().startTask(input(), { ...h.io, spawn: async () => s.child });
    const properties = { sessionID: 'ses_native', part: { id: 'max', messageID: 'msg', callID: 'max-tool', type: 'tool', tool: 'bash', state: { status: 'completed', output: '' } } };
    properties.part.state.output = 'x'.repeat(16 * 1024 * 1024 - 8 - Buffer.byteLength(JSON.stringify({ type: 'message.part.updated', properties })));
    s.event('message.part.updated', properties);
    for (let n=0;n<200&&!h.events.some(e=>e.kind==='tool.completed');n++) await Bun.sleep(5);
    expect(h.events.find(e => e.kind === 'tool.completed')?.data).toMatchObject({ toolUseId: 'max-tool', status: 'completed' });
    s.completeMessages(); expect(await task.done).toEqual({status:'completed'}); await task.close();
  } finally { await s.stop(); }
});

test.each(['overflow','malformed','cleanup-reject'] as const)('OpenCode startup HTTP transport failure aborts readiness with structured evidence and never sends a prompt: %s', async mode => {
  const s = fakeServer(); const h = privateIo(); const originalFetch = globalThis.fetch;
  let cancelled = 0;
  globalThis.fetch = (async (url, init) => {
    if (!String(url).endsWith('/config')) return originalFetch(url, init);
    return new Response(new ReadableStream<Uint8Array>({ start(c) { c.enqueue(mode==='overflow'?new Uint8Array(16*1024*1024+1):new Uint8Array([0xff]));if(mode!=='overflow')c.close(); }, cancel() { cancelled++; } }));
  }) as typeof fetch;
  try {
    const code=mode==='overflow'?'opencode-http-body-too-large':'opencode-http-invalid-body';
    const starting=createOpenCodeSessionDriver().startTask(input(), { ...h.io, spawn: async () => mode==='cleanup-reject'?{...s.child,terminateGroup:async()=>{throw new Error('fixture cleanup rejected');}}:s.child });
    await expect(starting).rejects.toMatchObject({message:mode==='cleanup-reject'?'runner-startup-cleanup-failed':code,failure:{category:'deck',origin:'deck',certainty:'reported',code}});
    if(mode==='cleanup-reject'){
      const error=await starting.catch(e=>e);await expect(error.close()).rejects.toThrow('fixture cleanup rejected');
    }
    expect(cancelled).toBe(mode==='overflow'?1:0); expect(s.terminated).toBe(mode==='cleanup-reject'?0:1); expect(s.requests.some(r=>r.path.endsWith('/message'))).toBe(false);
    if(mode==='overflow')expect(h.events.find(e=>e.data.code===code)?.data.frameBytesKind).toBe('lower-bound');
  } finally { globalThis.fetch=originalFetch; await s.child.terminateGroup();await s.stop(); }
});

test.each(['json', 'utf8'] as const)('OpenCode malformed SSE fails locally, cancels its reader and fences pending questions: %s', async mode => {
  const s = fakeServer({hang:true}); const h = privateIo(); const originalFetch = globalThis.fetch;
  let controller!: ReadableStreamDefaultController<Uint8Array>, cancelled=0, asked=0;
  let answer!: (v: {outcome:'answered';answers:Record<string,string[]>})=>void;
  const response = new Promise<{outcome:'answered';answers:Record<string,string[]>}>(r=>{answer=r;});
  globalThis.fetch = (async (url, init) => String(url).endsWith('/event') ? new Response(new ReadableStream<Uint8Array>({start(c){controller=c;},cancel(){cancelled++;}})) : originalFetch(url,init)) as typeof fetch;
  let task: Awaited<ReturnType<ReturnType<typeof createOpenCodeSessionDriver>['startTask']>> | undefined;
  try {
    task=await createOpenCodeSessionDriver().startTask(input(),{...h.io,spawn:async()=>s.child,question:()=>{asked++;return response;}});
    controller.enqueue(new TextEncoder().encode('data: '+JSON.stringify({type:'question.asked',properties:{sessionID:'ses_native',id:'pending-question',questions:[{question:'Choose',header:'Fixture',options:[{label:'A',description:'a'}]}]}})+'\n\n'));
    for(let n=0;n<100&&!asked;n++)await Bun.sleep(5);expect(asked).toBe(1);
    controller.enqueue(mode==='json'?new TextEncoder().encode('data: TRANSPORT_SECRET\n\ndata: {}\n\n'):new Uint8Array([0xff]));
    expect(await task.done).toMatchObject({status:'failed',error:'opencode-sse-invalid-frame',failure:{category:'deck',origin:'deck'}});
    answer({outcome:'answered',answers:{q1:['A']}}); await Bun.sleep(5);
    expect(s.requests.some(r=>r.path==='/question/pending-question/reply')).toBe(false);
    expect(cancelled).toBe(1);expect(s.terminated).toBe(1);expect(JSON.stringify(h.events)).not.toContain('TRANSPORT_SECRET');await task.close();
  } finally {answer?.({outcome:'answered',answers:{q1:['A']}});globalThis.fetch=originalFetch;await task?.close();await s.stop();}
});

test.each(['accepted', 'overflow', 'close', 'invalid-utf8'] as const)('OpenCode bounded HTTP reader through driver: %s', async mode => {
  const s = fakeServer(); const h = privateIo();
  const originalFetch = globalThis.fetch;
  let cancelled = 0, aborted = false, sent = false, chunks = 0;
  const responseBody = { info: { id: 'reply', sessionID: 'ses_native' }, parts: [{ type: 'text', text: '€😀"\\\n'.repeat(150000) }] };
  if (mode === 'accepted') responseBody.parts[0]!.text += 'x'.repeat(16 * 1024 * 1024 - Buffer.byteLength(JSON.stringify(responseBody)));
  const encoded = new TextEncoder().encode(JSON.stringify(responseBody));
  globalThis.fetch = (async (url, init) => {
    if (!String(url).endsWith('/message')) return originalFetch(url, init);
    init?.signal?.addEventListener('abort', () => { aborted = true; }, { once: true });
    return new Response(new ReadableStream<Uint8Array>({
      pull(controller) {
        if (mode === 'close') return;
        if (mode === 'overflow') { if (chunks++ < 33) controller.enqueue(new Uint8Array(1024 * 1024).fill(120)); else controller.close(); return; }
        if (sent) { controller.close(); return; } sent = true;
        controller.enqueue(mode === 'invalid-utf8' ? new Uint8Array([0xff]) : encoded);
      }, cancel() { cancelled++; },
    }));
  }) as typeof fetch;
  let task: Awaited<ReturnType<ReturnType<typeof createOpenCodeSessionDriver>['startTask']>> | undefined;
  try {
    task = await createOpenCodeSessionDriver().startTask(input(), { ...h.io, spawn: async () => s.child });
    if (mode === 'close') await task.close();
    const result = await task.done;
    if (mode === 'accepted') { expect(encoded.length).toBe(16 * 1024 * 1024); expect(result).toEqual({ status: 'completed' }); expect(h.events.find(e => e.kind === 'message.completed')?.data.text).toBe(responseBody.parts[0]!.text); }
    else if (mode === 'close') { expect(result.status).toBe('interrupted-forced'); expect(cancelled).toBe(1); expect(aborted).toBe(true); }
    else { expect(result).toMatchObject({ status: 'failed', error: mode === 'overflow' ? 'opencode-http-body-too-large' : 'opencode-http-invalid-body', failure: { category: 'deck', origin: 'deck' } }); expect(s.terminated).toBe(1); if(mode === 'overflow') expect(cancelled).toBe(1); }
    await task.close();
  } finally { globalThis.fetch = originalFetch; await task?.close(); await s.stop(); }
});

test('OpenCode usage comes from the correlated response, never stale SSE; native context sum joins exact server catalog once', async () => {
  const s = fakeServer({ contextUsage: true }); const h = privateIo();
  try {
    const task = await createOpenCodeSessionDriver().startTask(input(), { ...h.io, spawn: async () => s.child });
    await task.done;
    expect(h.events.filter(e => e.kind === 'usage')).toHaveLength(1);
    expect(h.events.find(e => e.kind === 'usage')?.data).toMatchObject({ input: 100, cache: { read: 80, write: 20 }, context: { basis: 'opencode-assistant-context', tokens: 215, capacity: 1000, modelId: 'p/m', nativeThreadId: 'ses_native', nativeTurnId: 'user1' } });
    await task.send('followup');
    expect(h.events.filter(e => e.kind === 'usage')).toHaveLength(2);
    expect(h.events.filter(e => e.kind === 'usage').at(-1)?.data.context).toMatchObject({ nativeTurnId: 'user2' });
    expect(s.requests.filter(r => r.path === '/provider')).toHaveLength(1);
    await task.close();
  } finally { await s.stop(); }
});

test('OpenCode post-compaction response preserves usage but invalidates context for this request', async () => {
  const s = fakeServer({ contextUsage: true, compacted: true }); const h = privateIo();
  try {
    const task = await createOpenCodeSessionDriver().startTask(input(), { ...h.io, spawn: async () => s.child });
    await task.done;
    expect(h.events.filter(e => e.kind === 'usage').at(-1)?.data.context).toBeUndefined();
    expect(h.events.some(e => e.data.code === 'context.invalidated')).toBe(true);
    await task.close();
  } finally { await s.stop(); }
});

describe("OpenCode native image inputs", () => {
  test.each([false, true])("passes multiple image file parts to fresh/resumed turns (%s) without inheriting attachments", async (resumed) => {
    const s = fakeServer(); const h = privateIo();
    const files = ["image/png", "image/jpeg"].map((mimeType, index) => {
      const path = join(h.dir, `image-${index}`); writeFileSync(path, `image-bytes-${index}`);
      return { path, mimeType: mimeType as "image/png" | "image/jpeg", name: `Image ${index + 1}` };
    });
    try {
      const task = await createOpenCodeSessionDriver().startTask({ ...input(), images: files, ...(resumed ? { resume: { nativeSessionId: "ses_native" } } : {}) }, { ...h.io, spawn: async () => s.child });
      expect((await task.done).status).toBe("completed");
      expect(s.requests.find(r => r.path.endsWith("/message"))!.body.parts).toEqual([{ type: "text", text: "hello" }, ...files.map((file, index) => ({ type: "file", mime: file.mimeType, filename: file.name, url: `data:${file.mimeType};base64,${Buffer.from(`image-bytes-${index}`).toString("base64")}` }))]);
      s.event("message.part.updated", { sessionID: "ses_native", part: { type: "file", mime: "image/png", url: "data:image/png;base64,PRIVATEBASE64PAYLOAD" } });
      expect((await task.send("", [files[1]!])).status).toBe("completed");
      expect(JSON.stringify(h.events)).not.toContain("PRIVATEBASE64PAYLOAD");

      expect(s.requests.filter(r => r.path.endsWith("/message"))[1]!.body.parts).toEqual([{ type: "file", mime: "image/jpeg", filename: "Image 2", url: `data:image/jpeg;base64,${Buffer.from("image-bytes-1").toString("base64")}` }]);
      await task.send("text only"); expect(s.requests.filter(r => r.path.endsWith("/message"))[2]!.body.parts).toEqual([{ type: "text", text: "text only" }]); await task.close();
    } finally { await s.stop(); }
  });
  test("rejects missing, oversized, excessive and aggregate oversized image inputs without exposing paths", async () => {
    const h = privateIo(); const path = join(h.dir, "private-image"); writeFileSync(path, "image");
    const file = { path, mimeType: "image/png" as const, name: "Image 1" };
    const huge = { ...file, path: path + "-huge" }; writeFileSync(huge.path, ""); truncateSync(huge.path, 5 * 1024 * 1024 + 1);
    const aggregate = { ...file, path: path + "-aggregate" }; writeFileSync(aggregate.path, ""); truncateSync(aggregate.path, 5 * 1024 * 1024);
    for (const bad of [[{ ...file, path: path + "-missing" }], [huge], Array(9).fill(file), Array(5).fill(aggregate)]) {
      const s = fakeServer();
      try {
        const task = await createOpenCodeSessionDriver().startTask({ ...input(), images: bad }, { ...h.io, spawn: async () => s.child });
        expect(await task.done).toMatchObject({ status: "failed", error: "image-input-invalid" });
        expect(s.requests.some(r => r.path.endsWith("/message"))).toBe(false); expect(JSON.stringify(h.events)).not.toContain(path); await task.close();
      } finally { await s.stop(); }
    }
  });
});

describe("OpenCode driver production HTTP contract", () => {
  test.each([false, true])("runner process exit retains supervision uncertainty (%s)", async anchorLost => {
    const s = fakeServer({ hang: true }); const h = privateIo();
    let exit!: (value: SupervisedChildExit) => void;
    const exited = new Promise<SupervisedChildExit>(resolve => { exit = resolve; });
    try {
      const task = await createOpenCodeSessionDriver().startTask(input(), { ...h.io, spawn: async () => ({ ...s.child, exited }) });
      exit({ ok: false, code: anchorLost ? null : 1, signal: null, drained: true, anchorLost });
      expect(await task.done).toMatchObject({ status: "failed", failure: { category: anchorLost ? "unknown" : "runner-process", origin: anchorLost ? "unknown" : "runner" } });
      await task.close();
    } finally { await s.stop(); }
  });
  test("reports verified structured message failure through the production response path", async () => {
    const s = fakeServer({ messageError: { name: "APIError", data: { statusCode: 503, isRetryable: true, message: "PRIVATE_SENTINEL", responseBody: "PRIVATE_SENTINEL" } } }); const h = privateIo();
    try {
      const task = await createOpenCodeSessionDriver().startTask(input(), { ...h.io, spawn: async () => s.child });
      const outcome = await task.done;
      expect(outcome).toMatchObject({ status: "failed", failure: { category: "provider-unavailable", origin: "provider", httpStatus: 503 } });
      expect(JSON.stringify(outcome)).not.toContain("PRIVATE_SENTINEL");
      expect(s.requests.filter(r => r.path.endsWith("/message"))).toHaveLength(1); await task.close();
    } finally { await s.stop(); }
  });
  test("foreign errors and late old request responses cannot attach failure to the next turn", async () => {
    const s = fakeServer({ hang: true }); const h = privateIo();
    try {
      const task = await createOpenCodeSessionDriver().startTask(input(), { ...h.io, spawn: async () => s.child });
      s.event("session.error", { sessionID: "foreign", error: { name: "ProviderAuthError", data: { providerID: "anthropic", message: "secret" } } });
      for (let i = 0; i < 50 && !s.requests.some(r => r.path.endsWith("/message")); i++) await new Promise(r => setTimeout(r, 1));
      s.completeMessages(); expect(await task.done).toEqual({ status: "completed" });
      s.event("session.error", { sessionID: "ses_native", error: { name: "ProviderAuthError", data: { providerID: "anthropic", message: "secret" } } });
      // Drain the pre-turn event before the next request is admitted.
      for (let i = 0; i < 50 && !h.events.some(e => e.raw && (e.raw as any).type === "session.error" && (e.raw as any).properties.sessionID === "ses_native"); i++) await new Promise(r => setTimeout(r, 1));
      const next = task.send("manual follow-up");
      for (let i = 0; i < 50 && s.requests.filter(r => r.path.endsWith("/message")).length < 2; i++) await new Promise(r => setTimeout(r, 1));
      s.completeMessages(); expect(await next).toEqual({ status: "completed" }); await task.close();
    } finally { await s.stop(); }
  });
  test("uses native part types to stream reasoning separately and ignores unknown or foreign deltas", async () => {
    const s = fakeServer({ hang: true }); const h = privateIo();
    try {
      const task = await createOpenCodeSessionDriver().startTask(input(), { ...h.io, spawn: async () => s.child });
      s.event("message.part.delta", { sessionID: "ses_native", messageID: "m1", partID: "unknown", field: "text", delta: "untyped" });
      s.event("message.part.updated", { sessionID: "ses_native", part: { messageID: "m1", id: "r1", type: "reasoning", text: "Inspect" } });
      s.event("message.part.delta", { sessionID: "foreign", messageID: "m1", partID: "r1", field: "text", delta: "foreign" });
      s.event("message.part.delta", { sessionID: "ses_native", messageID: "m1", partID: "r1", field: "text", delta: " source" });
      s.event("message.part.updated", { sessionID: "ses_native", part: { messageID: "m1", id: "t1", type: "text", text: "" } });
      s.event("message.part.delta", { sessionID: "ses_native", messageID: "m1", partID: "t1", field: "text", delta: "Reply" });
      for (let i = 0; i < 50 && !h.events.some(e => e.data.text === "Reply"); i++) await new Promise(r => setTimeout(r, 1));
      expect(h.events.filter(e => e.kind === "message.delta").map(e => e.data.text)).toEqual(["Reply"]);
      expect(h.events.filter(e => e.kind === "reasoning.delta").map(e => e.data)).toMatchObject([{ format: "snapshot", text: "Inspect" }, { format: "delta", text: " source" }]);
      expect(h.events.some(e => e.data.text === "foreign")).toBe(false);
      await task.close();
    } finally { await s.stop(); }
  });
  test("only a missing resume session HTTP404 carries the host reseed reason", async () => {
    for (const status of [404, 401]) {
      const s = fakeServer({ resumeStatus: status }); const h = privateIo();
      try {
        let error: unknown;
        try { await createOpenCodeSessionDriver({ baseEnv: {} }).startTask({ ...input(), resume: { nativeSessionId: "ses_native" } }, { ...h.io, spawn: async () => s.child }); } catch (caught) { error = caught; }
        expect((error as { reasonCode?: string }).reasonCode).toBe(status === 404 ? "native-session-not-found" : undefined);
        expect(s.terminated).toBe(1);
      } finally { await s.stop(); }
    }
  });
  test("starts supervised server, rejects stale pre-turn permission, follows up on same native session and closes", async () => {
    const s = fakeServer({ pending: true }); const h = privateIo();
    try {
      const approvals: string[] = [];
      const io: DriverHostIo = { ...h.io, approval: async r => { approvals.push(r.approvalId); return { decision: "deny" }; }, spawn: async (_cmd, args) => { expect(args).not.toContain("--pure"); return s.child; } };
      const task = await createOpenCodeSessionDriver({ baseEnv: {} }).startTask(input(), io);
      expect(await task.nativeSessionId).toBe("ses_native"); expect(await task.done).toEqual({ status: "completed" });
      expect(await task.send("again")).toEqual({ status: "completed" });
      expect(s.requests.filter(r => r.path === "/session")).toHaveLength(1);
      const prompts = s.requests.filter(r => r.path.endsWith("/message"));
      expect(prompts[0]!.body).toMatchObject({ system: "role", model: { providerID: "opencode", modelID: "big-pickle" }, variant: "high", parts: [{ type: "text", text: "hello" }] });
      expect(approvals).toEqual([]); expect(s.requests.find(r => r.path.endsWith("/reply"))!.body).toEqual({ reply: "reject" });
      expect(s.requests.every(r => r.auth?.startsWith("Basic "))).toBe(true);
      expect(h.events.some(e => e.kind === "message.delta")).toBe(true);
      await task.close(); expect(s.terminated).toBe(1);
    } finally { await s.stop(); }
  });
  test("retains native MCPs but blocks a plugin mutation of the protected Deck spec before a prompt", async () => {
    const s = fakeServer({ mutatedMcp: true, extraMcp: true }); const h = privateIo();
    try { await expect(createOpenCodeSessionDriver().startTask(input(), { ...h.io, spawn: async () => s.child })).rejects.toThrow("opencode-mcp-spec-conflict"); expect(s.terminated).toBe(1); expect(s.requests.some(r => r.path.endsWith("/message") || r.path === "/session")).toBe(false); } finally { await s.stop(); }
  });
  test("resumes native session without creating another", async () => {
    const s = fakeServer(); const h = privateIo();
    try { const task = await createOpenCodeSessionDriver().startTask({ ...input(), resume: { nativeSessionId: "ses_native" } }, { ...h.io, spawn: async () => s.child }); expect(await task.done).toEqual({ status: "completed" }); expect(s.requests.some(r => r.path === "/session")).toBe(false); await task.close(); } finally { await s.stop(); }
  });
  test("abort escalates to forced interruption when native terminal event is absent", async () => {
    const s = fakeServer({ hang: true }); const h = privateIo();
    try { const task = await createOpenCodeSessionDriver({ escalationMs: 15 }).startTask(input(), { ...h.io, spawn: async () => s.child }); await task.interrupt(); expect(await task.done).toEqual({ status: "interrupted-forced" }); expect(s.requests.some(r => r.path.endsWith("/abort"))).toBe(true); expect(s.terminated).toBe(1); await task.close(); } finally { await s.stop(); }
  });
  test("native abort terminal errors normalize as interrupted", async () => {
    const s = fakeServer({ abortError: true }); const h = privateIo();
    try { const task = await createOpenCodeSessionDriver().startTask(input(), { ...h.io, spawn: async () => s.child }); await task.interrupt(); expect(await task.done).toEqual({ status: "interrupted" }); await task.close(); } finally { await s.stop(); }
  });
  test("normal abort stays graceful and provider failure cannot become success", async () => {
    const s = fakeServer({ failMessage: true }); const h = privateIo();
    try { const task = await createOpenCodeSessionDriver().startTask(input(), { ...h.io, spawn: async () => s.child }); expect((await task.done).status).toBe("failed"); await task.close(); } finally { await s.stop(); }
  });
  test("SSE disconnect fails the active turn and terminates its server", async () => {
    const s = fakeServer({ hang: true }); const h = privateIo();
    try { const task = await createOpenCodeSessionDriver().startTask(input(), { ...h.io, spawn: async () => s.child }); s.disconnect(); expect(await task.done).toMatchObject({ status: "failed", failure: { category: "network", origin: "unknown" } }); await task.close(); expect(s.terminated).toBe(1); } finally { await s.stop(); }
  });
  test("readiness timeout cleans up even when the supervised ready handshake never resolves", async () => {
    const s = fakeServer(); const h = privateIo();
    try { await expect(createOpenCodeSessionDriver({ readinessMs: 10 }).startTask(input(), { ...h.io, spawn: async () => ({ ...s.child, ready: new Promise(() => {}), onStdout() {} }) })).rejects.toThrow("readiness"); expect(s.terminated).toBe(1); } finally { await s.stop(); }
  });
  test("SSE approval is relayed once and allow uses native once", async () => {
    const s = fakeServer({ hang: true }); const h = privateIo();
    try {
      let approvals = 0;
      const task = await createOpenCodeSessionDriver().startTask(input(), { ...h.io, approval: async () => { approvals++; return { decision: "allow" }; }, spawn: async () => s.child });
      s.event("permission.asked", { id: "allow1", sessionID: "ses_native", permission: "bash" });
      s.event("permission.asked", { id: "allow1", sessionID: "ses_native", permission: "bash" });
      for (let i = 0; i < 20 && !s.requests.some(r => r.path.endsWith("/reply")); i++) await new Promise(r => setTimeout(r, 1));
      expect(approvals).toBe(1); expect(s.requests.find(r => r.path.endsWith("/reply"))!.body).toEqual({ reply: "once" });
      await task.close(); expect((await task.done).status).toBe("interrupted-forced");
    } finally { await s.stop(); }
  });
  test("probes supported, newer and missing versions without provider calls", async () => {
    expect(await createOpenCodeSessionDriver({ exec: async () => ({ code: 0, stdout: "1.18.31" }) }).probe({ cwd: "/tmp" })).toMatchObject({ status: "ready", version: "1.18.31" });
    expect(await createOpenCodeSessionDriver({ exec: async () => ({ code: 0, stdout: "1.19.0" }) }).probe({ cwd: "/tmp" })).toMatchObject({ status: "degraded", reasonCode: "opencode-version-untested" });
    expect(await createOpenCodeSessionDriver({ exec: async () => { throw Error("missing"); } }).probe({ cwd: "/tmp" })).toMatchObject({ status: "blocked", reasonCode: "opencode-not-installed" });
  });
});

test("adapter registration and ordinary read-only MCP composition exclude memory, web and plugins", async () => {
  const { createOpenCodeRunnerAdapter } = await import("../runner-adapter");
  const h = privateIo();
  writeFileSync(join(h.dir, "opencode.json"), JSON.stringify({ plugin: ["untrusted-plugin"], mcp: { "context-mode": { type: "local", command: ["context-mode", "--mcp"] }, supermemory: { type: "remote", url: "https://memory.invalid" }, "web-search": { type: "local", command: ["web"] }, arbitrary: { type: "local", command: ["other"] } } }));
  const adapter = createOpenCodeRunnerAdapter({ developerTeamConfigDir: h.dir, sessionDriver: { exec: async () => ({ code: 0, stdout: "1.18.31" }) } });
  expect(adapter.getSessionDriver?.()?.runnerId).toBe("opencode");
  expect(await adapter.readSessionMcpServers?.()).toEqual({});
});

test("personal HTTP configuration and credentials remain in the native source", async () => {
  const { createOpenCodeRunnerAdapter } = await import("../runner-adapter");
  const h = privateIo();
  writeFileSync(join(h.dir, "opencode.json"), JSON.stringify({ mcp: { context7: { type: "remote", url: "https://mcp.context7.com/mcp", enabled: true } } }));
  const adapter = createOpenCodeRunnerAdapter({ developerTeamConfigDir: h.dir });
  const servers = await adapter.readSessionMcpServers?.();
  expect(servers).toEqual({});
  const launch = buildOpenCodeLaunch(input(), h.io, {baseEnv:{HOME:h.dir,OPENCODE_CONFIG:join(h.dir,"opencode.json")}});
  expect(JSON.parse(launch.env.OPENCODE_CONFIG_CONTENT!).mcp.context7).toBeUndefined();expect(launch.env.OPENCODE_CONFIG).toBe(join(h.dir,"opencode.json"));
  writeFileSync(join(h.dir, "opencode.json"), JSON.stringify({ mcp: { context7: { type: "remote", url: "https://mcp.context7.com/mcp", headers: { Authorization: "Bearer sensitive" } } } }));
  expect(await adapter.readSessionMcpServers?.()).toEqual({});
});

test("HTTP header auth uses native environment references, never resolved values", () => {
  const h = privateIo();
  const original = input();
  const launch = buildOpenCodeLaunch({ ...original, mcp: { ...original.mcp, servers: [...original.mcp.servers, "context7"] },
    mcpServerSpecs: { ...original.mcpServerSpecs, context7: { transport: "http", url: "https://mcp.context7.com/mcp", envHttpHeaders: { "X-Context7-API-Key": "CONTEXT7_API_KEY" } } } }, h.io, { baseEnv: {} });
  expect(JSON.parse(launch.env.OPENCODE_CONFIG_CONTENT!).mcp.context7).toEqual({ type: "remote", url: "https://mcp.context7.com/mcp", enabled: true, oauth: false, headers: { "X-Context7-API-Key": "{env:CONTEXT7_API_KEY}" } });
  expect(launch.args.join(" ")).not.toContain("CONTEXT7_API_KEY");
});

test.each<Record<string, string>>([{ "X-Key": "inline-secret-value" }, { "X-Key": "{env:TOKEN}" }, { "Bad\r\nHeader": "TOKEN" }])("rejects invalid HTTP header environment references %j", envHttpHeaders => {
  const h = privateIo();
  expect(() => buildOpenCodeLaunch({ ...input(), mcpServerSpecs: { deck: { transport: "http", url: "https://example.com/mcp", envHttpHeaders } } }, h.io, { baseEnv: {} })).toThrow("opencode-http-header-reference-invalid");
});


test("ready handshake remains bounded after the server prints its endpoint", async () => {
  const s = fakeServer(); const h = privateIo();
  try {
    const start = createOpenCodeSessionDriver({ readinessMs: 10 }).startTask(input(), { ...h.io, spawn: async () => ({ ...s.child, ready: new Promise(() => {}) }) });
    const outcome = await Promise.race([start.then(() => "started", error => String(error.message)), new Promise<string>(resolve => setTimeout(() => resolve("deadline missed"), 50))]);
    expect(outcome).toContain("readiness timed out"); expect(s.terminated).toBe(1);
  } finally { await s.child.terminateGroup(); await s.stop(); }
});

test("SSE response readiness deadline aborts the request and cleans up the server", async () => {
  const s = fakeServer({ hangEvent: true }); const h = privateIo();
  try {
    const start = createOpenCodeSessionDriver({ readinessMs: 10 }).startTask(input(), { ...h.io, spawn: async () => s.child });
    const outcome = await Promise.race([start.then(() => "started", error => String(error.message)), new Promise<string>(resolve => setTimeout(() => resolve("deadline missed"), 50))]);
    expect(outcome).toContain("readiness timed out"); expect(s.terminated).toBe(1);
  } finally { await s.child.terminateGroup(); await s.stop(); }
});

test.each(["interrupted", "completed"] as const)("delayed approval after a %s turn is rejected even when another turn starts", async terminal => {
  const s = fakeServer({ hang: true }); const h = privateIo();
  let release!: (decision: DriverDecision) => void;
  let requested!: () => void;
  const requestSeen = new Promise<void>(resolve => { requested = resolve; });
  try {
    const task = await createOpenCodeSessionDriver({ escalationMs: 1000 }).startTask(input(), { ...h.io, spawn: async () => s.child, approval: () => { requested(); return new Promise(resolve => { release = resolve; }); } });
    s.event("permission.asked", { id: "late", sessionID: "ses_native", permission: "bash", always: ["*"] });
    await requestSeen;
    if (terminal === "interrupted") { await task.interrupt(); s.event("session.idle", { sessionID: "ses_native" }); }
    else s.completeMessages();
    expect((await task.done).status).toBe(terminal);
    const followup = task.send("followup");
    release({ decision: "allow", scope: "always" });
    for (let i = 0; i < 30 && !s.requests.some(r => r.path === "/permission/late/reply"); i++) await new Promise(resolve => setTimeout(resolve, 1));
    expect(s.requests.find(r => r.path === "/permission/late/reply")?.body).toEqual({ reply: "reject" });
    await task.close(); await followup;
  } finally { await s.stop(); }
});

test("admits the verified native memory loader while suppressing project and default plugins", () => {
  const h = privateIo();
  const nativeMemory: NonNullable<DriverTaskInput["nativeMemory"]> = { provider: "supermemory", integration: "runner-plugin", status: "ready", projectScope: "sm_project_v1_owner_repo", plugin: { root: "/owned/supermemory", loaderPath: "/owned/supermemory/opencode-supermemory-loader.mjs" } };
  const launch = buildOpenCodeLaunch({ ...input(), nativeMemory }, h.io, { baseEnv: {} });
  expect(launch.args).not.toContain("--pure");
  expect(launch.env.OPENCODE_DISABLE_DEFAULT_PLUGINS).toBeUndefined();
  expect(JSON.parse(launch.env.OPENCODE_CONFIG_CONTENT!).plugin).toEqual(["file:///owned/supermemory/opencode-supermemory-loader.mjs"]);
  expect(() => buildOpenCodeLaunch({ ...input(), nativeMemory: { ...nativeMemory, status: "unavailable" } }, h.io)).toThrow("opencode-native-memory-unavailable");
});

const nativeMemoryInput = (): DriverTaskInput => ({ ...input(), nativeMemory: { provider: "supermemory", integration: "runner-plugin", status: "ready", projectScope: "sm_project_v1_owner_repo", plugin: { root: "/owned/supermemory", loaderPath: "/owned/supermemory/opencode-supermemory-loader.mjs" } } });
test("verifies native loader registration and resumed tool readiness, reports capture limitation", async () => {
  const s = fakeServer({ plugins: ["file:///owned/supermemory/opencode-supermemory-loader.mjs"], memoryTool: true }); const h = privateIo();
  try {
    const task = await createOpenCodeSessionDriver({ baseEnv: {} }).startTask({ ...nativeMemoryInput(), resume: { nativeSessionId: "ses_native" } }, { ...h.io, spawn: async () => s.child });
    expect(await task.done).toEqual({ status: "completed" });
    expect(s.requests.some(r => r.path === "/experimental/tool/ids")).toBe(true);
    expect(s.requests.some(r => r.path === "/session")).toBe(false);
    expect(h.events).toContainEqual(expect.objectContaining({ kind: "diagnostic", data: expect.objectContaining({ code: "native-memory-capture-unverified", provider: "supermemory" }) }));
    await task.close();
  } finally { await s.stop(); }
});
test.each([
  { plugins: ["file:///foreign/plugin.mjs"], memoryTool: true, code: "opencode-plugin-isolation-violation" },
  { plugins: ["file:///owned/supermemory/opencode-supermemory-loader.mjs"], memoryTool: false, code: "opencode-native-memory-tool-unavailable" },
])("blocks prompt effects when native memory readiness fails: $code", async ({ code, ...options }) => {
  const s = fakeServer(options); const h = privateIo();
  try {
    await expect(createOpenCodeSessionDriver({ baseEnv: {} }).startTask(nativeMemoryInput(), { ...h.io, spawn: async () => s.child })).rejects.toThrow(code);
    expect(s.requests.some(r => r.path.endsWith("/message"))).toBe(false);
    expect(s.terminated).toBe(1);
  } finally { await s.stop(); }
});

test("global memory explicitly admits native loader while dropping inherited provider selectors and credentials", () => {
  const h = privateIo();
  const nativeMemory = { provider: "supermemory", integration: "runner-plugin", status: "ready", scopeMode: "global", plugin: { root: "/owned/official", loaderPath: "/owned/official/loader.js" } } as const;
  const launch = buildOpenCodeLaunch({ ...input(), nativeMemory }, h.io, { baseEnv: { HOME: "/user", SUPERMEMORY_API_KEY: "real-key", SUPERMEMORY_REPO_TAG: "foreign", SUPERMEMORY_API_URL: "https://foreign", DECK_MEMORY_CONTAINER: "foreign" } });
  expect(launch.expectedPlugins).toEqual(["file:///owned/official/loader.js"]);
  expect(launch.env.HOME).toBe("/user");
  expect(Object.keys(launch.env).some(key => /^(SUPERMEMORY_|DECK_MEMORY_)/.test(key))).toBe(false);
  expect(() => buildOpenCodeLaunch({ ...input(), nativeMemory: { ...nativeMemory, scopeMode: undefined } }, h.io)).toThrow("opencode-native-memory-invalid");
  expect(() => buildOpenCodeLaunch({ ...input(), nativeMemory: { ...nativeMemory, projectScope: "sm_project_v1_owner_repo" } }, h.io)).toThrow("opencode-native-memory-invalid");
});

const questionFixture = (id = "que_test") => ({
  id, sessionID: "ses_native",
  questions: [
    { question: "Choose a mode", header: "Mode", options: [{ label: "Fast", description: "Quick result" }], custom: false },
    { question: "Choose features", header: "Features", options: [{ label: "A", description: "Feature A" }], multiple: true },
  ],
  tool: { messageID: "msg_test", callID: "call_test" },
});
async function waitForRequest(s: ReturnType<typeof fakeServer>, path: string) {
  for (let i = 0; i < 100 && !s.requests.some(r => r.path === path); i++) await new Promise(resolve => setTimeout(resolve, 1));
  expect(s.requests.some(r => r.path === path)).toBe(true);
}

test("questions map v1 fields, order answers, dedupe and ignore foreign/v2 events", async () => {
  const s = fakeServer({ hang: true }); const h = privateIo();
  const calls: unknown[] = [];
  try {
    const task = await createOpenCodeSessionDriver().startTask(input(), { ...h.io, spawn: async () => s.child, question: async req => {
      calls.push(req); return { outcome: "answered", answers: { q2: ["A", "Other"], q1: ["Fast"] } };
    } });
    s.event("question.asked", { ...questionFixture(), sessionID: "ses_foreign" });
    s.event("question.v2.asked", questionFixture("que_v2"));
    s.event("question.asked", questionFixture());
    s.event("question.asked", questionFixture());
    await waitForRequest(s, "/question/que_test/reply");
    expect(calls).toEqual([{ questionId: "que_test", questions: [
      { id: "q1", prompt: "Choose a mode", header: "Mode", options: [{ label: "Fast", description: "Quick result" }], multiple: false, allowOther: false, secret: false },
      { id: "q2", prompt: "Choose features", header: "Features", options: [{ label: "A", description: "Feature A" }], multiple: true, allowOther: true, secret: false },
    ] }]);
    expect(s.requests.filter(r => r.path.startsWith("/question/"))).toHaveLength(1);
    expect(s.requests.find(r => r.path === "/question/que_test/reply")?.body).toEqual({ answers: [["Fast"], ["A", "Other"]] });
    expect(h.events.some(e => e.kind === "runner.unmapped" && String(e.data.type).startsWith("question."))).toBe(false);
    expect(JSON.stringify(h.events)).not.toContain("Other");
    await task.close();
  } finally { await s.stop(); }
});

test.each(["dismissed", "cancelled", "absent", "throws"] as const)("rejects questions when host is %s", async mode => {
  const s = fakeServer({ hang: true }); const h = privateIo();
  try {
    const question: DriverHostIo["question"] = mode === "absent" ? undefined : async () => {
      if (mode === "throws") throw Error("broker failed");
      return { outcome: mode === "cancelled" ? "cancelled" : "dismissed" };
    };
    const task = await createOpenCodeSessionDriver().startTask(input(), { ...h.io, spawn: async () => s.child, question });
    s.event("question.asked", questionFixture());
    await waitForRequest(s, "/question/que_test/reject");
    await task.close();
  } finally { await s.stop(); }
});

test("replays pending questions, rejects pre-turn requests and deduplicates SSE replay", async () => {
  const s = fakeServer({ hang: true, pendingQuestions: [questionFixture(), { ...questionFixture("que_foreign"), sessionID: "ses_foreign" }] }); const h = privateIo();
  let calls = 0;
  try {
    const task = await createOpenCodeSessionDriver().startTask(input(), { ...h.io, spawn: async () => s.child, question: async () => { calls++; return { outcome: "dismissed" }; } });
    await waitForRequest(s, "/question/que_test/reject");
    s.event("question.asked", questionFixture());
    s.event("question.asked", questionFixture("que_next"));
    await waitForRequest(s, "/question/que_next/reject");
    expect(calls).toBe(1);
    expect(s.requests.filter(r => r.path.startsWith("/question/"))).toHaveLength(2);
    await task.close();
  } finally { await s.stop(); }
});

test.each(["interrupted", "completed"] as const)("rejects delayed question answers after %s even during another turn", async terminal => {
  const s = fakeServer({ hang: true }); const h = privateIo();
  let release!: (answer: { outcome: "answered"; answers: Record<string, string[]> }) => void;
  let requested!: () => void;
  const seen = new Promise<void>(resolve => { requested = resolve; });
  try {
    const task = await createOpenCodeSessionDriver().startTask(input(), { ...h.io, spawn: async () => s.child, question: () => { requested(); return new Promise(resolve => { release = resolve; }); } });
    s.event("question.asked", questionFixture());
    await seen;
    if (terminal === "interrupted") { await task.interrupt(); s.event("session.idle", { sessionID: "ses_native" }); }
    else s.completeMessages();
    expect((await task.done).status).toBe(terminal);
    const next = task.send("again");
    release({ outcome: "answered", answers: { q1: ["Fast"], q2: ["A"] } });
    await waitForRequest(s, "/question/que_test/reject");
    await task.close(); await next;
  } finally { await s.stop(); }
});

test("question reply failure emits diagnostic and fails active turn", async () => {
  const s = fakeServer({ hang: true, questionReplyStatus: 500 }); const h = privateIo();
  try {
    const task = await createOpenCodeSessionDriver().startTask(input(), { ...h.io, spawn: async () => s.child, question: async () => ({ outcome: "answered", answers: { q1: ["Fast"], q2: ["A"] } }) });
    s.event("question.asked", questionFixture());
    expect(await task.done).toEqual({ status: "failed", error: "OpenCode question reply failed" });
    expect(h.events.some(e => e.kind === "diagnostic" && e.data.code === "opencode-question-reply-failed")).toBe(true);
    await task.close();
  } finally { await s.stop(); }
});

test.each([
  ["bash", "high"], ["edit", "high"], ["write", "high"], ["patch", "high"],
  ["webfetch", "high"], ["external_directory", "high"], ["future_tool", "high"],
  ["read", "normal"], ["glob", "normal"], ["grep", "normal"], ["list", "normal"],
] as const)("advertises approval identity and risk for %s", async (permission, risk) => {
  const s = fakeServer({ hang: true }); const h = privateIo();
  const calls: Parameters<DriverHostIo["approval"]>[0][] = [];
  try {
    const task = await createOpenCodeSessionDriver().startTask(input(), { ...h.io, spawn: async () => s.child, approval: async req => {
      calls.push(req); return { decision: "deny" };
    } });
    s.event("permission.asked", { id: "scope", sessionID: "ses_native", permission, patterns: ["first", "second"], always: ["first *", "second *"], metadata: { context: true } });
    await waitForRequest(s, "/permission/scope/reply");
    expect(calls).toEqual([expect.objectContaining({
      tool: permission, toolKey: `opencode:${permission}`, exactKey: "first second", risk,
      nativeScopes: ["always"], input: { context: true },
      alwaysNote: "OpenCode stores this permission for this project on this machine (outside Deck); it applies to future sessions and Deck cannot revoke it\nPatterns: first *\nsecond *",
    })]);
    await task.close();
  } finally { await s.stop(); }
});

test.each([
  { decision: "allow", scope: undefined, always: ["*"], reply: "once" },
  { decision: "allow", scope: "once", always: ["*"], reply: "once" },
  { decision: "allow", scope: "always", always: ["*"], reply: "always" },
  { decision: "allow", scope: "always", always: [], reply: "once" },
  { decision: "allow", scope: "always", always: undefined, reply: "once" },
  { decision: "allow", scope: "future", always: ["*"], reply: "once" },
  { decision: "deny", scope: "always", always: ["*"], reply: "reject" },
] as const)("permission wire reply $decision/$scope with $always is $reply", async ({ decision, scope, always, reply }) => {
  const s = fakeServer({ hang: true }); const h = privateIo();
  const calls: Parameters<DriverHostIo["approval"]>[0][] = [];
  try {
    const task = await createOpenCodeSessionDriver().startTask(input(), { ...h.io, spawn: async () => s.child, approval: async req => {
      calls.push(req); return { decision, scope } as DriverDecision;
    } });
    const properties = { id: "wire", sessionID: "ses_native", permission: "bash", patterns: [], always };
    s.event("permission.asked", { ...properties, sessionID: "ses_foreign" });
    s.event("permission.asked", properties);
    s.event("permission.asked", properties);
    await waitForRequest(s, "/permission/wire/reply");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.exactKey).toBeUndefined();
    expect(calls[0]?.nativeScopes).toEqual(always?.length ? ["always"] : undefined);
    expect(calls[0]?.alwaysNote).toEqual(always?.length ? expect.stringContaining("Patterns: *") : undefined);
    expect(s.requests.filter(r => r.path === "/permission/wire/reply").map(r => r.body)).toEqual([{ reply }]);
    await task.close();
  } finally { await s.stop(); }
});

test("permission exact keys are redacted and bounded", async () => {
  const s = fakeServer({ hang: true }); const h = privateIo();
  const calls: Parameters<DriverHostIo["approval"]>[0][] = [];
  try {
    const task = await createOpenCodeSessionDriver().startTask(input(), { ...h.io, spawn: async () => s.child, approval: async req => { calls.push(req); return { decision: "deny" }; } });
    s.event("permission.asked", { id: "key", sessionID: "ses_native", permission: "bash", patterns: ["TOKEN=private-secret", "x".repeat(600)] });
    await waitForRequest(s, "/permission/key/reply");
    expect(calls[0]?.exactKey).toBe("TOKEN=[redacted] " + "x".repeat(600));
    expect(calls[0]?.exactKey).not.toContain("private-secret");
    await task.close();
  } finally { await s.stop(); }
});

test("replayed permissions use stale guard and dedupe while fresh ones advertise always", async () => {
  const fixture = { id: "replayed", sessionID: "ses_native", permission: "bash", patterns: ["echo hello"], always: ["echo *"] };
  const s = fakeServer({ hang: true, pendingPermissions: [fixture] }); const h = privateIo();
  const calls: Parameters<DriverHostIo["approval"]>[0][] = [];
  try {
    const task = await createOpenCodeSessionDriver().startTask(input(), { ...h.io, spawn: async () => s.child, approval: async req => { calls.push(req); return { decision: "allow", scope: "always" }; } });
    await waitForRequest(s, "/permission/replayed/reply");
    s.event("permission.asked", fixture);
    s.event("permission.asked", { ...fixture, id: "fresh" });
    await waitForRequest(s, "/permission/fresh/reply");
    expect(s.requests.find(r => r.path === "/permission/replayed/reply")?.body).toEqual({ reply: "reject" });
    expect(s.requests.filter(r => r.path === "/permission/replayed/reply")).toHaveLength(1);
    expect(s.requests.find(r => r.path === "/permission/fresh/reply")?.body).toEqual({ reply: "always" });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.nativeScopes).toEqual(["always"]);
    await task.close();
  } finally { await s.stop(); }
});

test("permission reply failures preserve diagnostic and fail the active turn", async () => {
  const s = fakeServer({ hang: true, permissionReplyStatus: 500 }); const h = privateIo();
  try {
    const task = await createOpenCodeSessionDriver().startTask(input(), { ...h.io, spawn: async () => s.child });
    s.event("permission.asked", { id: "fail", sessionID: "ses_native", permission: "bash" });
    expect(await task.done).toEqual({ status: "failed", error: "OpenCode permission reply failed" });
    expect(h.events.some(e => e.kind === "diagnostic" && e.data.code === "opencode-permission-reply-failed")).toBe(true);
    await task.close();
  } finally { await s.stop(); }
});

test.each([
  { name: "pattern boundaries", first: ["a b"], second: ["a", "b"], same: false },
  { name: "suffix after 512 characters", first: ["x".repeat(530) + " first"], second: ["x".repeat(530) + " second"], same: false },
  { name: "secret-only difference", first: ["TOKEN=first deploy"], second: ["TOKEN=second deploy"], same: false },
  { name: "pattern order", first: ["a", "b"], second: ["b", "a"], same: false },
  { name: "identical requests", first: ["a", "b"], second: ["a", "b"], same: true },
])("permission match identity preserves $name", async ({ first, second, same }) => {
  const s = fakeServer({ hang: true }); const h = privateIo();
  const calls: Parameters<DriverHostIo["approval"]>[0][] = [];
  try {
    const task = await createOpenCodeSessionDriver().startTask(input(), { ...h.io, spawn: async () => s.child, approval: async req => { calls.push(req); return { decision: "deny" }; } });
    for (const [index, patterns] of [first, second].entries()) {
      s.event("permission.asked", { id: `identity-${index}`, sessionID: "ses_native", permission: "bash", patterns });
      await waitForRequest(s, `/permission/identity-${index}/reply`);
    }
    // Inspect the transient host boundary without printing the unredacted identity on failure.
    expect(calls.every((req, index) => req.identity === JSON.stringify({ permission: "bash", patterns: [first, second][index] }))).toBe(true);
    expect(calls[0]?.identity === calls[1]?.identity).toBe(same);
    expect(calls.every(req => req.exactKey !== undefined && req.exactKey.length <= 4096)).toBe(true);
    expect(JSON.stringify(h.events).includes('"identity":')).toBe(false);
    expect(JSON.stringify(s.requests).includes('"identity":')).toBe(false);
    await task.close();
  } finally { await s.stop(); }
});

const identityOverhead = JSON.stringify({ permission: "bash", patterns: [""] }).length;
test.each([
  { name: "absent patterns", patterns: undefined, included: false },
  { name: "empty patterns", patterns: [], included: false },
  { name: "exactly 16 KiB", patterns: ["x".repeat(16 * 1024 - identityOverhead)], included: true },
  { name: "over 16 KiB", patterns: ["x".repeat(16 * 1024 - identityOverhead + 1)], included: false },
  { name: "multibyte over 16 KiB", patterns: ["界".repeat(6000)], included: false },
])("permission identity bounds handle $name", async ({ patterns, included }) => {
  const s = fakeServer({ hang: true }); const h = privateIo();
  const calls: Parameters<DriverHostIo["approval"]>[0][] = [];
  try {
    const task = await createOpenCodeSessionDriver().startTask(input(), { ...h.io, spawn: async () => s.child, approval: async req => { calls.push(req); return { decision: "deny" }; } });
    s.event("permission.asked", { id: "bounded", sessionID: "ses_native", permission: "bash", patterns });
    await waitForRequest(s, "/permission/bounded/reply");
    expect(calls).toHaveLength(1);
    expect(Object.hasOwn(calls[0]!, "identity")).toBe(included);
    if (included) expect(Buffer.byteLength(calls[0]!.identity!) <= 16 * 1024).toBe(true);
    if (patterns?.length) expect(calls[0]?.exactKey?.length).toBe(4096);
    else expect(calls[0]?.exactKey).toBeUndefined();
    await task.close();
  } finally { await s.stop(); }
});

 test('native personal connection failures do not expose credential-bearing diagnostics',async()=>{
  const s=fakeServer({personal:true}),h=privateIo();try{const task=await createOpenCodeSessionDriver().startTask(input(),{...h.io,spawn:async()=>s.child});expect((await task.done).status).toBe('completed');expect(h.events).toContainEqual({kind:'diagnostic',data:{code:'personal-mcp.runtime',active:[],unavailable:['personal']}});expect(JSON.stringify(h.events)).not.toContain('PRIVATE_FAILURE_SENTINEL');await task.close();}finally{await s.stop();}
 });


test('native compiled permission order and expanded paths survive relay constraints without widening denies',async()=>{
 const nativePermissions=[{permission:'*',pattern:'*',action:'deny'},{permission:'read',pattern:'*',action:'allow'},{permission:'bash',pattern:'/native/home/private/*',action:'deny'},{permission:'bash',pattern:'ls *',action:'allow'}];
 const s=fakeServer({nativePermissions}),h=privateIo();try{const task=await createOpenCodeSessionDriver().startTask(input(),{...h.io,spawn:async()=>s.child});await task.done;const rules=s.requests.find(r=>r.path==='/session')!.body.permission;expect(rules).toEqual([{permission:'*',pattern:'*',action:'ask'},...nativePermissions.map(rule=>({...rule,action:rule.action==='allow'?'ask':rule.action})),{permission:'task',pattern:'*',action:'deny'}]);await task.close();}finally{await s.stop();}
});

test.each(['lead','architect','investigate','quality','setup','apply-fast','apply-deep'])('explicit project trust admits native sources for %s without changing HOME',memberId=>{
 const h=privateIo(),env={HOME:'/user',XDG_CONFIG_HOME:'/user/config'};
 const untrusted=buildOpenCodeLaunch({...input(),memberId,projectConfigTrusted:false},h.io,{baseEnv:env});
 const trusted=buildOpenCodeLaunch({...input(),memberId,projectConfigTrusted:true},h.io,{baseEnv:env});
 expect(untrusted.env.OPENCODE_DISABLE_PROJECT_CONFIG).toBe('true');expect(trusted.env.OPENCODE_DISABLE_PROJECT_CONFIG).toBeUndefined();expect(trusted.env.HOME).toBe('/user');
 expect(buildOpenCodeLaunch({...input(),projectConfigTrusted:true},h.io,{baseEnv:{...env,OPENCODE_DISABLE_PROJECT_CONFIG:'true'}}).env.OPENCODE_DISABLE_PROJECT_CONFIG).toBe('true');
});

test('project-bound explicit config paths cannot bypass consent, while global custom paths remain native',()=>{
 const h=privateIo(),cwd=h.dir,base={HOME:'/user',OPENCODE_CONFIG:'opencode.json'};
 expect(()=>buildOpenCodeLaunch({...input(),cwd},h.io,{baseEnv:base})).toThrow('opencode-project-trust-required');
 expect(()=>buildOpenCodeLaunch({...input(),cwd},h.io,{baseEnv:{HOME:'/user',OPENCODE_CONFIG_DIR:cwd}})).toThrow('opencode-project-trust-required');
 expect(buildOpenCodeLaunch({...input(),cwd,projectConfigTrusted:true},h.io,{baseEnv:base}).env.OPENCODE_CONFIG).toBe('opencode.json');
 expect(buildOpenCodeLaunch({...input(),cwd},h.io,{baseEnv:{HOME:'/user',OPENCODE_CONFIG:'/user/custom.json'}}).env.OPENCODE_CONFIG).toBe('/user/custom.json');
});

test('the untrusted external-skill gate re-admits global roots additively and respects native disable choices',async()=>{
 const {mkdirSync}=await import('node:fs');const {pathToFileURL}=await import('node:url');const h=privateIo(),home=join(h.dir,'home');mkdirSync(join(h.dir,'project','.git'),{recursive:true});for(const name of ['.claude','.agents'])mkdirSync(join(home,name,'skills'),{recursive:true});
 const launch=buildOpenCodeLaunch({...input(),cwd:join(h.dir,'project')},h.io,{baseEnv:{HOME:home}});expect(launch.env.OPENCODE_DISABLE_EXTERNAL_SKILLS).toBe('true');expect(launch.expectedGlobalSkillPaths).toEqual([join(home,'.claude','skills'),join(home,'.agents','skills')]);
 const plugin=await import(pathToFileURL(join(h.dir,'opencode-global-skills.mjs')).href);const config:any={skills:{paths:['/custom'],urls:['https://example.invalid/skills']},permission:{edit:'deny'}};await(await plugin.default()).config(config);expect(config.skills.paths).toEqual([...launch.expectedGlobalSkillPaths,'/custom']);expect(config.skills.urls).toEqual(['https://example.invalid/skills']);expect(config.permission.edit).toBe('deny');
 const disabled=buildOpenCodeLaunch({...input(),cwd:join(h.dir,'project')},h.io,{baseEnv:{HOME:home,OPENCODE_DISABLE_EXTERNAL_SKILLS:'true'}});expect(disabled.expectedGlobalSkillPaths).toEqual([]);expect(disabled.expectedPlugins).toEqual([]);
 const claudeDisabled=buildOpenCodeLaunch({...input(),cwd:join(h.dir,'project')},h.io,{baseEnv:{HOME:home,OPENCODE_DISABLE_CLAUDE_CODE_SKILLS:'1'}});expect(claudeDisabled.expectedGlobalSkillPaths).toEqual([join(home,'.agents','skills')]);
 const trusted=buildOpenCodeLaunch({...input(),cwd:join(h.dir,'project'),projectConfigTrusted:true},h.io,{baseEnv:{HOME:home}});expect(trusted.env.OPENCODE_DISABLE_EXTERNAL_SKILLS).toBeUndefined();expect(trusted.expectedGlobalSkillPaths).toEqual([]);
});

for (const [label, options, capacity] of [
  ['missing catalog', { catalog: { all: [] } }, null],
  ['invalid capacity', { catalog: { all: [{ id: 'p', models: { m: { limit: { context: -1 } } } }] } }, null],
  ['hung catalog never blocks a turn', { hangCatalog: true }, null],
  ['actual model switch uses its own capacity', { nativeModel: 'other' }, 2000],
  ['unlisted model never borrows assignment capacity', { nativeModel: 'unlisted' }, null],
] as const) test(`OpenCode ${label}`, async () => {
  const s = fakeServer({ contextUsage: true, ...options }); const h = privateIo();
  let task;
  try {
    task = await createOpenCodeSessionDriver().startTask(input(), { ...h.io, spawn: async () => s.child });
    await task.done;
    expect(h.events.find(e => e.kind === 'usage')?.data.context).toMatchObject({ tokens: 215, capacity });
    expect(s.requests.filter(r => r.path === '/provider')).toHaveLength(1);
  } finally { await task?.close(); await s.stop(); }
});

test.each([true,false])('OpenCode claim gate prevents the native message POST; allowed=%s',async allowed=>{
  const s=fakeServer(),h=privateIo();let claims=0;
  try{
    const task=await createOpenCodeSessionDriver().startTask(input(),{...h.io,spawn:async()=>s.child,claimInput:()=>{claims++;expect(s.requests.filter(r=>r.path.endsWith('/message'))).toEqual([]);return allowed;}});
    expect((await task.done).status).toBe(allowed?'completed':'interrupted');expect(claims).toBe(1);
    expect(s.requests.filter(r=>r.path.endsWith('/message'))).toHaveLength(allowed?1:0);await task.close();
  }finally{await s.stop();}
});
