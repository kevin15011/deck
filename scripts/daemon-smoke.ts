#!/usr/bin/env bun
/** Standalone/offline lifecycle acceptance. Copy beside any compiled Deck binary and pass --deck /absolute/path. */
import { randomUUID } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2), input = args[args.indexOf("--deck") + 1];
if (!args.includes("--deck") || !input?.startsWith("/")) throw new Error("--deck requires an absolute compiled binary path");
const base = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), "deck-daemon-bin-")));
const home = join(base, "home"), bin = join(base, "bin"), project = join(base, "project");
for (const dir of [home, bin, project]) mkdirSync(dir);
const deck = join(bin, "deck-canary"); copyFileSync(input, deck); chmodSync(deck, 0o755);
writeFileSync(join(bin, "claude"), `#!/bin/sh\nprintf '2.1.296 (Claude Code)\\n'\n`); chmodSync(join(bin, "claude"), 0o755);
const env = { HOME: home, XDG_CONFIG_HOME: join(home, ".config"), XDG_STATE_HOME: join(base, "state"), XDG_DATA_HOME: join(home, ".local/share"), TMPDIR: base, PATH: `${bin}:/usr/bin:/bin`, DECK_SESSION_DAEMON_IDLE_MS: "600000" };
const state = join(env.XDG_STATE_HOME, "deck"), daemonDir = join(state, "daemon");
const configDir = join(env.XDG_CONFIG_HOME, "deck"); mkdirSync(configDir, { recursive: true });
writeFileSync(join(configDir, "config.json"), JSON.stringify({ crossRunner: { enabled: true, members: { lead: { runnerId: "claude", modelId: "haiku" } } } }));
const checks: string[] = [];
const check = (name: string, condition: boolean) => { if (!condition) throw new Error(name); checks.push(name); };
const run = async (parameters: string[]) => {
  const child = Bun.spawn([deck, ...parameters], { cwd: project, env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const timer = setTimeout(() => child.kill("SIGTERM"), 25_000);
  try {
    const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    if (code !== 0) throw new Error(`CLI ${parameters.join(" ")} failed (${code}): ${err || out}`);
    return out;
  } finally { clearTimeout(timer); }
};
const lifecycle = async (action: string) => JSON.parse(await run(["daemon", action, "--json"]));
const request = (frame: Record<string, unknown>): Promise<any> => new Promise((resolve, reject) => {
  const socket = net.createConnection(join(daemonDir, "daemon.sock"));
  let buffer = "";
  const finish = (error?: Error, value?: unknown) => { clearTimeout(timer); socket.destroy(); error ? reject(error) : resolve(value); };
  const timer = setTimeout(() => finish(new Error("Control request timed out")), 5000);
  socket.on("error", (error) => finish(error));
  socket.on("connect", () => socket.write(`${JSON.stringify({ ...frame, id: "smoke" })}\n`));
  socket.on("data", (chunk) => { buffer += String(chunk); if (buffer.includes("\n")) { try { finish(undefined, JSON.parse(buffer.split("\n")[0]!)); } catch (error) { finish(error as Error); } } });
});
let stopped = false;
try {
  check("daemon help explains detached lifecycle", (await run(["daemon", "--help"])).includes("Ctrl+C"));
  for (const action of ["status", "stop"]) check(`${action} absent is inert`, (await lifecycle(action)).outcome === "not-running" && !existsSync(state));
  const first = await lifecycle("start"); check("start launches a detached daemon", first.outcome === "started" && first.running);
  const again = await lifecycle("start"); check("start is idempotent", again.outcome === "already-running" && again.daemon.nonce === first.daemon.nonce);
  const status = await lifecycle("status"); check("status observes actual identity", status.daemon.pid === first.daemon.pid && status.daemon.nonce === first.daemon.nonce);
  const created = await request({ t: "command", command: { v: 1, commandId: randomUUID(), type: "session.create", projectRoot: project } });
  check("session created without inference", created.outcome.ok === true);
  const sessionId = created.outcome.data.sessionId, sessionDir = join(state, "sessions", sessionId);
  const meta = readFileSync(join(sessionDir, "session.json"), "utf8");
  const events = readdirSync(join(sessionDir, "events")).filter((name) => name.endsWith(".jsonl")).sort().map((name) => readFileSync(join(sessionDir, "events", name), "utf8")).join("");
  const replacement = await lifecycle("restart");
  check("restart replaces an equal-version daemon", replacement.outcome === "restarted" && replacement.daemon.pid !== first.daemon.pid && replacement.daemon.nonce !== first.daemon.nonce && replacement.daemon.version === first.daemon.version);
  check("restart settles the old process", (() => { try { process.kill(first.daemon.pid, 0); return false; } catch (error) { return (error as NodeJS.ErrnoException).code === "ESRCH"; } })());
  const sessions = await request({ t: "query", name: "sessions.list" });
  check("restart preserves session identity and recorded runner", sessions.outcome.data.sessions.some((s: any) => s.sessionId === sessionId && s.lead.runnerId === "claude" && s.lead.modelId === "haiku" && s.state !== "ended"));
  check("restart preserves session metadata", readFileSync(join(sessionDir, "session.json"), "utf8") === meta);
  const afterEvents = readdirSync(join(sessionDir, "events")).filter((name) => name.endsWith(".jsonl")).sort().map((name) => readFileSync(join(sessionDir, "events", name), "utf8")).join("");
  check("restart preserves existing event history", afterEvents.startsWith(events) && !afterEvents.includes('"kind":"session.ended"'));
  const stop = await lifecycle("stop"); stopped = true;
  check("stop confirms lock and discovery cleanup", stop.outcome === "stopped" && !existsSync(join(daemonDir, "daemon.lock")) && !existsSync(join(daemonDir, "daemon.json")) && !existsSync(join(daemonDir, "daemon.sock")));
  check("stop preserves session history", existsSync(join(sessionDir, "session.json")));
  check("status after stop stays inert", (await lifecycle("status")).outcome === "not-running");
  const absentRestart = await lifecycle("restart"); stopped = false;
  check("restart absent launches current executable", absentRestart.outcome === "started" && absentRestart.daemon.nonce !== replacement.daemon.nonce);
  await lifecycle("stop"); stopped = true;
  console.log(JSON.stringify({ ok: true, checks }));
} finally {
  if (!stopped) { try { await lifecycle("stop"); stopped = true; } catch { /* Keep state for diagnosis if shutdown is unconfirmed. */ } }
  if (stopped) rmSync(base, { recursive: true, force: true });
  else console.error(`Unconfirmed fixture shutdown; retained isolated state: ${base}`);
}
