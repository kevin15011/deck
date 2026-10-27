import { explicitCodebaseConfig, writeExplicitCodebaseConfig } from "./__fixtures__/explicit-codebase";
import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isCompatibleCodebaseExecutable, validateDeckConfig } from "@deck/core";
import { createMcpExtension } from "@earendil-works/pi-coding-agent";
import { createPiRunnerAdapter } from "./runner-adapter";
import { createPiTools } from "./pi-owned-tools";
import { createCodebaseGuardInvocation } from "./pi-codebase-guard-command";

// Quality29 acceptance regression: actual stock MCP factory/transport/command; no model/provider/network.
for (const fault of ["wrong-hash", "ownership-and-wrong-hash"] as const) for (const reopen of ["reconnect", "lazy-call"] as const) {
  test(`retained native ${reopen} rejects ${fault} before executable spawn`, async () => {
    const root = mkdtempSync(join(tmpdir(), "deck-pi-reconnect-"));
    const agentDir = join(root, "agent"), projectRoot = join(root, "project"), executable = join(root, "codebase-memory-mcp");
    const marker = join(root, "executions.jsonl");
    const saved = { HOME: process.env.HOME, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME, PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR, DECK_PI_SESSION: process.env.DECK_PI_SESSION };
    const script = `#!/usr/bin/env node
const build = 'A';
require('node:fs').appendFileSync(${JSON.stringify(marker)}, JSON.stringify({build,pid:process.pid})+'\\n');
const rl = require('node:readline').createInterface({input:process.stdin});
rl.on('line', line => {
 const m = JSON.parse(line); if (m.id === undefined) return;
 const result = m.method === 'initialize'
  ? { protocolVersion:'2024-11-05', capabilities:{tools:{}}, serverInfo:{name:'fixture',version:'0.11.0'} }
  : m.method === 'tools/list'
   ? {tools:['search_graph','trace_path','get_code_snippet','search_code'].map(name=>({name,inputSchema:{type:'object'}}))}
   : {};
 process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result})+'\\n');
});
`;
    const rejected = script.replace("const build = 'A';", "const build = 'B';");
    const release = { asset: "fixture.tar.gz", archiveBytes: 1, archiveSha256: "0".repeat(64), binaryBytes: Buffer.byteLength(script), binarySha256: createHash("sha256").update(script).digest("hex") };
    const handlers: Record<string, Array<(event: any, ctx: any) => any>> = {};
    const commands = new Map<string, any>();
    const definitions = new Map<string, any>(), statuses = new Map<string, string | undefined>();
    const notices: string[] = [];
    let active: string[] = [];
    const api = {
      on(name: string, handler: any) { (handlers[name] ??= []).push(handler); },
      getMcpServers: () => [], registerCommand(name: string, command: any) { commands.set(name, command); },
      registerTool(tool: any) { definitions.set(tool.name, tool); if (tool.exposure === "direct" && !active.includes(tool.name)) active.push(tool.name); },
      getActiveTools: () => active, setActiveTools: (names: string[]) => { active = names; }, getAllTools: () => [...definitions.values()],
    };
    const ctx = { cwd: projectRoot, hasUI: true, mode: "print", ui: { notify: (message: string) => notices.push(message), setStatus: (key: string, value: string | undefined) => statuses.set(key, value) }, signal: new AbortController().signal, isProjectTrusted: () => false };
    const dispatch = async (name: string, event: any = {}) => { for (const handler of handlers[name] ?? []) await handler(event, ctx); };
    const prepare = () => dispatch("before_agent_start", { systemPrompt: "Native profile", systemPromptOptions: { sections: {} } });
    const executions = (): Array<{ build: string; pid: number }> => existsSync(marker) ? readFileSync(marker, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line)) : [];
    try {
      mkdirSync(projectRoot);
      process.env.HOME = root; process.env.XDG_CONFIG_HOME = join(root, ".config"); writeExplicitCodebaseConfig(root);
      process.env.PI_CODING_AGENT_DIR = agentDir;
      process.env.DECK_PI_SESSION = "1";
      writeFileSync(executable, script, { mode: 0o700 });
      const tools = createPiTools({ homeDir: root, dataRoot: join(root, "deck"), env: {}, resolveCommand: () => executable, codebaseReleaseOverride: release });
      const guardScript = join(root, "guard-main.ts");
      writeFileSync(guardScript, `import { runPiCodebaseGuard } from ${JSON.stringify(join(import.meta.dir, "pi-codebase-guard.ts"))};
import { parseCodebaseGuardArgs } from ${JSON.stringify(join(import.meta.dir, "pi-codebase-guard-command.ts"))};
const args = parseCodebaseGuardArgs(process.argv.slice(4));
if (!args) process.exit(64);
const code = await runPiCodebaseGuard(args, { release: ${JSON.stringify(release)} });
await Promise.all([process.stdout, process.stderr].map(stream => new Promise(resolve => stream.write('', resolve))));
process.exit(code);
`);
      const invocation = createCodebaseGuardInvocation(process.execPath, guardScript);
      const adapter = createPiRunnerAdapter({ codebaseGuardInvocation: () => invocation, homeDirectory: root, env: { PI_CODING_AGENT_DIR: agentDir }, piTools: tools, piVersionProbe: () => ({ exitCode: 0, stdout: "1.0.0\n" }) });
      // Existing users migrate the owned direct entry through the normal transactional planner.
      const legacy = createPiRunnerAdapter({ homeDirectory: root, env: { PI_CODING_AGENT_DIR: agentDir }, piTools: tools, piVersionProbe: () => ({ exitCode: 0, stdout: "1.0.0\n" }) });
      const legacyInput = { projectRoot, environmentId: "pi-development" as const, deckConfig: explicitCodebaseConfig(), capabilityIds: ["codebase-memory-mcp"] };
      await legacy.applyDeveloperTeamInstall({ projectRoot, environmentId: "pi-development", plan: legacy.buildDeveloperTeamInstallPlan(legacyInput) });
      const direct = readFileSync(join(agentDir, "mcp.json"));
      expect(JSON.parse(direct.toString()).mcpServers["codebase-memory"].command).toBe(executable);
      const plan = adapter.buildDeveloperTeamInstallPlan({ projectRoot, environmentId: "pi-development", deckConfig: explicitCodebaseConfig(), capabilityIds: ["codebase-memory-mcp"] });
      expect(plan.blocked).toBeFalsy();
      expect(readFileSync(join(agentDir, "mcp.json"))).toEqual(direct);
      await adapter.applyDeveloperTeamInstall({ projectRoot, environmentId: "pi-development", plan });
      expect(JSON.parse(readFileSync(join(agentDir, "mcp.json"),"utf8")).mcpServers["codebase-memory"].command).toBe(invocation.command);
      const configBytes = readFileSync(join(agentDir, "mcp.json")), manifestBytes = readFileSync(join(agentDir, "deck/manifest.json"));
      const modulePath = join(root, "policy.mjs");
      copyFileSync(join(agentDir, "deck/package/extensions/deck-tool-policy/impl.js"), modulePath);
      const { createDeckToolPolicyEntry } = await import(modulePath);
      await createDeckToolPolicyEntry({ compatible: (command: string) => isCompatibleCodebaseExecutable(command, release) })(api, { getAgentDir: () => agentDir, createMcpExtension: (options: any) => createMcpExtension({ ...options, logPath: join(root, "mcp.log"), startupWaitMs: 10000 }) });
      await dispatch("session_start"); await prepare();
      expect(executions().map(x => x.build)).toEqual(["A"]);
      expect(active.filter(name => name.startsWith("mcp__codebase_memory__"))).toHaveLength(4);
      const command = commands.get("mcp");
      expect(command).toBeDefined();
      // Stock 1.0.0 has no reconnect-all action: "all" is a literal server name.
      await command.handler("reconnect all", ctx);
      expect(notices.at(-1)).toContain('No MCP server named "all"');
      expect(executions()).toHaveLength(1);
      writeFileSync(executable, rejected);
      expect(Buffer.byteLength(rejected)).toBe(release.binaryBytes);
      expect(isCompatibleCodebaseExecutable(executable, release)).toBe(false);
      if (fault === "ownership-and-wrong-hash") writeFileSync(join(agentDir, "deck/manifest.json"), "invalid");
      await prepare();
      const detected = statuses.get("deck-codebase");
      if (fault === "ownership-and-wrong-hash") expect(detected).toContain("pi-codebase-ownership-invalid");
      else expect(notices.join("\n")).toContain("Codebase Memory is unavailable");
      const pid = executions()[0]!.pid;
      const alive = () => { try { process.kill(pid, 0); return true; } catch { return false; } };
      const deadline = Date.now() + 3000;
      while (alive() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
      const previousConnectionAlive = alive();
      if (reopen === "reconnect") await command.handler("reconnect codebase-memory", ctx);
      else await expect(definitions.get("mcp__codebase_memory__search_graph").execute("lazy-probe", {}, ctx.signal, undefined, ctx)).rejects.toThrow(/^(?:MCP connection closed|MCP server "codebase-memory" failed to connect: [\s\S]+)$/);
      const afterRejectedReconnect = executions().map(x => x.build);
      const toolCountAfterRejection = active.filter(name => name.startsWith("mcp__codebase_memory__")).length;
      // Exercise reviewed restoration before asserting the security acceptance conditions.
      writeFileSync(executable, script); writeFileSync(join(agentDir, "deck/manifest.json"), manifestBytes);
      await prepare(); await command.handler("reconnect codebase-memory", ctx);
      expect(executions().at(-1)?.build).toBe("A");
      expect(active.filter(name => name.startsWith("mcp__codebase_memory__"))).toHaveLength(4);
      expect(readFileSync(join(agentDir, "mcp.json"))).toEqual(configBytes);
      expect(readFileSync(join(agentDir, "deck/manifest.json"))).toEqual(manifestBytes);
      await prepare();
      expect(statuses.get("deck-codebase")).toBeUndefined();
      console.log(JSON.stringify({ fault, reopen, previousConnectionAlive, afterRejectedReconnect, toolCountAfterRejection, restored: executions().at(-1)?.build }));
      expect({ previousConnectionAlive, afterRejectedReconnect, toolCountAfterRejection }).toEqual({ previousConnectionAlive: false, afterRejectedReconnect: ["A"], toolCountAfterRejection: 0 });
    } finally {
      await dispatch("session_shutdown");
      for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
      rmSync(root, { recursive: true, force: true });
    }
  }, 15000);
}

// Public AgentSession command dispatch and the real native tool registry, in addition to the command/transport cases above.
test("stock native dispatcher restores direct tools only after reviewed reconnection", async () => {
  const native = await import("@earendil-works/pi-coding-agent");
  const { fauxProvider, fauxAssistantMessage } = await import("@earendil-works/pi-ai");
  const { buildCodebaseGuardEntry } = await import("./pi-codebase-guard-command");
  const { createEmptyPiManifest, hashJsonValue } = await import("./pi-manifest");
  const root=mkdtempSync(join(tmpdir(),"deck-guard-native-session-")), agentDir=join(root,"agent"), cwd=join(root,"project"), binary=join(root,"codebase-memory-mcp"), marker=join(root,"starts");
  const saved={HOME:process.env.HOME,XDG_CONFIG_HOME:process.env.XDG_CONFIG_HOME,PI_CODING_AGENT_DIR:process.env.PI_CODING_AGENT_DIR,DECK_PI_SESSION:process.env.DECK_PI_SESSION};
  let session: import("@earendil-works/pi-coding-agent").AgentSession | undefined;
  try {
    mkdirSync(join(agentDir,"deck"),{recursive:true});mkdirSync(cwd);
    process.env.HOME=root;process.env.XDG_CONFIG_HOME=join(root,".config");writeExplicitCodebaseConfig(root);process.env.PI_CODING_AGENT_DIR=agentDir;process.env.DECK_PI_SESSION="1";
    const script=`#!/usr/bin/env node
const build='A';require('node:fs').appendFileSync(${JSON.stringify(marker)},JSON.stringify({build,pid:process.pid})+'\\n');
require('node:readline').createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);if(m.id===undefined)return;const result=m.method==='initialize'?{protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'fixture',version:'0.11.0'}}:m.method==='tools/list'?{tools:['search_graph','trace_path','get_code_snippet','search_code'].map(name=>({name,inputSchema:{type:'object'}}))}:{};process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result})+'\\n');});`;
    writeFileSync(binary,script,{mode:0o700});
    const release={asset:"fixture",archiveBytes:1,archiveSha256:"0".repeat(64),binaryBytes:Buffer.byteLength(script),binarySha256:createHash("sha256").update(script).digest("hex")};
    const guardScript=join(root,"guard-main.ts");writeFileSync(guardScript,`import {runPiCodebaseGuard} from ${JSON.stringify(join(import.meta.dir,"pi-codebase-guard.ts"))};import {parseCodebaseGuardArgs} from ${JSON.stringify(join(import.meta.dir,"pi-codebase-guard-command.ts"))};const args=parseCodebaseGuardArgs(process.argv.slice(4));if(!args)process.exit(64);process.exit(await runPiCodebaseGuard(args,{release:${JSON.stringify(release)}}));`);
    const entry=buildCodebaseGuardEntry(createCodebaseGuardInvocation(process.execPath,guardScript),agentDir,binary), manifest=createEmptyPiManifest();manifest.mcp.servers["codebase-memory"]=hashJsonValue(entry);
    const configBytes=JSON.stringify({mcpServers:{"codebase-memory":entry}}), manifestBytes=JSON.stringify(manifest);
    writeFileSync(join(agentDir,"mcp.json"),configBytes);writeFileSync(join(agentDir,"deck/manifest.json"),manifestBytes);
    const modulePath=join(root,"policy.mjs");copyFileSync(join(import.meta.dir,"../assets/pi/extensions/deck-tool-policy.generated.js"),modulePath);
    const {createDeckToolPolicyEntry}=await import(modulePath);
    const factory=createDeckToolPolicyEntry({compatible:(command:string)=>isCompatibleCodebaseExecutable(command,release)});
    const faux=fauxProvider();faux.setResponses(Array.from({length:4},()=>()=>fauxAssistantMessage("local fixture")));
    const modelRuntime=await native.ModelRuntime.create({authPath:join(agentDir,"auth.json"),modelsPath:null,refreshOnCreate:false,allowModelNetwork:false});modelRuntime.registerNativeProvider(faux.provider);
    const settingsManager=native.SettingsManager.inMemory({compaction:{enabled:false},retry:{enabled:false}});
    const loader=new native.DefaultResourceLoader({cwd,agentDir,settingsManager,noSkills:true,noPromptTemplates:true,noContextFiles:true,extensionFactories:[pi=>factory(pi,{getAgentDir:()=>agentDir,createMcpExtension:(options?:import("@earendil-works/pi-coding-agent").McpExtensionOptions)=>native.createMcpExtension({...options,logPath:join(root,"mcp.log"),startupWaitMs:10000})})]});
    await loader.reload();expect(loader.getExtensions().errors).toEqual([]);
    ({session}=await native.createAgentSession({cwd,agentDir,modelRuntime,model:faux.getModel(),resourceLoader:loader,sessionManager:native.SessionManager.inMemory(cwd),settingsManager}));
    const statuses=new Map<string,string|undefined>(),notices:string[]=[];
    await session.bindExtensions({mode:"print",onError:err=>notices.push(err.error),uiContext:{notify:(message:string)=>notices.push(message),setStatus:(key:string,message:string|undefined)=>statuses.set(key,message)} as never});
    await session.prompt("Ready");expect(session.getActiveToolNames().filter(name=>name.startsWith("mcp__codebase_memory__"))).toHaveLength(4);
    const initial=JSON.parse(readFileSync(marker,"utf8").trim());writeFileSync(binary,script.replace("const build='A'","const build='B'"));writeFileSync(join(agentDir,"deck/manifest.json"),"invalid");
    await session.prompt("Detect drift");expect(statuses.get("deck-codebase")).toContain("pi-codebase-ownership-invalid");
    const alive=()=>{try{process.kill(initial.pid,0);return true;}catch{return false;}};const deadline=Date.now()+3000;while(alive()&&Date.now()<deadline)await new Promise(r=>setTimeout(r,20));expect(alive()).toBe(false);
    await session.prompt("/mcp reconnect codebase-memory");expect(readFileSync(marker,"utf8").trim().split("\n").map(line=>JSON.parse(line).build)).toEqual(["A"]);expect(session.getActiveToolNames()).not.toContain("mcp__codebase_memory__search_graph");
    writeFileSync(binary,script);writeFileSync(join(agentDir,"deck/manifest.json"),manifestBytes);
    await session.prompt("Reviewed bytes restored, but not yet reconnected");
    expect(session.getActiveToolNames()).not.toContain("mcp__codebase_memory__search_graph");
    await session.prompt("/mcp reconnect codebase-memory");await session.prompt("Restored");
    expect(session.getActiveToolNames().filter(name=>name.startsWith("mcp__codebase_memory__"))).toHaveLength(4);expect(statuses.get("deck-codebase")).toBeUndefined();expect(readFileSync(join(agentDir,"mcp.json"),"utf8")).toBe(configBytes);
  }finally{
    if(session){await session.extensionRunner.emit({type:"session_shutdown",reason:"quit"});session.dispose();}
    for(const[key,value]of Object.entries(saved)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
    rmSync(root,{recursive:true,force:true});
  }
},15000);
