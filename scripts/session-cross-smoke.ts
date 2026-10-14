#!/usr/bin/env bun
/** Copy this script and fixtures to a no-network sandbox; requires only Bun and --deck binary. --source skips the repository-path assertion for a development wrapper. */
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

const args = process.argv.slice(2);
const input = args.includes("--deck") ? args[args.indexOf("--deck") + 1] : undefined;
if (!input?.startsWith("/")) throw new Error("--deck requires an absolute binary path");
const base = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), "deck-cross-bin-")));
const home = join(base, "home"), bin = join(base, "bin"), project = join(base, "project");
for (const dir of [home, bin, project]) mkdirSync(dir);
// Copy the artifact into isolated runtime state so no launch plan contains its source path.
const deck = join(bin, "deck"); copyFileSync(input, deck); chmodSync(deck, 0o755);
const quoted = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
for (const runner of ["claude", "codex", "opencode"]) {
  const fixture = join(base, `fake-${runner}.mjs`);
  copyFileSync(resolve(import.meta.dir, `fixtures/fake-${runner}.mjs`), fixture);
  writeFileSync(join(bin, runner), `#!/bin/sh\nexec ${quoted(process.execPath)} ${quoted(fixture)} "$@"\n`); chmodSync(join(bin, runner), 0o755);
}
const env = { HOME: home, XDG_CONFIG_HOME: join(home, ".config"), XDG_STATE_HOME: join(home, ".local/state"), XDG_DATA_HOME: join(home, ".local/share"), TMPDIR: base, PATH: `${bin}:/usr/bin:/bin`, DECK_SESSION_DAEMON_IDLE_MS: "600000", FAKE_CLAUDE_CROSS: "1", FAKE_CROSS_TASK_FILE: join(base, "tasks.json"), FAKE_CLAUDE_LOG: join(base, "claude.log"), FAKE_CODEX_LOG: join(base, "codex.log"), FAKE_OPENCODE_LOG: join(base, "opencode.log") };
const owned = new Set<Bun.Subprocess>();
const captured: string[] = [];
const spawn = (parameters: string[], stdin: "pipe" | "ignore" = "ignore") => {
  const child = Bun.spawn([deck, ...parameters], { cwd: project, env, stdin, stdout: "pipe", stderr: "pipe" });
  owned.add(child); void child.exited.then(() => owned.delete(child)); return child;
};
const run = async (parameters: string[]) => {
  const child = spawn(parameters);
  const timer = setTimeout(() => child.kill("SIGTERM"), 30_000);
  try {
    const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    captured.push(out, err); if (code !== 0) throw new Error(`CLI ${parameters[0]} failed`); return out;
  } finally { clearTimeout(timer); }
};
const until = async (predicate: () => boolean | Promise<boolean>, label: string) => {
  const deadline = Date.now() + 30_000;
  while (!await predicate()) { if (Date.now() > deadline) throw new Error(`Timeout: ${label}`); await Bun.sleep(25); }
};
const checks: string[] = [];
const check = (label: string, value: boolean) => { if (!value) throw new Error(label); checks.push(label); };
const state = join(env.XDG_STATE_HOME, "deck");
let daemon: ReturnType<typeof spawn> | undefined;
let daemonOutput: Promise<string[]> | undefined;
try {
  await run(["session", "ack-claude-tos", "--yes"]);
  const configPath = join(env.XDG_CONFIG_HOME, "deck/config.json");
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  const portProbe = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("fixture") }); const webPort = portProbe.port; portProbe.stop(true);
  config.crossRunner = { ...config.crossRunner, enabled: true, members: { lead: { runnerId: "claude", modelId: "haiku" }, architect: { runnerId: "codex", modelId: "recorded-model" }, "apply-fast": { runnerId: "opencode", modelId: "fake/model" } }, web: { ...config.crossRunner?.web, port: webPort } };
  writeFileSync(configPath, JSON.stringify(config));
  daemon = spawn(["internal", "session-daemon"]);
  daemonOutput = Promise.all([new Response(daemon.stdout).text(), new Response(daemon.stderr).text()]);
  await until(() => existsSync(join(state, "daemon/daemon.json")), "daemon ready");
  const terminal = spawn(["cross", "developer"], "pipe"); let output = "";
  const terminalOutput = (async () => { for await (const chunk of terminal.stdout) output += new TextDecoder().decode(chunk); return output; })();
  const terminalError = new Response(terminal.stderr).text();
  await until(() => output.includes("Attached to"), "terminal attach");
  const list = JSON.parse(await run(["session", "list", "--json"]));
  const sessionId = list.sessions[0].sessionId;
  const eventsDir = join(state, "sessions", sessionId, "events");
  const events = (): Array<{ seq: number; kind: string; source: Record<string, string>; data: Record<string, unknown> }> => readdirSync(eventsDir).filter((name) => name.endsWith(".jsonl")).sort().flatMap((name) => readFileSync(join(eventsDir, name), "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line)));
  terminal.stdin!.write("cross-smoke-delegate\n");
  await until(() => ["architect", "apply-fast"].every((member) => events().some((event) => event.kind === "task.state" && event.source.memberId === member && event.data.state === "completed")), "both delegated runners");
  await until(async () => JSON.parse(await run(["session", "list", "--json"])).sessions[0].running === false, "Lead completion and wake drain");
  check("three runner turns", ["claude", "codex", "opencode"].every((runner) => events().some((event) => event.kind === "turn.started" && event.source.runnerId === runner)));
  check("actual bridge delegation and task results", events().filter((event) => event.kind === "task.created" && event.source.taskId !== "lead").length === 2 && events().filter((event) => event.kind === "task.result" && event.source.taskId !== "lead").length === 2);
  config.crossRunner.members.architect = { runnerId: "opencode", modelId: "changed-model" }; writeFileSync(configPath, JSON.stringify(config));
  terminal.stdin!.write("cross-smoke-continue\n");
  await until(() => events().some((event) => event.kind === "task.continued" && event.source.memberId === "architect"), "owner continuation");
  await until(async () => JSON.parse(await run(["session", "list", "--json"])).sessions[0].running === false, "continued turn drain");
  const continued = events().find((event) => event.kind === "task.continued" && event.source.memberId === "architect")!;
  check("recorded Codex owner and native session", continued.source.runnerId === "codex" && continued.data.nativeSessionId === "fake-thread");
  const codexCalls = readFileSync(env.FAKE_CODEX_LOG, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  check("continued Codex process launched", codexCalls.filter((call) => call.argv.includes("app-server")).length >= 4);
  terminal.stdin!.write("/detach\n"); terminal.stdin!.end(); await terminal.exited;
  captured.push(await terminalOutput, await terminalError);
  await run(["session", "stop", sessionId]);
  check("session terminal state", JSON.parse(await run(["session", "list", "--json"])).sessions[0].state === "ended");
  daemon.kill("SIGTERM"); await daemon.exited; captured.push(...await daemonOutput);
  const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]);
  const forbidden = process.env.DECK_TEST_REPOSITORY_PATH ?? resolve(import.meta.dir, "..");
  if (!args.includes("--source")) check("runtime has no repository references", ![...captured, ...walk(home).filter((file) => !["daemon.sock"].includes(basename(file))).map((file) => { try { return readFileSync(file, "utf8"); } catch { return ""; } })].some((value) => value.includes(forbidden)));
  console.log(JSON.stringify({ ok: true, checks }));
} finally {
  for (const child of owned) if (child.exitCode === null) child.kill("SIGTERM");
  await Promise.all([...owned].map((child) => child.exited)); rmSync(base, { recursive: true, force: true });
}
