import { explicitCodebaseConfig, writeExplicitCodebaseConfig } from "./__fixtures__/explicit-codebase";
import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateDeckConfig } from "@deck/core";
import { isCompatibleCodebaseExecutable } from "@deck/core";
import { createMcpExtension } from "@earendil-works/pi-coding-agent";
import { createPiRunnerAdapter } from "./runner-adapter";
import { createPiTools } from "./pi-owned-tools";
import { createCodebaseGuardInvocation } from "./pi-codebase-guard-command";

// Quality27 regression: real native transport, connectable same-size wrong-hash fixture, no provider calls.
test("rejected same-size build still speaks MCP but must be excluded from effective native configuration", async () => {
  const root = mkdtempSync(join(tmpdir(), "deck-pi-rejected-build-"));
  const agentDir = join(root, "agent");
  const projectRoot = join(root, "project");
  const shared = join(root, "codebase-memory-mcp");
  const prior = { HOME: process.env.HOME, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME, PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR, DECK_PI_SESSION: process.env.DECK_PI_SESSION };
  const script = `#!/usr/bin/env node
// build A
require('node:fs').appendFileSync(${JSON.stringify(join(root, 'executions'))}, 'started\\n');
const rl = require('node:readline').createInterface({ input: process.stdin });
rl.on('line', line => {
 const m = JSON.parse(line); if (m.id === undefined) return;
 const result = m.method === 'initialize'
  ? { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '0.11.0' } }
  : m.method === 'tools/list'
   ? { tools: ['search_graph','trace_path','get_code_snippet','search_code'].map(name => ({name, inputSchema:{type:'object'}})) }
   : {};
 process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result})+'\\n');
});
`;
  const release = { asset: "fixture.tar.gz", archiveBytes: 1, archiveSha256: "0".repeat(64), binaryBytes: Buffer.byteLength(script), binarySha256: createHash("sha256").update(script).digest("hex") };
  try {
    mkdirSync(projectRoot);
    process.env.HOME = root; process.env.XDG_CONFIG_HOME = join(root, ".config"); writeExplicitCodebaseConfig(root);
      process.env.PI_CODING_AGENT_DIR = agentDir;
    process.env.DECK_PI_SESSION = "1";
    writeFileSync(shared, script, { mode: 0o700 });
    const tools = createPiTools({ homeDir: root, dataRoot: join(root, "deck"), env: {}, resolveCommand: () => shared, codebaseReleaseOverride: release });
    const guardScript = join(root, "guard-main.ts");
    writeFileSync(guardScript, `import {runPiCodebaseGuard} from ${JSON.stringify(join(import.meta.dir,"pi-codebase-guard.ts"))};
import {parseCodebaseGuardArgs} from ${JSON.stringify(join(import.meta.dir,"pi-codebase-guard-command.ts"))};
const args=parseCodebaseGuardArgs(process.argv.slice(4));if(!args)process.exit(64);
process.exit(await runPiCodebaseGuard(args,{release:${JSON.stringify(release)}}));`);
    const invocation = createCodebaseGuardInvocation(process.execPath, guardScript);
    const adapter = createPiRunnerAdapter({ codebaseGuardInvocation: () => invocation, homeDirectory: root, env: { PI_CODING_AGENT_DIR: agentDir }, piTools: tools, piVersionProbe: () => ({ exitCode: 0, stdout: "1.0.0\n" }) });
    const input = { projectRoot, environmentId: "pi-development" as const, deckConfig: explicitCodebaseConfig(), capabilityIds: ["codebase-memory-mcp"] };
    const initial = adapter.buildDeveloperTeamInstallPlan(input);
    expect(initial.blocked).toBeFalsy();
    await adapter.applyDeveloperTeamInstall({ projectRoot, environmentId: "pi-development", plan: initial });
    const persistent = readFileSync(join(agentDir, "mcp.json"));
    const manifestBytes = readFileSync(join(agentDir, "deck/manifest.json"));
    writeFileSync(shared, script.replace("build A", "build B"));
    expect(readFileSync(shared).byteLength).toBe(release.binaryBytes);
    expect(isCompatibleCodebaseExecutable(shared, release)).toBe(false);
    expect(tools.codebase.command()).toBeUndefined();
    const rejected = adapter.buildDeveloperTeamInstallPlan(input);
    expect(rejected.blocked).toBeFalsy();
    await adapter.applyDeveloperTeamInstall({ projectRoot, environmentId: "pi-development", plan: rejected });
    expect(readFileSync(join(agentDir, "mcp.json"))).toEqual(persistent);
    expect(JSON.parse(readFileSync(join(agentDir, "deck/package/extensions/deck-tool-policy/config.json"), "utf8")).graphRedirect).toBe(false);

    const policyPath = join(root, "policy.mjs");
    copyFileSync(join(agentDir, "deck/package/extensions/deck-tool-policy/impl.js"), policyPath);
    const { default: defaultPolicy, createDeckToolPolicyEntry } = await import(policyPath);
    const policy = createDeckToolPolicyEntry({ compatible: (path: string) => isCompatibleCodebaseExecutable(path, release) });
    const handlers: Record<string, Array<(event: any, ctx: any) => any>> = {};
    const definitions = new Map<string, any>();
    const notices: string[] = [];
    let active: string[] = [];
    const api = {
      on(name: string, handler: any) { (handlers[name] ??= []).push(handler); },
      getMcpServers: () => [], registerCommand() {},
      registerTool(tool: any) { definitions.set(tool.name, tool); if (tool.exposure === "direct" && !active.includes(tool.name)) active.push(tool.name); },
      getActiveTools: () => active, setActiveTools: (tools: string[]) => { active = tools; },
      getAllTools: () => [...definitions.values()],
    };
    // Default production MCP loader and transport; only the executable itself is a local test fixture.
    const native = { getAgentDir: () => agentDir, createMcpExtension: (options: any) => createMcpExtension({ ...options, logPath: join(root, "mcp.log"), startupWaitMs: 10000 }) };
    await defaultPolicy(api, native);
    let trusted = false;
    const ctx = { cwd: projectRoot, hasUI: true, ui: { notify: (text: string) => notices.push(text) }, signal: new AbortController().signal, isProjectTrusted: () => trusted };
    const dispatch = async (name: string, event: any) => {
      let result: any;
      for (const handler of handlers[name] ?? []) result = await handler(event, ctx) ?? result;
      return result;
    };
    try {
      await dispatch("session_start", {});
      await dispatch("before_agent_start", { systemPrompt: "Native profile", systemPromptOptions: { sections: {} } });
      // The shipped default factory also rejects this file with the production artifact pin.
      expect(active).toEqual([]);
      expect(existsSync(join(root, "executions"))).toBe(false);
      await dispatch("session_shutdown", {});
      for (const name of Object.keys(handlers)) delete handlers[name];
      notices.length = 0;
      // Repeat with a reviewed test artifact identity: the sizes match, and only the hash differs.
      await policy(api, native);
      await dispatch("session_start", {});
      await dispatch("before_agent_start", { systemPrompt: "Native profile", systemPromptOptions: { sections: {} } });
      expect({ active, notices }).toMatchObject({ active: [], notices: expect.arrayContaining([expect.stringContaining("Codebase Memory is unavailable")]) });
      expect(readFileSync(join(agentDir, "mcp.json"))).toEqual(persistent);
      expect(existsSync(join(root, "executions"))).toBe(false);
      // A post-start ownership fault stays guarded, and repaired metadata alone does not certify wrong bytes.
      await dispatch("session_shutdown", {});
      writeFileSync(join(agentDir, "deck/manifest.json"), "invalid");
      await dispatch("session_start", {});
      const blocked = await dispatch("before_agent_start", { systemPrompt: "Native profile", systemPromptOptions: { sections: {} } });
      expect(blocked.systemPrompt).toContain("pi-codebase-ownership-invalid");
      expect(active).not.toContain("mcp__codebase_memory__search_graph");
      expect(existsSync(join(root, "executions"))).toBe(false);
      writeFileSync(join(agentDir, "deck/manifest.json"), manifestBytes);
      writeFileSync(shared, script);
      expect(tools.codebase.command()).toBe(shared);
      await dispatch("session_shutdown", {});
      await dispatch("session_start", {});
      const restored = await dispatch("before_agent_start", { systemPrompt: "Native profile", systemPromptOptions: { sections: {} } });
      expect(active).toContain("mcp__codebase_memory__search_graph");
      expect(restored).toBeUndefined();
      expect(readFileSync(join(root, "executions"), "utf8")).toContain("started");
      // A trusted project override remains personal, and never becomes Deck-reviewed restoration.
      await dispatch("session_shutdown", {});
      active = [];
      const projectConfig = join(projectRoot, ".pi/mcp.json");
      const customExecutable = join(root, "custom-codebase-memory-mcp");
      writeFileSync(customExecutable, script.replace("build A", "build B"), { mode: 0o700 });
      mkdirSync(join(projectRoot, ".pi"));
      const customBytes = JSON.stringify({ mcpServers: { "codebase-memory": { command: customExecutable, exposure: "direct" } } });
      writeFileSync(projectConfig, customBytes);
      trusted = true;
      await dispatch("session_start", {});
      const custom = await dispatch("before_agent_start", { systemPrompt: "Native profile", systemPromptOptions: { sections: {} } });
      if (!active.includes("mcp__codebase_memory__search_graph")) console.error(JSON.stringify({ notices, nativeLog: existsSync(join(root,"mcp.log")) ? readFileSync(join(root,"mcp.log"),"utf8").slice(-2000) : "none" }));
      expect(active).toContain("mcp__codebase_memory__search_graph");
      expect(custom.systemPrompt).not.toContain("Codebase Memory is available");
      expect(readFileSync(projectConfig, "utf8")).toBe(customBytes);
      expect(readFileSync(join(agentDir, "mcp.json"))).toEqual(persistent);
    } finally { await dispatch("session_shutdown", {}); }
  } finally {
    for (const [key, value] of Object.entries(prior)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    rmSync(root, { recursive: true, force: true });
  }
}, 20000);
