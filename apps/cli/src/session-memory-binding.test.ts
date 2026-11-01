import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { validateDeckConfig, type RunnerAdapter } from "@deck/core";
import { resolveSessionChildMcp } from "./session-shared-services";
import { createCodexTools } from "@deck/adapter-codex";
import { mergeCodexOwnedHooks } from "../../../packages/adapter-codex/src/codex-config";
import { buildCodexMcpServers, mergeCodexMcpServers } from "../../../packages/adapter-codex/src/mcp-config";
import { buildCodexLaunch, codexThreadMcpConfig } from "../../../packages/adapter-codex/src/session-driver/launch";
import type { DriverTaskInput } from "@deck/core/session/driver";
import { extractCodexSupermemoryFiles, CODEX_SUPERMEMORY_VERSION } from "../../../packages/adapter-codex/src/supermemory-artifact";
import { inspectDisabledCodexMemoryPlugin } from "./codex-supermemory-launch";

// Protects: global plugin launch receives the correct session bearer and protocol without leaking the upstream credential or inventing project scope.
test("global plugin composition uses each runner's credential name and forces supported legacy mode", async () => {
  const root=mkdtempSync(join(tmpdir(),"deck-global-binding-"));
  try {
    for(const runnerId of ["claude","codex","opencode"]){
      let closed=false;
      const result=await resolveSessionChildMcp({runnerId} as RunnerAdapter,
        validateDeckConfig({adaptiveMemory:{enabled:true,activeProvider:"supermemory"}}), {HOME:root},
        {readiness:{} as any,context:{projectRoot:root} as any},
        {credential:()=>({token:"host-only-fake"}),plugin:()=>({plugin:{root},env:{SUPERMEMORY_API_VERSION:"v5",SUPERMEMORY_REPO_TAG:"must-be-removed"}})},
        async()=>({apiUrl:"http://127.0.0.1:1/fake",mcpUrl:"http://127.0.0.1:1/fake/mcp",token:"session-fake",close:async()=>{closed=true;}}));
      expect(result.nativeMemory).toMatchObject({ status: "ready", scopeMode: "global" });
      expect(result.nativeMemory?.projectScope).toBeUndefined();
      const key=runnerId==="claude"?"SUPERMEMORY_CC_API_KEY":runnerId==="codex"?"SUPERMEMORY_CODEX_API_KEY":"SUPERMEMORY_API_KEY";
      expect(result.envOverlay?.[key]).toBe("session-fake");
      expect(result.envOverlay?.SUPERMEMORY_API_VERSION).toBe("legacy");
      expect(result.envOverlay?.SUPERMEMORY_REPO_TAG).toBeUndefined();
      expect(JSON.stringify(result.envOverlay)).not.toContain("host-only-fake");
      await result.release?.(); expect(closed).toBe(true);
    }
  } finally {rmSync(root,{recursive:true,force:true});}
});

// Protects QHOST-1 through real plugin preparation and the production resolver.
// Oracle: scope-absent hooks remain legacy/global; only the host owns the upstream
// key, and neither installed nor managed hosted MCP may receive a session bearer.
test("prepared Codex global hooks retain the session transport without enabling hosted MCP", async () => {
  const home = mkdtempSync(join(tmpdir(), "deck-codex-global-"));
  try {
    const project = join(home, "project"); mkdirSync(project, { mode: 0o700 });
    const config = validateDeckConfig({ adaptiveMemory: { enabled: true, activeProvider: "supermemory" } });
    const tools = createCodexTools({ homeDir: home, nodeCommand: Bun.which("node")!, supermemoryArtifactEffects: {
      fetchTarball: async () => readFileSync(new URL("../../../packages/adapter-codex/src/__fixtures__/supermemory/codex-supermemory-1.1.0.tgz", import.meta.url)),
    } });
    await tools.supermemory.install();
    const scripts = tools.supermemory.scripts()!, node = tools.node.command()!;
    const mcp = buildCodexMcpServers({ packageIds: [], memoryProvider: "supermemory", supermemoryProxy: { nodeCommand: node, script: tools.supermemory.proxy()! } });
    const source = mergeCodexOwnedHooks(mergeCodexMcpServers("", mcp.servers).content, [{ id: "supermemory", hooks: [
      { event: "UserPromptSubmit", command: `'${node}' '${scripts.recall}'`, timeout: 60 },
      { event: "Stop", command: `'${node}' '${scripts.flush}'`, timeout: 30 },
    ] }]).content;
    writeFileSync(join(home, ".codex/config.toml"), source, { mode: 0o600 });
    let closed = false;
    const result = await resolveSessionChildMcp({ runnerId: "codex" } as RunnerAdapter, config, { HOME: home, CODEX_HOME: join(home, ".codex") },
      { readiness: {} as any, context: { projectRoot: project } as any }, { credential: () => ({ token: "host-only-fake" }) },
      async ({ token }) => {
        expect(token).toBe("host-only-fake");
        return { token: "session-fake", apiUrl: "http://127.0.0.1:1/session", mcpUrl: "http://127.0.0.1:1/session/mcp", close: async () => { closed = true; } };
      });
    expect(result.nativeMemory).toMatchObject({ status: "ready", scopeMode: "global" });
    expect(result.nativeMemory?.projectScope).toBeUndefined();
    expect(result.nativeMemory?.plugin?.mcpServers).toBeUndefined();
    const input: DriverTaskInput = { taskId: "global", memberId: "apply-deep", cwd: project, assignment: { runnerId: "codex", modelId: "fake" }, rolePrompt: "", prompt: "", mcp: { servers: [], sessionTools: [] }, mcpServerSpecs: {}, approvals: "runner-default", credentialFile: "/unused", disableNativeDelegation: true, nativeMemory: result.nativeMemory, suppressedMcpServers: result.suppressedMcpServers };
    const launch = buildCodexLaunch(input, { baseEnv: { HOME: home, SUPERMEMORY_MCP_URL: "https://foreign.invalid", SUPERMEMORY_REPO_TAG: "foreign", SUPERMEMORY_CODEX_API_KEY: "inherited-fake" } });
    // SessionManager applies this trusted overlay after the adapter clears inherited values.
    const env = { ...launch.env, ...result.envOverlay };
    expect(env.SUPERMEMORY_CODEX_API_KEY).toBe("session-fake");
    expect(env.SUPERMEMORY_API_URL).toBe("http://127.0.0.1:1/session");
    expect(env.SUPERMEMORY_API_VERSION).toBe("legacy");
    expect(env.SUPERMEMORY_MCP_URL).toBeUndefined();
    expect(env.SUPERMEMORY_REPO_TAG).toBeUndefined();
    expect(JSON.stringify({ env, args: launch.args, descriptor: result.nativeMemory })).not.toContain("host-only-fake");
    expect((codexThreadMcpConfig(input, ["supermemory", "personal"]).mcp_servers as any)).toEqual({ supermemory: { enabled: false } });
    const hooks = Bun.TOML.parse(launch.args.find(arg => arg.startsWith("hooks="))!) as any;
    expect(hooks.hooks.UserPromptSubmit[0].hooks[0].command).toContain(tools.supermemory.scripts()!.recall);
    expect(hooks.hooks.Stop[0].hooks[0].command).toContain(tools.supermemory.scripts()!.flush);
    await result.release?.(); expect(closed).toBe(true);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

// Protects disable during upgrade: new artifact publication must not revive
// the retained generation still referenced by the installed configuration.
test("disabled Codex identifies the retained hook generation before config migration", async () => {
  const home = mkdtempSync(join(tmpdir(), "deck-old-memory-disable-"));
  try {
    const tarball = readFileSync(new URL("../../../packages/adapter-codex/src/__fixtures__/supermemory/codex-supermemory-1.1.0.tgz", import.meta.url));
    const options = { homeDir: home, dataRoot: join(home, ".local/share/deck"), nodeCommand: Bun.which("node")!, supermemoryArtifactEffects: { fetchTarball: async () => tarball } };
    const tools = createCodexTools(options);
    await tools.supermemory.install();
    const legacy = join(dirname(tools.supermemory.root), `official-supermemory-${CODEX_SUPERMEMORY_VERSION}`);
    mkdirSync(legacy, { mode: 0o700 });
    for (const [name, bytes] of extractCodexSupermemoryFiles(tarball)) if (["recall.js", "flush.js"].includes(name)) writeFileSync(join(legacy, name), bytes, { mode: 0o600 });
    writeFileSync(join(home, ".codex/config.toml"), `# installed hook references ${legacy}/recall.js\n# deck-codex-mcp:deck-memory\n[mcp_servers.deck-memory]\ncommand="old-deck"\n`, { mode: 0o600 });
    const disabled = inspectDisabledCodexMemoryPlugin({ home, codexHome: join(home, ".codex"), tools: options });
    expect(disabled?.scripts?.recall).toBe(join(legacy, "recall.js"));
    expect(Object.keys(disabled?.mcpServers ?? {})).toEqual(["deck-memory"]);
    expect(disabled?.mcpServers?.["deck-memory"]).toMatchObject({ args: [], env: {} });
  } finally { rmSync(home, { recursive: true, force: true }); }
});
