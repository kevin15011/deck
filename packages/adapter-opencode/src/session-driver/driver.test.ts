import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, truncateSync } from "node:fs";
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
    expect(mapOpenCodeEvent({ type: "message.part.delta", properties: { field: "text", delta: "hi" } })[0]?.kind).toBe("runner.unmapped");
    expect(mapOpenCodeEvent({ type: "message.part.updated", properties: { part: { type: "reasoning", text: "thought" } } })[0]?.kind).toBe("reasoning.delta");
    expect(mapOpenCodeEvent({ type: "future", properties: { foo: 1 } })[0]).toMatchObject({ kind: "runner.unmapped", raw: { type: "future" } });
  });
});

function fakeServer(options: { extraMcp?: boolean; hang?: boolean; pending?: boolean; abortError?: boolean; failMessage?: boolean; hangEvent?: boolean; resumeStatus?: number; plugins?: readonly string[]; memoryTool?: boolean } = {}) {
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
    if (path === "/config") return Response.json({ plugin: options.plugins ?? [] });
    if (path === "/experimental/tool/ids") return Response.json(options.memoryTool ? ["bash", "supermemory"] : ["bash"]);
    if (path === "/session") return Response.json({ id: "ses_native" });
    if (path === "/session/ses_native") return Response.json({ id: "ses_native" }, { status: options.resumeStatus ?? 200 });
    if (path === "/permission") return Response.json(options.pending ? [{ id: "perm1", sessionID: "ses_native", permission: "bash", patterns: ["echo hello"] }] : []);
    if (path.endsWith("/reply")) return Response.json(true);
    if (path.endsWith("/abort")) { if (options.abortError) event("session.error", { sessionID: "ses_native", error: { name: "MessageAbortedError" } }); else if (!options.hang) event("session.idle", { sessionID: "ses_native" }); return Response.json(true); }
    if (path.endsWith("/message")) {
      messages++;
      if (options.hang || options.abortError) return new Promise<Response>(resolve => { blocked.push(resolve); });
      event("message.part.updated", { sessionID: "ses_native", part: { id: "text1", messageID: `msg${messages}`, type: "text", text: "" } });
      event("message.part.delta", { sessionID: "ses_native", messageID: `msg${messages}`, partID: "text1", field: "text", delta: "OK" });
      return Response.json({ info: { id: `msg${messages}`, ...(options.failMessage ? { error: { name: "APIError" } } : {}) }, parts: [{ type: "text", text: "OK" }] });
    }
    return Response.json({ healthy: true });
  } });
  let finish!: (exit: SupervisedChildExit) => void; let stdout!: (chunk: string) => void;
  let terminated = 0;
  const exited = new Promise<SupervisedChildExit>(r => { finish = r; });
  const child = { ready: Promise.resolve({ workerPid: 123 }), exited, onStdout(fn: (c: string) => void) { stdout = fn; queueMicrotask(() => stdout(`opencode server listening on http://127.0.0.1:${server.port}\n`)); }, onStderr() {}, writeStdin() {}, endStdin() {}, interrupt() { return true; }, async terminateGroup() { terminated++; finish({ ok: false, code: null, signal: "SIGTERM", drained: true, anchorLost: false }); } };
  return { requests, child, event, completeMessages() { for (const resolve of blocked.splice(0)) resolve(Response.json({ info: { id: "completed" }, parts: [] })); }, disconnect() { stream.close(); }, get terminated() { return terminated; }, async stop() { for (const resolve of blocked) resolve(Response.json({ info: { id: "stopped" }, parts: [] })); await server.stop(true); } };
}

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

test("admits the verified native memory loader while suppressing project and default plugins", () => {
  const h = privateIo();
  const nativeMemory: NonNullable<DriverTaskInput["nativeMemory"]> = { provider: "supermemory", integration: "runner-plugin", status: "ready", projectScope: "sm_project_v1_owner_repo", plugin: { root: "/owned/supermemory", loaderPath: "/owned/supermemory/opencode-supermemory-loader.mjs" } };
  const launch = buildOpenCodeLaunch({ ...input(), nativeMemory }, h.io, { baseEnv: {} });
  expect(launch.args).not.toContain("--pure");
  expect(launch.env.OPENCODE_DISABLE_DEFAULT_PLUGINS).toBe("true");
  expect(JSON.parse(readFileSync(launch.env.OPENCODE_CONFIG!, "utf8")).plugin).toEqual(["file:///owned/supermemory/opencode-supermemory-loader.mjs"]);
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
