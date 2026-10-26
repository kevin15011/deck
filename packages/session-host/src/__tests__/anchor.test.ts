import { afterEach, describe, expect, test } from "bun:test";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ANCHOR_NONCE_ENV, parseAnchorArgv, type AnchorToDaemon } from "../anchor";
import { cleanupTempDirs, isAlive, pgidOf, sleep, tempDir, waitFor } from "./test-helpers";

const ENTRY = join(import.meta.dir, "fixtures", "anchor-entry.ts");
const FAKE_CHILD = join(import.meta.dir, "fixtures", "fake-child.ts");
const started: ChildProcess[] = [];
const strayPids: number[] = [];

afterEach(() => {
  for (const c of started.splice(0)) if (c.pid && isAlive(c.pid)) { try { process.kill(-c.pid, "SIGKILL"); } catch { /* gone */ } }
  for (const pid of strayPids.splice(0)) if (isAlive(pid)) { try { process.kill(pid, "SIGKILL"); } catch { /* gone */ } }
  cleanupTempDirs();
});

type Harness = {
  child: ChildProcess; nonce: string; messages: AnchorToDaemon[]; stdout: () => string; stderr: () => string;
  ready: () => Promise<Extract<AnchorToDaemon, { type: "anchor_ready" }>>;
  exitMessage: () => Promise<Extract<AnchorToDaemon, { type: "child_exit" }>>;
  info: () => Promise<{ child: number; grandchild: number }>;
  send: (m: Record<string, unknown>) => void;
  exited: Promise<{ code: number | null; signal: string | null }>;
  stdoutBytes: () => number;
};

function startAnchor(workerArgv: string[], options: { ipc?: boolean; env?: Record<string, string> } = {}): Harness {
  const nonce = randomUUID();
  const ipc = options.ipc ?? true;
  const child = spawn(process.execPath, ["run", ENTRY, "--", ...workerArgv], {
    detached: true,
    stdio: ["pipe", "pipe", "pipe", ...(ipc ? ["ipc" as const] : [])],
    env: { ...process.env, ...options.env, [ANCHOR_NONCE_ENV]: nonce },
  });
  started.push(child);
  const messages: AnchorToDaemon[] = [];
  let out = "", err = "", bytes = 0;
  child.on("message", (m) => { messages.push(m as AnchorToDaemon); });
  child.stdout!.on("data", (d: Buffer) => { out += d.toString(); bytes += d.length; });
  child.stderr!.on("data", (d: Buffer) => { err += d.toString(); });
  const exited = new Promise<{ code: number | null; signal: string | null }>((resolve) => child.once("close", (code, signal) => resolve({ code, signal })));
  const find = <T extends AnchorToDaemon["type"]>(type: T) => async () => {
    await waitFor(() => messages.some((m) => m.type === type), 8000, `anchor message ${type}`);
    return messages.find((m) => m.type === type) as Extract<AnchorToDaemon, { type: T }>;
  };
  return {
    child, nonce, messages, stdout: () => out, stderr: () => err, stdoutBytes: () => bytes, exited,
    ready: find("anchor_ready"), exitMessage: find("child_exit"),
    info: async () => { await waitFor(() => out.includes("\n"), 8000, "child info"); const info = JSON.parse(out.split("\n")[0]!); strayPids.push(info.grandchild); return info; },
    send: (m) => child.send({ nonce, ...m }),
  };
}
const worker = (...mode: string[]) => [process.execPath, "run", FAKE_CHILD, ...mode];

describe("parseAnchorArgv", () => {
  test("accepts an optional -- separator and rejects an empty command", () => {
    expect(parseAnchorArgv(["--", "claude", "-p"])).toEqual({ command: "claude", args: ["-p"] });
    expect(parseAnchorArgv(["claude"])).toEqual({ command: "claude", args: [] });
    expect(parseAnchorArgv(["--"])).toBeUndefined();
    expect(parseAnchorArgv([])).toBeUndefined();
  });
});

describe("child anchor containment (XR-3.6)", () => {
  test("the anchor leads its own process group and the child and grandchild live in it", async () => {
    const a = startAnchor(worker("hold"));
    const ready = await a.ready();
    const info = await a.info();
    expect(ready.anchorPid).toBe(a.child.pid!);
    expect(ready.workerPid).toBe(info.child);
    expect(pgidOf(a.child.pid!)).toBe(a.child.pid!);
    expect(pgidOf(info.child)).toBe(a.child.pid!);
    expect(pgidOf(info.grandchild)).toBe(a.child.pid!);
    expect(pgidOf(process.pid)).not.toBe(a.child.pid!);
  });

  test("IPC loss (daemon death) SIGKILLs the whole group, grandchildren included", async () => {
    const a = startAnchor(worker("hold"));
    await a.ready();
    const info = await a.info();
    a.child.disconnect();
    await waitFor(() => ![a.child.pid!, info.child, info.grandchild].some(isAlive), 6000, "group death");
  });

  test("an anchor started without an IPC channel refuses to run the child", async () => {
    const a = startAnchor(worker("hold"), { ipc: false });
    await waitFor(() => !isAlive(a.child.pid!), 6000, "anchor exit");
    expect(a.stdout()).toBe("");
  });

  test("the anchor does not exit when the child ends; it waits for the daemon's cleanup acknowledgement", async () => {
    const a = startAnchor(worker("exit", "0"));
    const exit = await a.exitMessage();
    expect(exit).toMatchObject({ code: 0, signal: null, drained: true });
    await sleep(500);
    expect(isAlive(a.child.pid!)).toBe(true);
    a.child.send({ type: "cleanup", nonce: "wrong-nonce" });
    await sleep(200);
    expect(isAlive(a.child.pid!)).toBe(true);
    a.send({ type: "cleanup" });
    await a.exited;
    expect(isAlive(a.child.pid!)).toBe(false);
  });

  test("cleanup before the child is terminal is ignored", async () => {
    const a = startAnchor(worker("hold"));
    await a.ready();
    const info = await a.info();
    a.send({ type: "cleanup" });
    await sleep(400);
    expect(isAlive(info.child)).toBe(true);
    expect(isAlive(a.child.pid!)).toBe(true);
  });

  test("messages with the wrong nonce never signal anything", async () => {
    const a = startAnchor(worker("hold"));
    await a.ready();
    const info = await a.info();
    a.child.send({ type: "signal", nonce: "nope", target: "group", signal: "SIGKILL" });
    await sleep(300);
    expect(isAlive(info.child)).toBe(true);
  });
});

describe("signal routing (XR-5.4)", () => {
  test("a worker interrupt reaches the CLI process only, not its descendants", async () => {
    const dir = tempDir();
    const mark = join(dir, "marks");
    const a = startAnchor(worker("hold"), { env: { FAKE_MARK: mark } });
    await a.ready();
    const info = await a.info();
    a.send({ type: "signal", target: "worker", signal: "SIGINT" });
    const exit = await a.exitMessage();
    expect(exit).toMatchObject({ code: 0, drained: true });
    await sleep(300);
    const marks = readFileSync(mark, "utf8");
    expect(marks).toContain("cli:SIGINT");
    expect(marks).not.toContain("grandchild");
    expect(isAlive(info.grandchild)).toBe(true); // survives until terminal cleanup
    a.send({ type: "cleanup" });
    await waitFor(() => !isAlive(info.grandchild), 4000, "grandchild cleaned");
  });

  test("group TERM is survived by the anchor; group KILL ends everything", async () => {
    const dir = tempDir();
    const mark = join(dir, "marks");
    const a = startAnchor(worker("stubborn"), { env: { FAKE_MARK: mark } });
    await a.ready();
    const info = await a.info();
    a.send({ type: "signal", target: "group", signal: "SIGTERM" });
    await waitFor(() => existsSync(mark) && readFileSync(mark, "utf8").includes("grandchild:SIGTERM") && readFileSync(mark, "utf8").includes("cli:SIGTERM"), 5000, "TERM delivered to group");
    expect([a.child.pid!, info.child, info.grandchild].every(isAlive)).toBe(true);
    a.send({ type: "signal", target: "group", signal: "SIGKILL" });
    await waitFor(() => ![a.child.pid!, info.child, info.grandchild].some(isAlive), 5000, "group KILL");
  });
});

describe("output handling and failure reporting", () => {
  test("pipes stdin to the child and its stdout back", async () => {
    const a = startAnchor(worker("echo"));
    await a.ready();
    a.child.stdin!.write("hello deck\n");
    await waitFor(() => a.stdout().includes("HELLO DECK"), 5000, "echo");
    a.child.stdin!.end();
    expect(await a.exitMessage()).toMatchObject({ code: 0, drained: true });
  });

  test("delivers every byte before reporting exit, and relays exit code and stderr", async () => {
    const a = startAnchor(worker("big"));
    const exit = await a.exitMessage();
    expect(exit).toMatchObject({ code: 3, signal: null, drained: true });
    a.send({ type: "cleanup" });
    await a.exited;
    expect(a.stdoutBytes()).toBe(4096 * 1024);
    expect(a.stderr()).toContain("done-err");
  });

  test("a descendant holding stdout open makes a code-0 exit a failure (drained=false), never success", async () => {
    const started = performance.now();
    const a = startAnchor(worker("exit0-orphan"));
    const info = await a.info();
    const exit = await a.exitMessage();
    expect(exit.code).toBe(0);
    expect(exit.drained).toBe(false);
    expect(exit.error).toMatch(/EOF/);
    expect(performance.now() - started).toBeGreaterThanOrEqual(900);
    a.send({ type: "cleanup" });
    await waitFor(() => !isAlive(info.grandchild), 4000, "orphan reaped by group cleanup");
  });

  test("an unspawnable command is reported as a failed exit", async () => {
    const a = startAnchor(["/nonexistent/deck-fake-cli"]);
    const exit = await a.exitMessage();
    expect(exit).toMatchObject({ code: 1, drained: false });
    expect(exit.error).toMatch(/spawn/i);
  });

  test("the anchor nonce is not leaked into the child environment", async () => {
    const a = startAnchor(worker("env"));
    await a.exitMessage();
    expect(a.stdout().trim()).toBe("absent");
  });
});
