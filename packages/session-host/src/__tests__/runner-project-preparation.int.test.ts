// Protects real Codex/OpenCode drivers -> authenticated bridge -> shared repair composition.
// Oracle: exact Setup delegation/current generation; forged, ended and replayed calls cannot repeat effects.
import { getDefaultDeckConfig } from "@deck/core";
import { createOpenCodeRunnerAdapter } from "../../../adapter-opencode/src/runner-adapter";
import { createOpenCodeSessionDriver } from "../../../adapter-opencode/src/session-driver/driver";
import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { PassThrough } from "node:stream";
import { buildCodexDeveloperTeamInstallPlan } from "../../../adapter-codex/src/developer-team-install";
import { prepareCodexNativeRole } from "../../../adapter-codex/src/native-role";
import { createCodexSessionDriver } from "../../../adapter-codex/src/session-driver/driver";
import { ISOLATION_FEATURES } from "../../../adapter-codex/src/session-driver/launch";
import { ProjectPreparationService } from "../../../sdd-runtime/src/execution/project-preparation";
import type { PreparationSnapshot } from "@deck/core/session/preparation";
import { ApprovalBroker } from "../approval-broker";
import { BridgeService } from "../bridge-service";
import { CredentialRegistry } from "../credentials";
import { ensureStateLayout, resolveStatePaths, sessionPaths } from "../paths";
import { SessionManager } from "../session-manager";
import type { Supervisor, SupervisedProcess } from "../supervisor";
import { waitFor } from "./test-helpers";

for (const runner of ["codex", "opencode"] as const) test.each(["repair", "registry", "registry-refresh", "registry-stale", "generation", "cancel"])(`${runner} Setup repairs only with a live authenticated invocation (%s)`, async mode => {
  const home=mkdtempSync(join(tmpdir(),"deck-codex-repair-")), project=join(home,"project"), root=join(home,".codex");
  mkdirSync(join(project,"openspec"),{recursive:true});
  const file=join(project,"openspec/config.yaml"), original="schema: spec-driven\ntesting:\n  strict_tdd: true\n";
  writeFileSync(file,original);
  writeFileSync(join(project,".gitignore"),"/.atl/skill-registry.md\n");
  if(mode==="registry-refresh") { mkdirSync(join(project,".atl"));writeFileSync(join(project,".atl/skill-registry.md"),"invalid registry"); }
  if (mode === "registry-stale") {
    const { canonicalizeSkillRegistry } = await import("../../../core/src/skill-discovery/registry");
    const { createCoreGenericProjectSources, discoverSkills } = await import("../../../core/src/skill-discovery/discovery");
    const sourceSet = { outcome: "complete" as const, sources: [], diagnostics: [] };
    const candidate = canonicalizeSkillRegistry({ activeRunnerId: runner, sourceDeclarations: createCoreGenericProjectSources(project), discovery: await discoverSkills({ projectRoot: project, activeRunnerId: runner, sourceSet }) });
    mkdirSync(join(project, ".atl")); writeFileSync(join(project, ".atl/skill-registry.md"), candidate.document);
    mkdirSync(join(project, ".skills/new"), { recursive: true });
    writeFileSync(join(project, ".skills/new/SKILL.md"), "---\nname: new\ndescription: Newly added skill\n---\n");
  }
  const adapter=createOpenCodeRunnerAdapter({developerTeamConfigDir:join(home,"opencode")});
  if(runner==="codex") {
    const plan=buildCodexDeveloperTeamInstallPlan({projectRoot:home,existingFiles:new Map()});
    for(const entry of plan.expectedFiles) { const path=join(home,entry.relativePath);mkdirSync(dirname(path),{recursive:true,mode:0o700});writeFileSync(path,entry.content,{mode:0o600}); }
  } else {
    const plan=adapter.buildDeveloperTeamInstallPlan!({projectRoot:project,environmentId:"opencode-development",deckConfig:getDefaultDeckConfig()});
    await adapter.applyDeveloperTeamInstall!({projectRoot:project,environmentId:"opencode-development",plan});
  }
  const prepareRole=async (roleId:string)=>runner==="codex"?prepareCodexNativeRole(root,roleId):adapter.prepareSessionNativeRole!(roleId);
  const paths=resolveStatePaths({env:{HOME:home,XDG_STATE_HOME:join(home,"state")},tmpdir:home});ensureStateLayout(paths);
  const credentials=new CredentialRegistry({socketPath:paths.socket.path}), broker=new ApprovalBroker({sink:{emit(){}}});
  const children:Array<{taskId:string;started:boolean;finish():void}>=[];
  const supervisor={spawn:(_command:string,_args:readonly string[],options:{env:Record<string,string>;lease:{taskId:string}})=>{
    const out=new PassThrough(),err=new PassThrough(),input=new PassThrough();
    let finish!:(value:unknown)=>void;
    const exited=new Promise(resolve=>{finish=resolve;});
    const taskId=options.lease.taskId;
    const done=()=>{out.end();err.end();finish({ok:true,code:0,signal:null,drained:true,anchorLost:false});};
    const child={taskId,started:false,finish:done};children.push(child);
    if(runner==="opencode") {
      let pending: ((response:Response)=>void)|undefined;
      let events:ReadableStreamDefaultController<Uint8Array>|undefined;
      const config=JSON.parse(options.env.OPENCODE_CONFIG_CONTENT!);
      const roleId=taskId==="lead"?"deck-lead":"deck-setup";
      const server=Bun.serve({hostname:"127.0.0.1",port:0,idleTimeout:0,async fetch(request){
        const route=new URL(request.url).pathname;
        if(route==="/config"){const role=await prepareRole(roleId);return Response.json({...config,plugin:[...(config.plugin??[]),...role.hooks.map(h=>h.command)]});}
        if(route==="/provider")return Response.json({all:[]});
        if(route==="/mcp")return Response.json({deck:{status:"connected"}});
        if(route==="/agent"){const role=await prepareRole(roleId);return Response.json([{name:role.roleRef,prompt:role.instructions,permission:[{permission:"*",pattern:"*",action:"allow"}]}]);}
        if(route==="/permission"||route==="/question")return Response.json([]);
        if(route==="/session")return Response.json({id:`native-${taskId}`});
        if(route==="/event")return new Response(new ReadableStream({start(c){events=c;c.enqueue(new TextEncoder().encode('data: {"type":"server.connected","properties":{}}\n\n'));}}),{headers:{"content-type":"text/event-stream"}});
        if(route.endsWith("/message")){
          const body=await request.json() as {messageID:string;agent:string};
          events!.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({type:"message.updated",properties:{info:{id:body.messageID,role:"user",agent:body.agent,sessionID:`native-${taskId}`}}})}\n\n`));
          child.started=true;return new Promise<Response>(resolve=>{pending=resolve;});
        }
        return Response.json(true);
      }});
      const stop=()=>{pending?.(Response.json({info:{id:"ended"},parts:[]}));void server.stop(true);done();};
      child.finish=stop;
      queueMicrotask(()=>out.write(`opencode server listening on http://127.0.0.1:${server.port}\n`));
      return {anchorPid:42,stdout:out,stderr:err,stdin:input,ready:Promise.resolve({workerPid:42}),exited,interrupt:()=>{stop();return true;},terminateGroup:async()=>{stop();}} as unknown as SupervisedProcess;
    }
    let buffer="";
    input.on("data",chunk=>{
      buffer+=chunk.toString();let end:number;
      while((end=buffer.indexOf("\n"))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);if(!line)continue;const m=JSON.parse(line);let result:any;
        if(m.method==="initialize")result={};
        if(m.method==="config/read")result={config:{features:Object.fromEntries(ISOLATION_FEATURES.map(f=>[f,false])),mcp_servers:{}}};
        if(m.method==="hooks/list") { const role=prepareCodexNativeRole(root,taskId==="lead"?"deck-lead":"deck-setup");result={data:[{cwd:project,errors:[],hooks:role.hooks.map((hook,i)=>({key:`owned-${i}`,currentHash:`hash-${i}`,eventName:hook.event,command:hook.command,source:"user",handlerType:"command",enabled:true,trustStatus:"trusted"}))}]}; }
        if(m.method==="thread/start"||m.method==="thread/resume")result={thread:{id:m.params.threadId??`native-${taskId}`,historyMode:"legacy"}};
        if(m.method==="mcpServerStatus/list")result={data:[{name:`deck-session-${taskId}-deck`,runtimeStatus:"connected"}],nextCursor:null};
        if(m.method==="turn/start"){child.started=true;result={turn:{id:"turn"}};}
        if(m.method==="turn/interrupt"){result={};queueMicrotask(()=>out.write(JSON.stringify({method:"turn/completed",params:{threadId:`native-${taskId}`,turn:{id:"turn",status:"interrupted"}}})+"\n"));}
        if(result!==undefined)queueMicrotask(()=>out.write(JSON.stringify({id:m.id,result})+"\n"));
      }
    });
    return {anchorPid:42,stdout:out,stderr:err,stdin:input,ready:Promise.resolve({workerPid:42}),exited,interrupt:()=>{done();return true;},terminateGroup:async()=>{done();}} as unknown as SupervisedProcess;
  }} as unknown as Supervisor;
  const nativeDriver=runner==="opencode"?createOpenCodeSessionDriver({baseEnv:{HOME:home},exec:async()=>({code:0,stdout:"1.18.31"})}):createCodexSessionDriver({baseEnv:{HOME:home},exec:async()=>({code:0,stdout:"codex-cli 0.162.1"}),rpcTimeoutMs:1000});
  const admitted=new Set<string>();
  const driver:typeof nativeDriver={...nativeDriver,startTask(input,io){return nativeDriver.startTask(input,{...io,validatedLaunch:binding=>{
    const accepted=io.validatedLaunch?.(binding)??true;if(accepted)admitted.add(input.taskId);return accepted;
  }});}};
  const service=new ProjectPreparationService({registryProvider: runnerId => ({schema:"skill-discovery-source-provider-v1",runnerId,
    listSources:async()=>({outcome:"complete",sources:[],diagnostics:[]}),resolveLocator:async()=>({status:"missing"})})});let snapshot:PreparationSnapshot|undefined;
  const assignment={runnerId:runner,modelId:runner==="codex"?"fake":"p/m"};
  const manager=new SessionManager({paths,broker,credentials,supervisor,homeDir:home,drivers:{get:()=>driver,list:()=>[driver]},sessionMcpCommand:["fixture"],
    config:()=>({claudeTosAcknowledgedAt:null,enabled:true,members:{lead:assignment,setup:assignment},approvals:{claude:"relay",codex:"relay",opencode:"relay"},maxConcurrentTasks:4,web:{port:7421,trustedProxy:null,allowedOrigins:[],allowFunnel:false}}),
    assignedRoleId:id=>`deck-${id}`,childMcp:{prepareNativeRole:prepareRole,runnerPackages:()=>[],resolveServer:()=>undefined},projectPreparation:service,
    preparationScope:input=>({...input,policyDigest:"p",members:Object.entries(input.members).map(([memberId,a])=>({memberId,runnerId:a.runnerId,bindingId:memberId,capabilities:{}}))}),
    sessionStartContext:value=>{snapshot=value;return "";},
  });
  const bridge=new BridgeService({credentials,broker,status:g=>manager.taskStatus(g),callTaskTool:(g,n,a,c)=>manager.callTaskTool(g,n,a,c)});
  try {
    const created=await manager.execute({command:{v:1,commandId:"create",type:"session.create",projectRoot:project},clientId:"test"});expect(created).toMatchObject({ok:true});
    const sessionId=(created as any).data.sessionId;
    await manager.execute({sessionId,clientId:"test",command:{v:1,commandId:"prompt",type:"prompt.send",text:"Prepare project"}});
    await waitFor(()=>children.some(child=>child.taskId==="lead"&&child.started)&&admitted.has("lead"));
    const token=(taskId:string)=>JSON.parse(readFileSync(sessionPaths(paths,sessionId).taskCredentialFile(taskId),"utf8")).token;
    const request={snapshotId:snapshot!.snapshotId,components:[mode.startsWith("registry")?"skill-registry":"retired-testing-policy"]};
    expect((await bridge.call({token:token("lead"),tool:"deck_prepare_project",arguments:request})).ok).toBe(false);
    const delegated=await bridge.call({token:token("lead"),tool:"deck_delegate",arguments:{agent:"setup",task:"Repair",preparation:request}});expect(delegated).toMatchObject({ok:true});
    const taskId=(delegated as any).data.taskId;
    await waitFor(()=>children.some(child=>child.taskId===taskId&&child.started)&&admitted.has(taskId));
    const setupToken=token(taskId);
    expect((await bridge.call({token:"forged",tool:"deck_prepare_project",arguments:request})).ok).toBe(false);
    expect((await bridge.call({token:setupToken,tool:"deck_prepare_project",arguments:{...request,roleId:"deck-setup"}})).ok).toBe(false);
    const grant=credentials.lookup(setupToken)!, epoch=grant.epoch;
    grant.epoch="stale";
    expect((await bridge.call({token:setupToken,tool:"deck_prepare_project",arguments:request})).ok).toBe(false);
    grant.epoch=epoch;

    if(mode==="generation")writeFileSync(runner==="codex"?join(root,"agents/deck-setup.toml"):join(home,"opencode/prompts/deck-team/deck-setup.md"),"changed");
    if(mode==="cancel") {children.find(child=>child.taskId===taskId&&child.started)!.finish();await waitFor(()=>!credentials.lookup(setupToken));}
    const result=await bridge.call({token:setupToken,tool:"deck_prepare_project",arguments:request});
    expect(result.ok).toBe(mode==="repair"||mode.startsWith("registry"));
    if(mode==="repair"||mode.startsWith("registry")) {
      expect((result as any).data.status).toBe("changed");
      expect((await bridge.call({token:setupToken,tool:"deck_prepare_project",arguments:request}) as any).data.status).toBe("reconciled");
      if(mode.startsWith("registry")) {
        const {parseSkillRegistryDocument}=await import("../../../core/src/skill-discovery/registry");
        expect(parseSkillRegistryDocument(readFileSync(join(project,".atl/skill-registry.md"),"utf8")).ok).toBe(true);
        expect(readFileSync(file,"utf8")).toBe(original);
      } else expect(readFileSync(file,"utf8")).toContain("policy: proportional");
    } else expect(readFileSync(file,"utf8")).toBe(original);
  } finally {for(const child of children)child.finish();await manager.close();broker.dispose();rmSync(home,{recursive:true,force:true});}
},15000);
