import { PassThrough } from "node:stream";
import { runSessionMcpBridge } from "../mcp-bridge";
import type { ControlClient } from "../control-client";
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
import { Ledger, loadLedger } from "../ledger";
import { EventLog } from "../event-log";
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

describe("Stage 1 conversational continuity", () => {
  const config = baseConfig({ members: { lead: { runnerId: "claude", modelId: "opus" }, investigate: { runnerId: "claude", modelId: "fast" } } });
  const grant = (t: ReturnType<typeof setup>, id: string) => t.credentials.lookup(JSON.parse(readFileSync(sessionPaths(t.paths, id).taskCredentialFile("lead"), "utf8")).token)!;
  async function started() {
    const clock = new FakeClock(); const t = setup({ config, options: { clock } }); const id = await t.create();
    const sent = await t.run({ type: "prompt.send", text: "original request" }, id);
    await waitFor(() => t.driver.turns.length === 1); const lead = lastTurn(t.driver); lead.init();
    const childId = (await t.manager.callTaskTool(grant(t, id), "deck_delegate", { agent: "investigate", task: "inspect" }) as any).data.taskId;
    await waitFor(() => t.driver.turns.length === 2); const child = lastTurn(t.driver); child.init();
    return { t, id, clock, lead, child, childId, promptId: (sent as any).data.promptId };
  }
  test.each(["retrieved", "delivered", "both-interrupted", "blocked"] as const)("P1 retains %s review in the next genuine turn without a duplicate wake", async mode => {
    const { t, id, lead, child, childId, clock } = await started();
    child.say("Original outstanding report"); child.finish(); await waitFor(() => child.closed);
    if (mode === "retrieved") await t.manager.callTaskTool(grant(t, id), "deck_task_result", { taskId: childId });
    lead.finish(); await waitFor(() => lead.closed);
    let expectedTurns = 2;
    if (mode !== "retrieved") {
      clock.advance(20); await waitFor(() => t.driver.turns.length === 3); const receiver = lastTurn(t.driver); expectedTurns++;
      if (mode !== "delivered") await t.manager.callTaskTool(grant(t, id), "deck_task_result", { taskId: childId });
      if (mode === "blocked") {
        const evidenceSeq = t.events(id).find(e => e.kind === "task.result" && e.source.taskId === childId)!.seq;
        expect(await t.manager.callTaskTool(grant(t, id), "deck_task_integrate", { commandId: "p1-blocked", taskId: childId, attempt: 1, state: "blocked", note: "Awaiting additional evidence", evidenceSeqs: [evidenceSeq] })).toMatchObject({ ok: true });
      }
      receiver.finish({ status: mode === "both-interrupted" ? "interrupted" : "completed" }); await waitFor(() => receiver.closed);
    }
    clock.advance(1000); expect(t.driver.turns).toHaveLength(expectedTurns);
    await t.run({ type: "prompt.send", text: "a different topic" }, id);
    if (mode === "both-interrupted") await t.run({ type: "prompt.resume" }, id);
    await waitFor(() => t.driver.turns.length === expectedTurns + 1); const next = lastTurn(t.driver);
    expect(next.input.prompt).toBe("a different topic"); expect(next.input.rolePrompt).toContain(childId);
    expect(next.input.rolePrompt).toContain("Original outstanding report");
    expect(next.input.rolePrompt).toContain(`"review":"${mode === "blocked" ? "blocked" : "unverified"}"`);
    expect(next.input.rolePrompt).not.toContain("Delegated task completion notice:");
    next.finish(); await waitFor(() => next.closed); clock.advance(1000);
    expect(t.driver.turns).toHaveLength(expectedTurns + 1);
    expect(t.events(id).filter(e => e.kind === "task.delivery")).toHaveLength(mode === "retrieved" ? 0 : 1);
    expect(t.manager.hasRunningWork()).toBe(false);
  });
  test("A1: yielding admits another user topic while the child retains its original owner", async () => {
    const { t, id, lead, child, childId, promptId } = await started();
    lead.say("Delegated; ready for another topic"); lead.finish(); await waitFor(() => lead.closed);
    const queued = await t.run({ type: "prompt.send", text: "topic B" }, id);
    await waitFor(() => t.driver.turns.length === 3); const topicB = lastTurn(t.driver);
    expect(topicB.input.prompt).toBe("topic B"); expect(child.finished).toBe(false);
    expect(topicB.input.rolePrompt).not.toContain("Delegated; ready for another topic");
    expect(topicB.input.rolePrompt).toContain("yield promptly"); expect(topicB.input.rolePrompt).toContain("last action of the turn");
    const ledger = loadLedger(t.manager.openLog(id)!, sessionPaths(t.paths, id).ledgerSnapshotFile).ledger;
    expect(ledger.continuityBlock?.promptId).toBe((queued as any).data.promptId); expect(ledger.continuityBlock?.promptId).not.toBe(promptId);
    expect(ledger.task(childId)?.memberId).toBe("investigate"); expect(ledger.latest(childId)?.runnerId).toBe("claude");
    topicB.say("Answer B"); topicB.finish(); child.finish(); await waitFor(() => child.closed && topicB.closed);
  });
  test("only admitted genuine input resets the block; cancelled input and outcome continuations retain originals", async () => {
    const { t, id, lead, child, clock, promptId } = await started();
    const pending = await t.run({ type: "prompt.send", text: "cancel me" }, id);
    const read = () => loadLedger(t.manager.openLog(id)!, sessionPaths(t.paths, id).ledgerSnapshotFile).ledger;
    expect(read().continuityBlock?.promptId).toBe(promptId);
    await t.run({ type: "prompt.cancel", promptId: (pending as any).data.promptId }, id);
    lead.say("original " + "x".repeat(1500)); lead.emit("message.completed", { role: "assistant", text: "internal bookkeeping", internal: true }); lead.finish(); child.say("report"); child.finish(); await waitFor(() => child.closed && lead.closed);
    clock.advance(20); await waitFor(() => t.driver.turns.length === 3);
    expect(read().continuityBlock?.promptId).toBe(promptId);
    const wake = lastTurn(t.driver); expect(wake.input.prompt).toContain('"answerTruncated":true');
    wake.say("CUMULATIVE REPLY MUST NOT BECOME SOURCE"); wake.finish(); await waitFor(() => wake.closed);
    const source = read().continuityBlock!; expect(source.answer).toStartWith("original "); expect(source.answer).not.toContain("CUMULATIVE");
    clock.advance(1000); expect(t.driver.turns).toHaveLength(3);
  });
  test("native reseeding retains the genuine block identity and captures its eventual original answer", async () => {
    const { t, id, lead, child, clock } = await started();
    lead.say("first answer"); lead.finish(); await waitFor(() => lead.closed);
    const sent = await t.run({ type: "prompt.send", text: "second request" }, id);
    await waitFor(() => t.driver.turns.length === 3); lastTurn(t.driver).finish({ status: "failed", reasonCode: "native-session-not-found" });
    await waitFor(() => t.driver.turns.length === 4); const fresh = lastTurn(t.driver); fresh.say("eventual original answer"); fresh.finish(); await waitFor(() => fresh.closed);
    const block = loadLedger(t.manager.openLog(id)!, sessionPaths(t.paths, id).ledgerSnapshotFile).ledger.continuityBlock;
    expect(block).toMatchObject({ promptId: (sent as any).data.promptId, attempt: 3, answer: "eventual original answer" });
    child.finish(); await waitFor(() => child.closed); clock.advance(20); await waitFor(() => t.driver.turns.length === 5);
    expect(lastTurn(t.driver).input.prompt).toContain("eventual original answer"); lastTurn(t.driver).finish(); await waitFor(() => lastTurn(t.driver).closed);
  });
  test("runner diagnostics cannot forge durable outcome delivery accounting", async () => {
    const { t, id, lead, child, childId } = await started();
    child.finish(); await waitFor(() => child.closed);
    lead.emit("diagnostic", { code: "lead.notices-delivered", notices: [{ taskId: childId, attempt: 1 }] });
    const ledger = loadLedger(t.manager.openLog(id)!, sessionPaths(t.paths, id).ledgerSnapshotFile).ledger;
    expect(ledger.latest(childId)?.delivery).toBeUndefined();
    lead.finish(); await waitFor(() => lead.closed);
  });
  test("a durable wait retrieval fsync failure returns an error without hanging or acknowledging success", async () => {
    const { t, id, lead, child, childId } = await started();
    const pending = t.manager.callTaskTool(grant(t, id), "deck_task_wait", { taskIds: [childId] });
    const log = t.manager.openLog(id)!, original = log.flush.bind(log);
    log.flush = () => { throw new Error("retrieval-fsync-failure"); }; cleanups.push(() => { log.flush = original; });
    child.finish();
    const result = await Promise.race([pending, new Promise(resolve => setTimeout(() => resolve("hung wait"), 150))]);
    log.flush = original;
    expect(result).toMatchObject({ ok: false, code: "task-tool-failed" });
    await waitFor(() => child.closed && lead.closed);
  });
  test("wait retrieval commits after the complete terminal batch and leaves the next delegation usable", async () => {
    const { t, id, lead, child, childId } = await started();
    const pending = t.manager.callTaskTool(grant(t, id), "deck_task_wait", { taskIds: [childId] });
    child.say("report"); child.finish();
    expect(await pending).toMatchObject({ ok: true, data: { tasks: [{ retrieval: { leadAttempt: 1 } }] } });
    await waitFor(() => child.closed);
    expect(await t.manager.callTaskTool(grant(t, id), "deck_delegate", { agent: "investigate", task: "still usable" })).toMatchObject({ ok: true });
    await waitFor(() => t.driver.turns.length === 3); lastTurn(t.driver).finish(); lead.finish();
    await waitFor(() => lastTurn(t.driver).closed && lead.closed);
    const ledger = loadLedger(t.manager.openLog(id)!, sessionPaths(t.paths, id).ledgerSnapshotFile).ledger;
    expect(ledger.seq).toBe(t.manager.openLog(id)!.lastSeq); expect(ledger.anomalies).toEqual([]);
  });
  test("integration rejects missing retrieval, foreign attempt evidence, members and revoked owners", async () => {
    const { t, id, lead, child, childId } = await started();
    child.say("report"); child.finish(); await waitFor(() => child.closed);
    const owner = grant(t, id); const evidenceSeq = t.events(id).find(e => e.kind === "task.result" && e.source.taskId === childId)!.seq;
    const input = { commandId: "review-validation", taskId: childId, attempt: 1, state: "integrated", note: "Reviewed", evidenceSeqs: [evidenceSeq] };
    expect(await t.manager.callTaskTool(owner, "deck_task_integrate", input)).toMatchObject({ ok: false, code: "integration-evidence-required" });
    expect(await t.manager.callTaskTool({ ...owner, memberId: "investigate" }, "deck_task_integrate", input)).toMatchObject({ ok: false, code: "tool-not-allowed" });
    await t.manager.callTaskTool(owner, "deck_task_result", { taskId: childId });
    expect(await t.manager.callTaskTool(owner, "deck_task_integrate", { ...input, evidenceSeqs: [1] })).toMatchObject({ ok: false, code: "integration-evidence-invalid" });
    expect(await t.manager.callTaskTool(owner, "deck_task_integrate", { ...input, attempt: 2 })).toMatchObject({ ok: false, code: "task-unknown" });
    expect(await t.manager.callTaskTool(owner, "deck_task_integrate", { ...input, note: "x".repeat(513) })).toMatchObject({ ok: false, code: "invalid-arguments" });
    lead.finish(); await waitFor(() => lead.closed);
    expect(await t.manager.callTaskTool(owner, "deck_task_integrate", input)).toMatchObject({ ok: false, code: "credential-revoked" });
  });
  test("every genuine admission prefix preserves accepted text and changes the block only at dispatch", async () => {
    const { t, id, lead, child, childId, promptId } = await started();
    lead.say("original source"); lead.finish(); child.finish(); await waitFor(() => child.closed && lead.closed);
    const before = t.events(id).length;
    const sent = await t.run({ type: "prompt.send", text: "accepted next user text" }, id);
    await waitFor(() => t.driver.turns.length === 3);
    const all = t.events(id), nextId = (sent as any).data.promptId;
    const dispatched = all.find(e => e.kind === "prompt.dispatched" && e.data.promptId === nextId)!;
    const delivered = all.find(e => e.kind === "task.delivery" && e.data.taskId === childId)!;
    for (let count = before; count <= all.length; count++) {
      const ledger = Ledger.empty(id); for (const event of all.slice(0, count)) ledger.apply(event);
      expect(ledger.continuityBlock?.promptId).toBe(count >= dispatched.seq ? nextId : promptId);
      const prompt = ledger.prompt(nextId); if (prompt) expect(prompt.text).toBe("accepted next user text");
      expect(!!ledger.latest(childId)?.delivery).toBe(count >= delivered.seq);
      expect(ledger.latest(childId)?.integration).toBeUndefined(); expect(ledger.anomalies).toEqual([]);
    }
    lastTurn(t.driver).finish(); await waitFor(() => lastTurn(t.driver).closed);
  });
  test("every committed outcome-admission prefix retains accounting without replaying uncertain native execution", async () => {
    const { t, id, lead, child, clock, childId } = await started();
    lead.say("Original source"); lead.finish(); child.say("outcome"); child.finish(); await waitFor(() => child.closed && lead.closed);
    const before = t.events(id).length; clock.advance(20); await waitFor(() => t.driver.turns.length === 3);
    const all = t.events(id); const delivery = all.find(e => e.kind === "task.delivery")!;
    for (let count = before; count <= all.length; count++) {
      const dir = tempDir(); const paths = resolveStatePaths({ env: { HOME: dir, XDG_STATE_HOME: join(dir, "state") }, tmpdir: dir }); ensureStateLayout(paths);
      cpSync(t.paths.sessionsDir, paths.sessionsDir, { recursive: true });
      const sp = sessionPaths(paths, id); const names = readdirSync(sp.eventsDir).filter(n => n.endsWith(".jsonl")); expect(names).toHaveLength(1);
      writeFileSync(join(sp.eventsDir, names[0]!), all.slice(0, count).map(e => JSON.stringify(e)).join("\n") + "\n");
      recoverAllSessions({ paths, probe: createNodeProbe() });
      const log = EventLog.open({ dir: sp.eventsDir, sessionId: id }); const restored = loadLedger(log, sp.ledgerSnapshotFile).ledger;
      expect(!!restored.latest(childId)?.delivery).toBe(count >= delivery.seq);
      expect(restored.continuityBlock?.answer).toBe("Original source"); log.close();
      const driver = new FakeDriver(); driver.autoComplete = true; const next = setup({ dir, driver, config });
      await new Promise(resolve => setTimeout(resolve, 65));
      const reserved = all.slice(before, count).some(e => e.kind === "task.state" && e.source.taskId === "lead" && e.data.state === "running");
      expect(driver.turns.length).toBe(reserved ? 0 : 1); await next.manager.close();
    }
    lastTurn(t.driver).finish(); await waitFor(() => lastTurn(t.driver).closed);
  });
  test("explicit Resume after release and prepare recovers an undelivered actual outcome", async () => {
    const { t, id, lead, child, childId, clock } = await started();
    lead.finish(); child.finish(); await waitFor(() => lead.closed && child.closed);
    await t.run({ type: "session.release" }, id);
    await waitFor(async () => (await t.manager.query("session.readiness", { sessionId: id }) as any).data.status === "unprepared");
    await t.run({ type: "session.prepare" }, id);
    await waitFor(async () => (await t.manager.query("session.readiness", { sessionId: id }) as any).data.status === "ready");
    expect(t.driver.turns).toHaveLength(2);
    await t.run({ type: "prompt.resume" }, id); clock.advance(20);
    await waitFor(() => t.driver.turns.length === 3, 1000, "resumed retained outcome");
    expect(lastTurn(t.driver).input.prompt).toContain(childId); lastTurn(t.driver).finish(); await waitFor(() => lastTurn(t.driver).closed);
  });
  test("restart delivers both unretrieved attempts of the same task without losing history", async () => {
    const { t, id, lead, child, childId } = await started(); child.finish(); await waitFor(() => child.closed);
    await t.manager.callTaskTool(grant(t, id), "deck_delegate", { agent: "investigate", task: "retry", continueTaskId: childId });
    await waitFor(() => t.driver.turns.length === 3); const retry = lastTurn(t.driver); retry.finish(); lead.finish(); await waitFor(() => retry.closed && lead.closed);
    await t.manager.close();
    const driver = new FakeDriver(); driver.autoComplete = true; const next = setup({ dir: t.dir, config, driver });
    await waitFor(() => driver.turns.length === 1); await next.idle();
    const delivered = next.events(id).filter(e => e.kind === "task.delivery");
    expect(delivered.map(e => [e.data.taskId, e.data.attempt])).toEqual([[childId, 1], [childId, 2]]);
    expect(driver.turns[0]!.input.prompt).toContain("attempt 1"); expect(driver.turns[0]!.input.prompt).toContain("attempt 2");
  });
  test("recovers an undelivered terminal outcome through the full restart and native admission path", async () => {
    const { t, id, lead, child, childId } = await started();
    lead.say("Original recommendation"); lead.finish(); child.say("child evidence"); child.finish();
    await waitFor(() => child.closed && lead.closed); await t.manager.close();
    recoverAllSessions({ paths: t.paths, probe: createNodeProbe() });
    const driver = new FakeDriver(); driver.autoComplete = true; const next = setup({ dir: t.dir, config, driver });
    await waitFor(() => driver.turns.length === 1, 1200, "recovered outcome wake"); await next.idle();
    expect(driver.turns[0]!.input.prompt).toContain(childId);
    expect(driver.turns[0]!.input.prompt).toContain("Original recommendation");
    expect(next.events(id).filter(e => e.kind === "task.delivery")).toHaveLength(1);
    await next.manager.close(); const again = setup({ dir: t.dir, config });
    await new Promise(resolve => setTimeout(resolve, 60)); expect(again.driver.turns).toHaveLength(0);
  });
  test("observer reads are inert; retrieval and explicit integration persist separately across retry", async () => {
    const { t, id, lead, child, childId, clock } = await started();
    child.say("report"); child.finish(); await waitFor(() => child.closed);
    const before = t.events(id).length; await t.manager.query("task.result", { sessionId: id, taskId: childId });
    expect(t.events(id)).toHaveLength(before);
    const retrieved = await t.manager.callTaskTool(grant(t, id), "deck_task_result", { taskId: childId, attempt: 1 });
    expect(retrieved).toMatchObject({ ok: true, data: { retrieval: { leadAttempt: 1 } } });
    expect((retrieved as any).data.integration).toBeUndefined();
    const evidenceSeq = t.events(id).find(e => e.kind === "task.result" && e.source.taskId === childId)!.seq;
    const input = { commandId: "review-1", taskId: childId, attempt: 1, state: "integrated", note: "Checked report against evidence", evidenceSeqs: [evidenceSeq] };
    expect(await t.manager.callTaskTool(grant(t, id), "deck_task_integrate", input)).toMatchObject({ ok: true });
    expect(await t.manager.callTaskTool(grant(t, id), "deck_task_integrate", input)).toMatchObject({ ok: true, duplicate: true });
    expect(await t.manager.callTaskTool(grant(t, id), "deck_task_integrate", { ...input, note: "changed" })).toMatchObject({ ok: false, code: "command-id-reused" });
    await t.manager.callTaskTool(grant(t, id), "deck_delegate", { agent: "investigate", task: "retry", continueTaskId: childId });
    await waitFor(() => t.driver.turns.length === 3); lastTurn(t.driver).say("new unverified report"); lastTurn(t.driver).finish();
    await waitFor(() => lastTurn(t.driver).closed);
    const old = await t.manager.callTaskTool(grant(t, id), "deck_task_result", { taskId: childId, attempt: 1 });
    expect(old).toMatchObject({ ok: true, data: { integration: { state: "integrated" } } });
    lead.say("initial answer"); lead.finish(); await waitFor(() => lead.closed); clock.advance(20);
    await waitFor(() => t.driver.turns.length === 4); const wake = lastTurn(t.driver);
    expect(wake.input.prompt).toContain("unverified"); expect(wake.input.prompt).toContain("Checked report");
    wake.finish(); await waitFor(() => wake.closed);
    t.manager.openLog(id)!.appendMany(Array.from({ length: 1001 }, (_, i) => ({ kind: "command.accepted" as const, data: { commandId: `eviction-${i}`, type: "fixture", outcome: { ok: true } } })));
    t.manager.openLog(id)!.flush(); await t.manager.close();
    const next = setup({ dir: t.dir, config });
    const result = await next.manager.query("task.result", { sessionId: id, taskId: childId });
    expect(result).toMatchObject({ ok: true, data: { attempts: [{ integration: { state: "integrated" } }, { state: "completed" }] } });
    await next.run({ type: "prompt.send", text: "new topic" }, id); await waitFor(() => next.driver.turns.length === 1);
    expect(await next.manager.callTaskTool(grant(next, id), "deck_task_integrate", input)).toMatchObject({ ok: true, duplicate: true, data: { integration: { leadAttempt: 1 } } });
    expect(await next.manager.callTaskTool(grant(next, id), "deck_task_integrate", { ...input, attempt: 2 })).toMatchObject({ ok: false, code: "command-id-reused" });
    lastTurn(next.driver).finish(); await next.idle();
  });
});

describe("persistent workspace sessions", () => {
  const grantFor = (t: ReturnType<typeof setup>, sessionId: string, taskId = "lead") => t.credentials.lookup(JSON.parse(readFileSync(sessionPaths(t.paths, sessionId).taskCredentialFile(taskId), "utf8")).token)!;

  for (const terminal of ["completed", "failed", "cancelled"] as const) {
    test(`task roster and deck_task_list track ${terminal} delegation with safe summaries`, async () => {
      const contexts: Array<{ member: string; context: any }> = [];
      const t = setup({ config: baseConfig({ members: { lead: { runnerId: "claude", modelId: "opus" }, investigate: { runnerId: "claude", modelId: "fast" } } }),
        options: { rolePrompt: (member, context) => { contexts.push({ member, context }); return "role"; } } });
      const id = await t.create(); await t.run({ type: "prompt.send", text: "start" }, id);
      await waitFor(() => t.driver.turns.length === 1, PROGRESS_TIMEOUT_MS, "lead");
      const grant = grantFor(t, id);
      const taskId = (await t.manager.callTaskTool(grant, "deck_delegate", { agent: "investigate", task: "Inspect token=prompt-secret\nDo not include this second line" }) as any).data.taskId;
      await waitFor(() => t.driver.turns.length === 2, PROGRESS_TIMEOUT_MS, "child");
      expect(contexts.find(c => c.member === "investigate")?.context.tasks).toBeUndefined();
      expect(await t.manager.callTaskTool(grant, "deck_task_list", {})).toMatchObject({ ok: true, data: { tasks: [{ taskId, memberId: "investigate", state: "running", attempt: 1, runnerId: "claude", modelId: "fast", continuable: false, summary: "Inspect token=[redacted]" }] } });
      expect(await t.manager.callTaskTool(grantFor(t, id, taskId), "deck_task_list", {})).toMatchObject({ ok: false, code: "tool-not-allowed" });
      const child = lastTurn(t.driver);
      child.say("Result password=result-secret " + "x".repeat(200));
      if (terminal === "cancelled") await t.manager.callTaskTool(grant, "deck_task_cancel", { taskId });
      else child.finish({ status: terminal });
      await waitFor(() => child.closed && t.events(id).some(e => e.kind === "task.state" && e.source.taskId === taskId && e.data.state === terminal), PROGRESS_TIMEOUT_MS, "terminal child");
      const listed = await t.manager.callTaskTool(grant, "deck_task_list", {});
      expect(listed).toMatchObject({ ok: true, data: { tasks: [{ taskId, state: terminal, continuable: true }] } });
      const summary = (listed as any).data.tasks[0].summary;
      expect(summary.length).toBeLessThanOrEqual(120);
      expect(summary).toContain("password=[redacted]");
      expect(JSON.stringify(listed)).not.toContain("result-secret");
      await t.run({ type: "prompt.send", text: "follow up" }, id);
      t.driver.turns[0]!.finish();
      await waitFor(() => contexts.some(c => c.member === "lead" && c.context.tasks?.length === 1), PROGRESS_TIMEOUT_MS, "lead roster");
      const roster = contexts.find(c => c.member === "lead" && c.context.tasks?.length === 1)!.context.tasks;
      expect(roster).toEqual([{ taskId, memberId: "investigate", state: terminal, attempt: 1, summary }]);
      await waitFor(() => t.driver.turns.length === 3, PROGRESS_TIMEOUT_MS, "next lead turn");
      const currentGrant = grantFor(t, id);
      expect((await t.manager.callTaskTool(currentGrant, "deck_delegate", { agent: "investigate", task: "feedback", continueTaskId: taskId })).ok).toBe(true);
      expect(await t.manager.callTaskTool(currentGrant, "deck_task_list", {})).toMatchObject({
        ok: true, data: { tasks: [{ taskId, attempt: 2, continuable: false, summary }] },
      });
    });
  }

  test("task roster and deck_task_list are bounded and omit question and answer data", async () => {
    const config = baseConfig({ members: { lead: { runnerId: "claude", modelId: "opus" }, investigate: { runnerId: "claude", modelId: "fast" } } });
    const t = setup({ config }); const id = await t.create();
    const drafts: any[] = [];
    for (let i = 0; i < 55; i++) {
      const taskId = `fixture-${i}`, source = { taskId, memberId: i === 54 ? "missing-owner" : "investigate", runnerId: "claude" };
      drafts.push(
        { kind: "task.created", source, data: { taskId, memberId: source.memberId, runnerId: "claude", modelId: "fast", state: i === 53 ? "ownership-unsettled" : i === 52 ? "queued" : "completed" } },
        { kind: "message.completed", source, data: { role: "user", text: `Inspect ${i} token=fixture-secret\nPrivate second line` } },
        { kind: "question.requested", source, data: { questionId: `q-${i}`, questions: [{ question: "Private question data" }] } },
        { kind: "question.resolved", source, data: { questionId: `q-${i}`, outcome: "answered", by: "fixture", answers: { value: ["Private answer data"] } } },
      );
    }
    t.manager.openLog(id)!.appendMany(drafts); await t.manager.close();
    const contexts: any[] = [];
    const reopened = setup({ dir: t.dir, config, options: { rolePrompt: (_member, context) => { contexts.push(context); return "role"; } } });
    await reopened.run({ type: "prompt.send", text: "recover roster" }, id);
    await waitFor(() => reopened.driver.turns.length === 1, PROGRESS_TIMEOUT_MS, "reopened lead");
    const roster = contexts.at(-1).tasks;
    expect(roster).toHaveLength(50);
    expect(roster[0].taskId).toBe("fixture-5");
    expect(roster.at(-1).taskId).toBe("fixture-54");
    const listed = await reopened.manager.callTaskTool(grantFor(reopened, id), "deck_task_list", {});
    expect(listed.ok).toBe(true);
    const tasks = (listed as any).data.tasks;
    expect(tasks).toHaveLength(50);
    expect(tasks[0].taskId).toBe("fixture-52");
    expect(tasks.find((task: any) => task.taskId === "fixture-52").continuable).toBe(false);
    expect(tasks.find((task: any) => task.taskId === "fixture-53").continuable).toBe(false);
    expect(tasks.find((task: any) => task.taskId === "fixture-54").continuable).toBe(false);
    const text = JSON.stringify({ roster, listed });
    for (const secret of ["fixture-secret", "Private second line", "Private question data", "Private answer data"]) expect(text).not.toContain(secret);
  });

  for (const [first, next] of [["investigate", "deck-investigate"], ["deck-investigate", "investigate"]]) {
    test(`delegation canonicalizes ${first} and continues with ${next}`, async () => {
      const promptMembers: Array<readonly string[] | undefined> = [];
      const t = setup({ config: baseConfig({ members: { lead: { runnerId: "claude", modelId: "opus" }, investigate: { runnerId: "claude", modelId: "fast" } } }), options: { rolePrompt: (_member, context) => { promptMembers.push(context.delegableMembers); return "role"; } } });
      const id = await t.create(); await t.run({ type: "prompt.send", text: "Start" }, id);
      await waitFor(() => t.driver.turns.length === 1, PROGRESS_TIMEOUT_MS, "lead");
      expect(promptMembers.at(-1)).toEqual(["investigate"]);
      const grant = grantFor(t, id);
      for (const agent of ["lead", "deck-lead"]) expect((await t.manager.callTaskTool(grant, "deck_delegate", { agent, task: "invalid" })).ok).toBe(false);
      const bridge = new BridgeService({ credentials: t.credentials, broker: t.broker, status: g => t.manager.taskStatus(g), callTaskTool: (g, name, args, context) => t.manager.callTaskTool(g, name, args, context) });
      const token = JSON.parse(readFileSync(sessionPaths(t.paths, id).taskCredentialFile("lead"), "utf8")).token;
      const unknown = await bridge.call({ token, tool: "deck_delegate", arguments: { agent: "missing", task: "inspect" } });
      expect(unknown).toMatchObject({ ok: false, code: "member-not-assigned", message: "Unknown member 'missing'. Delegable members: investigate" });
      const input = new PassThrough();
      const replies: any[] = [];
      const done = runSessionMcpBridge({
        input, write: line => { replies.push(JSON.parse(line)); }, version: "test",
        env: { DECK_SESSION_CREDENTIAL_FILE: sessionPaths(t.paths, id).taskCredentialFile("lead") },
        connect: async () => ({
          closed: new Promise(() => {}), close() {},
          request: async (frame: any) => ({ t: "bridge.result", outcome: await bridge.call(frame) }),
        } as unknown as ControlClient),
      });
      input.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "deck_delegate", arguments: { agent: "missing", task: "inspect" } } }) + "\n");
      try {
        await waitFor(() => replies.length === 1, PROGRESS_TIMEOUT_MS, "MCP error");
        expect(replies[0].result).toMatchObject({ isError: true, content: [{ type: "text", text: "deck bridge error: member-not-assigned (Unknown member 'missing'. Delegable members: investigate)" }] });
      } finally { input.end(); await done; }

      const delegated = await t.manager.callTaskTool(grant, "deck_delegate", { agent: first, task: "inspect" });
      expect(delegated.ok).toBe(true);
      if (!delegated.ok) return;
      const taskId = (delegated.data as { taskId: string }).taskId;
      await waitFor(() => t.driver.turns.length === 2, PROGRESS_TIMEOUT_MS, "child");
      const child = lastTurn(t.driver); child.finish();
      await waitFor(() => child.closed, PROGRESS_TIMEOUT_MS, "child closed");
      expect(t.events(id).find(e => e.kind === "task.created" && e.source?.taskId === taskId)?.source?.memberId).toBe("investigate");
      expect((await t.manager.callTaskTool(grant, "deck_delegate", { agent: next, task: "continue", continueTaskId: taskId })).ok).toBe(true);
    });
  }

  test("exact prefixed member wins after a stripped member is added, including continuation", async () => {
    const t = setup({ config: baseConfig({ members: { lead: { runnerId: "claude", modelId: "opus" }, "deck-investigate": { runnerId: "claude", modelId: "original" } } }) });
    const id = await t.create(); await t.run({ type: "prompt.send", text: "Start" }, id);
    await waitFor(() => t.driver.turns.length === 1);
    const grant = grantFor(t, id);
    const first = await t.manager.callTaskTool(grant, "deck_delegate", { agent: "deck-investigate", task: "inspect" });
    expect(first.ok).toBe(true); if (!first.ok) return;
    const taskId = (first.data as { taskId: string }).taskId;
    await waitFor(() => t.driver.turns.length === 2);
    const child = lastTurn(t.driver); child.finish(); await waitFor(() => child.closed);
    t.state.config!.members.investigate = { runnerId: "claude", modelId: "other" };
    expect(await t.manager.callTaskTool(grant, "deck_delegate", { agent: "deck-investigate", task: "continue", continueTaskId: taskId })).toMatchObject({ ok: true });
    await waitFor(() => t.driver.turns.length === 3);
    expect(lastTurn(t.driver).input).toMatchObject({ memberId: "deck-investigate", assignment: { modelId: "original" } });
    expect(await t.manager.callTaskTool(grant, "deck_delegate", { agent: "deck-investigate", task: "new" })).toMatchObject({ ok: true });
    await waitFor(() => t.driver.turns.length === 4);
    expect(lastTurn(t.driver).input).toMatchObject({ memberId: "deck-investigate", assignment: { modelId: "original" } });
    for (const agent of ["lead", "deck-lead"]) expect(await t.manager.callTaskTool(grant, "deck_delegate", { agent, task: "invalid" })).toMatchObject({ ok: false });
  });

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
    expect(input.mcp.sessionTools).toEqual(["deck_delegate", "deck_task_wait", "deck_task_result", "deck_task_cancel", "deck_task_list", "deck_task_integrate", "deck_decision_open", "deck_decision_list", "deck_decision_revise", "deck_decision_resolve", "deck_memory_recall", "deck_memory_propose", "deck_approve", "deck_status"]);
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

  test("native delegation is disabled and legacy runner-default config cannot bypass session approvals", async () => {
    const t = setup({ config: baseConfig({ approvals: { claude: "runner-default" } }) });
    const sessionId = await t.create();
    await t.run({ type: "prompt.send", text: "go" }, sessionId);
    expect(lastTurn(t.driver).input.approvals).toBe("relay");
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
    expect(next.driver.turns).toHaveLength(0);await next.runWithId("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",{type:"prompt.resume"},id);await waitFor(()=>next.driver.turns.length===1);
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


describe("structured agent questions", () => {
  const questions = [{ id: "q1", prompt: "Choose", options: [{ label: "A" }], multiple: false, allowOther: true, secret: true }];
  async function asking() {
    const t = setup(); const id = await t.create();
    await t.run({ type: "prompt.send", text: "ask me" }, id);
    await waitFor(() => t.driver.turns.length === 1, PROGRESS_TIMEOUT_MS, "question turn");
    return { t, id, turn: lastTurn(t.driver) };
  }
  test("ask, ledger projection, invalid answer, session isolation, answer receipt and dismiss", async () => {
    const { t, id, turn } = await asking();
    const answer = turn.ask(questions, "question-1");
    const requested = t.events(id).find(e => e.kind === "question.requested")!;
    expect(requested.data).toMatchObject({ questionId: "question-1", questions });
    const projection = Ledger.empty(id); for (const e of t.events(id)) projection.apply(e);
    expect(projection.pendingQuestions()).toHaveLength(1);
    expect((await t.manager.query("sessions.list", {}) as any).data.sessions.find((s: any) => s.sessionId === id).leadActivity.pendingQuestions).toBe(1);
    expect(await t.run({ type: "question.answer", questionId: "question-1", answers: {} }, id)).toMatchObject({ ok: false, code: "question-answers-invalid" });
    expect(t.manager.questionBroker.pending()).toHaveLength(1);
    const other = await t.create();
    expect(await t.run({ type: "question.answer", questionId: "question-1", answers: { q1: ["secret-answer"] } }, other)).toMatchObject({ ok: false, code: "unknown-question" });
    const commandId = "00000000-0000-4000-8000-999999999999";
    const command = { type: "question.answer" as const, questionId: "question-1", answers: { q1: ["secret-answer"] } };
    expect((await t.runWithId(commandId, command, id)).ok).toBe(true);
    expect(await answer).toEqual({ outcome: "answered", answers: { q1: ["secret-answer"] } });
    expect(await t.runWithId(commandId, command, id)).toMatchObject({ ok: true, duplicate: true });
    expect(t.events(id).find(e => e.kind === "question.resolved")?.data).toEqual({ questionId: "question-1", outcome: "answered", by: "c-1" });
    expect(JSON.stringify(t.events(id))).not.toContain("secret-answer");
    expect(t.events(id).some(e => Object.hasOwn(e.data, "answers"))).toBe(false);
    expect((await t.manager.query("sessions.list", {}) as any).data.sessions.find((s: any) => s.sessionId === id).leadActivity.pendingQuestions).toBe(0);
    const dismissed = turn.ask(questions, "question-2");
    expect((await t.run({ type: "question.dismiss", questionId: "question-2" }, id)).ok).toBe(true);
    expect(await dismissed).toEqual({ outcome: "dismissed" });
    const ended = turn.ask(questions, "question-3"); turn.finish(); await t.idle();
    expect(await ended).toEqual({ outcome: "cancelled" });
  });
  test("pending questions rebuild from the log on reattach and recovery cancels them", async () => {
    const { t, id, turn } = await asking();
    const answer = turn.ask(questions, "recover-question");
    t.manager.openLog(id)!.flush();
    const dir = tempDir(); const paths = resolveStatePaths({ env: { HOME: dir, XDG_STATE_HOME: join(dir, "state") }, tmpdir: dir });
    ensureStateLayout(paths); cpSync(t.paths.sessionsDir, paths.sessionsDir, { recursive: true });
    const sp = sessionPaths(paths, id);
    const log = EventLog.open({ dir: sp.eventsDir, sessionId: id });
    try { expect(loadLedger(log, sp.ledgerSnapshotFile).ledger.pendingQuestions()).toMatchObject([{ questionId: "recover-question", questions }]); } finally { log.close(); }
    const report = recoverAllSessions({ paths, probe: createNodeProbe() });
    expect(report.sessions.find(s => s.sessionId === id)?.questionsCancelled).toEqual(["recover-question"]);
    const recovered = EventLog.open({ dir: sp.eventsDir, sessionId: id });
    try {
      expect(loadLedger(recovered, sp.ledgerSnapshotFile).ledger.pendingQuestions()).toEqual([]);
      expect([...recovered.readAfter(0)].find(e => e.kind === "question.resolved")?.data).toEqual({ questionId: "recover-question", outcome: "cancelled", by: "daemon-restart" });
    } finally { recovered.close(); }
    turn.finish(); await t.idle(); expect(await answer).toEqual({ outcome: "cancelled" });
  });
  test.each(["turn.interrupt", "task.cancel", "session.stop", "session.release"] as const)("%s cancels questions immediately", async type => {
    const { t, id, turn } = await asking(); turn.onInterrupt = undefined;
    const answer = turn.ask(questions);
    const command = type === "turn.interrupt" || type === "task.cancel" ? { type, taskId: turn.input.taskId } : { type };
    expect((await t.run(command, id)).ok).toBe(true);
    expect(await answer).toEqual({ outcome: "cancelled" });
    turn.finish(); await t.idle();
  });
});

describe("per-session approval mode", () => {
  const row = async (t: ReturnType<typeof setup>, id: string) => (await t.manager.query("sessions.list", {}) as any).data.sessions.find((s: any) => s.sessionId === id);
  test.each(["relay", "yolo"] as const)("create persists %s and reports it in summaries", async mode => {
    const t = setup();
    const result = await t.run({ type: "session.create", projectRoot: t.project, approvals: mode } as any);
    const id = (result as any).data.sessionId;
    expect(t.events(id).find(e => e.kind === "session.created")?.data.approvals).toBe(mode);
    expect(JSON.parse(readFileSync(sessionPaths(t.paths, id).sessionFile, "utf8")).approvals).toBe(mode);
    const summary = await row(t, id);
    expect(summary).toMatchObject({ approvalMode: mode, approvalModeSource: "session" });
    expect(await t.manager.query("sessions.status", { projectId: summary.projectId, sessionIds: [id] })).toMatchObject({ data: { sessions: [{ approvalMode: mode, approvalModeSource: "session" }] } });
    await t.run({ type: "prompt.send", text: "first" }, id);
    await waitFor(() => t.driver.turns.length === 1, PROGRESS_TIMEOUT_MS, "first turn");
    expect(lastTurn(t.driver).input.approvals).toBe(mode === "yolo" ? "runner-default" : "relay");
    lastTurn(t.driver).finish(); await t.idle();
  });
  test("switches both ways during a turn, applies next turn to Lead and subagents, and receipts no-ops", async () => {
    const t = setup({ config: baseConfig({ members: { lead: { runnerId: "claude", modelId: "opus" }, investigate: { runnerId: "claude", modelId: "fast" } } }) });
    const id = (await t.run({ type: "session.create", projectRoot: t.project, approvals: "relay" } as any) as any).data.sessionId;
    await t.run({ type: "prompt.send", text: "first" }, id); await waitFor(() => t.driver.turns.length === 1, PROGRESS_TIMEOUT_MS, "first");
    const first = lastTurn(t.driver); first.init();
    const set = { type: "session.setApprovals", mode: "yolo" } as any;
    const commandId = "00000000-0000-4000-8000-888888888881";
    expect((await t.runWithId(commandId, set, id)).ok).toBe(true);
    expect(first.input.approvals).toBe("relay");
    expect(await t.runWithId(commandId, set, id)).toMatchObject({ ok: true, duplicate: true });
    expect((await t.run(set, id)).ok).toBe(true);
    expect(t.events(id).filter(e => e.kind === "session.approvals")).toHaveLength(1);
    const grant = t.credentials.lookup(JSON.parse(readFileSync(first.input.credentialFile, "utf8")).token)!;
    expect((await t.manager.callTaskTool(grant, "deck_delegate", { agent: "investigate", task: "check" })).ok).toBe(true);
    await waitFor(() => t.driver.turns.length === 2, PROGRESS_TIMEOUT_MS, "child");
    expect(lastTurn(t.driver).input.approvals).toBe("runner-default"); lastTurn(t.driver).finish();
    // Stop the Lead before another user turn; the pending child notice may create a wake turn.
    await t.run({ type: "session.setApprovals", mode: "relay" } as any, id);
    expect((await row(t, id)).approvalMode).toBe("relay");
    expect(first.input.approvals).toBe("relay");
    first.finish(); await waitFor(() => first.closed, PROGRESS_TIMEOUT_MS, "first close");
    t.driver.autoComplete = true;
    for (const turn of t.driver.turns) if (!turn.finished) turn.finish();
    await t.idle();
    await t.run({ type: "prompt.send", text: "next" }, id); await t.idle();
    expect(lastTurn(t.driver).input.approvals).toBe("relay");
    expect(t.events(id).filter(e => e.kind === "session.approvals").map(e => e.data)).toEqual([{ mode: "yolo", by: "c-1" }, { mode: "relay", by: "c-1" }]);
  });
  test("Lead snapshots the selected mode independently on every turn", async () => {
    const t = setup(); const id = await t.create();
    const launch = async (count: number) => {
      await t.run({ type: "prompt.send", text: `turn ${count}` }, id);
      await waitFor(() => t.driver.turns.length === count, PROGRESS_TIMEOUT_MS, "Lead turn");
      const turn = lastTurn(t.driver); turn.init(); return turn;
    };
    const first = await launch(1);
    await t.run({ type: "session.setApprovals", mode: "yolo" }, id);
    expect(first.input.approvals).toBe("relay"); first.finish(); await t.idle();
    const second = await launch(2);
    expect(second.input.approvals).toBe("runner-default");
    await t.run({ type: "session.setApprovals", mode: "relay" }, id);
    expect(second.input.approvals).toBe("runner-default"); second.finish(); await t.idle();
    const third = await launch(3);
    expect(third.input.approvals).toBe("relay"); third.finish(); await t.idle();
  });
  test("missing runner config defaults to relay and invalid/removed updates are rejected", async () => {
    const t = setup(); delete t.state.config!.approvals.claude;
    const id = await t.create();
    expect(await row(t, id)).toMatchObject({ approvalMode: "relay", approvalModeSource: "default" });
    await t.run({ type: "prompt.send", text: "fallback" }, id);
    await waitFor(() => t.driver.turns.length === 1, PROGRESS_TIMEOUT_MS, "fallback turn");
    expect(lastTurn(t.driver).input.approvals).toBe("relay"); lastTurn(t.driver).finish(); await t.idle();
    expect(await t.run({ type: "session.setApprovals", mode: "invalid" } as any, id)).toMatchObject({ ok: false, code: "approval-mode-invalid" });
    expect((await row(t, id)).approvalModeSource).toBe("default");
    await t.run({ type: "session.remove" }, id);
    expect(await t.run({ type: "session.setApprovals", mode: "relay" }, id)).toMatchObject({ ok: false, code: "session-removed" });
  });
  test("create idempotency includes explicit mode and creation-only mode replays", async () => {
    const t = setup(); const commandId = crypto.randomUUID();
    const create = { type: "session.create" as const, projectRoot: t.project, approvals: "yolo" as const };
    const result = await t.runWithId(commandId, create); const id = (result as any).data.sessionId;
    expect(await t.runWithId(commandId, create)).toMatchObject({ ok: true, duplicate: true });
    expect(await t.runWithId(commandId, { ...create, approvals: "relay" })).toMatchObject({ ok: false, code: "command-id-reused" });
    const ledger = Ledger.empty(id); for (const event of t.events(id)) ledger.apply(event);
    expect(ledger.session.approvals).toBe("yolo");
    await t.run({ type: "session.setApprovals", mode: "yolo" }, id);
    expect(t.events(id).filter(e => e.kind === "session.approvals")).toHaveLength(0);
    expect(t.events(id).filter(e => e.kind === "command.accepted" && e.data.type === "session.setApprovals")).toHaveLength(1);
  });
  test("new and reattached legacy sessions relay despite runner-default config", async () => {
    const config = baseConfig({ approvals: { claude: "runner-default", codex: "runner-default", opencode: "runner-default" } });
    const t = setup({ config }); const id = await t.create();
    expect(await row(t, id)).toMatchObject({ approvalMode: "relay", approvalModeSource: "default" });
    const summary = await row(t, id);
    expect(await t.manager.query("sessions.status", { projectId: summary.projectId, sessionIds: [id] })).toMatchObject({ data: { sessions: [{ approvalMode: "relay", approvalModeSource: "default" }] } });
    await t.manager.close(); rmSync(sessionPaths(t.paths, id).ledgerSnapshotFile, { force: true });
    recoverAllSessions({ paths: t.paths, probe: createNodeProbe() });
    const reopened = setup({ dir: t.dir, config });
    expect(await row(reopened, id)).toMatchObject({ approvalMode: "relay", approvalModeSource: "default" });
    await reopened.runWithId(crypto.randomUUID(), { type: "prompt.send", text: "legacy turn" }, id);
    await waitFor(() => reopened.driver.turns.length === 1, PROGRESS_TIMEOUT_MS, "legacy relay");
    expect(lastTurn(reopened.driver).input.approvals).toBe("relay"); lastTurn(reopened.driver).finish(); await reopened.idle();
    await reopened.runWithId(crypto.randomUUID(), { type: "session.stop" }, id);
    const continued = await reopened.runWithId(crypto.randomUUID(), { type: "session.continue" }, id);
    const nextId = (continued as any).data.sessionId;
    expect(await row(reopened, nextId)).toMatchObject({ approvalMode: "relay", approvalModeSource: "default" });
    expect(reopened.events(nextId).find(e => e.kind === "session.created")?.data).not.toHaveProperty("approvals");
  });
  test("legacy config is ignored, explicit overrides survive recovery and continuation", async () => {
    const t = setup(); const id = await t.create();
    expect(await row(t, id)).toMatchObject({ approvalMode: "relay", approvalModeSource: "default" });
    t.state.config!.approvals.claude = "runner-default";
    expect(await row(t, id)).toMatchObject({ approvalMode: "relay", approvalModeSource: "default" });
    expect((await t.run({ type: "session.setApprovals", mode: "yolo" } as any, id)).ok).toBe(true);
    t.state.config!.approvals.claude = "relay";
    await t.manager.close();
    rmSync(sessionPaths(t.paths, id).ledgerSnapshotFile, { force: true });
    recoverAllSessions({ paths: t.paths, probe: createNodeProbe() });
    const reopened = setup({ dir: t.dir });
    expect(await row(reopened, id)).toMatchObject({ approvalMode: "yolo", approvalModeSource: "session" });
    await reopened.run({ type: "session.stop" }, id);
    expect(await reopened.runWithId(crypto.randomUUID(), { type: "session.setApprovals", mode: "relay" }, id)).toMatchObject({ ok: false, code: "session-ended" });
    const next = await reopened.runWithId(crypto.randomUUID(), { type: "session.continue" }, id);
    expect(await row(reopened, (next as any).data.sessionId)).toMatchObject({ approvalMode: "yolo", approvalModeSource: "session" });
    const legacy = await reopened.create(); await reopened.run({ type: "session.stop" }, legacy);
    const continued = await reopened.run({ type: "session.continue" }, legacy);
    expect(await row(reopened, (continued as any).data.sessionId)).toMatchObject({ approvalMode: "relay", approvalModeSource: "default" });
  });
});

test("public question answers replay while mixed secret answers never enter durable state or diagnostics", async () => {
  const diagnostics: unknown[] = [];
  const record = (...values: unknown[]) => { diagnostics.push(values); };
  const t = setup({ options: { logger: { info: record, warn: record, error: record } } }); const id = await t.create();
  await t.run({ type: "prompt.send", text: "ask a mixed question" }, id);
  await waitFor(() => t.driver.turns.length === 1, PROGRESS_TIMEOUT_MS, "mixed question turn");
  const turn = lastTurn(t.driver);
  const q = { prompt: "Input", options: [], multiple: false, allowOther: true };
  const answer = turn.ask([{ ...q, id: "public", secret: false }, { ...q, id: "private", secret: true }], "mixed-record");
  const secret = "SECRET_DURABLE_QUESTION_SENTINEL";
  const commandId = crypto.randomUUID();
  const command = { type: "question.answer" as const, questionId: "mixed-record", answers: { public: ["visible conversation answer"], private: [secret] } };
  expect((await t.runWithId(commandId, command, id)).ok).toBe(true);
  expect(await answer).toEqual({ outcome: "answered", answers: command.answers });
  const resolution = t.events(id).find(e => e.kind === "question.resolved")!;
  expect(resolution.data).toEqual({ questionId: "mixed-record", outcome: "answered", by: "c-1", answers: { public: ["visible conversation answer"] } });
  const receipt = t.events(id).find(e => e.kind === "command.accepted" && e.data.commandId === commandId)!;
  expect(receipt.data).toEqual({ commandId, type: "question.answer", outcome: { ok: true } });
  expect(JSON.stringify(receipt)).not.toContain("visible conversation answer");
  expect(JSON.stringify(t.events(id))).not.toContain(secret);
  turn.finish(); await t.idle(); await t.manager.close();
  const sp = sessionPaths(t.paths, id);
  const jsonl = readdirSync(sp.eventsDir).filter(name => name.endsWith(".jsonl")).map(name => readFileSync(join(sp.eventsDir, name), "utf8")).join("\n");
  expect(jsonl).toContain("visible conversation answer"); expect(jsonl).not.toContain(secret);
  const scan = (dir: string): void => { for (const item of readdirSync(dir, { withFileTypes: true })) { const path = join(dir, item.name); if (item.isDirectory()) scan(path); else if (item.isFile()) expect(readFileSync(path, "utf8")).not.toContain(secret); } };
  scan(t.dir); expect(JSON.stringify(diagnostics)).not.toContain(secret);
  rmSync(sp.ledgerSnapshotFile, { force: true }); recoverAllSessions({ paths: t.paths, probe: createNodeProbe() });
  const reopened = setup({ dir: t.dir });
  expect(reopened.events(id).find(e => e.kind === "question.resolved")).toEqual(resolution);
  expect(await reopened.runWithId(commandId, command, id)).toMatchObject({ ok: true, duplicate: true });
  expect(reopened.events(id).filter(e => e.kind === "question.resolved")).toHaveLength(1);
  expect(JSON.stringify(reopened.events(id))).not.toContain(secret);
  await reopened.manager.close(); scan(t.dir);
});

describe("session approval grants", () => {
  const row = async (t: ReturnType<typeof setup>, id: string) => (await t.manager.query("sessions.list", {}) as any).data.sessions.find((s: any) => s.sessionId === id);
  const request = { approvalId: "native", tool: "Bash", toolKey: "claude:Bash", exactKey: "ls", identity: "ls", risk: "high" as const };
  test("session scope reaches driver as once, auto-approves all members and is revocable with receipts", async () => {
    const t = setup(); const id = await t.create(); await t.run({ type: "prompt.send", text: "permissions" }, id);
    await waitFor(() => t.driver.turns.length === 1, PROGRESS_TIMEOUT_MS, "approval turn");
    const turn = lastTurn(t.driver); const answer = turn.io.approval(request);
    const pending = t.broker.pending()[0]!;
    expect(await t.run({ type: "approval.respond", approvalId: pending.approvalId, decision: "allow", scope: "session", grant: "tool" }, id)).toMatchObject({ ok: false, code: "approval-confirmation-required" });
    expect(t.broker.pending()).toHaveLength(1);
    expect((await t.run({ type: "approval.respond", approvalId: pending.approvalId, decision: "allow", scope: "session", grant: "exact" }, id)).ok).toBe(true);
    expect(await answer).toEqual({ decision: "allow", scope: "once" });
    const grants = (await row(t, id)).grants; expect(grants).toHaveLength(1);
    expect(grants[0]).not.toHaveProperty("matchKey");
    expect(t.events(id).find(e => e.kind === "session.grant")?.data.matchKey).toMatch(/^[a-f0-9]{64}$/);
    const summary = await row(t, id);
    expect(await t.manager.query("sessions.status", { projectId: summary.projectId, sessionIds: [id] })).toMatchObject({ data: { sessions: [{ grants }] } });
    const auto = t.broker.request({ ...request, sessionId: id, taskId: "child", memberId: "investigate", runnerId: "claude" });
    expect(await auto.resolution).toMatchObject({ decision: "allow-once", scope: "once", by: `session-grant:${grants[0].grantId}` });
    expect(t.events(id).at(-1)?.data).toMatchObject({ auto: true });
    const revokeId = crypto.randomUUID(); const revoke = { type: "session.revokeGrant" as const, grantId: grants[0].grantId };
    expect((await t.runWithId(revokeId, revoke, id)).ok).toBe(true);
    expect(await t.runWithId(revokeId, revoke, id)).toMatchObject({ ok: true, duplicate: true });
    expect((await row(t, id)).grants).toEqual([]);
    const again = turn.io.approval(request); expect(t.broker.pending()).toHaveLength(1);
    await t.run({ type: "approval.respond", approvalId: t.broker.pending()[0]!.approvalId, decision: "deny" }, id);
    expect(await again).toEqual({ decision: "deny", scope: "once" }); turn.finish(); await t.idle();
  });
  test("grants rebuild from ledger after restart and release clears them", async () => {
    const t = setup(); const id = await t.create();
    const pending = t.broker.request({ ...request, sessionId: id, taskId: "fixture", runnerId: "claude" });
    t.broker.respond({ approvalId: pending.approvalId, decision: "allow", scope: "session", grant: "exact", by: "u" }); await pending.resolution;
    expect(lstatSync(join(sessionPaths(t.paths, id).dir, "approval-session.key")).mode & 0o777).toBe(0o600);
    const sessionKey = readFileSync(join(sessionPaths(t.paths, id).dir, "approval-session.key")).toString("hex");
    expect(JSON.stringify(t.events(id))).not.toContain(sessionKey);
    await t.manager.close(); rmSync(sessionPaths(t.paths, id).ledgerSnapshotFile, { force: true }); recoverAllSessions({ paths: t.paths, probe: createNodeProbe() });
    const reopened = setup({ dir: t.dir }); expect((await row(reopened, id)).grants).toHaveLength(1);
    expect((await row(reopened, id)).grants[0]).not.toHaveProperty("matchKey");
    const auto = reopened.broker.request({ ...request, sessionId: id, taskId: "fixture2", runnerId: "claude" });
    expect((await auto.resolution).by).toStartWith("session-grant:");
    await reopened.runWithId(crypto.randomUUID(), { type: "session.release" }, id);
    expect((await row(reopened, id)).grants).toEqual([]);
    const later = reopened.broker.request({ ...request, sessionId: id, taskId: "fixture3", runnerId: "claude" });
    expect(reopened.broker.pending()).toHaveLength(1); reopened.broker.cancel(later.approvalId, "test"); await later.resolution;
  });
  test("native always reaches only advertised drivers and legacy requests offer once", async () => {
    const t = setup(); const id = await t.create(); await t.run({ type: "prompt.send", text: "native scope" }, id);
    await waitFor(() => t.driver.turns.length === 1, PROGRESS_TIMEOUT_MS, "native turn");
    const answer = lastTurn(t.driver).io.approval({ ...request, nativeScopes: ["always"], alwaysNote: "Native test policy" });
    const pending = t.broker.pending()[0]!;
    await t.run({ type: "approval.respond", approvalId: pending.approvalId, decision: "allow", scope: "always", confirmed: true }, id);
    expect(await answer).toEqual({ decision: "allow", scope: "always" });
    expect((await row(t, id)).grants).toEqual([]);
    lastTurn(t.driver).finish(); await t.idle();
  });
});

test.each(["session.stop", "session.remove"] as const)("%s clears grants from the ledger", async type => {
  const t = setup(); const id = await t.create();
  const request = t.broker.request({ sessionId: id, taskId: "fixture", runnerId: "claude", tool: "Read", toolKey: "claude:Read", risk: "normal" });
  t.broker.respond({ approvalId: request.approvalId, decision: "allow", scope: "session", grant: "tool", by: "u" }); await request.resolution;
  expect(t.broker.grants(id)).toHaveLength(1);
  expect((await t.runWithId(crypto.randomUUID(), { type }, id)).ok).toBe(true);
  expect(t.broker.grants(id)).toEqual([]);
});

test("WebFetch credential URLs never survive approval or grant persistence", async () => {
  const t = setup(); const id = await t.create();
  const url = "https://url-user:url-pass@example.com/page?token=url-token&sig=url-sig&view=full";
  const request = t.broker.request({ sessionId: id, taskId: "fixture", tool: "WebFetch", runnerId: "claude", toolKey: "claude:WebFetch", identity: url, exactKey: url, summary: `Fetch ${url}`, input: { url }, risk: "high" });
  expect(t.broker.respond({ approvalId: request.approvalId, decision: "allow", scope: "session", grant: "exact", by: "u" }).ok).toBe(true);
  await request.resolution;
  const events = t.events(id);
  const approval = events.find(e => e.kind === "approval.requested")!;
  expect(approval.data.exactKey).toBe("https://[redacted]@example.com/page?token=[redacted]&sig=[redacted]&view=full");
  expect(JSON.stringify(approval.data.input)).toContain("view=full");
  const grant = t.broker.grants(id)[0]!;
  t.broker.revokeGrant(id, grant.grantId, "u");
  const files = readdirSync(sessionPaths(t.paths, id).eventsDir);
  const persisted = files.map(file => readFileSync(join(sessionPaths(t.paths, id).eventsDir, file), "utf8")).join("\n");
  for (const secret of ["url-user", "url-pass", "url-token", "url-sig", '"identity"']) expect(persisted).not.toContain(secret);
  expect(events.filter(e => e.kind !== "session.grant").every(e => !("matchKey" in e.data))).toBe(true);
  expect(events.find(e => e.kind === "session.grant")!.data.matchKey).toMatch(/^[a-f0-9]{64}$/);
});

test.each([
  ["userinfo", "https://alice:prefix@SYNTHETIC_PASSWORD@internal.example/status?view=full", "SYNTHETIC_PASSWORD"],
  ["encoded query", "https://internal.example/status?%73ig=SYNTHETIC_SIG&view=full", "SYNTHETIC_SIG"],
])("URL credential regression persists no secrets: %s", async (_label, url, secret) => {
  const t = setup(); const id = await t.create();
  const pending = t.broker.request({ sessionId: id, taskId: "fixture", runnerId: "claude", tool: "WebFetch", toolKey: "claude:WebFetch", identity: url, exactKey: url, summary: url, input: { url }, risk: "high" });
  expect(t.broker.respond({ approvalId: pending.approvalId, decision: "allow", scope: "session", grant: "exact", by: "test" }).ok).toBe(true);
  await pending.resolution;
  t.broker.revokeGrant(id, t.broker.grants(id)[0]!.grantId, "test");
  const events = t.events(id);
  const approval = events.find(e => e.kind === "approval.requested")!;
  for (const value of [approval.data.summary, approval.data.input, approval.data.exactKey, ...events.filter(e => e.kind === "session.grant").map(e => e.data)]) {
    expect(JSON.stringify(value)).not.toContain(secret!);
    expect(JSON.stringify(value)).toContain("view=full");
  }
  await t.manager.close();
  const eventsDir = sessionPaths(t.paths, id).eventsDir;
  const disk = readdirSync(eventsDir).map(file => readFileSync(join(eventsDir, file), "utf8")).join("\n");
  expect(disk).not.toContain(secret!);
});


describe("Stage 2 durable decisions", () => {
  async function decisionSession() {
    const t = setup({ config: baseConfig({ members: { lead: { runnerId: "claude", modelId: "opus" }, investigate: { runnerId: "claude", modelId: "fast" } } }), options: { clock: new FakeClock() } });
    const id = await t.create(); const sent = await t.run({ type: "prompt.send", text: "Plan the change" }, id); await waitFor(() => t.driver.turns.length === 1); lastTurn(t.driver).init();
    const call = (name: string, args: Record<string, unknown>) => t.manager.callTaskTool(t.credentials.lookup(JSON.parse(readFileSync(sessionPaths(t.paths, id).taskCredentialFile("lead"), "utf8")).token)!, name, args);
    const open = () => call("deck_decision_open", { commandId: "open-1", key: "scope", question: "May the change proceed?", source: { promptId: (sent as any).data.promptId } });
    return { t, id, call, open, promptId: (sent as any).data.promptId };
  }
  test("all mutation kinds share durable command identity in both directions and after eviction/replay", async () => {
    const {t,id,call,open,promptId}=await decisionSession();await open();
    const taskId=(await call("deck_delegate",{agent:"investigate",task:"Evidence"}) as any).data.taskId;await waitFor(()=>t.driver.turns.length===2);
    lastTurn(t.driver).say("report");lastTurn(t.driver).finish();await waitFor(()=>lastTurn(t.driver).closed);await call("deck_task_result",{taskId});
    const evidenceSeqs=[t.events(id).find(e=>e.kind==="task.result"&&e.source.taskId===taskId)!.seq];
    const input={commandId:"open-1",taskId,attempt:1,state:"integrated",note:"Reviewed",evidenceSeqs};
    expect(await call("deck_task_integrate",input)).toMatchObject({ok:false,code:"command-id-reused"});
    expect(await call("deck_task_integrate",{...input,commandId:"bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb"})).toMatchObject({ok:true});
    expect(await call("deck_decision_open",{commandId:"bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb",key:"collision",question:"Collision?",source:{promptId}})).toMatchObject({ok:false,code:"command-id-reused"});
    const generic="aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
    await t.runWithId(generic,{type:"session.bindChange",changeId:"cross-runner-session-core"},id);
    t.manager.openLog(id)!.appendMany(Array.from({length:1001},(_,i)=>({kind:"command.accepted" as const,data:{commandId:`identity-evict-${i}`,type:"fixture",outcome:{ok:true}}})));
    t.driver.turns[0]!.finish();await waitFor(()=>t.driver.turns[0]!.closed);await t.manager.close();
    const next=setup({dir:t.dir});await next.run({type:"prompt.send",text:"Continue identity checks"},id);await waitFor(()=>next.driver.turns.length===1);
    const grant=next.credentials.lookup(JSON.parse(readFileSync(sessionPaths(next.paths,id).taskCredentialFile("lead"),"utf8")).token)!;
    const invoke=(name:string,d:Record<string,unknown>)=>next.manager.callTaskTool(grant,name,d);
    expect(await invoke("deck_task_integrate",{...input,commandId:generic})).toMatchObject({ok:false,code:"command-id-reused"});
    expect(await invoke("deck_decision_open",{commandId:"bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb",key:"collision",question:"Collision?",source:{promptId}})).toMatchObject({ok:false,code:"command-id-reused"});
    expect(await invoke("deck_task_integrate",input)).toMatchObject({ok:false,code:"command-id-reused"});
    expect(await invoke("deck_task_integrate",{...input,commandId:"bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb"})).toMatchObject({ok:true,duplicate:true});
    expect(await next.runWithId("bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb",{type:"prompt.resume"},id)).toMatchObject({ok:false,code:"command-id-reused"});
    expect(await next.runWithId(generic,{type:"session.bindChange",changeId:"changed"},id)).toMatchObject({ok:false,code:"command-id-reused"});
    lastTurn(next.driver).finish();await waitFor(()=>lastTurn(next.driver).closed);
  });
  test("a stale targeted admitted reply cannot remove dependencies through production delegate", async () => {
    const {t,id,call,open}=await decisionSession();const decisionId=(await open() as any).data.decisionId;
    const taskId=(await call("deck_delegate",{agent:"investigate",task:"Independent preparation"}) as any).data.taskId;await waitFor(()=>t.driver.turns.length===2);
    const linked=(await call("deck_decision_open",{commandId:"held",key:"held",question:"May preparation continue?",source:{taskId,attempt:1}}) as any);
    // Link a terminal source only after it has actually completed.
    expect(linked.ok).toBe(false);lastTurn(t.driver).say("prepared");lastTurn(t.driver).finish();await waitFor(()=>lastTurn(t.driver).closed);await call("deck_task_result",{taskId});
    await call("deck_decision_open",{commandId:"held-valid",key:"held",question:"May preparation continue?",source:{taskId,attempt:1},relatedTaskIds:[taskId]});
    const sourceOnly=(await call("deck_decision_open",{commandId:"source-only",key:"source-only",question:"Question about a report, no task link",source:{taskId,attempt:1}}) as any).data.decisionId;
    expect((await t.manager.query("task.result",{sessionId:id,taskId}) as any).data.dependsOn).not.toContain(sourceOnly);
    const reply=await t.run({type:"prompt.send",text:"Yes to the old question",decisionTarget:{decisionId,revision:1}} as any,id);
    await call("deck_decision_revise",{commandId:"change-question",decisionId,expectedRevision:1,question:"A different question?",note:"Changed scope"});
    t.driver.turns[0]!.finish();await waitFor(()=>t.driver.turns.length===3);
    expect(await call("deck_delegate",{commandId:"stale-replan",agent:"investigate",task:"Must not launch",continueTaskId:taskId,dependsOn:[],replan:{promptId:(reply as any).data.promptId,note:"Invalid stale authority"}})).toMatchObject({ok:false,code:"decision-evidence-invalid"});
    expect(t.driver.turns).toHaveLength(3);expect(t.events(id).filter(e=>e.kind==="task.continued"&&e.source.taskId===taskId)).toHaveLength(0);
    lastTurn(t.driver).finish();await waitFor(()=>lastTurn(t.driver).closed);
  });
  for (const effect of ["decision", "replan"] as const) for (const fault of ["append", "flush"] as const) test(`${effect} ${fault} failure never acknowledges or launches, retained prefixes replay idempotently`, async () => {
    const {t,id,call,open}=await decisionSession();const decisionId=(await open() as any).data.decisionId;
    let taskId:string|undefined;
    if(effect==="replan"){
      taskId=(await call("deck_delegate",{agent:"investigate",task:"Prepare independent work"}) as any).data.taskId;await waitFor(()=>t.driver.turns.length===2);
      lastTurn(t.driver).say("Prepared");lastTurn(t.driver).finish();await waitFor(()=>lastTurn(t.driver).closed);await call("deck_task_result",{taskId});
      expect(await call("deck_decision_open",{commandId:"failure-gate",key:"failure-gate",question:"May this task continue?",source:{taskId,attempt:1},relatedTaskIds:[taskId]})).toMatchObject({ok:true});
      expect(await call("deck_delegate",{agent:"investigate",task:"Held continuation",continueTaskId:taskId})).toMatchObject({ok:false,code:"decision-dependency-blocked"});
    }
    t.driver.turns[0]!.finish();await waitFor(()=>t.driver.turns[0]!.closed);
    const reply=await t.run({type:"prompt.send",text:"Continue as independent work"},id);await waitFor(()=>t.driver.turns.length===(effect==="replan"?3:2));
    const input=effect==="decision" ? {commandId:"failed-answer",decisionId,expectedRevision:1,promptId:(reply as any).data.promptId,note:"Explicit informational answer",disposition:"informational"} : {commandId:"failed-replan",agent:"investigate",task:"Explicit independent continuation",continueTaskId:taskId,dependsOn:[],replan:{promptId:(reply as any).data.promptId,note:"User asked for independent continuation"}};
    const name=effect==="decision"?"deck_decision_resolve":"deck_delegate",log=t.manager.openLog(id)!,append=log.appendMany.bind(log),flush=log.flush.bind(log),before=t.driver.turns.length;
    // Simulate a retained committed first JSONL record followed by an append/flush error.
    if(fault==="append")log.appendMany=drafts=>{append(drafts.slice(0,1));throw Error("injected-prefix-append-failure");};
    else log.flush=()=>{throw Error("injected-flush-failure");};
    expect(await call(name,input)).toMatchObject({ok:false,code:"task-tool-failed"});
    log.appendMany=append;log.flush=flush;expect(t.driver.turns).toHaveLength(before);
    const events=t.events(id),mutation=events.find(e=>effect==="decision" ? e.kind==="decision.state" : e.kind==="task.continued" && e.source.taskId===taskId)!;
    expect(mutation).toBeDefined();
    for(let length=mutation.seq-1;length<=events.length;length++){
      const ledger=Ledger.empty(id);for(const event of events.slice(0,length))ledger.apply(event);
      expect(!!ledger.decisionCommand(input.commandId)).toBe(length>=mutation.seq);
      if(effect==="decision")expect(ledger.decision(decisionId)?.state).toBe(length>=mutation.seq?"answered":"pending");
    }
    lastTurn(t.driver).finish();await waitFor(()=>lastTurn(t.driver).closed);await t.manager.close();
    recoverAllSessions({paths:t.paths,probe:createNodeProbe()});
    const next=setup({dir:t.dir});await next.run({type:"prompt.send",text:"Inspect retained mutation"},id);expect(await next.runWithId("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",{type:"prompt.resume"},id)).toMatchObject({ok:true});await waitFor(()=>next.driver.turns.length===1);
    const grant=next.credentials.lookup(JSON.parse(readFileSync(sessionPaths(next.paths,id).taskCredentialFile("lead"),"utf8")).token)!;
    expect(await next.manager.callTaskTool(grant,name,input)).toMatchObject({ok:true,duplicate:true});
    expect(next.driver.turns).toHaveLength(1);
    expect(await next.manager.callTaskTool(grant,name,{...input,...(effect==="decision"?{note:"Changed answer"}:{task:"Changed work"})})).toMatchObject({ok:false,code:"command-id-reused"});
    lastTurn(next.driver).finish();await waitFor(()=>lastTurn(next.driver).closed);
  });
  for(const action of ["resolve","replan"] as const) test(`same-prompt native reseed cannot refresh ${action} authority`,async()=>{
    const {t,id,call}=await decisionSession();
    const childId=(await call("deck_delegate",{agent:"investigate",task:"Prepare independent evidence"}) as any).data.taskId;
    await waitFor(()=>t.driver.turns.length===2);lastTurn(t.driver).say("Prepared report");lastTurn(t.driver).finish();await waitFor(()=>lastTurn(t.driver).closed);await call("deck_task_result",{taskId:childId});
    t.driver.turns[0]!.finish();await waitFor(()=>t.driver.turns[0]!.closed);
    const sent=await t.run({type:"prompt.send",text:"Only one genuine scope message"},id),promptId=(sent as any).data.promptId;await waitFor(()=>t.driver.turns.length===3);
    const resumed=lastTurn(t.driver);expect(resumed.input.resume).toBeDefined();
    // Authenticated host tools can be called before native init; that cannot change evidence age.
    const decisionId=(await call("deck_decision_open",{commandId:"reseed-question",key:"reseed-question",question:"May the prepared task proceed?",source:{promptId},relatedTaskIds:[childId]}) as any).data.decisionId;
    const name=action==="resolve"?"deck_decision_resolve":"deck_delegate";
    const input=action==="resolve"?{commandId:"same-authority",decisionId,expectedRevision:1,promptId,note:"The input predates this question",disposition:"allow",action:"execute"}:{commandId:"same-authority",agent:"investigate",task:"Must remain held",continueTaskId:childId,dependsOn:[],replan:{promptId,note:"The input predates the dependency"}};
    expect(await call(name,input)).toMatchObject({ok:false,code:"decision-evidence-invalid"});
    const first=t.events(id).find(e=>e.kind==="prompt.dispatched"&&e.data.promptId===promptId)!.seq;
    resumed.finish({status:"failed",reasonCode:"native-session-not-found"});await waitFor(()=>t.driver.turns.length===4);
    const dispatches=t.events(id).filter(e=>e.kind==="prompt.dispatched"&&e.data.promptId===promptId);expect(dispatches).toHaveLength(2);expect(dispatches[1]!.seq).toBeGreaterThan(first);
    expect(await call(name,input)).toMatchObject({ok:false,code:"decision-evidence-invalid"});
    const ledger=loadLedger(t.manager.openLog(id)!,sessionPaths(t.paths,id).ledgerSnapshotFile).ledger;
    expect(ledger.prompt(promptId)).toMatchObject({firstAdmissionSeq:first,dispatchedSeq:dispatches[1]!.seq,attempt:3});expect(ledger.continuityBlock?.startedSeq).toBe(first);
    expect(t.events(id).filter(e=>e.kind==="message.completed"&&e.data.role==="user"&&e.data.promptId===promptId)).toHaveLength(1);
    expect(ledger.decision(decisionId)?.state).toBe("pending");expect(ledger.task(childId)?.dependsOn).toEqual([decisionId]);expect(t.driver.turns).toHaveLength(4);
    lastTurn(t.driver).finish();await waitFor(()=>lastTurn(t.driver).closed);
  });
  test("same-command retries with reordered fields preserve the original outcome across state changes", async () => {
    const {t,id,open}=await decisionSession();const decisionId=(await open() as any).data.decisionId,commandId="dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const results=await Promise.all([t.runWithId(commandId,{type:"decision.defer",decisionId,expectedRevision:1,note:"Later"} as any,id),t.runWithId(commandId,{note:"Later",expectedRevision:1,decisionId,type:"decision.defer"} as any,id)]);
    expect(results).toMatchObject([{ok:true,data:{revision:2,state:"deferred"}},{ok:true,duplicate:true,data:{revision:2,state:"deferred"}}]);
    expect(await t.runWithId(commandId,{type:"decision.defer",decisionId,expectedRevision:1,note:"Changed content"} as any,id)).toMatchObject({ok:false,code:"command-id-reused"});
    lastTurn(t.driver).finish();await waitFor(()=>lastTurn(t.driver).closed);
  });
  test("decision writes do not acknowledge success after flush failure or permit a revoked owner", async () => {
    const {t,id,call,open,promptId}=await decisionSession();const log=t.manager.openLog(id)!,flush=log.flush.bind(log);
    log.flush=()=>{throw new Error("decision-fsync-failure");};cleanups.push(()=>{log.flush=flush;});
    expect(await open()).toMatchObject({ok:false,code:"task-tool-failed"});log.flush=flush;await waitFor(()=>lastTurn(t.driver).closed);
    const fakeGrant={sessionId:id,taskId:"lead",memberId:"lead",runnerId:"claude",allowedTools:["deck_decision_resolve"]};
    expect(await t.manager.callTaskTool(fakeGrant as any,"deck_decision_resolve",{commandId:"revoked",decisionId:"not-authorized",expectedRevision:1,promptId,note:"No owner",disposition:"informational"})).toMatchObject({ok:false,code:"credential-revoked"});
  });
  test("defer/reopen preserve question version; substantive revision flags accepted stale text and never applies it", async () => {
    const { t, id, call, open } = await decisionSession(); const decisionId = (await open() as any).data.decisionId;
    const reply = await t.run({ type: "prompt.send", text: "Accepted original answer", decisionTarget: { decisionId, revision: 1 } } as any, id);
    expect(await t.run({type:"decision.defer",decisionId,expectedRevision:1,note:"Later"} as any,id)).toMatchObject({ok:true,data:{revision:2,state:"deferred"}});
    expect(await t.run({type:"decision.reopen",decisionId,expectedRevision:2,note:"Now"} as any,id)).toMatchObject({ok:true,data:{revision:3,state:"pending"}});
    expect(await call("deck_decision_revise",{commandId:"revise",decisionId,expectedRevision:3,question:"Changed question?",note:"Substantive change"})).toMatchObject({ok:true,data:{revision:4}});
    const original=t.driver.turns[0]!;original.finish();await waitFor(()=>original.closed);
    await waitFor(()=>t.driver.turns.length===2); expect(lastTurn(t.driver).input.prompt).toBe("Accepted original answer"); expect(lastTurn(t.driver).input.rolePrompt).toContain("STALE target/question");
    expect((await call("deck_decision_list",{}) as any).data.decisions[0]).toMatchObject({state:"pending",questionRevision:4,replies:[{stale:true,revision:1}]});
    expect(await call("deck_decision_resolve",{commandId:"stale-answer",decisionId,expectedRevision:4,promptId:(reply as any).data.promptId,note:"Do not apply",disposition:"informational"})).toMatchObject({ok:false,code:"decision-reply-stale"});
    lastTurn(t.driver).finish(); await waitFor(()=>lastTurn(t.driver).closed);
  });
  test("a defer alone does not make an already queued targeted answer stale", async () => {
    const {t,id,call,open}=await decisionSession();const decisionId=(await open() as any).data.decisionId;
    await t.run({type:"prompt.send",text:"Clarification",decisionTarget:{decisionId,revision:1}} as any,id);
    await t.run({type:"decision.defer",decisionId,expectedRevision:1,note:"Hold"} as any,id);
    lastTurn(t.driver).finish(); await waitFor(()=>t.driver.turns.length===2);
    expect((await call("deck_decision_list",{}) as any).data.decisions[0]).toMatchObject({revision:2,questionRevision:1,state:"deferred",replies:[{stale:false}]});
    lastTurn(t.driver).finish();await waitFor(()=>lastTurn(t.driver).closed);
  });
  test("capacity, source ownership, question bounds, optimistic races and durable identities are enforced", async () => {
    const {t,id,call,open,promptId}=await decisionSession();const opened=await open() as any,decisionId=opened.data.decisionId;
    expect(await call("deck_decision_open",{commandId:"foreign",key:"foreign",question:"Question",source:{promptId:"foreign-prompt"}})).toMatchObject({ok:false,code:"decision-source-invalid"});
    expect(await call("deck_decision_open",{commandId:"long",key:"long",question:"q".repeat(2001),source:{promptId}})).toMatchObject({ok:false,code:"invalid-arguments"});
    for(let i=1;i<16;i++)expect(await call("deck_decision_open",{commandId:`open-${i+1}`,key:`key-${i}`,question:`Question ${i}?`,source:{promptId}})).toMatchObject({ok:true});
    expect(await call("deck_decision_open",{commandId:"overflow",key:"overflow",question:"Overflow?",source:{promptId}})).toMatchObject({ok:false,code:"decision-capacity"});
    const results=await Promise.all([t.run({type:"decision.defer",decisionId,expectedRevision:1,note:"First"} as any,id),t.run({type:"decision.cancel",decisionId,expectedRevision:1,note:"Second"} as any,id)]);
    expect(results.filter(r=>r.ok)).toHaveLength(1);expect(results.filter(r=>!r.ok)).toMatchObject([{code:"decision-revision-conflict"}]);
    t.manager.openLog(id)!.appendMany(Array.from({length:1001},(_,i)=>({kind:"command.accepted" as const,data:{commandId:`evicted-${i}`,type:"fixture",outcome:{ok:true}}})));
    expect(await open()).toMatchObject({ok:true,duplicate:true,data:{revision:1,state:"pending"}});
    expect(await call("deck_decision_open",{commandId:"open-1",key:"changed",question:"Changed?",source:{promptId}})).toMatchObject({ok:false,code:"command-id-reused"});
    expect(await call("deck_decision_open",{commandId:"alias",key:"scope",question:"May the change proceed?",source:{promptId}})).toMatchObject({ok:true,duplicate:true});
    expect(await call("deck_decision_open",{commandId:"alias",key:"new-key",question:"May the change proceed?",source:{promptId}})).toMatchObject({ok:false,code:"command-id-reused"});
    const context=lastTurn(t.driver);context.finish();await waitFor(()=>context.closed);await t.manager.close();
    const next=setup({dir:t.dir});const snapshot=await next.manager.query("decisions.list",{sessionId:id}) as any;expect(snapshot.data.decisions).toHaveLength(16);expect(snapshot.data.decisions[0].state).toBe("deferred");
  });
  test("only the current genuine admitted user prompt can answer; synthetic, queued, foreign and old evidence are rejected", async () => {
    const {t,id,call,open,promptId}=await decisionSession();const decisionId=(await open() as any).data.decisionId;
    for(const source of [promptId,"foreign"])expect(await call("deck_decision_resolve",{commandId:`bad-${source}`,decisionId,expectedRevision:1,promptId:source,note:"Invalid evidence",disposition:"allow",action:"execute"})).toMatchObject({ok:false,code:"decision-evidence-invalid"});
    expect(await call("deck_delegate",{agent:"investigate",task:"Held",dependsOn:[decisionId],action:"execute"})).toMatchObject({ok:false,code:"decision-dependency-blocked"});
    expect(await call("deck_delegate",{agent:"investigate",task:"Independent"})).toMatchObject({ok:true});
    await waitFor(()=>t.driver.turns.length===2);lastTurn(t.driver).finish();await waitFor(()=>lastTurn(t.driver).closed);
    const original=t.driver.turns[0]!;original.finish();await waitFor(()=>original.closed);
    const clock=(t.manager as any).options.clock as FakeClock;clock.advance(20);await waitFor(()=>t.driver.turns.length===3);
    expect(await call("deck_decision_resolve",{commandId:"synthetic",decisionId,expectedRevision:1,promptId,note:"Not user input",disposition:"allow",action:"execute"})).toMatchObject({ok:false,code:"decision-evidence-invalid"});
    const childId=t.driver.turns[1]!.input.taskId;
    const replacement=(await call("deck_decision_open",{commandId:"outcome-question",key:"outcome-question",question:"Outcome replacement?",source:{taskId:childId,attempt:1}}) as any).data.decisionId;
    expect(await call("deck_decision_revise",{commandId:"outcome-only-supersede",decisionId,expectedRevision:1,state:"superseded",replacementDecisionId:replacement,note:"Outcome alone has no scope-change authority"})).toMatchObject({ok:false,code:"decision-evidence-invalid"});
    const snapshot=await call("deck_decision_list",{}) as any;expect(snapshot.data.decisions[0].state).toBe("pending");lastTurn(t.driver).finish();await waitFor(()=>lastTurn(t.driver).closed);
  });
  test("negative answers do not authorize declared actions; continuations retain dependencies until an explicit user-backed replan", async () => {
    const {t,id,call,open}=await decisionSession();const decisionId=(await open() as any).data.decisionId;
    const independent=await call("deck_delegate",{agent:"investigate",task:"Independent setup"}) as any;await waitFor(()=>t.driver.turns.length===2);lastTurn(t.driver).finish();await waitFor(()=>lastTurn(t.driver).closed);await call("deck_task_result",{taskId:independent.data.taskId});
    t.driver.turns[0]!.finish();await waitFor(()=>t.driver.turns[0]!.closed);
    const reply=await t.run({type:"prompt.send",text:"Do not execute"},id);await waitFor(()=>t.driver.turns.length===3);
    await call("deck_decision_resolve",{commandId:"negative",decisionId,expectedRevision:1,promptId:(reply as any).data.promptId,note:"User declined",disposition:"deny"});
    expect(await call("deck_delegate",{agent:"investigate",task:"Must remain held",dependsOn:[decisionId],action:"execute"})).toMatchObject({ok:false,code:"decision-dependency-blocked"});
    lastTurn(t.driver).finish();await waitFor(()=>lastTurn(t.driver).closed);
  });
  test("opening-key retries remain idempotent when the related task reaches dependency capacity", async () => {
    const {t,id,call,promptId}=await decisionSession();const taskId=(await call("deck_delegate",{agent:"investigate",task:"Running linked work"}) as any).data.taskId;await waitFor(()=>t.driver.turns.length===2);
    const input={commandId:"link-0",key:"link-0",question:"Linked question 0?",source:{promptId},relatedTaskIds:[taskId]};
    const original=await call("deck_decision_open",input) as any;expect(original.ok).toBe(true);
    for(let i=1;i<16;i++)expect(await call("deck_decision_open",{...input,commandId:`link-${i}`,key:`link-${i}`,question:`Linked question ${i}?`})).toMatchObject({ok:true});
    expect(await call("deck_decision_open",{...input,commandId:"link-alias"})).toMatchObject({ok:true,duplicate:true,data:original.data});
    expect((await t.manager.query("task.result",{sessionId:id,taskId}) as any).data.dependsOn).toHaveLength(16);
    const child=lastTurn(t.driver);expect(child.interrupts).toEqual([]);child.finish();await waitFor(()=>child.closed);await call("deck_task_result",{taskId});t.driver.turns[0]!.finish();await waitFor(()=>t.driver.turns[0]!.closed);
  });
  test("opening a decision linked to running delegated work holds its continuation without interrupting it", async () => {
    const {t,id,call,promptId}=await decisionSession();const taskId=(await call("deck_delegate",{agent:"investigate",task:"Current work"}) as any).data.taskId;
    await waitFor(()=>t.driver.turns.length===2);const child=lastTurn(t.driver);
    const decisionId=(await call("deck_decision_open",{commandId:"linked-open",key:"linked",question:"May this task continue?",source:{promptId},relatedTaskIds:[taskId]}) as any).data.decisionId;
    expect((await t.manager.query("task.result",{sessionId:id,taskId}) as any).data.dependsOn).toEqual([decisionId]);expect(child.interrupts).toEqual([]);expect(child.finished).toBe(false);
    child.finish();await waitFor(()=>child.closed);await call("deck_task_result",{taskId});
    expect(await call("deck_delegate",{agent:"investigate",task:"Held continuation",continueTaskId:taskId})).toMatchObject({ok:false,code:"decision-dependency-blocked"});
    const lead=t.driver.turns[0]!;lead.finish();await waitFor(()=>lead.closed);
    const reply=await t.run({type:"prompt.send",text:"Allow execute for this task"},id);await waitFor(()=>t.driver.turns.length===3);
    await call("deck_decision_resolve",{commandId:"linked-allow",decisionId,expectedRevision:1,promptId:(reply as any).data.promptId,note:"User allowed execution",disposition:"allow",action:"execute"});
    expect(await call("deck_delegate",{agent:"investigate",task:"Compatible continuation",continueTaskId:taskId,action:"execute"})).toMatchObject({ok:true});
    await waitFor(()=>t.driver.turns.length===4);lastTurn(t.driver).finish();await waitFor(()=>lastTurn(t.driver).closed);await call("deck_task_result",{taskId});t.driver.turns[2]!.finish();await waitFor(()=>t.driver.turns[2]!.closed);
  });
  test("compatible dependencies persist through continuation; removal needs a newer user-backed durable replan", async () => {
    const {t,id,call,open}=await decisionSession();const decisionId=(await open() as any).data.decisionId;
    const first=t.driver.turns[0]!;first.finish();await waitFor(()=>first.closed);
    const approval=await t.run({type:"prompt.send",text:"Allow the execute action"},id);await waitFor(()=>t.driver.turns.length===2);
    await call("deck_decision_resolve",{commandId:"allow",decisionId,expectedRevision:1,promptId:(approval as any).data.promptId,note:"User approved execute",disposition:"allow",action:"execute"});
    expect(await call("deck_delegate",{agent:"investigate",task:"Wrong action",dependsOn:[decisionId],action:"publish"})).toMatchObject({ok:false,code:"decision-dependency-blocked"});
    const taskId=(await call("deck_delegate",{agent:"investigate",task:"Allowed action",dependsOn:[decisionId],action:"execute"}) as any).data.taskId;
    await waitFor(()=>t.driver.turns.length===3);const child=lastTurn(t.driver);child.finish();await waitFor(()=>child.closed);await call("deck_task_result",{taskId});
    expect((await t.manager.query("task.result",{sessionId:id,taskId}) as any).data).toMatchObject({dependsOn:[decisionId],action:"execute"});
    expect(await call("deck_delegate",{agent:"investigate",task:"Unchanged continuation",continueTaskId:taskId})).toMatchObject({ok:true});
    await waitFor(()=>t.driver.turns.length===4);lastTurn(t.driver).finish();await waitFor(()=>lastTurn(t.driver).closed);await call("deck_task_result",{taskId});
    expect((await t.manager.query("task.result",{sessionId:id,taskId}) as any).data).toMatchObject({dependsOn:[decisionId],action:"execute",attempts:[{attempt:1},{attempt:2}]});
    expect(await call("deck_delegate",{agent:"investigate",task:"Implicit removal",continueTaskId:taskId,dependsOn:[]})).toMatchObject({ok:false,code:"dependency-replan-required"});
    expect(await call("deck_delegate",{commandId:"too-old-replan",agent:"investigate",task:"Old evidence",continueTaskId:taskId,dependsOn:[],replan:{promptId:(approval as any).data.promptId,note:"Earlier than permission record"}})).toMatchObject({ok:false,code:"decision-evidence-invalid"});
    const current=t.driver.turns[1]!;current.finish();await waitFor(()=>current.closed);
    const prompt=await t.run({type:"prompt.send",text:"Replan this task as independent work"},id);await waitFor(()=>t.driver.turns.length===5);
    const replan={commandId:"cccccccc-1111-4111-8111-cccccccccccc",agent:"investigate",task:"Explicit independent continuation",continueTaskId:taskId,dependsOn:[],replan:{promptId:(prompt as any).data.promptId,note:"User requested independent continuation"}};
    expect(await call("deck_delegate",{...replan,commandId:"open-1"})).toMatchObject({ok:false,code:"command-id-reused"});
    expect(await call("deck_delegate",replan)).toMatchObject({ok:true,data:{taskId}});
    expect(await call("deck_delegate",replan)).toMatchObject({ok:true,duplicate:true,data:{taskId}});
    expect(await call("deck_decision_open",{commandId:replan.commandId,key:"replan-collision",question:"Collision?",source:{promptId:(prompt as any).data.promptId}})).toMatchObject({ok:false,code:"command-id-reused"});
    expect(await t.runWithId(replan.commandId,{type:"prompt.resume"},id)).toMatchObject({ok:false,code:"command-id-reused"});
    const evidence=t.events(id).find(e=>e.source.taskId===taskId)!.seq;
    expect(await call("deck_task_integrate",{commandId:replan.commandId,taskId,attempt:1,state:"integrated",note:"Collision",evidenceSeqs:[evidence]})).toMatchObject({ok:false,code:"command-id-reused"});

    await waitFor(()=>t.driver.turns.length===6);const continued=lastTurn(t.driver);continued.finish();await waitFor(()=>continued.closed);await call("deck_task_result",{taskId});
    expect((await t.manager.query("task.result",{sessionId:id,taskId}) as any).data).toMatchObject({dependsOn:[],replan:{promptId:(prompt as any).data.promptId},attempts:[{attempt:1},{attempt:2},{attempt:3}]});
    t.driver.turns[4]!.finish();await waitFor(()=>t.driver.turns[4]!.closed);
  });
  test("deferred, cancelled and superseded decisions hold declared work while independent work remains available", async () => {
    const {t,id,call,open,promptId}=await decisionSession();const decisionId=(await open() as any).data.decisionId;
    await t.run({type:"decision.defer",decisionId,expectedRevision:1,note:"Later"} as any,id);
    expect(await call("deck_delegate",{agent:"investigate",task:"Held by deferral",dependsOn:[decisionId],action:"execute"})).toMatchObject({ok:false,code:"decision-dependency-blocked"});
    await t.run({type:"decision.cancel",decisionId,expectedRevision:2,note:"Abandoned"} as any,id);
    expect(await call("deck_delegate",{agent:"investigate",task:"Held by cancellation",dependsOn:[decisionId],action:"execute"})).toMatchObject({ok:false,code:"decision-dependency-blocked"});
    const replacement=(await call("deck_decision_open",{commandId:"replacement",key:"replacement",question:"Replacement?",source:{promptId}}) as any).data.decisionId;
    const obsolete=(await call("deck_decision_open",{commandId:"obsolete",key:"obsolete",question:"Obsolete?",source:{promptId}}) as any).data.decisionId;
    expect(await call("deck_decision_revise",{commandId:"old-supersede",decisionId:obsolete,expectedRevision:1,state:"superseded",replacementDecisionId:replacement,note:"Old input"})).toMatchObject({ok:false,code:"decision-evidence-invalid"});
    expect(await call("deck_decision_revise",{commandId:"old-scope",decisionId:obsolete,expectedRevision:1,state:"superseded",scopePromptId:promptId,note:"Old scope input"})).toMatchObject({ok:false,code:"decision-evidence-invalid"});
    t.driver.turns[0]!.finish();await waitFor(()=>t.driver.turns[0]!.closed);
    const scope=await t.run({type:"prompt.send",text:"Replace the obsolete question with the replacement"},id);await waitFor(()=>t.driver.turns.length===2);
    expect(await call("deck_decision_revise",{commandId:"supersede",decisionId:obsolete,expectedRevision:1,state:"superseded",replacementDecisionId:replacement,note:"Explicit replacement"})).toMatchObject({ok:true,data:{state:"superseded"}});
    expect((await call("deck_decision_list",{}) as any).data.decisions.find((d:any)=>d.decisionId===obsolete)).toMatchObject({replacementDecisionId:replacement,scopePromptId:(scope as any).data.promptId});
    expect(await call("deck_decision_revise",{commandId:"new-scope",decisionId:replacement,expectedRevision:1,state:"superseded",scopePromptId:(scope as any).data.promptId,note:"New admitted scope change"})).toMatchObject({ok:true});
    expect(await call("deck_delegate",{agent:"investigate",task:"Held by supersession",dependsOn:[obsolete],action:"execute"})).toMatchObject({ok:false,code:"decision-dependency-blocked"});
    expect(await call("deck_delegate",{agent:"investigate",task:"Independent work"})).toMatchObject({ok:true});await waitFor(()=>t.driver.turns.length===3);lastTurn(t.driver).finish();await waitFor(()=>lastTurn(t.driver).closed);await call("deck_task_result",{taskId:lastTurn(t.driver).input.taskId});
    t.driver.turns[1]!.finish();await waitFor(()=>t.driver.turns[1]!.closed);
  });
  test("decision references survive Lead reassignment and legacy stop without implicit resolution", async () => {
    const {t,id,open}=await decisionSession();const decisionId=(await open() as any).data.decisionId;const initial=lastTurn(t.driver);initial.finish();await waitFor(()=>initial.closed);
    expect(await t.run({type:"session.assignMember",memberId:"lead",expectedRevision:0,assignment:{runnerId:"claude",modelId:"new-lead"}},id)).toMatchObject({ok:true,data:{generation:1}});
    await t.run({type:"prompt.send",text:"Continue after reassignment"},id);await waitFor(()=>t.driver.turns.length===2);
    expect(lastTurn(t.driver).input.rolePrompt).toContain(decisionId);expect(lastTurn(t.driver).input.taskId).toBe("lead-g1");
    const next=lastTurn(t.driver);next.finish();await waitFor(()=>next.closed);await t.run({type:"session.stop"},id);
    expect((await t.manager.query("decisions.list",{sessionId:id}) as any).data.decisions[0]).toMatchObject({decisionId,state:"pending"});
    expect(await t.run({type:"decision.defer",decisionId,expectedRevision:1,note:"No mutations on stopped session"} as any,id)).toMatchObject({ok:false,code:"session-ended"});
  });
  test("committed queue/dispatch/reply/resolution prefixes never fabricate resolution or lose accepted text", async () => {
    const {t,id,call,open}=await decisionSession();const decisionId=(await open() as any).data.decisionId;
    const reply=await t.run({type:"prompt.send",text:"An admitted user reply",decisionTarget:{decisionId,revision:1}} as any,id);const first=t.driver.turns[0]!;first.finish();await waitFor(()=>t.driver.turns.length===2);
    const answer={commandId:"prefix-answer",decisionId,expectedRevision:1,promptId:(reply as any).data.promptId,note:"Explicit answer",disposition:"informational"};
    expect(await call("deck_decision_resolve",answer)).toMatchObject({ok:true});
    const events=t.events(id),opened=events.find(e=>e.kind==="decision.opened")!,dispatch=events.find(e=>e.kind==="prompt.dispatched"&&e.data.promptId===(reply as any).data.promptId)!,resolved=events.find(e=>e.kind==="decision.state")!;
    for(let length=opened.seq;length<=events.length;length++){
      const ledger=Ledger.empty(id);for(const event of events.slice(0,length))ledger.apply(event);
      const decision=ledger.decision(decisionId)!;expect(decision.state).toBe(length>=resolved.seq?"answered":"pending");
      expect(decision.replies.length).toBe(length>=dispatch.seq?1:0);expect(!!ledger.decisionCommand("prefix-answer")).toBe(length>=resolved.seq);
      const prompt=ledger.prompt((reply as any).data.promptId);if(prompt?.state==="queued"||prompt?.state==="dispatched")expect(prompt.text).toBe("An admitted user reply");
      expect(ledger.anomalies).toEqual([]);
    }
    lastTurn(t.driver).finish();await waitFor(()=>lastTurn(t.driver).closed);await t.manager.close();const next=setup({dir:t.dir});
    expect((await next.manager.query("decisions.list",{sessionId:id}) as any).data.decisions[0]).toMatchObject({state:"answered",resolution:{promptId:(reply as any).data.promptId}});
  });
  test("release/reprepare and tombstones preserve same-ID decision history without admitting queued replies", async () => {
    const {t,id,call,open}=await decisionSession();const decisionId=(await open() as any).data.decisionId;
    const queued=await t.run({type:"prompt.send",text:"Kept reply",decisionTarget:{decisionId,revision:1}} as any,id);
    await t.run({type:"session.release"},id);await waitFor(async()=>(await t.manager.query("session.readiness",{sessionId:id}) as any).data.status==="unprepared");
    await t.run({type:"session.prepare"},id);await waitFor(async()=>(await t.manager.query("session.readiness",{sessionId:id}) as any).data.status==="ready");
    expect((await t.manager.query("decisions.list",{sessionId:id}) as any).data.decisions[0]).toMatchObject({state:"pending",replies:[],queuedReplies:[{promptId:(queued as any).data.promptId}]});
    await t.run({type:"prompt.resume"},id);await waitFor(()=>t.driver.turns.length===2);expect((await call("deck_decision_list",{}) as any).data.decisions[0].replies).toHaveLength(1);
    await t.run({type:"session.remove"},id);await waitFor(async()=>(await t.manager.query("sessions.list",{}) as any).data.sessions.length===0);
    expect((await t.manager.query("decisions.list",{sessionId:id}) as any).data.decisions[0].state).toBe("pending");
    expect(await t.run({type:"decision.cancel",decisionId,expectedRevision:1,note:"No mutation after remove"} as any,id)).toMatchObject({ok:false,code:"session-removed"});
  });
  test("open is durable, observer reads inert, and a new topic retains a pending decision", async () => {
    const { t, id, call, open } = await decisionSession();
    const opened = await open(); expect(opened).toMatchObject({ ok: true, data: { revision: 1, state: "pending" } }); const decisionId = (opened as any).data.decisionId;
    expect(await open()).toMatchObject({ ok: true, duplicate: true });
    const seq = t.manager.openLog(id)!.lastSeq;
    expect(await t.manager.query("decisions.list", { sessionId: id })).toMatchObject({ ok: true, data: { decisions: [{ decisionId, state: "pending" }] } });
    expect(t.manager.openLog(id)!.lastSeq).toBe(seq);
    lastTurn(t.driver).finish(); await waitFor(() => lastTurn(t.driver).closed);
    await t.run({ type: "prompt.send", text: "An unrelated topic" }, id); await waitFor(() => t.driver.turns.length === 2);
    expect(lastTurn(t.driver).input.rolePrompt).toContain(decisionId);
    expect(await call("deck_decision_list", {})).toMatchObject({ ok: true, data: { decisions: [{ state: "pending" }] } });
    lastTurn(t.driver).finish(); await t.idle();
  });
  test("targeted queued cancellation does not reply or resolve; admitted reply requires explicit current-user resolution", async () => {
    const { t, id, call, open } = await decisionSession(); const opened = await open(); expect(opened.ok).toBe(true); const decisionId = (opened as any).data.decisionId;
    const cancelled = await t.run({ type: "prompt.send", text: "Do not deliver this", decisionTarget: { decisionId, revision: 1 } } as any, id);
    await t.run({ type: "prompt.cancel", promptId: (cancelled as any).data.promptId }, id);
    expect((await t.manager.query("decisions.list", { sessionId: id }) as any).data.decisions[0].replies).toEqual([]);
    expect(await call("deck_decision_resolve", { commandId: "too-early", decisionId, expectedRevision: 1, promptId: (cancelled as any).data.promptId, note: "Yes", disposition: "allow", action: "implement" })).toMatchObject({ ok: false });
    lastTurn(t.driver).finish(); await waitFor(() => lastTurn(t.driver).closed);
    const reply = await t.run({ type: "prompt.send", text: "Yes, implement", decisionTarget: { decisionId, revision: 1 } } as any, id); await waitFor(() => t.driver.turns.length === 2);
    expect((await t.manager.query("decisions.list", { sessionId: id }) as any).data.decisions[0]).toMatchObject({ state: "pending", replies: [{ promptId: (reply as any).data.promptId, stale: false }] });
    expect(await call("deck_decision_resolve", { commandId: "answer-1", decisionId, expectedRevision: 1, promptId: (reply as any).data.promptId, note: "Implement as requested", disposition: "allow", action: "implement" })).toMatchObject({ ok: true, data: { state: "answered" } });
    expect(await call("deck_delegate", { agent: "investigate", task: "Execute compatible work", dependsOn: [decisionId], action: "implement" })).toMatchObject({ ok: true });
    await waitFor(() => t.driver.turns.length === 3); lastTurn(t.driver).finish(); t.driver.turns[1]!.finish(); await waitFor(() => t.driver.turns.every(turn => turn.closed));
  });
});

describe('Stage 3 exact-turn steering',()=>{
 async function steeringSession(options:Partial<SessionManagerOptions>={},version="0.162.1"){
  const driver=new FakeDriver('codex');driver.probeResult={status:'ready',version,capabilities:['turn-steer-text-0.162.1'],mcpIsolationVerified:true};
  let reconcile:(m:any)=>Promise<any>=async()=>({state:'unknown',reason:'absent-history'});let targetAvailable=true;const resolves:Array<(v:any)=>void>=[],writes:any[]=[];const resolve=(v:any,index=0)=>resolves[index]!(v);const start=driver.startTask.bind(driver);
  driver.startTask=async(input,io)=>{const handle=await start(input,io);const nativeThreadId=await handle.nativeSessionId,nativeTurnId=`native-turn-${driver.turns.length}`;return {...handle,steeringTarget:()=>targetAvailable?{nativeThreadId,nativeTurnId}:undefined,steer:async(message:any)=>{writes.push(message);return new Promise<any>(r=>resolves.push(r));},reconcileSteering:(m:any)=>reconcile(m)};};
  const t=setup({driver,options,config:baseConfig({members:{lead:{runnerId:'codex',modelId:'gpt-6.1-sol'},investigate:{runnerId:'codex',modelId:'gpt-6.1-sol'}}})});const id=await t.create();await t.run({type:'prompt.send',text:'Original user instruction'},id);await waitFor(()=>driver.turns.length===1);lastTurn(driver).init();
  const grant=t.credentials.lookup(JSON.parse(readFileSync(sessionPaths(t.paths,id).taskCredentialFile('lead'),'utf8')).token)!;
  const call=(name:string,args:Record<string,unknown>)=>t.manager.callTaskTool(grant,name,args);
  return {t,id,driver,writes,resolve,call,setTargetAvailable:(v:boolean)=>{targetAvailable=v;},setReconcile:(fn:(m:any)=>Promise<any>)=>{reconcile=fn;},accept:(index=0)=>resolve({state:'accepted',...writes[index],via:'receipt'},index)};
 }
 test('pre-write fence retains authority age; late question revision cannot be authorized by delayed acceptance',async()=>{
  const {t,id,driver,writes,resolve,call}=await steeringSession();expect(driver.turns[0]!.input.steeringVersion).toBe('0.162.1');
  const source=t.events(id).find(e=>e.kind==='prompt.dispatched')!.data.promptId;
  const decisionId=(await call('deck_decision_open',{commandId:'open-before-steer',key:'scope',question:'Proceed?',source:{promptId:source}}) as any).data.decisionId;
  const sent=await t.run({type:'prompt.send',text:'Yes to the original question',delivery:'current-turn',decisionTarget:{decisionId,revision:1}} as any,id);await waitFor(()=>writes.length===1);
  const fence=t.events(id).find(e=>e.kind==='prompt.steering')!;expect(fence).toBeDefined();
  expect(await call('deck_decision_resolve',{commandId:'premature',decisionId,expectedRevision:1,promptId:(sent as any).data.promptId,note:'Not yet accepted',disposition:'allow',action:'execute'})).toMatchObject({ok:false,code:'decision-evidence-invalid'});
  await call('deck_decision_revise',{commandId:'revision-after-write',decisionId,expectedRevision:1,question:'Changed scope?',note:'New question after the write'});
  resolve({state:'accepted',...writes[0],via:'receipt'});await waitFor(()=>t.events(id).some(e=>e.kind==='prompt.steered'));
  const ledger=loadLedger(t.manager.openLog(id)!,sessionPaths(t.paths,id).ledgerSnapshotFile).ledger;
  expect(ledger.prompt((sent as any).data.promptId)).toMatchObject({firstAdmissionSeq:fence.seq,steering:{state:'accepted',stale:true,eligible:false}});
  expect(await call('deck_decision_resolve',{commandId:'stale-steer',decisionId,expectedRevision:2,promptId:(sent as any).data.promptId,note:'Must not gain freshness',disposition:'allow',action:'execute'})).toMatchObject({ok:false});
  expect(lastTurn(driver).input.prompt).toBe('Original user instruction');lastTurn(driver).finish();await t.idle();
 });
 test('multiple genuine steered inputs retain independent immutable membership; bookkeeping and free-text resolution work',async()=>{
  const {t,id,driver,writes,accept,call}=await steeringSession();const read=()=>loadLedger(t.manager.openLog(id)!,sessionPaths(t.paths,id).ledgerSnapshotFile).ledger;
  const original=read().prompts()[0]!,originalSeq=original.firstAdmissionSeq;
  const decisionId=(await call('deck_decision_open',{commandId:'open-free',key:'free',question:'May we execute?',source:{promptId:original.promptId}}) as any).data.decisionId;
  const a=await t.run({type:'prompt.send',text:'Yes, execute',delivery:'current-turn'} as any,id);await waitFor(()=>writes.length===1);accept();await waitFor(()=>read().prompt((a as any).data.promptId)?.state==='accepted');
  const b=await t.run({type:'prompt.send',text:'Also retain this answer',delivery:'current-turn',decisionTarget:{decisionId,revision:1}} as any,id);await waitFor(()=>writes.length===2);
  await t.run({type:'decision.defer',decisionId,expectedRevision:1,note:'Later'} as any,id);await t.run({type:'decision.reopen',decisionId,expectedRevision:2,note:'Now'} as any,id);accept(1);await waitFor(()=>read().prompt((b as any).data.promptId)?.state==='accepted');
  expect(read().prompt(original.promptId)?.firstAdmissionSeq).toBe(originalSeq);expect(read().prompt((b as any).data.promptId)?.steering?.eligible).toBe(true);
  expect(await call('deck_decision_resolve',{commandId:'free-answer',decisionId,expectedRevision:3,promptId:(a as any).data.promptId,note:'Explicit applicable free text',disposition:'allow',action:'execute'})).toMatchObject({ok:true});
  const count=t.events(id).filter(e=>e.kind==='prompt.steering').length;expect(await t.runWithId((a as any).data.promptId,{type:'prompt.send',text:'Yes, execute',delivery:'current-turn'} as any,id)).toMatchObject({ok:true,duplicate:true});expect(t.events(id).filter(e=>e.kind==='prompt.steering')).toHaveLength(count);
  expect(await t.runWithId((a as any).data.promptId,{type:'prompt.send',text:'Changed',delivery:'current-turn'} as any,id)).toMatchObject({ok:false,code:'command-id-reused'});
  lastTurn(driver).finish();await t.idle();expect(read().prompt((a as any).data.promptId)?.state).toBe('completed');expect(read().prompt((b as any).data.promptId)?.state).toBe('completed');
 });
 test('FIFO-ineligible current-turn requests remain ordinary queued input and cannot target a later turn',async()=>{
  const {t,id,driver,writes}=await steeringSession();const older=await t.run({type:'prompt.send',text:'Older queue message'},id);await t.run({type:'prompt.send',text:'Current intent behind older queue',delivery:'current-turn'} as any,id);
  expect(writes).toHaveLength(0);await t.run({type:'prompt.cancel',promptId:(older as any).data.promptId},id);expect(writes).toHaveLength(0);
  driver.turns[0]!.finish();await waitFor(()=>driver.turns.length===2);expect(lastTurn(driver).input.prompt).toBe('Current intent behind older queue');expect(writes).toHaveLength(0);lastTurn(driver).finish();await t.idle();
 });
 test('cancellation after the steering fence is refused; accepted input uses only its original route',async()=>{
  const {t,id,driver,writes,accept}=await steeringSession();const sent=await t.run({type:'prompt.send',text:'One current route',delivery:'current-turn'} as any,id);await waitFor(()=>writes.length===1);
  expect(await t.run({type:'prompt.cancel',promptId:(sent as any).data.promptId},id)).toMatchObject({ok:false,code:'prompt-already-started'});accept();await waitFor(()=>t.events(id).some(e=>e.kind==='prompt.steered'));lastTurn(driver).finish();await t.idle();expect(driver.turns).toHaveLength(1);
 });
 test('only verified refusal restores the same FIFO record to queued delivery',async()=>{
  const {t,id,driver,writes,resolve}=await steeringSession();const sent=await t.run({type:'prompt.send',text:'One route only',delivery:'current-turn'} as any,id);await waitFor(()=>writes.length===1);resolve({state:'not-accepted',reason:'no-active-turn'});await waitFor(()=>t.events(id).some(e=>e.kind==='prompt.steered'));
  const snapshot=await t.manager.query('prompts.list',{sessionId:id}) as any;expect(snapshot.data.queued).toMatchObject([{promptId:(sent as any).data.promptId}]);expect(writes).toHaveLength(1);
  expect(t.events(id).find(e=>e.kind==='prompt.steered')!.data.queueFallback).toBe(true);
  lastTurn(driver).finish();await waitFor(()=>driver.turns.length===2);expect(lastTurn(driver).input.prompt).toBe('One route only');
  const p=loadLedger(t.manager.openLog(id)!,sessionPaths(t.paths,id).ledgerSnapshotFile).ledger.prompt((sent as any).data.promptId)!;expect(p.firstAdmissionSeq).toBe(t.events(id).find(e=>e.kind==='prompt.steering')!.seq);lastTurn(driver).finish();await t.idle();
 });
 test('unknown outcomes never resend; timeout releases completion barrier and late acceptance is historical',async()=>{
  const {t,id,driver,writes,accept}=await steeringSession({steeringTimeoutMs:40});const sent=await t.run({type:'prompt.send',text:'May already arrive',delivery:'current-turn'} as any,id);await waitFor(()=>writes.length===1);await t.run({type:'prompt.send',text:'Next queued genuine turn'},id);driver.turns[0]!.finish();
  await waitFor(()=>driver.turns.length===2);const read=()=>loadLedger(t.manager.openLog(id)!,sessionPaths(t.paths,id).ledgerSnapshotFile).ledger;
  expect(read().prompt((sent as any).data.promptId)?.state).toBe('unknown');expect(writes).toHaveLength(1);const fence=t.events(id).find(e=>e.kind==='prompt.steering')!.seq;
  accept();await waitFor(()=>read().prompt((sent as any).data.promptId)?.steering?.state==='accepted');expect(read().prompt((sent as any).data.promptId)).toMatchObject({firstAdmissionSeq:fence,steering:{eligible:false}});
  expect(lastTurn(driver).input.prompt).toBe('Next queued genuine turn');lastTurn(driver).finish();await t.idle();expect(writes).toHaveLength(1);
 });
 test('completion before acknowledgement settles history on the original attempt, never grants replacement authority',async()=>{
  const {t,id,driver,writes,accept,call}=await steeringSession();const sent=await t.run({type:'prompt.send',text:'Late receipt',delivery:'current-turn'} as any,id);await waitFor(()=>writes.length===1);driver.turns[0]!.finish();await Bun.sleep(5);
  accept();await waitFor(()=>driver.turns[0]!.closed);const prompt=loadLedger(t.manager.openLog(id)!,sessionPaths(t.paths,id).ledgerSnapshotFile).ledger.prompt((sent as any).data.promptId)!;
  expect(prompt.steering).toMatchObject({state:'accepted',eligible:false});expect(prompt.state).toBe('completed');expect(await call('deck_decision_list',{})).toMatchObject({ok:false,code:'credential-revoked'});
 });
 test('release with in-flight delivery preserves uncertainty and queued pause, without a second route',async()=>{
  const {t,id,driver,writes,accept}=await steeringSession({steeringTimeoutMs:30});const sent=await t.run({type:'prompt.send',text:'Pending when closed',delivery:'current-turn'} as any,id);await waitFor(()=>writes.length===1);await t.run({type:'session.release'},id);await t.idle();accept();await Bun.sleep(10);
  const prompt=loadLedger(t.manager.openLog(id)!,sessionPaths(t.paths,id).ledgerSnapshotFile).ledger.prompt((sent as any).data.promptId)!;expect(prompt.steering?.eligible).toBe(false);expect(writes).toHaveLength(1);expect(driver.turns).toHaveLength(1);expect((await t.manager.query('prompts.list',{sessionId:id}) as any).data.paused).toBe(true);
 });
 test('unsupported versions keep explicit-current intent in the ordinary queue',async()=>{
  const {t,id,driver,writes}=await steeringSession({},'0.162.2');expect(driver.turns[0]!.input.steeringVersion).toBeUndefined();await t.run({type:'prompt.send',text:'Queue on unverified version',delivery:'current-turn'} as any,id);expect(writes).toHaveLength(0);expect((await t.manager.query('prompts.list',{sessionId:id}) as any).data.steeringAvailable).toBe(false);driver.turns[0]!.finish();await waitFor(()=>driver.turns.length===2);lastTurn(driver).finish();await t.idle();
 });
 test('every committed steering prefix retains original input without false admission',async()=>{
  const {t,id,driver,writes,accept}=await steeringSession();const sent=await t.run({type:'prompt.send',text:'Durable native input',delivery:'current-turn'} as any,id);await waitFor(()=>writes.length===1);accept();await waitFor(()=>t.events(id).some(e=>e.kind==='prompt.steered'));
  const events=t.events(id),fence=events.find(e=>e.kind==='prompt.steering')!,accepted=events.find(e=>e.kind==='prompt.steered')!;
  for(let length=fence.seq;length<=events.length;length++){const l=Ledger.empty(id);for(const e of events.slice(0,length))l.apply(e);const p=l.prompt((sent as any).data.promptId)!;expect(p.text).toBe('Durable native input');expect(p.firstAdmissionSeq).toBe(length>=accepted.seq?fence.seq:undefined);expect(p.state).not.toBe('queued');}
  driver.turns[0]!.finish();await t.idle();
 });

 test('free-text authority age is the fence even when the decision is opened only after native write',async()=>{
  const {t,id,driver,writes,accept,call}=await steeringSession();const sent=await t.run({type:'prompt.send',text:'An earlier statement',delivery:'current-turn'} as any,id);await waitFor(()=>writes.length===1);
  const source=t.events(id).find(e=>e.kind==='prompt.dispatched')!.data.promptId;const decisionId=(await call('deck_decision_open',{commandId:'new-after-write',key:'after-write',question:'A new question?',source:{promptId:source}}) as any).data.decisionId;
  accept();await waitFor(()=>t.events(id).some(e=>e.kind==='prompt.steered'));expect(await call('deck_decision_resolve',{commandId:'cannot-refresh-free',decisionId,expectedRevision:1,promptId:(sent as any).data.promptId,note:'Earlier than the question',disposition:'informational'})).toMatchObject({ok:false,code:'decision-evidence-invalid'});lastTurn(driver).finish();await t.idle();
 });
 test('history reconciliation after substantive revision retains original sequence and stale targeting',async()=>{
  const {t,id,driver,writes,resolve,call,setReconcile}=await steeringSession();let confirm!:(m:any)=>void;setReconcile(()=>new Promise(r=>{confirm=r;}));
  const source=t.events(id).find(e=>e.kind==='prompt.dispatched')!.data.promptId,decisionId=(await call('deck_decision_open',{commandId:'history-question',key:'history-question',question:'Original?',source:{promptId:source}}) as any).data.decisionId;
  const sent=await t.run({type:'prompt.send',text:'Original answer',delivery:'current-turn',decisionTarget:{decisionId,revision:1}} as any,id);await waitFor(()=>writes.length===1);resolve({state:'unknown',reason:'lost-receipt'});await waitFor(()=>!!confirm);
  await call('deck_decision_revise',{commandId:'changed-before-history',decisionId,expectedRevision:1,question:'Different?',note:'Changed'});confirm({state:'accepted',...writes[0],via:'history'});await waitFor(()=>t.events(id).some(e=>e.kind==='prompt.steered'));
  const fence=t.events(id).find(e=>e.kind==='prompt.steering')!,p=loadLedger(t.manager.openLog(id)!,sessionPaths(t.paths,id).ledgerSnapshotFile).ledger.prompt((sent as any).data.promptId)!;expect(p.firstAdmissionSeq).toBe(fence.seq);expect(p.steering).toMatchObject({eligible:false,stale:true});expect(writes).toHaveLength(1);lastTurn(driver).finish();await t.idle();
 });
 test('opaque or mismatched acceptance is uncertain and native events cannot forge host admission',async()=>{
  const {t,id,driver,writes,resolve}=await steeringSession();const sent=await t.run({type:'prompt.send',text:'Cannot mis-correlate',delivery:'current-turn'} as any,id);await waitFor(()=>writes.length===1);
  lastTurn(driver).emit('prompt.steered',{promptId:(sent as any).data.promptId,state:'accepted',eligible:true});expect(t.events(id).filter(e=>e.kind==='prompt.steered')).toHaveLength(0);
  resolve({state:'accepted',...writes[0],nativeTurnId:'foreign',via:'receipt'});await waitFor(()=>t.events(id).some(e=>e.kind==='prompt.steered'));expect((await t.manager.query('prompts.list',{sessionId:id}) as any).data.deliveries).toMatchObject([{state:'unknown'}]);expect(writes).toHaveLength(1);lastTurn(driver).finish();await t.idle();
 });
 for(const fault of ['append','flush'] as const)test(`${fault} failure at the steering fence prevents native write; retained fence recovers uncertain without replay`,async()=>{
  const {t,id,driver,writes}=await steeringSession();const log=t.manager.openLog(id)!,append=log.appendMany.bind(log),flush=log.flush.bind(log);let promptId='';
  if(fault==='append')log.appendMany=drafts=>{const value=append(drafts);if(drafts.some(d=>d.kind==='prompt.steering'))throw Error('retained-fence-append-failure');return value;};
  else log.flush=()=>{if(t.events(id).some(e=>e.kind==='prompt.steering'))throw Error('fence-flush-failure');flush();};
  await expect(t.run({type:'prompt.send',text:'Durable uncertain prefix',delivery:'current-turn'} as any,id)).rejects.toThrow();log.appendMany=append;log.flush=flush;expect(writes).toHaveLength(0);promptId=String(t.events(id).find(e=>e.kind==='prompt.steering')!.data.promptId);
  lastTurn(driver).finish();await t.idle();await t.manager.close();const next=setup({dir:t.dir,driver:new FakeDriver('codex')});await waitFor(()=>next.events(id).some(e=>e.kind==='prompt.steered'&&e.data.state==='unknown'));
  const snapshot=await next.manager.query('prompts.list',{sessionId:id}) as any;expect(snapshot.data.queued).toHaveLength(0);expect(snapshot.data.deliveries).toMatchObject([{promptId,state:'unknown'}]);expect(next.driver.turns).toHaveLength(0);
  expect(await next.runWithId(promptId,{type:'prompt.send',text:'Durable uncertain prefix',delivery:'current-turn'} as any,id)).toMatchObject({ok:true,duplicate:true});expect(next.driver.turns).toHaveLength(0);
  const before=next.events(id).length;await next.manager.query('prompts.list',{sessionId:id});expect(next.events(id)).toHaveLength(before);
 });
 test('paused input and attachments stay queued; typed identity survives receipt eviction',async()=>{
  const {t,id,driver,writes}=await steeringSession();t.manager.openLog(id)!.append({kind:'prompt.queue',data:{paused:true,reason:'fixture-pause'}});
  const sent=await t.run({type:'prompt.send',text:'Paused current-turn intent',delivery:'current-turn'} as any,id);expect(writes).toHaveLength(0);await t.run({type:'prompt.cancel',promptId:(sent as any).data.promptId},id);await t.run({type:'prompt.resume'},id);
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==','base64'),image=(t.manager.uploadAttachment({sessionId:id,bytes:png,mimeType:'image/png',name:'fixture.png'}) as any).data.attachment;
  const uploaded=await t.run({type:'prompt.send',text:'Image stays queued',attachmentIds:[image.attachmentId],delivery:'current-turn'} as any,id);expect(writes).toHaveLength(0);
  t.manager.openLog(id)!.appendMany(Array.from({length:1001},(_,i)=>({kind:'command.accepted' as const,data:{commandId:`steer-eviction-${i}`,type:'fixture',outcome:{ok:true}}})));
  expect(await t.runWithId((uploaded as any).data.promptId,{type:'prompt.resume'},id)).toMatchObject({ok:false,code:'command-id-reused'});
  lastTurn(driver).finish();await waitFor(()=>driver.turns.length===2);expect(lastTurn(driver).input.images).toHaveLength(1);lastTurn(driver).finish();await t.idle();
 });

 test('a genuine input added to a synthetic continuation independently qualifies without promoting its original context',async()=>{
  const {t,id,driver,writes,accept,call}=await steeringSession();const original=t.events(id).find(e=>e.kind==='prompt.dispatched')!.data.promptId;
  const decisionId=(await call('deck_decision_open',{commandId:'wake-question',key:'wake-question',question:'Proceed after review?',source:{promptId:original}}) as any).data.decisionId;
  driver.turns[0]!.finish();await t.idle();await t.manager.execute({sessionId:id,clientId:'daemon',command:{v:1,commandId:'90909090-9090-4090-8090-909090909090',type:'prompt.send',text:'Synthetic outcome context'}});await waitFor(()=>driver.turns.length===2);lastTurn(driver).init();
  const grant=t.credentials.lookup(JSON.parse(readFileSync(sessionPaths(t.paths,id).taskCredentialFile('lead'),'utf8')).token)!;
  const invoke=(promptId:string,commandId:string)=>t.manager.callTaskTool(grant,'deck_decision_resolve',{commandId,decisionId,expectedRevision:1,promptId,note:'Explicit current input',disposition:'informational'});
  expect(await invoke(String(original),'cannot-use-earlier')).toMatchObject({ok:false});
  const sent=await t.run({type:'prompt.send',text:'My genuine answer during review',delivery:'current-turn'} as any,id);await waitFor(()=>writes.length===1);accept();await waitFor(()=>t.events(id).some(e=>e.kind==='prompt.steered'));
  expect(await invoke((sent as any).data.promptId,'genuine-added-answer')).toMatchObject({ok:true});lastTurn(driver).finish();await t.idle();
 });
 test('an accepted current-attempt user input can explicitly replan linked continuation without replacing original prompt',async()=>{
  const {t,id,driver,writes,accept,call}=await steeringSession();const taskId=(await call('deck_delegate',{agent:'investigate',task:'Prepare independent evidence'}) as any).data.taskId;await waitFor(()=>driver.turns.length===2);lastTurn(driver).say('Evidence');lastTurn(driver).finish();await waitFor(()=>lastTurn(driver).closed);await call('deck_task_result',{taskId});
  const source=t.events(id).find(e=>e.kind==='prompt.dispatched')!.data.promptId;await call('deck_decision_open',{commandId:'replan-link',key:'replan-link',question:'May this task continue?',source:{promptId:source},relatedTaskIds:[taskId]});
  const sent=await t.run({type:'prompt.send',text:'Replan this task as independent work',delivery:'current-turn'} as any,id);await waitFor(()=>writes.length===1);accept();await waitFor(()=>t.events(id).some(e=>e.kind==='prompt.steered'));
  expect(await call('deck_delegate',{commandId:'12121212-1212-4212-8212-121212121212',agent:'investigate',task:'Independent continuation',continueTaskId:taskId,dependsOn:[],replan:{promptId:(sent as any).data.promptId,note:'User explicitly requested independent work'}})).toMatchObject({ok:true});
  await waitFor(()=>driver.turns.length===3);lastTurn(driver).say('Continued');lastTurn(driver).finish();await waitFor(()=>lastTurn(driver).closed);await call('deck_task_result',{taskId});expect(driver.turns[0]!.input.prompt).toBe('Original user instruction');driver.turns[0]!.finish();await t.idle();
 });

 test('a verified refusal after barrier expiry is historical non-delivery and never queues a third turn',async()=>{
  const {t,id,driver,writes,resolve}=await steeringSession({steeringTimeoutMs:30});const sent=await t.run({type:'prompt.send',text:'Expired old input',delivery:'current-turn'} as any,id);await waitFor(()=>writes.length===1);
  await t.run({type:'prompt.send',text:'Later turn admitted after barrier'},id);driver.turns[0]!.finish();await waitFor(()=>driver.turns.length===2);
  resolve({state:'not-accepted',reason:'no-active-turn'});await waitFor(()=>(t.events(id).filter(e=>e.kind==='prompt.steered').at(-1)?.data.state)==='not-accepted');
  const snapshot=await t.manager.query('prompts.list',{sessionId:id}) as any;expect(snapshot.data.queued).toHaveLength(0);expect(snapshot.data.deliveries).toMatchObject([{promptId:(sent as any).data.promptId,state:'not-accepted'}]);
  lastTurn(driver).finish();await t.idle();expect(driver.turns).toHaveLength(2);expect(writes).toHaveLength(1);
  const p=loadLedger(t.manager.openLog(id)!,sessionPaths(t.paths,id).ledgerSnapshotFile).ledger.prompt((sent as any).data.promptId)!;expect(p.state).toBe('failed');expect(p.firstAdmissionSeq).toBeUndefined();expect(p.dispatchedSeq).toBeUndefined();expect(p.steering).toMatchObject({state:'not-accepted',queueFallback:false});
 });
 for(const fault of ['append','flush'] as const)test(`late refusal ${fault} failure retains historical non-delivery on restart without replay`,async()=>{
  const {t,id,driver,writes,resolve}=await steeringSession({steeringTimeoutMs:30});const sent=await t.run({type:'prompt.send',text:'Do not replay after refusal',delivery:'current-turn'} as any,id);await waitFor(()=>writes.length===1);driver.turns[0]!.finish();await waitFor(()=>driver.turns[0]!.closed);
  const log=t.manager.openLog(id)!,append=log.appendMany.bind(log),flush=log.flush.bind(log);let failed=false;
  if(fault==='append')log.appendMany=drafts=>{const result=append(drafts);if(drafts.some(d=>d.kind==='prompt.steered'&&d.data?.state==='not-accepted')){failed=true;throw Error('retained-refusal-append-failure');}return result;};
  else log.flush=()=>{if(t.events(id).some(e=>e.kind==='prompt.steered'&&e.data.state==='not-accepted')){failed=true;throw Error('retained-refusal-flush-failure');}flush();};
  resolve({state:'not-accepted',reason:'no-active-turn'});await waitFor(()=>failed);log.appendMany=append;log.flush=flush;await t.manager.close();
  const next=setup({dir:t.dir,driver:new FakeDriver('codex')});const snapshot=await next.manager.query('prompts.list',{sessionId:id}) as any;expect(snapshot.data.queued).toHaveLength(0);expect(snapshot.data.deliveries).toMatchObject([{promptId:(sent as any).data.promptId,state:'not-accepted'}]);expect(next.driver.turns).toHaveLength(0);
  expect(await next.runWithId((sent as any).data.promptId,{type:'prompt.send',text:'Do not replay after refusal',delivery:'current-turn'} as any,id)).toMatchObject({ok:true,duplicate:true});expect(next.driver.turns).toHaveLength(0);expect(driver.turns).toHaveLength(1);
 });
 test('history absence or an unverified history refusal cannot justify a fallback route',async()=>{
  const {t,id,driver,writes,resolve,setReconcile}=await steeringSession();setReconcile(async()=>({state:'not-accepted',reason:'no-active-turn'}));await t.run({type:'prompt.send',text:'No proof of refusal',delivery:'current-turn'} as any,id);await waitFor(()=>writes.length===1);resolve({state:'unknown',reason:'opaque'});await waitFor(()=>t.events(id).some(e=>e.kind==='prompt.steered'));
  expect((await t.manager.query('prompts.list',{sessionId:id}) as any).data.queued).toHaveLength(0);expect(t.events(id).filter(e=>e.kind==='prompt.steered').at(-1)?.data.state).toBe('unknown');lastTurn(driver).finish();await t.idle();
 });

 test('pre-ID submission remains queued after readiness appears rather than retargeting a native turn',async()=>{
  const {t,id,driver,writes,setTargetAvailable}=await steeringSession();setTargetAvailable(false);await t.run({type:'prompt.send',text:'Sent before native identity was ready',delivery:'current-turn'} as any,id);setTargetAvailable(true);lastTurn(driver).emit('diagnostic',{code:'codex-steering-ready'});
  expect(writes).toHaveLength(0);expect((await t.manager.query('prompts.list',{sessionId:id}) as any).data.queued).toHaveLength(1);driver.turns[0]!.finish();await waitFor(()=>driver.turns.length===2);expect(lastTurn(driver).input.prompt).toBe('Sent before native identity was ready');expect(writes).toHaveLength(0);lastTurn(driver).finish();await t.idle();
 });

});
