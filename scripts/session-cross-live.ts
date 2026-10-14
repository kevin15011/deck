#!/usr/bin/env bun
/** Opt-in native CLI acceptance; never imported by tests. No provider memory writes. */
import { mkdtempSync, mkdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { CrossRunnerConfig } from "../packages/core/src/config/deck-config";
import { redactText } from "../packages/core/src/session/redaction";
import { createClaudeSessionDriver } from "../packages/adapter-claude/src/session-driver/driver";
import { createCodexSessionDriver } from "../packages/adapter-codex/src/session-driver/driver";
import { createOpenCodeSessionDriver } from "../packages/adapter-opencode/src/session-driver/driver";
import { startDaemon, type RunningDaemon } from "../packages/session-host/src/daemon";
import { ControlClient } from "../packages/session-host/src/control-client";
import { SessionManager } from "../packages/session-host/src/session-manager";
import { resolveStatePaths } from "../packages/session-host/src/paths";
import { liveApprovalDecision } from "./session-live-approvals";

const args = process.argv.slice(2);
if (args.some((arg, i) => arg !== "--deck" && args[i - 1] !== "--deck")) throw new Error("usage: bun run scripts/session-cross-live.ts [--deck compiled-binary]");
const deck = args.includes("--deck") ? resolve(args[args.indexOf("--deck") + 1]!) : undefined;
const command = deck ? [deck] : [process.execPath, resolve(import.meta.dir, "../apps/cli/src/main.tsx")];
const base = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), "deck-cross-live-")));
const project = join(base, "project"); mkdirSync(project);
const paths = resolveStatePaths({ env: { HOME: base, XDG_STATE_HOME: join(base, "state") }, tmpdir: base });
const config: CrossRunnerConfig = { enabled: true, members: { lead: { runnerId: "claude", modelId: "haiku" }, architect: { runnerId: "codex", modelId: "gpt-6-luna" }, "apply-fast": { runnerId: "opencode", modelId: "opencode/big-pickle" } }, approvals: { claude: "relay", codex: "relay", opencode: "relay" }, maxConcurrentTasks: 4, claudeTosAcknowledgedAt: new Date().toISOString(), web: { port: 7421, trustedProxy: null, allowedOrigins: [], allowFunnel: false } };
const captured: Record<string, { promptRecall: boolean; promptPropose: boolean; advertisedRecall: boolean; advertisedPropose: boolean }> = {};
const drivers = [createClaudeSessionDriver({ tosAcknowledged: () => true, extraArgs: ["--tools", ""] }), createCodexSessionDriver(), createOpenCodeSessionDriver()].map((driver) => ({ ...driver, startTask: (input: Parameters<typeof driver.startTask>[0], io: Parameters<typeof driver.startTask>[1]) => {
  captured[input.memberId] = { promptRecall: input.prompt.includes("deck_memory_recall"), promptPropose: input.prompt.includes("deck_memory_propose"), advertisedRecall: input.mcp.sessionTools.includes("deck_memory_recall"), advertisedPropose: input.mcp.sessionTools.includes("deck_memory_propose") };
  return driver.startTask(input, io);
} }));
const checks: Record<string, boolean | number> = {};
const writes: string[] = [];
let daemon: RunningDaemon | undefined;
let client: ControlClient | undefined;
let manager!: SessionManager;
let cancelled = false;
let activeSessionId: string | undefined;
const deadline = Date.now() + 240_000;
const timeout = setTimeout(() => { cancelled = true; void daemon?.stop("live-timeout"); }, 240_000);
const wait = async (predicate: () => boolean) => {
  while (!predicate()) {
    if (activeSessionId) {
      const events = [...manager.openLog(activeSessionId)!.readAfter(0)];
      if (events.some((event) => event.kind === "task.state" && ["failed", "cancelled", "interrupted"].includes(String(event.data.state)))) throw new Error("native-task-failed");
      if (events.some((event) => event.kind === "task.state" && event.source.taskId === "lead" && event.data.state === "completed") && events.filter((event) => event.kind === "task.created" && event.source.taskId !== "lead").length < 2) throw new Error("lead-did-not-delegate");
    }
    if (cancelled || Date.now() >= deadline) throw new Error("live-deadline"); await new Promise((resolve) => setTimeout(resolve, 100));
  }
};
try {
  const probes = await Promise.all(drivers.map((driver) => driver.probe({ cwd: project })));
  checks.driversReady = probes.every((probe) => probe.status !== "blocked");
  if (!checks.driversReady) throw new Error("native-driver-blocked");
  const started = await startDaemon({ paths, version: "cross-live", anchorCommand: [...command, "internal", "child-anchor"], createService: (services) => {
    manager = new SessionManager({ ...services, drivers: { get: (id) => drivers.find((driver) => driver.runnerId === id), list: () => drivers }, config: () => config, sessionMcpCommand: [...command, "internal", "session-mcp"], rolePrompt: (member) => `You are ${member} in a bounded integration check. Use only Deck MCP tools. Do not use shell, files, native tasks, or web search. Do not repeat completed work. Memory is advisory. Delegate only when explicitly requested by the initial user instruction. Completion notices require results only.`, memory: async () => ({ recall: async () => ({ ok: true, advisoryText: "Synthetic project memory for acceptance only." }), propose: async (content) => { writes.push(content); return { ok: true }; } }) });
    return manager;
  } });
  if (!started.ok) throw new Error("daemon-start-failed");
  daemon = started.daemon;
  client = await ControlClient.connect(paths.socket.path);
  const create = await client.command({ v: 1, commandId: randomUUID(), type: "session.create", projectRoot: project });
  if (!create.outcome.ok) throw new Error("session-create-failed");
  const sessionId = (create.outcome.data as { sessionId: string }).sessionId; activeSessionId = sessionId;
  const events = () => [...manager.openLog(sessionId)!.readAfter(0)];
  const seen: number[] = [];
  await client.attach(sessionId, 0, { onEvent: (event) => seen.push(event.seq) });
  const approvalTimer = setInterval(() => {
    try {
      for (const pending of daemon!.services.broker.pending()) daemon!.services.broker.respond({ approvalId: pending.approvalId, decision: liveApprovalDecision(pending, events()), by: "live-harness" });
    } catch { checks.approvalPolicyHealthy = false; cancelled = true; void daemon?.stop("live-approval-failed"); }
  }, 50);
  try {
    const task = 'Call deck_memory_recall with query "acceptance". Call deck_memory_propose with content "cross acceptance shared proposal". Then reply exactly "worker-ok". Use only these Deck MCP tools.';
    const sent = await client.command({ v: 1, commandId: randomUUID(), type: "prompt.send", text: `Use deck_delegate exactly twice: agent architect, task ${JSON.stringify(task)}; agent apply-fast, task ${JSON.stringify(task)}. Wait for both with deck_task_wait and read both with deck_task_result. Do not perform their tasks yourself. Finish with "cross-ok". Do not delegate again after a completion notice.` }, sessionId);
    if (!sent.outcome.ok) throw new Error("prompt-refused");
    await wait(() => events().filter((event) => event.kind === "task.created" && event.source.taskId !== "lead").length >= 2);
    const cursor = seen.at(-1) ?? 0;
    client.close(); await client.closed;
    await wait(() => events().filter((event) => event.kind === "task.state" && event.source.taskId !== "lead" && event.data.state === "completed").length >= 2);
    client = await ControlClient.connect(paths.socket.path);
    const replay: number[] = [];
    let caughtUp = false;
    await client.attach(sessionId, cursor, { onEvent: (event) => replay.push(event.seq), onCaughtUp: () => { caughtUp = true; } });
    await wait(() => caughtUp);
    checks.cursorReplay = replay.every((seq, index) => seq === cursor + index + 1);
    await wait(() => !manager.hasRunningWork());
    const all = events();
    checks.leadCompleted = all.some((event) => event.kind === "task.state" && event.source.taskId === "lead" && event.data.state === "completed");
    for (const member of ["architect", "apply-fast"]) {
      checks[`${member}Completed`] = all.some((event) => event.kind === "task.state" && event.source.memberId === member && event.data.state === "completed");
      checks[`${member}Recalled`] = all.some((event) => event.kind === "memory.recalled" && event.source.memberId === member && event.data.ok === true);
      checks[`${member}Proposed`] = all.some((event) => event.kind === "memory.proposed" && event.source.memberId === member);
    }
    checks.sharedWrites = writes.length;
    checks.singleWriterDeduped = writes.length === 1;
    checks.noUnexpectedTasks = all.filter((event) => event.kind === "task.created" && event.source.taskId !== "lead").length === 2;
    if (Object.values(checks).some((value) => value === false)) {
      const members = ["lead", "architect", "apply-fast"].map((memberId) => ({ memberId, ...captured[memberId], approvalsRequested: all.filter((event) => event.kind === "approval.requested" && event.source.memberId === memberId).length, approvalsDenied: all.filter((event) => event.kind === "approval.resolved" && event.source.memberId === memberId && event.data.decision === "deny").length, memoryToolEvents: all.filter((event) => ["tool.started", "tool.completed"].includes(event.kind) && event.source.memberId === memberId && Object.values(event.data).some((value) => typeof value === "string" && value.includes("deck_memory"))).length }));
      console.error(JSON.stringify({ members }));
      console.error(JSON.stringify({ workerResults: all.filter((event) => event.kind === "task.result" && event.source.taskId !== "lead").map((event) => ({ memberId: event.source.memberId, text: redactText(String(event.data.summary ?? ""), 1200) })) }));
    }
    checks.threeRunners = ["claude", "codex", "opencode"].every((id) => all.some((event) => event.kind === "turn.started" && event.source.runnerId === id));
  } finally { clearInterval(approvalTimer); }
} catch (error) { checks.completed = false; checks.timedOut = cancelled; if (activeSessionId) {
  const events = [...manager.openLog(activeSessionId)!.readAfter(0)];
  const statuses = Object.fromEntries(["created", "queued", "running", "completed", "failed", "cancelled", "interrupted"].map((state) => [state, events.filter((event) => event.kind === "task.state" && event.data.state === state).length]));
  const diagnosticCodes = [...new Set(events.filter((event) => event.kind === "diagnostic" && typeof event.data.code === "string" && /^[a-z][a-z0-9-]{1,100}$/.test(event.data.code)).map((event) => event.data.code))];
  console.error(JSON.stringify({ statuses, diagnosticCodes }));
} console.error(`cross live failed: ${error instanceof Error && /^[a-z-]+$/.test(error.message) ? error.message : "runtime-failure"}`); }
finally { clearTimeout(timeout); client?.close(); await daemon?.stop("live-complete"); rmSync(base, { recursive: true, force: true }); }
console.log(JSON.stringify(checks, null, 2));
process.exitCode = Object.values(checks).some((value) => value === false) || !checks.threeRunners ? 1 : 0;
