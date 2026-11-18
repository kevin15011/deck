import {test,expect} from 'bun:test';
import {API,type Receipt} from './api';
import {pendingCommands,type PendingCommand} from './command-pending';
import {admitCommand,acknowledgedDraft} from './command-admission';
class MemoryStorage implements Storage {
 data=new Map<string,string>();get length(){return this.data.size;}key(i:number){return [...this.data.keys()][i]??null;}getItem(k:string){return this.data.get(k)??null;}setItem(k:string,v:string){this.data.set(k,v);}removeItem(k:string){this.data.delete(k);}clear(){this.data.clear();}
}
const input:PendingCommand={id:'queued-input',session:'session-a',prompt:'Next message',mode:'read_only',fresh:false,attachments:[],target:null,queue:true};
const accepted={...input,phase:'queued',text:'',detail:'Waiting',native_pid:null,model:null,local_tool_calls:0,thread:null,turn:null,accepted_ms:1,handshake_ms:null,dispatch_ms:null,first_output_ms:null,revision:1,policy:'fixture',runner:'fixture',delivery:'Not dispatched'};
// Protects durable once-only admission and draft preservation under lost replies.
// Oracle: busy-input agreement + existing API7; fails if retry changes the payload,
// dispatch precedes retention, foreign receipts clear drafts or newer edits vanish.
test('lost acknowledgment retains exact queue input for reload and retry',async()=>{
 const storage=new MemoryStorage(),scope='host.h.project.p.session.a';let captured:{method:string;path:string;body:unknown}|undefined;
 await expect(admitCommand(storage,scope,input,async(method,path,body)=>{
  expect(pendingCommands(storage,scope,input.session)).toEqual([input]);
  captured={method,path,body};throw Error('reply lost');
 })).rejects.toThrow('reply lost');
 const retained=pendingCommands(storage,scope,input.session)[0];
 expect(retained).toEqual(input);
 const result=await admitCommand(storage,scope,retained,async(method,path,body)=>{expect({method,path,body}).toEqual(captured!);return accepted;});
 expect(result.phase).toBe('queued');expect(pendingCommands(storage,scope,input.session)).toEqual([input]);
 expect(acknowledgedDraft(input,input.prompt,input.prompt)).toBe('');
 expect(acknowledgedDraft(input,'new draft',input.prompt)).toBeUndefined();
 expect(acknowledgedDraft(input,input.prompt,'other tab draft')).toBeUndefined();
});
test('refusal mismatch and storage failure never authorize success',async()=>{
 const scope='host.h.project.p.session.a';
 for(const response of [{...accepted,session:'session-b'},{...accepted,prompt:'changed'},{}]){
  const storage=new MemoryStorage();await expect(admitCommand(storage,scope,input,async()=>response)).rejects.toThrow();
  expect(pendingCommands(storage,scope,input.session)).toEqual([input]);
 }
 const storage=new MemoryStorage();storage.setItem=()=>{throw Error('storage unavailable');};let dispatched=false;
 await expect(admitCommand(storage,scope,input,async()=>{dispatched=true;return accepted;})).rejects.toThrow();expect(dispatched).toBe(false);
});
test('exact question target and session survive queued retry',async()=>{
 const p={...input,target:{decisionId:'question/a',sessionId:input.session,revision:3,questionRevision:2,question:'Proceed?'}};
 await admitCommand(new MemoryStorage(),'owner',p,async(method,path,body)=>{
  expect(method).toBe('POST');expect(path).toBe('/api/commands?decisionId=question%2Fa&revision=3');
  expect(body).toEqual({api:API,id:p.id,prompt:p.prompt,attachments:[],mode:p.mode,session:p.session,queue:true,fresh:false});return accepted;
 });
});

// Protects default production transport composition, including API error identity.
// Oracle: API7 receipt/non-acceptance contract, with only fetch replaced.
test('default request transport admits real receipt JSON and preserves rejection proof',async()=>{
 const originalFetch=globalThis.fetch,storage=new MemoryStorage(),scope='host.h.project.p.session.a';
 try{
  globalThis.fetch=(async(path:Parameters<typeof fetch>[0],init?:RequestInit)=>{
   expect(path).toBe('/api/commands');expect(init?.method).toBe('POST');
   expect(JSON.parse(String(init?.body))).toEqual({api:API,id:input.id,prompt:input.prompt,attachments:[],mode:input.mode,session:input.session,queue:true,fresh:false});
   return new Response(JSON.stringify(accepted),{headers:{'Content-Type':'application/json'}});
  }) as unknown as typeof fetch;
  expect((await admitCommand(storage,scope,input)).id).toBe(input.id);
  globalThis.fetch=(async()=>new Response(JSON.stringify({api:API,code:'command_not_accepted',id:input.id,session:input.session,message:'Queue full'}),{status:409,headers:{'Content-Type':'application/json'}})) as unknown as typeof fetch;
  const {HttpError,commandNotAccepted}=await import('./api');
  try{await admitCommand(storage,scope,input);throw Error('must reject');}catch(e){expect(e).toBeInstanceOf(HttpError);expect(commandNotAccepted(e,input.id,input.session)).toBe(true);}
  expect(pendingCommands(storage,scope,input.session)).toEqual([input]);
 }finally{globalThis.fetch=originalFetch;}
});
