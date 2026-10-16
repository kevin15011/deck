import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { RunnerAdapter } from "@deck/core";
import type { DriverHostIo, DriverTaskInput, RunnerSessionDriver } from "@deck/core/session/driver";
import { ControlClient, resolveStatePaths, startDaemon, type RunningDaemon, type StatePaths } from "@deck/session-host";
import { createDeckConfigStore } from "./deck-config-store";
import { formatSessionList, runWebWorkspace, runCrossLaunch, runSessionCommand, type SessionCommandDeps } from "./session-commands";
import { createCrossSessionService } from "./session-service";

const ANCHOR_ENTRY = resolve(import.meta.dir, "../../../packages/session-host/src/__tests__/fixtures/anchor-entry.ts");
const roots: string[] = [];
const daemons: RunningDaemon[] = [];
afterEach(async () => {
  await Promise.all(daemons.splice(0).map((d) => d.stop("test")));
  for (const d of roots.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A driver that answers every prompt with `echo: <prompt>` and honours interrupts. */
function echoDriver(): RunnerSessionDriver & { starts: DriverTaskInput[] } {
  const starts: DriverTaskInput[] = [];
  return {
    runnerId: "claude", protocol: "fake", testedVersions: { min: "1", maxTested: "1" }, starts,
    newNativeSessionId: () => crypto.randomUUID(),
    probe: async () => ({ status: "ready", version: "2.1.296", capabilities: [], mcpIsolationVerified: true }),
    async startTask(input: DriverTaskInput, io: DriverHostIo) {
      starts.push(input);
      queueMicrotask(() => {
        io.emit({ kind: "turn.started", data: { nativeSessionId: input.nativeSessionId ?? input.resume?.nativeSessionId } });
        io.emit({ kind: "message.completed", data: { text: `echo: ${input.prompt}` } });
      });
      const done = new Promise<{ status: "completed" }>((resolveDone) => setTimeout(() => resolveDone({ status: "completed" }), 30));
      return { nativeSessionId: Promise.resolve(input.nativeSessionId ?? "n"), send: async () => ({ status: "completed" as const }), interrupt: async () => {}, done, close: async () => {} };
    },
  };
}

async function boot(options: { configured?: boolean; web?: boolean } = {}) {
  const home = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), "deck-cmd-")));
  roots.push(home);
  const paths = resolveStatePaths({ env: { HOME: home, XDG_STATE_HOME: join(home, "state") }, tmpdir: home });
  const store = createDeckConfigStore({ homeDir: home, xdgConfigHome: join(home, "xdg") });
  if (options.configured !== false) store.write({ crossRunner: { enabled: true, members: { lead: { runnerId: "claude", modelId: "opus" } }, claudeTosAcknowledgedAt: "2026-10-12T00:00:00.000Z" } });
  const project = join(home, "project");
  mkdirSync(project);
  const driver = echoDriver();
  const adapter = { runnerId: "claude", getSessionDriver: () => driver } as unknown as RunnerAdapter;
  const result = await startDaemon({
    ...(options.web ? {web:{config:{port:0,trustedProxy:null,allowedOrigins:[],allowFunnel:false}}} : {}),
    paths, version: "1.0.0", anchorCommand: [process.execPath, "run", ANCHOR_ENTRY],
    createService: (s) => createCrossSessionService(s, { configStore: store, adapters: () => [adapter], sessionMcpCommand: ["/bin/deck"] }),
  });
  if (!result.ok) throw new Error("daemon");
  daemons.push(result.daemon);
  const out: string[] = [];
  const err: string[] = [];
  const inputs: Array<string | typeof END> = [];
  const END = Symbol("end");
  const deps = (over: Partial<SessionCommandDeps> = {}): SessionCommandDeps => ({
    write: (t) => out.push(t), writeErr: (t) => err.push(t),
    connect: async ({ ensure }) => {
      void ensure;
      try { return { client: await ControlClient.connect(paths.socket.path), paths: paths as StatePaths }; } catch { return undefined; }
    },
    configStore: store, projectRoot: () => project, interactive: false, readLine: async () => "", env: { HOME: home, XDG_STATE_HOME: join(home, "state") },
    stdinLines: () => ({
      async *[Symbol.asyncIterator]() {
        for (;;) {
          while (inputs.length === 0) await new Promise((r) => setTimeout(r, 5));
          const next = inputs.shift()!;
          if (next === END) return;
          yield next;
        }
      },
    }),
    ...over,
  });
  return { home, paths, store, project, driver, out, err, deps, feed: (...l: string[]) => inputs.push(...l), end: () => inputs.push(END), text: () => out.join("") };
}
const until = async (cond: () => boolean, label: string, ms = 5000) => { const end = Date.now() + ms; while (Date.now() < end) { if (cond()) return; await new Promise((r) => setTimeout(r, 10)); } throw new Error(`timeout: ${label}`); };

describe("deck cross developer (XR-9.1)", () => {
  test("creates a session for the project, attaches, sends a prompt, renders the reply, detaches leaving it running", async () => {
    const t = await boot();
    const run = runCrossLaunch(t.deps(), {});
    await until(() => t.text().includes("Attached to"), "attach");
    t.feed("hello lead");
    await until(() => t.text().includes("echo: hello lead"), "reply");
    await until(() => t.text().includes("-- turn completed --"), "turn end");
    t.feed("/detach");
    expect(await run).toBe(0);
    expect(t.driver.starts).toHaveLength(1);
    expect(t.driver.starts[0]).toMatchObject({ cwd: t.project, assignment: { runnerId: "claude", modelId: "opus" }, approvals: "relay" });

    // a second launch for the same project re-attaches to the SAME session and continues it
    const again = runCrossLaunch(t.deps(), {});
    await until(() => (t.text().match(/Attached to/g) ?? []).length === 2, "re-attach");
    expect(t.text()).toContain("echo: hello lead"); // backlog replayed
    t.feed("second");
    await until(() => t.text().includes("echo: second"), "second reply");
    t.feed("/detach");
    await again;
    const list = await runSessionCommand(t.deps(), { action: "list", json: true });
    expect(list).toBe(0);
    expect(JSON.parse(t.text().slice(t.text().lastIndexOf('{\n  "sessions"'))).sessions).toHaveLength(1);
  });

  test("refuses when cross-runner is not configured, and launches Claude without acknowledgement", async () => {
    const unconfigured = await boot({ configured: false });
    expect(await runCrossLaunch(unconfigured.deps(), {})).toBe(1);
    expect(unconfigured.err.join("")).toMatch(/not configured/i);

    const blocked = await boot();
    blocked.store.write({ crossRunner: { claudeTosAcknowledgedAt: null } });
    const launch = runCrossLaunch(blocked.deps(), {});
    await until(() => blocked.text().includes("Attached to"), "attach without acknowledgement");
    blocked.feed("/detach");
    expect(await launch).toBe(0);
    expect(blocked.err.join("")).not.toContain("ack-claude-tos");
    expect(blocked.store.read().crossRunner?.claudeTosAcknowledgedAt).toBeNull();
  });

  test("--change binds the new session, and only a session bound to that change is re-attached", async () => {
    const t = await boot();
    const first = runCrossLaunch(t.deps(), { changeId: "c-one" });
    await until(() => t.text().includes("Attached to"), "attach 1");
    t.feed("/detach");
    await first;
    const second = runCrossLaunch(t.deps(), { changeId: "c-two" });
    await until(() => (t.text().match(/Attached to/g) ?? []).length === 2, "attach 2");
    t.feed("/detach");
    await second;
    expect(await runSessionCommand(t.deps(), { action: "list", json: true })).toBe(0);
    const sessions = JSON.parse(t.text().slice(t.text().lastIndexOf('{\n  "sessions"'))).sessions as Array<{ changeId: string }>;
    expect(sessions.map((s) => s.changeId).sort()).toEqual(["c-one", "c-two"]);
  });
});

describe("deck session subcommands (XR-9.2, XR-11.2)", () => {
  test("list shows a table; attach to an unknown session fails; stop ends a session", async () => {
    const t = await boot();
    const launch = runCrossLaunch(t.deps(), {});
    await until(() => t.text().includes("Attached to"), "attach");
    t.feed("/detach");
    await launch;
    expect(await runSessionCommand(t.deps(), { action: "list", json: false })).toBe(0);
    expect(t.text()).toMatch(/ID\s+STATE\s+CHANGE\s+LEAD\s+PROJECT/);
    expect(t.text()).toContain("claude/opus");
    const id = /^(\d{8}T\d{6}-[0-9a-f]{6})/m.exec(t.text())![1]!;

    expect(await runSessionCommand(t.deps(), { action: "attach", sessionId: "nope" })).toBe(1);
    expect(t.err.join("")).toContain("Unknown session");

    expect(await runSessionCommand(t.deps(), { action: "stop", sessionId: id })).toBe(0);
    expect(t.text()).toContain(`Session ${id}: ended`);
    expect(await runSessionCommand(t.deps(), { action: "stop", sessionId: "nope" })).toBe(1);
  });

  test("status --json reports the daemon, driver probes and member readiness; a stopped daemon reports running:false", async () => {
    const t = await boot();
    expect(await runSessionCommand(t.deps(), { action: "status", json: true })).toBe(0);
    const status = JSON.parse(t.text()) as { running: boolean; daemon: { pid: number; version: string }; drivers: Array<{ runnerId: string; probe: { status: string } }>; members: { lead: { blocked: null } }; enabled: boolean };
    expect(status).toMatchObject({ running: true, enabled: true, daemon: { version: "1.0.0" }, drivers: [{ runnerId: "claude", probe: { status: "ready" } }], members: { lead: { blocked: null } } });

    const none = await boot();
    const off = none.deps({ connect: async () => undefined });
    expect(await runSessionCommand(off, { action: "status", json: true })).toBe(0);
    expect(JSON.parse(none.text())).toMatchObject({ running: false });
    const human = await boot();
    expect(await runSessionCommand(human.deps(), { action: "status", json: false })).toBe(0);
    expect(human.text()).toMatch(/running \(pid \d+, v1\.0\.0/);
    expect(human.text()).toContain("driver claude: ready 2.1.296, isolation verified");
    expect(human.text()).toContain("member lead: claude/opus ready");
  });

  test("prune honours --dry-run", async () => {
    const t = await boot();
    const launch = runCrossLaunch(t.deps(), {});
    await until(() => t.text().includes("Attached to"), "attach");
    t.feed("/detach");
    await launch;
    expect(await runSessionCommand(t.deps(), { action: "prune", dryRun: true, json: true, keep: 0, maxAgeDays: 0 })).toBe(0);
    const text = t.text();
    expect(JSON.parse(text.slice(text.lastIndexOf("{")))).toMatchObject({ dryRun: true, removed: [expect.any(String)] });
  });

  test("self-test runs offline and exits non-zero when a check fails", async () => {
    const t = await boot();
    expect(await runSessionCommand(t.deps(), { action: "self-test", json: false })).toBe(0);
    expect(t.text()).toContain("self-test passed");
    const bad = await boot();
    expect(await runSessionCommand(bad.deps({ env: { HOME: "relative", XDG_STATE_HOME: "relative" } }), { action: "self-test", json: true })).toBe(1);
  });

  test("ack-claude-tos records the acknowledgement", async () => {
    const t = await boot({ configured: false });
    expect(await runSessionCommand(t.deps(), { action: "ack-claude-tos", yes: true })).toBe(0);
    expect(t.store.read().crossRunner?.claudeTosAcknowledgedAt).toMatch(/^\d{4}-/);
  });

  test("an unreachable daemon is a clear error, not a hang", async () => {
    const t = await boot();
    const deps = t.deps({ connect: async () => { throw new Error("socket missing"); } });
    expect(await runSessionCommand(deps, { action: "list", json: false })).toBe(1);
    expect(t.err.join("")).toContain("socket missing");
  });
});

describe("formatSessionList", () => {
  test("aligns columns and flags running sessions", () => {
    const text = formatSessionList([
      { grants:[],approvalMode:"relay",approvalModeSource:"default",projectId:"p",title:"Session",generation:0,assignmentRevision:0,members:{},currentLeadTaskId:"lead",leadActivity:{state:'running',pendingApprovals:0,lastReplySeq:0},sharedWorkspace:true,sharedActiveSessions:1,sessionId: "s-1", projectRoot: "/p", state: "running", createdAt: "", updatedAt: "", lastSeq: 1, running: true, tasks: 1, activeTasks: 1, lead: { runnerId: "claude", modelId: "opus" } },
      { grants:[],approvalMode:"relay",approvalModeSource:"default",projectId:"q",title:"Closed",generation:0,assignmentRevision:0,members:{},currentLeadTaskId:"lead",leadActivity:{state:'idle',pendingApprovals:0,lastReplySeq:0},sharedWorkspace:true,sharedActiveSessions:0,sessionId: "s-22", projectRoot: "/q", changeId: "c", state: "ended", createdAt: "", updatedAt: "", lastSeq: 1, running: false, tasks: 0, activeTasks: 0 },
    ]);
    expect(text.split("\n")[0]).toMatch(/^ID\s+STATE\s+CHANGE\s+LEAD\s+PROJECT$/);
    expect(text).toContain("running*");
    expect(text).toContain("(* a turn is running)");
    expect(formatSessionList([])).toBe("No sessions.\n");
  });
});

describe("deck session web controls", () => {
 test("Unix queries pair, list/revoke devices, disable and re-enable", async () => {
  const t=await boot({web:true});expect(await runSessionCommand(t.deps(),{action:"web",operation:"status",json:true})).toBe(0);expect(JSON.parse(t.out.pop()!).hostname).toBe("127.0.0.1");
  expect(await runSessionCommand(t.deps(),{action:"web",operation:"pair",json:true})).toBe(0);const pairing=JSON.parse(t.out.pop()!);expect(pairing.url).toContain("#pair=");
  const base=new URL(pairing.url).origin;const paired=await fetch(`${base}/pair`,{method:"POST",headers:{Origin:base,"Content-Type":"application/json"},body:JSON.stringify({code:pairing.code})});const device=(await paired.json()).device;
  expect(await runSessionCommand(t.deps(),{action:"web",operation:"devices",json:true})).toBe(0);expect(JSON.parse(t.out.pop()!).devices[0].id).toBe(device.id);
  expect(await runSessionCommand(t.deps(),{action:"devices-revoke",deviceId:device.id})).toBe(0);
  expect(await runSessionCommand(t.deps(),{action:"web",operation:"disable",json:true})).toBe(0);expect(JSON.parse(t.out.pop()!).enabled).toBe(false);
  expect(await runSessionCommand(t.deps(),{action:"web",operation:"enable",json:true})).toBe(0);expect(JSON.parse(t.out.pop()!).enabled).toBe(true);
 });
 test("cross developer prints a plain local URL and opens the browser only after confirmation", async()=>{
  const t=await boot({web:true});const opened:string[]=[];let answered=false;
  const run=runCrossLaunch(t.deps({interactive:true,readLine:async()=>{answered=true;return "no";},openBrowser:async url=>{opened.push(url);}}),{});
  await until(()=>t.text().includes("Attached to"),"attach");expect(answered).toBe(true);expect(t.text()).toContain("Browser: http://127.0.0.1:");expect(t.text()).not.toContain("#pair=");expect(t.text()).not.toContain("Pairing code:");expect(opened).toEqual([]);t.feed("/detach");expect(await run).toBe(0);
 });
});

describe("deck web workspace", () => {
  test("opens from any directory without registering a project or creating a session", async () => {
    const t = await boot({configured:false,web:true}); const opened:string[]=[];
    const deps = t.deps({projectRoot:()=>{throw new Error("must not resolve cwd");},openBrowser:async url=>{opened.push(url);}});
    expect(await runWebWorkspace(deps,{json:false,noOpen:false})).toBe(0);
    expect(opened).toHaveLength(1); expect(t.text()).toContain("Browser: http://127.0.0.1:");
    await runSessionCommand(t.deps(),{action:"list",json:true}); expect(t.text()).toContain('"sessions": []');
    expect(t.store.read().crossRunner?.enabled ?? false).toBe(false);
  });
  test("json and no-open skip browser effects; opener failure retains usable URL", async () => {
    const t = await boot({web:true}); let opens=0;
    const deps=t.deps({openBrowser:async()=>{opens++;throw new Error("private failure");}});
    expect(await runWebWorkspace(deps,{json:true,noOpen:false})).toBe(0);
    expect(await runWebWorkspace(deps,{json:false,noOpen:true})).toBe(0); expect(opens).toBe(0);
    expect(await runWebWorkspace(deps,{json:false,noOpen:false})).toBe(0); expect(opens).toBe(1);
    expect(t.err.join("")).toContain("Open the URL above manually"); expect(t.err.join("")).not.toContain("private failure");
  });
});
