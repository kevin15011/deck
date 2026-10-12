import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { CrossRunnerConfig } from "@deck/core/config/deck-config";
import type { SessionEvent } from "@deck/core/session/events";
import { ControlClient } from "../control-client";
import { startDaemon, type RunningDaemon } from "../daemon";
import { ensureStateLayout, resolveStatePaths } from "../paths";
import { SessionManager } from "../session-manager";
import { FakeDriver } from "../testing/fake-driver";
import { cleanupTempDirs, tempDir, tempSubdir, waitFor } from "./test-helpers";

const ANCHOR_ENTRY = join(import.meta.dir, "fixtures", "anchor-entry.ts");
const running: RunningDaemon[] = [];
const clients: ControlClient[] = [];
afterEach(async () => {
  for (const c of clients.splice(0)) c.close();
  await Promise.all(running.splice(0).map((d) => d.stop("test-cleanup")));
  cleanupTempDirs();
});

const config: CrossRunnerConfig = {
  enabled: true, members: { lead: { runnerId: "claude", modelId: "opus" } }, approvals: { claude: "relay" }, maxConcurrentTasks: 4,
  web: { port: 7421, trustedProxy: null, allowedOrigins: [], allowFunnel: false }, claudeTosAcknowledgedAt: "2026-10-12T00:00:00.000Z",
};

async function boot() {
  const base = tempDir();
  const paths = resolveStatePaths({ env: { HOME: base, XDG_STATE_HOME: join(base, "state") }, tmpdir: base });
  ensureStateLayout(paths);
  const project = tempSubdir(base, "project");
  const driver = new FakeDriver();
  const result = await startDaemon({
    paths, version: "1.0.0", anchorCommand: [process.execPath, "run", ANCHOR_ENTRY],
    createService: (s) => new SessionManager({
      paths: s.paths, broker: s.broker, credentials: s.credentials, supervisor: s.supervisor, clock: s.clock, logger: s.logger,
      drivers: { get: (id) => (id === "claude" ? driver : undefined), list: () => [driver] },
      config: () => config, sessionMcpCommand: ["/bin/deck", "internal", "session-mcp"],
    }),
  });
  if (!result.ok) throw new Error("daemon did not start");
  running.push(result.daemon);
  const client = await ControlClient.connect(paths.socket.path);
  clients.push(client);
  return { paths, project, driver, daemon: result.daemon, client };
}
const cmd = (body: Record<string, unknown>) => ({ v: 1, commandId: crypto.randomUUID(), ...body });

describe("SessionManager inside the real daemon (production composition)", () => {
  test("create, attach, prompt and stream a turn over the control socket; a duplicate commandId is a no-op", async () => {
    const { client, project, driver } = await boot();
    const created = await client.command(cmd({ type: "session.create", projectRoot: project }));
    expect(created.outcome.ok).toBe(true);
    const sessionId = (created.outcome as { data: { sessionId: string } }).data.sessionId;

    const events: SessionEvent[] = [];
    await client.attach(sessionId, 0, { onEvent: (e) => { events.push(e); } });
    const prompt = cmd({ type: "prompt.send", text: "hello" });
    expect((await client.command(prompt, sessionId)).outcome).toMatchObject({ ok: true, data: { taskId: "lead" } });
    await waitFor(() => driver.turns.length === 1, 3000, "turn start");
    const turn = driver.turns[0]!;
    turn.init(); turn.say("hi there"); turn.finish();
    await waitFor(() => events.some((e) => e.kind === "turn.completed"), 5000, "turn.completed");
    expect(events.map((e) => e.kind)).toContain("task.result");
    const again = await client.command(prompt, sessionId);
    expect(again.duplicate).toBe(true);
    expect(driver.turns).toHaveLength(1);

    const list = await client.query("sessions.list");
    expect(list).toMatchObject({ ok: true, data: { sessions: [{ sessionId, state: "idle", lead: { runnerId: "claude" } }] } });
    const status = await client.query("drivers.status");
    expect(status).toMatchObject({ ok: true, data: { enabled: true, drivers: [{ runnerId: "claude" }] } });
  });

  test("the approval relay works end to end: bridge call blocks, the client answers, the child gets the decision", async () => {
    const { client, project, driver } = await boot();
    const sessionId = ((await client.command(cmd({ type: "session.create", projectRoot: project }))).outcome as { data: { sessionId: string } }).data.sessionId;
    const events: SessionEvent[] = [];
    await client.attach(sessionId, 0, { onEvent: (e) => { events.push(e); } });
    await client.command(cmd({ type: "prompt.send", text: "run ls" }), sessionId);
    await waitFor(() => driver.turns.length === 1, 3000, "turn start");
    const turn = driver.turns[0]!;
    const { token } = JSON.parse(readFileSync(turn.input.credentialFile, "utf8")) as { token: string };

    const bridge = await ControlClient.connect((JSON.parse(readFileSync(turn.input.credentialFile, "utf8")) as { socketPath: string }).socketPath);
    clients.push(bridge);
    const pending = bridge.request({ t: "bridge.call", token, tool: "deck_approve", arguments: { tool_name: "Bash", input: { command: "ls" } } }, 10_000);
    await waitFor(() => events.some((e) => e.kind === "approval.requested"), 5000, "approval.requested");
    const approvalId = events.find((e) => e.kind === "approval.requested")!.data.approvalId as string;
    expect((await client.command(cmd({ type: "approval.respond", approvalId, decision: "allow-once" }), sessionId)).outcome.ok).toBe(true);
    expect(await pending).toMatchObject({ t: "bridge.result", outcome: { ok: true, data: { behavior: "allow", updatedInput: { command: "ls" } } } });
    expect(events.find((e) => e.kind === "approval.resolved")?.data).toMatchObject({ approvalId, decision: "allow-once" });

    // the credential stops working once the turn ends
    turn.finish();
    await waitFor(() => events.some((e) => e.kind === "turn.completed"), 5000, "turn.completed");
    expect(await bridge.request({ t: "bridge.call", token, tool: "deck_status" })).toMatchObject({ outcome: { ok: false, code: "credential-revoked" } });
  });

  test("a graceful daemon stop interrupts a running turn and the next daemon continues the session", async () => {
    const { client, project, driver, daemon, paths } = await boot();
    const sessionId = ((await client.command(cmd({ type: "session.create", projectRoot: project }))).outcome as { data: { sessionId: string } }).data.sessionId;
    await client.command(cmd({ type: "prompt.send", text: "long" }), sessionId);
    await waitFor(() => driver.turns.length === 1, 3000, "turn start");
    driver.turns[0]!.onInterrupt = undefined;
    const stopping = daemon.stop("test");
    setTimeout(() => driver.turns[0]!.finish({ status: "failed", error: "killed by shutdown" }), 50);
    await stopping;
    running.splice(0);

    const second = new FakeDriver();
    const restarted = await startDaemon({
      paths, version: "1.0.0", anchorCommand: [process.execPath, "run", ANCHOR_ENTRY],
      createService: (s) => new SessionManager({
        paths: s.paths, broker: s.broker, credentials: s.credentials, supervisor: s.supervisor, clock: s.clock,
        drivers: { get: () => second, list: () => [second] }, config: () => config, sessionMcpCommand: ["/bin/deck"],
      }),
    });
    if (!restarted.ok) throw new Error("restart failed");
    running.push(restarted.daemon);
    const c2 = await ControlClient.connect(paths.socket.path);
    clients.push(c2);
    expect((await c2.command(cmd({ type: "prompt.send", text: "continue" }), sessionId)).outcome).toMatchObject({ ok: true, data: { attempt: 2 } });
    await waitFor(() => second.turns.length === 1, 3000, "second turn");
    second.turns[0]!.finish();
  });
});
