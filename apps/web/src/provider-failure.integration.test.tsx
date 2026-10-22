import React from "react";
import { afterEach, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { DriverHostIo, DriverTaskInput, RunnerSessionDriver } from "../../../packages/core/src/session/driver";
import type { SessionCommandBody } from "../../../packages/core/src/session/commands";
import { createCodexSessionDriver } from "../../../packages/adapter-codex/src/session-driver/driver";
import { nativeCodexMcpId, ISOLATION_FEATURES } from "../../../packages/adapter-codex/src/session-driver/launch";
import { harness as codexHarness } from "../../../packages/adapter-codex/src/session-driver/test-support";
import overloadIncident from "../../../packages/adapter-codex/src/session-driver/__fixtures__/0.162.1/overload-incident.json";
import { SessionManager } from "../../../packages/session-host/src/session-manager";
import { CredentialRegistry } from "../../../packages/session-host/src/credentials";
import { ApprovalBroker } from "../../../packages/session-host/src/approval-broker";
import { Supervisor } from "../../../packages/session-host/src/supervisor";
import { ensureStateLayout, resolveStatePaths, sessionPaths } from "../../../packages/session-host/src/paths";
import { EventLog } from "../../../packages/session-host/src/event-log";
import { ChatHistory } from "../../../packages/session-host/src/chat-history";
import { cleanupTempDirs, tempDir, tempSubdir, waitFor } from "../../../packages/session-host/src/__tests__/test-helpers";
import { TurnFailureMessage } from "./turn-failure";

const managers: SessionManager[] = [];
afterEach(async () => { for (const manager of managers.splice(0)) await manager.close(); cleanupTempDirs(); });
function setup(driver: RunnerSessionDriver) {
  const dir = tempDir(), project = tempSubdir(dir, "project");
  const paths = resolveStatePaths({ env: { HOME: dir, XDG_STATE_HOME: join(dir, "state") }, tmpdir: dir }); ensureStateLayout(paths);
  let manager: SessionManager;
  const broker = new ApprovalBroker({ sink: { emit: (id, draft) => { manager.openLog(id)?.append(draft); } } });
  manager = new SessionManager({ paths, broker, credentials: new CredentialRegistry({ socketPath: paths.socket.path }),
    supervisor: new Supervisor({ anchorCommand: ["unused"] }), homeDir: dir,
    drivers: { get: id => id === "codex" ? driver : undefined, list: () => [driver] },
    config: () => ({ enabled: true, members: { lead: { runnerId: "codex", modelId: "gpt-5" } },
      claudeTosAcknowledgedAt: "2026-10-12T00:00:00.000Z",
      approvals: { codex: "runner-default", claude: "relay", opencode: "relay" }, maxConcurrentTasks: 4,
      web: { port: 7421, trustedProxy: null, allowedOrigins: [], allowFunnel: false } }),
    sessionMcpCommand: ["/bin/deck", "internal", "session-mcp"],
  }); managers.push(manager);
  const run = (command: SessionCommandBody, sessionId?: string) => manager.execute({ sessionId, clientId: "test", command: { v: 1, commandId: randomUUID(), ...command } });
  return { manager, paths, run, create: async () => { const result = await run({ type: "session.create", projectRoot: project });
    if (!result.ok) throw Error(JSON.stringify(result)); return (result.data as { sessionId: string }).sessionId; },
    events: (id: string) => [...manager.openLog(id)!.readAfter(0)], idle: () => waitFor(() => !manager.hasRunningWork()) };
}

  test.each([false, true])("native overload survives the real Codex→host→live/history UI path (notification fallback %s)", async fallback => {
    let server = "";
    const h = codexHarness((child, _index, m) => {
      if (m.method === "initialize") child.stdout({ id: m.id, result: {} });
      if (m.method === "config/read") child.stdout({ id: m.id, result: { config: { features: Object.fromEntries(ISOLATION_FEATURES.map(name => [name, false])), mcp_servers: {} } } });
      if (m.method === "thread/start") child.stdout({ id: m.id, result: { thread: { id: "native-thread", historyMode: "legacy" } } });
      if (m.method === "mcpServerStatus/list") child.stdout({ id: m.id, result: { data: [{ name: server, runtimeStatus: "connected" }], nextCursor: null } });
      if (m.method === "turn/start") child.stdout({ id: m.id, result: { turn: { id: "turn" } } });
    });
    const native = createCodexSessionDriver({ baseEnv: { PATH: "/bin" }, exec: async () => ({ code: 0, stdout: "codex-cli 0.162.1" }) });
    const driver = { ...native, startTask: (input: DriverTaskInput, io: DriverHostIo) => {
      server = nativeCodexMcpId(input.taskId, "deck");
      return native.startTask(input, { ...io, spawn: h.io.spawn });
    } };
    const t = setup(driver);
    const id = await t.create(); expect(await t.run({ type: "prompt.send", text: "original" }, id)).toMatchObject({ ok: true });
    await waitFor(() => h.children.some(child => child.writes.some(m => m.method === "turn/start")));
    const log = t.manager.openLog(id)!, live = new ChatHistory(log), after = log.lastSeq;
    const child = h.children.at(-1)!;
    child.stdout({ method: "item/agentMessage/delta", params: { threadId: "native-thread", turnId: "turn", itemId: "partial", delta: "Partial work" } });
    await t.run({ type: "prompt.send", text: "queued input" }, id);
    child.stdout(overloadIncident.notification);
    child.stdout(fallback ? { ...overloadIncident.terminal, params: { ...overloadIncident.terminal.params, turn: { ...overloadIncident.terminal.params.turn, error: null } } } : overloadIncident.terminal);
    await t.idle();
    for (const event of log.readAfter(after)) live.apply(event);
    const terminal = t.events(id).find(event => event.kind === "turn.completed")!;
    const row = live.messageAt(terminal)!;
    expect(row.data).toMatchObject({ status: "failed", failure: { category: "provider-overloaded", origin: "provider", certainty: "reported", code: "serverOverloaded" } });
    expect(live.page().messages.some(row => row.data.text === "Partial work")).toBe(true);
    expect((await t.manager.query("prompts.list", { sessionId: id }) as any).data).toMatchObject({ paused: true, queued: [{ text: "queued input" }] });
    expect(h.children.flatMap(child => child.writes).filter(m => m.method === "turn/start")).toHaveLength(1);
    const html = renderToStaticMarkup(React.createElement(TurnFailureMessage, { data: row.data }));
    expect(html).toContain("Model provider at capacity"); expect(html).toContain("manually retry"); expect(html).not.toContain("Selected model at capacity.");
    const reloaded = EventLog.open({ dir: sessionPaths(t.paths, id).eventsDir, sessionId: id });
    try {
      const restored = new ChatHistory(reloaded).page().messages.find(row => row.kind === "turn.completed")!;
      expect(restored.data).toEqual(row.data);
      expect(renderToStaticMarkup(React.createElement(TurnFailureMessage, { data: restored.data }))).toBe(html);
      expect(JSON.stringify(restored.data)).not.toContain("message");
    } finally { reloaded.close(); }
  });
