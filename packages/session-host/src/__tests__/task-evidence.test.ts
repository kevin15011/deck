import {expect,test} from 'bun:test';
import {Ledger} from '../ledger';
import type {SessionEvent,SessionEventKind} from '@deck/core/session/events';
test('pending/selection replay replaces native identity, timestamps only terminal state, and ignores old attempt input',()=>{
 const ledger=Ledger.empty('s');let seq=0;
 const apply=(kind:SessionEventKind,data:Record<string,unknown>,thread?:string)=>ledger.apply({v:1,sessionId:'s',seq:++seq,ts:new Date(seq*1000).toISOString(),kind,data,source:{taskId:'t',...(thread?{nativeSessionId:thread}:{})}});
 apply('task.created',{taskId:'t',memberId:'apply-deep',runnerId:'codex',modelId:'m',continuityPending:true});apply('task.state',{taskId:'t',state:'running',nativeSessionId:'old',launched:true});apply('turn.started',{});
 apply('usage',{attempt:1,requestInput:{tokens:0,basis:'codex-last-input',nativeThreadId:'old',nativeTurnId:'turn',modelId:'m',final:true}},'old');apply('task.state',{taskId:'t',state:'completed'});
 const terminal=ledger.latest('t')!.endedAt;
 apply('task.retrieval',{taskId:'t',attempt:1,leadTaskId:'lead',leadAttempt:1});expect(ledger.latest('t')!.endedAt).toBe(terminal);
 apply('task.continued',{taskId:'t',attempt:2,continuityPending:true});expect(ledger.latest('t')!.continuity).toBeUndefined();expect(ledger.latest('t')!.continuityPending).toBe(true);
 apply('task.state',{taskId:'t',state:'running',selection:{continuity:'reseeded',reason:'unknown',selectedAt:1,policy:{},override:'none'},nativeSessionId:'new'});
 expect(ledger.nativeConfirmed('t')).toBe(false);expect(ledger.latest('t')!.nativeSessionId).toBe('new');
 apply('usage',{attempt:1,requestInput:{tokens:999,basis:'codex-last-input',nativeThreadId:'old',nativeTurnId:'turn',modelId:'m',final:true}},'old');expect(ledger.latest('t')!.requestInput).toBeUndefined();
 apply('usage',{attempt:2,requestInput:{tokens:10,basis:'codex-last-input',nativeThreadId:'new',nativeTurnId:'turn2',modelId:'m',final:true}},'new');expect(ledger.latest('t')!.requestInput?.tokens).toBe(10);
 apply('diagnostic',{attempt:2,code:'context.compaction'},'new');expect(ledger.latest('t')!.requestInput).toBeUndefined();
 expect(Ledger.fromState(ledger.toState()).toState()).toEqual(ledger.toState());
});
test('task edit projection stays bounded, ignores unattributed/failed paths and drops stale diff when overwritten',()=>{
 const ledger=Ledger.empty('s');let seq=0;
 const apply=(kind:SessionEventKind,data:Record<string,unknown>)=>ledger.apply({v:1,sessionId:'s',seq:++seq,ts:new Date(seq).toISOString(),kind,data,source:{taskId:'t'}});
 apply('task.created',{taskId:'t',memberId:'apply-deep',runnerId:'codex',modelId:'m'});apply('task.state',{taskId:'t',state:'running'});
 apply('tool.completed',{status:'failed',isError:true,edits:[{path:'bad.ts',op:'add'}]});
 apply('tool.completed',{status:'completed',edits:Array.from({length:257},(_,i)=>({path:`p${i}.ts`,op:'update'}))});
 expect(ledger.latest('t')!.edits?.length).toBe(256);expect(ledger.latest('t')!.editOverflow).toBe(true);expect(ledger.task('t')!.taskEdits?.length).toBe(256);
 apply('tool.completed',{status:'completed',edits:[{path:'p0.ts',op:'update',diff:'old'}]});apply('tool.completed',{status:'completed',edits:[{path:'p0.ts',op:'update'}]});expect(ledger.task('t')!.taskEdits?.find(e=>e.path==='p0.ts')?.diff).toBeUndefined();
});

test('Lead recovery projection preserves original request, bounded substantive history and replay fences',()=>{
 const ledger=Ledger.empty('s');let seq=0;const rows:SessionEvent[]=[];
 const apply=(kind:SessionEventKind,data:Record<string,unknown>,source:SessionEvent['source']={taskId:'lead',memberId:'lead'})=>{const e:SessionEvent={v:1,sessionId:'s',seq:++seq,ts:new Date(seq).toISOString(),kind,data,source};rows.push(e);ledger.apply(e);};
 apply('task.created',{taskId:'lead',memberId:'lead',runnerId:'claude',modelId:'m'});
 apply('task.state',{taskId:'lead',state:'running',nativeSessionId:'native'});
 apply('message.completed',{role:'user',text:'original requirement'});
 for(let i=0;i<20;i++)apply('message.completed',{role:'assistant',text:`substantive answer ${i} `+'界'.repeat(3000)});
 const projected=structuredClone(ledger.task('lead')!.leadRecovery!);
 expect(projected.original?.text).toBe('original requirement');expect(projected.recent).toHaveLength(8);
 expect(projected.recent.at(-1)?.text).toStartWith('substantive answer 19');
 expect(projected.recent.every(m=>Buffer.byteLength(m.text,'utf8')<=1024&&m.truncated)).toBe(true);
 apply('message.completed',{role:'assistant',text:'wrong native'}, {taskId:'lead',nativeSessionId:'foreign'});
 apply('message.completed',{role:'assistant',text:'stale attempt',attempt:99});
 apply('message.completed',{role:'user',text:'internal notice',internal:true});
 apply('message.completed',{role:'user',text:'daemon notice',by:'daemon'});
 apply('task.state',{taskId:'lead',state:'completed'});
 apply('message.completed',{role:'assistant',text:'after termination'});
 expect(ledger.task('lead')!.leadRecovery).toEqual(projected);
 const replay=Ledger.empty('s');for(const e of rows)replay.apply(e);
 expect(replay.task('lead')!.leadRecovery).toEqual(projected);
 expect(Ledger.fromState(ledger.toState()).task('lead')!.leadRecovery).toEqual(projected);
});

test('public agent message projection is byte bounded, includes streaming-only text and fences hidden/late evidence',()=>{
 const ledger=Ledger.empty('s');let seq=0;const rows:SessionEvent[]=[];
 const apply=(kind:SessionEventKind,data:Record<string,unknown>,nativeSessionId='native')=>{const event:SessionEvent={v:1,sessionId:'s',seq:++seq,ts:new Date(seq).toISOString(),kind,data,source:{taskId:'t',nativeSessionId}};rows.push(event);ledger.apply(event);};
 apply('task.created',{taskId:'t',memberId:'apply-deep',runnerId:'claude',modelId:'m',nativeSessionId:'native'});apply('task.state',{taskId:'t',state:'running',nativeSessionId:'native',launched:true});
 apply('message.delta',{messageId:'progress',text:'Public partial '});apply('message.delta',{messageId:'progress',text:'界'.repeat(5000)});
 const partial=structuredClone(ledger.latest('t')!.lastAgentMessage!);
 expect(partial.text).toStartWith('Public partial ');expect(Buffer.byteLength(partial.text)).toBeLessThanOrEqual(4096);expect(partial).toMatchObject({streaming:true,truncated:true,firstSeq:3,seq:4});
 apply('reasoning.delta',{text:'HIDDEN_REASONING'});apply('message.completed',{role:'assistant',internal:true,text:'INTERNAL'});apply('message.delta',{role:'user',text:'USER'});apply('message.delta',{messageId:'foreign',text:'FOREIGN'},'foreign');apply('message.delta',{attempt:99,text:'OLD'});
 expect(ledger.latest('t')!.lastAgentMessage).toEqual(partial);
 apply('message.completed',{role:'assistant',messageId:'progress',text:'Public complete snapshot'});
 expect(ledger.latest('t')!.lastAgentMessage).toMatchObject({text:'Public complete snapshot',streaming:false,truncated:false});
 apply('message.delta',{messageId:'new',text:'New unfinished message'});
 apply('task.state',{taskId:'t',state:'interrupted',stop:{origin:'user',kind:'interrupt',commandId:'stop',launched:true}});
 const final=structuredClone(ledger.latest('t')!.lastAgentMessage);apply('message.delta',{messageId:'new',text:'AFTER_END'});expect(ledger.latest('t')!.lastAgentMessage).toEqual(final);
 const replay=Ledger.empty('s');for(const e of rows)replay.apply(e);expect(replay.toState()).toEqual(ledger.toState());
 expect(Ledger.fromState(ledger.toState()).latest('t')!.lastAgentMessage).toEqual(final);
});
