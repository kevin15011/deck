// Protects default CLI composition -> real Pi lifecycle -> authenticated session MCP -> shared repair.
// Oracle: exact Setup delegation authorizes the retired-policy effect; Lead/forged/ended callers do not.
import { expect, test } from 'bun:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDefaultDeckConfig } from '@deck/core';
import { ApprovalBroker, CredentialRegistry, Supervisor, ensureStateLayout, resolveStatePaths, type DaemonServices } from '@deck/session-host';
import { BridgeService } from '../../../packages/session-host/src/bridge-service';
import { ControlServer } from '../../../packages/session-host/src/control-server';
import { sessionPaths } from '../../../packages/session-host/src/paths';
import { FakeDriver } from '../../../packages/session-host/src/testing/fake-driver';
import { waitFor } from '../../../packages/session-host/src/__tests__/test-helpers';
import { createPiHarness } from '../../../packages/adapter-pi/src/pi-cli-harness';
import { createPiRunnerAdapter } from '../../../packages/adapter-pi/src/runner-adapter';
import { createPiSessionDriver } from '../../../packages/adapter-pi/src/session-driver/driver';
import { createClaudeRunnerAdapter } from '../../../packages/adapter-claude/src/runner-adapter';
import { createCrossSessionService } from './session-service';

test.each(['repair','generation','concurrent-edit'])('production Pi Setup shared repair (%s)',async mode=>{
  const command=join(dirname(fileURLToPath(import.meta.resolve('../../../packages/adapter-pi/node_modules/@earendil-works/pi-coding-agent/dist/index.js'))),'cli.js');
  const h=createPiHarness({}, {command:[command]});
  mkdirSync(join(h.project,'openspec'));
  const file=join(h.project,'openspec/config.yaml');
  const original='schema: spec-driven\ntesting:\n  strict_tdd: true\n';writeFileSync(file,original);
  const config=getDefaultDeckConfig();config.adaptiveMemory.enabled=false;config.webSearch.enabled=false;
  if(config.capabilities)config.capabilities['codebase-memory'].enabled=false;
  config.crossRunner={enabled:true,claudeTosAcknowledgedAt:'2026-10-12T00:00:00Z',members:{lead:{runnerId:'claude',modelId:'fake'},setup:{runnerId:'pi',modelId:'faux/faux-1'}},
    approvals:{claude:'relay',codex:'relay',opencode:'relay'},maxConcurrentTasks:4,web:{port:7421,trustedProxy:null,allowedOrigins:[],allowFunnel:false}};
  const lead=createClaudeRunnerAdapter({homeDir:h.home,dataRoot:join(h.root,'deck')});
  const plan=lead.buildDeveloperTeamInstallPlan({projectRoot:h.project,environmentId:'claude-development',deckConfig:config,capabilityIds:['claude-team-files']});
  await lead.applyDeveloperTeamInstall({projectRoot:h.project,environmentId:'claude-development',plan});
  const leadDriver=new FakeDriver('claude');leadDriver.onStart=t=>t.init();lead.getSessionDriver=()=>leadDriver;
  const env:Record<string,string>={PATH:process.env.PATH!,HOME:h.home,FAUX_CHILD_TOOL:'mcp__deck__deck_prepare_project',FAUX_LOG:join(h.root,'faux.jsonl')};
  const pi=createPiRunnerAdapter({homeDirectory:h.home,env:{...env,PI_CODING_AGENT_DIR:h.agentDir},piCommand:command});
  const actual=createPiSessionDriver({command,baseEnv:env});
  let setupToken='';
  pi.getSessionDriver=()=>({...actual,startTask(input,io){
    setupToken=JSON.parse(readFileSync(input.credentialFile,'utf8')).token;
    return actual.startTask(input,{...io,validatedLaunch:binding=>{
      const accepted=io.validatedLaunch?.(binding)??false;
      if(accepted&&mode==='generation')writeFileSync(join(h.agentDir,'deck/package/agents/deck-setup.md'),'changed generation');
      if(accepted&&mode==='concurrent-edit')writeFileSync(file,'schema: spec-driven\n# concurrent edit\n');
      return accepted;
    }});
  }});
  const paths=resolveStatePaths({env:{HOME:h.home,XDG_STATE_HOME:join(h.root,'state')},tmpdir:h.root});ensureStateLayout(paths);
  const credentials=new CredentialRegistry({socketPath:paths.socket.path}),broker=new ApprovalBroker({sink:{emit(){}}});
  const supervisor=new Supervisor({anchorCommand:[process.execPath,join(import.meta.dir,'../../../packages/session-host/src/__tests__/fixtures/anchor-entry.ts')]});
  const entry=join(h.root,'mcp.ts');writeFileSync(entry,`import {runSessionMcpBridge} from ${JSON.stringify(join(import.meta.dir,'../../../packages/session-host/src/mcp-bridge.ts'))};await runSessionMcpBridge({input:process.stdin,write:line=>process.stdout.write(line),version:'fixture',env:process.env});`);
  const manager=createCrossSessionService({paths,credentials,broker,supervisor,clock:{now:Date.now,setTimeout,clearTimeout},logger:{info(){},warn(){},error(){}}} as unknown as DaemonServices,
    {configStore:{read:()=>config},adapters:()=>[lead,pi],sessionMcpCommand:[process.execPath,entry],environment:{HOME:h.home,PATH:process.env.PATH}});
  const bridge=new BridgeService({credentials,broker,status:g=>manager.taskStatus(g),callTaskTool:(g,n,a,c)=>manager.callTaskTool(g,n,a,c)});
  const server=new ControlServer({socketPath:paths.socket.path,service:manager,bridge,daemon:{version:'1',pid:process.pid,nonce:'n',status:()=>({}),requestRestart:()=>({ok:true as const})}});
  try {
    await server.listen();
    const created=await manager.execute({clientId:'test',command:{v:1,commandId:'create',type:'session.create',projectRoot:h.project}});
    expect(created).toMatchObject({ok:true});const sessionId=(created as any).data.sessionId;
    await manager.execute({sessionId,clientId:'test',command:{v:1,commandId:'prompt',type:'prompt.send',text:'Repair project'}});
    await waitFor(()=>leadDriver.turns.length===1);
    const request={snapshotId:leadDriver.turns[0]!.input.sessionStartContext!.snapshotId,components:['retired-testing-policy']};
    env.FAUX_CHILD_TOOL_INPUT=JSON.stringify(request);
    const token=(id:string)=>JSON.parse(readFileSync(sessionPaths(paths,sessionId).taskCredentialFile(id),'utf8')).token;
    expect((await bridge.call({token:token('lead'),tool:'deck_prepare_project',arguments:request})).ok).toBe(false);
    expect((await bridge.call({token:'forged',tool:'deck_prepare_project',arguments:request})).ok).toBe(false);
    const delegated=await bridge.call({token:token('lead'),tool:'deck_delegate',arguments:{agent:'setup',task:'Repair the delegated components',preparation:request}});
    expect(delegated).toMatchObject({ok:true});const taskId=(delegated as any).data.taskId;
    await waitFor(()=>!!setupToken&&!credentials.lookup(setupToken),10000,'ended Pi credential');
    if(mode==='repair')expect(readFileSync(file,'utf8')).toContain('policy: proportional');
    else expect(readFileSync(file,'utf8')).toBe(mode==='generation'?original:'schema: spec-driven\n# concurrent edit\n');
    expect((await bridge.call({token:setupToken,tool:'deck_prepare_project',arguments:request})).ok).toBe(false);
  } finally {await manager.close();await server.close();await supervisor.shutdown();broker.dispose();h.cleanup();}
},20000);
