#!/usr/bin/env bun
/** Opt-in, direct-host startup observation. Never run as part of the test suite. */
import { randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, relative, isAbsolute } from "node:path";
import type { CrossRunnerConfig } from "../packages/core/src/config/deck-config";
import type { SessionEvent } from "../packages/core/src/session/events";
import { projectTurn } from "./session-startup-projection";
import { createClaudeSessionDriver } from "../packages/adapter-claude/src/session-driver/driver";
import { createCodexSessionDriver } from "../packages/adapter-codex/src/session-driver/driver";
import { createOpenCodeSessionDriver } from "../packages/adapter-opencode/src/session-driver/driver";
import { startDaemon, type RunningDaemon } from "../packages/session-host/src/daemon";
import { ControlClient } from "../packages/session-host/src/control-client";
import { SessionManager } from "../packages/session-host/src/session-manager";
import { resolveStatePaths } from "../packages/session-host/src/paths";

const usage = "Usage: bun run scripts/session-startup-live.ts --runner codex|claude|opencode --model MODEL [--resumes 0..5] [--timeout-seconds 30..600] [--deck BINARY] [--codex-mcp-detail full|default]";
const args = process.argv.slice(2);
if (args.length === 1 && args[0] === "--help") { console.log(usage); process.exit(0); }
const options = new Map<string, string>();
for (let i = 0; i < args.length; i += 2) {
  const key = args[i], value = args[i + 1];
  if (!key || !["--runner", "--model", "--resumes", "--timeout-seconds", "--deck", "--codex-mcp-detail"].includes(key) || !value || value.startsWith("--") || options.has(key)) { console.error(usage); process.exit(2); }
  options.set(key, value);
}
const runner = options.get("--runner");
const model = options.get("--model");
const codexMcpDetail = options.get("--codex-mcp-detail") ?? "default";
const resumes = Number(options.get("--resumes") ?? "2");
const timeoutSeconds = Number(options.get("--timeout-seconds") ?? "240");
if (!runner || !["codex", "claude", "opencode"].includes(runner) || !model || model.length > 200 || !["full", "default"].includes(codexMcpDetail) || (runner !== "codex" && options.has("--codex-mcp-detail")) || !Number.isInteger(resumes) || resumes < 0 || resumes > 5 || !Number.isInteger(timeoutSeconds) || timeoutSeconds < 30 || timeoutSeconds > 600) { console.error(usage); process.exit(2); }
const command = options.has("--deck") ? [resolve(options.get("--deck")!)] : [process.execPath, resolve(import.meta.dir, "../apps/cli/src/main.tsx")];
const base = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), "ds-")));
const project = join(base, "project");
let daemon: RunningDaemon | undefined;
let client: ControlClient | undefined;
let manager: SessionManager | undefined;
let timedOut = false;
const deadline = Date.now() + timeoutSeconds * 1000;
const timer = setTimeout(() => { timedOut = true; void daemon?.stop("startup-canary-timeout"); }, timeoutSeconds * 1000);
// An unresponsive native process must not leave the opt-in canary running forever.
const hardTimer = setTimeout(() => {
  try { capture?.(); } catch { /* Preserve whatever evidence is available. */ }
  try { rmSync(base, { recursive: true, force: true }); } catch { /* Best effort if shutdown itself hangs. */ }
  if (turns.length && !turns.at(-1)!.outcome) turns.at(-1)!.outcome = "deadline";
  output.outcome = "shutdown-deadline";
  console.log(JSON.stringify(output, null, 2));
  process.exit(1);
}, (timeoutSeconds + 15) * 1000);
const output: Record<string, unknown> = { runner, coverage: "direct host; excludes browser and CLI childMcp/nativeRole composition; native environment and authentication inherited; Deck state isolated", turns: [] };
if (runner === "codex") output.codexMcpDetail = codexMcpDetail;
const turns = output.turns as Record<string, unknown>[];
let capture: (() => void) | undefined;

try {
  mkdirSync(project);
  const paths = resolveStatePaths({ env: { HOME: base, XDG_STATE_HOME: join(base, "state") }, tmpdir: base });
  const socketRelative = relative(base, paths.socket.path);
  if (!socketRelative || socketRelative.startsWith("..") || isAbsolute(socketRelative) || paths.socket.path === resolveStatePaths().socket.path) throw new Error("socket-isolation");
  const drivers = [createClaudeSessionDriver({ tosAcknowledged: () => true, extraArgs: ["--tools", ""] }), createCodexSessionDriver(codexMcpDetail === "full" ? { mcpStatusDetail: "full" } : undefined), createOpenCodeSessionDriver()];
  const driver = drivers.find(d => d.runnerId === runner)!;
  const probe = await driver.probe({ cwd: project });
  output.probeStatus = probe.status;
  if (probe.version && /^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/.test(probe.version)) output.version = probe.version;
  if (probe.status === "blocked") throw new Error("driver-blocked");
  const config: CrossRunnerConfig = { enabled: true, members: { lead: { runnerId: runner as "codex" | "claude" | "opencode", modelId: model } }, approvals: { claude: "relay", codex: "relay", opencode: "relay" }, maxConcurrentTasks: 1, claudeTosAcknowledgedAt: new Date().toISOString(), web: { port: 7421, trustedProxy: null, allowedOrigins: [], allowFunnel: false } };
  const started = await startDaemon({ paths, version: "startup-canary", anchorCommand: [...command, "internal", "child-anchor"], createService: services => {
    manager = new SessionManager({ ...services, drivers: { get: id => drivers.find(d => d.runnerId === id), list: () => drivers }, config: () => config, sessionMcpCommand: [...command, "internal", "session-mcp"], rolePrompt: () => "Reply briefly. Do not use tools, delegate, access files, run commands, or browse." });
    return manager;
  } });
  if (!started.ok) throw new Error("daemon-start");
  daemon = started.daemon;
  client = await ControlClient.connect(paths.socket.path);
  const created = await client.command({ v: 1, commandId: randomUUID(), type: "session.create", projectRoot: project });
  if (!created.outcome.ok) throw new Error("session-create");
  const sessionId = (created.outcome.data as { sessionId: string }).sessionId;
  const events = () => [...manager!.openLog(sessionId)!.readAfter(0)];
  for (let index = 0; index <= resumes; index++) {
    const cursor = events().at(-1)?.seq ?? 0;
    const submittedAt = Date.now();
    const sent = await client.command({ v: 1, commandId: randomUUID(), type: "prompt.send", text: "Reply with a short greeting. Do not use tools." }, sessionId);
    const turn: Record<string, unknown> = { requestedContinuity: index ? "resume" : "new", submissionAckMs: Date.now() - submittedAt, accepted: sent.outcome.ok };
    turns.push(turn);
    capture = () => Object.assign(turn, projectTurn(events().filter(e => e.seq > cursor && e.source.taskId === "lead"), submittedAt));
    if (!sent.outcome.ok) throw new Error("prompt-refused");
    let observed: SessionEvent[] = [];
    while (true) {
      observed = events().filter(e => e.seq > cursor && e.source.taskId === "lead");
      const completed = observed.find(e => e.kind === "turn.completed");
      const failed = observed.find(e => e.kind === "task.state" && ["failed", "cancelled", "interrupted"].includes(String(e.data.state)));
      if (completed || failed) { turn.outcome = completed && ["completed", "failed", "interrupted", "interrupted-forced"].includes(String(completed.data.status)) ? completed.data.status : "failed"; break; }
      if (timedOut || Date.now() >= deadline) throw new Error("deadline");
      await new Promise(r => setTimeout(r, 50));
    }
    // Wait for host bookkeeping to settle before submitting the next continuation.
    while (manager!.hasRunningWork()) { if (timedOut || Date.now() >= deadline) throw new Error("deadline"); await new Promise(r => setTimeout(r, 50)); }
    capture();
    if (turn.outcome !== "completed") throw new Error("turn-failed");
  }
  output.outcome = "completed";
} catch (error) {
  const known = ["socket-isolation", "driver-blocked", "daemon-start", "session-create", "prompt-refused", "deadline", "turn-failed"];
  output.outcome = timedOut ? "deadline" : error instanceof Error && known.includes(error.message) ? error.message : "runtime-failure";
  process.exitCode = 1;
} finally {
  try { capture?.(); } catch { /* Preserve previously captured evidence. */ }
  clearTimeout(timer);
  client?.close();
  try { await daemon?.stop("startup-canary-complete"); } catch { output.cleanup = "daemon-stop-failed"; process.exitCode = 1; }
  try { capture?.(); } catch { /* The log may have closed during shutdown. */ }
  if (output.outcome === "deadline" && turns.length && !turns.at(-1)!.outcome) turns.at(-1)!.outcome = "deadline";
  try { rmSync(base, { recursive: true, force: true }); } catch { output.cleanup = "temporary-state-removal-failed"; process.exitCode = 1; }
  clearTimeout(hardTimer);
}
console.log(JSON.stringify(output, null, 2));
