import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { CLAUDE_SUPERMEMORY_COMMIT, installClaudeSupermemoryArtifact } from "../../../../../packages/adapter-claude/src/supermemory-artifact";
import { buildClaudeSupermemoryLaunchOverlay, configureClaudeSupermemoryCapture } from "../../../../../packages/adapter-claude/src/supermemory-settings";
import { createClaudeRunnerAdapter } from "../../../../../packages/adapter-claude/src/runner-adapter";
import { claudeModelMetadata, claudePluginName } from "../../../../../packages/adapter-claude/src/models";
import { buildClaudeTurnLaunch } from "../../../../../packages/adapter-claude/src/session-driver/launch";
import { resolveDefaultDeckDataRoot, type NormalizedDeckConfig } from "@deck/core";
import type { DriverTaskInput, NativeMemoryDescriptor } from "@deck/core/session/driver";

export async function installClaudeFixture(home: string) {
  const source = join(home,"claude-source"); mkdirSync(source,{mode:0o700});
  const archive = resolve(import.meta.dir,`../../../../../packages/adapter-claude/src/fixtures/claude-supermemory-${CLAUDE_SUPERMEMORY_COMMIT.slice(0,12)}.tgz`);
  assert.equal(Bun.spawnSync(["tar","-xzf",archive,"-C",source]).exitCode,0);
  const parent = join(resolveDefaultDeckDataRoot(process.env,home),"claude");
  mkdirSync(parent,{recursive:true,mode:0o700});
  const root=join(parent,`official-supermemory-${CLAUDE_SUPERMEMORY_COMMIT.slice(0,12)}`);
  await installClaudeSupermemoryArtifact(root,{fetchFile:async path=>readFileSync(join(source,path))});
  const settings=join(home,".supermemory-claude","settings.json");
  mkdirSync(join(settings,".."),{mode:0o700});
  writeFileSync(settings,JSON.stringify({signalExtraction:true,maxProfileItems:7,includeTools:["Read"]}),{mode:0o600});
  configureClaudeSupermemoryCapture(home);
  assert.deepEqual(JSON.parse(readFileSync(settings,"utf8")),{signalExtraction:false,maxProfileItems:7,includeTools:["Read"]});
  return root;
}

export async function exerciseClaudeLaunch(home:string,repo:string,root:string,token:string,scope:string,config:NormalizedDeckConfig,memory:NativeMemoryDescriptor) {
  const parent=join(root,"..");
  const marker=join(parent,claudePluginName({},[]),".claude-plugin");
  mkdirSync(marker,{recursive:true,mode:0o700});
  writeFileSync(join(marker,"plugin.json"),JSON.stringify({name:"deck-developer-team",version:"1.0.0",description:"Deck Developer Team content"},null,2)+"\n",{mode:0o600});
  writeFileSync(join(parent,"model-assignments.json"),claudeModelMetadata({},[]),{mode:0o600});
  const userSettings=join(home,".claude","settings.json");
  mkdirSync(join(userSettings,".."),{mode:0o700});
  const personal={env:{EDITOR:"vi"},enabledPlugins:{"personal@example":true},hooks:{Stop:[{hooks:[{type:"command",command:"echo personal"}]}]}};
  writeFileSync(userSettings,JSON.stringify(personal));
  const adapter=createClaudeRunnerAdapter({homeDir:home,dataRoot:join(parent,".."),resolveMemoryCredential:()=>({token,profile:"fake",canonicalRepoTag:scope}),sessionDriver:{baseEnv:process.env}});
  const native=await adapter.buildLaunchPlan!({projectRoot:repo,mode:"interactive",deckConfig:config} as any);
  assert.equal(native.status,"ready",JSON.stringify(native));
  if(native.status!=="ready") throw new Error("native launch missing");
  assert(native.plan.args.includes(root));
  const overlay=buildClaudeSupermemoryLaunchOverlay({token,canonicalRepoTag:scope});
  assert.deepEqual(native.plan.envOverlay,overlay);
  const skills=await adapter.prepareSessionNativeSkills(config);
  const files=new Map<string,string>();
  const launch=buildClaudeTurnLaunch({taskId:"apply",memberId:"apply",cwd:repo,assignment:{runnerId:"claude",modelId:"opus"},rolePrompt:"Continue public work.",prompt:"hello",nativeSessionId:"3f2b8c1e-5d4a-4b7e-9a1c-0e2d3f4a5b6c",mcp:{servers:["ordinary"],sessionTools:[]},mcpServerSpecs:{ordinary:{command:"node",args:["ordinary.js"],env:{}}},approvals:"runner-default",disableNativeDelegation:true,credentialFile:"/fake",nativeMemory:memory,nativeSkills:skills,nativeRole:{roleId:"deck-apply-deep",roleRef:`${skills.pluginName}:deck-apply-deep`,generation:skills.contentHash}} as DriverTaskInput,
    {writePrivateFile:(name,content)=>{files.set(name,content);return join(home,name);}},{baseEnv:process.env});
  assert(launch.args.includes(root)); assert(launch.args.includes(skills.root));
  assert(launch.expectedMcpServers.includes("ordinary")); assert(launch.expectedMcpServers.includes("plugin_supermemory_supermemory"));
  assert(launch.args.includes("user"));
  assert.deepEqual(JSON.parse(readFileSync(userSettings,"utf8")),personal);
  const disabled=await adapter.buildLaunchPlan!({projectRoot:repo,mode:"interactive",deckConfig:{...config,adaptiveMemory:{...config.adaptiveMemory,enabled:false,activeProvider:undefined}}} as any);
  assert.equal(disabled.status,"ready");
  if(disabled.status==="ready") {assert(!disabled.plan.args.includes(root));assert.equal(disabled.plan.envOverlay,undefined);}
}

export function claudeHook(root:string,repo:string,hook:string,payload:object,extra:Record<string,string>={}) {
  return Bun.spawn([process.env.NODE_EXECUTABLE!,"--require",join(import.meta.dir,"provider.cjs"),join(root,"hooks",`${hook}.js`)],{
    cwd:repo,env:{...process.env,SUPERMEMORY_CC_API_KEY:"fake-plugin-credential",SUPERMEMORY_MCP_URL:"http://127.0.0.1:9876/mcp",...extra},stdin:new Blob([JSON.stringify(payload)]),stdout:"pipe",stderr:"pipe"});
}
export async function finishClaude(child:ReturnType<typeof claudeHook>,rejected=false) {
  const [stdout,stderr,exit]=await Promise.all([new Response(child.stdout as ReadableStream).text(),new Response(child.stderr as ReadableStream).text(),child.exited]);
  assert.equal(exit,0,stderr);
  if(rejected) assert.match(stderr,/Supermemory:/); else assert.equal(stderr,"");
  return stdout;
}

export async function exerciseClaudeHooks(root:string,repo:string,scope:string) {
  const home=process.env.HOME!;
  const saved=()=>JSON.parse(readFileSync(process.env.MEMORY_TEST_STORAGE!,"utf8"));
  const start=JSON.parse(await finishClaude(claudeHook(root,repo,"session-start",{cwd:repo,session_id:"claude-start"})));
  assert.equal(typeof start,"object");
  const recall=JSON.parse(await finishClaude(claudeHook(root,repo,"recall-directive",{cwd:repo,session_id:"claude-recall",prompt:"Which light should pending deliveries use?"})));
  assert.match(recall.hookSpecificOutput.additionalContext,/amber/); assert.match(recall.hookSpecificOutput.additionalContext,/violet/);
  assert.doesNotMatch(recall.hookSpecificOutput.additionalContext,/UNRELATED_PROJECT_SENTINEL/);
  const transcript=join(home,"claude-transcript.jsonl");
  writeFileSync(transcript,[{type:"user",uuid:"cu1",message:{role:"user",content:"The approved delivery light is now teal."}},{type:"assistant",uuid:"ca1",message:{role:"assistant",content:[{type:"text",text:"Confirmed: pending deliveries now use teal."}]}}].map(x=>JSON.stringify(x)).join("\n")+"\n");
  const payload={cwd:repo,session_id:"claude-capture",transcript_path:transcript};
  const require=createRequire(join(root,"hooks/capture.js"));
  const tracker=require(join(root,"hooks/lib/transcript.js"));
  const state=require(join(root,"hooks/lib/session-state.js"));
  const before=saved().length;
  await finishClaude(claudeHook(root,repo,"capture",payload,{MEMORY_TEST_REJECT:"1"}),true);
  assert.equal(saved().length,before); assert.equal(tracker.getLastCapturedUuid(payload.session_id),null);
  assert.equal(state.readState(payload.session_id,"capture").status,"error");
  await finishClaude(claudeHook(root,repo,"capture",payload,{MEMORY_TEST_INVALID_ACCEPTANCE:"1"}),true);
  assert.equal(saved().length,before); assert.equal(tracker.getLastCapturedUuid(payload.session_id),null);
  const release=join(home,"release-claude-add");
  const child=claudeHook(root,repo,"capture",payload,{MEMORY_TEST_HOLD_FILE:release});
  try {
    const deadline=performance.now()+5000;
    while(!existsSync(`${release}.waiting`) && performance.now()<deadline) await Bun.sleep(10);
    assert(existsSync(`${release}.waiting`),"capture must reach the held provider boundary");
    assert.equal(child.exitCode,null); assert.equal(saved().length,before);
    assert.equal(state.readState(payload.session_id,"capture").status,"saving");
    assert.equal(tracker.getLastCapturedUuid(payload.session_id),null);
    writeFileSync(release,"");
    await finishClaude(child);
  } finally {if(child.exitCode===null){child.kill();await child.exited;}}
  assert.equal(saved().length,before+1);
  assert.equal(saved().at(-1).namespace,scope); assert.equal(saved().at(-1).metadata.sm_scope,"personal");
  assert.match(saved().at(-1).content,/user<\|message\|>The approved delivery light is now teal\./); assert.match(saved().at(-1).content,/assistant<\|message\|>Confirmed: pending deliveries now use teal\./);
  assert.equal(state.readState(payload.session_id,"capture").status,"saved");
  assert.equal(tracker.getLastCapturedUuid(payload.session_id),"ca1");
  await finishClaude(claudeHook(root,repo,"capture",payload)); assert.equal(saved().length,before+1);
  // Exercise the original module's registrations; this is not Claude CLI scheduling.
  const module=await import(join(root,"hooks/recall-strip.js"));
  const registrations:string[]=[]; module.register((event:string)=>registrations.push(event));
  assert(registrations.includes("classic.UserPromptSubmit")); assert(registrations.includes("ui.render"));
  const mcp=JSON.parse(await finishClaude(claudeHook(root,repo,"mcp-proxy",{jsonrpc:"2.0",id:1,method:"tools/call",params:{name:"search_memory",arguments:{q:"delivery"}}})));
  assert.equal(mcp.result.arguments.containerTag,scope);
}
