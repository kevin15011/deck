import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, lstatSync, mkdirSync, writeFileSync } from "node:fs";
import net from "node:net";
import { join } from "node:path";
import type { SessionEvent } from "@deck/core/session/events";
import { ControlClient } from "../control-client";
import { ControlServer, type ControlServerOptions } from "../control-server";
import type { ServerFrame } from "../protocol";
import { StubSessionService } from "../testing/stub-service";
import { cleanupTempDirs, sleep, tempDir, waitFor } from "./test-helpers";

const uuid = () => crypto.randomUUID();
const quietDaemon = { version: "1", pid: 1, nonce: "n", status: () => ({}), requestRestart: () => ({ ok: true as const }) };
const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) { try { await fn(); } catch { /* best effort */ } }
  cleanupTempDirs();
});

async function boot(extra: Partial<ControlServerOptions> = {}, logOptions: ConstructorParameters<typeof StubSessionService>[1] = {}) {
  const dir = tempDir();
  const service = new StubSessionService(join(dir, "sessions"), logOptions);
  const socketPath = join(dir, "d.sock");
  const status = { ok: true };
  const restarts: string[] = [];
  const server = new ControlServer({
    socketPath, service,
    daemon: { version: "1.2.3", pid: process.pid, nonce: "nonce-1", status: () => status, requestRestart: () => { restarts.push("r"); return service.running ? { ok: false as const, code: "busy" } : { ok: true as const }; } },
    ...extra,
  });
  await server.listen();
  cleanups.push(() => server.close(), () => service.close());
  const connect = async () => { const c = await ControlClient.connect(socketPath); cleanups.push(() => c.close()); return c; };
  return { dir, service, socketPath, server, connect, restarts };
}

describe("socket endpoint (XR-8.1)", () => {
  test("listens on a 0600 socket even under a permissive umask", async () => {
    const previous = process.umask(0);
    try {
      const { socketPath } = await boot();
      expect(lstatSync(socketPath).isSocket()).toBe(true);
      expect(lstatSync(socketPath).mode & 0o777).toBe(0o600);
    } finally { process.umask(previous); }
  });

  test("refuses a socket directory that is not private", async () => {
    const dir = tempDir();
    chmodSync(dir, 0o755);
    const server = new ControlServer({ socketPath: join(dir, "d.sock"), service: new StubSessionService(dir), daemon: quietDaemon });
    await expect(server.listen()).rejects.toThrow(/0700/);
  });

  test("replaces a stale socket file but refuses to hijack a live one or a regular file", async () => {
    const dir = tempDir();
    const socketPath = join(dir, "d.sock");
    const daemon = quietDaemon;
    // stale: a socket inode left behind by a process that died without cleanup
    Bun.spawnSync([process.execPath, "-e", `require("net").createServer().listen(${JSON.stringify(socketPath)}, () => process.kill(process.pid, "SIGKILL"))`]);
    expect(lstatSync(socketPath).isSocket()).toBe(true);
    const first = new ControlServer({ socketPath, service: new StubSessionService(dir), daemon });
    await first.listen();
    // live: second server must not unlink it
    const second = new ControlServer({ socketPath, service: new StubSessionService(dir), daemon });
    await expect(second.listen()).rejects.toThrow(/in use|already/i);
    await first.close();
    expect(existsSync(socketPath)).toBe(false);
    writeFileSync(socketPath, "not a socket");
    const third = new ControlServer({ socketPath, service: new StubSessionService(dir), daemon });
    await expect(third.listen()).rejects.toThrow(/not a socket/i);
  });

  test("close removes the socket and disconnects clients", async () => {
    const { server, connect, socketPath } = await boot();
    const c = await connect();
    await server.close();
    await c.closed;
    expect(existsSync(socketPath)).toBe(false);
  });
});

describe("framing and handshake", () => {
  test("hello returns protocol, daemon version, pid and nonce", async () => {
    const { connect } = await boot();
    const c = await connect();
    expect(await c.hello("9.9.9")).toMatchObject({ t: "hello", protocol: 1, daemonVersion: "1.2.3", pid: process.pid, nonce: "nonce-1" });
  });

  test("bad JSON and unknown frames are reported without closing the connection", async () => {
    const { socketPath } = await boot();
    const raw = net.connect(socketPath);
    cleanups.push(() => { raw.destroy(); });
    const lines: ServerFrame[] = [];
    let buf = "";
    raw.on("data", (d) => { buf += d.toString(); let i; while ((i = buf.indexOf("\n")) !== -1) { lines.push(JSON.parse(buf.slice(0, i))); buf = buf.slice(i + 1); } });
    raw.write("{nope\n");
    raw.write(JSON.stringify({ t: "wat" }) + "\n");
    raw.write(JSON.stringify({ t: "hello", id: "1", clientVersion: "x" }) + "\n");
    await waitFor(() => lines.length === 3, 3000, "three replies");
    expect(lines[0]).toMatchObject({ t: "error", code: "bad-frame" });
    expect(lines[1]).toMatchObject({ t: "error", code: "unknown-frame" });
    expect(lines[2]).toMatchObject({ t: "hello" });
  });

  test("an oversized frame closes the connection", async () => {
    const { socketPath } = await boot({ maxFrameBytes: 1024 });
    const raw = net.connect(socketPath);
    const closed = new Promise<void>((r) => raw.on("close", () => r()));
    raw.on("error", () => {});
    raw.write("x".repeat(5000));
    await closed;
  });

  test("daemon.status and daemon.restart are served; restart is refused while work is running", async () => {
    const { connect, service, restarts } = await boot();
    const c = await connect();
    expect(await c.request({ t: "daemon.status" })).toMatchObject({ t: "daemon.status", status: { ok: true } });
    expect(await c.request({ t: "daemon.restart" })).toMatchObject({ t: "daemon.restart", outcome: { ok: true } });
    service.running = true;
    expect(await c.request({ t: "daemon.restart" })).toMatchObject({ outcome: { ok: false, code: "busy" } });
    expect(restarts).toHaveLength(2);
  });
});

describe("command dispatch and idempotency (XR-1.5)", () => {
  const prompt = (text: string, commandId = uuid()) => ({ v: 1, commandId, type: "prompt.send", text });

  test("an invalid command is rejected with validation errors", async () => {
    const { connect } = await boot();
    const c = await connect();
    const r = await c.command({ v: 1, commandId: "not-a-uuid", type: "prompt.send", text: "x" }, "s-1");
    expect(r.outcome).toMatchObject({ ok: false, code: "invalid-command" });
  });

  test("session.create needs no session id; other commands require one", async () => {
    const { connect } = await boot();
    const c = await connect();
    const created = await c.command({ v: 1, commandId: uuid(), type: "session.create", projectRoot: "/p" });
    expect(created.outcome).toMatchObject({ ok: true, data: { sessionId: "s-1" } });
    expect((await c.command(prompt("hi"))).outcome).toMatchObject({ ok: false, code: "session-required" });
    expect((await c.command(prompt("hi"), "s-1")).outcome).toMatchObject({ ok: true });
  });

  test("a repeated commandId returns the original outcome and runs once (even after reconnect)", async () => {
    const { connect, service } = await boot();
    const c1 = await connect();
    await c1.command({ v: 1, commandId: uuid(), type: "session.create", projectRoot: "/p" });
    const cmd = prompt("hello");
    const first = await c1.command(cmd, "s-1");
    const c2 = await connect();
    const second = await c2.command(cmd, "s-1");
    expect(first.duplicate).toBeUndefined();
    expect(second.duplicate).toBe(true);
    expect(second.outcome).toEqual(first.outcome);
    expect(service.executed.filter((e) => e.command.type === "prompt.send")).toHaveLength(1);
    expect(service.logs.get("s-1")!.lastSeq).toBe(1 + 3); // created + one turn
  });

  test("concurrent duplicates share the in-flight execution", async () => {
    const { connect, service } = await boot();
    const c = await connect();
    await c.command({ v: 1, commandId: uuid(), type: "session.create", projectRoot: "/p" });
    let release!: () => void;
    service.gate = new Promise<void>((r) => { release = r; });
    const cmd = prompt("slow");
    const a = c.command(cmd, "s-1");
    const b = c.command(cmd, "s-1");
    await sleep(50);
    release();
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra.outcome).toEqual(rb.outcome);
    expect(service.executed.filter((e) => e.command.type === "prompt.send")).toHaveLength(1);
  });

  test("the same commandId in another session is a different command", async () => {
    const { connect, service } = await boot();
    const c = await connect();
    await c.command({ v: 1, commandId: uuid(), type: "session.create", projectRoot: "/p" });
    await c.command({ v: 1, commandId: uuid(), type: "session.create", projectRoot: "/p" });
    const cmd = prompt("x");
    await c.command(cmd, "s-1");
    const other = await c.command(cmd, "s-2");
    expect(other.duplicate).toBeUndefined();
    expect(service.executed.filter((e) => e.command.type === "prompt.send")).toHaveLength(2);
  });

  test("a thrown service error is a stable outcome, not a crashed server", async () => {
    const { connect, service } = await boot();
    const c = await connect();
    service.execute = async () => { throw new Error("kaboom"); };
    const cmd = { v: 1, commandId: uuid(), type: "session.create", projectRoot: "/p" };
    const r = await c.command(cmd);
    expect(r.outcome).toMatchObject({ ok: false, code: "internal-error" });
    expect((await c.command(cmd)).duplicate).toBe(true);
  });
});

async function attach(c: ControlClient, sessionId: string, after: number) {
  const events: SessionEvent[] = [];
  const state = { caughtUp: undefined as number | undefined, resync: undefined as string | undefined };
  const outcome = await c.attach(sessionId, after, {
    onEvent: (e) => { events.push(e); },
    onCaughtUp: (seq) => { state.caughtUp = seq; },
    onResync: (reason) => { state.resync = reason; },
  });
  return { events, state, outcome };
}
const contiguous = (events: SessionEvent[], from: number) => events.map((e) => e.seq).every((s, i) => s === from + i);

describe("attach: backlog then live (XR-3.4, XR-3.5)", () => {
  test("replays seq > after, signals caught-up, then streams live events in order", async () => {
    const { connect, service } = await boot();
    const log = service.addSession("s-1");
    for (let i = 0; i < 10; i++) log.append({ kind: "message.delta", data: { text: String(i) } });
    const c = await connect();
    const a = await attach(c, "s-1", 4);
    expect(a.outcome).toMatchObject({ ok: true, data: { lastSeq: 10 } });
    await waitFor(() => a.state.caughtUp !== undefined, 3000, "caught-up");
    expect(a.events.map((e) => e.seq)).toEqual([5, 6, 7, 8, 9, 10]);
    log.append({ kind: "message.delta", data: { text: "live" } });
    await waitFor(() => a.events.length === 7, 3000, "live event");
    expect(a.events.at(-1)!.seq).toBe(11);
  });

  test("attach after=0 on an empty log is caught-up immediately", async () => {
    const { connect, service } = await boot();
    service.addSession("s-1");
    const c = await connect();
    const a = await attach(c, "s-1", 0);
    await waitFor(() => a.state.caughtUp === 0, 3000, "caught-up");
    expect(a.events).toEqual([]);
  });

  test("unknown session and cursor ahead of the log are explicit errors", async () => {
    const { connect, service } = await boot();
    service.addSession("s-1").append({ kind: "usage" });
    const c = await connect();
    expect((await c.attach("nope", 0, { onEvent: () => {} }))).toMatchObject({ ok: false, code: "unknown-session" });
    expect((await c.attach("s-1", 50, { onEvent: () => {} }))).toMatchObject({ ok: false, code: "cursor-ahead" });
  });

  test("reattach at any cursor is gap-free and duplicate-free while events are appended concurrently, across segment rotation", async () => {
    // Large frames + small segments: replay blocks on socket backpressure while the appender keeps going,
    // and later segments are read after live events for them were already queued.
    const { connect, service } = await boot({}, { segmentBytes: 128 * 1024 });
    const log = service.addSession("s-1");
    const payload = "p".repeat(8 * 1024);
    const TOTAL = 900;
    for (let i = 0; i < 300; i++) log.append({ kind: "message.delta", data: { i, payload } });
    let appended = 300;
    const timer = setInterval(() => { for (let k = 0; k < 4 && appended < TOTAL; k++) log.append({ kind: "message.delta", data: { i: appended++, payload } }); }, 1);
    cleanups.push(() => clearInterval(timer));
    const cursors = [0, 7, 150];
    const results: Array<{ after: number; a: Awaited<ReturnType<typeof attach>> }> = [];
    for (const after of cursors) {
      results.push({ after, a: await attach(await connect(), "s-1", after) });
      await sleep(5);
    }
    await waitFor(() => appended >= TOTAL, 15000, "appender done");
    await waitFor(() => results.every((r) => r.a.events.at(-1)?.seq === TOTAL), 20000, "all attachments caught up");
    for (const { after, a } of results) {
      expect(a.state.resync).toBeUndefined();
      expect(contiguous(a.events, after + 1)).toBe(true);
      expect(a.events.at(-1)!.seq).toBe(TOTAL);
    }
    expect(log.diagnostics).toEqual([]);
  });

  test("two clients see the same stream; one disconnecting does not disturb the session (XR-3.4)", async () => {
    const { connect, service } = await boot();
    const log = service.addSession("s-1");
    const c1 = await connect(), c2 = await connect();
    const a1 = await attach(c1, "s-1", 0), a2 = await attach(c2, "s-1", 0);
    log.append({ kind: "usage" });
    await waitFor(() => a1.events.length === 1 && a2.events.length === 1, 3000, "both got 1");
    c1.close();
    await sleep(30);
    log.append({ kind: "usage" });
    await waitFor(() => a2.events.length === 2, 3000, "second client continues");
    expect(service.executed.filter((e) => e.command.type === "session.stop" || e.command.type === "task.cancel")).toEqual([]);
  });

  test("detach stops the stream for that session", async () => {
    const { connect, service } = await boot();
    const log = service.addSession("s-1");
    const c = await connect();
    const a = await attach(c, "s-1", 0);
    log.append({ kind: "usage" });
    await waitFor(() => a.events.length === 1, 3000, "event");
    await c.detach("s-1");
    log.append({ kind: "usage" });
    await sleep(100);
    expect(a.events).toHaveLength(1);
  });

  test("a slow client overflowing its bounded queue is told to resync and can resume from its cursor", async () => {
    const { connect, service, socketPath } = await boot({ maxQueuedEvents: 20 });
    const log = service.addSession("s-1");
    // raw socket we deliberately do not read, so the kernel buffer fills and the queue grows
    const raw = net.connect(socketPath);
    raw.on("error", () => {});
    await new Promise<void>((r) => raw.once("connect", () => r()));
    raw.pause();
    raw.write(JSON.stringify({ t: "command", id: "1", sessionId: "s-1", command: { v: 1, commandId: uuid(), type: "session.attach", after: 0 } }) + "\n");
    await sleep(50);
    const blob = "z".repeat(48 * 1024);
    for (let i = 0; i < 400; i++) log.append({ kind: "message.delta", data: { text: blob } });
    await sleep(100);
    const frames: ServerFrame[] = [];
    let buf = "";
    raw.on("data", (d) => { buf += d.toString(); let i; while ((i = buf.indexOf("\n")) !== -1) { frames.push(JSON.parse(buf.slice(0, i))); buf = buf.slice(i + 1); } });
    const closed = new Promise<void>((r) => raw.on("close", () => r()));
    raw.resume();
    await closed;
    expect(frames.some((f) => f.t === "resync")).toBe(true);
    const seen = frames.filter((f): f is Extract<ServerFrame, { t: "event" }> => f.t === "event").map((f) => f.event.seq);
    expect(contiguous(seen.map((seq) => ({ seq } as SessionEvent)), 1)).toBe(true);
    // reattach with the last cursor: the rest arrives gap-free
    const c = await connect();
    const last = seen.at(-1) ?? 0;
    const a = await attach(c, "s-1", last);
    await waitFor(() => a.state.caughtUp !== undefined && a.events.at(-1)?.seq === 400, 8000, "caught up after resync");
    expect(contiguous(a.events, last + 1)).toBe(true);
    expect(a.events.length + seen.length).toBe(400);
  });
});

describe("clients and bridge routing", () => {
  test("tracks connected clients and notifies on change", async () => {
    const changes: number[] = [];
    const { server, connect } = await boot({ onClientsChanged: (n) => { changes.push(n); } });
    expect(server.clientCount).toBe(0);
    const c = await connect();
    await c.hello("x");
    expect(server.clientCount).toBe(1);
    c.close();
    await waitFor(() => server.clientCount === 0, 3000, "disconnect");
    expect(changes).toEqual([1, 0]);
  });

  test("bridge.call is delegated to the bridge port; absent port is an explicit error", async () => {
    const calls: unknown[] = [];
    const { connect } = await boot({ bridge: { call: async (input) => { calls.push(input); return { ok: true, data: { echoed: input.tool } }; } } });
    const c = await connect();
    expect(await c.request({ t: "bridge.call", token: "tok", tool: "deck_status", arguments: { a: 1 } })).toMatchObject({ t: "bridge.result", outcome: { ok: true, data: { echoed: "deck_status" } } });
    expect(calls).toEqual([{ token: "tok", tool: "deck_status", arguments: { a: 1 } }]);
    const { connect: connect2 } = await boot();
    const c2 = await connect2();
    expect(await c2.request({ t: "bridge.call", token: "t", tool: "x" })).toMatchObject({ outcome: { ok: false, code: "bridge-unavailable" } });
  });
});

describe("service-reported duplicates and queries (S1b)", () => {
  test("an outcome the service flags as a persisted duplicate is reported as duplicate without leaking the flag into the outcome", async () => {
    const dir = tempDir();
    const service = new StubSessionService(join(dir, "sessions"));
    service.execute = async () => ({ ok: true, data: { n: 1 }, duplicate: true });
    const server = new ControlServer({ socketPath: join(dir, "d.sock"), service, daemon: quietDaemon });
    await server.listen();
    cleanups.push(() => server.close(), () => service.close());
    const c = await ControlClient.connect(join(dir, "d.sock"));
    cleanups.push(() => c.close());
    const reply = await c.command({ v: 1, commandId: uuid(), type: "session.create", projectRoot: "/p" });
    expect(reply.duplicate).toBe(true);
    expect(reply.outcome).toEqual({ ok: true, data: { n: 1 } });
  });

  test("query frames reach the service; a service without queries answers query-unsupported", async () => {
    const dir = tempDir();
    const service = new StubSessionService(join(dir, "sessions"));
    (service as { query?: unknown }).query = async (name: string, args: unknown) => ({ ok: true, data: { name, args } });
    const server = new ControlServer({ socketPath: join(dir, "d.sock"), service, daemon: quietDaemon });
    await server.listen();
    cleanups.push(() => server.close(), () => service.close());
    const c = await ControlClient.connect(join(dir, "d.sock"));
    cleanups.push(() => c.close());
    expect(await c.query("sessions.list", { limit: 5 })).toEqual({ ok: true, data: { name: "sessions.list", args: { limit: 5 } } });

    const b = await boot();
    const c2 = await b.connect();
    expect(await c2.query("sessions.list")).toMatchObject({ ok: false, code: "query-unsupported" });
  });
});
