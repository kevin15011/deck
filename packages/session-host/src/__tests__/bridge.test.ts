import { afterEach, describe, expect, test, spyOn } from "bun:test";
import { chmodSync, existsSync, lstatSync, readFileSync, unlinkSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { QuestionBroker } from "../question-broker";
import { ApprovalBroker } from "../approval-broker";
import { sessionMcpServerSpec, DECK_APPROVE_TOOL, DECK_STATUS_TOOL, DEFAULT_ALLOWED_TOOLS } from "../bridge-config";
import { BridgeService, type BridgeServiceOptions } from "../bridge-service";
import { ControlServer } from "../control-server";
import { CredentialRegistry } from "../credentials";
import { runSessionMcpBridge } from "../mcp-bridge";
import { StubSessionService } from "../testing/stub-service";
import { FakeClock, cleanupTempDirs, sleep, tempDir, waitFor } from "./test-helpers";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) { try { await fn(); } catch { /* best effort */ } }
  cleanupTempDirs();
});

const GRANT = { sessionId: "s-1", taskId: "lead", memberId: "lead", runnerId: "claude", allowedTools: DEFAULT_ALLOWED_TOOLS } as const;

async function harness(options: { grantTools?: readonly string[]; questions?: boolean; callTaskTool?: BridgeServiceOptions["callTaskTool"] } = {}) {
  const dir = tempDir();
  const clock = new FakeClock();
  const service = new StubSessionService(join(dir, "sessions"));
  const log = service.addSession("s-1");
  const socketPath = join(dir, "d.sock");
  const broker = new ApprovalBroker({ sink: { emit: (sid, draft) => { service.logs.get(sid)?.append(draft); } }, clock });
  const credentials = new CredentialRegistry({ socketPath });
  const questionBroker = options.questions ? new QuestionBroker({ sink: { emit: (sid, draft) => { service.logs.get(sid)?.append(draft); } } }) : undefined;
  if (questionBroker) cleanups.push(() => questionBroker.dispose());
  const bridge = new BridgeService({ credentials, broker, questionBroker, callTaskTool: options.callTaskTool, status: (g) => ({ sessionId: g.sessionId, taskId: g.taskId, state: "running" }) });
  const server = new ControlServer({
    socketPath, service, bridge,
    daemon: { version: "1", pid: process.pid, nonce: "n", status: () => ({}), requestRestart: () => ({ ok: true as const }) },
  });
  await server.listen();
  cleanups.push(() => server.close(), () => service.close(), () => broker.dispose());
  const credFile = join(dir, "credential");
  const { token } = credentials.issue({ ...GRANT, allowedTools: options.grantTools ?? GRANT.allowedTools }, credFile);
  return { dir, clock, service, log, socketPath, broker, questionBroker, credentials, bridge, server, credFile, token };
}

/** Drives runSessionMcpBridge over in-memory streams. */
function mcpSession(env: Record<string, string | undefined>) {
  const input = new PassThrough();
  const out: Array<Record<string, unknown>> = [];
  let buffer = "";
  const done = runSessionMcpBridge({ input, write: (line) => { buffer += line; let i; while ((i = buffer.indexOf("\n")) !== -1) { out.push(JSON.parse(buffer.slice(0, i))); buffer = buffer.slice(i + 1); } }, env, version: "9.9.9" });
  const send = (message: Record<string, unknown>) => input.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
  const reply = async (id: number) => { await waitFor(() => out.some((m) => m.id === id), 5000, `reply ${id}`); return out.find((m) => m.id === id)!; };
  return { send, reply, out, end: () => input.end(), done };
}
const text = (reply: Record<string, unknown>) => ((reply.result as { content: Array<{ text: string }> }).content[0]!.text);

describe("CredentialRegistry (D-11, XR-4.7)", () => {
  test("issues an opaque token in a 0600 file together with the socket path", () => {
    const dir = tempDir();
    const reg = new CredentialRegistry({ socketPath: "/run/x.sock" });
    const { token } = reg.issue(GRANT, join(dir, "cred"));
    const file = JSON.parse(readFileSync(join(dir, "cred"), "utf8"));
    expect(file).toEqual({ v: 1, token, socketPath: "/run/x.sock", allowedTools: [...GRANT.allowedTools] });
    expect(token.length).toBeGreaterThanOrEqual(43);
    expect(lstatSync(join(dir, "cred")).mode & 0o777).toBe(0o600);
    expect(reg.lookup(token)).toMatchObject({ sessionId: "s-1", taskId: "lead", memberId: "lead" });
    expect(reg.lookup(token + "x")).toBeUndefined();
    expect(reg.lookup("")).toBeUndefined();
  });

  test("tokens are unique and revoke deletes the file and the grant", () => {
    const dir = tempDir();
    const reg = new CredentialRegistry({ socketPath: "/s" });
    const a = reg.issue(GRANT, join(dir, "a")), b = reg.issue({ ...GRANT, taskId: "t2" }, join(dir, "b"));
    expect(a.token).not.toBe(b.token);
    reg.revoke(a.token);
    expect(reg.lookup(a.token)).toBeUndefined();
    expect(existsSync(join(dir, "a"))).toBe(false);
    expect(reg.revokeTask(GRANT.sessionId, "t2")).toBe(1);
    expect(reg.lookup(b.token)).toBeUndefined();
    expect(existsSync(join(dir, "b"))).toBe(false);
  });

  test("the registry never retains the raw token", () => {
    const reg = new CredentialRegistry({ socketPath: "/s" });
    const { token } = reg.issue(GRANT, join(tempDir(), "c"));
    expect(JSON.stringify([...(reg as unknown as { grants: Map<string, unknown> }).grants.keys()])).not.toContain(token);
  });
});

describe("BridgeService (daemon side of deck_approve / deck_status)", () => {
  test("deck_status returns the task view for the credential's own grant", async () => {
    const h = await harness();
    expect(await h.bridge.call({ token: h.token, tool: DECK_STATUS_TOOL })).toEqual({ ok: true, data: { sessionId: "s-1", taskId: "lead", state: "running" } });
  });

  test("deck_approve blocks until a client answers, then returns the Claude permission-prompt shape", async () => {
    const h = await harness();
    const call = h.bridge.call({ token: h.token, tool: DECK_APPROVE_TOOL, arguments: { tool_name: "Bash", input: { command: "ls" }, tool_use_id: "tu1" } });
    await waitFor(() => h.broker.pending().length === 1, 2000, "pending approval");
    const requested = [...h.log.readAfter(0)].find((e) => e.kind === "approval.requested")!;
    expect(requested.data).toMatchObject({ taskId: "lead", tool: "Bash", input: { command: "ls" } });
    expect(requested.source).toMatchObject({ taskId: "lead", memberId: "lead", runnerId: "claude" });
    h.broker.respond({ approvalId: h.broker.pending()[0]!.approvalId, decision: "allow", by: "device-1" });
    expect(await call).toEqual({ ok: true, data: { behavior: "allow", updatedInput: { command: "ls" } } });
  });

  test("a denied approval returns behavior deny with a message", async () => {
    const h = await harness();
    const call = h.bridge.call({ token: h.token, tool: DECK_APPROVE_TOOL, arguments: { tool_name: "Edit", input: {} } });
    await waitFor(() => h.broker.pending().length === 1, 2000, "pending");
    h.broker.respond({ approvalId: h.broker.pending()[0]!.approvalId, decision: "deny", by: "device-1" });
    const out = await call;
    expect(out).toMatchObject({ ok: true, data: { behavior: "deny" } });
    expect(JSON.stringify(out)).toContain("device-1");
  });

  test("an unknown or revoked credential gets credential-revoked", async () => {
    const h = await harness();
    expect(await h.bridge.call({ token: "nope", tool: DECK_STATUS_TOOL })).toMatchObject({ ok: false, code: "credential-revoked" });
    h.credentials.revoke(h.token);
    expect(await h.bridge.call({ token: h.token, tool: DECK_STATUS_TOOL })).toMatchObject({ ok: false, code: "credential-revoked" });
  });

  test("a tool outside the grant is refused (only approve + status exist in S1a)", async () => {
    const h = await harness({ grantTools: [DECK_STATUS_TOOL] });
    expect(await h.bridge.call({ token: h.token, tool: DECK_APPROVE_TOOL, arguments: { tool_name: "Bash", input: {} } })).toMatchObject({ ok: false, code: "tool-not-allowed" });
    expect(await h.bridge.call({ token: h.token, tool: "deck_delegate", arguments: {} })).toMatchObject({ ok: false, code: "tool-not-allowed" });
    const open = await harness();
    expect(await open.bridge.call({ token: open.token, tool: "deck_delegate" })).toMatchObject({ ok: false, code: "tool-not-allowed" });
  });

  test("invalid approve arguments are rejected before a request is created", async () => {
    const h = await harness();
    expect(await h.bridge.call({ token: h.token, tool: DECK_APPROVE_TOOL, arguments: { input: {} } })).toMatchObject({ ok: false, code: "invalid-arguments" });
    expect(await h.bridge.call({ token: h.token, tool: DECK_APPROVE_TOOL, arguments: "x" })).toMatchObject({ ok: false, code: "invalid-arguments" });
    expect(h.broker.pending()).toEqual([]);
  });

  test("aborting the call (bridge disconnected) denies the pending approval", async () => {
    const h = await harness();
    const ac = new AbortController();
    const call = h.bridge.call({ token: h.token, tool: DECK_APPROVE_TOOL, arguments: { tool_name: "Bash", input: {} } }, { signal: ac.signal });
    await waitFor(() => h.broker.pending().length === 1, 2000, "pending");
    ac.abort();
    expect(await call).toMatchObject({ ok: true, data: { behavior: "deny" } });
    expect(h.broker.pending()).toEqual([]);
    const resolved = [...h.log.readAfter(0)].find((e) => e.kind === "approval.resolved")!;
    expect(resolved.data).toMatchObject({ decision: "deny", by: "bridge-disconnected" });
  });
});

describe("MCP stdio bridge (D-11, XR-4.7)", () => {
  test("Lead task list is advertised and forwarded over MCP; non-lead and ungranted callers are denied", async () => {
    const calls: string[] = [];
    const h = await harness({ grantTools: ["deck_task_list"], callTaskTool: async (_grant, name) => {
      calls.push(name); return { ok: true, data: { tasks: [{ taskId: "task-1", memberId: "quality", continuable: true }] } };
    } });
    const s = mcpSession({ DECK_SESSION_CREDENTIAL_FILE: h.credFile });
    try {
      s.send({ id: 1, method: "tools/list" });
      expect((await s.reply(1)).result).toMatchObject({ tools: [{ name: "deck_task_list", inputSchema: { type: "object" } }] });
      s.send({ id: 2, method: "tools/call", params: { name: "deck_task_list", arguments: {} } });
      expect(JSON.parse(text(await s.reply(2)))).toEqual({ tasks: [{ taskId: "task-1", memberId: "quality", continuable: true }] });
      const member = h.credentials.issue({ ...GRANT, memberId: "quality", allowedTools: ["deck_task_list"] }, join(h.dir, "member-credential"));
      expect(await h.bridge.call({ token: member.token, tool: "deck_task_list", arguments: {} })).toMatchObject({ ok: false, code: "tool-not-allowed" });
      const ungranted = h.credentials.issue({ ...GRANT, allowedTools: DEFAULT_ALLOWED_TOOLS }, join(h.dir, "ungranted-credential"));
      expect(await h.bridge.call({ token: ungranted.token, tool: "deck_task_list", arguments: {} })).toMatchObject({ ok: false, code: "tool-not-allowed" });
      expect(calls).toEqual(["deck_task_list"]);
    } finally { s.end(); await s.done; }
  });

  test("role credential lists memory tools while hiding ungranted delegation tools", async () => {
    const h = await harness({ grantTools: ["deck_memory_recall", "deck_memory_propose", "deck_approve"] });
    const s = mcpSession({ DECK_SESSION_CREDENTIAL_FILE: h.credFile });
    s.send({ id: 1, method: "tools/list" });
    const tools = ((await s.reply(1)).result as { tools: Array<{ name: string }> }).tools;
    expect(tools.map((tool) => tool.name).sort()).toEqual(["deck_approve", "deck_memory_propose", "deck_memory_recall"]);
    s.end(); await s.done;
  });
  test("initialize, ping, tools/list and unknown methods follow JSON-RPC/MCP framing", async () => {
    const h = await harness();
    const s = mcpSession({ DECK_SESSION_CREDENTIAL_FILE: h.credFile });
    s.send({ id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } });
    expect((await s.reply(1)).result).toMatchObject({ protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "deck", version: "9.9.9" } });
    s.send({ method: "notifications/initialized" });
    s.send({ id: 2, method: "ping" });
    expect((await s.reply(2)).result).toEqual({});
    s.send({ id: 3, method: "tools/list" });
    const tools = ((await s.reply(3)).result as { tools: Array<{ name: string; inputSchema: { required?: string[] } }> }).tools;
    expect(tools.map((t) => t.name).sort()).toEqual(["deck_approve", "deck_status"]);
    expect(tools.find((t) => t.name === "deck_approve")!.inputSchema.required).toEqual(["tool_name", "input"]);
    s.send({ id: 4, method: "resources/list" });
    expect((await s.reply(4)).error).toMatchObject({ code: -32601 });
    s.end();
    await s.done;
    expect(s.out.some((m) => m.id === undefined && "result" in m)).toBe(false); // notifications get no reply
  });

  test("a non-JSON line yields a parse error and the session continues", async () => {
    const h = await harness();
    const input = new PassThrough();
    const out: string[] = [];
    const done = runSessionMcpBridge({ input, write: (l) => { out.push(l); }, env: { DECK_SESSION_CREDENTIAL_FILE: h.credFile }, version: "1" });
    input.write("{nope\n");
    input.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }) + "\n");
    await waitFor(() => out.length === 2, 3000, "two replies");
    expect(JSON.parse(out[0]!)).toMatchObject({ id: null, error: { code: -32700 } });
    expect(JSON.parse(out[1]!)).toMatchObject({ id: 1, result: {} });
    input.end();
    await done;
  });

  test("deck_status works end to end through the daemon socket", async () => {
    const h = await harness();
    const s = mcpSession({ DECK_SESSION_CREDENTIAL_FILE: h.credFile });
    s.send({ id: 1, method: "tools/call", params: { name: "deck_status", arguments: {} } });
    const r = await s.reply(1);
    expect(JSON.parse(text(r))).toMatchObject({ sessionId: "s-1", taskId: "lead" });
    expect((r.result as { isError?: boolean }).isError).toBeFalsy();
    s.end();
    await s.done;
  });

  test("deck_approve blocks until the user answers and returns {behavior, updatedInput}; other calls are not blocked meanwhile", async () => {
    const h = await harness();
    const s = mcpSession({ DECK_SESSION_CREDENTIAL_FILE: h.credFile });
    s.send({ id: 1, method: "tools/call", params: { name: "deck_approve", arguments: { tool_name: "Bash", input: { command: "git status" }, tool_use_id: "tu-9" } } });
    await waitFor(() => h.broker.pending().length === 1, 3000, "approval requested");
    s.send({ id: 2, method: "ping" });
    expect((await s.reply(2)).result).toEqual({});
    expect(s.out.some((m) => m.id === 1)).toBe(false);
    h.broker.respond({ approvalId: h.broker.pending()[0]!.approvalId, decision: "allow", by: "web" });
    const r = await s.reply(1);
    expect(JSON.parse(text(r))).toEqual({ behavior: "allow", updatedInput: { command: "git status" } });
    s.end();
    await s.done;
  });

  test("when the child closes stdin mid-approval the daemon denies the orphaned request", async () => {
    const h = await harness();
    const s = mcpSession({ DECK_SESSION_CREDENTIAL_FILE: h.credFile });
    s.send({ id: 1, method: "tools/call", params: { name: "deck_approve", arguments: { tool_name: "Bash", input: { command: "sleep 9" } } } });
    await waitFor(() => h.broker.pending().length === 1, 3000, "approval requested");
    s.end();
    await s.done;
    await waitFor(() => h.broker.pending().length === 0, 3000, "orphaned approval denied");
    const resolved = [...h.log.readAfter(0)].find((e) => e.kind === "approval.resolved")!;
    expect(resolved.data).toMatchObject({ decision: "deny", by: "bridge-disconnected" });
  });

  test("a revoked credential becomes a tool error, never a crash", async () => {
    const h = await harness();
    const s = mcpSession({ DECK_SESSION_CREDENTIAL_FILE: h.credFile });
    h.credentials.revoke(h.token);
    // the file is gone too: both server-side and file-side revocation surface as tool errors
    s.send({ id: 1, method: "tools/call", params: { name: "deck_status", arguments: {} } });
    const r = await s.reply(1);
    expect((r.result as { isError: boolean }).isError).toBe(true);
    expect(text(r)).toMatch(/credential/i);
    s.end();
    await s.done;
  });

  test("server-side revocation with the file still present is credential-revoked", async () => {
    const h = await harness();
    const keep = readFileSync(h.credFile, "utf8");
    h.credentials.revoke(h.token);
    require("node:fs").writeFileSync(h.credFile, keep, { mode: 0o600 });
    const s = mcpSession({ DECK_SESSION_CREDENTIAL_FILE: h.credFile });
    s.send({ id: 1, method: "tools/call", params: { name: "deck_status", arguments: {} } });
    const r = await s.reply(1);
    expect((r.result as { isError: boolean }).isError).toBe(true);
    expect(text(r)).toContain("credential-revoked");
    s.end();
    await s.done;
  });

  test("missing env, insecure credential file, and an unreachable daemon each yield a clear tool error", async () => {
    const h = await harness();
    const cases: Array<[Record<string, string | undefined>, RegExp, () => void]> = [
      [{}, /credential-unavailable/, () => {}],
      [{ DECK_SESSION_CREDENTIAL_FILE: h.credFile }, /credential-insecure/, () => chmodSync(h.credFile, 0o644)],
    ];
    for (const [env, pattern, prepare] of cases) {
      prepare();
      const s = mcpSession(env);
      s.send({ id: 1, method: "tools/call", params: { name: "deck_status", arguments: {} } });
      const r = await s.reply(1);
      expect((r.result as { isError: boolean }).isError).toBe(true);
      expect(text(r)).toMatch(pattern);
      s.end();
      await s.done;
    }
    chmodSync(h.credFile, 0o600);
    await h.server.close();
    const s = mcpSession({ DECK_SESSION_CREDENTIAL_FILE: h.credFile });
    s.send({ id: 1, method: "tools/call", params: { name: "deck_status", arguments: {} } });
    const r = await s.reply(1);
    expect((r.result as { isError: boolean }).isError).toBe(true);
    expect(text(r)).toContain("daemon-unreachable");
    s.end();
    await s.done;
  });

  test("an unknown tool and bad arguments are tool errors", async () => {
    const h = await harness();
    const s = mcpSession({ DECK_SESSION_CREDENTIAL_FILE: h.credFile });
    s.send({ id: 1, method: "tools/call", params: { name: "deck_delegate", arguments: {} } });
    s.send({ id: 2, method: "tools/call", params: { name: "deck_approve", arguments: { nope: 1 } } });
    expect((await s.reply(1)).result).toMatchObject({ isError: true });
    expect((await s.reply(2)).result).toMatchObject({ isError: true });
    s.end();
    await s.done;
  });

  test("the bridge never echoes the credential token", async () => {
    const h = await harness();
    const s = mcpSession({ DECK_SESSION_CREDENTIAL_FILE: h.credFile });
    s.send({ id: 1, method: "tools/call", params: { name: "deck_status", arguments: {} } });
    await s.reply(1);
    expect(JSON.stringify(s.out)).not.toContain(h.token);
    s.end();
    await s.done;
  });
});

describe("session MCP server spec: secrets by file path only (XR-4.7)", () => {
  test("argv and env carry the credential FILE path, never the token", async () => {
    const h = await harness();
    const spec = sessionMcpServerSpec({ command: ["/usr/local/bin/deck", "internal", "session-mcp"], credentialFile: h.credFile });
    expect(spec).toEqual({ command: "/usr/local/bin/deck", args: ["internal", "session-mcp"], env: { DECK_SESSION_CREDENTIAL_FILE: h.credFile } });
    expect(JSON.stringify(spec)).not.toContain(h.token);
    expect(JSON.stringify(spec)).not.toContain(h.socketPath);
  });

  test("a real bridge process started from the spec speaks MCP over stdio and the token is not in its argv", async () => {
    const h = await harness();
    const entry = join(import.meta.dir, "fixtures", "bridge-entry.ts");
    const spec = sessionMcpServerSpec({ command: [process.execPath, "run", entry], credentialFile: h.credFile });
    const child = spawn(spec.command, spec.args, { env: { ...process.env, ...spec.env }, stdio: ["pipe", "pipe", "inherit"] });
    cleanups.push(() => { child.kill("SIGKILL"); });
    expect(child.spawnargs.join(" ")).not.toContain(h.token);
    const psArgs = Bun.spawnSync(["ps", "-o", "args=", "-p", String(child.pid)]).stdout.toString();
    expect(psArgs).not.toContain(h.token);
    let out = "";
    child.stdout!.on("data", (d: Buffer) => { out += d.toString(); });
    child.stdin!.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } }) + "\n");
    child.stdin!.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "deck_status", arguments: {} } }) + "\n");
    await waitFor(() => out.split("\n").filter(Boolean).length >= 2, 10000, "two replies from the real bridge");
    const lines = out.split("\n").filter(Boolean).map((l) => JSON.parse(l));
    expect(lines[0].result.serverInfo.name).toBe("deck");
    expect(JSON.parse(lines[1].result.content[0].text)).toMatchObject({ taskId: "lead" });
    expect(out).not.toContain(h.token);
    child.stdin!.end();
    await new Promise<void>((r) => child.once("exit", () => r()));
  });
});


describe("Claude structured questions", () => {
  const question = { question: "Which?", header: "Choice", options: [{ label: "A", description: "First" }, { label: "B" }], multiSelect: false };
  async function setup() {
    const h = await harness();
    const questionBroker = new QuestionBroker({ sink: { emit: (sid, draft) => { h.service.logs.get(sid)?.append(draft); } } });
    cleanups.push(() => questionBroker.dispose());
    const bridge = new BridgeService({ credentials: h.credentials, broker: h.broker, questionBroker, status: () => ({}) });
    const ask = (input: unknown, signal?: AbortSignal) => bridge.call({ token: h.token, tool: DECK_APPROVE_TOOL, arguments: { tool_name: "AskUserQuestion", input } }, { signal });
    return { ...h, questionBroker, ask };
  }
  for (const [name, values, multiple] of [["single", ["A"], false], ["multiple", ["A", "B"], true], ["other text", [" my own answer "], false]] as const) {
    test(`converts ${name} and returns answers keyed by full question text`, async () => {
      const h = await setup();
      const input = { questions: [{ ...question, multiSelect: multiple, secret: true }], extra: "preserved" };
      const call = h.ask(input);
      const pending = h.questionBroker.pending()[0]!;
      expect(pending).toBeDefined();
      const event = [...h.log.readAfter(0)].find(e => e.kind === "question.requested")!;
      expect(event.data).toMatchObject({ questions: [{ id: "q1", prompt: "Which?", header: "Choice", options: question.options, multiple, allowOther: true, secret: false }] });
      expect(h.broker.pending()).toEqual([]);
      expect(h.questionBroker.respond({ questionId: pending.questionId, answers: { q1: [...values] }, by: "web" })).toEqual({ ok: true });
      expect(await call).toEqual({ ok: true, data: { behavior: "allow", updatedInput: { ...input, answers: { "Which?": values.join(", ") } } } });
      expect([...h.log.readAfter(0)].find(e => e.kind === "question.resolved")?.data).toMatchObject({ outcome: "answered", answers: { q1: [...values] } });
    });
  }
  for (const disconnect of [false, true]) {
    test(`question transport arms no timer and survives an arbitrarily long wait then ${disconnect ? "disconnects" : "accepts a late answer"}`, async () => {
      const h = await harness({ questions: true });
      const clock = new FakeClock();
      const nativeTimeout = globalThis.setTimeout;
      const timerSpy = spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => void, ms: number, ...args: unknown[]) =>
        ms >= 960_000 ? clock.setTimeout(fn, ms) : nativeTimeout(fn, ms, ...args)) as typeof setTimeout);
      const s = mcpSession({ DECK_SESSION_CREDENTIAL_FILE: h.credFile });
      try {
        s.send({ id: 1, method: "tools/call", params: { name: DECK_APPROVE_TOOL, arguments: { tool_name: "AskUserQuestion", input: { questions: [question] } } } });
        await waitFor(() => h.questionBroker!.pending().length === 1);
        const transportTimers = timerSpy.mock.calls.filter(([, ms]) => Number(ms) >= 960_000);
        clock.advance(100 * 365 * 24 * 60 * 60 * 1000);
        await sleep(20);
        expect(s.out).toEqual([]);
        expect(transportTimers).toEqual([]);
        expect(h.questionBroker!.pending()).toHaveLength(1);
        if (disconnect) {
          s.end(); await s.done;
          await waitFor(() => h.questionBroker!.pending().length === 0);
        } else {
          h.questionBroker!.respond({ questionId: h.questionBroker!.pending()[0]!.questionId, answers: { q1: ["B"] }, by: "web" });
          expect(JSON.parse(text(await s.reply(1)))).toMatchObject({ behavior: "allow", updatedInput: { answers: { "Which?": "B" } } });
        }
      } finally { timerSpy.mockRestore(); s.end(); await s.done; }
    });
  }
  test("daemon shutdown settles a question and clears the broker request", async () => {
    const h = await harness({ questions: true });
    const s = mcpSession({ DECK_SESSION_CREDENTIAL_FILE: h.credFile });
    try {
      s.send({ id: 1, method: "tools/call", params: { name: DECK_APPROVE_TOOL, arguments: { tool_name: "AskUserQuestion", input: { questions: [question] } } } });
      await waitFor(() => h.questionBroker!.pending().length === 1);
      await h.server.close();
      await waitFor(() => h.questionBroker!.pending().length === 0);
      expect(text(await s.reply(1))).toContain("daemon-unreachable");
    } finally { s.end(); await s.done; }
  });
  test("ordinary approvals retain their transport timeout", async () => {
    const h = await harness();
    const clock = new FakeClock();
    const nativeTimeout = globalThis.setTimeout;
    const timerSpy = spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => void, ms: number, ...args: unknown[]) =>
      ms >= 960_000 ? clock.setTimeout(fn, ms) : nativeTimeout(fn, ms, ...args)) as typeof setTimeout);
    const s = mcpSession({ DECK_SESSION_CREDENTIAL_FILE: h.credFile });
    try {
      s.send({ id: 1, method: "tools/call", params: { name: DECK_APPROVE_TOOL, arguments: { tool_name: "Bash", input: {} } } });
      await waitFor(() => h.broker.pending().length === 1);
      expect(timerSpy.mock.calls.filter(([, ms]) => Number(ms) >= 960_000).map(([, ms]) => ms)).toEqual([960_000]);
      clock.advance(959_999);
      await sleep(20);
      expect(s.out).toEqual([]);
      clock.advance(1);
      expect(text(await s.reply(1))).toContain("daemon-timeout");
    } finally { timerSpy.mockRestore(); s.end(); await s.done; }
  });
  test("duplicate texts use deterministic suffixes without overwriting literal suffixes", async () => {
    const h = await setup();
    const call = h.ask({ questions: [question, question, { ...question, question: "Which? (2)" }] });
    h.questionBroker.respond({ questionId: h.questionBroker.pending()[0]!.questionId, answers: { q1: ["A"], q2: ["B"], q3: ["custom"] }, by: "web" });
    expect(await call).toEqual({ ok: true, data: { behavior: "allow", updatedInput: { questions: [question, { ...question, question: "Which? (3)" }, { ...question, question: "Which? (2)" }], answers: { "Which?": "A", "Which? (3)": "B", "Which? (2)": "custom" } } } });
  });
  for (const outcome of ["dismissed", "cancelled", "abort"] as const) {
    test(`${outcome} denies and clears the pending question`, async () => {
      const h = await setup();
      const ac = new AbortController();
      const call = h.ask({ questions: [question] }, ac.signal);
      const id = h.questionBroker.pending()[0]!.questionId;
      if (outcome === "abort") ac.abort();
      else if (outcome === "dismissed") h.questionBroker.dismiss({ questionId: id, by: "web" });
      else h.questionBroker.cancel(id, "task-ended");
      expect(await call).toEqual({ ok: true, data: { behavior: "deny", message: "The user dismissed the question." } });
      expect(h.questionBroker.pending()).toEqual([]);
      if (outcome === "abort") expect([...h.log.readAfter(0)].at(-1)!.data).toMatchObject({ outcome: "cancelled", by: "bridge-disconnected" });
    });
  }
  test("already aborted calls create no question", async () => {
    const h = await setup();
    expect(await h.ask({ questions: [question] }, AbortSignal.abort())).toMatchObject({ ok: false, code: "aborted" });
    expect(h.questionBroker.pending()).toEqual([]);
  });
  test("without a question broker retains approval behavior", async () => {
    const h = await harness();
    const input = { questions: [question] };
    const call = h.bridge.call({ token: h.token, tool: DECK_APPROVE_TOOL, arguments: { tool_name: "AskUserQuestion", input } });
    h.broker.respond({ approvalId: h.broker.pending()[0]!.approvalId, decision: "allow", by: "web" });
    expect(await call).toEqual({ ok: true, data: { behavior: "allow", updatedInput: input } });
  });
  test("malformed questions fail before either broker is invoked", async () => {
    const h = await setup();
    for (const questions of [undefined, {}, [], Array(9).fill(question), [null], [{ ...question, question: "" }], [{ ...question, options: [{ label: 1 }] }], [{ ...question, header: "h".repeat(121) }]]) {
      expect(await h.ask({ questions })).toMatchObject({ ok: false, code: "invalid-arguments" });
    }
    expect(h.questionBroker.pending()).toEqual([]);
    expect(h.broker.pending()).toEqual([]);
  });
});
