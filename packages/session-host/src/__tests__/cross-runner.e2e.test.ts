import { afterEach, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type { CrossRunnerConfig } from "@deck/core/config/deck-config";
import { join } from "node:path";
import { ApprovalBroker } from "../approval-broker";
import { BridgeService } from "../bridge-service";
import { ControlClient } from "../control-client";
import { ControlServer } from "../control-server";
import { CredentialRegistry } from "../credentials";
import { SessionManager, type SessionManagerOptions } from "../session-manager";
import { Supervisor } from "../supervisor";
import { Ledger } from "../ledger";
import { writeLease } from "../lease";
import { createNodeProbe } from "../process-probe";
import { recoverSession } from "../recovery";
import { ensureStateLayout, resolveStatePaths, sessionPaths } from "../paths";
import { FakeDriver } from "../testing/fake-driver";
import { cleanupTempDirs, FakeClock, tempDir, tempSubdir, waitFor } from "./test-helpers";

const managers: SessionManager[] = [];
const resources: Array<() => Promise<void> | void> = [];
afterEach(async () => { for (const close of resources.splice(0).reverse()) await close(); await Promise.all(managers.splice(0).map((m) => m.close())); cleanupTempDirs(); });
async function setup(clock?: FakeClock, extra: Partial<SessionManagerOptions> = {}) {
  const root = tempDir();
  const project = tempSubdir(root, "project");
  const paths = resolveStatePaths({ env: { HOME: root, XDG_STATE_HOME: join(root, "state") }, tmpdir: root });
  ensureStateLayout(paths);
  const drivers = [new FakeDriver("claude"), new FakeDriver("codex"), new FakeDriver("opencode")];
  const config: CrossRunnerConfig = { enabled: true, members: { lead: { runnerId: "claude", modelId: "opus" }, architect: { runnerId: "codex", modelId: "sol" }, implementer: { runnerId: "opencode", modelId: "pickle" } }, approvals: { claude: "relay", codex: "relay", opencode: "relay" }, maxConcurrentTasks: 4, claudeTosAcknowledgedAt: "2026-10-12T00:00:00Z", web: { port: 7421, trustedProxy: null, allowedOrigins: [], allowFunnel: false } };
  let manager!: SessionManager;
  const writes: string[] = [];
  const broker = new ApprovalBroker({ sink: { emit: (id, draft) => { manager.openLog(id)?.append(draft); } } });
  const credentials = new CredentialRegistry({ socketPath: paths.socket.path });
  const options: SessionManagerOptions = { paths, broker, credentials, supervisor: new Supervisor({ anchorCommand: ["unused"] }), drivers: { get: (id) => drivers.find((d) => d.runnerId === id), list: () => drivers }, config: () => config, sessionMcpCommand: ["deck", "internal", "session-mcp"], memory: async () => ({ recall: async () => ({ ok: true, advisoryText: "advisory" }), propose: async (content) => { writes.push(content); return { ok: true }; } }) };
  if (clock) options.clock = clock;
  Object.assign(options,extra);
  manager = new SessionManager(options);
  managers.push(manager);
  const execute = (body: any, sessionId?: string) => manager.execute({ sessionId, command: { v: 1, commandId: randomUUID(), ...body }, clientId: "test" });
  const created = await execute({ type: "session.create", projectRoot: project, changeId: "change" });
  const sessionId = (created as any).data.sessionId;
  await execute({ type: "prompt.send", text: "coordinate" }, sessionId);
  const grant = { sessionId, taskId: "lead", memberId: "lead", runnerId: "claude", allowedTools: [] };
  const call = (name: string, args: unknown) => manager.callTaskTool(grant, name, args, {});
  const events = () => [...manager.openLog(sessionId)!.readAfter(0)];
  return { manager, drivers, config, sessionId, grant, call, execute, events, broker, writes, credentials, paths, options };
}

for (const tool of ["deck_task_wait", "deck_task_result"]) {
  test(`terminal result delivered by ${tool} does not wake Lead after it answers`, async () => {
    const clock = new FakeClock();
    const t = await setup(clock);
    const id = (await t.call("deck_delegate", { agent: "architect", task: "inspect" }) as any).data.taskId;
    await waitFor(() => t.drivers[1]!.turns.length === 1);
    // An outstanding wait resolves synchronously from the terminal ledger event,
    // before finishTurn has had a chance to enqueue the completion notice.
    const waiting = tool === "deck_task_wait" ? t.call(tool, { taskIds: [id] }) : undefined;
    t.drivers[1]!.turns[0]!.say("review complete");
    t.drivers[1]!.turns[0]!.finish();
    await waitFor(() => t.events().some((event) => event.kind === "task.state" && event.source.taskId === id && event.data.state === "completed"));
    const result = await (waiting ?? t.call(tool, { taskId: id }));
    expect(result).toMatchObject({ ok: true, data: tool === "deck_task_wait" ? { tasks: [{ attempt: 1, state: "completed" }] } : { attempt: 1, state: "completed" } });
    t.drivers[0]!.turns[0]!.finish();
    await waitFor(() => t.events().some((event) => event.kind === "turn.completed" && event.source.taskId === "lead"));
    clock.advance(20);
    await Promise.resolve();
    expect(t.drivers[0]!.turns).toHaveLength(1);
    expect(t.events().filter((event) => event.kind === "message.completed" && event.data.by === "daemon")).toHaveLength(0);
    expect(t.manager.hasRunningWork()).toBe(false);
  });
}

test("Lead notice contains only new completions while continuity retains retrieved history", async () => {
  const clock = new FakeClock();
  const t = await setup(clock);
  const seen = (await t.call("deck_delegate", { agent: "architect", task: "seen" }) as any).data.taskId;
  const unseen = (await t.call("deck_delegate", { agent: "implementer", task: "unseen" }) as any).data.taskId;
  await waitFor(() => t.drivers[1]!.turns.length === 1 && t.drivers[2]!.turns.length === 1);
  const waiting = t.call("deck_task_wait", { taskIds: [seen] });
  t.drivers[1]!.turns[0]!.finish();
  expect(await waiting).toMatchObject({ ok: true });
  t.drivers[2]!.turns[0]!.finish();
  await waitFor(() => t.events().some((event) => event.kind === "task.state" && event.source.taskId === unseen && event.data.state === "completed"));
  t.drivers[0]!.turns[0]!.finish();
  await waitFor(() => t.events().some((event) => event.kind === "turn.completed" && event.source.taskId === "lead"));
  clock.advance(20);
  await waitFor(() => t.drivers[0]!.turns.length === 2);
  expect(t.drivers[0]!.turns[1]!.input.prompt).toContain(`${unseen} completed`);
  expect(t.drivers[0]!.turns[1]!.input.prompt.split("\n\nContinuity context")[0]).not.toContain(seen);
  expect(t.drivers[0]!.turns[1]!.input.prompt).toContain(seen);
});

test("a timed-out wait acknowledges terminal snapshots but preserves pending attempts", async () => {
  const clock = new FakeClock();
  const t = await setup(clock);
  const ids = await Promise.all(["architect", "implementer"].map(async (agent) => (await t.call("deck_delegate", { agent, task: "inspect" }) as any).data.taskId));
  await waitFor(() => t.drivers[1]!.turns.length === 1 && t.drivers[2]!.turns.length === 1);
  const waiting = t.call("deck_task_wait", { taskIds: ids, timeoutSec: 1 });
  t.drivers[1]!.turns[0]!.finish();
  await waitFor(() => t.events().some((event) => event.kind === "task.state" && event.source.taskId === ids[0] && event.data.state === "completed"));
  clock.advance(1000);
  expect(await waiting).toMatchObject({ ok: true, data: { tasks: [{ state: "completed" }, { state: "running" }] } });
  t.drivers[2]!.turns[0]!.finish();
  await waitFor(() => t.events().some((event) => event.kind === "task.state" && event.source.taskId === ids[1] && event.data.state === "completed"));
  t.drivers[0]!.turns[0]!.finish();
  await waitFor(() => t.events().some((event) => event.kind === "turn.completed" && event.source.taskId === "lead"));
  clock.advance(20);
  await waitFor(() => t.drivers[0]!.turns.length === 2);
  expect(t.drivers[0]!.turns[1]!.input.prompt).toContain(ids[1]);
  expect(t.drivers[0]!.turns[1]!.input.prompt.split("\n\nContinuity context")[0]).not.toContain(ids[0]);
  expect(t.drivers[0]!.turns[1]!.input.prompt).toContain(ids[0]);
});

test("reading running results and observer logs does not consume a later completion", async () => {
  const clock = new FakeClock();
  const t = await setup(clock);
  const id = (await t.call("deck_delegate", { agent: "architect", task: "inspect" }) as any).data.taskId;
  await waitFor(() => t.drivers[1]!.turns.length === 1);
  expect(await t.call("deck_task_result", { taskId: id })).toMatchObject({ ok: true, data: { state: "running" } });
  const waiting = t.call("deck_task_wait", { taskIds: [id], timeoutSec: 0 });
  clock.advance(0);
  expect(await waiting).toMatchObject({ ok: true, data: { tasks: [{ state: "running" }] } });
  t.drivers[1]!.turns[0]!.finish();
  await waitFor(() => t.events().some((event) => event.kind === "task.state" && event.source.taskId === id && event.data.state === "completed"));
  expect([...t.manager.openLog(t.sessionId)!.readAfter(0)]).not.toHaveLength(0);
  expect(await t.manager.query("sessions.list", {})).toMatchObject({ ok: true });
  t.drivers[0]!.turns[0]!.finish();
  await waitFor(() => t.events().some((event) => event.kind === "turn.completed" && event.source.taskId === "lead"));
  clock.advance(20);
  await waitFor(() => t.drivers[0]!.turns.length === 2);
  expect(t.drivers[0]!.turns[1]!.input.prompt).toContain(id);
});

test("an aborted wait or result read preserves the unseen completion", async () => {
  const clock = new FakeClock();
  const t = await setup(clock);
  const id = (await t.call("deck_delegate", { agent: "architect", task: "inspect" }) as any).data.taskId;
  await waitFor(() => t.drivers[1]!.turns.length === 1);
  const controller = new AbortController();
  const waiting = t.manager.callTaskTool(t.grant, "deck_task_wait", { taskIds: [id] }, { signal: controller.signal });
  controller.abort();
  expect(await waiting).toMatchObject({ ok: false, code: "aborted" });
  t.drivers[1]!.turns[0]!.finish();
  await waitFor(() => t.events().some((event) => event.kind === "task.state" && event.source.taskId === id && event.data.state === "completed"));
  expect(await t.manager.callTaskTool(t.grant, "deck_task_result", { taskId: id }, { signal: controller.signal })).toMatchObject({ ok: false, code: "aborted" });
  t.drivers[0]!.turns[0]!.finish();
  await waitFor(() => t.events().some((event) => event.kind === "turn.completed" && event.source.taskId === "lead"));
  clock.advance(20);
  await waitFor(() => t.drivers[0]!.turns.length === 2);
  expect(t.drivers[0]!.turns[1]!.input.prompt).toContain(id);
});

test("a delivered attempt does not suppress an unseen continued attempt", async () => {
  const clock = new FakeClock();
  const t = await setup(clock);
  const id = (await t.call("deck_delegate", { agent: "architect", task: "inspect" }) as any).data.taskId;
  await waitFor(() => t.drivers[1]!.turns.length === 1);
  const waiting = t.call("deck_task_wait", { taskIds: [id] });
  t.drivers[1]!.turns[0]!.init();
  t.drivers[1]!.turns[0]!.finish();
  expect(await waiting).toMatchObject({ ok: true });
  expect(await t.call("deck_delegate", { agent: "architect", task: "inspect again", continueTaskId: id })).toMatchObject({ ok: true });
  await waitFor(() => t.drivers[1]!.turns.length === 2);
  t.drivers[1]!.turns[1]!.finish();
  await waitFor(() => t.events().filter((event) => event.kind === "turn.completed" && event.source.taskId === id).length === 2);
  t.drivers[0]!.turns[0]!.finish();
  await waitFor(() => t.events().some((event) => event.kind === "turn.completed" && event.source.taskId === "lead"));
  clock.advance(20);
  await waitFor(() => t.drivers[0]!.turns.length === 2);
  expect(t.drivers[0]!.turns[1]!.input.prompt).toContain(`${id} completed`);
});

test("a scheduled wake is harmless when a new Lead turn consumes the result first", async () => {
  const clock = new FakeClock();
  const t = await setup(clock);
  const id = (await t.call("deck_delegate", { agent: "architect", task: "inspect" }) as any).data.taskId;
  await waitFor(() => t.drivers[1]!.turns.length === 1);
  t.drivers[0]!.turns[0]!.finish();
  await waitFor(() => t.events().some((event) => event.kind === "turn.completed" && event.source.taskId === "lead"));
  t.drivers[1]!.turns[0]!.finish();
  await waitFor(() => t.events().some((event) => event.kind === "task.state" && event.source.taskId === id && event.data.state === "completed"));
  expect(await t.execute({ type: "prompt.send", text: "show the result" }, t.sessionId)).toMatchObject({ ok: true });
  await waitFor(() => t.drivers[0]!.turns.length === 2);
  expect(await t.call("deck_task_result", { taskId: id })).toMatchObject({ ok: true, data: { state: "completed" } });
  clock.advance(20);
  t.drivers[0]!.turns[1]!.finish();
  await waitFor(() => t.events().filter((event) => event.kind === "turn.completed" && event.source.taskId === "lead").length === 2);
  clock.advance(20);
  await Promise.resolve();
  expect(t.drivers[0]!.turns).toHaveLength(2);
  expect(t.events().filter((event) => event.kind === "message.completed" && event.data.by === "daemon")).toHaveLength(0);
});

for (const state of ["failed", "cancelled"]) {
  test(`a delivered ${state} result also suppresses its completion wake`, async () => {
    const clock = new FakeClock();
    const t = await setup(clock);
    if (state === "cancelled") {
      t.config.maxConcurrentTasks = 1;
      await t.call("deck_delegate", { agent: "implementer", task: "occupy slot" });
    }
    const id = (await t.call("deck_delegate", { agent: "architect", task: "inspect" }) as any).data.taskId;
    const waiting = t.call("deck_task_wait", { taskIds: [id] });
    if (state === "cancelled") {
      expect(await t.call("deck_task_cancel", { taskId: id })).toMatchObject({ ok: true });
    } else {
      await waitFor(() => t.drivers[1]!.turns.length === 1);
      t.drivers[1]!.turns[0]!.finish({ status: "failed", error: "failed inspection" });
    }
    expect(await waiting).toMatchObject({ ok: true, data: { tasks: [{ state }] } });
    t.drivers[0]!.turns[0]!.finish();
    await waitFor(() => t.events().some((event) => event.kind === "turn.completed" && event.source.taskId === "lead"));
    clock.advance(20);
    await Promise.resolve();
    expect(t.drivers[0]!.turns).toHaveLength(1);
  });
}

test("an authenticated Lead socket wait delivers the result without a follow-up native turn", async () => {
  const clock = new FakeClock();
  const t = await setup(clock);
  const server = new ControlServer({ socketPath: t.paths.socket.path, service: t.manager, bridge: new BridgeService({ credentials: t.credentials, broker: t.broker, status: (grant) => t.manager.taskStatus(grant), callTaskTool: (grant, name, args, context) => t.manager.callTaskTool(grant, name, args, context) }), daemon: { version: "test", pid: process.pid, nonce: "test", status: () => ({}), requestRestart: () => ({ ok: true }) } });
  await server.listen(); resources.push(() => server.close());
  const client = await ControlClient.connect(t.paths.socket.path); resources.push(() => client.close());
  const { token } = JSON.parse(readFileSync(t.drivers[0]!.turns[0]!.input.credentialFile, "utf8"));
  const delegated = await client.request({ t: "bridge.call", token, tool: "deck_delegate", arguments: { agent: "architect", task: "inspect" } });
  const id = (delegated as any).outcome.data.taskId;
  await waitFor(() => t.drivers[1]!.turns.length === 1);
  const waiting = client.request({ t: "bridge.call", token, tool: "deck_task_wait", arguments: { taskIds: [id] } });
  t.drivers[1]!.turns[0]!.say("inspection complete");
  t.drivers[1]!.turns[0]!.finish();
  expect(await waiting).toMatchObject({ t: "bridge.result", outcome: { ok: true, data: { tasks: [{ taskId: id, state: "completed", result: "inspection complete" }] } } });
  t.drivers[0]!.turns[0]!.finish();
  await waitFor(() => t.events().some((event) => event.kind === "turn.completed" && event.source.taskId === "lead"));
  clock.advance(20);
  await Promise.resolve();
  expect(t.drivers[0]!.turns).toHaveLength(1);
});

test("cross-runner scheduler queues, scopes tools, waits, cancels and wakes Lead once per batch", async () => {
  const t = await setup();
  const ids: string[] = [];
  for (let i = 0; i < 6; i++) ids.push((await t.call("deck_delegate", { agent: i % 2 ? "implementer" : "architect", task: `job${i}` }) as any).data.taskId);
  await waitFor(() => t.drivers[1]!.turns.length + t.drivers[2]!.turns.length === 4);
  expect(t.events().filter((e) => e.kind === "task.state" && e.source.memberId !== "lead" && e.data.state === "queued")).toHaveLength(6);
  expect(await t.manager.callTaskTool({ ...t.grant, taskId: ids[0]!, memberId: "architect" }, "deck_delegate", { agent: "architect", task: "nested" }, {})).toMatchObject({ ok: false, code: "tool-not-allowed" });
  expect(t.drivers[1]!.turns[0]!.input.rolePrompt).toContain("openspec/changes/change");
  expect(t.drivers[1]!.turns[0]!.input.mcp.sessionTools).not.toContain("deck_delegate");
  const waiting = t.call("deck_task_wait", { taskIds: [ids[0]], timeoutSec: 50 });
  t.drivers[1]!.turns[0]!.say("result"); t.drivers[1]!.turns[0]!.finish();
  expect(await waiting).toMatchObject({ ok: true });
  await waitFor(() => t.drivers[1]!.turns.length + t.drivers[2]!.turns.length === 5);
  expect(await t.call("deck_task_result", { taskId: ids[0] })).toMatchObject({ ok: true, data: { state: "completed", result: "result" } });
  expect(await t.call("deck_task_cancel", { taskId: ids[5] })).toMatchObject({ ok: true });
  t.drivers[0]!.turns[0]!.init(); t.drivers[0]!.turns[0]!.finish();
  for (const driver of t.drivers.slice(1)) for (const turn of driver.turns) turn.finish();
  await waitFor(() => t.drivers[0]!.turns.length === 2);
  expect(t.drivers[0]!.turns[1]!.input.prompt).toContain("completed");
  expect(t.events().find((e) => e.kind === "message.completed" && e.data.by === "daemon")?.data).toMatchObject({ role: "system", internal: true });
  t.drivers[0]!.turns[1]!.finish();
});

test("authenticated socket delegation, approval relay and interrupt survive client detach and cursor replay", async () => {
  const t = await setup();
  const server = new ControlServer({ socketPath: t.paths.socket.path, service: t.manager, bridge: new BridgeService({ credentials: t.credentials, broker: t.broker, status: (grant) => t.manager.taskStatus(grant), callTaskTool: (grant, name, args, context) => t.manager.callTaskTool(grant, name, args, context) }), daemon: { version: "test", pid: process.pid, nonce: "test", status: () => ({}), requestRestart: () => ({ ok: true }) } });
  await server.listen(); resources.push(() => server.close());
  const first = await ControlClient.connect(t.paths.socket.path); resources.push(() => first.close());
  const seen: number[] = [];
  await first.attach(t.sessionId, 0, { onEvent: (event) => seen.push(event.seq) });
  await waitFor(() => seen.length === t.events().length);
  const cursor = seen.at(-1)!;
  first.close(); await first.closed;
  const bridge = await ControlClient.connect(t.paths.socket.path); resources.push(() => bridge.close());
  const { token } = JSON.parse(readFileSync(t.drivers[0]!.turns[0]!.input.credentialFile, "utf8"));
  const delegated = await bridge.request({ t: "bridge.call", token, tool: "deck_delegate", arguments: { agent: "architect", task: "inspect" } });
  expect(delegated.t).toBe("bridge.result");
  await waitFor(() => t.drivers[1]!.turns.length === 1);
  const worker = t.drivers[1]!.turns[0]!;
  const approval = worker.io.approval({ approvalId: "native", tool: "shell", toolKey: `${worker.input.assignment.runnerId}:shell`, risk: "high", input: { command: "echo safe" } });
  const second = await ControlClient.connect(t.paths.socket.path); resources.push(() => second.close());
  const replay: number[] = [];
  await second.attach(t.sessionId, cursor, { onEvent: (event) => replay.push(event.seq) });
  await waitFor(() => replay.length === t.events().length - cursor);
  expect(replay).toEqual(Array.from({ length: t.events().length - cursor }, (_, i) => cursor + i + 1));
  const pending = t.broker.pending()[0]!;
  expect((await second.command({ v: 1, type: "approval.respond", commandId: randomUUID(), approvalId: pending.approvalId, decision: "deny" }, t.sessionId)).outcome.ok).toBe(true);
  expect(await approval).toEqual({ decision: "deny", scope: "once" });
  expect((await second.command({ v: 1, type: "turn.interrupt", commandId: randomUUID(), taskId: worker.input.taskId }, t.sessionId)).outcome.ok).toBe(true);
  await waitFor(() => worker.closed);
  expect(t.events().find((e) => e.kind === "task.state" && e.source.taskId === worker.input.taskId && e.data.state === "interrupted")).toBeDefined();
});

test("wait validates session scope and deadline, and abort removes its subscription", async () => {
  const t = await setup();
  const id = (await t.call("deck_delegate", { agent: "architect", task: "pending" }) as any).data.taskId;
  expect(await t.call("deck_task_wait", { taskIds: [id], timeoutSec: 51 })).toMatchObject({ ok: false, code: "invalid-arguments" });
  expect(await t.call("deck_task_result", { taskId: "foreign-session-task" })).toMatchObject({ ok: false, code: "task-unknown" });
  expect(await t.call("deck_task_wait", { taskIds: [id], timeoutSec: 0 })).toMatchObject({ ok: true, data: { tasks: [{ state: "running" }] } });
  const controller = new AbortController();
  const wait = t.manager.callTaskTool(t.grant, "deck_task_wait", { taskIds: [id] }, { signal: controller.signal });
  controller.abort(); expect(await wait).toMatchObject({ ok: false, code: "aborted" });
});

test("queued cancellation receipts preserve task.cancel idempotency", async () => {
  const t = await setup(); t.config.maxConcurrentTasks = 1;
  await t.call("deck_delegate", { agent: "architect", task: "running" });
  const taskId = (await t.call("deck_delegate", { agent: "architect", task: "queued" }) as { data: { taskId: string } }).data.taskId;
  const command = { v: 1 as const, type: "task.cancel" as const, commandId: randomUUID(), taskId };
  expect(await t.manager.execute({ sessionId: t.sessionId, command, clientId: "test" })).toMatchObject({ ok: true });
  expect(await t.manager.execute({ sessionId: t.sessionId, command, clientId: "test" })).toMatchObject({ ok: true, duplicate: true });
  expect(t.events().filter((event) => event.kind === "task.state" && event.source.taskId === taskId && event.data.state === "cancelled")).toHaveLength(1);
});

test("client cancellation of queued work wakes an idle Lead while the running worker remains active", async () => {
  const t = await setup(); t.config.maxConcurrentTasks = 1;
  await t.call("deck_delegate", { agent: "architect", task: "running" });
  const taskId = (await t.call("deck_delegate", { agent: "architect", task: "queued" }) as { data: { taskId: string } }).data.taskId;
  t.drivers[0]!.turns[0]!.init(); t.drivers[0]!.turns[0]!.finish();
  await waitFor(() => t.drivers[0]!.turns[0]!.closed);
  await t.execute({ type: "task.cancel", taskId }, t.sessionId);
  await waitFor(() => t.drivers[0]!.turns.length === 2);
  expect(t.drivers[0]!.turns[1]!.input.prompt).toContain(`${taskId} cancelled`);
  expect(t.drivers[1]!.turns[0]!.finished).toBe(false);
  expect(t.drivers[0]!.turns).toHaveLength(2);
});

test("continuation retains owner assignment and confirmed native id; only missing native sessions reseed once", async () => {
  const t = await setup(undefined,{compactionBound:()=>({runnerId:"codex",modelId:"sol",version:"1.0.0",configKey:"verified",basis:"input",inputSafeExclusiveCap:170000,triggerTokens:170001,evidenceRef:"fixture"})});
  const id = (await t.call("deck_delegate", { agent: "architect", task: "first" }) as any).data.taskId;
  await waitFor(() => t.drivers[1]!.turns.length === 1);
  const first = t.drivers[1]!.turns[0]!; first.init(); first.emit("usage",{requestInput:{tokens:100,basis:"codex-last-input",nativeThreadId:first.nativeSessionId,nativeTurnId:"turn",modelId:"sol",final:true}}); first.say("prior summary"); first.finish();
  await waitFor(() => first.closed);
  expect(await t.call("deck_delegate", { agent: "implementer", task: "wrong", continueTaskId: id })).toMatchObject({ ok: false, code: "task-owner-mismatch" });
  (t.config.members.architect as any) = { runnerId: "opencode", modelId: "changed" };
  expect(await t.call("deck_delegate", { agent: "architect", task: "continue", continueTaskId: id })).toMatchObject({ ok: true });
  await waitFor(() => t.drivers[1]!.turns.length === 2);
  const resumed = t.drivers[1]!.turns[1]!;
  expect(resumed.input.assignment.modelId).toBe("sol"); expect(resumed.input.resume?.nativeSessionId).toBe(first.nativeSessionId);
  resumed.finish({ status: "failed", reasonCode: "native-session-not-found", error: "expired" });
  await waitFor(() => t.drivers[1]!.turns.length === 3);
  const reseeded = t.drivers[1]!.turns[2]!;
  expect(reseeded.input.resume).toBeUndefined(); expect(reseeded.input.prompt).toContain("prior summary");
  expect(t.events().filter((e) => e.kind === "task.continued").at(-1)?.data.continuity).toBe("reseeded");
  reseeded.finish({ status: "failed", reasonCode: "native-session-not-found" });
  await waitFor(() => reseeded.closed);
  expect(t.drivers[1]!.turns).toHaveLength(3);
});

test("memory proposals have one deduplicated writer across member credentials", async () => {
  const t = await setup();
  expect(await t.call("deck_memory_recall", { query: "context" })).toMatchObject({ ok: true, data: { advisoryText: "advisory" } });
  await Promise.all([t.call("deck_memory_propose", { content: "same" }), t.call("deck_memory_propose", { content: "same" })]);
  expect(t.writes).toEqual(["same"]);
  expect(t.events().filter((e) => e.kind === "memory.written")).toHaveLength(1);
  await t.manager.close();
  const restarted = new SessionManager(t.options); managers.push(restarted);
  await restarted.execute({ sessionId: t.sessionId, clientId: "test", command: { v: 1, type: "prompt.send", text: "resume", commandId: randomUUID() } });
  await restarted.execute({ sessionId: t.sessionId, clientId: "test", command: { v: 1, type: "prompt.resume", commandId: randomUUID() } });
  await waitFor(() => t.drivers[0]!.turns.length === 2);
  expect(await restarted.callTaskTool(t.grant, "deck_memory_propose", { content: "same" }, {})).toMatchObject({ ok: true, data: { duplicate: true } });
  expect(t.writes).toEqual(["same"]);
});

test("crash recovery settles absent delegated groups, refuses uncertain ownership and preserves logical owner but reseeds without verified request evidence", async () => {
  const t = await setup();
  await t.manager.close();
  const restarted = new SessionManager(t.options); managers.push(restarted);
  const log = restarted.openLog(t.sessionId)!;
  for (const taskId of ["settled", "uncertain"]) log.appendMany([
    { kind: "task.created", source: { taskId, memberId: "architect", runnerId: "codex" }, data: { taskId, memberId: "architect", runnerId: "codex", modelId: "sol", nativeSessionId: `saved-${taskId}`, state: "created" } },
    { kind: "task.state", source: { taskId }, data: { taskId, state: "running" } },
    { kind: "turn.started", source: { taskId }, data: {} },
  ]);
  const boot = "11111111-2222-3333-4444-555555555555";
  writeLease(sessionPaths(t.paths, t.sessionId).taskLeaseFile("settled"), { v: 1, taskId: "settled", nonce: "test", state: "live", daemon: { pid: 123 }, anchor: { pid: 456, boot, platform: "linux", starttime: "1" }, worker: { pid: 457, boot, platform: "linux", starttime: "2" }, group: 456, createdAt: new Date().toISOString() });
  const signals: number[] = [];
  const probe = createNodeProbe({ platform: "linux", readFile: (path) => { if (path === "/proc/sys/kernel/random/boot_id") return boot; throw Object.assign(new Error("absent"), { code: "ENOENT" }); }, kill: (_pid, signal) => { signals.push(signal); throw Object.assign(new Error("absent"), { code: "ESRCH" }); } });
  const ledger = Ledger.empty(t.sessionId); for (const event of log.readAfter(0)) ledger.apply(event);
  const report = recoverSession({ log, ledger, probe, leaseFileFor: sessionPaths(t.paths, t.sessionId).taskLeaseFile });
  expect(report.interrupted).toContain("settled"); expect(report.unsettled).toContainEqual({ taskId: "uncertain", reason: "lease-missing" });
  expect(signals.every((signal) => signal === 0)).toBe(true);
  t.config.members.architect = { runnerId: "opencode", modelId: "changed" };
  await restarted.execute({ sessionId: t.sessionId, clientId: "test", command: { v: 1, type: "prompt.send", commandId: randomUUID(), text: "recover work" } });
  await restarted.execute({ sessionId: t.sessionId, clientId: "test", command: { v: 1, type: "prompt.resume", commandId: randomUUID() } });
  await waitFor(() => t.drivers[0]!.turns.length === 2);
  expect(await restarted.callTaskTool(t.grant, "deck_delegate", { agent: "architect", task: "resume", continueTaskId: "uncertain" }, {})).toMatchObject({ ok: false, code: "ownership-unsettled" });
  expect(await restarted.callTaskTool(t.grant, "deck_delegate", { agent: "architect", task: "resume", continueTaskId: "settled" }, {})).toMatchObject({ ok: true });
  await waitFor(() => t.drivers[1]!.turns.length === 1);
  expect(t.drivers[1]!.turns[0]!.input).toMatchObject({ assignment: { runnerId: "codex", modelId: "sol" } });
  expect(t.drivers[1]!.turns[0]!.input.resume).toBeUndefined();
  expect(t.drivers[1]!.turns[0]!.input.prompt).toContain("Current Lead instruction:");
});
