import { afterEach, describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readLease } from "../lease";
import { Supervisor, type SupervisedProcess } from "../supervisor";
import { cleanupTempDirs, isAlive, sleep, tempDir, waitFor } from "./test-helpers";

const FIXTURES = join(import.meta.dir, "fixtures");
const ENTRY = join(FIXTURES, "anchor-entry.ts");
const CHILD = join(FIXTURES, "fake-child.ts");
const supervisors: Supervisor[] = [];
const stray: number[] = [];

const makeSupervisor = () => {
  const s = new Supervisor({ anchorCommand: [process.execPath, "run", ENTRY] });
  supervisors.push(s);
  return s;
};
const run = (s: Supervisor, mode: string[], env: Record<string, string> = {}, lease?: { file: string; taskId: string }) =>
  s.spawn(process.execPath, ["run", CHILD, ...mode], { env: { ...(process.env as Record<string, string>), ...env }, lease });

function collect(proc: SupervisedProcess) {
  const state = { out: "", bytes: 0, err: "" };
  proc.stdout.on("data", (d: Buffer) => { state.out += d.toString(); state.bytes += d.length; });
  proc.stderr.on("data", (d: Buffer) => { state.err += d.toString(); });
  return state;
}
async function childInfo(state: { out: string }) {
  await waitFor(() => state.out.includes("\n"), 8000, "child info");
  const info = JSON.parse(state.out.split("\n")[0]!) as { child: number; grandchild: number };
  stray.push(info.child, info.grandchild);
  return info;
}

afterEach(async () => {
  await Promise.all(supervisors.splice(0).map((s) => s.shutdown(200)));
  for (const pid of stray.splice(0)) if (isAlive(pid)) { try { process.kill(pid, "SIGKILL"); } catch { /* gone */ } }
  cleanupTempDirs();
});

describe("Supervisor (daemon side of the anchor)", () => {
  test("relays stdin/stdout and reports a clean exit", async () => {
    const proc = run(makeSupervisor(), ["echo"]);
    const out = collect(proc);
    await proc.ready;
    proc.stdin.write("ping\n");
    await waitFor(() => out.out.includes("PING"), 5000, "echo");
    proc.stdin.end();
    expect(await proc.exited).toMatchObject({ ok: true, code: 0, signal: null, drained: true, anchorLost: false });
  });

  test("exited resolves only after all output was delivered; failure exit codes are not ok", async () => {
    const proc = run(makeSupervisor(), ["big"]);
    const out = collect(proc);
    const exit = await proc.exited;
    expect(out.bytes).toBe(4096 * 1024);
    expect(out.err).toContain("done-err");
    expect(exit).toMatchObject({ ok: false, code: 3, drained: true });
  });

  test("interrupt() reaches the CLI only; its descendants are untouched until cleanup", async () => {
    const dir = tempDir();
    const mark = join(dir, "marks");
    const proc = run(makeSupervisor(), ["hold"], { FAKE_MARK: mark });
    const out = collect(proc);
    const info = await childInfo(out);
    expect((await proc.ready).workerPid).toBe(info.child);
    proc.interrupt();
    const exit = await proc.exited;
    expect(exit).toMatchObject({ ok: true, code: 0 });
    const marks = readFileSync(mark, "utf8");
    expect(marks).toContain("cli:SIGINT");
    expect(marks).not.toContain("grandchild");
    // terminal cleanup killed the leftover descendant
    await waitFor(() => !isAlive(info.grandchild), 4000, "descendant cleaned after terminal state");
  });

  test("terminateGroup escalates TERM to KILL for a child that ignores TERM", async () => {
    const dir = tempDir();
    const mark = join(dir, "marks");
    const proc = run(makeSupervisor(), ["stubborn"], { FAKE_MARK: mark });
    const info = await childInfo(collect(proc));
    const started = Date.now();
    await proc.terminateGroup(400);
    expect(Date.now() - started).toBeGreaterThanOrEqual(350);
    const exit = await proc.exited;
    expect(exit.ok).toBe(false);
    expect(readFileSync(mark, "utf8")).toContain("cli:SIGTERM");
    await waitFor(() => ![proc.anchorPid, info.child, info.grandchild].some(isAlive), 4000, "group gone");
  });

  test("a descendant that keeps stdout open turns a code-0 exit into a failure, then is reaped", async () => {
    const proc = run(makeSupervisor(), ["exit0-orphan"]);
    const info = await childInfo(collect(proc));
    const exit = await proc.exited;
    expect(exit).toMatchObject({ code: 0, drained: false, ok: false });
    expect(exit.error).toMatch(/EOF/);
    await waitFor(() => !isAlive(info.grandchild), 4000, "orphan reaped");
  });

  test("an externally killed anchor does not leave the child running (anchorLost)", async () => {
    const proc = run(makeSupervisor(), ["hold"]);
    const info = await childInfo(collect(proc));
    process.kill(proc.anchorPid, "SIGKILL");
    const exit = await proc.exited;
    expect(exit).toMatchObject({ ok: false, anchorLost: true });
    await waitFor(() => ![info.child, info.grandchild].some(isAlive), 4000, "children killed with the anchor");
  });

  test("an unspawnable executable fails cleanly", async () => {
    const proc = makeSupervisor().spawn("/nonexistent/deck-fake-cli", []);
    collect(proc);
    const exit = await proc.exited;
    expect(exit.ok).toBe(false);
    expect(exit.error).toMatch(/spawn/i);
  });

  test("the lease records claiming -> live identities -> removed after settle (0600)", async () => {
    const dir = tempDir();
    const file = join(dir, "lease.json");
    const proc = run(makeSupervisor(), ["hold"], {}, { file, taskId: "t1" });
    // the claim is committed before the child exists
    expect(readLease(file)).toMatchObject({ state: "claiming", taskId: "t1" });
    const info = await childInfo(collect(proc));
    await waitFor(() => readLease(file)?.state === "live", 4000, "live lease");
    const lease = readLease(file)!;
    expect(lease.anchor?.pid).toBe(proc.anchorPid);
    expect(lease.worker?.pid).toBe(info.child);
    expect(lease.group).toBe(proc.anchorPid);
    expect(lease.daemon.pid).toBe(process.pid);
    expect(lstatSync(file).mode & 0o777).toBe(0o600);
    await proc.terminateGroup(300);
    await proc.exited;
    expect(existsSync(file)).toBe(false);
  });

  test("shutdown terminates every live group", async () => {
    const s = makeSupervisor();
    const a = run(s, ["hold"]);
    const b = run(s, ["hold"]);
    const infos = await Promise.all([childInfo(collect(a)), childInfo(collect(b))]);
    await s.shutdown(300);
    await waitFor(() => !infos.some((i) => isAlive(i.child) || isAlive(i.grandchild)), 5000, "all groups gone");
  });
});

describe("daemon death (XR-3.6, D-14)", () => {
  test("SIGKILL of the supervising process kills anchor, child and grandchild", async () => {
    const daemon = spawn(process.execPath, ["run", join(FIXTURES, "fake-daemon.ts")], { stdio: ["ignore", "pipe", "inherit"] });
    let out = "";
    daemon.stdout!.on("data", (d: Buffer) => { out += d.toString(); });
    await waitFor(() => out.includes("\n"), 10000, "fake daemon report");
    const pids = JSON.parse(out.split("\n")[0]!) as { anchor: number; worker: number; grandchild: number };
    stray.push(pids.anchor, pids.worker, pids.grandchild);
    expect([pids.anchor, pids.worker, pids.grandchild].every(isAlive)).toBe(true);
    process.kill(daemon.pid!, "SIGKILL");
    await waitFor(() => ![pids.anchor, pids.worker, pids.grandchild].some(isAlive), 6000, "containment after daemon death");
    await sleep(50);
    expect(isAlive(daemon.pid!)).toBe(false);
  });
});
