import {afterEach,expect,test} from 'bun:test';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {createClaudeSessionDriver} from './driver';
import {harness} from './test-support';
import {claudeTranscriptPath} from './steering';
import fixture from './__fixtures__/2.1.296/steering.json';
import type {DriverTaskInput} from '@deck/core/session/driver';

const dirs:string[]=[];
afterEach(()=>{for(const d of dirs.splice(0))rmSync(d,{recursive:true,force:true});});
async function started(version='2.1.296',guarded=true,historyAvailable=true){
 const home=mkdtempSync(join(tmpdir(),'deck-claude-steer-'));dirs.push(home);const h=harness();
 const sid=fixture.folded.target.nativeThreadId;
 const driver=createClaudeSessionDriver({baseEnv:{HOME:home,PATH:'/bin'}});
 const prompt=String(fixture.folded.records.find(r=>r.uuid===fixture.folded.target.nativeTurnId)!.message!.content);
 const input={taskId:'lead',memberId:'lead',cwd:home,assignment:{runnerId:'claude',modelId:'haiku'},prompt,rolePrompt:'',nativeSessionId:sid,mcp:{servers:[],sessionTools:[]},mcpServerSpecs:{},credentialFile:'/private/credential',approvals:'runner-default',disableNativeDelegation:true,...(guarded?{steeringVersion:'2.1.296',inputOrigin:'user'}:{})} as DriverTaskInput;
 const handle=await driver.startTask(input,h.io),child=await h.nextChild(),sent=JSON.parse(child.stdin[0]!);
 const path=claudeTranscriptPath(home,sid,{HOME:home})!;mkdirSync(dirname(path),{recursive:true});
 if(historyAvailable&&sent.uuid)writeFileSync(path,JSON.stringify({type:'user',uuid:sent.uuid,parentUuid:null,sessionId:sid,version:'2.1.296',message:sent.message})+'\n');
 child.stdout(JSON.stringify({type:'system',subtype:'init',session_id:sid,claude_code_version:version,mcp_servers:[],tools:['Bash']})+'\n');
 child.stdout(JSON.stringify({...sent,session_id:sid,isReplay:true})+'\n');
 const target={nativeThreadId:sid,nativeTurnId:sent.uuid},message={...target,clientUserMessageId:fixture.folded.target.clientUserMessageId,text:fixture.folded.target.text};
 const writeFold=()=>writeFileSync(path,fixture.folded.records.map(row=>JSON.stringify(row).replaceAll(fixture.folded.target.nativeTurnId,sent.uuid)).join('\n')+'\n');
 const finish=(error=false)=>{child.stdout(JSON.stringify({type:'result',subtype:error?'error_during_execution':'success',is_error:error,session_id:sid,user_message_uuid:sent.uuid,user_message_uuids:[sent.uuid],num_turns:1,errors:error?['original failure']:[]})+'\n');child.exit();};
 return {driver,h,handle,child,sent,target,message,path,writeFold,finish};
}
test('exact-version guarded execution keeps stdin open, assigns original UUID and writes no-query input once',async()=>{
 const t=await started();expect(t.child.stdinEnded).toBe(false);expect(t.sent.uuid).toMatch(/^[a-f0-9-]{36}$/);expect(t.sent.origin).toEqual({kind:'human'});
 expect(t.handle.steeringTarget?.()).toEqual(t.target);t.writeFold();
 const result=await t.handle.steer!(t.message);expect(result).toEqual({state:'accepted',...t.message,via:'history'});
 const wire=JSON.parse(t.child.stdin[1]!);expect(wire).toMatchObject({uuid:t.message.clientUserMessageId,session_id:t.target.nativeThreadId,shouldQuery:false,priority:'next',origin:{kind:'human'},client_composed:true,message:{role:'user',content:t.message.text}});
 expect(await t.handle.steer!(t.message)).toEqual(result);expect(t.child.stdin).toHaveLength(2);expect(t.child.interrupts).toBe(0);
 t.finish();expect(t.child.stdinEnded).toBe(true);expect(await t.handle.done).toEqual({status:'completed'});
});
test('replay echo without folded history remains uncertain; original completion closes stdin without another execution',async()=>{
 const t=await started(),pending=t.handle.steer!(t.message);
 t.child.stdout(JSON.stringify({type:'user',uuid:t.message.clientUserMessageId,session_id:t.target.nativeThreadId,message:{role:'user',content:t.message.text}})+'\n');
 t.finish();expect(await pending).toMatchObject({state:'unknown'});expect(t.h.children).toHaveLength(1);expect(t.child.interrupts).toBe(0);
 expect(await t.handle.reconcileSteering!(t.message)).toMatchObject({state:'unknown'});
});
test('missing original durable history keeps capability unavailable rather than guessing a profile',async()=>{
 const t=await started('2.1.296',true,false);expect(t.handle.steeringTarget?.()).toBeUndefined();
 expect(await t.handle.steer!(t.message)).toMatchObject({state:'unknown'});expect(t.child.stdin).toHaveLength(1);
 t.finish();await t.handle.done;
});
test('foreign and interrupted targets cannot write native input',async()=>{
 const t=await started();expect(await t.handle.steer!({...t.message,nativeTurnId:'foreign'})).toMatchObject({state:'unknown'});
 await t.handle.interrupt();expect(await t.handle.steer!(t.message)).toMatchObject({state:'unknown'});expect(t.child.stdin).toHaveLength(1);t.finish();await t.handle.done;
});
test('zero-turn transcript receipt cannot hide failure or complete the original execution',async()=>{
 const t=await started(),pending=t.handle.steer!(t.message);
 t.child.stdout(JSON.stringify({type:'result',subtype:'success',is_error:false,session_id:t.target.nativeThreadId,user_message_uuid:t.message.clientUserMessageId,user_message_uuids:[t.message.clientUserMessageId],num_turns:0,result:'Stored'})+'\n');
 expect(t.child.stdinEnded).toBe(false);expect(await pending).toMatchObject({state:'unknown',reason:'claude-transcript-only'});
 t.finish(true);expect(await t.handle.done).toMatchObject({status:'failed'});expect(t.child.stdin).toHaveLength(2);
});
test('late exact history remains retrievable after close without replay',async()=>{
 const t=await started(),pending=t.handle.steer!(t.message);t.finish();await pending;await t.handle.done;await t.handle.close();t.writeFold();
 expect(await t.handle.reconcileSteering!(t.message)).toEqual({state:'accepted',...t.message,via:'history'});expect(t.child.stdin).toHaveLength(2);
});
test('ambiguous zero-turn result cannot claim the original execution completion',async()=>{
 const t=await started(),pending=t.handle.steer!(t.message);
 t.child.stdout(JSON.stringify({type:'result',subtype:'success',is_error:false,session_id:t.target.nativeThreadId,user_message_uuid:t.message.clientUserMessageId,user_message_uuids:[t.sent.uuid,t.message.clientUserMessageId],num_turns:0})+'\n');
 expect(await t.handle.done).toMatchObject({status:'failed',error:'claude-result-correlation-mismatch'});expect(await pending).toMatchObject({state:'unknown'});expect(t.child.stdin).toHaveLength(2);
});
test('recorded native composed completion preserves original UUID with folded client membership',async()=>{
 const t=await started();t.writeFold();expect((await t.handle.steer!(t.message)).state).toBe('accepted');
 const recorded=fixture.composedResult;
 const wire=JSON.stringify(recorded.payload).replaceAll(recorded.nativeSessionId,t.target.nativeThreadId).replaceAll(recorded.originalExecutionUUID,t.sent.uuid).replaceAll(recorded.clientUUID,t.message.clientUserMessageId);
 t.child.stdout(wire+'\n');expect(t.child.stdinEnded).toBe(true);t.child.exit();expect(await t.handle.done).toEqual({status:'completed'});
});
test.each(['2.1.295','2.1.297'])('runtime init drift %s never exposes steering',async version=>{
 const t=await started(version);expect(t.handle.steeringTarget?.()).toBeUndefined();expect(t.child.stdinEnded).toBe(true);t.finish();await t.handle.done;
});
test('older host inputs retain the original stdin lifecycle and no steering surface',async()=>{
 const t=await started('2.1.296',false);expect(t.child.stdinEnded).toBe(true);expect(t.handle.steer).toBeUndefined();t.finish();await t.handle.done;
});
test('overflow resolves pending no-query input as unconfirmed and removes its target without replay',async()=>{
 const t=await started(),pending=t.handle.steer!(t.message);
 t.child.stdout('x'.repeat(16*1024*1024+1));
 expect(await pending).toEqual({state:'unknown',reason:'native-transport-unconfirmed'});
 expect(t.handle.steeringTarget?.()).toBeUndefined();
 expect(await t.handle.done).toMatchObject({status:'failed',error:'claude-line-too-long'});
 expect(t.child.stdin).toHaveLength(2);expect(t.child.terminations).toHaveLength(1);
 await t.handle.close();
});
