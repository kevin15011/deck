import { afterEach, expect, test } from 'bun:test';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getDefaultDeckConfig } from '@deck/core/config/deck-config';
import { SessionManager } from '../session-manager';
import { ApprovalBroker } from '../approval-broker';
import { BridgeService } from '../bridge-service';
import { CredentialRegistry } from '../credentials';
import { ensureStateLayout, resolveStatePaths } from '../paths';
import type { Supervisor } from '../supervisor';
import { FakeDriver } from '../testing/fake-driver';
import { cleanupTempDirs, tempDir, waitFor } from './test-helpers';
afterEach(cleanupTempDirs);

// Protects the default host composition: public work reaches another runner
// before any native remote receipt, with unchanged current input and task grants.
test('cross-runner continuity survives restart without altering current input or task grants', async () => {
  const home=tempDir(),project=join(home,'project'); mkdirSync(project);
  const paths=resolveStatePaths({env:{HOME:home,XDG_STATE_HOME:join(home,'state')},tmpdir:home});ensureStateLayout(paths);
  const credentials=new CredentialRegistry({socketPath:paths.socket.path});
  const broker=new ApprovalBroker({sink:{emit(){}}});
  const lead=new FakeDriver('claude'),worker=new FakeDriver('codex'),review=new FakeDriver('opencode');
  const drivers=[lead,worker,review];
  const spawnEnvs:Record<string,string>[]=[];
  review.onStart=turn=>{void turn.io.spawn('fixture',[],{env:{FIXTURE_LIFECYCLE:'owned-lifecycle-ticket'}}).catch(()=>{});};
  const makeManager=()=>new SessionManager({paths,broker,credentials,supervisor:{spawn(_command:unknown,_args:unknown,options:any){spawnEnvs.push(options.env);throw Error('fake process boundary');}} as unknown as Supervisor,homeDir:home,
    childMcp:async()=>({runnerPackages:()=>[],resolveServer:()=>undefined}),
    drivers:{get:id=>drivers.find(d=>d.runnerId===id),list:()=>drivers},sessionMcpCommand:['fixture'],
    config:()=>({...getDefaultDeckConfig().crossRunner!,enabled:true,maxConcurrentTasks:4,members:{lead:{runnerId:'claude',modelId:'fixture'},'apply-deep':{runnerId:'codex',modelId:'fixture'},quality:{runnerId:'opencode',modelId:'fixture'}}}),
  });
  let manager=makeManager();
  const bridge=new BridgeService({credentials,broker,status:g=>manager.taskStatus(g),callTaskTool:(g,n,a,c)=>manager.callTaskTool(g,n,a,c)});
  const call=(input:any,tool:string,args:object)=>bridge.call({token:JSON.parse(readFileSync(input.credentialFile,'utf8')).token,tool,arguments:args});
  try {
    const created=await manager.execute({clientId:'test',command:{v:1,commandId:'create',type:'session.create',projectRoot:project}});
    expect(created.ok).toBe(true);const sessionId=(created as any).data.sessionId;
    await manager.execute({sessionId,clientId:'test',command:{v:1,commandId:'prompt',type:'prompt.send',text:'Build a dashboard'}});
    await waitFor(()=>lead.turns.length===1); lead.turns[0]!.init();
    await call(lead.turns[0]!.input,'deck_delegate',{agent:'apply-deep',task:'Use a status light'});
    await waitFor(()=>worker.turns.length===1); const a=worker.turns[0]!;
    a.init(); a.say('Short correction: pending deliveries use violet.'); a.emit('tool.completed',{text:'Verified delivery indicator.'});
    a.finish({status:'failed',error:'fixture turn failed'});
    await waitFor(()=>a.closed);
    await call(lead.turns[0]!.input,'deck_delegate',{agent:'quality',task:'Review the delivery indicator'});
    await waitFor(()=>review.turns.length===1);const b=review.turns[0]!;
    expect(b.input.localContext).toContain('pending deliveries use violet');
    expect(b.input.localContext).toContain('Verified delivery indicator');
    expect(b.input.localContext).toContain('failed');
    expect(b.input.prompt.endsWith('Current Lead instruction:\nReview the delivery indicator')).toBe(true);
    expect(b.input.prompt).not.toContain('pending deliveries use violet');
    expect(b.input.rolePrompt).not.toContain('pending deliveries use violet');
    const history=await call(b.input,'deck_session_history',{});
    expect(history.ok).toBe(true); expect(JSON.stringify(history)).toContain('pending deliveries use violet');
    expect(await call(b.input,'deck_session_history',{sessionId:'foreign'})).toMatchObject({ok:false,code:'invalid-arguments'});
    expect(await call(b.input,'deck_memory_propose',{content:'no duplicate writer'})).toMatchObject({ok:false,code:'tool-not-allowed'});
    expect(spawnEnvs[0]?.FIXTURE_LIFECYCLE).toBe('owned-lifecycle-ticket');
    const oldToken=JSON.parse(readFileSync(b.input.credentialFile,'utf8')).token;
    b.init();b.say('Review observed the violet correction.');b.finish({status:'interrupted'});
    lead.turns[0]!.say('Continue with this work.');lead.turns[0]!.finish();
    await waitFor(()=>b.closed&&lead.turns[0]!.closed);
    await manager.execute({sessionId,clientId:'test',command:{v:1,commandId:'next',type:'prompt.send',text:'Continue the review'}});
    await waitFor(()=>lead.turns.length===2);
    const second=lead.turns[1]!;expect(second.input.resume?.nativeSessionId).toBe(lead.turns[0]!.nativeSessionId);
    expect(second.input.localContext).toContain('pending deliveries use violet');
    second.init();second.say('New observation: delivery ready.');
    await manager.close(); // interruption and durable reload, not an in-memory context cache
    manager=makeManager();
    await manager.execute({sessionId,clientId:'test',command:{v:1,commandId:'restart',type:'prompt.send',text:'Resume after restart'}});
    await manager.execute({sessionId,clientId:'test',command:{v:1,commandId:'resume',type:'prompt.resume'}});
    await waitFor(()=>lead.turns.length===3);
    const resumed=lead.turns[2]!;
    expect(resumed.input.resume?.nativeSessionId).toBe(second.nativeSessionId);
    expect(resumed.input.localContext).toContain('New observation: delivery ready');
    const context=JSON.parse(resumed.input.localContext!.split('\n').slice(1).join('\n'));
    expect(context.records.some((r:any)=>r.seq===JSON.parse(second.input.localContext!.split('\n').slice(1).join('\n')).records.find((r:any)=>r.content.includes('Short correction:'))?.seq)).toBe(false);
    expect(await bridge.call({token:oldToken,tool:'deck_session_history',arguments:{}})).toMatchObject({ok:false,code:'credential-revoked'});

  } finally {await manager.close();}
});
