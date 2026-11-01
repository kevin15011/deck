import { buildCodexMcpServers, mergeCodexMcpServers } from "../../../../../packages/adapter-codex/src/mcp-config";
import { createCaptureTicket } from "../../../../../packages/adapter-opencode/src/session-driver/capture-drain";
import { installClaudeFixture, exerciseClaudeLaunch, exerciseClaudeHooks, claudeHook, finishClaude } from "./claude";
import { buildClaudeSupermemoryLaunchOverlay } from "../../../../../packages/adapter-claude/src/supermemory-settings";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { codexMemoryHooks } from "../../../../../packages/adapter-codex/src/session-driver/launch";
import type { DriverTaskInput } from "@deck/core/session/driver";
import { createCodexTools } from "@deck/adapter-codex";
import { buildCodexSupermemoryLaunchOverlay } from "../../codex-supermemory-launch";
import { buildOpenCodeSupermemoryLaunchOverlay } from "../../opencode-supermemory-launch";
import { prepareSessionNativeMemory } from "../../session-native-memory";
import { createSessionMemoryPort, resolveSessionChildMcp } from "../../session-shared-services";
import { startGlobalMemoryTransport } from "../../session-global-memory-transport";
import { validateDeckConfig, resolveCanonicalSupermemoryProjectScope, type RunnerLaunchPlan, type RunnerAdapter } from "@deck/core";
import { buildOpenCodeSupermemoryLoaderContent, configureOpenCodeSupermemoryCapture, installOwnedOpenCodeSupermemory, OPENCODE_SUPERMEMORY_PACKAGE_INTEGRITY, OPENCODE_SUPERMEMORY_PACKAGE_VERSION } from "../../../../../packages/adapter-opencode/src/opencode-supermemory-plugin";

const home = process.env.HOME!;
const repo = join(home, "project");
mkdirSync(repo);
function git(...args: string[]) {
  const result = Bun.spawnSync(["git", "-C", repo, ...args], { env: process.env, stdout: "pipe", stderr: "pipe" });
  assert.equal(result.exitCode, 0, result.stderr.toString());
}
git("init", "-q");
git("remote", "add", "origin", "https://github.com/example/native-memory-fixture.git");
const scope = resolveCanonicalSupermemoryProjectScope({projectRoot:repo, remotes:[]});
assert.equal(scope.ok, true);
if (!scope.ok) throw new Error("fixture scope missing");
const token = "fake-plugin-credential";
const tools = createCodexTools({homeDir:home, nodeCommand:process.env.NODE_EXECUTABLE,
  supermemoryArtifactEffects:{fetchTarball:async()=>readFileSync(resolve(import.meta.dir, "../../../../../packages/adapter-codex/src/__fixtures__/supermemory/codex-supermemory-1.1.0.tgz"))}});
await tools.supermemory.install();
writeFileSync(join(home,".codex/config.toml"), mergeCodexMcpServers('# deck-codex-hook:supermemory:start\n# deck-codex-hook:supermemory:end\n', buildCodexMcpServers({ packageIds: [], memoryProvider: "supermemory", supermemoryProxy: { nodeCommand: tools.node.command()!, script: tools.supermemory.proxy()! } }).servers).content);
const packageRoot = resolve(fileURLToPath(import.meta.resolve("opencode-supermemory")), "../..");
const installed = await installOwnedOpenCodeSupermemory({projectRoot:repo, homeDirectory:home, environment:process.env,
  runInstallCommand:async(_command,args)=>{
    const root = args[args.indexOf("--prefix")+1]!;
    for(const name of ["package.json","dist/index.js","dist/server.js"]){
      const destination = join(root,"node_modules/opencode-supermemory",name);
      mkdirSync(join(destination,".."),{recursive:true,mode:0o700});
      copyFileSync(join(packageRoot,name),destination);
    }
    writeFileSync(join(root,"package-lock.json"),JSON.stringify({packages:{"node_modules/opencode-supermemory":{version:OPENCODE_SUPERMEMORY_PACKAGE_VERSION,integrity:OPENCODE_SUPERMEMORY_PACKAGE_INTEGRITY}}}));
    return {exitCode:0,stdout:"",stderr:""};
  }});
assert.equal(installed.ok,true,installed.diagnostic);
assert.equal(readFileSync(installed.paths.loaderPath,"utf8"),buildOpenCodeSupermemoryLoaderContent());
// Preserve unrelated provider settings while enabling the supported short-turn cadence.
const settings = join(home,".config/opencode/supermemory.json");
writeFileSync(settings,JSON.stringify({captureEveryNTurns:0,compactionEnabled:false,maxMemories:7}));
configureOpenCodeSupermemoryCapture(home);
assert.deepEqual(JSON.parse(readFileSync(settings,"utf8")),{captureEveryNTurns:1,compactionEnabled:false,maxMemories:7});
const claudeRoot = await installClaudeFixture(home);
const config = validateDeckConfig({adaptiveMemory:{enabled:true,activeProvider:"supermemory"}});
const credential = ()=>({token,canonicalRepoTag:scope.scope});
for (const runner of ["claude","codex","opencode"]) {
  const managed = prepareSessionNativeMemory(runner,repo,config,process.env,{credential});
  assert.equal(managed?.nativeMemory.status,"ready",JSON.stringify(managed?.nativeMemory));
  assert.equal(managed.nativeMemory.automaticCapture,"unverified");
  if(runner==="codex") {
    const readOnlyInput = {nativeMemory:managed.nativeMemory,memberId:"quality"} as DriverTaskInput;
    assert.deepEqual(Object.keys(codexMemoryHooks(readOnlyInput)),["UserPromptSubmit","Stop"]);
  }
  if(runner==="claude") await exerciseClaudeLaunch(home,repo,claudeRoot,token,scope.scope,config,managed.nativeMemory);
  const native: NonNullable<RunnerLaunchPlan["envOverlay"]> = runner === "claude" ? buildClaudeSupermemoryLaunchOverlay({token,canonicalRepoTag:scope.scope}) : runner === "codex" ? buildCodexSupermemoryLaunchOverlay({token,projectRoot:repo,canonicalRepoTag:scope.scope})
    : buildOpenCodeSupermemoryLaunchOverlay({token,projectRoot:repo,canonicalRepoTag:scope.scope,environment:process.env,homeDirectory:home});
  for (const key of ["SUPERMEMORY_REPO_TAG","SUPERMEMORY_API_VERSION"]) assert.equal(managed.envOverlay?.[key],native[key]?.value);
  assert.equal(managed.envOverlay?.SUPERMEMORY_API_VERSION,"v5");
  assert.equal(createSessionMemoryPort({projectRoot:repo,sessionId:"fake-session",leadRunnerId:runner},config,()=>{throw new Error("duplicate Deck writer");}),undefined);
}
const store = join(home,"provider.json");
const requests = join(home,"requests.jsonl");
process.env.MEMORY_TEST_STORAGE=store; process.env.MEMORY_TEST_REQUESTS=requests;
process.env.SUPERMEMORY_API_KEY=token; process.env.SUPERMEMORY_CODEX_API_KEY=token;
process.env.SUPERMEMORY_API_URL="http://127.0.0.1:9876"; process.env.SUPERMEMORY_API_VERSION="v5"; process.env.SUPERMEMORY_REPO_TAG=scope.scope;
const provider = join(import.meta.dir,"provider.cjs");
const transcript = join(home,"transcript.jsonl");
const user = "The dashboard uses amber lights for pending deliveries.";
const assistant = "Confirmed: pending deliveries appear amber.";
writeFileSync(transcript,[{type:"event_msg",payload:{type:"user_message",message:user}},{type:"event_msg",payload:{type:"assistant_output_text",text:assistant}}].map(x=>JSON.stringify(x)).join("\n")+"\n");
async function codex(hook:"flush"|"recall",session:string,reject=false){
  const payload = {cwd:repo,session_id:session,transcript_path:transcript,prompt:"Which light should pending deliveries use?"};
  const child = Bun.spawn([process.env.NODE_EXECUTABLE!,"--require",provider,tools.supermemory.scripts()![hook]],{
    env:{...process.env,MEMORY_TEST_REJECT:reject?"1":"0"},stdin:new Blob([JSON.stringify(payload)]),stdout:"pipe",stderr:"pipe"});
  const [stdout,stderr,exit]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);
  assert.equal(exit,0,stderr); assert.equal(stderr,""); return stdout;
}
assert.equal(await codex("flush","rejected-session",true),"");
assert.match(await codex("flush","rejected-session"),/saved this turn/);
assert.equal(await codex("flush","rejected-session"),""); // native durable cursor prevents duplicate ingestion
const saved = ()=>JSON.parse(readFileSync(store,"utf8")) as Array<any>;
assert.equal(saved().length,1);
assert.equal(saved()[0].namespace,scope.scope);
assert.match(saved()[0].content,new RegExp(user)); assert.match(saved()[0].content,new RegExp(assistant));
assert.equal(saved()[0].metadata.sm_scope,"personal");
writeFileSync(store,JSON.stringify([...saved(),{namespace:"sm_project_v1_unrelated_project",id:"unrelated",content:"UNRELATED_PROJECT_SENTINEL",metadata:{sm_scope:"personal"}}]));
await import(provider);
// Use the production compatibility loader and its actual bundled SDK dependency closure.
const {default:plugin} = await import(installed.paths.loaderLocator);
const messages=[{info:{id:"user-1",sessionID:"open-1",role:"user"},parts:[{type:"text",text:"The corrected delivery light is violet."}]},{info:{id:"assistant-1",sessionID:"open-1",role:"assistant",finish:"stop"},parts:[{type:"text",text:"Confirmed: the dashboard now uses violet."}]}];
const captureTicket = createCaptureTicket('offline-task', {writePrivateFile:(name, content)=>{const path=join(home,name);writeFileSync(path,content,{mode:0o600});return path;}});
process.env.DECK_NATIVE_CAPTURE_TICKET = captureTicket.path;
const hooks = await plugin.server({directory:repo,client:{session:{messages:async()=>({data:messages})},tui:{showToast:async()=>{}},app:{log:async()=>{}}}});
const output = {message:{id:"new-user"},parts:[{type:"text",text:"Which light should pending deliveries use?"}]};
await hooks["chat.message"]({sessionID:"open-1"},output);
assert.match(JSON.stringify(output.parts),/amber/);
assert.doesNotMatch(JSON.stringify(output.parts),/UNRELATED_PROJECT_SENTINEL/);
assert.equal(typeof hooks.tool.supermemory.execute,"function");
let releaseAdd!: () => void;
(globalThis as any).MEMORY_TEST_HOLD_ADD = new Promise<void>(resolve => { releaseAdd=resolve; });
await hooks.event({event:{type:"session.idle",properties:{sessionID:"open-1"}}});
// A resolved idle hook is not acceptance: the fake provider has not allowed add.
assert.equal(saved().length,2);
let disposalCompleted = false;
const disposal = hooks.dispose().then(()=>{disposalCompleted=true;});
await new Promise(resolve=>setTimeout(resolve,5));
assert.equal(disposalCompleted,false);
assert.equal(JSON.parse(readFileSync(captureTicket.path,"utf8")).lifecycle,"pending");
releaseAdd(); await disposal;
assert.deepEqual(JSON.parse(readFileSync(captureTicket.path,"utf8")),{v:1,nonce:captureTicket.nonce,taskId:'offline-task',lifecycle:'completed',nativeSessionIds:['open-1'],acceptance:'unknown'});
// Native event and finalizer can both fire; the original plugin drains only once.
await hooks.event({event:{type:"server.instance.disposed",properties:{}}}); await hooks.dispose();
assert.equal(saved().length,3);
assert.equal(saved()[2].namespace,scope.scope);
assert.equal(saved()[2].metadata.sm_scope,"personal");
assert.match(saved()[2].content,/\[user\].*violet/); assert.match(saved()[2].content,/\[assistant\].*violet/);
const recalled = await codex("recall","new-codex-session");
assert.match(recalled,/violet/);
assert.doesNotMatch(recalled,/UNRELATED_PROJECT_SENTINEL/);
await exerciseClaudeHooks(claudeRoot,repo,scope.scope);
assert.match(await codex("recall","after-claude-capture"),/teal/);
const afterClaude={message:{id:"after-claude"},parts:[{type:"text",text:"Which delivery light was approved?"}]};
await hooks["chat.message"]({sessionID:"after-claude"},afterClaude);
assert.match(JSON.stringify(afterClaude.parts),/teal/);
const queries=readFileSync(requests,"utf8").trim().split("\n").map(line=>JSON.parse(line)).filter(x=>x.path===`/ns/${scope.scope}/search`);
assert(queries.length>0);
// Canonical Deck namespaces are not upstream repo_* tags: upstream intentionally
// leaves scope filters absent, admitting personal and project records from either runner.
assert(queries.every(q=>q.body.filter===undefined));
// Scope-absent managed sessions retain the existing untagged legacy compatibility
// transport. Exercise default preparation + composition with only credential/I/O fakes.
const globalRoot = join(home,"no-project"); mkdirSync(globalRoot);
const fakeFetch = globalThis.fetch;
for (const runner of ["claude","codex","opencode"] as const) {
  const disabled = prepareSessionNativeMemory(runner,globalRoot,validateDeckConfig({}),process.env,{credential:()=>{throw new Error("disabled credential access");}});
  assert.equal(disabled?.nativeMemory.status,"disabled");
  const global = await resolveSessionChildMcp({runnerId:runner} as RunnerAdapter,config,process.env,
    {readiness:{} as any,context:{projectRoot:globalRoot} as any}, {credential:()=>({token})},
    options=>startGlobalMemoryTransport({...options,fetch:(input,init)=>fakeFetch(String(input).replace("https://api.supermemory.ai","http://127.0.0.1:9876"),init)}));
  try {
    if (global.nativeMemory?.status === "disabled") { assert.equal(runner, "codex"); assert.equal(global.nativeMemory.reasonCode, "native-memory-project-identity-required"); assert.equal(global.envOverlay, undefined); continue; }
    assert.equal(global.nativeMemory?.scopeMode,"global");
    assert.equal(global.envOverlay?.SUPERMEMORY_API_VERSION,"legacy");
    const key=runner==="claude"?"SUPERMEMORY_CC_API_KEY":runner==="codex"?"SUPERMEMORY_CODEX_API_KEY":"SUPERMEMORY_API_KEY";
    assert(global.envOverlay?.[key]);
    assert.notEqual(global.envOverlay?.[key],token);
    const globalEnvironment = Object.fromEntries(Object.entries(process.env).filter(([key])=>!/^SUPERMEMORY_|^DECK_MEMORY_/.test(key)));
    if(runner==="claude") {
      const transcript=join(home,"claude-transcript.jsonl");
      const env=Object.fromEntries(Object.entries(global.envOverlay!).filter((entry):entry is [string,string]=>typeof entry[1]==="string"));
      await finishClaude(claudeHook(claudeRoot,globalRoot,"capture",{cwd:globalRoot,session_id:"global-claude",transcript_path:transcript},{...env,MEMORY_TEST_TRANSPORT:env.SUPERMEMORY_API_URL!,SUPERMEMORY_REPO_TAG:""}));
      assert.equal(saved().at(-1).namespace,undefined);
      assert.equal(saved().at(-1).containerTag,undefined);
      assert.match(saved().at(-1).content,/teal/);
    } else if(runner==="codex") {
      const child = Bun.spawn([process.env.NODE_EXECUTABLE!,"--require",provider,tools.supermemory.scripts()!.flush],{
        env:{...globalEnvironment,...global.envOverlay,MEMORY_TEST_TRANSPORT:global.envOverlay!.SUPERMEMORY_API_URL},
        stdin:new Blob([JSON.stringify({cwd:globalRoot,session_id:"global-codex",transcript_path:transcript})]),stdout:"pipe",stderr:"pipe"});
      const [stdout,stderr,exit]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);
      assert.equal(exit,0,stderr); assert.match(stdout,/saved this turn/);
      assert.equal(saved().at(-1).namespace,undefined);
      assert.equal(saved().at(-1).containerTag,undefined);
      assert.equal(saved().at(-1).containerTags,undefined);
    } else {
      const child = Bun.spawn([process.execPath,join(import.meta.dir,"opencode-global.ts"),installed.paths.loaderLocator,globalRoot], {
        env:{...globalEnvironment,...global.envOverlay,MEMORY_TEST_TRANSPORT:global.envOverlay!.SUPERMEMORY_API_URL},stdout:"pipe",stderr:"pipe"});
      const [stdout,stderr,exit]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);
      assert.equal(exit,0,stderr); assert.match(stdout,/global-events-complete/);
      assert.equal(saved().at(-1).namespace,undefined);
      assert.match(saved().at(-1).content,/shared checklist/);
    }
  } finally { await global.release?.(); }
}
console.log(JSON.stringify({openCodeOwnedDrain:true,claudeBidirectional:true,claudeAsyncIsNotReceipt:true,codexToOpenCode:true,openCodeToCodex:true,rejectedCapturePreserved:true,globalLegacy:true,idleCallbackIsNotReceipt:true,namespace:scope.scope,requestsHash:createHash("sha256").update(readFileSync(requests)).digest("hex")}));
