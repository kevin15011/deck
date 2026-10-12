import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { CrossRunnerConfig } from "@deck/core/config/deck-config";
import type { SessionCommandBody } from "@deck/core/session/commands";
import type { SessionEvent } from "@deck/core/session/events";
import { ApprovalBroker } from "../approval-broker";
import { CredentialRegistry } from "../credentials";
import { ensureStateLayout, resolveStatePaths, sessionPaths } from "../paths";
import { createNodeProbe } from "../process-probe";
import { recoverAllSessions } from "../recovery";
import { SessionManager, type SessionManagerOptions } from "../session-manager";
import { Supervisor } from "../supervisor";
import { FakeDriver, type FakeTurn } from "../testing/fake-driver";
import { cleanupTempDirs, FakeClock, tempDir, tempSubdir, waitFor } from "./test-helpers";

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
    paths, broker, credentials, supervisor,
    drivers: { get: (runnerId) => (runnerId === driver?.runnerId ? driver : undefined), list: () => (driver ? [driver] : []) },
    config: () => state.config,
    sessionMcpCommand: ["/bin/deck", "internal", "session-mcp"],
    ...over.options,
  });
  cleanups.push(() => manager.close());
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

describe("session.create (XR-2.4, XR-3.2, XR-12.1)", () => {
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
  test("prompt.send runs one turn end to end and records the full event sequence", async () => {
    const t = setup();
    t.driver.autoComplete = true;
    const sessionId = await t.create();
    const seenAtStart: SessionEvent[] = [];
    t.driver.onStart = () => { seenAtStart.push(...t.events(sessionId)); };
    const r = await t.run({ type: "prompt.send", text: "hello" }, sessionId);
    expect(r).toMatchObject({ ok: true, data: { taskId: "lead", attempt: 1 } });
    await t.idle();

    expect(t.kinds(sessionId)).toEqual([
      "session.created",
      "command.accepted", "session.state", "message.completed", "task.created", "task.state",
      "turn.started", "message.completed", "usage",
      "turn.completed", "task.result", "task.state", "session.state",
    ]);
    const ev = t.events(sessionId);
    expect(ev[3]).toMatchObject({ kind: "message.completed", data: { role: "user", text: "hello" } });
    expect(ev[4]).toMatchObject({ kind: "task.created", source: { taskId: "lead", memberId: "lead", runnerId: "claude" }, data: { runnerId: "claude", modelId: "opus", thinking: "high" } });
    expect(ev[7]).toMatchObject({ kind: "message.completed", source: { taskId: "lead", memberId: "lead", runnerId: "claude" }, data: { role: "assistant", text: "reply to: hello" } });
    expect(ev[9]).toMatchObject({ kind: "turn.completed", data: { status: "completed" } });
    expect(ev[10]).toMatchObject({ kind: "task.result", data: { taskId: "lead", summary: "reply to: hello" } });
    expect(ev[11]).toMatchObject({ kind: "task.state", data: { taskId: "lead", state: "completed" } });
    expect(ev[12]).toMatchObject({ kind: "session.state", data: { state: "idle" } });
    expect(ev.map((e, i) => e.seq === i + 1).every(Boolean)).toBe(true);

    // XR-4.5: the native session id was persisted before the driver started
    const nativeId = (ev[4]!.data as { nativeSessionId?: string }).nativeSessionId;
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
    expect(input.mcp.sessionTools).toEqual(["deck_approve", "deck_status"]);
    const spec = input.mcpServerSpecs.deck!;
    expect(spec.command).toBe("/bin/deck");
    expect(spec.args).toEqual(["internal", "session-mcp"]);
    expect(spec.env.DECK_SESSION_CREDENTIAL_FILE).toBe(input.credentialFile);
    expect(input.credentialFile).toBe(sessionPaths(t.paths, sessionId).taskCredentialFile("lead"));
    expect(lstatSync(input.credentialFile).mode & 0o777).toBe(0o600);
    const { token } = JSON.parse(readFileSync(input.credentialFile, "utf8")) as { token: string };
    expect(t.credentials.lookup(token)).toMatchObject({ sessionId, taskId: "lead", memberId: "lead", allowedTools: ["deck_approve", "deck_status"] });
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
    expect(r2).toMatchObject({ ok: true, data: { taskId: "lead", attempt: 2 } });
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
    await t.run({ type: "prompt.send", text: "two" }, sessionId);
    expect(lastTurn(t.driver).input.resume).toBeUndefined();
    expect(lastTurn(t.driver).input.nativeSessionId).toBe(id);
    lastTurn(t.driver).finish();
    await t.idle();
  });

  test("a second prompt while a turn runs is refused and records nothing", async () => {
    const t = setup();
    const sessionId = await t.create();
    await t.run({ type: "prompt.send", text: "one" }, sessionId);
    const before = t.kinds(sessionId).length;
    expect(await t.run({ type: "prompt.send", text: "two" }, sessionId)).toMatchObject({ ok: false, code: "turn-in-progress" });
    expect(t.kinds(sessionId)).toHaveLength(before);
    lastTurn(t.driver).finish();
    await t.idle();
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
    expect(ev.at(-1)).toMatchObject({ kind: "session.state", data: { state: "idle" } });
    // the task can be continued after a failure
    expect(await t.run({ type: "prompt.send", text: "again" }, sessionId)).toMatchObject({ ok: true, data: { attempt: 2 } });
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
    expect(first).toMatchObject({ ok: true, data: { taskId: "lead", attempt: 1 } });
    await a.idle();
    expect(a.driver.turns).toHaveLength(1);
    await a.manager.close();

    // "restart": a brand new manager (empty in-memory caches) over the same state directory
    const b = setup({ dir });
    b.driver.autoComplete = true;
    const again = await b.runWithId(C_PROMPT, { type: "prompt.send", text: "hello" }, sessionId);
    expect(again).toMatchObject({ ok: true, duplicate: true, data: { taskId: "lead", attempt: 1 } });
    expect(b.driver.turns).toHaveLength(0);
    expect(b.kinds(sessionId).filter((k) => k === "task.created" || k === "task.continued")).toHaveLength(1);

    // a NEW commandId is a genuinely new command
    expect(await b.run({ type: "prompt.send", text: "next" }, sessionId)).toMatchObject({ ok: true, data: { attempt: 2 } });
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
    expect(await t.runWithId(C_PROMPT, { type: "prompt.send", text: "two" }, sessionId)).toMatchObject({ ok: false, code: "turn-in-progress" });
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
    expect(await b.run({ type: "prompt.send", text: "again" }, sessionId)).toMatchObject({ ok: false, code: "ownership-unsettled" });
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
    const r = await a.run({ type: "prompt.send", text: "again" }, sessionId);
    expect(r).toMatchObject({ ok: true, data: { attempt: 2 } });
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
