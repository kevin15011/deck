import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PassThrough } from "node:stream";
import { getDefaultDeckConfig } from "@deck/core";
import type { PreparationSnapshot } from "@deck/core/session/preparation";
import { createClaudeRunnerAdapter } from "../../../adapter-claude/src/runner-adapter";
import { createClaudeSessionDriver } from "../../../adapter-claude/src/session-driver/driver";
import { ProjectPreparationService } from "../../../sdd-runtime/src/execution/project-preparation";
import { composeSessionStartContextV1 } from "../../../sdd-runtime/src/execution/session-start-context";
import { ApprovalBroker } from "../approval-broker";
import { BridgeService } from "../bridge-service";
import { ControlServer } from "../control-server";
import { CredentialRegistry } from "../credentials";
import { runSessionMcpBridge } from "../mcp-bridge";
import { ensureStateLayout, resolveStatePaths, sessionPaths } from "../paths";
import { SessionManager } from "../session-manager";
import type { Supervisor, SupervisedProcess } from "../supervisor";
import { waitFor } from "./test-helpers";

test("real bridge and Claude driver fence exact Setup repair and refresh the next SessionStart", async () => {
  const home = mkdtempSync(join(tmpdir(), "deck-repair-")), project = join(home, "project");
  mkdirSync(join(project, "openspec"), { recursive: true });
  const configFile = join(project, "openspec/config.yaml"), original = "schema: spec-driven\ntesting:\n  strict_tdd: true # preserve\n  commands:\n    test: bun test\n";
  writeFileSync(configFile, original); writeFileSync(join(project, "AGENTS.md"), "Project instructions fixture.");
  const nativeCommand = [process.execPath, join(import.meta.dir, "../../../../apps/cli/src/main.tsx"), "internal", "project-readiness"];
  const adapter = createClaudeRunnerAdapter({ homeDir: home, dataRoot: join(home, "data", "deck"), resolveCommand: () => process.execPath,
    nativeSessionStartCommand: nativeCommand,
  });
  const plan = adapter.buildDeveloperTeamInstallPlan({ projectRoot: project, environmentId: "claude-development", deckConfig: getDefaultDeckConfig(), capabilityIds: ["claude-team-files"] });
  await adapter.applyDeveloperTeamInstall({ projectRoot: project, environmentId: "claude-development", plan });
  const nativeSkills = await adapter.prepareSessionNativeSkills();
  const paths = resolveStatePaths({ env: { HOME: home, XDG_STATE_HOME: join(home, "state") }, tmpdir: home }); ensureStateLayout(paths);
  const credentials = new CredentialRegistry({ socketPath: paths.socket.path });
  const children: Array<{ args: readonly string[]; env: Record<string, string>; out: PassThrough; finish(): void }> = [];
  const supervisor = { spawn: (_command: string, args: readonly string[], options: { env: Record<string, string> }) => {
    const out = new PassThrough(), err = new PassThrough(), input = new PassThrough();
    let finish!: (value: unknown) => void;
    const exited = new Promise(resolve => { finish = resolve; });
    const done = () => { out.end(); err.end(); finish({ ok: true, code: 0, signal: null, drained: true, anchorLost: false }); };
    children.push({ args, env: options.env, out, finish: done });
    return { anchorPid: 42, stdout: out, stderr: err, stdin: input, ready: Promise.resolve({ workerPid: 42 }), exited, interrupt: () => { done(); return true; }, terminateGroup: async () => { done(); } } as unknown as SupervisedProcess;
  } } as unknown as Supervisor;
  const driver = createClaudeSessionDriver({ baseEnv: { HOME: home }, exec: async () => ({ code: 0, stdout: "2.1.296" }) });
  const reads: string[] = [];
  const service = new ProjectPreparationService({onProjectRead: path => reads.push(path)}); let lastSnapshot: PreparationSnapshot | undefined;
  const assignment = { runnerId: "claude", modelId: "haiku" };
  const broker = new ApprovalBroker({ sink: { emit() {} } });
  const manager = new SessionManager({ paths, broker, credentials, supervisor, homeDir: home,
    drivers: { get: () => driver, list: () => [driver] }, sessionMcpCommand: ["fixture"],
    config: () => ({ claudeTosAcknowledgedAt: null, enabled: true, members: { lead: assignment, setup: assignment }, approvals: { claude: "relay", codex: "relay", opencode: "relay" }, maxConcurrentTasks: 4, web: { port: 7421, trustedProxy: null, allowedOrigins: [], allowFunnel: false } }),
    assignedRoleId: id => `deck-${id}`, childMcp: { nativeSkills, runnerPackages: () => [], resolveServer: () => undefined },
    projectPreparation: service,
    preparationScope: input => ({ ...input, policyDigest: "p", members: Object.entries(input.members).map(([memberId, a]) => ({ memberId, runnerId: a.runnerId, bindingId: memberId, capabilities: {} })) }),
    sessionStartContext: snapshot => { lastSnapshot = snapshot; return composeSessionStartContextV1(snapshot); },
  });
  const bridge = new BridgeService({ credentials, broker, status: g => manager.taskStatus(g), callTaskTool: (g, n, a, c) => manager.callTaskTool(g, n, a, c) });
  const server = new ControlServer({ socketPath: paths.socket.path, service: manager, bridge, daemon: { version: "1", pid: process.pid, nonce: "n", status: () => ({}), requestRestart: () => ({ ok: true as const }) } });
  const streams: Array<{ input: PassThrough; done: Promise<void> }> = [];
  try {
    await server.listen();
    const created = await manager.execute({ command: { v: 1, commandId: "create", type: "session.create", projectRoot: project }, clientId: "test" });
    expect(created.ok).toBe(true); const sessionId = (created as any).data.sessionId;
    await manager.execute({ sessionId, clientId: "test", command: { v: 1, commandId: "prompt", type: "prompt.send", text: "Prepare project" } });
    await waitFor(() => children.length === 1);
    const init = (index: number, connected = true) => { const child = children[index]!; child.out.write(JSON.stringify({ type: "system", subtype: "init", session_id: child.args[child.args.indexOf("--session-id") + 1], mcp_servers: [{ name: "deck", status: connected ? "connected" : "failed" }], tools: [], model: "haiku" }) + "\n"); };
    init(0);
    const token = (taskId: string) => JSON.parse(readFileSync(sessionPaths(paths, sessionId).taskCredentialFile(taskId), "utf8")).token;
    const request = { snapshotId: lastSnapshot!.snapshotId, components: ["retired-testing-policy"] };
    expect(await bridge.call({ token: "unknown", tool: "deck_prepare_project", arguments: request })).toMatchObject({ ok: false, code: "credential-revoked" });
    expect((await bridge.call({ token: token("lead"), tool: "deck_prepare_project", arguments: request })).ok).toBe(false);
    // Advertising the tool is insufficient: the host must reject even an overbroad grant.
    (credentials.lookup(token("lead"))!.allowedTools as string[]).push("deck_prepare_project");
    expect(await bridge.call({ token: token("lead"), tool: "deck_prepare_project", arguments: request })).toMatchObject({ ok: false, code: "preparation-authority-unavailable" });
    const delegated = await bridge.call({ token: token("lead"), tool: "deck_delegate", arguments: { agent: "setup", task: "Repair", preparation: request } });
    expect(delegated.ok).toBe(true); const taskId = (delegated as any).data.taskId;
    expect(await bridge.call({ token: token("lead"), tool: "deck_delegate", arguments: { agent: "setup", task: "Duplicate repair", preparation: request } })).toMatchObject({ ok: false, code: "preparation-already-delegated" });
    await waitFor(() => children.length === 2);
    expect(children[1]!.args).toContain("deck-developer-team:deck-setup");
    expect(reads).toEqual(["openspec/config.yaml", ".atl/skill-registry.md"]);
    const setupToken = token(taskId);
    expect((await bridge.call({ token: setupToken, tool: "deck_prepare_project", arguments: request })).ok).toBe(false);
    const hookCommand = JSON.parse(readFileSync(join(nativeSkills.root, "hooks/hooks.json"), "utf8")).hooks.SessionStart[0].hooks[0].command;
    const nativeContext = Bun.spawnSync(["/bin/sh", "-c", hookCommand], { cwd: project, env: { HOME: home, PATH: process.env.PATH!, XDG_CONFIG_HOME: join(home, ".config") }, stdout: "pipe", stderr: "pipe" });
    expect(nativeContext.exitCode).toBe(0);
    expect(nativeContext.stdout.toString()).toContain("Project instructions fixture.");
    expect(nativeContext.stdout.toString()).toContain("retired-policy-present");
    expect(nativeContext.stdout.toString()).toContain("Native preparation repair is unavailable");
    expect(readFileSync(configFile, "utf8")).toBe(original);
    const context = () => Bun.spawnSync(["/bin/sh", "-c", hookCommand], { cwd: project, env: { ...process.env, ...children[1]!.env }, stdout: "pipe", stderr: "pipe" });
    expect(context().exitCode).toBe(0); expect(context().stdout.toString()).toContain("retired-policy-present");
    init(1);
    const input = new PassThrough(), replies: any[] = [];
    const done = runSessionMcpBridge({ input, write: line => { replies.push(JSON.parse(line)); }, version: "test", env: { DECK_SESSION_CREDENTIAL_FILE: sessionPaths(paths, sessionId).taskCredentialFile(taskId) } }); streams.push({ input, done });
    input.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "deck_prepare_project", arguments: { ...request, path: configFile } } }) + "\n");
    await waitFor(() => replies.length === 1); expect(replies[0].result.isError).toBe(true); expect(readFileSync(configFile, "utf8")).toBe(original);
    input.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "deck_prepare_project", arguments: request } }) + "\n");
    await waitFor(() => replies.length === 2); expect(replies[1].result.isError).toBeUndefined(); expect(replies[1].result.content[0].text).toContain('"status":"changed"');
    expect(readFileSync(configFile, "utf8")).toContain("policy: proportional"); expect(readFileSync(configFile, "utf8")).toContain("# preserve");
    expect((await bridge.call({ token: setupToken, tool: "deck_prepare_project", arguments: request }) as any).data.status).toBe("reconciled");
    // SessionStart reuses immutable data; refresh is assembled only at the next supported launch.
    expect(context().stdout.toString()).toContain("retired-policy-present");
    children[1]!.finish(); await waitFor(() => !credentials.lookup(setupToken));
    expect((await bridge.call({ token: setupToken, tool: "deck_prepare_project", arguments: request })).ok).toBe(false);
    const next = await bridge.call({ token: token("lead"), tool: "deck_delegate", arguments: { agent: "setup", task: "Inspect refreshed context", continueTaskId: taskId } }); expect(next.ok).toBe(true);
    await waitFor(() => children.length === 3);
    const refreshed = Bun.spawnSync(["/bin/sh", "-c", hookCommand], { cwd: project, env: { ...process.env, ...children[2]!.env }, stdout: "pipe", stderr: "pipe" });
    expect(refreshed.exitCode).toBe(0); expect(refreshed.stdout.toString()).not.toContain("retired-policy-present");
    init(2, false); await waitFor(() => children.length >= 3);
    expect(readFileSync(configFile, "utf8")).toContain("policy: proportional");
    const changedSource = "schema: spec-driven\ntesting:\n  policy: strict\n  commands:\n    test: bun test changed\n";
    writeFileSync(configFile, changedSource);
    const changedSnapshot = service.status(lastSnapshot!.scope);
    const changedRequest = { snapshotId: changedSnapshot.snapshotId, components: ["retired-testing-policy"] };
    const failedLaunch = await bridge.call({ token: token("lead"), tool: "deck_delegate", arguments: { agent: "setup", task: "Repair new finding", preparation: changedRequest } });
    expect(failedLaunch.ok).toBe(true);
    await waitFor(() => children.length === 4);
    const failedToken = token((failedLaunch as any).data.taskId);
    expect((await bridge.call({ token: failedToken, tool: "deck_prepare_project", arguments: changedRequest })).ok).toBe(false);
    init(3, false);
    await waitFor(() => !credentials.lookup(failedToken));
    expect((await bridge.call({ token: failedToken, tool: "deck_prepare_project", arguments: changedRequest })).ok).toBe(false);
    expect(readFileSync(configFile, "utf8")).toBe(changedSource);
  } finally {
    for (const stream of streams) stream.input.end(); await Promise.all(streams.map(s => s.done));
    for (const child of children) child.finish(); await manager.close(); await server.close(); broker.dispose();
    rmSync(home, { recursive: true, force: true });
  }
}, 20000);
