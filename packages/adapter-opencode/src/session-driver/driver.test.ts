import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DriverEvent, DriverHostIo, DriverTaskInput, SupervisedChildExit } from "@deck/core/session/driver";
import { createOpenCodeSessionDriver } from "./driver";
import { buildOpenCodeLaunch } from "./launch";
import { OpenCodeSseParser, mapOpenCodeEvent } from "./mapper";

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
const input = (): DriverTaskInput => ({ taskId: "t", memberId: "lead", cwd: "/project", assignment: { runnerId: "opencode", modelId: "opencode/big-pickle", thinking: "high" }, rolePrompt: "role", prompt: "hello", mcp: { servers: ["deck"], sessionTools: [] }, mcpServerSpecs: { deck: { command: "deck", args: ["internal", "session-mcp"], env: { DECK_SESSION_CREDENTIAL_FILE: "/private/credential" } } }, approvals: "relay", credentialFile: "/private/credential", disableNativeDelegation: true });
function privateIo() {
  const dir = mkdtempSync(join(tmpdir(), "deck-oc-driver-")); dirs.push(dir);
  const events: DriverEvent[] = [];
  const io = { writePrivateFile(name: string, content: string) { const path = join(dir, name); writeFileSync(path, content, { mode: 0o600 }); return path; }, emit(e: DriverEvent) { events.push(e); }, approval: async () => ({ decision: "deny" as const }) };
  return { io, events, dir };
}

describe("OpenCode isolated launch", () => {
  test("isolates configuration, keeps data/auth home and protects its loopback server", () => {
    const h = privateIo();
    const launch = buildOpenCodeLaunch(input(), h.io, { baseEnv: { HOME: "/user", XDG_DATA_HOME: "/user/data", XDG_CONFIG_HOME: "/user/config", OPENCODE_CONFIG: "/user/leak.json", OPENCODE_CONFIG_CONTENT: "leak", OPENCODE_SERVER_PASSWORD: "old" } });
    expect(launch.args).toEqual(["serve", "--pure", "--hostname", "127.0.0.1", "--port", "0"]);
    expect(launch.env.HOME).toBe("/user"); expect(launch.env.XDG_DATA_HOME).toBe("/user/data");
    expect(launch.env.XDG_CONFIG_HOME).toBe(h.dir); expect(launch.env.OPENCODE_CONFIG_DIR).toBe(h.dir);
    expect(launch.env.OPENCODE_DISABLE_PROJECT_CONFIG).toBe("true");
    expect(launch.env.OPENCODE_CONFIG).not.toBe("/user/leak.json");
    expect(launch.env.OPENCODE_SERVER_PASSWORD).not.toBe("old");
    expect(launch.args.join(" ")).not.toContain(launch.env.OPENCODE_SERVER_PASSWORD!);
    const cfg = JSON.parse(readFileSync(launch.env.OPENCODE_CONFIG!, "utf8"));
    expect(cfg.mcp).toEqual({ deck: { type: "local", command: ["deck", "internal", "session-mcp"], environment: { DECK_SESSION_CREDENTIAL_FILE: "/private/credential" }, enabled: true } });
    expect(cfg.permission).toEqual({ "*": "ask", task: "deny" }); expect(cfg.plugin).toEqual([]);
  });
  test("refuses missing explicit MCP specs", () => { const h = privateIo(); expect(() => buildOpenCodeLaunch({ ...input(), mcpServerSpecs: {} }, h.io)).toThrow("deck"); });
});

describe("OpenCode SSE", () => {
  test("reassembles arbitrary chunks, CRLF, multiline data and ignores comments", () => {
    const parser = new OpenCodeSseParser();
    expect(parser.push(": heartbeat\r\ndata: {\"type\":\"future\",\r")).toEqual([]);
    expect(parser.push("\ndata: \"properties\":{}}\r\n\r\n")).toEqual([{ type: "future", properties: {} }]);
  });
  test("bounds malformed streams", () => { expect(() => new OpenCodeSseParser(32).push("x".repeat(33))).toThrow("too large"); });
  test("maps text, reasoning and unknown events with raw payload", () => {
    expect(mapOpenCodeEvent({ type: "message.part.delta", properties: { field: "text", delta: "hi" } })[0]).toMatchObject({ kind: "message.delta", data: { text: "hi" } });
    expect(mapOpenCodeEvent({ type: "message.part.updated", properties: { part: { type: "reasoning", text: "thought" } } })[0]?.kind).toBe("reasoning.delta");
    expect(mapOpenCodeEvent({ type: "future", properties: { foo: 1 } })[0]).toMatchObject({ kind: "runner.unmapped", raw: { type: "future" } });
  });
});

function fakeServer(options: { extraMcp?: boolean; hang?: boolean; pending?: boolean; abortError?: boolean; failMessage?: boolean; hangEvent?: boolean; resumeStatus?: number } = {}) {
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  const requests: Array<{ path: string; body: any; auth: string | null }> = [];
  let messages = 0;
  const blocked: Array<(r: Response) => void> = [];
  const event = (type: string, properties: Record<string, unknown>) => stream?.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ type, properties })}\n\n`));
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, idleTimeout: 0, async fetch(req) {
    const path = new URL(req.url).pathname; const body = req.method === "POST" ? await req.json().catch(() => ({})) : undefined;
    requests.push({ path, body, auth: req.headers.get("authorization") });
    if (path === "/event" && options.hangEvent) return new Promise<Response>(resolve => { blocked.push(resolve); });
    if (path === "/event") return new Response(new ReadableStream({ start(c) { stream = c; c.enqueue(new TextEncoder().encode('data: {"type":"server.connected","properties":{}}\n\n')); }, cancel() {} }), { headers: { "content-type": "text/event-stream" } });
    if (path === "/mcp") return Response.json({ deck: { status: "connected" }, ...(options.extraMcp ? { unwanted: { status: "connected" } } : {}) });
    if (path === "/session") return Response.json({ id: "ses_native" });
    if (path === "/session/ses_native") return Response.json({ id: "ses_native" }, { status: options.resumeStatus ?? 200 });
    if (path === "/permission") return Response.json(options.pending ? [{ id: "perm1", sessionID: "ses_native", permission: "bash", patterns: ["echo hello"] }] : []);
    if (path.endsWith("/reply")) return Response.json(true);
    if (path.endsWith("/abort")) { if (options.abortError) event("session.error", { sessionID: "ses_native", error: { name: "MessageAbortedError" } }); else if (!options.hang) event("session.idle", { sessionID: "ses_native" }); return Response.json(true); }
    if (path.endsWith("/message")) { messages++; if (options.hang || options.abortError) return new Promise<Response>(resolve => { blocked.push(resolve); }); event("message.part.delta", { sessionID: "ses_native", field: "text", delta: "OK" }); return Response.json({ info: { id: `msg${messages}`, ...(options.failMessage ? { error: { name: "APIError" } } : {}) }, parts: [{ type: "text", text: "OK" }] }); }
    return Response.json({ healthy: true });
  } });
  let finish!: (exit: SupervisedChildExit) => void; let stdout!: (chunk: string) => void;
  let terminated = 0;
  const exited = new Promise<SupervisedChildExit>(r => { finish = r; });
  const child = { ready: Promise.resolve({ workerPid: 123 }), exited, onStdout(fn: (c: string) => void) { stdout = fn; queueMicrotask(() => stdout(`opencode server listening on http://127.0.0.1:${server.port}\n`)); }, onStderr() {}, writeStdin() {}, endStdin() {}, interrupt() { return true; }, async terminateGroup() { terminated++; finish({ ok: false, code: null, signal: "SIGTERM", drained: true, anchorLost: false }); } };
  return { requests, child, event, completeMessages() { for (const resolve of blocked.splice(0)) resolve(Response.json({ info: { id: "completed" }, parts: [] })); }, disconnect() { stream.close(); }, get terminated() { return terminated; }, async stop() { for (const resolve of blocked) resolve(Response.json({ info: { id: "stopped" }, parts: [] })); await server.stop(true); } };
}

describe("OpenCode driver production HTTP contract", () => {
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
      const io: DriverHostIo = { ...h.io, approval: async r => { approvals.push(r.approvalId); return { decision: "deny" }; }, spawn: async (_cmd, args) => { expect(args).toContain("--pure"); return s.child; } };
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
  test("fails closed when an inherited MCP appears", async () => {
    const s = fakeServer({ extraMcp: true }); const h = privateIo();
    try { await expect(createOpenCodeSessionDriver().startTask(input(), { ...h.io, spawn: async () => s.child })).rejects.toThrow("isolation"); expect(s.terminated).toBe(1); expect(s.requests.some(r => r.path.endsWith("/message"))).toBe(false); } finally { await s.stop(); }
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
    try { const task = await createOpenCodeSessionDriver().startTask(input(), { ...h.io, spawn: async () => s.child }); s.disconnect(); expect((await task.done).status).toBe("failed"); await task.close(); expect(s.terminated).toBe(1); } finally { await s.stop(); }
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
  expect(await adapter.readSessionMcpServers?.()).toEqual({ "context-mode": { command: "context-mode", args: ["--mcp"], env: {} } });
});

test("HTTP Context7 uses the native remote transport and configured authentication is refused", async () => {
  const { createOpenCodeRunnerAdapter } = await import("../runner-adapter");
  const h = privateIo();
  writeFileSync(join(h.dir, "opencode.json"), JSON.stringify({ mcp: { context7: { type: "remote", url: "https://mcp.context7.com/mcp", enabled: true } } }));
  const adapter = createOpenCodeRunnerAdapter({ developerTeamConfigDir: h.dir });
  const servers = await adapter.readSessionMcpServers?.();
  expect(servers).toEqual({ context7: { transport: "http", url: "https://mcp.context7.com/mcp" } });
  const launch = buildOpenCodeLaunch({ ...input(), mcp: { servers: ["context7"], sessionTools: [] }, mcpServerSpecs: servers! }, h.io);
  expect(JSON.parse(readFileSync(launch.env.OPENCODE_CONFIG!, "utf8")).mcp).toEqual({ context7: { type: "remote", url: "https://mcp.context7.com/mcp", enabled: true } });
  writeFileSync(join(h.dir, "opencode.json"), JSON.stringify({ mcp: { context7: { type: "remote", url: "https://mcp.context7.com/mcp", headers: { Authorization: "Bearer sensitive" } } } }));
  await expect(adapter.readSessionMcpServers?.()).rejects.toThrow("authentication");
});

test("HTTP header auth uses native environment references, never resolved values", () => {
  const h = privateIo();
  const original = input();
  const launch = buildOpenCodeLaunch({ ...original, mcp: { ...original.mcp, servers: [...original.mcp.servers, "context7"] },
    mcpServerSpecs: { ...original.mcpServerSpecs, context7: { transport: "http", url: "https://mcp.context7.com/mcp", envHttpHeaders: { "X-Context7-API-Key": "CONTEXT7_API_KEY" } } } }, h.io, { baseEnv: {} });
  expect(JSON.parse(readFileSync(launch.env.OPENCODE_CONFIG!, "utf8")).mcp.context7).toEqual({ type: "remote", url: "https://mcp.context7.com/mcp", enabled: true, oauth: false, headers: { "X-Context7-API-Key": "{env:CONTEXT7_API_KEY}" } });
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
  let release!: (decision: { decision: "allow" }) => void;
  let requested!: () => void;
  const requestSeen = new Promise<void>(resolve => { requested = resolve; });
  try {
    const task = await createOpenCodeSessionDriver({ escalationMs: 1000 }).startTask(input(), { ...h.io, spawn: async () => s.child, approval: () => { requested(); return new Promise(resolve => { release = resolve; }); } });
    s.event("permission.asked", { id: "late", sessionID: "ses_native", permission: "bash" });
    await requestSeen;
    if (terminal === "interrupted") { await task.interrupt(); s.event("session.idle", { sessionID: "ses_native" }); }
    else s.completeMessages();
    expect((await task.done).status).toBe(terminal);
    const followup = task.send("followup");
    release({ decision: "allow" });
    for (let i = 0; i < 30 && !s.requests.some(r => r.path === "/permission/late/reply"); i++) await new Promise(resolve => setTimeout(resolve, 1));
    expect(s.requests.find(r => r.path === "/permission/late/reply")?.body).toEqual({ reply: "reject" });
    await task.close(); await followup;
  } finally { await s.stop(); }
});
