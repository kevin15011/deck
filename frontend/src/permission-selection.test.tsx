import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {test,expect} from 'bun:test';
import {decisionPresentation} from './presentation';
import {Review} from './review';
import type {Decision} from './api';
// Protects explicit offered authority and fail-closed consent. Oracle: runtime129
// contract. Fails if unknown/malformed options become consent or suppress deny/once.
export const exact={id:'opaque-exact',kind:'exact',category:'files',label:'This request',description:'Exact material request.',actor:'lead',lifetime:'canonical_session',survives_host_restart:true,revocation:'deck_session'};
export const broader={...exact,id:'opaque-files',kind:'file_set',label:'These files',description:'Operations: update. Files: /project/src/a.ts, /project/src/b.ts. Patch contents may vary.'};
export const policy={version:1,options:[exact,broader],selected_option_id:null,provenance:null,unsupported:[]};
const projection=(p:unknown)=>({version:1,kind:'tool',validated:true,details:{operation:'update',paths:['/project/src/a.ts']},responses:['deny','allow_once','allow_session'],permission_policy:p});
const render=(p:unknown)=>renderToStaticMarkup(<Review d={{id:'decision',revision:7,state:'pending',questions:[],detail:'',presentation:decisionPresentation(projection(p))} as unknown as Decision} connected onError={()=>{}}/>);
test('host offers survive decoding and remain explicit with exact initial selection',()=>{
 expect((decisionPresentation(projection(policy)) as any)?.permission_policy).toEqual(policy);
 const {selected_option_id,...withoutSelection}=policy;
 expect(permissionPolicy(withoutSelection)?.selected_option_id).toBeNull();
 const html=render(policy);expect(html).toContain('opaque-files');
 expect(html).not.toMatch(/value="opaque-files" selected/);
 expect(html).toContain('value="opaque-exact" selected');
});
test('malformed and unsupported policy disables only session consent',()=>{
 for(const p of [null,{}, {...policy,version:2},{...policy,options:[]},{...policy,options:[broader]},
  {...policy,options:[exact,{...broader,kind:'unknown'}]}, {...policy,options:[exact,{...broader,category:'command'}]},
  {...policy,options:[exact,{...broader,description:'Bearer fixture'}]}, {...policy,selected_option_id:'unoffered'},{...policy,unknown_authority:true},{...policy,options:[exact,{...broader,unknown_bound:true}]},
  {...policy,options:[exact,{...broader,id:exact.id}]}, ...['actor','lifetime','description','revocation','survives_host_restart'].map(k=>({...policy,options:[exact,{...broader,[k]:null}]}))]){
  const html=render(p);expect(html).not.toContain('>Allow for this session<');expect(html).toContain('Allow once');expect(html).toContain('Deny');
 }
});

import {PermissionScopeChoice} from './review';
import {scopeBinding,selectedScope,consentRequest,retainConsent} from './permission-selection';
import {permissionPolicy} from './presentation';
// Protects complete selected bounds before the approval action, not a markup
// snapshot. Oracle: each of the four qualified runtime129 scope categories.
test('all selected scope kinds disclose the complete host bounds and lifetime',()=>{
 const choices=[broader,{...broader,id:'folder',kind:'folder',description:'Operations: update under /project/src recursively. No delete.'},
 {...broader,id:'caps',kind:'capability_subset',category:'permissions',description:'Network access: true. Read paths: /project/docs. Write paths: /project/out.'},
 {...broader,id:'argv',kind:'argv_prefix',category:'command',description:'cargo test in /project. Runs project test code. Environment and network stay exact.'}];
 for(const option of choices){
  const p=permissionPolicy({...policy,options:[{...exact,category:option.category},option]})!;expect(p).toBeDefined();
  const key=scopeBinding('d',7,p),selected=selectedScope(p,key,{binding:key,id:option.id})!;expect(selected.id).toBe(option.id);
  const html=renderToStaticMarkup(<><PermissionScopeChoice policy={p} scope={selected} disabled={false} onChange={()=>{}}/><button>Consent</button></>);
  const primary=html.slice(0,html.indexOf('<button>Consent')).replace(/<[^>]+>/g,' ');
  expect(primary).toContain(option.description);expect(primary).toContain('lead');
  for(const meaning of [/this session/,/restarting the app/,/ends when revoked/,/team or session permissions change/,/revoke from session permissions/i,/other roles.*separate permission/i])expect(primary).toMatch(meaning);
 }
});
test('selection never follows a changed offer, request or revision and unknown selection fails closed',()=>{
 const p=permissionPolicy(policy)!,key=scopeBinding('d',7,p),selection={binding:key,id:broader.id};
 expect(selectedScope(p,key,selection)?.kind).toBe('file_set');
 for(const bound of [scopeBinding('other',7,p),scopeBinding('d',8,p),scopeBinding('d',7,{...p,options:[p.options[0]]})])expect(selectedScope(p,bound,selection)?.kind).toBe('exact');
 expect(selectedScope(p,key,{binding:key,id:'unoffered'})).toBeUndefined();
 expect(selectedScope(null,key,selection)).toBeUndefined();
 // A host record of a previously selected broad option is never a new default.
 const historical={...p,selected_option_id:broader.id};expect(selectedScope(historical,scopeBinding('d',7,historical),null)?.kind).toBe('exact');
});
test('opaque selection and UUID remain immutable through retries and uncertain errors',()=>{
 const response={type:'allow_session' as const};
 const first=consentRequest(7,'original-uuid',7,response,broader.id);
 expect(Object.keys(first).sort()).toEqual(['api','command_id','expected_revision','response','scope_option_id']);
 const retry=retainConsent(first,consentRequest(7,'new-unused-uuid',7,response,broader.id));expect(retry).toBe(first);expect(retry.command_id).toBe('original-uuid');
 for(const proposed of [consentRequest(7,'other',7,response,exact.id),consentRequest(7,'other',8,response,broader.id),consentRequest(7,'other',7,{type:'allow_once'})])expect(()=>retainConsent(first,proposed)).toThrow('identity is retained');
 expect(first.scope_option_id).toBe(broader.id);expect(first.command_id).toBe('original-uuid');
 for(const type of ['allow_once','deny','allow_always'] as const)expect(consentRequest(7,'u',7,{type},broader.id)).not.toHaveProperty('scope_option_id');
});
test('automatic AllowOnce is inspected as reused authority, not fresh user consent',()=>{
 for(const provenance of [{kind:'reused_grant',source_decision:'original-decision'},{kind:'intrinsic'}]){
  const d={id:'d',revision:8,state:'settled',questions:[],detail:'',file:null,resolution:{response:{type:'allow_once'}},presentation:decisionPresentation({...projection({...policy,provenance}),resolution_provenance:provenance})} as unknown as Decision;
  const html=renderToStaticMarkup(<Review d={d} connected onError={()=>{}}/>);
  expect(html).not.toContain('<strong>Allowed once</strong>');expect(html).not.toContain('User response recorded.');
  if(provenance.kind==='reused_grant'){expect(html).toContain('original-decision');expect(html).toContain('No new user consent.');}
  const chat=renderToStaticMarkup(<Review d={d} connected conversation onError={()=>{}}/>);expect(chat).toContain('hidden=""');
 }
});

import {submitReviewResponse} from './review';
import {API} from './api';
// Protects the default production submission composition (storage + HTTP + decode),
// not only helpers: uncertain failure never changes UUID/scope or invents success.
test('production response path sends opaque IDs, retains errors and retries exactly',async()=>{
 const originalFetch=globalThis.fetch,storageDescriptor=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
 const values=new Map<string,string>();
 Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>values.set(k,v)}});
 const d={id:'decision/path',session:'s',command:'c',attempt:'a',generation:'g',thread:'t',turn:'turn',item:'i',request:'r',revision:7,state:'pending',file:null,questions:[],resolution:null,dispatch_ms:null,delivered_ms:null,grant_consumed:false,detail:'',presentation:decisionPresentation(projection(policy))} as Decision;
 const sent:Record<string,unknown>[]=[];let mode='lost';
 try{
  globalThis.fetch=(async(path:unknown,init?:RequestInit)=>{
   if(String(path).endsWith('/responses/reconcile'))return new Response(JSON.stringify({message:'No authoritative rejection'}),{status:409});
   expect(['/api/decisions/decision%2Fpath/responses','/api/decisions/once/responses']).toContain(String(path));
   const body=JSON.parse(init?.body as string);sent.push(body);
   if(mode==='lost')throw Error('synthetic transport loss');
   if(mode==='stale')return new Response(JSON.stringify({message:'Stale scope option'}),{status:409});
   // Host Resolve intentionally does not echo scope_option_id; selection is policy metadata.
   const {scope_option_id,...resolution}=body;
   return new Response(JSON.stringify({...d,id:path==='/api/decisions/once/responses'?'once':d.id,resolution,presentation:projection({...policy,selected_option_id:scope_option_id})}));
  }) as typeof fetch;
  await expect(submitReviewResponse(d,{type:'allow_session'},'fixture',broader.id)).rejects.toThrow('Connection lost');
  expect(sent.length).toBe(1);expect(sent[0].scope_option_id).toBe(broader.id);
  expect(Object.keys(sent[0]).sort()).toEqual(['api','command_id','expected_revision','response','scope_option_id']);expect(sent[0].api).toBe(API);
  const first=JSON.stringify(sent[0]);
  // A changed selection while outcome is unknown is blocked before another effect.
  await expect(submitReviewResponse(d,{type:'allow_session'},'fixture',exact.id)).rejects.toThrow('identity is retained');expect(sent.length).toBe(1);
  mode='stale';await expect(submitReviewResponse(d,{type:'allow_session'},'fixture',broader.id)).rejects.toThrow('HTTP 409');
  mode='ok';await submitReviewResponse(d,{type:'allow_session'},'fixture',broader.id);
  expect(sent.map(v=>JSON.stringify(v))).toEqual([first,first,first]);
  expect([...values.values()]).toContain(first);
  await submitReviewResponse({...d,id:'once'}, {type:'allow_once'},'fixture',broader.id);
  expect(sent.at(-1)).not.toHaveProperty('scope_option_id');
 }finally{
  globalThis.fetch=originalFetch;
  if(storageDescriptor)Object.defineProperty(globalThis,'localStorage',storageDescriptor);else Reflect.deleteProperty(globalThis,'localStorage');
 }
});
