import { readPreparedSessionStartContext } from "@deck/core/session/start-context";
import { getDefaultDeckConfig } from "@deck/core";
import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { buildCodexDeveloperTeamInstallPlan } from "./developer-team-install";
import { prepareCodexNativeRole, verifyCodexNativeRole } from "./native-role";
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, {recursive:true,force:true}); });
export function fixture(memory=false) {
  const root = mkdtempSync(join(tmpdir(), "deck-codex-role-")); roots.push(root);
  const plan = buildCodexDeveloperTeamInstallPlan({projectRoot:root, existingFiles:new Map(), modelAssignments:{"deck-apply-deep":"openai-codex/gpt-6"}, thinkingAssignments:{"deck-apply-deep":"high"},...(memory?{memoryProvider:"supermemory" as const,supermemoryHooks:{nodeCommand:process.execPath,recallScript:"/owned/recall.js",flushScript:"/owned/flush.js"}}:{})});
  expect(plan.blocked).toBe(false);
  for (const file of plan.expectedFiles) { const path=join(root,file.relativePath); mkdirSync(dirname(path),{recursive:true,mode:0o700}); writeFileSync(path,file.content,{mode:0o600}); }
  return join(root,".codex");
}
// Protects installed-role provenance/defaults and fail-closed drift, independent of prompt rendering.
test("installed role preserves defaults and rejects changed generation", () => {
  const root=fixture(), role=prepareCodexNativeRole(root,"deck-apply-deep");
  expect(role.instructions.length).toBeGreaterThan(100);
  expect(role.model).toBe("gpt-6"); expect(role.effort).toBe("high");
  expect(role.hooks.length).toBeGreaterThan(0);
  verifyCodexNativeRole(role);
  expect(()=>verifyCodexNativeRole({...role,instructions:"forged"})).toThrow("codex-session-generation-unverified");
  writeFileSync(join(root,"agents/deck-apply-deep.toml"),'name = "deck-apply-deep"\ndeveloper_instructions = "forged"');
  expect(()=>verifyCodexNativeRole(role)).toThrow("codex-session-generation-unverified");
});
test("review roles have verified read-only descriptors",()=>{
  const root=fixture();
  for(const role of ["deck-quality","deck-investigate"]) expect(prepareCodexNativeRole(root,role).sandbox).toBe("read-only");
});

import { createCodexRunnerAdapter } from "./runner-adapter";
import { harness } from "./session-driver/test-support";
import { ISOLATION_FEATURES } from "./session-driver/launch";
import type { DriverTaskInput } from "@deck/core/session/driver";

test.each([{resume:false,earlyComplete:true},{resume:false,roleId:"deck-setup"},{resume:false,roleId:"deck-quality"},{resume:true,roleId:"deck-investigate"},{resume:false},{resume:true},{resume:false,memory:true},{resume:false,hookFault:"missing"},{resume:true,hookFault:"hash"}])("real adapter and driver enforce role and hook provenance: %j",async ({resume,hookFault,memory,earlyComplete,roleId="deck-apply-deep"})=>{
  const root=fixture(memory), adapter=createCodexRunnerAdapter({codexHome:root,userHome:dirname(root)});
  const role=await adapter.prepareSessionNativeRole!(roleId);
  const input:DriverTaskInput={taskId:"task",memberId:roleId.slice(5),cwd:dirname(root),assignment:{runnerId:"codex",modelId:"override-model"},nativeRoleDescriptor:role,...(memory?{nativeMemory:{provider:"supermemory" as const,integration:"runner-plugin" as const,status:"ready" as const,scopeMode:"global" as const,plugin:{root:"/owned",nodeCommand:process.execPath,scripts:{recall:"/owned/recall.js",flush:"/owned/flush.js"}}}}:{}),rolePrompt:"session overlay",prompt:"go",mcp:{servers:["context7"],sessionTools:[]},mcpServerSpecs:{context7:{command:"fixture",args:[],env:{}}},approvals:"runner-default",credentialFile:"/private/credential",disableNativeDelegation:true,...(resume?{resume:{nativeSessionId:"thread"}}:{})};
  input.sessionStartContext = { text: "<deck-project-readiness v1>fixture finding</deck-project-readiness>", epoch: "epoch", snapshotId: "snapshot" };
  // Protects authenticated selected-role/session correlation and revocation after the native turn.
  const bindings: any[] = [];
  const h=harness((child,index,m)=>{
    if(m.method==="initialize")child.stdout({id:m.id,result:{}});
    if(m.method==="config/read")child.stdout({id:m.id,result:{config:{features:Object.fromEntries(ISOLATION_FEATURES.map(f=>[f,false])),mcp_servers:{personal:{command:"foreign"}}}}});
    if(m.method==="hooks/list")child.stdout({id:m.id,result:{data:[{cwd:input.cwd,errors:[],hooks:role.hooks.filter(()=>!(index===2 && hookFault==="missing")).map((hook,i)=>({key:`owned-${i}`,currentHash:index===2 && hookFault==="hash"?"changed":`hash-${i}`,eventName:hook.event,command:hook.command,source:memory?"sessionFlags":"user",handlerType:"command",enabled:true,trustStatus:index===2?"trusted":"untrusted"}))}]}});
    if(m.method==="thread/start"||m.method==="thread/resume")child.stdout({id:m.id,result:{thread:{id:"thread"}}});
    if(m.method==="mcpServerStatus/list")child.stdout({id:m.id,result:{data:[{name:"deck-session-task-context7",runtimeStatus:"connected",tools:{"query-docs":{}}}],nextCursor:null}});
    if(m.method==="turn/start") { expect(bindings).toHaveLength(0); child.stdout({id:m.id,result:{turn:{id:"turn"}}});if(earlyComplete)queueMicrotask(()=>child.stdout({method:"turn/completed",params:{threadId:"thread",turn:{id:"turn",status:"completed"}}}));}
  });
  h.io.validatedLaunch = binding => {
    expect(binding.current?.()).toBe(true);bindings.push(binding);
    queueMicrotask(()=>h.children.at(-1)!.stdout({method:"turn/completed",params:{threadId:"thread",turn:{id:"turn",status:"completed"}}}));
    return true;
  };
  h.io.writePrivateFile = (name, content) => { const path = join(dirname(root), name); writeFileSync(path, content, {mode: 0o600}); return path; };
  const task=await adapter.getSessionDriver!().startTask(input,h.io);
  try {
    if(hookFault) {
      expect(await task.done).toEqual({status:"failed",error:"codex-hook-isolation-violation"});
      expect(bindings).toHaveLength(0);
      expect(h.children.flatMap(child=>child.writes).some(m=>m.method==="thread/start"||m.method==="thread/resume"||m.method==="turn/start")).toBe(false);
      return;
    }
    expect(await task.done).toEqual({status:"completed"});
    expect(bindings).toHaveLength(earlyComplete?0:1);
    if(!earlyComplete) {
      expect(bindings[0]).toMatchObject({roleId, generation:role.generation,nativeSessionId:"thread"});
      expect(bindings[0].current()).toBe(false);
    }
    const thread=h.children.at(-1)!.writes.find(m=>m.method===(resume?"thread/resume":"thread/start"))!.params as any;
    expect(thread.developerInstructions).toBe(role.instructions+"\n\nsession overlay");
    expect(thread.model).toBe("override-model");
    if(roleId==="deck-apply-deep") expect(thread.config.model_reasoning_effort).toBe("high");
    else if (roleId !== "deck-setup") expect(thread).toMatchObject({sandbox:"read-only",approvalPolicy:"never",config:{mcp_servers:{personal:{enabled:false},"deck-session-task-context7":{enabled_tools:["resolve-library-id","query-docs"]}}}});
    expect(h.spawns.at(-1)!.args.join(" ")).toContain("trusted_hash");
    expect(h.spawns.at(-1)!.options?.env?.CODEX_HOME).toBe(root);
    const environment = h.spawns.at(-1)!.options!.env!;
    expect(readPreparedSessionStartContext(input.cwd, environment)).toBe(input.sessionStartContext.text);
    if (!resume && !memory && roleId === "deck-apply-deep") {
      const command = [process.execPath, join(import.meta.dir, "../../../apps/cli/src/main.tsx"), "internal", "codex-memory-hook"];
      const invoke = (env: Record<string,string>) => Bun.spawnSync(command, {cwd: input.cwd, env, stdin: Buffer.from(JSON.stringify({session_id:"thread",cwd:input.cwd,hook_event_name:"SessionStart"})), stdout:"pipe", stderr:"pipe"});
      const env = {...environment}; delete env.DECK_CODEX_BRIDGE_ENDPOINT; delete env.DECK_CODEX_BRIDGE_TOKEN;
      const result = invoke(env);
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout.toString())).toEqual({hookSpecificOutput:{hookEventName:"SessionStart",additionalContext:input.sessionStartContext.text}});
      const stale = invoke({...env, DECK_SESSION_START_EPOCH: "stale"});
      expect(JSON.parse(stale.stdout.toString())).toEqual({});
      expect(stale.stderr.toString()).toContain("session-start-context-unverified");
    }
    writeFileSync(join(root,`agents/${roleId}.toml`),"changed");
    const sent=h.children.at(-1)!.writes.filter(m=>m.method==="turn/start").length;
    expect((await task.send("again")).status).toBe("failed");
    expect(h.children.at(-1)!.writes.filter(m=>m.method==="turn/start")).toHaveLength(sent);
  }finally{await task.close();}
});

test("production driver refuses absent or mismatched role before spawning",async()=>{
  const root=fixture(),adapter=createCodexRunnerAdapter({codexHome:root,userHome:dirname(root)});
  const role=await adapter.prepareSessionNativeRole!("deck-apply-deep");
  const input={memberId:"lead",assignment:{runnerId:"codex",modelId:"m"}} as DriverTaskInput;
  const h=harness(()=>{});
  await expect(adapter.getSessionDriver!().startTask(input,h.io)).rejects.toThrow("codex-session-generation-unverified");
  await expect(adapter.getSessionDriver!().startTask({...input,nativeRoleDescriptor:role},h.io)).rejects.toThrow("codex-session-generation-unverified");
  expect(h.spawns).toHaveLength(0);
});

// A valid old manifest is insufficient: current canonical policy provenance is mandatory.
test("stale build provenance and symlinked role files fail before admission",()=>{
  const root=fixture(), manifestPath=join(root,"deck/manifest.json");
  const original=readFileSync(manifestPath,"utf8"), manifest=JSON.parse(original);
  manifest.nativeRoleGeneration="0".repeat(64);writeFileSync(manifestPath,JSON.stringify(manifest));
  expect(()=>prepareCodexNativeRole(root,"deck-apply-deep")).toThrow("codex-session-generation-unverified");
  writeFileSync(manifestPath,original);
  const path=join(root,"agents/deck-apply-deep.toml"), target=join(root,"role-copy.toml");
  writeFileSync(target,readFileSync(path));rmSync(path);symlinkSync(target,path);
  expect(()=>prepareCodexNativeRole(root,"deck-apply-deep")).toThrow("codex-session-generation-unverified");
});

test.each(["user", "project"])("native launch preserves existing review role and remains available (%s)",async scope=>{
  const root=fixture(), project=join(dirname(root),"project"), roleRoot=scope==="user"?root:join(project,".codex");
  mkdirSync(join(roleRoot,"agents"),{recursive:true});
  const file=join(roleRoot,"agents/deck-quality.toml"), bytes='name = "deck-quality"\nsandbox_mode = "read-only"\n';
  writeFileSync(file,bytes);
  const adapter=createCodexRunnerAdapter({codexHome:root,userHome:dirname(root)});
  for(const yolo of [false,true]) {
    const launch=await adapter.buildLaunchPlan!({projectRoot:project,teamId:"developer-team",mode:"interactive",deckConfig:getDefaultDeckConfig(),...(yolo?{runnerNative:{dangerouslyBypassApprovalsAndSandbox:true}}:{})});
    expect(launch.status).toBe("ready");
    expect(readFileSync(file,"utf8")).toBe(bytes);
  }
});
