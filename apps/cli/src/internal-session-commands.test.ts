import { afterEach, describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ensureDaemon, pingDaemon, resolveStatePaths, spawnDetachedDaemon } from "@deck/session-host";

/**
 * Production composition check: the hidden `deck internal child-anchor|session-daemon|session-mcp`
 * routes go through main.tsx and @deck/session-host, with no repository state and no network.
 */
const MAIN = resolve(import.meta.dir, "main.tsx");
const dirs: string[] = [];
const daemonPids: number[] = [];

function sandbox() {
  const base = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), "deck-int-")));
  dirs.push(base);
  const env = { ...process.env, HOME: base, XDG_STATE_HOME: join(base, "state"), XDG_CONFIG_HOME: join(base, "config"), XDG_DATA_HOME: join(base, "data"), TMPDIR: base } as Record<string, string>;
  delete env.DECK_STANDALONE_WEB_SEARCH_SMOKE;
  return { base, env, paths: resolveStatePaths({ env, tmpdir: base }) };
}

afterEach(() => {
  for (const pid of daemonPids.splice(0)) { try { process.kill(pid, "SIGKILL"); } catch { /* gone */ } }
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const waitFor = async (cond: () => boolean, ms: number, label: string) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (cond()) return; await new Promise((r) => setTimeout(r, 25)); }
  throw new Error(`Timed out waiting for ${label}`);
};

describe("deck internal session-daemon", () => {
  test("starts through main.tsx, is discoverable, stops on SIGTERM and leaves no repo paths in its state", async () => {
    const s = sandbox();
    const command = [process.execPath, MAIN, "internal", "session-daemon"];
    const r = await ensureDaemon({ paths: s.paths, clientVersion: "0.0.0", spawnDaemon: () => spawnDetachedDaemon(command, s.env), timeoutMs: 20000 });
    daemonPids.push(r.daemon.pid);
    expect(r.started).toBe(true);
    expect((await pingDaemon(s.paths.socket.path))?.pid).toBe(r.daemon.pid);
    // pre-SessionManager build: commands are refused, not crashed
    const { ControlClient } = await import("@deck/session-host");
    const c = await ControlClient.connect(s.paths.socket.path);
    const reply = await c.command({ v: 1, commandId: crypto.randomUUID(), type: "session.create", projectRoot: "/p" });
    c.close();
    expect(reply.outcome).toMatchObject({ ok: false, code: "session-manager-unavailable" });
    process.kill(r.daemon.pid, "SIGTERM");
    await waitFor(() => { try { process.kill(r.daemon.pid, 0); return false; } catch { return true; } }, 10000, "daemon exit");
    const repo = resolve(import.meta.dir, "../../..");
    const logs = Bun.spawnSync(["grep", "-rl", repo, s.base]).stdout.toString();
    expect(logs).toBe("");
  }, 60000);
});

describe("deck internal child-anchor", () => {
  test("runs the command behind IPC, reports ready/exit, and ends only after cleanup", async () => {
    const s = sandbox();
    const nonce = "cli-nonce";
    const child = spawn(process.execPath, [MAIN, "internal", "child-anchor", "--", process.execPath, "-e", "console.log('from-child')"], {
      detached: true, stdio: ["pipe", "pipe", "pipe", "ipc"], env: { ...s.env, DECK_ANCHOR_NONCE: nonce },
    });
    daemonPids.push(child.pid!);
    const messages: Array<{ type: string; code?: number; drained?: boolean }> = [];
    let out = "";
    child.on("message", (m) => { messages.push(m as never); });
    child.stdout!.on("data", (d: Buffer) => { out += d.toString(); });
    await waitFor(() => messages.some((m) => m.type === "child_exit"), 20000, "child_exit");
    expect(messages.find((m) => m.type === "anchor_ready")).toBeDefined();
    expect(messages.find((m) => m.type === "child_exit")).toMatchObject({ code: 0, drained: true });
    expect(() => process.kill(child.pid!, 0)).not.toThrow(); // still alive: waiting for cleanup
    child.send({ type: "cleanup", nonce });
    await new Promise<void>((r) => child.once("close", () => r()));
    expect(out).toContain("from-child");
  }, 60000);

  test("an empty command is a usage error", () => {
    const s = sandbox();
    const r = Bun.spawnSync([process.execPath, MAIN, "internal", "child-anchor"], { env: s.env });
    expect(r.exitCode).toBe(1);
    expect(r.stderr.toString()).toContain("Usage: deck internal child-anchor");
  }, 30000);
});

describe("deck internal session-mcp", () => {
  test("speaks MCP on stdio and reports a missing credential as a tool error", async () => {
    const s = sandbox();
    delete s.env.DECK_SESSION_CREDENTIAL_FILE;
    const child = spawn(process.execPath, [MAIN, "internal", "session-mcp"], { env: s.env, stdio: ["pipe", "pipe", "inherit"] });
    daemonPids.push(child.pid!);
    let out = "";
    child.stdout!.on("data", (d: Buffer) => { out += d.toString(); });
    const send = (m: unknown) => child.stdin!.write(`${JSON.stringify({ jsonrpc: "2.0", ...(m as object) })}\n`);
    send({ id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } });
    send({ id: 2, method: "tools/list" });
    send({ id: 3, method: "tools/call", params: { name: "deck_status", arguments: {} } });
    await waitFor(() => out.split("\n").filter(Boolean).length >= 3, 20000, "three replies");
    const lines = out.split("\n").filter(Boolean).map((l) => JSON.parse(l));
    expect(lines.every((l) => l.jsonrpc === "2.0")).toBe(true); // stdout carries only JSON-RPC frames
    expect(lines[0].result.serverInfo.name).toBe("deck");
    expect(lines[1].result.tools.map((t: { name: string }) => t.name).sort()).toEqual(["deck_approve", "deck_status"]);
    expect(lines[2].result).toMatchObject({ isError: true });
    expect(lines[2].result.content[0].text).toContain("credential-unavailable");
    child.stdin!.end();
    await new Promise<void>((r) => child.once("exit", () => r()));
  }, 60000);
});
