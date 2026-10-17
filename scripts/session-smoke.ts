#!/usr/bin/env bun
/**
 * S1 host smoke (tasks 1.19 / BIN gate): runs a `deck` executable (the compiled binary, or the source
 * entry for tests) from fresh temp HOME/XDG/cwd with a fake native runner replayer on PATH:
 *   --version, `session self-test`, `session status` (daemon down), `session ack-claude-tos`,
 *   daemon start, `cross developer` (one prompt end to end), `session list`, `session status` (daemon up),
 *   `session stop`, daemon SIGTERM, and a scan proving no repository path reached the state dir or output.
 *
 *   bun run scripts/session-smoke.ts <deck-binary> [--runner claude|codex|opencode]
 */
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

export type SmokeCheck = { name: string; ok: boolean; detail?: unknown };
export type SmokeReport = { ok: boolean; checks: SmokeCheck[]; tempDir?: string };

const repoRoot = resolve(import.meta.dir, "..");

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
}

export async function runSessionSmoke(options: { deck: string[]; keep?: boolean; timeoutMs?: number; runner?: "claude" | "codex" | "opencode" }): Promise<SmokeReport> {
  const runner = options.runner ?? "claude";
  const checks: SmokeCheck[] = [];
  const check = (name: string, ok: boolean, detail?: unknown) => { checks.push({ name, ok, ...(ok || detail === undefined ? {} : { detail }) }); return ok; };
  const base = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), "deck-smoke-")));
  const home = join(base, "home");
  const bin = join(base, "bin");
  const cwd = join(base, "project");
  for (const d of [home, bin, cwd]) mkdirSync(d, { recursive: true });
  const log = join(base, `fake-${runner}.log`);
  const replayer = join(base, `fake-${runner}.mjs`);
  copyFileSync(resolve(repoRoot, `scripts/fixtures/fake-${runner}.mjs`), replayer);
  writeFileSync(join(bin, runner), `#!/bin/sh\nexec "${process.execPath}" "${replayer}" "$@"\n`);
  chmodSync(join(bin, runner), 0o755);
  const env: Record<string, string> = {
    HOME: home, XDG_CONFIG_HOME: join(home, ".config"), XDG_STATE_HOME: join(home, ".local", "state"), XDG_DATA_HOME: join(home, ".local", "share"),
    TMPDIR: base, PATH: `${bin}:/usr/bin:/bin`, FAKE_CLAUDE_LOG: log, FAKE_CODEX_LOG: log, FAKE_OPENCODE_LOG: log, DECK_SESSION_DAEMON_IDLE_MS: "600000",
  };
  const stateRoot = join(env.XDG_STATE_HOME!, "deck");
  const timeoutMs = options.timeoutMs ?? 60_000;
  const children = new Set<Bun.Subprocess>();
  const capturedOutput: string[] = [];
  const spawn = <T extends "ignore" | "pipe" | Blob>(args: string[], stdin: T) => {
    const proc = Bun.spawn([...options.deck, ...args], { cwd, env, stdin, stdout: "pipe", stderr: "pipe" });
    children.add(proc);
    void proc.exited.then(() => children.delete(proc));
    return proc;
  };
  const kill = (proc: Bun.Subprocess, signal: "SIGTERM" | "SIGKILL") => {
    if (proc.exitCode === null && proc.signalCode === null) proc.kill(signal);
  };
  const waitFor = async (cond: () => boolean, ms: number) => { const end = Date.now() + ms; while (Date.now() < end) { if (cond()) return true; await Bun.sleep(50); } return cond(); };
  let daemon: Bun.Subprocess<"ignore", "pipe", "pipe"> | undefined;

  const run = async (args: string[], stdin?: string) => {
    const proc = spawn(args, stdin === undefined ? "ignore" : new Blob([stdin]));
    const timer = setTimeout(() => kill(proc, "SIGKILL"), timeoutMs);
    try {
      const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
      capturedOutput.push(stdout, stderr);
      return { code, stdout, stderr };
    } finally { clearTimeout(timer); }
  };

  try {
    const version = await run(["--version"]);
    check("deck --version", version.code === 0 && /^deck \S+/m.test(version.stdout), version.stdout || version.stderr);

    const selfTest = await run(["session", "self-test", "--json"]);
    let selfOk = false;
    try { selfOk = selfTest.code === 0 && JSON.parse(selfTest.stdout).ok === true; } catch { /* reported below */ }
    check("deck session self-test", selfOk, selfTest.stdout || selfTest.stderr);

    const down = await run(["session", "status", "--json"]);
    check("session status before start: running=false", down.code === 0 && JSON.parse(down.stdout || "{}").running === false, down.stdout || down.stderr);

    // configure cross-runner (lead on claude) through the product's own acknowledgement command + config file
    const ack = await run(["session", "ack-claude-tos", "--yes"]);
    check("session ack-claude-tos --yes", ack.code === 0, ack.stdout + ack.stderr);
    const configPath = join(env.XDG_CONFIG_HOME!, "deck", "config.json");
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    config.crossRunner = { ...config.crossRunner, enabled: true, members: { lead: { runnerId: runner, modelId: runner === "opencode" ? "fixture/model" : runner === "codex" ? "gpt-5" : "haiku" } } };
    writeFileSync(configPath, JSON.stringify(config, null, 2));

    // Own the daemon process so failure cleanup never signals a PID read from disk/status.
    daemon = spawn(["internal", "session-daemon"], "ignore");
    const daemonOutput = Promise.all([new Response(daemon.stdout).text(), new Response(daemon.stderr).text()]);
    const ready = await waitFor(() => existsSync(join(stateRoot, "daemon", "daemon.json")) || daemon!.exitCode !== null, timeoutMs);
    if (!check("session daemon starts", ready && daemon.exitCode === null)) throw new Error("daemon did not start");
    const cross = spawn(["cross", "developer"], "pipe");
    const output: string[] = [];
    void (async () => { const dec = new TextDecoder(); for await (const chunk of cross.stdout) output.push(dec.decode(chunk)); })();
    const errOut: string[] = [];
    void (async () => { const dec = new TextDecoder(); for await (const chunk of cross.stderr) errOut.push(dec.decode(chunk)); })();
    const attached = await waitFor(() => output.join("").includes("Attached to"), timeoutMs);
    check("cross developer attaches to the daemon", attached, { out: output.join(""), err: errOut.join("") });
    if (!attached) throw new Error("cross developer did not attach");
    cross.stdin!.write("hello from smoke\n");
    cross.stdin!.flush();
    const replied = await waitFor(() => output.join("").includes("echo: hello from smoke") && output.join("").includes("-- turn completed --"), timeoutMs);
    check(`prompt answered end to end through the fake ${runner}`, replied, { out: output.join(""), err: errOut.join("") });
    cross.stdin!.write("/detach\n");
    cross.stdin!.flush();
    cross.stdin!.end();
    const crossCode = await waitFor(() => cross.exitCode !== null || cross.signalCode !== null, timeoutMs).then((exited) => exited ? cross.exitCode : -1);
    check("cross developer exits cleanly after /detach", crossCode === 0, crossCode);

    const list = await run(["session", "list", "--json"]);
    let sessionId = "";
    try {
      const sessions = JSON.parse(list.stdout).sessions as Array<{ sessionId: string; state: string; projectRoot: string; lead?: { runnerId: string } }>;
      sessionId = sessions[0]?.sessionId ?? "";
      check("session list: one idle session for the project", sessions.length === 1 && sessions[0]!.state === "idle" && sessions[0]!.projectRoot === realpathSync(cwd), sessions);
    } catch { check("session list: one idle session for the project", false, list.stdout || list.stderr); }

    const up = await run(["session", "status", "--json"]);
    try {
      const status = JSON.parse(up.stdout);
      check(`session status --json: daemon running with a ready ${runner} driver`, status.running === true && status.drivers?.find((d: { runnerId: string }) => d.runnerId === runner)?.probe?.status === "ready" && status.members?.lead?.blocked === null, status);
    } catch { check(`session status --json: daemon running with a ready ${runner} driver`, false, up.stdout || up.stderr); }

    // state dir contents
    const files = walk(stateRoot).map((f) => f.slice(stateRoot.length + 1));
    const events = files.find((f) => /^sessions\/[^/]+\/events\/000001\.jsonl$/.test(f));
    const eventText = events ? readFileSync(join(stateRoot, events), "utf8") : "";
    check("event log records the full turn", ["session.created", "task.created", "turn.started", "message.completed", "turn.completed", "task.result", "task.state"].every((k) => eventText.includes(`"kind":"${k}"`)), events);
    check("task credential was removed after the turn", !files.some((f) => f.endsWith("/credential")), files);
    const modeOk = (path: string, mode: number) => (statSync(path).mode & 0o777) === mode;
    check("session state is private (0700 dirs, 0600 files)", !!events && modeOk(dirname(join(stateRoot, events)), 0o700) && modeOk(join(stateRoot, events), 0o600), events);

    const calls = readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l) as { argv: string[]; configDir?: string; disableProjectConfig?: string; disableClaudeCode?: string; config?: { permission?: { task?: string }; mcp?: Record<string, unknown> }; passwordConfigured?: boolean });
    const turn = [...calls].reverse().find((c) => c.argv.includes(runner === "claude" ? "-p" : runner === "codex" ? "app-server" : "serve"));
    if (runner === "claude") {
    check("claude was started with isolated MCP/hooks and relayed approvals", !!turn && !turn.argv.includes("--bare") && turn.argv.includes("--strict-mcp-config") && turn.argv.includes("--session-id")
      && !turn.argv.includes("--dangerously-skip-permissions") && turn.argv.includes("--permission-prompt-tool") && turn.argv[turn.argv.indexOf("--permission-prompt-tool") + 1] === "mcp__deck__deck_approve" && JSON.parse(turn.argv[turn.argv.indexOf("--settings") + 1]!).disableAllHooks === true, turn?.argv);
    } else if (runner === "opencode") {
      check("opencode serves loopback with a private isolated config", !!turn && turn.argv.includes("--pure") && turn.argv.includes("127.0.0.1")
        && turn.disableProjectConfig === "true" && turn.disableClaudeCode === "true" && turn.passwordConfigured === true
        && turn.configDir?.startsWith(stateRoot) === true && turn.config?.permission?.task === "deny"
        && JSON.stringify(Object.keys(turn.config?.mcp ?? {})) === JSON.stringify(["deck"]), turn);
    } else {
      check("codex uses the native app-server", !!turn && turn.argv.includes("app-server") && turn.argv.includes("features.hooks=false")
        && turn.argv.includes("features.multi_agent=false") && turn.argv.some(a => /^mcp_servers=.*"deck-session-[^"=]+-deck"=/.test(a)), turn);
    }
    const credFileMention = turn?.argv.some((a) => a.includes("credential")) ?? false;
    check(`no inline credential in ${runner} argv`, runner === "codex"
      ? !!turn && turn.argv.filter(a => a.includes("credential")).every(a => a.includes("DECK_SESSION_CREDENTIAL_FILE") && !/Bearer |Basic |"token"=|"api_key"=/.test(a))
      : !credFileMention, turn?.argv);

    if (sessionId) {
      const stop = await run(["session", "stop", sessionId]);
      check("session stop ends the session", stop.code === 0 && stop.stdout.includes("ended"), stop.stdout + stop.stderr);
    }

    kill(daemon, "SIGTERM");
    const gone = await waitFor(() => daemon!.exitCode !== null || daemon!.signalCode !== null, timeoutMs);
    check("daemon stops on SIGTERM", gone);
    if (gone) capturedOutput.push(...await daemonOutput);
    const after = walk(stateRoot).map((f) => f.slice(stateRoot.length + 1));
    check("daemon files cleaned up (no socket/lock left)", !after.some((f) => /daemon\.(sock|lock|json)$/.test(f)), after.filter((f) => f.startsWith("daemon")));

    // the repository must not be used at runtime: nothing under state, logs or captured output may name it
    const everything = [...walk(stateRoot).map((f) => { try { return readFileSync(f, "utf8"); } catch { return ""; } }), readFileSync(log, "utf8"), ...capturedOutput, output.join(""), errOut.join("")].join("\n");
    // A source run legitimately names the repo (the entry script is part of the child commands); only the compiled binary must not.
    const sourceRun = options.deck.some((a) => /\.[cm]?[jt]sx?$/.test(a));
    check(sourceRun ? "repo-path scan skipped (source run)" : "no repository path in the state dir, logs or output", sourceRun || !everything.includes(repoRoot), repoRoot);
  } catch (error) {
    check("smoke completed without exceptions", false, (error as Error).message);
  } finally {
    // Give the daemon its normal shutdown path (which terminates owned anchors/runner children).
    if (daemon) {
      kill(daemon, "SIGTERM");
      await waitFor(() => !children.has(daemon!), 5000);
    }
    for (const proc of children) kill(proc, "SIGKILL");
    await Promise.all([...children].map((proc) => proc.exited));
    if (!options.keep) rmSync(base, { recursive: true, force: true });
  }
  return { ok: checks.every((c) => c.ok), checks, ...(options.keep ? { tempDir: base } : {}) };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const runnerIndex = args.indexOf("--runner");
  const runner = runnerIndex < 0 ? "claude" : args[runnerIndex + 1];
  if (!["claude", "codex", "opencode"].includes(runner!)) { console.error("Invalid --runner"); process.exit(2); }
  const deck = args.filter((a, i) => a !== "--keep" && i !== runnerIndex && (runnerIndex < 0 || i !== runnerIndex + 1));
  if (deck.length === 0) { console.error("usage: bun run scripts/session-smoke.ts <deck-binary> [--runner claude|codex|opencode] [--keep]"); process.exit(2); }
  const report = await runSessionSmoke({ deck, keep: process.argv.includes("--keep"), runner: runner as "claude" | "codex" | "opencode" });
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.ok ? 0 : 1);
}
