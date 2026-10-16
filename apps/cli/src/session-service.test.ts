import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RunnerAdapter } from "@deck/core";
import type { DriverHostIo, DriverTaskInput, RunnerSessionDriver } from "@deck/core/session/driver";
import { ApprovalBroker, CredentialRegistry, ensureStateLayout, resolveStatePaths, Supervisor, type DaemonServices } from "@deck/session-host";
import { createDeckConfigStore } from "./deck-config-store";
import { createDefaultAdapterRegistry } from "./runner-adapters";
import { createCrossSessionDrivers, createCrossSessionService } from "./session-service";
import { acknowledgeClaudeTos } from "./session-tos";
import type { SupermemoryRuntimeHost } from "./supermemory-runtime-host";
import { execFileSync } from "node:child_process";

const roots: string[] = [];
afterEach(() => { for (const d of roots.splice(0)) rmSync(d, { recursive: true, force: true }); });

function env() {
  const home = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), "deck-svc-")));
  roots.push(home);
  const paths = resolveStatePaths({ env: { HOME: home, XDG_STATE_HOME: join(home, "state") }, tmpdir: home });
  ensureStateLayout(paths);
  const store = createDeckConfigStore({ homeDir: home, xdgConfigHome: join(home, "xdg") });
  const project = join(home, "project");
  require("node:fs").mkdirSync(project);
  const services = {
    paths, broker: new ApprovalBroker({ sink: { emit: () => {} } }), credentials: new CredentialRegistry({ socketPath: paths.socket.path }),
    supervisor: new Supervisor({ anchorCommand: ["unused"] }), clock: { now: () => Date.now(), setTimeout: setTimeout as never, clearTimeout: clearTimeout as never },
    logger: { info() {}, warn() {}, error() {} }, probe: undefined as never,
  } as unknown as DaemonServices;
  return { home, paths, store, project, services };
}

const driver = (runnerId: string): RunnerSessionDriver => ({
  runnerId, protocol: "x", testedVersions: { min: "1.0.0", maxTested: "1.0.0" },
  probe: async () => ({ status: "ready", capabilities: [] }), startTask: async () => { throw new Error("not used"); },
});
const adapter = (runnerId: string, withDriver: boolean) => ({ runnerId, ...(withDriver ? { getSessionDriver: () => driver(runnerId) } : {}) }) as unknown as RunnerAdapter;

describe("createCrossSessionDrivers (D-6: one composition root)", () => {
  test("only adapters that expose a session driver are eligible (Pi is excluded)", () => {
    const lookup = createCrossSessionDrivers([adapter("pi", false), adapter("claude", true), adapter("codex", false)]);
    expect(lookup.list().map((d) => d.runnerId)).toEqual(["claude"]);
    expect(lookup.get("claude")?.runnerId).toBe("claude");
    expect(lookup.get("pi")).toBeUndefined();
  });

  test("the production registry exposes Claude, Codex and OpenCode session drivers", () => {
    const e = env();
    const registry = createDefaultAdapterRegistry({
      claude: { homeDir: e.home, dataRoot: join(e.home, "data", "deck") },
      codex: { userHome: e.home, codexHome: join(e.home, ".codex") },
      opencode: { developerTeamConfigDir: join(e.home, ".config", "opencode"), skillDiscoveryHomeDir: e.home },
    });
    const lookup = createCrossSessionDrivers(registry.list());
    expect(lookup.list().map((value) => value.runnerId).sort()).toEqual(["claude", "codex", "opencode"]);
    expect(lookup.get("pi")).toBeUndefined();
  });

  test("a throwing adapter is skipped, not fatal", () => {
    const bad = { runnerId: "bad", getSessionDriver: () => { throw new Error("boom"); } } as unknown as RunnerAdapter;
    expect(createCrossSessionDrivers([bad, adapter("claude", true)]).list().map((d) => d.runnerId)).toEqual(["claude"]);
  });
});

describe("createCrossSessionService (production composition)", () => {
  const crossConfig = { crossRunner: { enabled: true, members: { lead: { runnerId: "claude", modelId: "opus" } } } };
  const make = (e: ReturnType<typeof env>) => {
    const registry = createDefaultAdapterRegistry({
      claude: { homeDir: e.home, dataRoot: join(e.home, "data", "deck"), sessionDriver: { exec: async () => ({ code: 0, stdout: "2.1.296 (Claude Code)" }), tosAcknowledged: () => (e.store.read().crossRunner?.claudeTosAcknowledgedAt ? true : false) } },
    });
    return createCrossSessionService(e.services, { configStore: e.store, adapters: () => registry.list(), sessionMcpCommand: ["/bin/deck", "internal", "session-mcp"] });
  };
  const create = (service: ReturnType<typeof make>, project: string) =>
    service.execute({ command: { v: 1, commandId: crypto.randomUUID(), type: "session.create", projectRoot: project }, clientId: "c" });

  test("Claude session creation does not require a subscription acknowledgement", async () => {
    const e = env();
    e.store.write(crossConfig);
    const service = make(e);
    expect(e.store.read().crossRunner?.claudeTosAcknowledgedAt).toBeNull();
    expect(await create(service, e.project)).toMatchObject({ ok: true, data: { sessionId: expect.any(String) } });
  });

  test("without crossRunner configuration nothing starts", async () => {
    const e = env();
    expect(await create(make(e), e.project)).toMatchObject({ ok: false, code: "cross-runner-not-configured" });
  });

  test("each member receives its own Deck role and the immutable change path", async () => {
    const e = env();
    const service = make(e) as unknown as { options: { rolePrompt: (m: string, c: { changeId?: string; projectRoot: string }) => string } };
    const prompt = service.options.rolePrompt("lead", { changeId: "my-change", projectRoot: e.project });
    expect(prompt).toContain("deck_delegate member ids: investigate, architect, apply-fast, apply-deep, quality; a deck- prefix is also accepted.");
    expect(service.options.rolePrompt("lead", { projectRoot: e.project, delegableMembers: ["quality", "setup"] } as any)).toContain("deck_delegate member ids: quality, setup; a deck- prefix is also accepted.");
    expect(prompt.length).toBeGreaterThan(500);
    expect(prompt).toContain("my-change");
    expect(prompt).not.toMatch(/delegation tools are not available/i);
    expect(prompt).toContain(join(e.project, "openspec", "changes", "my-change"));
    const specialist = service.options.rolePrompt("deck-quality", { changeId: "my-change", projectRoot: e.project });
    expect(specialist).toContain("# Quality (deck-quality)");
    expect(specialist).not.toBe(prompt);
  });

  test("drivers.status reports a ready Claude driver without a subscription acknowledgement", async () => {
    const e = env();
    e.store.write(crossConfig);
    const status = await make(e).query!("drivers.status", undefined);
    expect(status).toMatchObject({ ok: true, data: { enabled: true, members: { lead: { blocked: null } } } });
    const drivers = (status as { data: { drivers: unknown[] } }).data.drivers;
    expect(drivers).toContainEqual(expect.objectContaining({ runnerId: "claude", probe: expect.objectContaining({ status: "ready" }) }));
  });

  test.each(["claude", "codex", "opencode"])("project AGENTS instructions are explicitly supplied only to Claude, including resumed turns (%s)", async (runnerId) => {
    const e = env();
    e.store.write({ crossRunner: { enabled: true, members: { lead: { runnerId, modelId: "fixture" } } } });
    writeFileSync(join(e.home, "AGENTS.md"), "Ancestor instructions must not be supplied");
    const file = join(e.project, "AGENTS.md");
    const first = "# Project rules\n\nUse project-fixture-style.\n";
    writeFileSync(file, first);
    const inputs: DriverTaskInput[] = [];
    const selected = { runnerId, getSessionDriver: () => ({ ...driver(runnerId), startTask: async (input: DriverTaskInput, io: DriverHostIo) => {
      inputs.push(input);
      io.emit({ kind: "turn.started", data: {} });
      return { nativeSessionId: Promise.resolve("fixture-native-session"), done: Promise.resolve({ status: "completed" as const }), send: async () => ({ status: "completed" as const }), interrupt: async () => {}, close: async () => {} };
    } }), readSessionMcpServers: async () => ({}) } as unknown as RunnerAdapter;
    const service = createCrossSessionService(e.services, { configStore: e.store, adapters: () => [selected] });
    try {
      const sessionId = (await create(service, e.project) as { data: { sessionId: string } }).data.sessionId;
      for (let turn = 0; turn < 2; turn++) {
        if (turn) writeFileSync(file, "# Project rules\n\nUse updated-fixture-style.\n");
        await service.execute({ sessionId, clientId: "c", command: { v: 1, commandId: crypto.randomUUID(), type: "prompt.send", text: "go" } });
        for (let i = 0; i < 100 && service.hasRunningWork(); i++) await new Promise((r) => setTimeout(r, 1));
      }
      expect(inputs).toHaveLength(2);
      expect(inputs[1]?.resume).toEqual({ nativeSessionId: "fixture-native-session" });
      if (runnerId === "claude") {
        expect(inputs[0]?.rolePrompt).toContain(first);
        expect(inputs[0]?.rolePrompt.split("Use project-fixture-style.")).toHaveLength(2);
        expect(inputs[1]?.rolePrompt).toContain("Use updated-fixture-style.");
        expect(inputs[1]?.rolePrompt).not.toContain("Use project-fixture-style.");
      } else for (const input of inputs) expect(input.rolePrompt).not.toContain("fixture-style");
      for (const input of inputs) expect(input.rolePrompt).not.toContain("Ancestor instructions");
      expect(JSON.stringify([...service.openLog(sessionId)!.readAfter(0)])).not.toContain("fixture-style");
    } finally { await service.close(); }
  });

  test("unsafe project AGENTS fails visibly before starting Claude", async () => {
    const e = env();
    e.store.write(crossConfig);
    writeFileSync(join(e.home, "outside.md"), "Outside private content must not be read");
    symlinkSync(join(e.home, "outside.md"), join(e.project, "AGENTS.md"));
    let starts = 0;
    const selected = { runnerId: "claude", getSessionDriver: () => ({ ...driver("claude"), startTask: async () => { starts++; throw new Error("must not start"); } }), readSessionMcpServers: async () => ({}) } as unknown as RunnerAdapter;
    const service = createCrossSessionService(e.services, { configStore: e.store, adapters: () => [selected] });
    try {
      const sessionId = (await create(service, e.project) as { data: { sessionId: string } }).data.sessionId;
      await service.execute({ sessionId, clientId: "c", command: { v: 1, commandId: crypto.randomUUID(), type: "prompt.send", text: "go" } });
      for (let i = 0; i < 100 && service.hasRunningWork(); i++) await new Promise((r) => setTimeout(r, 1));
      expect(starts).toBe(0);
      const events = [...service.openLog(sessionId)!.readAfter(0)];
      expect(events.find((event) => event.kind === "turn.completed")?.data).toMatchObject({ status: "failed", error: expect.stringContaining("project-instructions-unavailable") });
      expect(JSON.stringify(events)).not.toContain("Outside private content");
    } finally { await service.close(); }
  });

  test("production service prepares native memory and excludes daemon tools and writes", async () => {
    const e = env();
    e.store.write({ ...crossConfig, adaptiveMemory: { enabled: true, activeProvider: "supermemory" } });
    execFileSync("git", ["init"], { cwd: e.project, stdio: "ignore" });
    execFileSync("git", ["remote", "add", "origin", "https://github.com/acme/session-fixture.git"], { cwd: e.project, stdio: "ignore" });
    let input: DriverTaskInput | undefined;
    let finish!: (outcome: { status: "completed" }) => void;
    let creations = 0, writes = 0;
    const selected = { runnerId: "claude", getSessionDriver: () => ({ ...driver("claude"), startTask: async (value: DriverTaskInput) => {
      input = value;
      const done = new Promise<{ status: "completed" }>((resolve) => { finish = resolve; });
      return { nativeSessionId: Promise.resolve("native-fixture"), done, send: async () => ({ status: "completed" }), interrupt: async () => finish({ status: "completed" }), close: async () => finish({ status: "completed" }) };
    } }), readSessionMcpServers: async () => ({ supermemory: { command: "forbidden", args: [], env: {} } }) } as unknown as RunnerAdapter;
    const service = createCrossSessionService(e.services, { configStore: e.store, adapters: () => [selected], nativeMemoryEffects: { credential: () => ({ token: "fixture-private-token", canonicalRepoTag: "sm_project_v1_acme_session_fixture" }), plugin: () => ({ plugin: { root: "/verified/plugin" }, env: { SUPERMEMORY_CC_API_KEY: "fixture-private-token", SUPERMEMORY_REPO_TAG: "sm_project_v1_acme_session_fixture" } }) }, memoryRuntime: async (context) => {
      creations++; expect(context.projectRoot).toBe(e.project);
      return { enabled: true, explicitRecall: async () => ({ ok: true, advisoryText: "Project advisory", diagnostics: [] }), explicitRemember: async () => { writes++; return { ok: true, diagnostics: [], metrics: [] }; }, recordLifecycle() {} } as unknown as SupermemoryRuntimeHost;
    } });
    try {
      const sessionId = (await create(service, e.project) as { data: { sessionId: string } }).data.sessionId;
      await service.execute({ sessionId, clientId: "c", command: { v: 1, commandId: crypto.randomUUID(), type: "prompt.send", text: "go" } });
      for (let i = 0; i < 100 && !input; i++) await new Promise((r) => setTimeout(r, 1));
      expect(input?.mcp.servers).toEqual(["deck"]);
      expect(creations).toBe(0);
      const grant = { sessionId, taskId: input!.taskId, memberId: "lead", allowedTools: input!.mcp.sessionTools };
      expect(await service.callTaskTool!(grant, "deck_memory_recall", { query: "project" }, {})).toMatchObject({ ok: false, code: "tool-not-allowed" });
      expect(await service.callTaskTool!(grant, "deck_memory_propose", { content: "Project decision" }, {})).toMatchObject({ ok: false, code: "tool-not-allowed" });
      expect(input?.nativeMemory).toMatchObject({ status: "ready", provider: "supermemory", projectScope: "sm_project_v1_acme_session_fixture" });
      expect(input?.rolePrompt).toContain("official runner plugin");
      expect(input?.rolePrompt).toContain("Deck memory tools are intentionally omitted");
      expect(input?.rolePrompt).toContain("their absence is not evidence that the Deck session MCP server disconnected");
      expect(input?.mcp.sessionTools).not.toContain("deck_memory_recall");
      expect(JSON.stringify(input)).not.toContain("fixture-private-token");
      expect(creations).toBe(0); expect(writes).toBe(0);
    } finally { await service.close(); }
  });

  test.each(["claude", "codex", "opencode"])("production service resolves the adapter's ordinary MCP servers before starting a turn (%s)", async (runnerId) => {
    const e = env();
    e.store.write({ crossRunner: { enabled: true, members: { lead: { runnerId, modelId: "fixture" } } } });
    acknowledgeClaudeTos(e.store);
    let input: DriverTaskInput | undefined;
    const fake = { ...driver(runnerId), startTask: async (value: DriverTaskInput) => { input = value; throw new Error("fixture stops here"); } };
    const selected = { runnerId, getSessionDriver: () => fake,
      readSessionMcpServers: async () => ({ "context-mode": { command: process.execPath, args: ["--fixture"], env: {} }, context7: { transport: "http", url: "https://mcp.context7.com/mcp", envHttpHeaders: { "X-Context7-API-Key": "CONTEXT7_API_KEY" } } }),
    } as unknown as RunnerAdapter;
    const service = createCrossSessionService(e.services, { configStore: e.store, adapters: () => [selected] });
    const created = await create(service, e.project);
    const sessionId = (created as { data: { sessionId: string } }).data.sessionId;
    await service.execute({ sessionId, clientId: "c", command: { v: 1, commandId: crypto.randomUUID(), type: "prompt.send", text: "go" } });
    for (let i = 0; i < 100 && service.hasRunningWork(); i++) await new Promise((r) => setTimeout(r, 1));
    expect(input?.mcp.servers).toEqual(["context-mode", "context7", "deck"]);
    expect(input?.mcpServerSpecs.context7).toEqual({ transport: "http", url: "https://mcp.context7.com/mcp", envHttpHeaders: { "X-Context7-API-Key": "CONTEXT7_API_KEY" } });
    expect(input?.mcpServerSpecs["context-mode"]).toEqual({ command: process.execPath, args: ["--fixture"], env: {} });
    await service.close();
  });

  test.each(["claude", "codex", "opencode"])("an unavailable selected MCP package fails clearly before any driver spawn (%s)", async (runnerId) => {
    const e = env();
    e.store.write({ crossRunner: { enabled: true, members: { lead: { runnerId, modelId: "fixture" } } } });
    acknowledgeClaudeTos(e.store);
    let starts = 0;
    const selected = { runnerId, getSessionDriver: () => ({ ...driver(runnerId), startTask: async () => { starts++; throw new Error("must not spawn"); } }),
      readSessionMcpServers: async () => { throw new Error("context-mode has no verified executable"); },
    } as unknown as RunnerAdapter;
    const service = createCrossSessionService(e.services, { configStore: e.store, adapters: () => [selected] });
    const created = await create(service, e.project);
    const sessionId = (created as { data: { sessionId: string } }).data.sessionId;
    await service.execute({ sessionId, clientId: "c", command: { v: 1, commandId: crypto.randomUUID(), type: "prompt.send", text: "go" } });
    for (let i = 0; i < 100 && service.hasRunningWork(); i++) await new Promise((r) => setTimeout(r, 1));
    expect(starts).toBe(0);
    expect([...service.openLog(sessionId)!.readAfter(0)].find((event) => event.kind === "turn.completed")?.data.error).toContain("context-mode has no verified executable");
    await service.close();
  });

  test.each(["claude", "codex", "opencode"])("production composition rejects an unverified selected Codebase Memory build before model startup (%s)", async (runnerId) => {
    const e = env();
    e.store.write({ crossRunner: { enabled: true, members: { lead: { runnerId, modelId: "fixture" } } } });
    let starts = 0;
    const selected = { runnerId, getSessionDriver: () => ({ ...driver(runnerId), startTask: async () => { starts++; throw new Error("must not spawn"); } }),
      readSessionMcpServers: async () => ({ "codebase-memory": { command: process.execPath, args: [], env: {} } }),
    } as unknown as RunnerAdapter;
    const service = createCrossSessionService(e.services, { configStore: e.store, adapters: () => [selected] });
    try {
      const created = await create(service, e.project);
      const sessionId = (created as { data: { sessionId: string } }).data.sessionId;
      await service.execute({ sessionId, clientId: "c", command: { v: 1, commandId: crypto.randomUUID(), type: "prompt.send", text: "go" } });
      for (let i = 0; i < 100 && service.hasRunningWork(); i++) await new Promise((r) => setTimeout(r, 1));
      expect(starts).toBe(0);
      const completion = [...service.openLog(sessionId)!.readAfter(0)].find((event) => event.kind === "turn.completed");
      expect(completion?.data).toMatchObject({ status: "failed", error: expect.stringContaining("codebase-memory-unsupported") });
    } finally { await service.close(); }
  });

  test.each(["claude", "codex", "opencode"])("concurrent sessions each retain the ordinary MCP snapshot resolved for their turn (%s)", async (runnerId) => {
    const e = env();
    e.store.write({ crossRunner: { enabled: true, members: { lead: { runnerId, modelId: "fixture" } } } });
    acknowledgeClaudeTos(e.store);
    const inputs: DriverTaskInput[] = [];
    let resolves = 0;
    const selected = { runnerId, getSessionDriver: () => ({ ...driver(runnerId), startTask: async (input: DriverTaskInput) => { inputs.push(input); throw new Error("fixture stops here"); } }),
      readSessionMcpServers: async () => ({ [`selected-${++resolves}`]: { command: process.execPath, args: [], env: {} } }),
    } as unknown as RunnerAdapter;
    const service = createCrossSessionService(e.services, { configStore: e.store, adapters: () => [selected] });
    const a = (await create(service, e.project) as { data: { sessionId: string } }).data.sessionId;
    const b = (await create(service, e.project) as { data: { sessionId: string } }).data.sessionId;
    await Promise.all([a, b].map((sessionId, i) => service.execute({ sessionId, clientId: "c", command: { v: 1, commandId: crypto.randomUUID(), type: "prompt.send", text: String(i) } })));
    for (let i = 0; i < 100 && service.hasRunningWork(); i++) await new Promise((r) => setTimeout(r, 1));
    expect(inputs.find((input) => input.prompt === "0")?.mcp.servers).toEqual(["selected-1", "deck"]);
    expect(inputs.find((input) => input.prompt === "1")?.mcp.servers).toEqual(["selected-2", "deck"]);
    await service.close();
  });
});
