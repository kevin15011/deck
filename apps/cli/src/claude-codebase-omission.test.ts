import { test, expect } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getDefaultDeckConfig } from "@deck/core";
import { createClaudeRunnerAdapter } from "../../../packages/adapter-claude/src/runner-adapter";
import { resolveSessionChildMcp } from "./session-shared-services";
import { SessionCodebaseReadiness, SessionCodebaseReadinessError } from "./session-codebase-readiness";
import { buildClaudeTurnLaunch } from "../../../packages/adapter-claude/src/session-driver/launch";
import { createClaudeSessionDriver } from "../../../packages/adapter-claude/src/session-driver/driver";
import { harness } from "../../../packages/adapter-claude/src/session-driver/test-support";
import type { DriverTaskInput } from "@deck/core/session/driver";
const SID = "3f2b8c1e-5d4a-4b7e-9a1c-0e2d3f4a5b6c";

test("typed omission launches ordinary work, rejects exposed plugin/tools, and restores pairing without publishing", async () => {
  const root = mkdtempSync("/tmp/deck-pq3-");
  try {
    const config = getDefaultDeckConfig(); config.capabilities = { "codebase-memory": { enabled: true, runners: {} } };
    config.webSearch.enabled = false; config.adaptiveMemory.enabled = false; config.adaptiveMemory.activeProvider = "none";
    const adapter = createClaudeRunnerAdapter({ homeDir: root, dataRoot: join(root, "deck"), resolveCommand: () => process.execPath, verifyExistingCodebase: () => true });
    const plan = adapter.buildDeveloperTeamInstallPlan({ projectRoot: root, environmentId: "claude-development", deckConfig: config, capabilityIds: ["claude-team-files", "context7", "codebase-memory"] });
    await adapter.applyDeveloperTeamInstall({ projectRoot: root, environmentId: "claude-development", plan });
    const skills = await adapter.prepareSessionNativeSkills();
    const controller = new AbortController();
    let ready = false, releases = 0;
    const readiness = { ensure: async () => { if (!ready) throw new SessionCodebaseReadinessError("unavailable"); return { command: "bound", args: [], env: {} }; }, release: async () => { releases++; } } as any;
    const resolve = () => resolveSessionChildMcp(adapter, config, { HOME: root }, { readiness, nativeSkills: skills, context: { projectRoot: root, sessionId: "s", taskId: "t", signal: controller.signal } });
    const result = await resolve();
    expect(result.capabilityAvailability).toEqual([{ capabilityId: "codebase-memory", status: "unavailable", reasonCode: "codebase-memory-unavailable" }]);
    expect(result.suppressedMcpServers).toEqual([]); expect(result.resolveServer("codebase-memory")).toBeUndefined();
    const input: DriverTaskInput = { taskId: "t", memberId: "lead", cwd: root, assignment: { runnerId: "claude", modelId: "haiku" }, rolePrompt: "", prompt: "ordinary work", nativeSessionId: SID,
      nativeSkills: skills, nativeRole: { roleId: "deck-lead", roleRef: "deck-developer-team:deck-lead", generation: skills.contentHash },
      mcp: { servers: ["deck"], sessionTools: [] }, mcpServerSpecs: { deck: { command: "unused", args: [], env: {} } }, codebaseAvailability: result.codebaseAvailability,
      approvals: "relay", credentialFile: "/unused", disableNativeDelegation: true };
    const files = { writePrivateFile: (name: string) => join(root, name) };
    const launch = buildClaudeTurnLaunch(input, files, { baseEnv: { HOME: root } });
    expect(JSON.parse(launch.args[launch.args.indexOf("--settings") + 1]!).deniedMcpServers).toEqual([{ serverName: "plugin:deck-developer-team:codebase-memory" }]);
    expect(() => buildClaudeTurnLaunch({ ...input, codebaseAvailability: { ...result.codebaseAvailability! } }, files)).toThrow("evidence-invalid");
    expect(() => buildClaudeTurnLaunch({ ...input, taskId: "different" }, files)).toThrow("evidence-invalid");
    for (const exposed of ["none", "plugin", "tool"]) {
      const h = harness(); let validated = 0;
      h.io.validatedLaunch = () => { validated++; return true; };
      const driver = createClaudeSessionDriver({ baseEnv: { HOME: root }, exec: async () => ({ code: 0, stdout: "2.1.301" }) });
      const task = await driver.startTask(input, h.io), child = await h.nextChild();
      child.stdout(JSON.stringify({ type: "system", subtype: "init", session_id: SID, tools: exposed === "tool" ? ["mcp__plugin_deck-developer-team_codebase-memory__search_graph"] : [], mcp_servers: [{ name: "deck", status: "connected" }, { name: "plugin:deck-developer-team:context7", status: "connected" }, ...(exposed === "plugin" ? [{ name: "plugin:deck-developer-team:codebase-memory", status: "connected" }] : [])] }) + "\n");
      child.stdout(JSON.stringify({ type: "result", subtype: "success", session_id: SID, result: "done" }) + "\n"); child.exit();
      expect((await task.done).status).toBe(exposed === "none" ? "completed" : "failed"); expect(validated).toBe(exposed === "none" ? 1 : 0); await task.close();
    }
    ready = true; const recovered = await resolve(); expect(recovered.codebaseAvailability).toBeUndefined();
    expect(recovered.capabilityAvailability?.[0]?.status).toBe("ready");
    buildClaudeTurnLaunch({ ...input, codebaseAvailability: undefined, mcp: { servers: ["deck", "codebase-memory"], sessionTools: [] }, mcpServerSpecs: { ...input.mcpServerSpecs, "codebase-memory": recovered.resolveServer("codebase-memory")! } }, files);
    await recovered.release?.(); expect(releases).toBe(1);
    expect(await adapter.prepareSessionNativeSkills()).toEqual(skills);
    controller.abort(); expect(() => buildClaudeTurnLaunch(input, files)).toThrow("evidence-invalid");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("real omission preserves independent user identities and rejects owned leaks", async () => {
  const root = mkdtempSync("/tmp/deck-pq3-");
  try {
    const config = getDefaultDeckConfig(); config.capabilities = { "codebase-memory": { enabled: true, runners: {} } };
    config.webSearch.enabled = false; config.adaptiveMemory.enabled = false; config.adaptiveMemory.activeProvider = "none";
    const adapter = createClaudeRunnerAdapter({ homeDir: root, dataRoot: join(root, "deck"), resolveCommand: () => process.execPath, verifyExistingCodebase: () => true });
    const plan = adapter.buildDeveloperTeamInstallPlan({ projectRoot: root, environmentId: "claude-development", deckConfig: config, capabilityIds: ["claude-team-files", "context7", "codebase-memory"] });
    await adapter.applyDeveloperTeamInstall({ projectRoot: root, environmentId: "claude-development", plan });
    const skills = await adapter.prepareSessionNativeSkills();
    const controller = new AbortController();
    const readiness = new SessionCodebaseReadiness({ environment: { HOME: root }, supervisor: { spawn() { throw Error("unsupported executable must not spawn"); } } });
    const resolve = () => resolveSessionChildMcp(adapter, config, { HOME: root }, { readiness, nativeSkills: skills, context: { projectRoot: root, sessionId: "s", taskId: "t", signal: controller.signal } });
    writeFileSync(join(root, ".claude.json"), JSON.stringify({ mcpServers: { "codebase-memory": { command: "independent-user-backend" } } }));
    const result = await resolve();
    expect(result.capabilityAvailability).toEqual([{ capabilityId: "codebase-memory", status: "unavailable", reasonCode: "codebase-memory-unsupported" }]);
    expect(result.suppressedMcpServers).toEqual([]); expect(result.resolveServer("codebase-memory")).toBeUndefined();
    const input: DriverTaskInput = { taskId: "t", memberId: "lead", cwd: root, assignment: { runnerId: "claude", modelId: "haiku" }, rolePrompt: "", prompt: "ordinary work", nativeSessionId: SID,
      nativeSkills: skills, nativeRole: { roleId: "deck-lead", roleRef: "deck-developer-team:deck-lead", generation: skills.contentHash },
      mcp: { servers: ["deck"], sessionTools: [] }, mcpServerSpecs: { deck: { command: "unused", args: [], env: {} } }, codebaseAvailability: result.codebaseAvailability,
      approvals: "relay", credentialFile: "/unused", disableNativeDelegation: true };
    const files = { writePrivateFile: (name: string) => join(root, name) };
    const launch = buildClaudeTurnLaunch(input, files, { baseEnv: { HOME: root } });
    expect(JSON.parse(launch.args[launch.args.indexOf("--settings") + 1]!).deniedMcpServers).toEqual([{ serverName: "plugin:deck-developer-team:codebase-memory" }]);
    expect(() => buildClaudeTurnLaunch({ ...input, codebaseAvailability: { ...result.codebaseAvailability! } }, files)).toThrow("evidence-invalid");
    expect(() => buildClaudeTurnLaunch({ ...input, taskId: "different" }, files)).toThrow("evidence-invalid");
    const originalNow = Date.now;
    try { Date.now = () => originalNow() + 30_001; expect(() => buildClaudeTurnLaunch(input, files)).toThrow("evidence-invalid"); }
    finally { Date.now = originalNow; }
    for (const exposed of ["none", "personal", "personal-tool", "plugin", "tool", "managed", "managed-tool"]) {
      const h = harness(); let validated = 0;
      h.io.validatedLaunch = () => { validated++; return true; };
      const driver = createClaudeSessionDriver({ baseEnv: { HOME: root }, exec: async () => ({ code: 0, stdout: "2.1.301" }) });
      const currentInput = exposed.startsWith("managed") ? { ...input, mcpServerSpecs: { ...input.mcpServerSpecs, "codebase-memory": { command: "bound", args: [], env: {} } } } : input;
      const task = await driver.startTask(currentInput, h.io), child = await h.nextChild();
      child.stdout(JSON.stringify({ type: "system", subtype: "init", session_id: SID, tools: ["personal-tool", "managed-tool"].includes(exposed) ? ["mcp__codebase-memory__independent_read"] : exposed === "tool" ? ["mcp__plugin_deck-developer-team_codebase-memory__search_graph"] : [], mcp_servers: [{ name: "deck", status: "connected" }, { name: "plugin:deck-developer-team:context7", status: "connected" }, ...(["personal", "managed"].includes(exposed) ? [{ name: "codebase-memory", status: "connected" }] : []), ...(exposed === "plugin" ? [{ name: "plugin:deck-developer-team:codebase-memory", status: "connected" }] : [])] }) + "\n");
      child.stdout(JSON.stringify({ type: "result", subtype: "success", session_id: SID, result: "done" }) + "\n"); child.exit();
      const allowed = ["none", "personal", "personal-tool"].includes(exposed);
      expect((await task.done).status).toBe(allowed ? "completed" : "failed");
      expect(validated).toBe(allowed ? 1 : 0); await task.close();
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});


test('actual native preparation/executor route omits only Codebase, reports unavailable, recovers and rejects cancellation', async () => {
  const { prepareClaudeInteractiveLaunch } = await import('./claude-interactive-launch');
  const { executeRunnerLaunchPlan } = await import('./runner-launch-command');
  const { readFileSync, existsSync } = await import('node:fs');
  const root = mkdtempSync('/tmp/deck-pq3-native-');
  try {
    const config = getDefaultDeckConfig(); config.capabilities = { 'codebase-memory': { enabled: true, runners: {} } };
    config.webSearch.enabled = false; config.adaptiveMemory.enabled = false; config.adaptiveMemory.activeProvider = 'none';
    const adapter = createClaudeRunnerAdapter({ homeDir: root, dataRoot: join(root, 'deck'), resolveCommand: () => process.execPath, verifyExistingCodebase: () => true });
    const publication = adapter.buildDeveloperTeamInstallPlan({ projectRoot: root, environmentId: 'claude-development', deckConfig: config, capabilityIds: ['claude-team-files', 'context7', 'codebase-memory'] });
    await adapter.applyDeveloperTeamInstall({ projectRoot: root, environmentId: 'claude-development', plan: publication });
    const skills = await adapter.prepareSessionNativeSkills();
    const selection = readFileSync(skills.selectionPath, 'utf8');
    const manifest = readFileSync(join(skills.root, '.mcp.json'), 'utf8');
    let status: 'unavailable' | 'unsupported' | 'ready' | 'integrity' = 'unavailable', probes = 0, launches = 0;
    const { PassThrough } = await import('node:stream');
    const nativeObserver = new SessionCodebaseReadiness({ environment: { HOME: root, PATH: process.env.PATH }, coldTimeoutMs: 50, cleanupTimeoutMs: 20,
      verifyExecutable: async () => { if (status === 'integrity') throw new Error('codebase-memory-integrity-failed'); return true; },
      supervisor: { spawn(command, _args, options) {
        expect(command).toBe(process.execPath); expect(options?.env?.HOME).toBe(root);
        expect(options?.env?.CBM_RUNTIME_DIR).toBeUndefined();
        const stdin = new PassThrough(), stdout = new PassThrough(), stderr = new PassThrough();
        let finish!: (value: any) => void; const exited = new Promise<any>(resolve => { finish = resolve; });
        stdin.on('finish', () => finish({ ok: true, code: 0, drained: true, signal: null, anchorLost: false }));
        stdin.on('data', raw => {
          const message = JSON.parse(raw.toString()); if (!message.id || status === 'unavailable') return;
          const result = message.method === 'initialize' ? { protocolVersion: '2024-11-05', serverInfo: { name: 'codebase-memory-mcp', version: status === 'unsupported' ? 'invalid' : '0.11.0' } }
            : { tools: ['search_graph', 'trace_path', 'get_code_snippet'].map(name => ({ name })) };
          stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }) + '\n');
        });
        return { stdin, stdout, stderr, exited, anchorPid: 1, ready: Promise.resolve({ workerPid: 2 }), interrupt: () => true, terminateGroup: async () => { stdin.end(); } };
      } },
    });
    const observer = { observeNative: async (spec: any, project: string, signal: AbortSignal) => {
      probes++; expect(project).toBe(root); expect(spec).toEqual({ args: [], env: {}, ...JSON.parse(manifest).mcpServers['codebase-memory'] });
      await nativeObserver.observeNative(spec, project, signal);
    } };
    const input = { projectRoot: root, teamId: 'developer-team', deckConfig: config, mode: 'interactive' as const };
    for (const outcome of ['unavailable', 'unsupported', 'ready'] as const) {
      status = outcome;
      const result = await prepareClaudeInteractiveLaunch(adapter, input, observer);
      expect(result.status).toBe('ready'); if (result.status !== 'ready') throw new Error('native blocked');
      // Isolate only review bookkeeping; exercise the real process executor and lifecycle.
      result.plan.interactiveSearchReview = undefined;
      let contextPath = '';
      await executeRunnerLaunchPlan(result.plan, { inheritedEnv: { HOME: root, PATH: process.env.PATH! }, spawn: async (_command, args, options) => {
        launches++;
        const settings = JSON.parse(args[args.indexOf('--settings') + 1]!);
        expect(settings.deniedMcpServers ?? []).toEqual(outcome === 'ready' ? [] : [{ serverName: 'plugin:deck-developer-team:codebase-memory' }]);
        expect(args[args.indexOf('--plugin-dir') + 1]).toBe(skills.root);
        expect(args[args.indexOf('--agent') + 1]).toBe('deck-developer-team:deck-lead');
        contextPath = options.env.DECK_SESSION_START_CONTEXT!;
        const context = JSON.parse(readFileSync(contextPath, 'utf8'));
        if (outcome !== 'ready') expect(context.text).toContain('runner-remediation-required');
        expect(context.text).toContain('repair is unavailable');
        return { exitCode: 0, stdout: '', stderr: '' };
      } });
      expect(existsSync(contextPath)).toBe(false);
      expect(readFileSync(skills.selectionPath, 'utf8')).toBe(selection);
      expect(readFileSync(join(skills.root, '.mcp.json'), 'utf8')).toBe(manifest);
    }
    expect(launches).toBe(3); expect(probes).toBe(3);
    status = 'integrity';
    const bad = await prepareClaudeInteractiveLaunch(adapter, input, observer);
    if (bad.status !== 'ready') throw new Error('native blocked'); bad.plan.interactiveSearchReview = undefined;
    await expect(executeRunnerLaunchPlan(bad.plan, { spawn: async () => { throw new Error('must not spawn'); } })).rejects.toThrow('integrity-failed');
    const controller = new AbortController(); controller.abort();
    await expect(executeRunnerLaunchPlan(bad.plan, { spawn: async () => { throw new Error('must not spawn'); } }, controller.signal)).rejects.toThrow();
    let liveConfig = config;
    const revoked = await prepareClaudeInteractiveLaunch(adapter, input, { observeNative: async () => {
      liveConfig = structuredClone(config); liveConfig.capabilities!['codebase-memory']!.enabled = false;
    } }, () => liveConfig);
    if (revoked.status !== 'ready') throw new Error('native blocked'); revoked.plan.interactiveSearchReview = undefined;
    await expect(executeRunnerLaunchPlan(revoked.plan, { spawn: async () => { throw new Error('must not spawn'); } })).rejects.toThrow('selection-stale');
    config.capabilities['codebase-memory']!.enabled = false;
    expect((await prepareClaudeInteractiveLaunch(adapter, input, observer)).status).toBe('blocked');
    expect(probes).toBe(4);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
