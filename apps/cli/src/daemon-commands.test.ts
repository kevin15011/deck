import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ControlClient, resolveStatePaths, startDaemon, type RunningDaemon } from "@deck/session-host";
import { parseArgs } from "./cli-args";
import { runDaemonCommand, type DaemonCommandDeps } from "./daemon-commands";

const dirs: string[] = [], daemons: RunningDaemon[] = [];
afterEach(async () => { await Promise.all(daemons.splice(0).map((d) => d.stop("test"))); for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "deck-dcmd-")); dirs.push(dir);
  const paths = resolveStatePaths({ env: { HOME: dir, XDG_STATE_HOME: join(dir, "state") }, tmpdir: dir });
  let output = "", errors = "", spawns = 0, busy = false, nonce = 0;
  const start = async () => {
    const result = await startDaemon({ paths, version: "1.0.0", nonce: `test-${++nonce}`, anchorCommand: ["unused"], createService: () => ({ execute: async () => ({ ok: true }), openLog: () => undefined, hasRunningWork: () => busy }) });
    if (!result.ok) throw new Error(result.reason);
    daemons.push(result.daemon); return result.daemon;
  };
  const deps: DaemonCommandDeps = {
    paths, version: "1.0.0", write: (s) => { output += s; }, writeErr: (s) => { errors += s; },
    spawnDaemon: () => { spawns++; void start(); return process.pid; },
    // Test daemons share this test process; disappearance of their owned lock proves this fixture stopped.
    presence: () => existsSync(paths.lockFile) ? "alive" : "absent", timeoutMs: 500, pollMs: 5,
  };
  return { paths, deps, start, get output() { return output; }, get errors() { return errors; }, get spawns() { return spawns; }, set busy(v: boolean) { busy = v; }, clear: () => { output = ""; errors = ""; } };
}
const command = (f: ReturnType<typeof fixture>, action: "start" | "status" | "stop" | "restart") => runDaemonCommand(f.deps, { action, json: true });

describe("public daemon grammar", () => {
  for (const action of ["start", "status", "stop", "restart"] as const) test(action, () => {
    expect(parseArgs(["daemon", action])).toEqual({ command: "daemon", sub: { action, json: false } });
    expect(parseArgs(["daemon", action, "--json"])).toEqual({ command: "daemon", sub: { action, json: true } });
  });
  test("help and invalid arguments", () => {
    expect(parseArgs(["daemon", "--help"])).toMatchObject({ command: "daemon-help" });
    for (const args of [[], ["bad"], ["stop", "--force"], ["status", "extra"], ["start", "--json", "--json"]]) expect(parseArgs(["daemon", ...args]).command).toBe("error");
  });
});

describe("daemon lifecycle commands", () => {
  test("absent status and stop never create state or spawn", async () => {
    const f = fixture();
    for (const action of ["status", "stop"] as const) {
      f.clear(); expect(await command(f, action)).toBe(0);
      expect(JSON.parse(f.output)).toMatchObject({ action, outcome: "not-running", running: false });
    }
    expect(f.spawns).toBe(0); expect(existsSync(f.paths.root)).toBe(false);
  });
  test("start is idempotent; status reports the actual daemon", async () => {
    const f = fixture(); expect(await command(f, "start")).toBe(0);
    expect(JSON.parse(f.output)).toMatchObject({ action: "start", outcome: "started", running: true });
    f.clear(); expect(await command(f, "start")).toBe(0);
    expect(JSON.parse(f.output)).toMatchObject({ outcome: "already-running" }); expect(f.spawns).toBe(1);
    f.clear(); expect(await command(f, "status")).toBe(0);
    expect(JSON.parse(f.output)).toMatchObject({ outcome: "running", daemon: { pid: process.pid, version: "1.0.0", runningWork: false } });
  });
  test("stop and restart refuse running work, without replacing the daemon", async () => {
    const f = fixture(), d = await f.start(); f.busy = true;
    for (const action of ["stop", "restart"] as const) {
      f.clear(); expect(await command(f, action)).toBe(1);
      expect(JSON.parse(f.output)).toMatchObject({ action, outcome: "error", code: "busy", running: true });
    }
    expect(f.spawns).toBe(0); expect(existsSync(f.paths.lockFile)).toBe(true); expect(d.info.nonce).toBe("test-1");
  });
  test("restart waits for old cleanup and replaces even an equal version; history is preserved", async () => {
    const f = fixture(); const first = await f.start();
    const history = join(f.paths.sessionsDir, "history.txt"); writeFileSync(history, "preserve");
    expect(await command(f, "restart")).toBe(0);
    expect(await first.stopped).toBe("restart");
    expect(JSON.parse(f.output)).toMatchObject({ action: "restart", outcome: "restarted", daemon: { nonce: "test-2" }, previous: { nonce: "test-1" } });
    expect(existsSync(history)).toBe(true); expect(f.spawns).toBe(1);
    f.clear(); expect(await command(f, "stop")).toBe(0);
    expect(JSON.parse(f.output)).toMatchObject({ outcome: "stopped", running: false });
  });
  test("restart absent starts a daemon", async () => {
    const f = fixture(); expect(await command(f, "restart")).toBe(0);
    expect(JSON.parse(f.output)).toMatchObject({ action: "restart", outcome: "started" }); expect(f.spawns).toBe(1);
  });
  test("stop refuses pending approvals even when no native task is running", async () => {
    const f = fixture(), d = await f.start();
    const approval = d.services.broker.request({ sessionId: "s", taskId: "lead", tool: "Bash" });
    try {
      expect(await command(f, "stop")).toBe(1);
      expect(JSON.parse(f.output)).toMatchObject({ code: "busy", running: true });
      expect(d.services.broker.pending()).toHaveLength(1);
    } finally { d.services.broker.cancel(approval.approvalId, "test"); }
  });
  test("unreachable live owner fails closed without spawning or removing the lock", async () => {
    const f = fixture(); await f.start();
    f.deps.connect = async () => { throw new Error("unreachable"); };
    for (const action of ["start", "status", "stop", "restart"] as const) { f.clear(); expect(await command(f, action)).toBe(1); expect(JSON.parse(f.output)).toMatchObject({ code: "daemon-unreachable" }); }
    expect(f.spawns).toBe(0); expect(existsSync(f.paths.lockFile)).toBe(true);
  });
  test("startup timeout and unconfirmed shutdown never report success or spawn replacement", async () => {
    const f = fixture(); f.deps.spawnDaemon = () => process.pid; f.deps.timeoutMs = 20;
    expect(await command(f, "start")).toBe(1); expect(JSON.parse(f.output)).toMatchObject({ code: "start-timeout" });
    f.clear(); await f.start(); f.deps.presence = () => "unknown";
    expect(await command(f, "restart")).toBe(1); expect(JSON.parse(f.output)).toMatchObject({ code: "stop-timeout" }); expect(f.spawns).toBe(0);
  });
  test("identity mismatch refuses even a responsive socket", async () => {
    const f = fixture(); await f.start();
    writeFileSync(f.paths.daemonInfoFile, JSON.stringify({ v: 1, pid: process.pid, nonce: "foreign", version: "1.0.0", socketPath: f.paths.socket.path }));
    expect(await command(f, "stop")).toBe(1); expect(JSON.parse(f.output)).toMatchObject({ code: "identity-mismatch" });
    const c = await ControlClient.connect(f.paths.socket.path); try { expect((await c.hello("test")).nonce).toBe("test-1"); } finally { c.close(); }
  });
  test("a competing start never counts as replacement by the invoking executable", async () => {
    const f = fixture(); await f.start();
    f.deps.spawnDaemon = () => { void f.start(); return process.pid + 1; };
    expect(await command(f, "restart")).toBe(1);
    expect(JSON.parse(f.output)).toMatchObject({ action: "restart", outcome: "error", code: "start-contended", running: true });
  });
});
