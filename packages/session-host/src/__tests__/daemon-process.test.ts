import { afterEach, describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { ControlClient } from "../control-client";
import { ensureDaemon, pingDaemon, spawnDetachedDaemon } from "../daemon-client";
import { readDaemonInfo } from "../daemon-lock";
import { resolveStatePaths } from "../paths";
import { cleanupTempDirs, isAlive, tempDir, waitFor } from "./test-helpers";

const ENTRY = join(import.meta.dir, "fixtures", "daemon-entry.ts");
const pids = new Set<number>();

afterEach(async () => {
  for (const pid of pids) if (isAlive(pid)) { try { process.kill(pid, "SIGTERM"); } catch { /* gone */ } }
  await waitFor(() => [...pids].every((p) => !isAlive(p)), 5000, "daemons gone").catch(() => { for (const pid of pids) { try { process.kill(pid, "SIGKILL"); } catch { /* gone */ } } });
  pids.clear();
  cleanupTempDirs();
});

function setup(extraEnv: Record<string, string> = {}, long = false) {
  const base = tempDir();
  const stateBase = long ? join(base, "d".repeat(95)) : join(base, "state");
  const env = { ...process.env, HOME: base, XDG_STATE_HOME: stateBase, TMPDIR: base, ...extraEnv } as Record<string, string>;
  const paths = resolveStatePaths({ env, tmpdir: base });
  const command = [process.execPath, "run", ENTRY];
  return { base, env, paths, command, spawnDaemon: () => spawnDetachedDaemon(command, env) };
}

describe("daemon as a real process", () => {
  test("auto-starts detached, is reused by later clients, and survives the starter", async () => {
    const s = setup();
    const first = await ensureDaemon({ paths: s.paths, clientVersion: "1.0.0", spawnDaemon: s.spawnDaemon });
    pids.add(first.daemon.pid);
    expect(first).toMatchObject({ started: true, restarted: false });
    expect(first.daemon.pid).not.toBe(process.pid);
    const second = await ensureDaemon({ paths: s.paths, clientVersion: "1.0.0", spawnDaemon: () => { throw new Error("must not spawn"); } });
    expect(second).toMatchObject({ started: false, daemon: { pid: first.daemon.pid, nonce: first.daemon.nonce } });
    expect(readDaemonInfo(s.paths)).toMatchObject({ pid: first.daemon.pid });
  });

  test("a second daemon process exits cleanly with an 'already running' message", async () => {
    const s = setup();
    const first = await ensureDaemon({ paths: s.paths, clientVersion: "1.0.0", spawnDaemon: s.spawnDaemon });
    pids.add(first.daemon.pid);
    const second = spawn(s.command[0]!, s.command.slice(1), { env: s.env, stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    second.stderr!.on("data", (d: Buffer) => { err += d.toString(); });
    const code = await new Promise<number | null>((resolve) => second.once("exit", resolve));
    expect(code).toBe(0);
    expect(err).toContain("already running");
    expect(err).toContain(String(first.daemon.pid));
    expect((await pingDaemon(s.paths.socket.path))?.nonce).toBe(first.daemon.nonce);
  });

  test("concurrent clients race to auto-start and converge on one daemon", async () => {
    const s = setup();
    const results = await Promise.all(Array.from({ length: 4 }, () => ensureDaemon({ paths: s.paths, clientVersion: "1.0.0", spawnDaemon: s.spawnDaemon, timeoutMs: 10000 })));
    for (const r of results) pids.add(r.daemon.pid);
    expect(new Set(results.map((r) => r.daemon.pid)).size).toBe(1);
    expect(results.some((r) => r.started)).toBe(true);
  });

  test("a killed daemon leaves stale files that the next auto-start recovers from", async () => {
    const s = setup();
    const first = await ensureDaemon({ paths: s.paths, clientVersion: "1.0.0", spawnDaemon: s.spawnDaemon });
    process.kill(first.daemon.pid, "SIGKILL");
    await waitFor(() => !isAlive(first.daemon.pid), 5000, "daemon killed");
    expect(existsSync(s.paths.lockFile)).toBe(true); // stale leftovers
    const next = await ensureDaemon({ paths: s.paths, clientVersion: "1.0.0", spawnDaemon: s.spawnDaemon });
    pids.add(next.daemon.pid);
    expect(next.started).toBe(true);
    expect(next.daemon.pid).not.toBe(first.daemon.pid);
  });

  test("SIGTERM stops it gracefully and removes socket, discovery file and lock", async () => {
    const s = setup();
    const r = await ensureDaemon({ paths: s.paths, clientVersion: "1.0.0", spawnDaemon: s.spawnDaemon });
    process.kill(r.daemon.pid, "SIGTERM");
    await waitFor(() => !isAlive(r.daemon.pid), 5000, "daemon exit");
    expect(existsSync(s.paths.socket.path)).toBe(false);
    expect(existsSync(s.paths.daemonInfoFile)).toBe(false);
    expect(existsSync(s.paths.lockFile)).toBe(false);
  });

  test("exits on its own after the idle period with no clients", async () => {
    const s = setup({ DECK_SESSION_DAEMON_IDLE_MS: "400" });
    const r = await ensureDaemon({ paths: s.paths, clientVersion: "1.0.0", spawnDaemon: s.spawnDaemon });
    pids.add(r.daemon.pid);
    await waitFor(() => !isAlive(r.daemon.pid), 8000, "idle exit");
    expect(existsSync(s.paths.socket.path)).toBe(false);
    const log = readdirSync(s.paths.logsDir).map((f) => readFileSync(join(s.paths.logsDir, f), "utf8")).join("");
    expect(log).toContain('"reason":"idle"');
  });

  test("an attached client keeps an otherwise idle daemon alive", async () => {
    const s = setup({ DECK_SESSION_DAEMON_IDLE_MS: "400" });
    const r = await ensureDaemon({ paths: s.paths, clientVersion: "1.0.0", spawnDaemon: s.spawnDaemon });
    pids.add(r.daemon.pid);
    const client = await ControlClient.connect(s.paths.socket.path);
    await client.hello("1.0.0");
    await new Promise((res) => setTimeout(res, 1500));
    expect(isAlive(r.daemon.pid)).toBe(true);
    client.close();
    await waitFor(() => !isAlive(r.daemon.pid), 8000, "idle exit after the client left");
  });

  test("a newer client restarts an idle older daemon process", async () => {
    const s = setup({ DECK_TEST_VERSION: "1.0.0" });
    const old = await ensureDaemon({ paths: s.paths, clientVersion: "1.0.0", spawnDaemon: s.spawnDaemon });
    pids.add(old.daemon.pid);
    const upgraded = await ensureDaemon({
      paths: s.paths, clientVersion: "2.0.0",
      spawnDaemon: () => spawnDetachedDaemon(s.command, { ...s.env, DECK_TEST_VERSION: "2.0.0" }),
    });
    pids.add(upgraded.daemon.pid);
    expect(upgraded).toMatchObject({ restarted: true, started: true, daemon: { version: "2.0.0" } });
    expect(upgraded.daemon.pid).not.toBe(old.daemon.pid);
    await waitFor(() => !isAlive(old.daemon.pid), 5000, "old daemon exit");
  });

  test("works when the state path is too long for sun_path (falls back under $TMPDIR/deck-<uid>)", async () => {
    const s = setup({}, true);
    mkdirSync(s.base, { recursive: true });
    expect(s.paths.socket.location).toBe("tmp-fallback");
    const r = await ensureDaemon({ paths: s.paths, clientVersion: "1.0.0", spawnDaemon: s.spawnDaemon });
    pids.add(r.daemon.pid);
    expect(r.socketPath).toBe(join(s.base, `deck-${process.getuid?.() ?? 0}`, "daemon.sock"));
    expect(Buffer.byteLength(r.socketPath)).toBeLessThan(104);
    expect((await pingDaemon(r.socketPath))?.pid).toBe(r.daemon.pid);
  });
});
