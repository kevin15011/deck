import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, lstatSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { ControlClient } from "../control-client";
import { startDaemon, type DaemonOptions, type RunningDaemon } from "../daemon";
import { readDaemonInfo } from "../daemon-lock";
import { EventLog } from "../event-log";
import { writeLease } from "../lease";
import { ensureStateLayout, resolveStatePaths, sessionPaths } from "../paths";
import { IDLE_SHUTDOWN_MS } from "../idle-monitor";
import { StubSessionService } from "../testing/stub-service";
import { FakeClock, cleanupTempDirs, isAlive, tempDir, waitFor } from "./test-helpers";

const ANCHOR_ENTRY = join(import.meta.dir, "fixtures", "anchor-entry.ts");
const FAKE_CHILD = join(import.meta.dir, "fixtures", "fake-child.ts");
const running: RunningDaemon[] = [];
const clients: ControlClient[] = [];
const stray: number[] = [];

afterEach(async () => {
  for (const c of clients.splice(0)) c.close();
  await Promise.all(running.splice(0).map((d) => d.stop("test-cleanup")));
  for (const pid of stray.splice(0)) if (isAlive(pid)) { try { process.kill(pid, "SIGKILL"); } catch { /* gone */ } }
  cleanupTempDirs();
});

function stateEnv() {
  const base = tempDir();
  const paths = resolveStatePaths({ env: { HOME: base, XDG_STATE_HOME: join(base, "state") }, tmpdir: base });
  return { base, paths };
}

async function start(paths = stateEnv().paths, over: Partial<DaemonOptions> = {}) {
  let stub: StubSessionService | undefined;
  const result = await startDaemon({
    paths, version: "1.0.0", anchorCommand: [process.execPath, "run", ANCHOR_ENTRY],
    createService: () => (stub = new StubSessionService(paths.sessionsDir)),
    ...over,
  });
  if (result.ok) running.push(result.daemon);
  return { result, paths, get stub() { return stub!; } };
}
const connect = async (paths: { socket: { path: string } }) => { const c = await ControlClient.connect(paths.socket.path); clients.push(c); return c; };

describe("startDaemon (XR-3.1)", () => {
  test("accepted restart fences a same-batch command and bridge approval before scheduled cleanup", async () => {
    let calls = 0, finishClose!: () => void;
    const closing = new Promise<void>((resolve) => { finishClose = resolve; });
    const { result, paths } = await start(undefined, { createService: () => ({
      execute: async () => { calls++; return { ok: true }; }, openLog: () => undefined, hasRunningWork: () => false, close: () => closing,
    }) });
    if (!result.ok) throw new Error("expected start");
    const { token } = result.daemon.services.credentials.issue({ sessionId: "s-1", taskId: "lead", memberId: "lead", allowedTools: ["deck_approve"] }, join(paths.root, "cred"));
    const c = await connect(paths);
    try {
      const restarting = c.request({ t: "daemon.restart" });
      const creating = c.command({ v: 1, commandId: randomUUID(), type: "session.create", projectRoot: "/tmp/project" });
      const approving = c.request({ t: "bridge.call", token, tool: "deck_approve", arguments: { tool_name: "Bash", input: {} } }, 100);
      expect(await restarting).toMatchObject({ outcome: { ok: true } });
      expect(await creating).toMatchObject({ outcome: { ok: false, code: "daemon-stopping" } });
      expect(await approving).toMatchObject({ outcome: { ok: false, code: "daemon-stopping" } });
      expect(calls).toBe(0); expect(result.daemon.services.broker.pending()).toHaveLength(0);
    } finally { finishClose(); }
  });

  test("restart refuses an admitted asynchronous command even before the service marks work running", async () => {
    let finish!: () => void, entered = false;
    const executing = new Promise<void>((resolve) => { finish = resolve; });
    const { result, paths } = await start(undefined, { createService: () => ({ execute: async () => { entered = true; await executing; return { ok: true }; }, openLog: () => undefined, hasRunningWork: () => false }) });
    if (!result.ok) throw new Error("expected start");
    const c = await connect(paths);
    const pending = c.command({ v: 1, commandId: randomUUID(), type: "session.create", projectRoot: "/tmp/project" });
    try {
      await waitFor(() => entered, 500, "command admission");
      expect(await c.request({ t: "daemon.restart" })).toMatchObject({ outcome: { ok: false, code: "busy" } });
    } finally { finish(); await pending; }
  });

  test("the browser transport shares the restart admission fence", async () => {
    let calls = 0, finishClose!: () => void;
    const closing = new Promise<void>((resolve) => { finishClose = resolve; });
    const { result, paths } = await start(undefined, {
      web: { config: { port: 0, trustedProxy: null, allowedOrigins: [], allowFunnel: false } },
      createService: () => ({ execute: async () => { calls++; return { ok: true }; }, openLog: () => undefined, hasRunningWork: () => false, close: () => closing }),
    });
    if (!result.ok) throw new Error("expected start");
    const c = await connect(paths);
    const status = await c.request({ t: "daemon.status" });
    const base = (status as { status: { web: { url: string } } }).status.web.url;
    const access = await fetch(`${base}/api/local-access`, { method: "POST", headers: { Origin: base, "Content-Type": "application/json" }, body: "{}" });
    const cookie = access.headers.get("set-cookie")!.split(";")[0]!;
    try {
      expect(await c.request({ t: "daemon.restart" })).toMatchObject({ outcome: { ok: true } });
      const response = await fetch(`${base}/api/commands`, { method: "POST", headers: { Origin: base, Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: "s", command: { v: 1, commandId: randomUUID(), type: "prompt.send", text: "after shutdown" } }) });
      expect(await response.json()).toMatchObject({ ok: false, code: "daemon-stopping" });
      expect(calls).toBe(0);
    } finally { finishClose(); }
  });

  test("creates the private state layout, locks, listens and publishes daemon.json", async () => {
    const { result, paths } = await start();
    if (!result.ok) throw new Error("expected start");
    for (const dir of [paths.root, paths.daemonDir, paths.sessionsDir, paths.logsDir]) expect(lstatSync(dir).mode & 0o777).toBe(0o700);
    expect(lstatSync(paths.socket.path).isSocket()).toBe(true);
    expect(lstatSync(paths.lockFile).mode & 0o777).toBe(0o600);
    expect(readDaemonInfo(paths)).toMatchObject({ pid: process.pid, nonce: result.daemon.info.nonce, version: "1.0.0", socketPath: paths.socket.path });
    const hello = await (await connect(paths)).hello("1.0.0");
    expect(hello).toMatchObject({ daemonVersion: "1.0.0", nonce: result.daemon.info.nonce });
  });

  test("a second start is refused with already-running and leaves the first untouched", async () => {
    const { result, paths } = await start();
    if (!result.ok) throw new Error("expected start");
    const second = await startDaemon({ paths, version: "1.0.0", anchorCommand: [process.execPath, "run", ANCHOR_ENTRY] });
    expect(second).toMatchObject({ ok: false, reason: "already-running", holder: { pid: process.pid } });
    expect((await (await connect(paths)).hello("x")).nonce).toBe(result.daemon.info.nonce);
    expect(existsSync(paths.socket.path)).toBe(true);
  });

  test("stop removes socket, daemon.json and the lock; a new daemon can then start", async () => {
    const { result, paths } = await start();
    if (!result.ok) throw new Error("expected start");
    await result.daemon.stop("test");
    expect(await result.daemon.stopped).toBe("test");
    expect(existsSync(paths.socket.path)).toBe(false);
    expect(existsSync(paths.daemonInfoFile)).toBe(false);
    expect(existsSync(paths.lockFile)).toBe(false);
    const again = await start(paths);
    expect(again.result.ok).toBe(true);
  });

  test("stop is idempotent", async () => {
    const { result } = await start();
    if (!result.ok) throw new Error("expected start");
    await Promise.all([result.daemon.stop("a"), result.daemon.stop("b")]);
    expect(await result.daemon.stopped).toBe("a");
  });

  test("stop drains service task leases before supervisor group containment", async () => {
    const order: string[] = [];
    let release!: () => void;
    const closing = new Promise<void>((resolve) => { release = resolve; });
    const { result } = await start(undefined, { createService: (services) => {
      services.supervisor.shutdown = async () => { order.push("supervisor"); };
      return { execute: async () => ({ ok: true }), openLog: () => undefined, hasRunningWork: () => false, close: async () => { order.push("service-start"); await closing; order.push("service-drained"); } };
    } });
    if (!result.ok) throw new Error("expected start");
    const stopping = result.daemon.stop("test");
    await waitFor(() => order.length > 0, 250, "service close");
    try { expect(order).toEqual(["service-start"]); } finally { release(); }
    await stopping; expect(order).toEqual(["service-start", "service-drained", "supervisor"]);
  });

  test("a stuck service cannot prevent bounded supervisor shutdown", async () => {
    const clock = new FakeClock(), order: string[] = [];
    const { result } = await start(undefined, { clock, createService: (services) => {
      services.supervisor.shutdown = async () => { order.push("supervisor"); };
      return { execute: async () => ({ ok: true }), openLog: () => undefined, hasRunningWork: () => false, close: async () => { order.push("service"); await new Promise(() => {}); } };
    } });
    if (!result.ok) throw new Error("expected start");
    const stopping = result.daemon.stop("test");
    await waitFor(() => order.length > 0, 250, "service close");
    clock.advance(7501); await stopping;
    expect(order).toEqual(["service", "supervisor"]);
  });

  test("a failure after the lock was taken releases it", async () => {
    const { paths } = stateEnv();
    ensureStateLayout(paths);
    mkdirSync(paths.socket.path); // a directory where the socket must go: listen fails
    await expect(startDaemon({ paths, version: "1", anchorCommand: ["x"] })).rejects.toThrow();
    expect(existsSync(paths.lockFile)).toBe(false);
  });

  test("daemon.status reports pid, version, clients and running work", async () => {
    const { result, paths, stub } = await start();
    if (!result.ok) throw new Error("expected start");
    const c = await connect(paths);
    stub.running = true;
    const status = (await c.request({ t: "daemon.status" })) as { status: Record<string, unknown> };
    expect(status.status).toMatchObject({ pid: process.pid, version: "1.0.0", clients: 1, runningWork: true });
  });
});

describe("startup recovery before serving (XR-3.7)", () => {
  test("running tasks of a previous daemon are recovered before any client can attach", async () => {
    const { paths } = stateEnv();
    ensureStateLayout(paths);
    const sp = sessionPaths(paths, "s-old");
    mkdirSync(sp.dir, { recursive: true, mode: 0o700 });
    const log = EventLog.open({ dir: sp.eventsDir, sessionId: "s-old" });
    log.appendMany([
      { kind: "session.created", data: { projectRoot: "/p" } },
      { kind: "session.state", data: { state: "running" } },
      { kind: "task.created", source: { taskId: "t" }, data: { taskId: "t", memberId: "lead", runnerId: "claude", modelId: "m" } },
      { kind: "task.state", source: { taskId: "t" }, data: { taskId: "t", state: "running" } },
    ]);
    log.close();
    writeLease(sp.taskLeaseFile("t"), { v: 1, taskId: "t", nonce: "n", state: "claiming", daemon: { pid: 1 }, createdAt: "2026-01-01T00:00:00.000Z" });
    const { result } = await start(paths);
    if (!result.ok) throw new Error("expected start");
    expect(result.recovery.sessions.map((s) => ({ id: s.sessionId, unsettled: s.unsettled }))).toEqual([{ id: "s-old", unsettled: [{ taskId: "t", reason: "lease-claiming" }] }]);
    const check = EventLog.open({ dir: sp.eventsDir, sessionId: "s-old" });
    expect([...check.readAfter(4)].map((e) => e.kind)).toEqual(["task.state", "session.recovered"]);
    check.close();
  });

  test("recoverOnStart=false skips the scan", async () => {
    const { result } = await start(stateEnv().paths, { recoverOnStart: false });
    if (!result.ok) throw new Error("expected start");
    expect(result.recovery.sessions).toEqual([]);
  });
});

describe("idle shutdown and version-skew restart (XR-3.1, design 6.3)", () => {
  test("stops after 30 idle minutes, but not while a client is attached or work is running", async () => {
    const clock = new FakeClock();
    const { result, paths, stub } = await start(stateEnv().paths, { clock });
    if (!result.ok) throw new Error("expected start");
    stub.running = true;
    clock.advance(IDLE_SHUTDOWN_MS * 2);
    stub.running = false;
    const c = await connect(paths);
    await c.hello("x");
    clock.advance(IDLE_SHUTDOWN_MS * 2);
    let stopped = false;
    void result.daemon.stopped.then(() => { stopped = true; });
    await Promise.resolve();
    expect(stopped).toBe(false);
    c.close();
    await waitFor(() => result.daemon.clientCount === 0, 3000, "client gone");
    clock.advance(IDLE_SHUTDOWN_MS + 20_000);
    expect(await result.daemon.stopped).toBe("idle");
    expect(existsSync(paths.socket.path)).toBe(false);
  });

  test("daemon.restart stops an idle daemon and is refused while work is running", async () => {
    const { result, paths, stub } = await start();
    if (!result.ok) throw new Error("expected start");
    const c = await connect(paths);
    stub.running = true;
    expect(await c.request({ t: "daemon.restart" })).toMatchObject({ outcome: { ok: false, code: "busy" } });
    let stopped = false;
    void result.daemon.stopped.then(() => { stopped = true; });
    await new Promise((r) => setTimeout(r, 100));
    expect(stopped).toBe(false);
    stub.running = false;
    expect(await c.request({ t: "daemon.restart" })).toMatchObject({ outcome: { ok: true } });
    expect(await result.daemon.stopped).toBe("restart");
  });
});

describe("services wiring: bridge, approvals and supervision", () => {
  test("a credential issued by the daemon authenticates deck_status through the socket", async () => {
    const { result, paths, stub } = await start();
    if (!result.ok) throw new Error("expected start");
    stub.addSession("s-1");
    const file = join(paths.root, "cred");
    const { token } = result.daemon.services.credentials.issue({ sessionId: "s-1", taskId: "lead", memberId: "lead", allowedTools: ["deck_status"] }, file);
    const c = await connect(paths);
    expect(await c.request({ t: "bridge.call", token, tool: "deck_status" })).toMatchObject({ outcome: { ok: true, data: { sessionId: "s-1", taskId: "lead" } } });
  });

  test("an approval requested through the bridge lands in the session log and a client answers it over the socket", async () => {
    const { result, paths, stub } = await start();
    if (!result.ok) throw new Error("expected start");
    const log = stub.addSession("s-1");
    const { token } = result.daemon.services.credentials.issue({ sessionId: "s-1", taskId: "lead", memberId: "lead", allowedTools: ["deck_approve"] }, join(paths.root, "cred"));
    const bridgeClient = await connect(paths);
    const pending = bridgeClient.request({ t: "bridge.call", token, tool: "deck_approve", arguments: { tool_name: "Bash", input: { command: "ls" } } });
    await waitFor(() => result.daemon.services.broker.pending().length === 1, 3000, "pending approval");
    expect([...log.readAfter(0)].some((e) => e.kind === "approval.requested")).toBe(true);
    result.daemon.services.broker.respond({ approvalId: result.daemon.services.broker.pending()[0]!.approvalId, decision: "allow", by: "test" });
    expect(await pending).toMatchObject({ outcome: { ok: true, data: { behavior: "allow" } } });
  });

  test("stop denies pending approvals, deletes credential files and kills supervised children", async () => {
    const { result, paths, stub } = await start();
    if (!result.ok) throw new Error("expected start");
    stub.addSession("s-1");
    const credFile = join(paths.root, "cred");
    result.daemon.services.credentials.issue({ sessionId: "s-1", taskId: "lead", memberId: "lead", allowedTools: ["deck_approve"] }, credFile);
    const approval = result.daemon.services.broker.request({ sessionId: "s-1", taskId: "lead", tool: "Bash" });
    const proc = result.daemon.services.supervisor.spawn(process.execPath, ["run", FAKE_CHILD, "hold"], { env: process.env as Record<string, string> });
    let out = "";
    proc.stdout.on("data", (d: Buffer) => { out += d.toString(); });
    proc.stderr.on("data", () => {});
    await waitFor(() => out.includes("\n"), 8000, "child up");
    const info = JSON.parse(out.split("\n")[0]!) as { child: number; grandchild: number };
    stray.push(info.child, info.grandchild);
    await result.daemon.stop("test");
    expect((await approval.resolution).by).toBe("shutdown");
    expect(existsSync(credFile)).toBe(false);
    await waitFor(() => !isAlive(info.child) && !isAlive(info.grandchild), 5000, "children terminated by shutdown");
  });
});

describe("crash leftovers", () => {
  test("stale lock, socket and daemon.json from a killed daemon do not block a new one", async () => {
    const { paths } = stateEnv();
    ensureStateLayout(paths);
    const dead = Bun.spawnSync([process.execPath, "-e", "0"]);
    expect(dead.exitCode).toBe(0);
    // lock held by a pid that no longer exists, plus leftovers
    require("node:fs").writeFileSync(paths.lockFile, JSON.stringify({ v: 1, pid: 2 ** 22 - 7, nonce: "ghost", startedAt: 0 }), { mode: 0o600 });
    Bun.spawnSync([process.execPath, "-e", `require("net").createServer().listen(${JSON.stringify(paths.socket.path)}, () => process.kill(process.pid, "SIGKILL"))`]);
    require("node:fs").writeFileSync(paths.daemonInfoFile, JSON.stringify({ v: 1, pid: 2 ** 22 - 7, nonce: "ghost", version: "0", socketPath: paths.socket.path, startedAt: "x" }), { mode: 0o600 });
    const { result } = await start(paths);
    expect(result.ok).toBe(true);
    expect(JSON.parse(readFileSync(paths.lockFile, "utf8")).nonce).not.toBe("ghost");
    expect(readDaemonInfo(paths)?.nonce).not.toBe("ghost");
  });
});
