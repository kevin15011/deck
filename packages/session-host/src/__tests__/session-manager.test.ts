import { afterEach, describe, expect, test } from "bun:test";
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CrossRunnerConfig } from "@deck/core/config/deck-config";
import type { SessionCommandBody } from "@deck/core/session/commands";
import type { SessionEvent } from "@deck/core/session/events";
import type { DriverHostIo, DriverTaskInput, TurnOutcome } from "@deck/core/session/driver";
import { ApprovalBroker } from "../approval-broker";
import { CredentialRegistry } from "../credentials";
import { MemoryBroker } from "../memory-broker";
import { BridgeService } from "../bridge-service";
import { ensureStateLayout, resolveStatePaths, sessionPaths } from "../paths";
import { createNodeProbe } from "../process-probe";
import { recoverAllSessions } from "../recovery";
import { SessionManager, type SessionManagerOptions } from "../session-manager";
import { Supervisor } from "../supervisor";
import { FakeDriver, type FakeTurn } from "../testing/fake-driver";
import { cleanupTempDirs, FakeClock, tempDir, tempSubdir, waitFor } from "./test-helpers";

// These waits observe durable lifecycle progress, not a subsecond latency contract.
const PROGRESS_TIMEOUT_MS = 5000;
const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) { try { await fn(); } catch { /* best effort */ } }
  cleanupTempDirs();
});

const baseConfig = (over: Partial<CrossRunnerConfig> = {}): CrossRunnerConfig => ({
  enabled: true,
  members: { lead: { runnerId: "claude", modelId: "opus", thinking: "high" } },
  approvals: { claude: "relay", opencode: "relay", codex: "runner-default" },
  maxConcurrentTasks: 4,
  web: { port: 7421, trustedProxy: null, allowedOrigins: [], allowFunnel: false },
  claudeTosAcknowledgedAt: "2026-10-12T00:00:00.000Z",
  ...over,
});

function setup(over: { config?: CrossRunnerConfig | undefined; driver?: FakeDriver | null; dir?: string; options?: Partial<SessionManagerOptions> } = {}) {
  const dir = over.dir ?? tempDir();
  const paths = resolveStatePaths({ env: { HOME: dir, XDG_STATE_HOME: join(dir, "state") }, tmpdir: dir });
  ensureStateLayout(paths);
  const project = tempSubdir(dir, "project");
  const driver = over.driver === null ? undefined : (over.driver ?? new FakeDriver());
  const state = { config: "config" in over ? over.config : baseConfig() };
  const credentials = new CredentialRegistry({ socketPath: paths.socket.path });
  const supervisor = new Supervisor({ anchorCommand: ["unused"] });
  // eslint-disable-next-line prefer-const
  let manager: SessionManager;
  const broker = new ApprovalBroker({ sink: { emit: (sessionId, draft) => { manager.openLog(sessionId)?.append(draft); } } });
  manager = new SessionManager({
    paths, broker, credentials, supervisor, homeDir: dir,
    drivers: { get: (runnerId) => (runnerId === driver?.runnerId ? driver : undefined), list: () => (driver ? [driver] : []) },
    config: () => state.config,
    sessionMcpCommand: ["/bin/deck", "internal", "session-mcp"],
    ...over.options,
  });
  cleanups.push(() => manager.close());
  // Synthetic persistent handles must also drain if an assertion fails before release.
  if (driver instanceof PersistentFakeDriver) cleanups.push(() => { driver.releaseClose(); });
  let n = 0;
  const run = (command: SessionCommandBody, sessionId?: string, clientId = "c-1") =>
    manager.execute({ sessionId, clientId, command: { v: 1, commandId: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`, ...command } as never });
  const runWithId = (commandId: string, command: SessionCommandBody, sessionId?: string) =>
    manager.execute({ sessionId, clientId: "c-1", command: { v: 1, commandId, ...command } as never });
  const create = async (extra: { changeId?: string } = {}) => {
    const r = await run({ type: "session.create", projectRoot: project, ...extra });
    if (!r.ok) throw new Error(`create failed: ${JSON.stringify(r)}`);
    return (r.data as { sessionId: string }).sessionId;
  };
  const events = (sessionId: string): SessionEvent[] => [...manager.openLog(sessionId)!.readAfter(0)];
  const kinds = (sessionId: string) => events(sessionId).map((e) => e.kind);
  const idle = () => waitFor(() => !manager.hasRunningWork(), 5000, "turn to finish");
  return { dir, paths, project, driver: driver as FakeDriver, state, manager, broker, credentials, run, runWithId, create, events, kinds, idle };
}

const lastTurn = (driver: FakeDriver): FakeTurn => driver.turns.at(-1)!;

describe("persistent workspace sessions", () => {
  const grantFor = (t: ReturnType<typeof setup>, sessionId: string, taskId = "lead") => t.credentials.lookup(JSON.parse(readFileSync(sessionPaths(t.paths, sessionId).taskCredentialFile(taskId), "utf8")).token)!;

  test("crashed preflight reservation with no dispatch fence or lease safely restores pending text", async () => {
    const t = setup(); const id = await t.create(); let release!: () => void;
    t.driver.probe = () => new Promise(resolve => { release = () => resolve({ ...t.driver.probeResult, status: "blocked" }); });
    await t.run({ type: "prompt.send", text: "never reached native" }, id); await waitFor(() => !!release, PROGRESS_TIMEOUT_MS, "held runner check");
    expect(t.events(id).some(e => e.kind === "prompt.dispatched")).toBe(false);
    const dir = tempDir(), paths = resolveStatePaths({ env: { HOME: dir, XDG_STATE_HOME: join(dir, "state") }, tmpdir: dir }); ensureStateLayout(paths); cpSync(t.paths.sessionsDir, paths.sessionsDir, { recursive: true });
    const report = recoverAllSessions({ paths, probe: createNodeProbe() });
    expect(report.sessions[0]?.unsettled).toEqual([]);
    const driver = new FakeDriver(); driver.autoComplete = true; const reopened = setup({ dir, driver });
    await waitFor(() => driver.turns.length === 1, PROGRESS_TIMEOUT_MS, "restored pending native call"); await reopened.idle();
    expect(driver.turns[0]?.input.prompt).toBe("never reached native");
    release(); await t.idle();
  });

  test("an explicit resume during interrupted native close drains once then continues FIFO", async () => {
    const driver = new PersistentFakeDriver(); const t = setup({ driver }); const id = await t.create();
    await t.run({ type: "prompt.send", text: "first" }, id); await waitFor(() => driver.turns.length === 1, PROGRESS_TIMEOUT_MS, "first");
    await t.run({ type: "prompt.send", text: "second" }, id); await t.run({ type: "turn.interrupt", taskId: "lead" }, id);
    await waitFor(() => driver.closeCalls === 1, PROGRESS_TIMEOUT_MS, "held native close");
    expect((await t.run({ type: "prompt.resume" }, id)).ok).toBe(true); expect(driver.turns).toHaveLength(1);
    driver.releaseClose(); await waitFor(() => driver.turns.length === 2, PROGRESS_TIMEOUT_MS, "next after drain");
    expect(lastTurn(driver).input.prompt).toBe("second"); lastTurn(driver).finish(); await t.idle();
    expect((await t.manager.query("prompts.list", { sessionId: id }) as any).data.paused).toBe(false);
  });

  test("failed internal wake pauses accepted users and retains notices until their native delivery", async () => {
    const wake = Promise.withResolvers<any>();
    let wakeReserved = false, leadPreparations = 0;
    const t = setup({ config: baseConfig({ members: { lead: { runnerId: "claude", modelId: "opus" }, investigate: { runnerId: "claude", modelId: "fast" } } }), options: { childMcp: async (_runner, context) => {
      if (context.taskId === "lead" && ++leadPreparations === 2) { wakeReserved = true; return wake.promise; }
      return { runnerPackages: () => [], resolveServer: () => undefined };
    } } });
    // Release the scripted preflight before manager teardown, including failed assertions.
    cleanups.push(() => { wake.resolve({ runnerPackages: () => [], resolveServer: () => undefined }); });
    const id = await t.create(); await t.run({ type: "prompt.send", text: "initial" }, id); await waitFor(() => t.driver.turns.length === 1, PROGRESS_TIMEOUT_MS, "lead");
    const original = lastTurn(t.driver); original.init();
    const childId = (await t.manager.callTaskTool(grantFor(t, id), "deck_delegate", { agent: "investigate", task: "inspect" }) as any).data.taskId;
    await waitFor(() => t.driver.turns.length === 2, PROGRESS_TIMEOUT_MS, "child"); const child = lastTurn(t.driver); child.finish(); await waitFor(() => child.closed, PROGRESS_TIMEOUT_MS, "child close");
    original.finish(); await waitFor(() => wakeReserved, PROGRESS_TIMEOUT_MS, "reserved wake preflight");
    await t.run({ type: "prompt.send", text: "exact user instruction" }, id);
    wake.resolve({ runnerPackages: () => [], resolveServer: () => undefined, nativeMemory: { provider: "supermemory", integration: "runner-plugin", status: "unavailable" } });
    await t.idle();
    expect((await t.manager.query("prompts.list", { sessionId: id }) as any).data).toMatchObject({ paused: true, queued: [{ text: "exact user instruction" }] });
    expect(t.events(id).filter(e => e.data.code === "lead.notices-delivered")).toHaveLength(0);
    await t.run({ type: "prompt.resume" }, id); await waitFor(() => t.driver.turns.length === 3, PROGRESS_TIMEOUT_MS, "user resumes");
    const user = lastTurn(t.driver); expect(user.input.prompt).toBe("exact user instruction"); expect(user.input.rolePrompt).toContain(childId);
    expect(t.events(id).filter(e => e.data.code === "lead.notices-delivered")).toHaveLength(1);
    user.finish(); await t.idle();
  });

  test("large completion batches consume only complete notices actually delivered once", async () => {
    const t = setup({ config: baseConfig({ members: { lead: { runnerId: "claude", modelId: "opus" }, investigate: { runnerId: "claude", modelId: "fast" } } }) });
    t.driver.onStart = turn => { if (turn.input.memberId !== "lead") { turn.init(); turn.finish(); } };
    const id = await t.create(); await t.run({ type: "prompt.send", text: "initial" }, id); await waitFor(() => t.driver.turns.length === 1, PROGRESS_TIMEOUT_MS, "lead"); const lead = lastTurn(t.driver); lead.init();
    for (let i = 0; i < 200; i++) await t.manager.callTaskTool(grantFor(t, id), "deck_delegate", { agent: "investigate", task: `job ${i}` });
    await waitFor(() => t.events(id).filter(e => e.kind === "task.state" && e.source.taskId !== "lead" && e.data.state === "completed").length === 200, PROGRESS_TIMEOUT_MS, "all children complete");
    lead.finish(); await waitFor(() => t.driver.turns.filter(turn => turn.input.memberId === "lead").length === 2, PROGRESS_TIMEOUT_MS, "first notice batch");
    const first = lastTurn(t.driver); expect(first.input.prompt.length).toBeLessThanOrEqual(8192); expect(first.input.rolePrompt).not.toContain("Delegated task completion notice:");
    const firstIds = (t.events(id).filter(e => e.data.code === "lead.notices-delivered").at(-1)!.data.notices as any[]).map(n => n.taskId);
    expect(firstIds.length).toBeLessThan(200); first.finish();
    await waitFor(() => t.driver.turns.filter(turn => turn.input.memberId === "lead").length === 3, PROGRESS_TIMEOUT_MS, "overflow notice batch");
    const secondIds = (t.events(id).filter(e => e.data.code === "lead.notices-delivered").at(-1)!.data.notices as any[]).map(n => n.taskId);
    expect(firstIds.filter(id => secondIds.includes(id))).toEqual([]); expect(firstIds.length + secondIds.length).toBe(200);
    lastTurn(t.driver).finish(); await t.idle();
  });

  test.each(["enqueue", "pause", "dispatch", "completion"])("%s fsync failure never falsely acknowledges or starts the next item and drains owned work", async stage => {
    let unblock!: (value: any) => void;
    const t = setup({ options: stage === "dispatch" ? { childMcp: async () => new Promise(resolve => { unblock = resolve; }) } : {} });
    const id = await t.create();
    const first = await t.run({ type: "prompt.send", text: "first" }, id);
    if (stage === "dispatch") await waitFor(() => !!unblock, PROGRESS_TIMEOUT_MS, "held preflight"); else await waitFor(() => t.driver.turns.length === 1, PROGRESS_TIMEOUT_MS, "owned lead");
    if (stage !== "enqueue") await t.run({ type: "prompt.send", text: "next must not run" }, id);
    const log = t.manager.openLog(id)!, flush = log.flush.bind(log);
    log.flush = () => { throw new Error("synthetic-fsync-failure"); };
    const retryId = "77777777-7777-4777-8777-777777777777";
    if (stage === "enqueue") await expect(t.runWithId(retryId, { type: "prompt.send", text: "next must not run" }, id)).rejects.toThrow("synthetic-fsync-failure");
    else if (stage === "pause") await expect(t.run({ type: "turn.interrupt", taskId: "lead" }, id)).rejects.toThrow("synthetic-fsync-failure");
    else if (stage === "dispatch") unblock({ runnerPackages: () => [], resolveServer: () => undefined });
    else lastTurn(t.driver).finish();
    await waitFor(() => !t.manager.hasRunningWork(), PROGRESS_TIMEOUT_MS, "fault cleanup drained");
    log.flush = flush;
    expect(t.driver.turns).toHaveLength(stage === "dispatch" ? 0 : 1);
    expect((await t.runWithId(stage === "enqueue" ? retryId : (first as any).data.promptId, { type: "prompt.send", text: stage === "enqueue" ? "next must not run" : "first" }, id) as any).code).toBe("log-write-failed");
  });

  test("complete queued intent without its receipt restores exactly once after restart", async () => {
    const t = setup(); const id = await t.create();
    const commandId = "88888888-8888-4888-8888-888888888888", text = "prefix accepted instruction";
    t.manager.openLog(id)!.append({ kind: "prompt.queued", data: { promptId: commandId, text, textHash: (await import("node:crypto")).createHash("sha256").update(text).digest("hex"), by: "test", generation: 0, position: 1 } });
    t.manager.openLog(id)!.flush(); await t.manager.close();
    const driver = new FakeDriver(); driver.autoComplete = true;
    const reopened = setup({ dir: t.dir, driver });
    await waitFor(() => driver.turns.length === 1, PROGRESS_TIMEOUT_MS, "recovered queue admission"); await reopened.idle();
    expect(driver.turns[0]!.input.prompt).toBe(text);
    expect(await reopened.runWithId(commandId, { type: "prompt.send", text }, id)).toMatchObject({ ok: true, duplicate: true });
    expect(driver.turns).toHaveLength(1);
  });

  test("stop intent prefix cancels the entire inbox and never restarts its remaining entries", async () => {
    const t = setup(); const id = await t.create();
    t.manager.openLog(id)!.append({ kind: "prompt.queue", data: { paused: true, reason: "test" } });
    await t.run({ type: "prompt.send", text: "one" }, id); await t.run({ type: "prompt.send", text: "two" }, id);
    const commandId = "99999999-9999-4999-8999-999999999999";
    t.manager.openLog(id)!.append({ kind: "session.state", data: { state: "stopping", cancelPrompts: true, commandId, outcome: { ok: true, data: { state: "ended" } } } }); t.manager.openLog(id)!.flush(); await t.manager.close();
    recoverAllSessions({ paths: t.paths, probe: createNodeProbe() });
    const reopened = setup({ dir: t.dir });
    expect((await reopened.manager.query("prompts.list", { sessionId: id }) as any).data.queued).toEqual([]);
    expect(await reopened.runWithId(commandId, { type: "session.stop" }, id)).toMatchObject({ ok: true, duplicate: true });
    expect(reopened.driver.turns).toHaveLength(0);
  });

  test("resume intent prefix owns one barrier and replay cannot clear a newer failure pause", async () => {
    const t = setup(); const id = await t.create();
    const commandId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    t.manager.openLog(id)!.appendMany([{ kind: "prompt.queue", data: { paused: true, reason: "interrupted" } }, { kind: "prompt.queue", data: { paused: false, commandId } }, { kind: "prompt.queue", data: { paused: true, reason: "later-failure" } }]); t.manager.openLog(id)!.flush(); await t.manager.close();
    const reopened = setup({ dir: t.dir });
    expect(await reopened.runWithId(commandId, { type: "prompt.resume" }, id)).toMatchObject({ ok: true, duplicate: true });
    expect((await reopened.manager.query("prompts.list", { sessionId: id }) as any).data).toMatchObject({ paused: true, pauseReason: "later-failure" });
  });

  test("cancel during held preflight never delivers that item and starts the next FIFO item", async () => {
    let release!: (value: any) => void, calls = 0;
    const t = setup({ options: { childMcp: async () => ++calls === 1 ? new Promise(resolve => { release = resolve; }) : { runnerPackages: () => [], resolveServer: () => undefined } } });
    const id = await t.create(); const first = await t.run({ type: "prompt.send", text: "cancel before native" }, id);
    await waitFor(() => !!release, PROGRESS_TIMEOUT_MS, "held tools");
    const second = await t.run({ type: "prompt.send", text: "next item" }, id);
    expect((await t.run({ type: "prompt.cancel", promptId: (first as any).data.promptId }, id)).ok).toBe(true);
    release({ runnerPackages: () => [], resolveServer: () => undefined });
    await waitFor(() => t.driver.turns.length === 1, PROGRESS_TIMEOUT_MS, "next admitted");
    expect(lastTurn(t.driver).input.prompt).toBe("next item");
    expect(t.events(id).find(e => e.kind === "prompt.state" && e.data.promptId === (first as any).data.promptId)?.data.state).toBe("cancelled");
    expect(t.events(id).filter(e => e.kind === "message.completed" && e.data.role === "user").map(e => e.data.text)).toEqual(["next item"]);
    expect((await t.manager.query("prompts.list", { sessionId: id }) as any).data.paused).toBe(false);
    expect((await t.run({ type: "prompt.cancel", promptId: (second as any).data.promptId }, id) as any).code).toBe("prompt-already-started");
    lastTurn(t.driver).finish(); await t.idle();
  });

  test("prompt IDs retain typed content deduplication after command receipt eviction", async () => {
    const t = setup(); const id = await t.create();
    const commandId = "66666666-6666-4666-8666-666666666666";
    const first = await t.runWithId(commandId, { type: "prompt.send", text: "original" }, id);
    expect((await t.runWithId(commandId, { type: "prompt.send", text: "changed" }, id) as any).code).toBe("command-id-reused");
    t.manager.openLog(id)!.appendMany(Array.from({ length: 1002 }, (_, i) => ({ kind: "command.accepted" as const, data: { commandId: `eviction-${i}`, type: "session.bindChange", outcome: { ok: true } } })));
    expect(await t.runWithId(commandId, { type: "prompt.send", text: "original" }, id)).toMatchObject({ ...first, duplicate: true });
    expect((await t.runWithId(commandId, { type: "prompt.send", text: "changed" }, id) as any).code).toBe("command-id-reused");
    expect((await t.runWithId(commandId, { type: "prompt.resume" }, id) as any).code).toBe("command-id-reused");
    await waitFor(() => t.driver.turns.length === 1, PROGRESS_TIMEOUT_MS, "one native turn"); lastTurn(t.driver).finish(); await t.idle();
  });

  test("restart with uncertain dispatched owner preserves all never-dispatched messages", async () => {
    const t = setup(); const id = await t.create();
    await t.run({ type: "prompt.send", text: "native active" }, id); await waitFor(() => t.driver.turns.length === 1, PROGRESS_TIMEOUT_MS, "lead");
    const second = await t.run({ type: "prompt.send", text: "second preserved" }, id), third = await t.run({ type: "prompt.send", text: "third preserved" }, id);
    const dir = tempDir(), paths = resolveStatePaths({ env: { HOME: dir, XDG_STATE_HOME: join(dir, "state") }, tmpdir: dir });
    ensureStateLayout(paths); cpSync(t.paths.sessionsDir, paths.sessionsDir, { recursive: true });
    recoverAllSessions({ paths, probe: createNodeProbe() });
    const reopened = setup({ dir });
    const snapshot = (await reopened.manager.query("prompts.list", { sessionId: id }) as any).data;
    expect(snapshot.queued.map((p: any) => [p.promptId, p.text])).toEqual([[(second as any).data.promptId, "second preserved"], [(third as any).data.promptId, "third preserved"]]);
    expect(snapshot.paused).toBe(true);
    expect((await reopened.run({ type: "prompt.resume" }, id) as any).code).toBe("ownership-unsettled");
    expect(reopened.driver.turns).toHaveLength(0);
    await t.run({ type: "session.stop" }, id); await t.idle();
  });

  test("queue count and UTF-8 aggregate limits reject without clearing accepted messages", async () => {
    const t = setup(); const id = await t.create();
    await t.run({ type: "prompt.send", text: "active" }, id); await waitFor(() => t.driver.turns.length === 1, PROGRESS_TIMEOUT_MS, "lead");
    for (let i = 0; i < 32; i++) expect((await t.run({ type: "prompt.send", text: `queued ${i}` }, id)).ok).toBe(true);
    expect((await t.run({ type: "prompt.send", text: "overflow" }, id) as any).code).toBe("prompt-queue-full");
    await t.run({ type: "session.stop" }, id); await t.idle();
    const next = await t.create(); await t.run({ type: "prompt.send", text: "active" }, next); await waitFor(() => t.driver.turns.length === 2, PROGRESS_TIMEOUT_MS, "next lead");
    const multibyte = "界".repeat(200_000);
    expect((await t.run({ type: "prompt.send", text: multibyte }, next)).ok).toBe(true);
    expect((await t.run({ type: "prompt.send", text: multibyte }, next) as any).code).toBe("prompt-queue-full");
    expect((await t.manager.query("prompts.list", { sessionId: next }) as any).data.queued).toHaveLength(1);
    await t.run({ type: "session.stop" }, next); await t.idle();
  });

  test("durable user prompts queue FIFO behind one Lead and cancel before dispatch", async () => {
    const t = setup(); const id = await t.create();
    const first = await t.run({ type: "prompt.send", text: "first" }, id);
    expect(first).toMatchObject({ ok: true, data: { promptId: expect.any(String), state: "queued", position: 1 } });
    await waitFor(() => t.driver.turns.length === 1, PROGRESS_TIMEOUT_MS, "first lead"); const firstTurn = lastTurn(t.driver); firstTurn.init();
    const second = await t.run({ type: "prompt.send", text: "second" }, id);
    const third = await t.run({ type: "prompt.send", text: "third" }, id);
    expect(second.ok).toBe(true); expect(third.ok).toBe(true); expect(t.driver.turns).toHaveLength(1);
    const queue = (await t.manager.query("prompts.list", { sessionId: id }) as any).data;
    expect(queue.queued.map((p: any) => p.text)).toEqual(["second", "third"]);
    expect(t.events(id).filter(e => e.kind === "message.completed" && e.data.role === "user").map(e => e.data.text)).toEqual(["first"]);
    expect((await t.run({ type: "prompt.cancel", promptId: (second as any).data.promptId }, id)).ok).toBe(true);
    firstTurn.finish(); await waitFor(() => t.driver.turns.length === 2, PROGRESS_TIMEOUT_MS, "third lead");
    expect(lastTurn(t.driver).input.prompt).toBe("third");
    expect(lastTurn(t.driver).input.resume?.nativeSessionId).toBe(firstTurn.nativeSessionId);
    expect((await t.run({ type: "prompt.cancel", promptId: (third as any).data.promptId }, id) as any).code).toBe("prompt-already-started");
    lastTurn(t.driver).finish(); await t.idle();
    expect((await t.manager.query("prompts.list", { sessionId: id }) as any).data.queued).toEqual([]);
  });

  test("interrupt pauses accepted pending prompts and resume waits until the current handle drains", async () => {
    const t = setup(); const id = await t.create();
    await t.run({ type: "prompt.send", text: "first" }, id); await waitFor(() => t.driver.turns.length === 1, PROGRESS_TIMEOUT_MS, "first lead");
    const first = lastTurn(t.driver); first.init();
    await t.run({ type: "prompt.send", text: "second" }, id);
    await t.run({ type: "turn.interrupt", taskId: "lead" }, id); await t.idle();
    expect((await t.manager.query("prompts.list", { sessionId: id }) as any).data.paused).toBe(true);
    expect(t.driver.turns).toHaveLength(1);
    await t.run({ type: "prompt.send", text: "third" }, id);
    expect(t.driver.turns).toHaveLength(1);
    await t.run({ type: "prompt.resume" }, id); await waitFor(() => t.driver.turns.length === 2, PROGRESS_TIMEOUT_MS, "resume second");
    expect(lastTurn(t.driver).input.prompt).toBe("second"); lastTurn(t.driver).finish();
    await waitFor(() => t.driver.turns.length === 3, PROGRESS_TIMEOUT_MS, "resume third"); lastTurn(t.driver).finish(); await t.idle();
  });

  test("project removal preserves active work, session history and restart visibility until explicit Add", async () => {
    const t = setup(); const id = await t.create();
    const projectId = (await t.manager.query("sessions.list", {}) as any).data.sessions[0].projectId;
    await t.run({ type: "prompt.send", text: "Continue working" }, id); await waitFor(() => t.driver.turns.length === 1, PROGRESS_TIMEOUT_MS, "lead");
    const lead = lastTurn(t.driver); lead.init();
    expect((await t.run({ type: "project.rename", projectId, name: "  My project  " }) as any).data.project.name).toBe("My project");
    const removeId = "55555555-5555-4555-8555-555555555555";
    expect(await t.runWithId(removeId, { type: "project.remove", projectId })).toMatchObject({ ok: true, data: { projectId, removed: true } });
    expect((await t.manager.query("projects.list", {}) as any).data.projects).toEqual([]);
    expect(lead.finished).toBe(false); expect(lead.interrupts).toHaveLength(0); expect(existsSync(t.project)).toBe(true);
    expect((await t.manager.query("sessions.status", { projectId, sessionIds: [id] }) as any).data.sessions[0].leadActivity.state).toBe("running");
    lead.say("Work completed after removal"); lead.finish(); await t.idle();
    const before = t.events(id);
    await t.manager.close(); const reopened = setup({ dir: t.dir });
    expect((await reopened.manager.query("projects.list", {}) as any).data.projects).toEqual([]);
    expect(reopened.events(id)).toEqual(before);
    expect((await reopened.run({ type: "session.create", projectRoot: reopened.project }, undefined, "web:test")).ok).toBe(true);
    expect((await reopened.manager.query("projects.list", {}) as any).data.projects).toEqual([]);
    const restored = await reopened.run({ type: "project.register", path: reopened.project });
    expect((restored as any).data.project).toMatchObject({ projectId, name: "My project" });
    expect((await reopened.manager.query("sessions.list", { projectId }) as any).data.sessions.some((s: any) => s.sessionId === id)).toBe(true);
    expect(await reopened.runWithId(removeId, { type: "project.remove", projectId })).toMatchObject({ ok: true, duplicate: true });
    expect((await reopened.manager.query("projects.list", {}) as any).data.projects).toHaveLength(1);
  });

  test("bounded status polling is project scoped and reports only current Lead activity", async () => {
    const t = setup({ config: baseConfig({ members: { lead: { runnerId: "claude", modelId: "opus" }, investigate: { runnerId: "claude", modelId: "fast" } } }) });
    const id = await t.create();
    const projectId = (await t.manager.query("sessions.list", {}) as any).data.sessions[0].projectId;
    const otherRoot = tempSubdir(t.dir, "other");
    const other = await t.run({ type: "session.create", projectRoot: otherRoot });
    const read = async () => (await t.manager.query("sessions.status", { projectId, sessionIds: [id, (other as any).data.sessionId, "missing"] }) as any).data.sessions;
    expect(await read()).toMatchObject([{ sessionId: id, leadActivity: { state: "idle", lastReplySeq: 0, pendingApprovals: 0 } }]);
    await t.run({ type: "prompt.send", text: "Start" }, id); await waitFor(() => t.driver.turns.length === 1, PROGRESS_TIMEOUT_MS, "lead");
    const lead = lastTurn(t.driver); lead.init();
    const delegated = await t.manager.callTaskTool(grantFor(t, id), "deck_delegate", { agent: "investigate", task: "Child" });
    await waitFor(() => t.driver.turns.length === 2, PROGRESS_TIMEOUT_MS, "child"); const child = lastTurn(t.driver); child.init(); child.say("child response");
    const childApproval = t.broker.request({ sessionId: id, taskId: (delegated as any).data.taskId, memberId: "investigate", tool: "Bash" });
    expect((await read())[0].leadActivity).toMatchObject({ taskId: "lead", state: "running", pendingApprovals: 0, lastReplySeq: 0 });
    const leadApproval = t.broker.request({ sessionId: id, taskId: "lead", memberId: "lead", tool: "Bash" });
    expect((await read())[0].leadActivity.pendingApprovals).toBe(1);
    t.broker.respond({ approvalId: leadApproval.approvalId, decision: "deny", by: "test" });
    t.broker.respond({ approvalId: childApproval.approvalId, decision: "deny", by: "test" });
    lead.say("Actual reply"); const replySeq = t.events(id).at(-1)!.seq;
    lead.emit("message.delta", { text: "later delta" }); lead.emit("reasoning.delta", { text: "reasoning" }); lead.emit("tool.completed", { tool: "Bash", output: "result" });
    lead.emit("message.completed", { role: "system", text: "helper" }); lead.emit("message.completed", { role: "assistant", text: "internal", internal: true }); lead.emit("message.completed", { role: "assistant", text: "   " });
    expect((await read())[0].leadActivity.lastReplySeq).toBe(replySeq);
    child.finish(); await waitFor(() => child.closed, PROGRESS_TIMEOUT_MS, "child drain"); await t.manager.callTaskTool(grantFor(t, id), "deck_task_result", { taskId: (delegated as any).data.taskId });
    lead.finish(); await t.idle();
    await t.run({ type: "session.assignMember", memberId: "lead", expectedRevision: 0, assignment: { runnerId: "claude", modelId: "new" } }, id);
    expect((await read())[0].leadActivity).toMatchObject({ state: "idle", lastReplySeq: replySeq });
    expect((await read())[0].leadActivity.taskId).toBeUndefined();
    const staleApproval = t.broker.request({ sessionId: id, taskId: "lead", memberId: "lead", tool: "Bash" });
    expect((await read())[0].leadActivity.pendingApprovals).toBe(0);
    t.broker.respond({ approvalId: staleApproval.approvalId, decision: "deny", by: "test" });
    await t.manager.close(); const reopened = setup({ dir: t.dir });
    expect((await reopened.manager.query("sessions.status", { projectId, sessionIds: [id] }) as any).data.sessions[0].leadActivity.lastReplySeq).toBe(replySeq);
    const log = reopened.manager.openLog(id)!;
    const readAfter = log.readAfter.bind(log);
    log.readAfter = function* () { throw new Error("status polling must not read event segments"); };
    expect((await reopened.manager.query("sessions.status", { projectId, sessionIds: [id, id] }) as any).data.sessions).toHaveLength(1);
    log.readAfter = readAfter;
    expect((await reopened.manager.query("sessions.status", { projectId, sessionIds: Array(101).fill(id) }) as any).code).toBe("sessions-status-invalid");
    expect((await reopened.manager.query("sessions.status", { projectId, sessionIds: ["../invalid"] }) as any).code).toBe("sessions-status-invalid");
  });

  test("continuation rejects a replaced canonical project instead of silently following its symlink", async () => {
    const t = setup(); const id = await t.create(); await t.run({ type: "session.stop" }, id);
    const other = tempSubdir(t.dir, "other"); renameSync(t.project, join(t.dir, "old")); symlinkSync(other, t.project);
    expect((await t.run({ type: "session.continue" }, id) as any).code).toBe("project-unavailable");
    expect((await t.manager.query("sessions.list", {}) as any).data.sessions).toHaveLength(1);
  });

  test("successor retains an inherited member removed from current global defaults", async () => {
    const t = setup({ config: baseConfig({ members: { lead: { runnerId: "claude", modelId: "opus" }, investigate: { runnerId: "claude", modelId: "fast" } } }) });
    const source = await t.create(); await t.run({ type: "session.stop" }, source);
    delete t.state.config!.members.investigate;
    const successor = await t.run({ type: "session.continue" }, source);
    expect(successor.ok).toBe(true);
    const summaries = (await t.manager.query("sessions.list", {}) as any).data.sessions;
    expect(summaries.find((s: any) => s.sessionId === (successor as any).data.sessionId).members.investigate).toEqual({ runnerId: "claude", modelId: "fast" });
    expect((await t.run({ type: "session.create", projectRoot: t.project, members: { arbitrary: { runnerId: "claude", modelId: "fast" } } }) as any).code).toBe("member-not-assigned");
  });

  test("delegated admission rotates sessions instead of draining one backlog", async () => {
    const t = setup({ config: baseConfig({ members: { lead: { runnerId: "claude", modelId: "opus" }, investigate: { runnerId: "claude", modelId: "fast" } }, executionBudget: { lead: 2, delegated: 1 } }) });
    const one = await t.create(), two = await t.create();
    await t.run({ type: "prompt.send", text: "lead-one" }, one); await t.run({ type: "prompt.send", text: "lead-two" }, two);
    await waitFor(() => t.driver.turns.length === 2, PROGRESS_TIMEOUT_MS, "two leads");
    await t.manager.callTaskTool(grantFor(t, one), "deck_delegate", { agent: "investigate", task: "one-first" });
    await t.manager.callTaskTool(grantFor(t, one), "deck_delegate", { agent: "investigate", task: "one-second" });
    await t.manager.callTaskTool(grantFor(t, two), "deck_delegate", { agent: "investigate", task: "two-first" });
    await waitFor(() => t.driver.turns.length === 3, PROGRESS_TIMEOUT_MS, "first child");
    expect(lastTurn(t.driver).input.prompt).toBe("one-first"); lastTurn(t.driver).finish();
    await waitFor(() => t.driver.turns.length === 4, PROGRESS_TIMEOUT_MS, "fair next child");
    expect(lastTurn(t.driver).input.prompt).toBe("two-first"); lastTurn(t.driver).finish();
    await waitFor(() => t.driver.turns.length === 5, PROGRESS_TIMEOUT_MS, "return to backlog");
    expect(lastTurn(t.driver).input.prompt).toBe("one-second");
    await t.run({ type: "session.stop" }, one); await t.run({ type: "session.stop" }, two); await t.idle();
  });

  test("repairs a successor creation crash from durable transfer intent", async () => {
    const t = setup({ config: baseConfig({ members: { lead: { runnerId: "claude", modelId: "opus" }, investigate: { runnerId: "claude", modelId: "fast" } } }) }); t.driver.autoComplete = true;
    const source = await t.create(); await t.run({ type: "prompt.send", text: "Preserve context" }, source); await t.idle();
    await t.run({ type: "session.stop" }, source);
    const sourceSeq = t.events(source).at(-1)!.seq;
    const commandId = "33333333-3333-4333-8333-333333333333";
    const result = await t.runWithId(commandId, { type: "session.continue" }, source);
    const target = (result as any).data.sessionId as string;
    await t.manager.close();
    // Model the metadata-committed/log-not-written crash boundary.
    const paths = sessionPaths(t.paths, target);
    rmSync(paths.eventsDir, { recursive: true }); rmSync(paths.ledgerSnapshotFile, { force: true });
    const sourcePaths = sessionPaths(t.paths, source);
    rmSync(sourcePaths.ledgerSnapshotFile, { force: true });
    for (const name of readdirSync(sourcePaths.eventsDir).filter(name => name.endsWith(".jsonl"))) {
      const file = join(sourcePaths.eventsDir, name);
      const kept = readFileSync(file, "utf8").trim().split("\n").filter(line => JSON.parse(line).seq <= sourceSeq);
      if (kept.length) writeFileSync(file, `${kept.join("\n")}\n`); else rmSync(file);
    }
    const reopened = setup({ dir: t.dir, config: baseConfig({ members: { lead: { runnerId: "claude", modelId: "opus" }, investigate: { runnerId: "claude", modelId: "latest" } } }) });
    expect(reopened.events(target).find(e => e.kind === "session.created")?.data.handoff).toMatchObject({ text: expect.stringContaining("Preserve context"), sourceSessionId: source, continuity: "reseeded" });
    expect((await reopened.runWithId(commandId, { type: "session.continue" }, source) as any).data.sessionId).toBe(target);
    expect((await reopened.manager.query("sessions.list", {}) as any).data.sessions.find((s: any) => s.sessionId === target).members.investigate.modelId).toBe("fast");
    reopened.driver.autoComplete = true;
    await reopened.run({ type: "prompt.send", text: "Continue" }, target); await reopened.idle();
    expect(lastTurn(reopened.driver).input.rolePrompt).toContain("Preserve context");
    expect(lastTurn(reopened.driver).input.resume).toBeUndefined();
  });

  test.each([
    "codebase-memory-unavailable", "codebase-memory-unsupported", "codebase-memory-cancelled",
    "web-search-credential-missing", "web-search-provider-unconfigured",
  ])("preparation retains bounded tool failure %s", async (reasonCode) => {
    const secret = "private-token-never-publish";
    const t = setup({ options: { childMcp: async () => { throw new Error(`${reasonCode}: ${secret}`); } } });
    const id = await t.create();
    await t.run({ type: "session.prepare" }, id); await t.idle();
    expect((await t.manager.query("session.readiness", { sessionId: id }) as any).data).toMatchObject({ status: "failed", phase: "preparing-tools", reasonCode });
    expect(JSON.stringify(t.events(id))).not.toContain(secret);
    expect(t.driver.turns).toHaveLength(0);
  });

  test.each([
    "native-memory-scope-unavailable", "native-memory-profile-unavailable", "native-memory-plugin-unavailable",
    "unknown: private-token-never-publish",
  ])("preparation bounds native memory failure %s", async (reasonCode) => {
    let releases = 0;
    const t = setup({ options: { childMcp: {
      nativeMemory: { provider: "supermemory", integration: "runner-plugin", status: "unavailable", reasonCode },
      runnerPackages: () => [], resolveServer: () => undefined, release: async () => { releases++; },
    } } });
    const id = await t.create();
    await t.run({ type: "session.prepare" }, id); await t.idle();
    expect((await t.manager.query("session.readiness", { sessionId: id }) as any).data).toMatchObject({ status: "failed", reasonCode: reasonCode.startsWith("unknown:") ? "native-memory-unavailable" : reasonCode });
    expect(JSON.stringify(t.events(id))).not.toContain("private-token-never-publish");
    expect(releases).toBe(1);
  });

  test.each(["unknown: private-token-never-publish", "codebase-memory-unavailable-private-token-never-publish"])("preparation redacts unknown tool failures %s", async (message) => {
    const t = setup({ options: { childMcp: async () => { throw new Error(message); } } });
    const id = await t.create();
    await t.run({ type: "session.prepare" }, id); await t.idle();
    expect((await t.manager.query("session.readiness", { sessionId: id }) as any).data).toMatchObject({ status: "failed", reasonCode: "preparation-tools-failed" });
    expect(JSON.stringify(t.events(id))).not.toContain("private-token-never-publish");
  });

  test("preparation timeout is terminal without starting a model and permits retry", async () => {
    const clock = new FakeClock(); const t = setup({ options: { clock } }); const id = await t.create();
    let probing = false;
    t.driver.probe = () => { probing = true; return new Promise(() => {}); };
    await t.run({ type: "session.prepare" }, id); await waitFor(() => probing, PROGRESS_TIMEOUT_MS, "probe");
    clock.advance(30_000); await t.idle();
    expect((await t.manager.query("session.readiness", { sessionId: id }) as any).data).toMatchObject({ status: "failed", reasonCode: "preparation-timeout" });
    expect(t.driver.turns).toHaveLength(0);
    t.driver.probe = async () => t.driver.probeResult;
    await t.run({ type: "session.prepare" }, id); await t.idle();
    expect((await t.manager.query("session.readiness", { sessionId: id }) as any).data.status).toBe("ready");
  });

  test("prototype property names are not configured team members", async () => {
    const t = setup(); const id = await t.create();
    expect((await t.run({ type: "session.assignMember", memberId: "constructor", expectedRevision: 0, assignment: { runnerId: "claude", modelId: "opus" } }, id) as any).code).toBe("member-not-assigned");
    expect(t.events(id).some(e => e.kind === "session.assignment")).toBe(false);
  });

  test("preparation remains busy until release drains and pruning cannot remove it", async () => {
    let drain!: () => void;
    const released = new Promise<void>(resolve => { drain = resolve; });
    const t = setup({ options: { childMcp: async () => ({ runnerPackages: () => [], resolveServer: () => undefined, release: () => released }) } });
    const id = await t.create(); await t.run({ type: "session.prepare" }, id);
    await waitFor(() => t.events(id).some(e => e.data.phase === "preparing-tools"), PROGRESS_TIMEOUT_MS, "preparation phase");
    expect((await t.manager.query("session.readiness", { sessionId: id }) as any).data.status).toBe("preparing");
    expect((await t.manager.query("sessions.list", {}) as any).data.sessions[0].leadActivity).toMatchObject({ state: "preparing", lastReplySeq: 0 });
    expect((await t.run({ type: "prompt.send", text: "too early" }, id) as any).code).toBe("session-preparing");
    expect((await t.manager.query("sessions.prune", { keep: 0 }) as any).data.removed).toEqual([]);
    drain(); await t.idle();
    expect((await t.manager.query("session.readiness", { sessionId: id }) as any).data.status).toBe("ready");
  });

  test("direct prompts reject replaced project roots even after successful preflight", async () => {
    const t = setup(); const id = await t.create();
    await t.run({ type: "session.prepare" }, id); await t.idle();
    const other = tempSubdir(t.dir, "other");
    renameSync(t.project, join(t.dir, "old")); symlinkSync(other, t.project);
    await t.run({ type: "prompt.send", text: "must not execute" }, id); await t.idle();
    expect(t.driver.turns).toHaveLength(0);
    expect(t.events(id).find(e => e.kind === "turn.completed")?.data.status).toBe("failed");
    expect((await t.manager.query("projects.list", {}) as any).data.projects[0].available).toBe(false);
  });

  test("concurrent duplicate assignment commands commit one revision", async () => {
    let probe!: () => void;
    const t = setup(); const id = await t.create();
    t.driver.probe = () => new Promise(resolve => { probe = () => resolve(t.driver.probeResult); });
    const commandId = "22222222-2222-4222-8222-222222222222";
    const command = { type: "session.assignMember" as const, memberId: "lead", expectedRevision: 0, assignment: { runnerId: "claude", modelId: "other" } };
    const first = t.runWithId(commandId, command, id), second = t.runWithId(commandId, command, id);
    await waitFor(() => !!probe, PROGRESS_TIMEOUT_MS, "probe waits"); probe();
    expect(await first).toMatchObject({ ok: true, data: { revision: 1, generation: 1 } });
    expect(await second).toMatchObject({ ok: true, duplicate: true, data: { revision: 1, generation: 1 } });
    expect(t.events(id).filter(e => e.kind === "session.assignment")).toHaveLength(1);
  });

  test("preflight failures never persist thrown credential material and validate project instructions", async () => {
    const t = setup({ options: { rolePrompt: () => { throw new Error("PRIVATE-CREDENTIAL-MARKER"); } } });
    const id = await t.create();
    await t.run({ type: "session.prepare" }, id); await t.idle();
    expect((await t.manager.query("session.readiness", { sessionId: id }) as any).data).toMatchObject({ status: "failed", reasonCode: "project-instructions-unavailable" });
    expect(JSON.stringify(t.events(id))).not.toContain("PRIVATE-CREDENTIAL-MARKER");
    expect(t.driver.turns).toHaveLength(0);
  });

  test("stale preparation cancellation cannot revoke a newly assigned generation", async () => {
    let releases = 0;
    const t = setup({ options: { childMcp: async () => ({ runnerPackages: () => [], resolveServer: () => undefined, release: async () => { releases++; } }) } });
    const id = await t.create();
    const first = await t.run({ type: "session.prepare" }, id); await t.idle();
    expect(releases).toBe(1);
    await t.run({ type: "session.assignMember", memberId: "lead", expectedRevision: 0, assignment: { runnerId: "claude", modelId: "other" } }, id);
    await t.run({ type: "session.prepare" }, id); await t.idle();
    expect((await t.run({ type: "session.prepare.cancel", preparationId: (first as any).data.preparation.preparationId }, id) as any).code).toBe("preparation-stale");
    expect((await t.manager.query("session.readiness", { sessionId: id }) as any).data).toMatchObject({ status: "ready", generation: 1 });
    expect(releases).toBe(2);
  });

  test("current Lead can continue an old delegated owner and is the only completion wake target", async () => {
    const codex = new FakeDriver("codex");
    const t = setup({ config: baseConfig({ members: { lead: { runnerId: "claude", modelId: "opus" }, investigate: { runnerId: "claude", modelId: "fast" } } }) });
    (t.manager as any).options.drivers.get = (id: string) => id === "claude" ? t.driver : id === "codex" ? codex : undefined;
    const id = await t.create(); await t.run({ type: "prompt.send", text: "Start" }, id);
    await waitFor(() => t.driver.turns.length === 1, PROGRESS_TIMEOUT_MS, "first lead"); const original = lastTurn(t.driver); original.init();
    const firstGrant = grantFor(t, id);
    const delegated = await t.manager.callTaskTool(firstGrant, "deck_delegate", { agent: "investigate", task: "Inspect" });
    await waitFor(() => t.driver.turns.length === 2, PROGRESS_TIMEOUT_MS, "child"); const child = lastTurn(t.driver); child.init(); child.finish();
    await waitFor(() => child.closed, PROGRESS_TIMEOUT_MS, "child drain");
    await t.manager.callTaskTool(firstGrant, "deck_task_result", { taskId: (delegated as any).data.taskId });
    original.finish(); await t.idle();
    await t.run({ type: "session.assignMember", memberId: "lead", expectedRevision: 0, assignment: { runnerId: "codex", modelId: "gpt" } }, id);
    await t.run({ type: "prompt.send", text: "Follow up" }, id); await waitFor(() => codex.turns.length === 1, PROGRESS_TIMEOUT_MS, "new lead");
    const current = lastTurn(codex); current.init(); const currentGrant = grantFor(t, id, "lead-g1");
    const bridge = new BridgeService({ credentials: t.credentials, broker: t.broker, status: g => t.manager.taskStatus(g), callTaskTool: (g, name, args, context) => t.manager.callTaskTool(g, name, args, context) });
    const token = JSON.parse(readFileSync(sessionPaths(t.paths, id).taskCredentialFile("lead-g1"), "utf8")).token;
    expect((await bridge.call({ token, tool: "deck_delegate", arguments: { agent: "investigate", task: "Continue inspection", continueTaskId: (delegated as any).data.taskId } })).ok).toBe(true);
    await waitFor(() => t.driver.turns.length === 3, PROGRESS_TIMEOUT_MS, "original child continued");
    const continued = lastTurn(t.driver);
    expect(continued.input.assignment).toEqual({ runnerId: "claude", modelId: "fast" });
    expect(continued.input.resume?.nativeSessionId).toBe(child.nativeSessionId);
    expect((await t.manager.callTaskTool(firstGrant, "deck_delegate", { agent: "investigate", task: "stale" }) as any).code).toBe("credential-revoked");
    current.finish(); await waitFor(() => current.closed, PROGRESS_TIMEOUT_MS, "current drain"); continued.finish();
    await waitFor(() => codex.turns.length === 2, PROGRESS_TIMEOUT_MS, "current lead wake");
    expect(lastTurn(codex).input.taskId).toBe("lead-g1");
    expect(lastTurn(codex).input.resume?.nativeSessionId).toBe(current.nativeSessionId);
    expect(t.driver.turns.filter(turn => turn.input.memberId === "lead")).toHaveLength(1);
    await t.manager.callTaskTool(grantFor(t, id, "lead-g1"), "deck_task_result", { taskId: (delegated as any).data.taskId });
    lastTurn(codex).finish(); await t.idle();
    expect(codex.turns).toHaveLength(2);
    void currentGrant;
  });

  test("stopping a globally queued Lead never starts it and other sessions continue", async () => {
    const t = setup({ config: baseConfig({ executionBudget: { lead: 1, delegated: 1 } }) });
    const one = await t.create(), two = await t.create(), three = await t.create();
    for (const [id, text] of [[one, "one"], [two, "two"], [three, "three"]]) await t.run({ type: "prompt.send", text: text! }, id);
    await waitFor(() => t.driver.turns.length === 1, PROGRESS_TIMEOUT_MS, "admitted lead");
    expect((await t.run({ type: "session.stop" }, two) as any).data.state).toBe("ended");
    lastTurn(t.driver).finish(); await waitFor(() => t.driver.turns.length === 2, PROGRESS_TIMEOUT_MS, "next lead");
    expect(lastTurn(t.driver).input.prompt).toBe("three");
    expect(t.events(two).find(e => e.kind === "task.state" && e.data.state === "cancelled")).toBeDefined();
    expect(t.driver.turns.some(turn => turn.input.prompt === "two")).toBe(false);
    lastTurn(t.driver).finish(); await t.idle();
  });

  test("registers projects and creates independent filtered paginated sessions", async () => {
    const t = setup();
    const registered = await t.run({ type: "project.register", path: t.project, name: "Deck" });
    expect(registered.ok).toBe(true);
    const projectId = (registered as any).data.project.projectId;
    const one = await t.run({ type: "session.create", projectId, title: "One" });
    const two = await t.run({ type: "session.create", projectId, title: "Two" });
    expect((one as any).data.sessionId).not.toBe((two as any).data.sessionId);
    const page = await t.manager.query("sessions.list", { projectId, limit: 1 });
    expect((page as any).data.sessions).toHaveLength(1);
    const next = await t.manager.query("sessions.list", { projectId, limit: 1, cursor: (page as any).data.nextCursor });
    expect((next as any).data.sessions).toHaveLength(1);
    expect((next as any).data.sessions[0].sessionId).not.toBe((page as any).data.sessions[0].sessionId);
    expect((await t.manager.query("projects.list", {}) as any).data.projects).toHaveLength(1);
  });

  test("prepares without a model turn and cancellation drains late resources once", async () => {
    let resolve!: (value: any) => void, releases = 0;
    const t = setup({ options: { childMcp: () => new Promise(r => { resolve = r; }) } });
    const id = await t.create();
    const result = await t.run({ type: "session.prepare" }, id);
    expect((result as any).data.preparation.status).toBe("preparing");
    await waitFor(() => !!resolve, PROGRESS_TIMEOUT_MS, "resolver invoked");
    expect(t.driver.turns).toHaveLength(0);
    const cancelled = t.run({ type: "session.prepare.cancel", preparationId: (result as any).data.preparation.preparationId }, id);
    resolve({ runnerPackages: () => [], resolveServer: () => undefined, release: async () => { releases++; } });
    await cancelled;
    await waitFor(() => releases === 1, PROGRESS_TIMEOUT_MS, "resource release");
    expect((await t.manager.query("session.readiness", { sessionId: id }) as any).data.status).toBe("cancelled");
    expect(t.driver.turns).toHaveLength(0);
  });

  test("Lead generations preserve old owners and use a fresh native context with public handoff", async () => {
    const codex = new FakeDriver("codex");
    const t = setup();
    (t.manager as any).options.drivers.get = (id: string) => id === "claude" ? t.driver : id === "codex" ? codex : undefined;
    const id = await t.create();
    await t.run({ type: "prompt.send", text: "Remember the feature" }, id);
    await waitFor(() => t.driver.turns.length === 1, PROGRESS_TIMEOUT_MS, "turn");
    lastTurn(t.driver).init(); lastTurn(t.driver).say("Feature context"); lastTurn(t.driver).finish(); await t.idle();
    const switched = await t.run({ type: "session.assignMember", memberId: "lead", expectedRevision: 0, assignment: { runnerId: "codex", modelId: "gpt" } }, id);
    expect((switched as any).data.generation).toBe(1);
    expect((await t.run({ type: "session.assignMember", memberId: "lead", expectedRevision: 0, assignment: { runnerId: "codex", modelId: "other" } }, id)).ok).toBe(false);
    await t.run({ type: "prompt.send", text: "Continue" }, id);
    await waitFor(() => codex.turns.length === 1, PROGRESS_TIMEOUT_MS, "new runner");
    expect(lastTurn(codex).input.taskId).toBe("lead-g1");
    expect(lastTurn(codex).input.resume).toBeUndefined();
    expect(lastTurn(codex).input.rolePrompt).toContain("Feature context");
    expect(t.events(id).find(e => e.kind === "task.created" && e.data.taskId === "lead")?.data.modelId).toBe("opus");
    lastTurn(codex).finish(); await t.idle();
  });

  test("ended sessions continue into idempotent linked successors with fresh native identity", async () => {
    const t = setup(); const source = await t.create();
    await t.run({ type: "session.stop" }, source);
    const commandId = "11111111-1111-4111-8111-111111111111";
    const result = await t.runWithId(commandId, { type: "session.continue", title: "Follow up" }, source);
    expect(result.ok).toBe(true);
    const again = await t.runWithId(commandId, { type: "session.continue", title: "Follow up" }, source);
    expect((again as any).data.sessionId).toBe((result as any).data.sessionId);
    const sessions = (await t.manager.query("sessions.list", {}) as any).data.sessions;
    expect(sessions.find((s: any) => s.sessionId === (result as any).data.sessionId).predecessorSessionId).toBe(source);
    expect(sessions.find((s: any) => s.sessionId === source).state).toBe("ended");
  });

  test("daemon Lead admission is bounded while delegates retain independent capacity", async () => {
    const t = setup({ config: baseConfig({ members: { lead: { runnerId: "claude", modelId: "opus" }, investigate: { runnerId: "claude", modelId: "fast" } }, executionBudget: { lead: 1, delegated: 1 } }) });
    const one = await t.create(), two = await t.create();
    await t.run({ type: "prompt.send", text: "one" }, one);
    await t.run({ type: "prompt.send", text: "two" }, two);
    await waitFor(() => t.driver.turns.length === 1, PROGRESS_TIMEOUT_MS, "one admitted lead");
    const parent = lastTurn(t.driver); parent.init();
    const grant = t.credentials.lookup(JSON.parse(readFileSync(sessionPaths(t.paths, one).taskCredentialFile("lead"), "utf8")).token);
    expect(grant).toBeDefined();
    const result = await t.manager.callTaskTool(grant!, "deck_delegate", { agent: "investigate", task: "inspect" });
    expect(result.ok).toBe(true);
    await waitFor(() => t.driver.turns.length === 2, PROGRESS_TIMEOUT_MS, "delegate independent capacity");
    expect(lastTurn(t.driver).input.memberId).toBe("investigate");
    lastTurn(t.driver).finish(); parent.finish();
    await waitFor(() => t.driver.turns.some(x => x.input.prompt === "two"), PROGRESS_TIMEOUT_MS, "next admitted lead");
    for (const turn of t.driver.turns) turn.finish();
    await t.run({ type: "session.stop" }, one); await t.run({ type: "session.stop" }, two);
  });
});

describe("turn preparation diagnostics", () => {
  const preparation = (events: SessionEvent[]) => events.filter(e => e.kind === "diagnostic" && e.data.code === "turn.preparation");

  test("durably records actual preparation boundaries and driver turn start once with injected timing", async () => {
    const clock = new FakeClock();
    const driver = new FakeDriver();
    const t = setup({ driver, options: { clock, childMcp: async () => {
      clock.advance(60);
      return { runnerPackages: () => [], resolveServer: () => undefined };
    } } });
    const sessionId = await t.create();
    driver.probe = async () => { clock.advance(40); return driver.probeResult; };
    driver.onStart = turn => { clock.advance(100); turn.init(); turn.init(); };
    await t.run({ type: "prompt.send", text: "hello" }, sessionId);
    await waitFor(() => driver.turns.length === 1, PROGRESS_TIMEOUT_MS, "native start");
    expect(preparation(t.events(sessionId)).map(e => e.data)).toEqual([
      { code: "turn.preparation", phase: "checking-runner", attempt: 1, elapsedMs: 0 },
      { code: "turn.preparation", phase: "preparing-tools", attempt: 1, elapsedMs: 40, previousPhase: "checking-runner", previousPhaseDurationMs: 40 },
      { code: "turn.preparation", phase: "starting-runner", attempt: 1, elapsedMs: 100, previousPhase: "preparing-tools", previousPhaseDurationMs: 60 },
      { code: "turn.preparation", phase: "turn-started", attempt: 1, elapsedMs: 200, previousPhase: "starting-runner", previousPhaseDurationMs: 100 },
    ]);
    for (const e of preparation(t.events(sessionId))) expect(e.source).toMatchObject({ taskId: "lead", memberId: "lead", runnerId: "claude" });
    const firstNative = t.events(sessionId).find(e => e.kind === "turn.started")!;
    const ready = preparation(t.events(sessionId)).at(-1)!;
    expect(ready.seq).toBeGreaterThan(firstNative.seq);
    lastTurn(driver).finish(); await t.idle();
    await t.manager.close();
    const reopened = setup({ dir: t.dir });
    expect(preparation(reopened.events(sessionId)).map(e => e.data.phase)).toEqual(["checking-runner", "preparing-tools", "starting-runner", "turn-started"]);
  });

  test.each(["probe", "tools", "startup"])("%s failure never reports driver turn start", async stage => {
    const driver = new FakeDriver();
    const t = setup({ driver, options: { childMcp: async () => {
      if (stage === "tools") throw new Error("synthetic preparation failure");
      return { runnerPackages: () => [], resolveServer: () => undefined };
    } } });
    const sessionId = await t.create();
    if (stage === "probe") driver.probeResult = { ...driver.probeResult, status: "blocked", reasonCode: "synthetic-blocked" };
    if (stage === "startup") driver.startError = new Error("synthetic startup failure");
    await t.run({ type: "prompt.send", text: "hello" }, sessionId); await t.idle();
    const phases = preparation(t.events(sessionId)).map(e => e.data.phase);
    expect(phases).toEqual(stage === "probe" ? ["checking-runner"] : stage === "tools" ? ["checking-runner", "preparing-tools"] : ["checking-runner", "preparing-tools", "starting-runner"]);
    expect(t.events(sessionId).find(e => e.kind === "turn.completed")?.data.status).toBe("failed");
  });

  test("cancellation before native init never emits a late turn-started diagnostic", async () => {
    const t = setup(), sessionId = await t.create();
    await t.run({ type: "prompt.send", text: "hello" }, sessionId);
    await waitFor(() => t.driver.turns.length === 1, PROGRESS_TIMEOUT_MS, "native start");
    await t.run({ type: "task.cancel", taskId: "lead" }, sessionId);
    lastTurn(t.driver).init(); await t.idle(); lastTurn(t.driver).init();
    expect(preparation(t.events(sessionId)).map(e => e.data.phase)).toEqual(["checking-runner", "preparing-tools", "starting-runner"]);
  });
});

describe("read-only session OpenSpec queries", () => {
  test("uses the stored project and immutable ledger binding without modifying session events", async () => {
    const t = setup(), sessionId = await t.create();
    for (const changeId of ["alpha", "beta"]) {
      const dir = join(t.project, "openspec", "changes", changeId);
      mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, "proposal.md"), `# ${changeId}`);
    }
    const before = t.events(sessionId).length;
    expect(await t.manager.query("openspec.list", { sessionId, projectRoot: "/ignored" })).toMatchObject({ ok: true, data: { changes: [{ changeId: "alpha" }, { changeId: "beta" }] } });
    expect(await t.manager.query("openspec.read", { sessionId, changeId: "beta", path: "proposal.md", projectRoot: "/ignored" })).toMatchObject({ ok: true, data: { markdown: "# beta" } });
    expect(t.events(sessionId)).toHaveLength(before);
    expect(await t.run({ type: "session.bindChange", changeId: "alpha" }, sessionId)).toMatchObject({ ok: true });
    expect(await t.manager.query("openspec.list", { sessionId })).toMatchObject({ ok: true, data: { boundChangeId: "alpha", changes: [{ changeId: "alpha" }] } });
    expect(await t.manager.query("openspec.read", { sessionId, changeId: "beta", path: "proposal.md" })).toMatchObject({ ok: false, code: "openspec-forbidden" });
  });

  test("rejects missing/invalid sessions and restores the bound scope after reopening", async () => {
    const t = setup(), sessionId = await t.create({ changeId: "alpha" });
    expect(await t.manager.query("openspec.list", {})).toMatchObject({ ok: false, code: "openspec-invalid" });
    expect(await t.manager.query("openspec.read", { sessionId: "unknown", changeId: "alpha", path: "proposal.md" })).toMatchObject({ ok: false, code: "session-unknown" });
    expect(await t.manager.query("openspec.list", { sessionId: "../outside" })).toMatchObject({ ok: false, code: "session-unknown" });
    await t.manager.close();
    const restored = setup({ dir: t.dir });
    expect(await restored.manager.query("openspec.list", { sessionId })).toMatchObject({ ok: true, data: { boundChangeId: "alpha", changes: [] } });
    expect(await restored.manager.query("openspec.read", { sessionId, changeId: "beta", path: "proposal.md" })).toMatchObject({ ok: false, code: "openspec-forbidden" });
  });
});

/** Native servers remain alive after done; close is the only ownership release. */
class PersistentFakeDriver extends FakeDriver {
  closeCalls = 0;
  active = false;
  rejectDone = false;
  releaseClose!: () => void;
  private readonly drained = new Promise<void>((resolve) => { this.releaseClose = resolve; });

  override async startTask(input: DriverTaskInput, io: DriverHostIo) {
    const handle = await super.startTask(input, io);
    this.active = true;
    return {
      ...handle,
      done: this.rejectDone ? handle.done.then(() => { throw new Error("native outcome rejected"); }) : handle.done,
      close: async () => {
        this.closeCalls++;
        lastTurn(this).finish({ status: "interrupted-forced" });
        await this.drained;
        await handle.close();
        this.active = false;
      },
    };
  }
}

describe("native handle ownership (D-7, D-14)", () => {
  test("global Lead admission waits for the previous native handle drain", async () => {
    const driver = new PersistentFakeDriver();
    const t = setup({ driver, config: baseConfig({ executionBudget: { lead: 1, delegated: 1 } }) });
    const one = await t.create(), two = await t.create();
    await t.run({ type: "prompt.send", text: "one" }, one); await t.run({ type: "prompt.send", text: "two" }, two);
    await waitFor(() => driver.turns.length === 1, PROGRESS_TIMEOUT_MS, "one admitted");
    lastTurn(driver).finish(); await waitFor(() => driver.closeCalls === 1, PROGRESS_TIMEOUT_MS, "native draining");
    expect(driver.turns).toHaveLength(1);
    driver.releaseClose(); await waitFor(() => driver.turns.length === 2, PROGRESS_TIMEOUT_MS, "slot transferred");
    expect(lastTurn(driver).input.prompt).toBe("two");
    lastTurn(driver).finish(); await t.idle();
  });

  test("uncertain child ownership retains the per-session delegate reservation", async () => {
    const driver = new FakeDriver(); const start = driver.startTask.bind(driver);
    driver.startTask = async (input, io) => {
      const handle = await start(input, io);
      return input.memberId === "lead" ? handle : { ...handle, close: async () => { throw new Error("drain-unproven"); } };
    };
    const t = setup({ driver, config: baseConfig({ members: { lead: { runnerId: "claude", modelId: "opus" }, investigate: { runnerId: "claude", modelId: "fast" } }, maxConcurrentTasks: 1, executionBudget: { lead: 2, delegated: 4 } }) });
    const id = await t.create(); await t.run({ type: "prompt.send", text: "start" }, id);
    await waitFor(() => driver.turns.length === 1, PROGRESS_TIMEOUT_MS, "lead"); const lead = lastTurn(driver);
    const grant = t.credentials.lookup(JSON.parse(readFileSync(sessionPaths(t.paths, id).taskCredentialFile("lead"), "utf8")).token)!;
    const first = await t.manager.callTaskTool(grant, "deck_delegate", { agent: "investigate", task: "first" });
    await t.manager.callTaskTool(grant, "deck_delegate", { agent: "investigate", task: "second" });
    await waitFor(() => driver.turns.length === 2, PROGRESS_TIMEOUT_MS, "first child"); lastTurn(driver).finish();
    await waitFor(() => t.events(id).some(e => e.kind === "task.state" && e.data.taskId === (first as any).data.taskId && e.data.state === "ownership-unsettled"), PROGRESS_TIMEOUT_MS, "uncertain child");
    expect(driver.turns).toHaveLength(2);
    await t.run({ type: "session.stop" }, id); lead.finish();
    await waitFor(() => !t.manager.hasRunningWork(), PROGRESS_TIMEOUT_MS, "stop queues");
  });

  test("managed MCP leases stay held until native close has drained, including cancellation", async () => {
    const driver = new PersistentFakeDriver();
    let releases = 0;
    const t = setup({ driver, options: { childMcp: async (_runnerId, context) => {
      expect(context.projectRoot).toBe(t.project);
      expect(context.taskId).toBe("lead");
      return { runnerPackages: () => [], resolveServer: () => undefined, release: async () => { releases++; } };
    } } });
    const sessionId = await t.create();
    await t.run({ type: "prompt.send", text: "first" }, sessionId);
    await waitFor(() => driver.turns.length === 1, PROGRESS_TIMEOUT_MS, "native start");
    await t.run({ type: "task.cancel", taskId: "lead" }, sessionId);
    try {
      await waitFor(() => driver.closeCalls === 1, PROGRESS_TIMEOUT_MS, "native close");
      expect(releases).toBe(0);
    } finally { driver.releaseClose(); }
    await t.idle(); expect(releases).toBe(1);
  });

  test("a rejected native close keeps its managed MCP lease instead of claiming drain", async () => {
    const driver = new FakeDriver();
    const start = driver.startTask.bind(driver);
    driver.startTask = async (input, io) => ({ ...await start(input, io), close: async () => { throw new Error("drain unproven"); } });
    let releases = 0;
    const t = setup({ driver, options: { childMcp: async () => ({ runnerPackages: () => [], resolveServer: () => undefined, release: async () => { releases++; } }) } });
    const sessionId = await t.create(); await t.run({ type: "prompt.send", text: "first" }, sessionId);
    await waitFor(() => driver.turns.length === 1, PROGRESS_TIMEOUT_MS, "native start");
    lastTurn(driver).finish(); await t.idle();
    expect(releases).toBe(0);
    expect(t.events(sessionId).find((e) => e.kind === "turn.completed")?.data).toMatchObject({ status: "failed", error: "Unable to close the turn: drain unproven" });
    expect(t.events(sessionId).filter((e) => e.kind === "task.state").at(-1)?.data).toMatchObject({ state: "ownership-unsettled", reason: "native-close-failed" });
    expect(await t.run({ type: "prompt.send", text: "unsafe continuation" }, sessionId)).toMatchObject({ ok: true, data: { state: "queued" } });
    expect(await t.manager.query("sessions.prune", { keep: 0, maxAgeDays: 0 })).toMatchObject({ ok: true, data: { removed: [] } });
    await t.manager.close(); expect(releases).toBe(0);
    recoverAllSessions({ paths: t.paths, probe: createNodeProbe() });
    const reopened = setup({ dir: t.dir });
    expect(await reopened.run({ type: "prompt.send", text: "still unsafe after restart" }, sessionId)).toMatchObject({ ok: true, data: { state: "queued" } });
    expect((await reopened.manager.query("prompts.list", { sessionId }) as any).data.paused).toBe(true);
  });

  test("a delegated task whose native close rejects cannot be continued", async () => {
    const driver = new FakeDriver(), start = driver.startTask.bind(driver);
    driver.startTask = async (input, io) => {
      const handle = await start(input, io);
      return input.memberId === "architect" ? { ...handle, close: async () => { throw new Error("worker drain unproven"); } } : handle;
    };
    const t = setup({ driver, config: baseConfig({ members: { lead: { runnerId: "claude", modelId: "opus" }, architect: { runnerId: "claude", modelId: "opus" } } }) });
    const sessionId = await t.create(); await t.run({ type: "prompt.send", text: "delegate" }, sessionId);
    const grant = { sessionId, taskId: "lead", memberId: "lead", runnerId: "claude", allowedTools: ["deck_delegate"] };
    const delegated = await t.manager.callTaskTool(grant, "deck_delegate", { agent: "architect", task: "inspect" });
    if (!delegated.ok) throw new Error("expected delegation");
    const taskId = (delegated.data as { taskId: string }).taskId;
    await waitFor(() => driver.turns.length === 2, PROGRESS_TIMEOUT_MS, "delegated start");
    lastTurn(driver).finish();
    await waitFor(() => t.events(sessionId).some((e) => e.kind === "task.state" && e.source.taskId === taskId && e.data.state === "ownership-unsettled"), PROGRESS_TIMEOUT_MS, "unsettled task");
    expect(await t.manager.callTaskTool(grant, "deck_delegate", { agent: "architect", task: "unsafe continuation", continueTaskId: taskId })).toMatchObject({ ok: false, code: "ownership-unsettled" });
    expect(await t.run({ type: "session.stop" }, sessionId)).toMatchObject({ ok: true, data: { state: "stopping" } });
    await t.idle();
    expect(t.kinds(sessionId)).not.toContain("session.ended");
  });

  test.each(["interrupt", "cancel", "stop", "shutdown"])("%s aborts pending managed MCP readiness before native startup", async (action) => {
    let entered = false, aborted = false;
    const t = setup({ options: { childMcp: async (_runnerId, context) => {
      entered = true;
      await new Promise<void>((_resolve, reject) => context.signal.addEventListener("abort", () => { aborted = true; reject(new Error("readiness cancelled")); }, { once: true }));
      return { runnerPackages: () => [], resolveServer: () => undefined };
    } } });
    const sessionId = await t.create();
    await t.run({ type: "prompt.send", text: "first" }, sessionId);
    await waitFor(() => entered, PROGRESS_TIMEOUT_MS, "readiness start");
    if (action === "shutdown") await t.manager.close();
    else if (action === "stop") await t.run({ type: "session.stop" }, sessionId);
    else if (action === "cancel") await t.run({ type: "task.cancel", taskId: "lead" }, sessionId);
    else await t.run({ type: "turn.interrupt", taskId: "lead" }, sessionId);
    await t.idle();
    expect(aborted).toBe(true); expect(t.driver.turns).toHaveLength(0);
  });

  for (const outcome of [{ status: "completed" }, { status: "failed", error: "native failure" }, { status: "interrupted" }] satisfies TurnOutcome[]) {
    test(`drains and closes a persistent ${outcome.status} handle before terminal events and continuation`, async () => {
      const driver = new PersistentFakeDriver();
      cleanups.push(() => driver.releaseClose());
      const t = setup({ driver });
      const sessionId = await t.create();
      await t.run({ type: "prompt.send", text: "first" }, sessionId);
      lastTurn(driver).finish(outcome);
      try {
        await waitFor(() => driver.closeCalls === 1, PROGRESS_TIMEOUT_MS, "native handle close");
        expect(driver.active).toBe(true);
        expect(t.manager.hasRunningWork()).toBe(true);
        expect(t.kinds(sessionId)).not.toContain("turn.completed");
        expect(driver.turns).toHaveLength(1);
      } finally { driver.releaseClose(); }
      await t.idle();
      expect(driver.active).toBe(false);
      expect(lastTurn(driver).closed).toBe(true);
      expect(t.events(sessionId).filter((e) => e.kind === "turn.completed")).toHaveLength(1);
      expect(t.events(sessionId).find((e) => e.kind === "turn.completed")?.data.status).toBe(outcome.status);
    });
  }

  test("a rejected native outcome still closes its handle before reporting failure", async () => {
    const driver = new PersistentFakeDriver();
    driver.rejectDone = true;
    const t = setup({ driver });
    const sessionId = await t.create();
    await t.run({ type: "prompt.send", text: "first" }, sessionId);
    lastTurn(driver).finish();
    try { await waitFor(() => driver.closeCalls === 1, PROGRESS_TIMEOUT_MS, "rejected handle close"); }
    finally { driver.releaseClose(); }
    await t.idle();
    expect(driver.active).toBe(false);
    expect(t.events(sessionId).find((e) => e.kind === "turn.completed")?.data).toMatchObject({ status: "failed", error: "native outcome rejected" });
  });

  test("cancel and daemon shutdown share one pending close without losing ownership", async () => {
    const driver = new PersistentFakeDriver();
    const clock = new FakeClock();
    const t = setup({ driver, options: { clock } });
    const sessionId = await t.create();
    await t.run({ type: "prompt.send", text: "first" }, sessionId);
    await t.run({ type: "task.cancel", taskId: "lead" }, sessionId);
    let closing: Promise<void> | undefined;
    try {
      await waitFor(() => driver.closeCalls === 1, PROGRESS_TIMEOUT_MS, "cancelled handle close");
      closing = t.manager.close();
      clock.advance(5001);
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(t.manager.hasRunningWork()).toBe(true);
      expect(driver.closeCalls).toBe(1);
      expect(t.kinds(sessionId)).not.toContain("turn.completed");
    } finally { driver.releaseClose(); }
    await closing;
    expect(driver.active).toBe(false);
    const reopened = setup({ dir: t.dir });
    expect(reopened.events(sessionId).filter((e) => e.kind === "turn.completed")).toHaveLength(1);
  });

  test("shutdown closes an uncooperative native server after the grace period", async () => {
    const driver = new PersistentFakeDriver();
    const clock = new FakeClock();
    const t = setup({ driver, options: { clock } });
    const sessionId = await t.create();
    await t.run({ type: "prompt.send", text: "first" }, sessionId);
    lastTurn(driver).onInterrupt = undefined;
    const closing = t.manager.close();
    expect(t.manager.close()).toBe(closing);
    clock.advance(5001);
    try {
      await waitFor(() => driver.closeCalls === 1, PROGRESS_TIMEOUT_MS, "shutdown handle close");
      expect(driver.active).toBe(true);
      expect(t.manager.hasRunningWork()).toBe(true);
      expect(t.kinds(sessionId)).not.toContain("turn.completed");
    } finally { driver.releaseClose(); }
    await closing;
    expect(driver.active).toBe(false);
    const reopened = setup({ dir: t.dir });
    expect(reopened.events(sessionId).find((e) => e.kind === "turn.completed")?.data.status).toBe("interrupted");
  });

  test("shutdown keeps ownership of a handle whose startup completes after the grace period", async () => {
    const driver = new PersistentFakeDriver();
    const startTask = driver.startTask.bind(driver);
    let releaseStart!: () => void;
    const started = new Promise<void>((resolve) => { releaseStart = resolve; });
    driver.startTask = async (input, io) => { await started; return startTask(input, io); };
    const clock = new FakeClock();
    const t = setup({ driver, options: { clock } });
    const sessionId = await t.create();
    await t.run({ type: "prompt.send", text: "first" }, sessionId);
    const closing = t.manager.close();
    clock.advance(5001);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(t.manager.hasRunningWork()).toBe(true);
    releaseStart();
    try {
      await waitFor(() => driver.closeCalls === 1, PROGRESS_TIMEOUT_MS, "late startup handle close");
      expect(t.kinds(sessionId)).not.toContain("turn.completed");
    } finally { driver.releaseClose(); }
    await closing;
    expect(driver.active).toBe(false);
    expect(driver.closeCalls).toBe(1);
  });
});

describe("session.create (XR-2.4, XR-3.2, XR-12.1)", () => {
  test("concurrent creates coordinate one commandId and reject a changed payload", async () => {
    const driver = new FakeDriver(); let release!: () => void;
    const ready = new Promise<void>((resolve) => { release = resolve; });
    driver.probe = async () => { await ready; return driver.probeResult; };
    const t = setup({ driver }); const id = "00000000-0000-4000-8000-000000001001";
    const first = t.runWithId(id, { type: "session.create", projectRoot: t.project });
    const duplicate = t.runWithId(id, { type: "session.create", projectRoot: t.project });
    const mismatch = t.runWithId(id, { type: "session.create", projectRoot: t.project, changeId: "different" });
    release();
    const result = await first;
    expect(await duplicate).toMatchObject({ ...result, duplicate: true });
    expect(await mismatch).toMatchObject({ ok: false, code: "command-id-reused" });
    expect(readdirSync(t.paths.sessionsDir)).toHaveLength(1);
  });

  test("shutdown during a create probe prevents late durable session creation", async () => {
    const driver = new FakeDriver(); let release!: () => void;
    const ready = new Promise<void>((resolve) => { release = resolve; });
    driver.probe = async () => { await ready; return driver.probeResult; };
    const t = setup({ driver });
    const create = t.run({ type: "session.create", projectRoot: t.project });
    await Promise.resolve(); await t.manager.close(); release();
    expect(await create).toMatchObject({ ok: false, code: "daemon-stopping" });
    expect(readdirSync(t.paths.sessionsDir)).toHaveLength(0);
  });
  test("refuses when cross-runner is not configured, disabled, or has no lead", async () => {
    expect(await setup({ config: undefined }).run({ type: "session.create", projectRoot: "/p" })).toMatchObject({ ok: false, code: "cross-runner-not-configured" });
    expect(await setup({ config: baseConfig({ enabled: false }) }).run({ type: "session.create", projectRoot: "/p" })).toMatchObject({ ok: false, code: "cross-runner-not-configured" });
    expect(await setup({ config: baseConfig({ members: {} }) }).run({ type: "session.create", projectRoot: "/p" })).toMatchObject({ ok: false, code: "lead-not-assigned" });
  });

  test("a lead whose runner has no driver, or whose driver is blocked, is refused with the reason code", async () => {
    const noDriver = setup({ driver: null });
    expect(await noDriver.run({ type: "session.create", projectRoot: noDriver.project })).toMatchObject({ ok: false, code: "runner-driver-unavailable" });
    const driver = new FakeDriver();
    driver.probeResult = { status: "blocked", reasonCode: "claude-session-tos-unacknowledged", capabilities: [] };
    const blocked = setup({ driver });
    expect(await blocked.run({ type: "session.create", projectRoot: blocked.project })).toMatchObject({ ok: false, code: "claude-session-tos-unacknowledged" });
    expect(readdirSync(blocked.paths.sessionsDir)).toEqual([]);
  });

  test("a degraded driver still creates the session and says so", async () => {
    const driver = new FakeDriver();
    driver.probeResult = { status: "degraded", reasonCode: "claude-version-untested", version: "9.9.9", capabilities: [] };
    const t = setup({ driver });
    const sessionId = await t.create();
    expect(t.events(sessionId).some((e) => e.kind === "diagnostic" && e.data.code === "claude-version-untested")).toBe(true);
  });

  test("rejects a missing or relative project root and one that contains the state directory", async () => {
    const t = setup();
    expect(await t.run({ type: "session.create", projectRoot: "relative/dir" })).toMatchObject({ ok: false, code: "invalid-project-root" });
    expect(await t.run({ type: "session.create", projectRoot: join(t.dir, "nope") })).toMatchObject({ ok: false, code: "invalid-project-root" });
    expect(await t.run({ type: "session.create", projectRoot: t.dir })).toMatchObject({ ok: false, code: "invalid-project-root" });
  });

  test("creates private session state with the members snapshot, never inside the project", async () => {
    const t = setup();
    const r = await t.run({ type: "session.create", projectRoot: t.project, changeId: "my-change" });
    const sessionId = (r as { data: { sessionId: string } }).data.sessionId;
    expect(r).toMatchObject({ ok: true, data: { sessionId, lastSeq: 2 } });
    const sp = sessionPaths(t.paths, sessionId);
    expect(lstatSync(sp.dir).mode & 0o777).toBe(0o700);
    expect(lstatSync(sp.sessionFile).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(sp.sessionFile, "utf8"))).toMatchObject({ sessionId, projectRoot: t.project, changeId: "my-change", members: { lead: { runnerId: "claude", modelId: "opus", thinking: "high" } } });
    expect(readdirSync(t.project)).toEqual([]);
    const [created, bound] = t.events(sessionId);
    expect(created).toMatchObject({ kind: "session.created", data: { projectRoot: t.project, members: { lead: { runnerId: "claude", modelId: "opus" } } } });
    expect(bound).toMatchObject({ kind: "session.bound", data: { changeId: "my-change" } });
  });

  test("an unsafe change id is refused", async () => {
    const t = setup();
    expect(await t.run({ type: "session.create", projectRoot: t.project, changeId: "../evil" })).toMatchObject({ ok: false, code: "invalid-change-id" });
  });
});

describe("single-member Lead lifecycle (task 1.16)", () => {
  test("starting another session's Lead preserves the first session's credential", async () => {
    const t = setup();
    const a = await t.create(), b = await t.create();
    await t.run({ type: "prompt.send", text: "first" }, a);
    const first = lastTurn(t.driver);
    const { token } = JSON.parse(readFileSync(first.input.credentialFile, "utf8"));
    await t.run({ type: "prompt.send", text: "second" }, b);
    expect(t.credentials.lookup(token)).toMatchObject({ sessionId: a, taskId: "lead" });
    expect(existsSync(first.input.credentialFile)).toBe(true);
  });

  test("finishing one session preserves another session's Lead credentials and pending approvals", async () => {
    const t = setup();
    const a = await t.create(), b = await t.create();
    await t.run({ type: "prompt.send", text: "first" }, a);
    const first = lastTurn(t.driver);
    await t.run({ type: "prompt.send", text: "second" }, b);
    const second = lastTurn(t.driver);
    const { token } = JSON.parse(readFileSync(second.input.credentialFile, "utf8"));
    const approval = t.broker.request({ sessionId: b, taskId: "lead", tool: "Bash" });
    first.finish();
    await waitFor(() => t.events(a).some((e) => e.kind === "turn.completed"), 5000, "first turn complete");
    expect(t.credentials.lookup(token)).toMatchObject({ sessionId: b });
    expect(t.broker.pending()).toContainEqual({ approvalId: approval.approvalId, sessionId: b, taskId: "lead" });
    second.finish();
    await t.idle();
    expect((await approval.resolution).decision).toBe("deny");
    expect(t.credentials.lookup(token)).toBeUndefined();
  });

  test("an approval response in another session cannot resolve the owner's request", async () => {
    const t = setup();
    const a = await t.create(), b = await t.create();
    const approval = t.broker.request({ sessionId: a, taskId: "lead", tool: "Bash" });
    const before = t.events(a).length;
    expect(await t.run({ type: "approval.respond", approvalId: approval.approvalId, decision: "allow-once" }, b)).toMatchObject({ ok: false, code: "unknown-approval" });
    expect(t.broker.pending()).toContainEqual({ approvalId: approval.approvalId, sessionId: a, taskId: "lead" });
    expect(t.events(a)).toHaveLength(before);
    expect(await t.run({ type: "approval.respond", approvalId: approval.approvalId, decision: "deny" }, a)).toMatchObject({ ok: true });
    expect((await approval.resolution).decision).toBe("deny");
  });

  test("prompt.send runs one turn end to end and records the full event sequence", async () => {
    const t = setup();
    t.driver.autoComplete = true;
    const sessionId = await t.create();
    const seenAtStart: SessionEvent[] = [];
    t.driver.onStart = () => { seenAtStart.push(...t.events(sessionId)); };
    const r = await t.run({ type: "prompt.send", text: "hello" }, sessionId);
    expect(r).toMatchObject({ ok: true, data: { promptId: expect.any(String), state: "queued" } });
    await t.idle();

    const ev = t.events(sessionId);
    const queued = ev.find(e => e.kind === "prompt.queued")!;
    const dispatched = ev.find(e => e.kind === "prompt.dispatched")!;
    const user = ev.find(e => e.kind === "message.completed" && e.data.role === "user")!;
    const created = ev.find(e => e.kind === "task.created")!;
    expect(user.data).toMatchObject({ text: "hello", promptId: queued.data.promptId });
    expect(dispatched.seq).toBeGreaterThan(created.seq);
    expect(user.seq).toBeGreaterThan(dispatched.seq);
    expect(ev.find(e => e.kind === "turn.started")!.seq).toBeGreaterThan(user.seq);
    expect(created).toMatchObject({ source: { taskId: "lead", memberId: "lead", runnerId: "claude" }, data: { runnerId: "claude", modelId: "opus", thinking: "high" } });
    expect(ev.find(e => e.kind === "message.completed" && e.data.role === "assistant")?.data.text).toBe("reply to: hello");
    expect(ev.find(e => e.kind === "turn.completed")?.data.status).toBe("completed");
    expect(ev.find(e => e.kind === "task.result")?.data.summary).toBe("reply to: hello");
    expect(ev.at(-1)).toMatchObject({ kind: "prompt.state", data: { state: "completed" } });
    expect(ev.map((e, i) => e.seq === i + 1).every(Boolean)).toBe(true);

    // XR-4.5: the native session id was persisted before the driver started
    const nativeId = (created.data as { nativeSessionId?: string }).nativeSessionId;
    expect(nativeId).toMatch(/^[0-9a-f-]{36}$/);
    expect(seenAtStart.some((e) => e.kind === "task.created" && e.data.nativeSessionId === nativeId)).toBe(true);
    expect(lastTurn(t.driver).input.nativeSessionId).toBe(nativeId);
    expect(lastTurn(t.driver).input.resume).toBeUndefined();
  });

  test("the driver gets the computed child set, a private credential and the relay policy; the credential dies with the turn", async () => {
    const t = setup();
    const sessionId = await t.create();
    await t.run({ type: "prompt.send", text: "go" }, sessionId);
    const turn = lastTurn(t.driver);
    const input = turn.input;
    expect(input).toMatchObject({ taskId: "lead", memberId: "lead", cwd: t.project, approvals: "relay", disableNativeDelegation: true, assignment: { runnerId: "claude", modelId: "opus", thinking: "high" } });
    expect(input.mcp.servers).toEqual(["deck"]);
    expect(input.mcp.sessionTools).toEqual(["deck_delegate", "deck_task_wait", "deck_task_result", "deck_task_cancel", "deck_memory_recall", "deck_memory_propose", "deck_approve", "deck_status"]);
    const spec = input.mcpServerSpecs.deck!;
    if (spec.transport === "http") throw new Error("Deck session bridge must use stdio");
    expect(spec.command).toBe("/bin/deck");
    expect(spec.args).toEqual(["internal", "session-mcp"]);
    expect(spec.env.DECK_SESSION_CREDENTIAL_FILE).toBe(input.credentialFile);
    expect(input.credentialFile).toBe(sessionPaths(t.paths, sessionId).taskCredentialFile("lead"));
    expect(lstatSync(input.credentialFile).mode & 0o777).toBe(0o600);
    const { token } = JSON.parse(readFileSync(input.credentialFile, "utf8")) as { token: string };
    expect(t.credentials.lookup(token)).toMatchObject({ sessionId, taskId: "lead", memberId: "lead", allowedTools: input.mcp.sessionTools });
    expect(JSON.stringify(input)).not.toContain(token);
    turn.init(); turn.finish();
    await t.idle();
    expect(t.credentials.lookup(token)).toBeUndefined();
    expect(existsSync(input.credentialFile)).toBe(false);
  });

  test("native delegation is disabled for the lead and approvals follow the per-runner config", async () => {
    const t = setup({ config: baseConfig({ approvals: { claude: "runner-default" } }) });
    const sessionId = await t.create();
    await t.run({ type: "prompt.send", text: "go" }, sessionId);
    expect(lastTurn(t.driver).input.approvals).toBe("runner-default");
    lastTurn(t.driver).finish();
    await t.idle();
  });

  test("a second prompt continues the same task (attempt 2) and resumes the confirmed native session", async () => {
    const t = setup();
    t.driver.autoComplete = true;
    const sessionId = await t.create();
    await t.run({ type: "prompt.send", text: "one" }, sessionId);
    await t.idle();
    const nativeId = lastTurn(t.driver).input.nativeSessionId!;
    const r2 = await t.run({ type: "prompt.send", text: "two" }, sessionId);
    expect(r2).toMatchObject({ ok: true, data: { promptId: expect.any(String), state: "queued" } });
    await t.idle();
    expect(t.kinds(sessionId).filter((k) => k === "task.continued")).toHaveLength(1);
    expect(lastTurn(t.driver).input.resume).toEqual({ nativeSessionId: nativeId });
    expect(lastTurn(t.driver).input.nativeSessionId).toBeUndefined();
    expect(lastTurn(t.driver).input.prompt).toBe("two");
  });

  test("when the first turn never reached the native CLI (no init), the next turn starts fresh with the SAME id instead of resuming", async () => {
    const t = setup();
    const sessionId = await t.create();
    await t.run({ type: "prompt.send", text: "one" }, sessionId);
    const id = lastTurn(t.driver).input.nativeSessionId!;
    lastTurn(t.driver).finish({ status: "failed", error: "spawn failed" }); // no turn.started was emitted
    await t.idle();
    await t.run({ type: "prompt.resume" }, sessionId);
    await t.run({ type: "prompt.send", text: "two" }, sessionId);
    await waitFor(() => t.driver.turns.length === 2, PROGRESS_TIMEOUT_MS, "second native admission");
    expect(lastTurn(t.driver).input.resume).toBeUndefined();
    expect(lastTurn(t.driver).input.nativeSessionId).toBe(id);
    lastTurn(t.driver).finish();
    await t.idle();
  });

  test("a second prompt while a turn runs is durably queued without concurrent native work", async () => {
    const t = setup(); const sessionId = await t.create();
    await t.run({ type: "prompt.send", text: "one" }, sessionId);
    await waitFor(() => t.driver.turns.length === 1, PROGRESS_TIMEOUT_MS, "first native turn");
    expect(await t.run({ type: "prompt.send", text: "two" }, sessionId)).toMatchObject({ ok: true, data: { state: "queued" } });
    expect(t.driver.turns).toHaveLength(1);
    lastTurn(t.driver).finish(); await waitFor(() => t.driver.turns.length === 2, PROGRESS_TIMEOUT_MS, "second native turn");
    expect(lastTurn(t.driver).input.prompt).toBe("two"); lastTurn(t.driver).finish(); await t.idle();
  });

  test("a failed turn is recorded as failed with a bounded, redacted reason, and the session returns to idle", async () => {
    const t = setup();
    const sessionId = await t.create();
    await t.run({ type: "prompt.send", text: "one" }, sessionId);
    lastTurn(t.driver).finish({ status: "failed", error: "boom Bearer abcdefghijklmnopqrstuv" });
    await t.idle();
    const ev = t.events(sessionId);
    const completed = ev.find((e) => e.kind === "turn.completed")!;
    expect(completed.data).toMatchObject({ status: "failed" });
    expect(JSON.stringify(completed.data)).not.toContain("abcdefghijklmnopqrstuv");
    expect(ev.find((e) => e.kind === "task.state" && e.data.state === "failed")).toBeDefined();
    expect([...ev].reverse().find(e => e.kind === "session.state")).toMatchObject({ data: { state: "idle" } });
    // An explicit resume clears the failure barrier before a new instruction.
    await t.run({ type: "prompt.resume" }, sessionId);
    expect(await t.run({ type: "prompt.send", text: "again" }, sessionId)).toMatchObject({ ok: true, data: { promptId: expect.any(String), state: "queued" } });
    lastTurn(t.driver).finish();
    await t.idle();
  });

  test("a driver that cannot start is a failed turn, not an exception", async () => {
    const t = setup();
    t.driver.startError = new Error("no such binary");
    const sessionId = await t.create();
    expect(await t.run({ type: "prompt.send", text: "one" }, sessionId)).toMatchObject({ ok: true });
    await t.idle();
    const ev = t.events(sessionId);
    expect(ev.find((e) => e.kind === "turn.completed")?.data).toMatchObject({ status: "failed" });
    expect(t.manager.hasRunningWork()).toBe(false);
  });

  test("late events from the driver carry the raw payload, bounded and redacted", async () => {
    const t = setup();
    const sessionId = await t.create();
    await t.run({ type: "prompt.send", text: "one" }, sessionId);
    lastTurn(t.driver).emit("message.completed", { text: "x" }, { note: "Authorization: Bearer abcdefghijklmnopqrstuv" });
    lastTurn(t.driver).emit("not.a.kind", { a: 1 }, { weird: true });
    lastTurn(t.driver).finish();
    await t.idle();
    const ev = t.events(sessionId);
    const withRaw = ev.find((e) => e.raw && JSON.stringify(e.raw).includes("Authorization"))!;
    expect(withRaw.raw).toMatchObject({ runnerId: "claude", protocol: "fake-protocol", truncated: false });
    expect(JSON.stringify(withRaw.raw)).not.toContain("abcdefghijklmnopqrstuv");
    expect(ev.find((e) => e.kind === "runner.unmapped")?.data).toMatchObject({ type: "not.a.kind" });
  });
});

describe("host-owned events cannot be forged by a driver", () => {
  test("ledger-affecting kinds emitted by a driver become runner.unmapped and change nothing", async () => {
    const t = setup();
    const sessionId = await t.create();
    await t.run({ type: "prompt.send", text: "one" }, sessionId);
    const turn = lastTurn(t.driver);
    turn.emit("task.state", { taskId: "lead", state: "completed" });
    turn.emit("session.ended", {});
    turn.emit("command.accepted", { commandId: "x", type: "prompt.send", outcome: { ok: true } });
    const ev = t.events(sessionId);
    expect(ev.filter((e) => e.kind === "runner.unmapped").map((e) => e.data.type)).toEqual(["task.state", "session.ended", "command.accepted"]);
    expect(ev.filter((e) => e.kind === "runner.unmapped")[0]!.data.reason).toBe("kind-reserved-for-host");
    expect(t.manager.taskStatus({ sessionId, taskId: "lead", memberId: "lead", allowedTools: [] })).toMatchObject({ state: "running", sessionState: "running" });
    turn.finish();
    await t.idle();
  });
});

describe("interrupt, cancel and approvals (XR-5.1, XR-5.4)", () => {
  test("turn.interrupt reaches the driver and the cooperative result is recorded as interrupted", async () => {
    const t = setup();
    const sessionId = await t.create();
    await t.run({ type: "prompt.send", text: "long" }, sessionId);
    expect(await t.run({ type: "turn.interrupt", taskId: "lead" }, sessionId)).toMatchObject({ ok: true });
    await t.idle();
    expect(lastTurn(t.driver).interrupts).toHaveLength(1);
    const ev = t.events(sessionId);
    expect(ev.find((e) => e.kind === "turn.completed")?.data).toMatchObject({ status: "interrupted" });
    expect(ev.find((e) => e.kind === "task.state" && e.data.state === "interrupted")).toBeDefined();
  });

  test("an escalated interrupt is recorded as interrupted-forced and the task as interrupted", async () => {
    const t = setup();
    const sessionId = await t.create();
    await t.run({ type: "prompt.send", text: "long" }, sessionId);
    lastTurn(t.driver).onInterrupt = { status: "interrupted-forced" };
    await t.run({ type: "turn.interrupt", taskId: "lead" }, sessionId);
    await t.idle();
    const ev = t.events(sessionId);
    expect(ev.find((e) => e.kind === "turn.completed")?.data).toMatchObject({ status: "interrupted-forced" });
    expect(ev.find((e) => e.kind === "task.state" && e.data.state === "interrupted")?.data).toMatchObject({ reason: "interrupted-forced" });
  });

  test("interrupt validation: unknown task, nothing running", async () => {
    const t = setup();
    const sessionId = await t.create();
    expect(await t.run({ type: "turn.interrupt", taskId: "ghost" }, sessionId)).toMatchObject({ ok: false, code: "task-unknown" });
    expect(await t.run({ type: "turn.interrupt", taskId: "lead" }, sessionId)).toMatchObject({ ok: false, code: "task-unknown" });
    t.driver.autoComplete = true;
    await t.run({ type: "prompt.send", text: "x" }, sessionId);
    await t.idle();
    expect(await t.run({ type: "turn.interrupt", taskId: "lead" }, sessionId)).toMatchObject({ ok: false, code: "turn-not-running" });
  });

  test("task.cancel interrupts the turn and records the task as cancelled", async () => {
    const t = setup();
    const sessionId = await t.create();
    await t.run({ type: "prompt.send", text: "long" }, sessionId);
    expect(await t.run({ type: "task.cancel", taskId: "lead" }, sessionId)).toMatchObject({ ok: true });
    await t.idle();
    expect(t.events(sessionId).find((e) => e.kind === "task.state" && e.data.state === "cancelled")).toBeDefined();
  });

  test("approval.respond resolves the broker's pending approval for this session; allow and allow-once are the same", async () => {
    const t = setup();
    const sessionId = await t.create();
    await t.run({ type: "prompt.send", text: "go" }, sessionId);
    const a = t.broker.request({ sessionId, taskId: "lead", tool: "Bash", input: { command: "ls" } });
    expect(t.events(sessionId).some((e) => e.kind === "approval.requested")).toBe(true);
    expect(await t.run({ type: "approval.respond", approvalId: a.approvalId, decision: "allow" }, sessionId)).toMatchObject({ ok: true });
    expect(await a.resolution).toMatchObject({ decision: "allow-once", by: "c-1" });
    expect(await t.run({ type: "approval.respond", approvalId: a.approvalId, decision: "deny" }, sessionId)).toMatchObject({ ok: false, code: "already-resolved" });
    const b = t.broker.request({ sessionId, taskId: "lead", tool: "Bash", input: {} });
    expect(await t.run({ type: "approval.respond", approvalId: b.approvalId, decision: "allow-once" }, sessionId)).toMatchObject({ ok: true });
    expect((await b.resolution).decision).toBe("allow-once");
    lastTurn(t.driver).finish();
    await t.idle();
  });

  test("an approval of ANOTHER session cannot be answered through this one", async () => {
    const t = setup();
    const s1 = await t.create();
    const s2 = await t.create();
    const a = t.broker.request({ sessionId: s2, taskId: "lead", tool: "Bash" });
    expect(await t.run({ type: "approval.respond", approvalId: a.approvalId, decision: "allow" }, s1)).toMatchObject({ ok: false, code: "unknown-approval" });
    t.broker.dispose();
  });

  test("pending approvals are denied when the turn ends", async () => {
    const t = setup();
    const sessionId = await t.create();
    await t.run({ type: "prompt.send", text: "go" }, sessionId);
    const a = t.broker.request({ sessionId, taskId: "lead", tool: "Bash" });
    lastTurn(t.driver).finish({ status: "failed", error: "x" });
    expect(await a.resolution).toMatchObject({ decision: "deny", by: "task-ended" });
  });
});

describe("bindChange and stop", () => {
  test("bindChange is immutable once set and idempotent for the same id", async () => {
    const t = setup();
    const sessionId = await t.create();
    expect(await t.run({ type: "session.bindChange", changeId: "c-one" }, sessionId)).toMatchObject({ ok: true });
    expect(await t.run({ type: "session.bindChange", changeId: "c-one" }, sessionId)).toMatchObject({ ok: true });
    expect(await t.run({ type: "session.bindChange", changeId: "c-two" }, sessionId)).toMatchObject({ ok: false, code: "change-already-bound" });
    expect(t.kinds(sessionId).filter((k) => k === "session.bound")).toHaveLength(1);
  });

  test("session.stop on an idle session ends it; later prompts are refused", async () => {
    const t = setup();
    const sessionId = await t.create();
    expect(await t.run({ type: "session.stop" }, sessionId)).toMatchObject({ ok: true });
    expect(t.events(sessionId).at(-1)).toMatchObject({ kind: "session.ended" });
    expect(await t.run({ type: "prompt.send", text: "x" }, sessionId)).toMatchObject({ ok: false, code: "session-ended" });
  });

  test("session.stop during a turn interrupts it first and ends the session when it finishes", async () => {
    const t = setup();
    const sessionId = await t.create();
    await t.run({ type: "prompt.send", text: "long" }, sessionId);
    expect(await t.run({ type: "session.stop" }, sessionId)).toMatchObject({ ok: true, data: { state: "stopping" } });
    expect(await t.run({ type: "prompt.send", text: "y" }, sessionId)).toMatchObject({ ok: false, code: "session-stopping" });
    await t.idle();
    await waitFor(() => t.events(sessionId).at(-1)?.kind === "session.ended", 3000, "session.ended");
    const kinds = t.kinds(sessionId);
    expect(kinds.indexOf("turn.completed")).toBeLessThan(kinds.indexOf("session.ended"));
  });

  test("unknown sessions and missing session ids are explicit errors", async () => {
    const t = setup();
    expect(await t.run({ type: "prompt.send", text: "x" }, "no-such")).toMatchObject({ ok: false, code: "unknown-session" });
    expect(await t.run({ type: "prompt.send", text: "x" })).toMatchObject({ ok: false, code: "session-required" });
  });
});

describe("durable idempotency across a daemon restart (XR-1.5, Lead decision 3)", () => {
  const C_CREATE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const C_PROMPT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const C_STOP = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

  test("a duplicate prompt.send after restart returns the original acceptance and starts no second turn", async () => {
    const dir = tempDir();
    const a = setup({ dir });
    a.driver.autoComplete = true;
    const created = await a.runWithId(C_CREATE, { type: "session.create", projectRoot: a.project });
    const sessionId = (created as { data: { sessionId: string } }).data.sessionId;
    const first = await a.runWithId(C_PROMPT, { type: "prompt.send", text: "hello" }, sessionId);
    expect(first).toMatchObject({ ok: true, data: { promptId: expect.any(String), state: "queued" } });
    await a.idle();
    expect(a.driver.turns).toHaveLength(1);
    await a.manager.close();

    // "restart": a brand new manager (empty in-memory caches) over the same state directory
    const b = setup({ dir });
    b.driver.autoComplete = true;
    const again = await b.runWithId(C_PROMPT, { type: "prompt.send", text: "hello" }, sessionId);
    expect(again).toMatchObject({ ok: true, duplicate: true, data: { promptId: expect.any(String), state: "queued" } });
    expect(b.driver.turns).toHaveLength(0);
    expect(b.kinds(sessionId).filter((k) => k === "task.created" || k === "task.continued")).toHaveLength(1);

    // a NEW commandId is a genuinely new command
    expect(await b.run({ type: "prompt.send", text: "next" }, sessionId)).toMatchObject({ ok: true, data: { promptId: expect.any(String), state: "queued" } });
    await b.idle();
    expect(b.driver.turns).toHaveLength(1);
  });

  test("a duplicate session.create after restart returns the same session and creates no second one", async () => {
    const dir = tempDir();
    const a = setup({ dir });
    const created = await a.runWithId(C_CREATE, { type: "session.create", projectRoot: a.project });
    const sessionId = (created as { data: { sessionId: string } }).data.sessionId;
    await a.manager.close();
    const b = setup({ dir });
    const again = await b.runWithId(C_CREATE, { type: "session.create", projectRoot: b.project });
    expect(again).toMatchObject({ ok: true, duplicate: true, data: { sessionId } });
    expect(readdirSync(b.paths.sessionsDir)).toEqual([sessionId]);
  });

  test("a duplicate session.stop after restart is acknowledged without a second terminal event", async () => {
    const dir = tempDir();
    const a = setup({ dir });
    const sessionId = await a.create();
    await a.runWithId(C_STOP, { type: "session.stop" }, sessionId);
    const endedBefore = a.kinds(sessionId).filter((k) => k === "session.ended").length;
    await a.manager.close();
    const b = setup({ dir });
    expect(await b.runWithId(C_STOP, { type: "session.stop" }, sessionId)).toMatchObject({ ok: true, duplicate: true });
    expect(b.kinds(sessionId).filter((k) => k === "session.ended")).toHaveLength(endedBefore);
  });

  test("refusals are not remembered: the same commandId can succeed once the cause is gone", async () => {
    const t = setup();
    const sessionId = await t.create();
    await t.run({ type: "prompt.send", text: "one" }, sessionId);
    expect(await t.runWithId(C_PROMPT, { type: "prompt.send", text: "x".repeat(262145) }, sessionId)).toMatchObject({ ok: false, code: "prompt-too-large" });
    lastTurn(t.driver).finish();
    await t.idle();
    expect(await t.runWithId(C_PROMPT, { type: "prompt.send", text: "two" }, sessionId)).toMatchObject({ ok: true });
    lastTurn(t.driver).finish();
    await t.idle();
  });
});

describe("restart and recovery interplay (XR-3.7)", () => {
  test("a turn that was running when the daemon died is unsettled (no lease): prompts are refused until it is", async () => {
    const dir = tempDir();
    const a = setup({ dir });
    const sessionId = await a.create();
    await a.run({ type: "prompt.send", text: "long" }, sessionId);
    // crash: nothing is closed; startup recovery runs over the files
    const report = recoverAllSessions({ paths: a.paths, probe: createNodeProbe() });
    expect(report.sessions[0]!.unsettled).toEqual([{ taskId: "lead", reason: "lease-missing" }]);
    const b = setup({ dir });
    expect(await b.run({ type: "prompt.send", text: "again" }, sessionId)).toMatchObject({ ok: true, data: { state: "queued" } });
    expect((await b.manager.query("prompts.list", { sessionId }) as any).data.paused).toBe(true);
    lastTurn(a.driver).finish();
  });

  test("an interrupted (settled) lead task can be continued after recovery", async () => {
    const dir = tempDir();
    const a = setup({ dir });
    const sessionId = await a.create();
    await a.run({ type: "prompt.send", text: "long" }, sessionId);
    // simulate the settled outcome recovery would write for a task with a proven-gone process
    a.manager.openLog(sessionId)!.append({ kind: "task.state", source: { taskId: "lead" }, data: { taskId: "lead", state: "interrupted", reason: "daemon-restart" } });
    lastTurn(a.driver).finish();
    await a.idle();
    await a.run({ type: "prompt.resume" }, sessionId);
    const r = await a.run({ type: "prompt.send", text: "again" }, sessionId);
    expect(r).toMatchObject({ ok: true, data: { promptId: expect.any(String), state: "queued" } });
    lastTurn(a.driver).finish();
    await a.idle();
  });

  test("close() ends a running turn as interrupted (daemon-stopped), settles the log and keeps the files for restart", async () => {
    const t = setup();
    const sessionId = await t.create();
    await t.run({ type: "prompt.send", text: "long" }, sessionId);
    lastTurn(t.driver).onInterrupt = undefined;
    const closing = t.manager.close();
    lastTurn(t.driver).finish({ status: "failed", error: "terminated by shutdown" });
    await closing;
    const sp = sessionPaths(t.paths, sessionId);
    expect(existsSync(sp.ledgerSnapshotFile)).toBe(true);
    const b = setup({ dir: t.dir });
    const ev = b.events(sessionId);
    expect(ev.find((e) => e.kind === "turn.completed")?.data).toMatchObject({ status: "interrupted" });
    expect(ev.find((e) => e.kind === "task.state" && e.data.state === "interrupted")?.data).toMatchObject({ reason: "daemon-stopped" });
  });
});

describe("service surface: openLog, taskStatus, queries", () => {
  test("openLog lazily loads sessions from disk and returns undefined for unknown or unsafe ids", async () => {
    const dir = tempDir();
    const a = setup({ dir });
    const sessionId = await a.create();
    await a.manager.close();
    const b = setup({ dir });
    expect(b.manager.openLog(sessionId)?.lastSeq).toBeGreaterThan(0);
    expect(b.manager.openLog("nope")).toBeUndefined();
    expect(b.manager.openLog("../escape")).toBeUndefined();
  });

  test("taskStatus describes the calling task from the ledger", async () => {
    const t = setup();
    const sessionId = await t.create({ changeId: "c1" });
    await t.run({ type: "prompt.send", text: "go" }, sessionId);
    const status = t.manager.taskStatus({ sessionId, taskId: "lead", memberId: "lead", allowedTools: [] }) as Record<string, unknown>;
    expect(status).toMatchObject({ sessionId, taskId: "lead", memberId: "lead", state: "running", attempt: 1, runnerId: "claude", modelId: "opus", changeId: "c1", sessionState: "running" });
    lastTurn(t.driver).finish();
    await t.idle();
  });

  test("sessions.list summarises sessions, newest first", async () => {
    const t = setup();
    const s1 = await t.create();
    const s2 = await t.create({ changeId: "c2" });
    const r = await t.manager.query("sessions.list", undefined);
    expect(r.ok).toBe(true);
    const list = (r as { data: { sessions: Array<Record<string, unknown>> } }).data.sessions;
    expect(list.map((s) => s.sessionId).sort()).toEqual([s1, s2].sort());
    expect(list.find((s) => s.sessionId === s2)).toMatchObject({ changeId: "c2", state: "created", projectRoot: t.project, lead: { runnerId: "claude", modelId: "opus" }, running: false });
  });

  test("drivers.status reports each driver probe and the configured members", async () => {
    const t = setup();
    const r = await t.manager.query("drivers.status", undefined);
    expect(r).toMatchObject({ ok: true, data: { drivers: [{ runnerId: "claude", protocol: "fake-protocol", probe: { status: "ready" } }], members: { lead: { runnerId: "claude", modelId: "opus", blocked: null } }, enabled: true } });
    t.driver.probeResult = { status: "blocked", reasonCode: "claude-session-tos-unacknowledged", capabilities: [] };
    expect(await t.manager.query("drivers.status", undefined)).toMatchObject({ data: { members: { lead: { blocked: "claude-session-tos-unacknowledged" } } } });
  });

  test("unknown queries are explicit errors", async () => {
    expect(await setup().manager.query("nope", undefined)).toMatchObject({ ok: false, code: "query-unknown" });
  });
});

describe("sessions.prune retention (design 6.2)", () => {
  const DAY = 86_400_000;
  const prune = async (t: ReturnType<typeof setup>, args: Record<string, unknown> = {}) =>
    (await t.manager.query("sessions.prune", args) as { data: { removed: string[]; kept: number; dryRun: boolean } }).data;

  test("removes sessions older than the retention age, keeps recent ones, and dry-run touches nothing", async () => {
    const clock = new FakeClock();
    const t = setup({ options: { clock } });
    const old = await t.create();
    clock.advance(40 * DAY);
    const recent = await t.create();
    const dry = await prune(t, { dryRun: true });
    expect(dry).toEqual({ removed: [old], kept: 1, dryRun: true });
    expect(existsSync(sessionPaths(t.paths, old).dir)).toBe(true);
    const real = await prune(t);
    expect(real.removed).toEqual([old]);
    expect(existsSync(sessionPaths(t.paths, old).dir)).toBe(false);
    expect(existsSync(sessionPaths(t.paths, recent).dir)).toBe(true);
    expect(t.manager.openLog(old)).toBeUndefined();
  });

  test("keeps only the newest N sessions", async () => {
    const clock = new FakeClock();
    const t = setup({ options: { clock } });
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) { ids.push(await t.create()); clock.advance(1000); }
    const result = await prune(t, { keep: 2 });
    expect(result.removed.sort()).toEqual([ids[0]!, ids[1]!].sort());
    expect(result.kept).toBe(2);
  });

  test("never removes a session whose task ownership is unsettled after a crash", async () => {
    const dir = tempDir();
    const clock = new FakeClock();
    const a = setup({ dir, options: { clock } });
    const sessionId = await a.create();
    await a.run({ type: "prompt.send", text: "long" }, sessionId);
    recoverAllSessions({ paths: a.paths, probe: createNodeProbe() }); // crash recovery: lease missing => unsettled
    const b = setup({ dir, options: { clock } });
    clock.advance(90 * DAY);
    expect((await prune(b, { keep: 0 })).removed).toEqual([]);
    lastTurn(a.driver).finish();
  });

  test("never removes a session with a running turn", async () => {
    const clock = new FakeClock();
    const t = setup({ options: { clock } });
    const sessionId = await t.create();
    await t.run({ type: "prompt.send", text: "long" }, sessionId);
    clock.advance(90 * DAY);
    expect((await prune(t, { keep: 0 })).removed).toEqual([]);
    lastTurn(t.driver).finish();
    await t.idle();
  });
});


describe("native memory ownership", () => {
  test("passes prepared native memory and publishes status without exposing plugin internals", async () => {
    const nativeMemory = { provider: "supermemory", integration: "runner-plugin", status: "ready", projectScope: "sm_project_v1_acme_deck", plugin: { root: "/private/plugin" } } as const;
    const t = setup({ options: { childMcp: { nativeMemory, runnerPackages: () => [], resolveServer: () => undefined } } });
    const sid = await t.create();
    await t.run({ type: "prompt.send", text: "go" }, sid);
    await waitFor(() => t.driver.turns.length === 1, PROGRESS_TIMEOUT_MS, "native start");
    const input = lastTurn(t.driver).input;
    expect(input.nativeMemory).toEqual(nativeMemory);
    expect(input.rolePrompt).toContain("Supermemory");
    expect(input.rolePrompt).toContain("runner-plugin");
    expect(input.mcp.sessionTools).not.toContain("deck_memory_recall");
    const grant = { sessionId: sid, taskId: "lead", memberId: "lead", runnerId: "claude", allowedTools: ["deck_memory_recall", "deck_memory_propose"] };
    expect(await t.manager.callTaskTool(grant, "deck_memory_recall", { query: "x" })).toMatchObject({ ok: false, code: "tool-not-allowed" });
    expect(await t.manager.callTaskTool(grant, "deck_memory_propose", { content: "x" })).toMatchObject({ ok: false, code: "tool-not-allowed" });
    const status = t.events(sid).find(e => e.data.code === "memory.integration");
    expect(status?.data).toMatchObject({ provider: "supermemory", integration: "runner-plugin", status: "ready", projectScope: nativeMemory.projectScope });
    expect(JSON.stringify(status)).not.toContain("/private/plugin");
    lastTurn(t.driver).finish(); await t.idle();
  });

  test("unavailable configured native memory blocks before native execution and reports why", async () => {
    const t = setup({ options: { childMcp: { nativeMemory: { provider: "supermemory", integration: "runner-plugin", status: "unavailable", reasonCode: "native-memory-scope-unavailable" }, runnerPackages: () => [], resolveServer: () => undefined } } });
    const sid = await t.create();
    await t.run({ type: "prompt.send", text: "go" }, sid); await t.idle();
    expect(t.driver.turns).toHaveLength(0);
    expect(t.events(sid).find(e => e.data.code === "memory.integration")?.data.status).toBe("unavailable");
    expect(t.events(sid).find(e => e.kind === "turn.completed")?.data.error).toContain("native-memory-scope-unavailable");
  });
});


describe("managed user image attachments", () => {
  const png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==","base64");
  const upload=(t:ReturnType<typeof setup>,sessionId:string,name="clipboard.png")=>{
    const outcome=t.manager.uploadAttachment({sessionId,bytes:png,mimeType:"image/png",name});
    if(!outcome.ok) throw Error(outcome.code); return (outcome.data as any).attachment;
  };
  test("queued image-only input reaches native admission once and never bleeds into the next resumed turn", async () => {
    const t=setup(); const id=await t.create(); await t.run({type:"prompt.send",text:"active"},id);
    await waitFor(()=>t.driver.turns.length===1); lastTurn(t.driver).init();
    const a=upload(t,id), b=upload(t,id,"second.png"); const promptId="11111111-1111-4111-8111-111111111111";
    expect((await t.runWithId(promptId,{type:"prompt.send",text:"",attachmentIds:[a.attachmentId,b.attachmentId]},id)).ok).toBe(true);
    const snapshot=await t.manager.query("prompts.list",{sessionId:id});
    expect((snapshot as any).data.queued[0].attachments).toEqual([a,b]);
    expect(t.events(id).filter(e=>e.kind==="message.completed" && e.data.promptId===promptId)).toHaveLength(0);
    lastTurn(t.driver).finish(); await waitFor(()=>t.driver.turns.length===2);
    const imageTurn=lastTurn(t.driver); expect(imageTurn.input.prompt).toBe(""); expect(imageTurn.input.images).toHaveLength(2);
    expect(imageTurn.input.images!.map(image=>readFileSync(image.path))).toEqual([png,png]);
    expect(imageTurn.input.rolePrompt).toContain("Inspect every supplied native image");
    for (const [index, image] of imageTurn.input.images!.entries()) expect(imageTurn.input.rolePrompt).toContain(`Image ${index+1} (${image.name}): ${image.path}`);
    expect(imageTurn.input.resume).toBeDefined();
    expect(t.events(id).find(e=>e.kind==="message.completed" && e.data.promptId===promptId)?.data.attachments).toEqual([a,b]);
    imageTurn.emit("message.completed",{text:`private ${imageTurn.input.images![0]!.path}`},{path:imageTurn.input.images![0]!.path});
    imageTurn.emit("tool.completed",{summary:imageTurn.input.images!.map(image=>image.path).join(" ")});
    for (const image of imageTurn.input.images!) expect(JSON.stringify(t.events(id))).not.toContain(image.path);
    expect(JSON.stringify(t.events(id))).not.toContain(imageTurn.input.images![0]!.path);
    imageTurn.init(); imageTurn.finish(); await t.idle();
    await t.run({type:"prompt.send",text:"next"},id); await waitFor(()=>t.driver.turns.length===3);
    expect(lastTurn(t.driver).input.images).toBeUndefined(); lastTurn(t.driver).finish(); await t.idle();
    expect((await t.runWithId(promptId,{type:"prompt.send",text:"",attachmentIds:[a.attachmentId,b.attachmentId]},id)).duplicate).toBe(true);
    expect(await t.runWithId(promptId,{type:"prompt.send",text:"",attachmentIds:[b.attachmentId,a.attachmentId]},id)).toMatchObject({ok:false,code:"command-id-reused"});
  });
  test("attachment ownership is session-scoped and cancelled accepted images survive restart", async () => {
    const t=setup(); const id=await t.create(), other=await t.create(); const image=upload(t,id);
    expect(await t.run({type:"prompt.send",text:"image",attachmentIds:[image.attachmentId]},other)).toMatchObject({ok:false,code:"attachment-unknown"});
    let release!:()=>void; t.driver.probe=()=>new Promise(resolve=>{release=()=>resolve(t.driver.probeResult);}); const sent=await t.run({type:"prompt.send",text:"",attachmentIds:[image.attachmentId]},id);
    expect(sent.ok).toBe(true); const promptId=(sent as any).data.promptId;
    await waitFor(()=>!!release); expect((await t.run({type:"prompt.cancel",promptId},id)).ok).toBe(true); release(); await t.idle();
    expect(t.manager.readAttachment(id,image.attachmentId)?.bytes).toEqual(png);
    // Recovery reads immutable metadata independently from browser/OS paths.
    await t.manager.close(); const recovered=setup({dir:t.dir}); expect(recovered.manager.readAttachment(id,image.attachmentId)?.bytes).toEqual(png);
    const queued=t.events(id).find(e=>e.kind==="prompt.queued")!;
    expect(queued.data.attachments).toEqual([image]); expect(JSON.stringify(queued)).not.toContain(t.paths.root);
  });
  test("paused image inbox survives daemon restart and dedupes before resuming native input", async () => {
    const t=setup(); const id=await t.create(); await t.run({type:"prompt.send",text:"active"},id);await waitFor(()=>t.driver.turns.length===1);lastTurn(t.driver).init();
    const image=upload(t,id);const promptId="22222222-2222-4222-8222-222222222222";
    await t.runWithId(promptId,{type:"prompt.send",text:"",attachmentIds:[image.attachmentId]},id);
    await t.run({type:"turn.interrupt",taskId:"lead"},id);await t.idle();await t.manager.close();
    const next=setup({dir:t.dir});const snapshot=await next.manager.query("prompts.list",{sessionId:id});
    expect((snapshot as any).data).toMatchObject({paused:true,queued:[{promptId,text:"",attachments:[image]}]});
    expect((await next.runWithId(promptId,{type:"prompt.send",text:"",attachmentIds:[image.attachmentId]},id)).duplicate).toBe(true);
    expect(await next.runWithId(promptId,{type:"prompt.send",text:"changed",attachmentIds:[image.attachmentId]},id)).toMatchObject({ok:false,code:"command-id-reused"});
    expect(next.driver.turns).toHaveLength(0);await next.run({type:"prompt.resume"},id);await waitFor(()=>next.driver.turns.length===1);
    expect(readFileSync(lastTurn(next.driver).input.images![0]!.path)).toEqual(png);lastTurn(next.driver).finish();await next.idle();
  });
  test("message image bytes allow the exact20MiB boundary and reject larger aggregates", async () => {
    const t=setup();t.driver.autoComplete=true;const id=await t.create();
    const chunk=Buffer.alloc(5*1024*1024-png.length);chunk.writeUInt32BE(chunk.length-12);chunk.write("paDd",4);
    let crc=0xffffffff;for(const byte of chunk.subarray(4,-4)){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}chunk.writeUInt32BE((crc^0xffffffff)>>>0,chunk.length-4);
    const large=Buffer.concat([png.subarray(0,-12),chunk,png.subarray(-12)]);const ids:string[]=[];
    for(let i=0;i<5;i++){const result=t.manager.uploadAttachment({sessionId:id,bytes:large,mimeType:"image/png",name:`image${i}.png`});expect(result.ok).toBe(true);ids.push((result as any).data.attachment.attachmentId);}
    expect(await t.run({type:"prompt.send",text:"",attachmentIds:ids},id)).toMatchObject({ok:false,code:"attachment-too-large"});
    expect((await t.run({type:"prompt.send",text:"",attachmentIds:ids.slice(0,4)},id)).ok).toBe(true);await t.idle();expect(lastTurn(t.driver).input.images).toHaveLength(4);
  });
  test("Lead generation handoff keeps bounded image labels and private references without public paths", async () => {
    const t=setup(); const id=await t.create(); const image=upload(t,id);
    await t.run({type:"prompt.send",text:"",attachmentIds:[image.attachmentId]},id); await waitFor(()=>t.driver.turns.length===1);
    const original=lastTurn(t.driver); const path=original.input.images![0]!.path; original.init(); original.say("A red pixel");original.finish();await t.idle();
    expect((await t.run({type:"session.assignMember",memberId:"lead",expectedRevision:0,assignment:{runnerId:"claude",modelId:"sonnet"}},id)).ok).toBe(true);
    expect(JSON.stringify(t.events(id))).toContain(image.attachmentId); expect(JSON.stringify(t.events(id))).not.toContain(path);
    await t.run({type:"prompt.send",text:"Describe the earlier image"},id); await waitFor(()=>t.driver.turns.length===2);
    const current=lastTurn(t.driver); expect(current.input.images).toBeUndefined(); expect(current.input.rolePrompt).toContain("Image 1: clipboard.png"); expect(current.input.rolePrompt).toContain(path);
    current.emit("message.completed",{text:`Previous image ${path}`}); expect(JSON.stringify(t.events(id))).not.toContain(path);
    current.finish(); await t.idle();
  });
  test("missing managed image before native admission fails visibly without delivering user chat", async () => {
    const t=setup(); const id=await t.create(); const image=upload(t,id); let release!:()=>void;
    t.driver.probe=()=>new Promise(resolve=>{release=()=>resolve(t.driver.probeResult);});
    const sent=await t.run({type:"prompt.send",text:"inspect",attachmentIds:[image.attachmentId]},id); await waitFor(()=>!!release);
    rmSync(join(sessionPaths(t.paths,id).attachmentsDir,`${image.attachmentId}.image`)); release(); await t.idle();
    expect(t.driver.turns).toHaveLength(0);
    expect(t.events(id).filter(e=>e.kind==="message.completed" && e.data.role==="user")).toHaveLength(0);
    const result=await t.manager.query("prompts.list",{sessionId:id}); expect((result as any).data.paused).toBe(true);
    expect(t.events(id).find(e=>e.kind==="prompt.state" && e.data.promptId===(sent as any).data.promptId)?.data.state).toBe("failed");
  });
});


describe("reversible session release and session catalog actions", () => {
 const ready=async(t:ReturnType<typeof setup>,id:string)=>{expect((await t.run({type:"session.prepare"},id)).ok).toBe(true);await waitFor(async()=>((await t.manager.query("session.readiness",{sessionId:id})) as any).data.status==="ready");};
 test("release waits owned native drain, preserves paused FIFO and native identity, and leaves another session running",async()=>{
  const t=setup();const id=await t.create(),other=await t.create();await ready(t,id);
  const start=t.driver.startTask.bind(t.driver);let close!:()=>void;const held=new Promise<void>(resolve=>{close=resolve;});let n=0;
  t.driver.startTask=async(input,io)=>{const handle=await start(input,io);if(++n!==1)return handle;return{...handle,close:async()=>{await held;await handle.close();}};};
  await t.run({type:"prompt.send",text:"active"},id);await waitFor(()=>t.driver.turns.length===1);lastTurn(t.driver).init();const native=lastTurn(t.driver).nativeSessionId;
  const queued=await t.run({type:"prompt.send",text:"later"},id);const releaseId="33333333-3333-4333-8333-333333333333";
  expect(await t.runWithId(releaseId,{type:"session.release"},id)).toMatchObject({ok:true,data:{preparation:{status:"releasing"}}});
  expect((await t.manager.query("session.readiness",{sessionId:id}) as any).data.status).toBe("releasing");
  expect(await t.run({type:"prompt.send",text:"not admitted"},id)).toMatchObject({ok:false,code:"session-released"});
  expect(await t.run({type:"session.prepare"},id)).toMatchObject({ok:false,code:"session-releasing"});
  await t.run({type:"prompt.send",text:"other session"},other);await waitFor(()=>t.driver.turns.length===2);expect(lastTurn(t.driver).finished).toBe(false);
  close();await waitFor(async()=>((await t.manager.query("session.readiness",{sessionId:id})) as any).data.status==="unprepared");
  const inbox=await t.manager.query("prompts.list",{sessionId:id});expect((inbox as any).data).toMatchObject({paused:true,queued:[{promptId:(queued as any).data.promptId,text:"later"}]});
  await ready(t,id);expect(t.driver.turns).toHaveLength(2);expect((await t.manager.query("prompts.list",{sessionId:id}) as any).data.paused).toBe(true);
  expect((await t.runWithId(releaseId,{type:"session.release"},id)).duplicate).toBe(true);expect((await t.manager.query("session.readiness",{sessionId:id}) as any).data.status).toBe("ready");
  await t.run({type:"prompt.resume"},id);await waitFor(()=>t.driver.turns.length===3);expect(lastTurn(t.driver).input.resume?.nativeSessionId).toBe(native);
  t.driver.turns.forEach(turn=>turn.finish());await t.idle();
 });
 test("release aborts stale preparation and waits helper cleanup before allowing Prepare",async()=>{
  let releaseResolver!:()=>void,releaseHelper!:()=>void,helperClosed=false;
  const t=setup({options:{childMcp:async()=>{await new Promise<void>(resolve=>{releaseResolver=resolve;});return{runnerPackages:()=>[],resolveServer:()=>undefined,release:async()=>{await new Promise<void>(resolve=>{releaseHelper=resolve;});helperClosed=true;}};}}});const id=await t.create();
  await t.run({type:"session.prepare"},id);await waitFor(()=>!!releaseResolver);
  await t.run({type:"session.release"},id);releaseResolver();await waitFor(()=>!!releaseHelper);
  expect((await t.manager.query("session.readiness",{sessionId:id}) as any).data.status).toBe("releasing");expect(helperClosed).toBe(false);releaseHelper();
  await waitFor(async()=>((await t.manager.query("session.readiness",{sessionId:id})) as any).data.status==="unprepared");expect(helperClosed).toBe(true);
  expect(t.events(id).filter(event=>event.kind==="diagnostic" && event.data.code==="session.preparation" && event.data.status==="ready")).toHaveLength(0);
 });
 test("release and remove single-record intents replay safely without receipt tails",async()=>{
  const t=setup();const id=await t.create();t.state.config!.enabled=false;
  await t.run({type:"prompt.send",text:"pending"},id);expect(t.driver.turns).toHaveLength(0);
  const releaseId="66666666-6666-4666-8666-666666666666";
  t.manager.openLog(id)!.append({kind:"session.released",data:{phase:"releasing",epoch:1,commandId:releaseId,outcome:{ok:true,data:{preparation:{status:"releasing",generation:0}}}}});t.manager.openLog(id)!.flush();await t.manager.close();
  const next=setup({dir:t.dir});await waitFor(async()=>((await next.manager.query("session.readiness",{sessionId:id})) as any).data.status==="unprepared");await ready(next,id);
  expect((await next.runWithId(releaseId,{type:"session.release"},id)).duplicate).toBe(true);
  expect((await next.manager.query("session.readiness",{sessionId:id}) as any).data.status).toBe("ready");expect(next.driver.turns).toHaveLength(0);
  expect((await next.manager.query("prompts.list",{sessionId:id}) as any).data).toMatchObject({paused:true,queued:[{text:"pending"}]});
  const removeId="77777777-7777-4777-8777-777777777777";
  next.manager.openLog(id)!.append({kind:"session.removed",data:{phase:"removing",epoch:2,commandId:removeId,outcome:{ok:true,data:{state:"removing",preparation:{status:"releasing",generation:0}}}}});next.manager.openLog(id)!.flush();await next.manager.close();
  const restored=setup({dir:t.dir});await waitFor(async()=>!(await restored.manager.query("sessions.list",{}) as any).data.sessions.length);
  expect((await restored.runWithId(removeId,{type:"session.remove"},id)).duplicate).toBe(true);expect(restored.manager.openLog(id)).toBeDefined();expect(restored.driver.turns).toHaveLength(0);
 });
 test("recovery completes removal when crash retains terminal release but omits terminal tombstone",async()=>{
  const t=setup();const id=await t.create();const log=t.manager.openLog(id)!;
  log.append({kind:"session.removed",data:{phase:"removing",epoch:1,commandId:"88888888-8888-4888-8888-888888888888",outcome:{ok:true,data:{state:"removing"}}}});
  log.append({kind:"session.released",data:{phase:"released",epoch:1}});log.flush();
  expect((await t.manager.query("sessions.list",{}) as any).data.sessions[0]).toMatchObject({removing:true,releasing:false});await t.manager.close();
  const next=setup({dir:t.dir});await waitFor(async()=>!(await next.manager.query("sessions.list",{}) as any).data.sessions.length);
  expect(next.events(id).filter(event=>event.kind==="session.removed" && event.data.phase==="removed")).toHaveLength(1);expect(next.manager.openLog(id)).toBeDefined();
 });
 test("held assignment validation cannot mutate a removed session",async()=>{
  const t=setup();const id=await t.create();let probe!:()=>void;t.driver.probe=()=>new Promise(resolve=>{probe=()=>resolve(t.driver.probeResult);});
  const assignment=t.run({type:"session.assignMember",memberId:"lead",assignment:{runnerId:"claude",modelId:"sonnet"},expectedRevision:0},id);await waitFor(()=>!!probe);
  await t.run({type:"session.remove"},id);await t.idle();probe();expect(await assignment).toMatchObject({ok:false,code:"session-removed"});
  expect(t.events(id).filter(event=>event.kind==="session.assignment")).toHaveLength(0);
 });
 test("pruning protects held resource drains and fresh Remove retries failed owned cleanup",async()=>{
  const t=setup();const id=await t.create();let close!:()=>void;let attempts=0;
  const live=(t.manager as any).sessions.get(id);live.memory=new MemoryBroker(Promise.resolve({recall:async()=>({ok:true}),propose:async()=>({ok:true}),close:async()=>{attempts++;if(attempts===1)throw Error("temporary close failure");await new Promise<void>(resolve=>{close=resolve;});}}));
  await t.run({type:"session.remove"},id);await waitFor(async()=>((await t.manager.query("session.readiness",{sessionId:id})) as any).data.status==="failed");
  expect(t.manager.hasRunningWork()).toBe(true);
  expect((await t.manager.query("session.readiness",{sessionId:id}) as any).data).toMatchObject({status:"failed",reasonCode:"session-release-failed"});
  expect((await t.manager.query("sessions.prune",{keep:0,maxAgeDays:0}) as any).data.removed).toEqual([]);
  expect((await t.run({type:"session.remove"},id)).ok).toBe(true);await waitFor(()=>!!close);
  expect((await t.manager.query("sessions.prune",{keep:0,maxAgeDays:0}) as any).data.removed).toEqual([]);
  expect((await t.manager.query("sessions.list",{}) as any).data.sessions[0]).toMatchObject({sessionId:id,removing:true,running:true});
  close();await t.idle();expect(attempts).toBe(2);expect((await t.manager.query("sessions.list",{}) as any).data.sessions).toEqual([]);
 });
 test("Prepare reopens legacy ended in place and old Stop cannot stop the new incarnation after receipt eviction",async()=>{
  const t=setup();const id=await t.create();await t.run({type:"prompt.send",text:"history"},id);await waitFor(()=>t.driver.turns.length===1);lastTurn(t.driver).init();const native=lastTurn(t.driver).nativeSessionId;lastTurn(t.driver).finish();await t.idle();
  const stopId="44444444-4444-4444-8444-444444444444";await t.runWithId(stopId,{type:"session.stop"},id);await ready(t,id);
  expect(t.events(id).some(event=>event.kind==="session.reopened")).toBe(true);
  for(let i=0;i<1001;i++) await t.run({type:"session.bindChange",changeId:"same-change"},id);
  expect((await t.runWithId(stopId,{type:"session.stop"},id)).duplicate).toBe(true);
  expect((await t.manager.query("session.readiness",{sessionId:id}) as any).data.status).toBe("ready");
  await t.run({type:"prompt.send",text:"same session"},id);await waitFor(()=>t.driver.turns.length===2);expect(lastTurn(t.driver).input.resume?.nativeSessionId).toBe(native);lastTurn(t.driver).finish();await t.idle();
  const list=await t.manager.query("sessions.list",{});expect((list as any).data.sessions.map((session:any)=>session.sessionId)).toEqual([id]);
 });
 test("rename replay cannot revert a later title and removal hides only after drain while preserving readable history",async()=>{
  const t=setup();const id=await t.create();const renameId="55555555-5555-4555-8555-555555555555";
  expect(await t.runWithId(renameId,{type:"session.rename",title:" First "},id)).toMatchObject({ok:true,data:{title:"First"}});
  await t.run({type:"session.rename",title:"Second"},id);expect((await t.runWithId(renameId,{type:"session.rename",title:" First "},id)).duplicate).toBe(true);
  expect((await t.manager.query("sessions.list",{}) as any).data.sessions[0].title).toBe("Second");
  await t.run({type:"prompt.send",text:"preserved"},id);await waitFor(()=>t.driver.turns.length===1);
  let close!:()=>void;const turn=lastTurn(t.driver);const liveTurn=(t.manager as any).sessions.get(id).turns.get("lead");const handle=liveTurn.handle;liveTurn.handle={...handle,close:()=>new Promise<void>(resolve=>{close=resolve;})};
  expect(await t.run({type:"session.remove"},id)).toMatchObject({ok:true,data:{state:"removing"}});await waitFor(()=>!!close);
  expect((await t.manager.query("sessions.list",{}) as any).data.sessions[0]).toMatchObject({sessionId:id,removing:true});
  expect(await t.run({type:"session.prepare"},id)).toMatchObject({ok:false,code:"session-removed"});close();
  await waitFor(async()=>!(await t.manager.query("sessions.list",{}) as any).data.sessions.length);
  expect(t.manager.openLog(id)).toBeDefined();expect(t.events(id).some(event=>event.kind==="session.removed" && event.data.phase==="removed")).toBe(true);
  expect(existsSync(sessionPaths(t.paths,id).sessionFile)).toBe(true);await t.manager.close();const next=setup({dir:t.dir});
  expect((await next.manager.query("sessions.list",{}) as any).data.sessions).toEqual([]);expect(await next.run({type:"prompt.send",text:"no"},id)).toMatchObject({ok:false,code:"session-removed"});
 });
});

test("global native memory role instructions omit canonical identity and project standing profiles", async () => {
  const nativeMemory = { provider: "supermemory", integration: "runner-plugin", status: "ready", scopeMode: "global", plugin: { root: "/private/plugin" } } as const;
  const t = setup({ options: { childMcp: { nativeMemory, runnerPackages: () => [], resolveServer: () => undefined } } });
  const sid = await t.create();
  await t.run({ type: "prompt.send", text: "go" }, sid);
  await waitFor(() => t.driver.turns.length === 1, PROGRESS_TIMEOUT_MS, "global native start");
  const prompt = lastTurn(t.driver).input.rolePrompt;
  expect(prompt).toContain("untagged global writes and global search");
  expect(prompt).toContain("no project container or project standing profile");
  expect(prompt).not.toContain("canonical project scope");
  expect(prompt).not.toContain("undefined");
  lastTurn(t.driver).finish(); await t.idle();
});
