import {test,expect} from 'bun:test';
import {escapeInput,restoreInput,reconcileRecalls,retainRecall} from './input-recall';
import {readDraft,writeDraft} from './draft-storage';
import type {Receipt} from './api';
const input=(id:string,phase:Receipt['phase']='queued',extra:Partial<Receipt>={})=>({id,session:'session',attempt:'attempt',prompt:id,phase,dispatch_ms:null,attachments:[],...extra}) as Receipt;
function storage(){const values=new Map<string,string>();return {get length(){return values.size;},key:(i:number)=>[...values.keys()][i]??null,getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>{values.set(k,v);},removeItem:(k:string)=>{values.delete(k);},clear:()=>values.clear()} as Storage;}
const owner='scope',key='deck2.scope.draft';
const ack=(r:Receipt)=>({id:r.id,session:r.session,attempt:r.attempt,state:'cancelled'});
test('newest queued then explicitly undispatched input then current interruption; uncertain and recalled have no recall',()=>{
 const running=input('running','running',{dispatch_ms:1}),pending=input('pending','preparing');
 expect(escapeInput([running,pending,input('old'),input('new')])?.input.id).toBe('new');
 expect(escapeInput([running,pending])?.kind).toBe('recall');
 expect(escapeInput([running,input('claimed','preparing',{dispatch_ms:1})])?.kind).toBe('interrupt');
 expect(escapeInput([input('unknown','uncertain'),input('recalled','preparing',{recalled_ms:1})])).toBeUndefined();
});
test('only user input can be recalled into the draft while an outcome is queued or preparing',()=>{
 const continuation={task:'task',attempt:'member-attempt',source_seq:1,origin:'previous-root'};
 expect(escapeInput([input('user'),input('outcome','queued',{continuation})])?.input.id).toBe('user');
 expect(escapeInput([input('outcome','preparing',{continuation})])).toBeUndefined();
});
test('exact acknowledgement restores after intervening edits; mismatched replies preserve draft/images',async()=>{
 const s=storage(),r=input('recalled');let images=0,finish!:(v:unknown)=>void;
 writeDraft(s,key,'before');
 const run=restoreInput(s,owner,r,()=>new Promise(resolve=>finish=resolve),()=>{},()=>images++);
 expect(readDraft(s,key)).toBe('before');writeDraft(s,key,'edited while waiting');finish(ack(r));
 expect(await run).toBe(true);expect(readDraft(s,key)).toBe('recalled\n\nedited while waiting');expect(images).toBe(1);
 for(const patch of [{id:'other'},{session:'other'},{attempt:'other'},{state:'requested'}]){
  expect(await restoreInput(s,owner,r,async()=>({...ack(r),...patch}),()=>{throw Error('must not publish')},()=>{throw Error('must not restore images')})).toBe(false);
 }
});
test('lost acknowledgement reconciles exact durable recall after reload without repeating network effects',async()=>{
 const s=storage(),r=input('original');let images=0;
 await expect(restoreInput(s,owner,r,async()=>{throw Error('Lost response')},()=>{},()=>images++)).rejects.toThrow('Lost response');
 // Unconfirmed and different-attempt projections cannot publish recovered input.
 reconcileRecalls(s,owner,r.session,[r,{...r,attempt:'other',recalled_ms:1}],()=>{throw Error('unconfirmed')},()=>images++);
 writeDraft(s,key,'new edit');
 reconcileRecalls(s,owner,r.session,[{...r,recalled_ms:1}],()=>{},()=>images++);
 expect(readDraft(s,key)).toBe('original\n\nnew edit');expect(images).toBe(1);
 writeDraft(s,key,'edited after recovery');
 reconcileRecalls(s,owner,r.session,[{...r,recalled_ms:1}],()=>{throw Error('duplicate')},()=>images++);
 expect(readDraft(s,key)).toBe('edited after recovery');expect(images).toBe(1);
});
test('partial image persistence is resumable even after intervening text edits and preparing prompt is never duplicated',async()=>{
 const s=storage(),r=input('original','preparing');writeDraft(s,key,r.prompt);
 await expect(restoreInput(s,owner,r,async()=>ack(r),()=>{},()=>{throw Error('image storage')})).rejects.toThrow('image storage');
 expect(readDraft(s,key)).toBe('original');writeDraft(s,key,'edited after partial recovery');
 let images=0;reconcileRecalls(s,owner,r.session,[r],()=>{},()=>images++);
 expect(readDraft(s,key)).toBe('edited after partial recovery');expect(images).toBe(1);
});
test('failed intent persistence prevents recall and failed text persistence remains recoverable',async()=>{
 const s=storage(),r=input('original'),set=s.setItem;
 s.setItem=()=>{throw Error('storage')};
 await expect(restoreInput(s,owner,r,async()=>{throw Error('must not dispatch')},()=>{},()=>{})).rejects.toThrow('storage');
 s.setItem=set;retainRecall(s,owner,r);s.setItem=(k,v)=>{if(k===key)throw Error('draft storage');set(k,v);};
 expect(()=>reconcileRecalls(s,owner,r.session,[{...r,recalled_ms:1}],()=>{},()=>{throw Error('must not restore images')})).toThrow('draft storage');
 s.setItem=set;reconcileRecalls(s,owner,r.session,[{...r,recalled_ms:1}],()=>{},()=>{});
 expect(readDraft(s,key)).toBe('original');
});
test('late acknowledgement cannot restore again after polling completed and user changed the recovered draft',async()=>{
 const s=storage(),r=input('original');let images=0,finish!:(v:unknown)=>void;
 const run=restoreInput(s,owner,r,()=>new Promise(resolve=>finish=resolve),()=>{},()=>images++);
 reconcileRecalls(s,owner,r.session,[{...r,recalled_ms:1}],()=>{},()=>images++);
 writeDraft(s,key,'changed after reconnect');finish(ack(r));
 expect(await run).toBe(true);expect(readDraft(s,key)).toBe('changed after reconnect');expect(images).toBe(1);
});
