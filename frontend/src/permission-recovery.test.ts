import {test,expect} from 'bun:test';
import {API,type Decision,load} from './api';
import {submitReviewResponse} from './review';
// Protects UI27-Q01 recovery via the real storage/HTTP/decoder path. Oracle:
// BACKEND-REJECTION-CONTRACT.md. No live host, grants, or browser is used.
const d={id:'scope-recovery',session:'s',command:'c',attempt:'a',generation:'g',thread:'t',turn:'t',item:'i',request:'r',revision:7,state:'pending',file:null,questions:[],resolution:null,dispatch_ms:null,delivered_ms:null,grant_consumed:false,detail:''} as Decision;
const proof=(body:unknown)=>({api:API,code:'permission_response_not_accepted',decision_id:d.id,submission:body,accepted_response:null,terminal:true});
async function fixture(run:(f:{sent:any[];effects:Set<string>;set:(mode:string)=>void;values:Map<string,string>})=>Promise<void>){
 const originalFetch=globalThis.fetch,descriptor=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
 const values=new Map<string,string>(),sent:any[]=[],effects=new Set<string>();let mode='reject';
 Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>values.set(k,v)}});
 globalThis.fetch=(async(_path:unknown,init?:RequestInit)=>{
  const b=JSON.parse(init?.body as string);
  const reconciliation=String(_path).endsWith('/responses/reconcile');
  if(reconciliation)expect(b.response.type).toBe('allow_session');else sent.push(b);
  if(mode==='lost')throw Error('connection lost');
  if((mode==='ok'||mode==='reconcile')&&!reconciliation){
   effects.add(b.command_id);const {scope_option_id,...resolution}=b;
   return new Response(JSON.stringify({...d,resolution}));
  }
  let p:any=proof(b);
  if(mode==='ok')p={message:'No terminal rejection proof'};
  if(mode==='generic')p={message:'Conflict'};
  if(mode==='foreign')p.decision_id='other';
  if(mode==='uuid')p.submission={...b,command_id:'other'};
  if(mode==='revision')p.submission={...b,expected_revision:6};
  if(mode==='scope')p.submission={...b,scope_option_id:'other'};
  if(mode==='response')p.submission={...b,response:{type:'deny'}};
  if(mode==='api')p.submission={...b,api:0};
  if(mode==='extra')p.submission={...b,unknown:true};
  if(mode==='accepted')p.accepted_response={command_id:'other'};
  if(mode==='nonterminal')p.terminal=false;
  if(mode==='malformed')p.submission=null;
  return new Response(JSON.stringify(p),{status:mode==='wrong-status'?400:409});
 }) as typeof fetch;
 try{await run({sent,effects,set:v=>{mode=v},values});}finally{globalThis.fetch=originalFetch;if(descriptor)Object.defineProperty(globalThis,'localStorage',descriptor);else Reflect.deleteProperty(globalThis,'localStorage');}
}
for(const response of [{type:'deny'},{type:'allow_once'},{type:'allow_session'}] as const){
 test(`authoritative stale-scope rejection survives reconnect and allows ${response.type}`,()=>fixture(async f=>{
  await expect(submitReviewResponse(d,{type:'allow_session'},'recovery','stale')).rejects.toThrow('HTTP 409');
  // A fresh invocation models reconnect: only persistent storage carries ownership.
  f.set('ok');await submitReviewResponse({...d},response,'recovery','corrected');
  expect(f.sent).toHaveLength(2);expect(f.sent[1].command_id).not.toBe(f.sent[0].command_id);
  expect(f.sent[1].response).toEqual(response);expect(f.effects.size).toBe(1);
  if(response.type==='allow_session')expect(f.sent[1].scope_option_id).toBe('corrected');
  else expect(f.sent[1]).not.toHaveProperty('scope_option_id');
  await submitReviewResponse({...d},response,'recovery','corrected');
  expect(f.sent[2]).toEqual(f.sent[1]);expect(f.effects.size).toBe(1);
 }));
}
test('uncertain delivery and invalid or foreign rejection proof retain immutable retry identity',async()=>{
 for(const mode of ['lost','generic','foreign','uuid','revision','scope','response','api','extra','accepted','nonterminal','malformed','wrong-status'])await fixture(async f=>{
  f.set(mode);await expect(submitReviewResponse(d,{type:'allow_session'},'recovery','stale')).rejects.toThrow();
  const first=JSON.stringify(f.sent[0]);expect(load('recovery.decision.'+d.id)).toBe(first);
  await expect(submitReviewResponse({...d},{type:'deny'},'recovery')).rejects.toThrow('identity is retained');
  expect(f.sent).toHaveLength(1);f.set('ok');await submitReviewResponse({...d},{type:'allow_session'},'recovery','stale');
  expect(JSON.stringify(f.sent[1])).toBe(first);expect(f.effects.size).toBe(1);
 });
});
test('lost rejection proof reconciles by replaying only the exact UUID before correction',()=>fixture(async f=>{
 f.set('lost');await expect(submitReviewResponse(d,{type:'allow_session'},'recovery','stale')).rejects.toThrow();
 f.set('reject');await expect(submitReviewResponse({...d},{type:'allow_session'},'recovery','stale')).rejects.toThrow('HTTP 409');
 expect(f.sent[1]).toEqual(f.sent[0]);f.set('ok');await submitReviewResponse({...d},{type:'deny'},'recovery');
 expect(f.effects.size).toBe(1);expect(f.sent[2].command_id).not.toBe(f.sent[0].command_id);
}));

test('reconnect reconciles a lost rejection without replaying an authorization',()=>fixture(async f=>{
 f.set('lost');await expect(submitReviewResponse(d,{type:'allow_session'},'recovery','stale')).rejects.toThrow();
 const original=JSON.stringify(f.sent[0]);f.set('reconcile');
 // Reconcile gets a terminal proof; the subsequent intended Deny succeeds.
 await submitReviewResponse({...d},{type:'deny'},'recovery');
 expect(load('recovery.decision.'+d.id)).not.toBe(original);expect(JSON.parse(load('recovery.decision.'+d.id)).response.type).toBe('deny');
 expect(f.sent).toHaveLength(2);expect(f.effects.size).toBe(1);
}));

test('late duplicate rejection cannot erase the corrected response identity',()=>fixture(async f=>{
 const real=globalThis.fetch;let release!:(r:Response)=>void;let captured:any;
 globalThis.fetch=(async(path:unknown,init?:RequestInit)=>{
  if(!captured){captured=JSON.parse(init?.body as string);return await new Promise<Response>(resolve=>{release=resolve;});}
  return real(path as string,init);
 }) as typeof fetch;
 const late=submitReviewResponse(d,{type:'allow_session'},'recovery','stale').catch(e=>e);
 await expect(submitReviewResponse(d,{type:'allow_session'},'recovery','stale')).rejects.toThrow('HTTP 409');
 f.set('ok');await submitReviewResponse(d,{type:'deny'},'recovery');
 const corrected=load('recovery.decision.'+d.id);
 release(new Response(JSON.stringify(proof(captured)),{status:409}));await late;
 expect(load('recovery.decision.'+d.id)).toBe(corrected);expect(f.effects.size).toBe(1);
}));
