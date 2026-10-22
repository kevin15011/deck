import {afterEach,expect,test} from 'bun:test';
import {randomUUID} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {createClaudeSessionDriver} from '../../../adapter-claude/src/session-driver/driver';
import {harness} from '../../../adapter-claude/src/session-driver/test-support';
import {claudeTranscriptPath} from '../../../adapter-claude/src/session-driver/steering';
import fixture from '../../../adapter-claude/src/session-driver/__fixtures__/2.1.296/steering.json';
import {ApprovalBroker} from '../approval-broker';
import {CredentialRegistry} from '../credentials';
import {ensureStateLayout,resolveStatePaths,sessionPaths} from '../paths';
import {SessionManager} from '../session-manager';
import {Supervisor} from '../supervisor';
import {Ledger,loadLedger} from '../ledger';
import {tempDir,tempSubdir,cleanupTempDirs,waitFor} from './test-helpers';
import type {DriverTaskInput,RunnerSessionDriver} from '@deck/core/session/driver';
import type {CrossRunnerConfig} from '@deck/core/config/deck-config';

const cleanups:Array<()=>Promise<void>>=[];
afterEach(async()=>{for(const f of cleanups.splice(0).reverse())await f();cleanupTempDirs();});
async function setup(version='2.1.296',timeout=3000){
 const home=tempDir(),project=tempSubdir(home,'project'),h=harness(),inputs:DriverTaskInput[]=[];
 const paths=resolveStatePaths({env:{HOME:home,XDG_STATE_HOME:join(home,'state')},tmpdir:home});ensureStateLayout(paths);
 const actual=createClaudeSessionDriver({baseEnv:{HOME:home,PATH:'/bin'},exec:async()=>({code:0,stdout:`${version} (Claude Code)`})});
 const driver:RunnerSessionDriver={...actual,startTask:(input,io)=>{inputs.push(input);return actual.startTask(input,{...io,spawn:h.io.spawn});}};
 const credentials=new CredentialRegistry({socketPath:paths.socket.path});let manager!:SessionManager;
 const config:CrossRunnerConfig={enabled:true,members:{lead:{runnerId:'claude',modelId:'haiku'}},approvals:{claude:'relay',opencode:'relay',codex:'runner-default'},maxConcurrentTasks:4,claudeTosAcknowledgedAt:'2026-10-12T00:00:00Z',web:{port:0,trustedProxy:null,allowedOrigins:[],allowFunnel:false}};
 const options={paths,credentials,broker:new ApprovalBroker({sink:{emit:(id:string,draft:any)=>{manager.openLog(id)?.append(draft);}}}),supervisor:new Supervisor({anchorCommand:['unused']}),drivers:{get:(id:string)=>id==='claude'?driver:undefined,list:()=>[driver]},config:()=>config,sessionMcpCommand:['/not-started/deck'],homeDir:home,steeringTimeoutMs:timeout};
 manager=new SessionManager(options);cleanups.push(async()=>{config.enabled=false;for(const c of h.children)c.exit();await manager.close();});
 const command=(body:any,id?:string)=>manager.execute({sessionId:id,clientId:'claude-fixture',command:{v:1,commandId:randomUUID(),...body}});
 const id=(await command({type:'session.create',projectRoot:project}) as any).data.sessionId;
 const first=await command({type:'prompt.send',text:'Original genuine request'},id);const child=await h.nextChild();await waitFor(()=>child.stdin.length===1);
 const init=(n=0)=>{const c=h.children[n]!,sent=JSON.parse(c.stdin[0]!);if(sent.uuid){const file=claudeTranscriptPath(project,sent.session_id,{HOME:home})!;mkdirSync(dirname(file),{recursive:true});writeFileSync(file,JSON.stringify({type:'user',uuid:sent.uuid,parentUuid:null,sessionId:sent.session_id,version:'2.1.296',message:sent.message})+'\n');}c.stdout(JSON.stringify({type:'system',subtype:'init',session_id:inputs[n]!.nativeSessionId??inputs[n]!.resume?.nativeSessionId,claude_code_version:version,mcp_servers:inputs[n]!.mcp.servers.map(name=>({name,status:'connected'})),tools:['Bash']})+'\n');c.stdout(JSON.stringify({...sent,isReplay:true})+'\n');return sent;};
 const sent=init();
 const events=()=>[...manager.openLog(id)!.readAfter(0)];
 const ledger=()=>loadLedger(manager.openLog(id)!,sessionPaths(paths,id).ledgerSnapshotFile).ledger;
 const grant=()=>credentials.lookup(JSON.parse(readFileSync(sessionPaths(paths,id).taskCredentialFile('lead'),'utf8')).token)!;
 const call=(name:string,args:any)=>manager.callTaskTool(grant(),name,args);
 const path=()=>claudeTranscriptPath(project,sent.session_id,{HOME:home})!;
 const fold=(message:any)=>{
  const rows=JSON.parse(JSON.stringify(fixture.folded.records).replaceAll(fixture.folded.target.nativeThreadId,message.nativeThreadId).replaceAll(fixture.folded.target.nativeTurnId,message.nativeTurnId).replaceAll(fixture.folded.target.clientUserMessageId,message.clientUserMessageId)) as any[];
  rows.find(r=>r.uuid===message.nativeTurnId).message.content=sent.message.content;
  rows.find(r=>r.attachment?.source_uuid===message.clientUserMessageId).attachment.prompt=message.text;
  rows.find(r=>r.reason==='absorbed_mid_turn').content=message.text;
  mkdirSync(dirname(path()),{recursive:true});writeFileSync(path(),rows.map(r=>JSON.stringify(r)).join('\n')+'\n');
 };
 const finish=(n=0)=>{const c=h.children[n]!,original=JSON.parse(c.stdin[0]!);c.stdout(JSON.stringify({type:'result',subtype:'success',is_error:false,session_id:original.session_id??inputs[n]!.nativeSessionId??inputs[n]!.resume?.nativeSessionId,user_message_uuid:original.uuid,user_message_uuids:[original.uuid],num_turns:1})+'\n');c.exit();};
 return {home,h,paths,config,options,manager,id,command,events,ledger,call,child,sent,fold,finish,init,inputs,first,path};
}
test('production host + Claude driver gates exactly and admits only positively folded input with immutable pre-write age',async()=>{
 const t=await setup();expect(t.inputs[0]!.steeringVersion).toBe('2.1.296');
 expect((await t.manager.query('prompts.list',{sessionId:t.id}) as any).data.steeringAvailable).toBe(true);
 const source=(t.first as any).data.promptId,decision=(await t.call('deck_decision_open',{commandId:'claude-open',key:'scope',question:'Proceed?',source:{promptId:source}}) as any).data.decisionId;
 const reply=await t.command({type:'prompt.send',text:'Yes, proceed',delivery:'current-turn'},t.id),replyId=(reply as any).data.promptId;
 await waitFor(()=>t.child.stdin.length===2);const fence=t.events().find(e=>e.kind==='prompt.steering')!;
 expect(fence.data.runnerId).toBe('claude');expect(t.ledger().prompt(replyId)?.firstAdmissionSeq).toBeUndefined();
 expect(await t.call('deck_decision_resolve',{commandId:'before-proof',decisionId:decision,expectedRevision:1,promptId:replyId,note:'Unproven',disposition:'allow',action:'execute'})).toMatchObject({ok:false});
 t.fold(fence.data);t.child.stdout(t.child.stdin[1]!);await waitFor(()=>t.ledger().prompt(replyId)?.steering?.state==='accepted');
 expect(t.ledger().prompt(replyId)).toMatchObject({firstAdmissionSeq:fence.seq,steering:{eligible:true,runnerId:'claude'}});
 expect(await t.call('deck_decision_resolve',{commandId:'after-proof',decisionId:decision,expectedRevision:1,promptId:replyId,note:'Genuine confirmed input',disposition:'allow',action:'execute'})).toMatchObject({ok:true});
 const duplicate=await t.command({commandId:replyId,type:'prompt.send',text:'Yes, proceed',delivery:'current-turn'},t.id);expect(duplicate).toMatchObject({ok:true,duplicate:true});expect(t.child.stdin).toHaveLength(2);
 expect(t.inputs[0]!.prompt).toBe('Original genuine request');expect(t.child.interrupts).toBe(0);t.finish();
});
test('transcript-only receipt stays uncertain/non-authoritative through replay and never falls back into the queue',async()=>{
 const t=await setup(),reply=await t.command({type:'prompt.send',text:'Potentially retained text',delivery:'current-turn'},t.id),replyId=(reply as any).data.promptId;
 await waitFor(()=>t.child.stdin.length===2);const fence=t.events().find(e=>e.kind==='prompt.steering')!;
 t.child.stdout(JSON.stringify({type:'result',subtype:'success',is_error:false,session_id:t.sent.session_id,user_message_uuid:replyId,user_message_uuids:[replyId],num_turns:0})+'\n');
 await waitFor(()=>t.ledger().prompt(replyId)?.steering?.state==='unknown');
 expect(t.ledger().prompt(replyId)?.firstAdmissionSeq).toBeUndefined();
 const snapshot=(await t.manager.query('prompts.list',{sessionId:t.id}) as any).data;
 expect(snapshot.queued).toHaveLength(0);expect(snapshot.deliveries).toMatchObject([{runnerId:'claude',state:'unknown',historical:true}]);
 for(const end of [fence.seq,t.events().at(-1)!.seq]){
  const replay=Ledger.empty(t.id);for(const event of t.events().filter(e=>e.seq<=end))replay.apply(event);
  expect(replay.prompt(replyId)?.firstAdmissionSeq).toBeUndefined();expect(replay.prompt(replyId)?.state).not.toBe('queued');
 }
 t.finish();await waitFor(()=>!t.manager.hasRunningWork());expect(t.h.children).toHaveLength(1);
 await t.manager.close();const next=new SessionManager(t.options);cleanups.push(()=>next.close());
 expect((await next.query('prompts.list',{sessionId:t.id}) as any).data.deliveries).toMatchObject([{runnerId:'claude',state:'unknown'}]);expect(t.h.children).toHaveLength(1);
});
test('fold proof arriving after the original native result is historical only, never refreshed admission authority',async()=>{
 const t=await setup('2.1.296',30),reply=await t.command({type:'prompt.send',text:'Late confirmed original input',delivery:'current-turn'},t.id),replyId=(reply as any).data.promptId;
 await waitFor(()=>t.child.stdin.length===2);const fence=t.events().find(e=>e.kind==='prompt.steering')!;
 t.child.stdout(JSON.stringify({type:'result',subtype:'success',is_error:false,session_id:t.sent.session_id,user_message_uuid:t.sent.uuid,user_message_uuids:[t.sent.uuid],num_turns:1})+'\n');
 t.fold(fence.data);t.child.stdout(t.child.stdin[1]!);await waitFor(()=>t.ledger().prompt(replyId)?.steering?.state==='accepted');
 expect(t.ledger().prompt(replyId)).toMatchObject({firstAdmissionSeq:fence.seq,steering:{eligible:false}});
 expect((await t.manager.query('prompts.list',{sessionId:t.id}) as any).data.deliveries).toMatchObject([{runnerId:'claude',historical:true,state:'accepted'}]);
 t.child.exit();await waitFor(()=>!t.manager.hasRunningWork());expect(t.h.children).toHaveLength(1);
});
test.each(['2.1.297'])('unsupported Claude %s keeps ordinary queued delivery',async version=>{
 const t=await setup(version);expect(t.inputs[0]!.steeringVersion).toBeUndefined();
 await t.command({type:'prompt.send',text:'Queue this',delivery:'current-turn'},t.id);expect(t.child.stdin).toHaveLength(1);
 expect((await t.manager.query('prompts.list',{sessionId:t.id}) as any).data.queued).toHaveLength(1);t.config.enabled=false;t.finish();
});
test('stale targeted folded input cannot resolve or replan using newer acknowledgement chronology',async()=>{
 const t=await setup(),source=(t.first as any).data.promptId;
 const decision=(await t.call('deck_decision_open',{commandId:'claude-stale-open',key:'scope',question:'Original scope?',source:{promptId:source}}) as any).data.decisionId;
 const reply=await t.command({type:'prompt.send',text:'Yes to the old scope',delivery:'current-turn',decisionTarget:{decisionId:decision,revision:1}},t.id),id=(reply as any).data.promptId;
 await waitFor(()=>t.child.stdin.length===2);const fence=t.events().find(e=>e.kind==='prompt.steering')!;
 await t.call('deck_decision_revise',{commandId:'claude-revise-after-write',decisionId:decision,expectedRevision:1,question:'Different scope?',note:'Substantive change'});
 t.fold(fence.data);t.child.stdout(t.child.stdin[1]!);await waitFor(()=>t.ledger().prompt(id)?.steering?.state==='accepted');
 expect(t.ledger().prompt(id)).toMatchObject({firstAdmissionSeq:fence.seq,steering:{eligible:false,stale:true}});
 expect(await t.call('deck_decision_resolve',{commandId:'claude-stale-resolve',decisionId:decision,expectedRevision:2,promptId:id,note:'Old answer is stale',disposition:'allow',action:'execute'})).toMatchObject({ok:false});
 expect(t.child.stdin).toHaveLength(2);t.finish();
});
test('older FIFO input prevents steering and an explicit queue pause prevents availability',async()=>{
 const t=await setup();await t.command({type:'prompt.send',text:'Older queued input'},t.id);
 await t.command({type:'prompt.send',text:'Current intent behind older input',delivery:'current-turn'},t.id);
 expect(t.child.stdin).toHaveLength(1);expect(t.events().filter(e=>e.kind==='prompt.steering')).toHaveLength(0);
 t.manager.openLog(t.id)!.append({kind:'prompt.queue',data:{paused:true,reason:'fixture-pause'}});
 expect((await t.manager.query('prompts.list',{sessionId:t.id}) as any).data.steeringAvailable).toBe(false);
 t.config.enabled=false;t.finish();
});
for(const fault of ['append','flush'] as const)test(`${fault} retained fence failure cannot write or replay Claude input`,async()=>{
 const t=await setup(),log=t.manager.openLog(t.id)!,append=log.appendMany.bind(log),flush=log.flush.bind(log),id=randomUUID();
 if(fault==='append')log.appendMany=drafts=>{const result=append(drafts);if(drafts.some(d=>d.kind==='prompt.steering'))throw Error('retained fence');return result;};
 else log.flush=()=>{if(t.events().some(e=>e.kind==='prompt.steering'))throw Error('retained fence');flush();};
 await expect(t.command({commandId:id,type:'prompt.send',text:'Must not write before flush',delivery:'current-turn'},t.id)).rejects.toThrow();
 log.appendMany=append;log.flush=flush;expect(t.child.stdin).toHaveLength(1);
 const replay=Ledger.empty(t.id);for(const e of t.events())replay.apply(e);
 expect(replay.prompt(id)?.state).toBe('steering');expect(replay.prompt(id)?.firstAdmissionSeq).toBeUndefined();
 await t.command({commandId:id,type:'prompt.send',text:'Must not write before flush',delivery:'current-turn'},t.id);expect(t.child.stdin).toHaveLength(1);
 t.config.enabled=false;t.finish();
});

test('native Claude end boundary reaches consumers once and closes steering before host finalization', async () => {
 const t = await setup();
 expect((await t.manager.query('prompts.list', { sessionId: t.id }) as any).data.steeringAvailable).toBe(true);
 const observed: number[] = [];
 const unsubscribe = t.manager.subscribeEvents(event => {
  if (event.sessionId === t.id && event.kind === 'diagnostic' && event.data.code === 'claude-steering-ended') observed.push(event.seq);
 });
 cleanups.push(async () => unsubscribe());
 const result = { type: 'result', subtype: 'success', is_error: false, session_id: t.sent.session_id, user_message_uuid: t.sent.uuid, user_message_uuids: [t.sent.uuid], num_turns: 1 };
 t.child.stdout(JSON.stringify(result) + '\n');
 expect(observed).toHaveLength(1);
 expect(t.events().filter(event => event.data.code === 'claude-steering-ended').map(event => event.seq)).toEqual(observed);
 expect((await t.manager.query('prompts.list', { sessionId: t.id }) as any).data.steeringAvailable).toBe(false);
 expect(t.events().filter(event => event.kind === 'turn.completed')).toHaveLength(0);
 expect(t.ledger().latest('lead')?.state).toBe('running');
 t.child.stdout(JSON.stringify(result) + '\n');
 expect(observed).toHaveLength(1);
 t.child.exit();
 await waitFor(() => !t.manager.hasRunningWork());
 expect(t.ledger().latest('lead')?.state).toBe('completed');
 expect(t.events().filter(event => event.kind === 'turn.completed')).toHaveLength(1);
 expect(t.events().filter(event => event.seq > observed[0]! && event.data.code === 'prompt.steering-capability' && event.data.available === false)).toHaveLength(1);
});
