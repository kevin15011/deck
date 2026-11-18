import {test,expect} from 'bun:test';
import {API,workspace,receipt,boundedAnswers,answersNotAccepted,HttpError,type Resolve} from './api';
// Protects runtime admission UI: untyped JSON cannot masquerade as a compatible
// workspace/receipt. Oracle: crates/shared + Sprint 1 scenario 9.
const r={fresh:false,session:'fixture-session',id:'fixture',prompt:'Explain a file',phase:'completed',text:'Public answer',detail:'Completed',native_pid:null,model:null,local_tool_calls:0,thread:null,turn:null,accepted_ms:1,handshake_ms:null,dispatch_ms:null,first_output_ms:null,revision:1,policy:'deck2-readonly-v1',runner:'codex',delivery:'Observed'};
const w={api:API,host_id:'fixture-host',sessions:[{id:'fixture-session',title:'Fixture',native:null}],queue_paused:true,steering_unavailable:'unqualified',session:'fixture-session',project:'/public/project',runner:'Codex',availability:null,receipts:[r],tasks:[],team_availability:null};
test('compatible public projection is accepted',()=>{expect(workspace(w).receipts[0].id).toBe('fixture');});
test('incompatible and malformed data block the projection',()=>{
 for(const value of [null,{}, {...w,api:1},{...w,availability:false},{...w,receipts:[r,r]}, {...w,receipts:[{...r,phase:'invented'}]}, {...w,receipts:[{...r,revision:-1}]}, {...w,receipts:[{...r,text:{html:'unsafe'}}]}])expect(()=>workspace(value)).toThrow();
 for(const value of [{...r,native_pid:'123'},{...r,accepted_ms:Infinity},{...r,thread:[]},{...r,delivery:null}])expect(()=>receipt(value)).toThrow();
});

test('malformed authority projections cannot enable decision controls',()=>{
 for(const change of [{mode:'unrestricted'},{decisions:{}},{decisions:[{}]}])expect(()=>receipt({...r,...change})).toThrow();
 expect(()=>workspace({...w,trusted:'true'})).toThrow();
});

// S2-Q01: proof must identify the exact rejected response; generic errors and
// accepted/conflicting command identities must never authorize replacement.
test('answer byte bounds and exact non-acceptance proof',()=>{
 const answer=(v:string)=>({type:'answers' as const,answers:{word:[v]}});
 expect(boundedAnswers(answer('界'.repeat(1365)+'a'))).toBe(true);
 expect(boundedAnswers(answer('界'.repeat(1365)+'ab'))).toBe(false);
 expect(boundedAnswers(answer(' '))).toBe(false);
 const body:Resolve={api:API,command_id:'response-command',expected_revision:1,response:answer('Copper')};
 const proof={api:API,code:'answers_not_accepted',decision_id:'decision-id',command_id:body.command_id,expected_revision:1};
 expect(answersNotAccepted(new HttpError(409,'',proof),'decision-id',body)).toBe(true);
 for(const change of [{api:1},{code:'decision_rejected'},{decision_id:'other'},{command_id:'other'},{expected_revision:2}]){
  expect(answersNotAccepted(new HttpError(409,'',{...proof,...change}),'decision-id',body)).toBe(false);
 }
 expect(answersNotAccepted(new HttpError(409,'generic'),'decision-id',body)).toBe(false);
 expect(answersNotAccepted(new HttpError(500,'',proof),'decision-id',body)).toBe(false);
});

// S3 command correction requires exact authoritative proof, never a generic 409.
import {commandNotAccepted} from './api';
test('command non-acceptance proof cannot clear another session or identity',()=>{
 const proof={api:API,code:'command_not_accepted',id:'queued-command',session:'session-a'};
 expect(commandNotAccepted(new HttpError(409,'',proof),'queued-command','session-a')).toBe(true);
 for(const change of [{api:1},{code:'command_rejected'},{id:'other'},{session:'session-b'}])expect(commandNotAccepted(new HttpError(409,'',{...proof,...change}),'queued-command','session-a')).toBe(false);
 expect(commandNotAccepted(new HttpError(409,'generic'),'queued-command','session-a')).toBe(false);
});

import {task} from './api';
// Protects exact report/attempt/treatment relationships across the untyped API.
// Oracle INV04; fails if a forged projection can be displayed as adopted evidence.
test('foreign reports and stale Lead treatments are rejected',()=>{
 const a={preparation_ms:10,tool_connection_ms:5,id:'attempt',prompt:'trace',source_report:null,phase:'completed',detail:'recorded',requested_model:'p/m',observed_model:'p/m',provenance:{runner:'opencode',integration:'v1',executable:'hash',storage:'owned',content:'hash'},native_session:'native',native_message:'message',generation:'generation',accepted_ms:1,dispatch_ms:2,acknowledgment_ms:3,first_output_ms:4,settled_ms:5,cancel_requested:false,report:{attempt:'attempt',digest:'a'.repeat(64),text:'evidence'},treatments:[{report:'a'.repeat(64),lead_attempt:'lead',disposition:'adopted',reason:'source inspected'}]};
 const t={id:'task',session:'fixture-session',root:'fixture',parent_attempt:'lead',owner:'investigator',scope:['src'],acceptance:'trace',revision:1,attempts:[a]};expect(task(t).owner).toBe('investigator');
 for(const bad of [{...t,attempts:[{...a,report:{...a.report,attempt:'foreign'}}]},{...t,attempts:[{...a,treatments:[{...a.treatments[0],lead_attempt:'foreign'}]}]},{...t,attempts:[a,a]},{...t,attempts:[{...a,provenance:{}}]}])expect(()=>task(bad)).toThrow();
 expect(()=>workspace({...w,tasks:[{...t,root:'foreign'}]})).toThrow();
});

// Protects untyped configuration/operation projections and exact-content identity.
// Oracle: S5a admissions are immutable references; historical absence is unknown.
test('configuration snapshots reject malformed identity and preserve historical unknowns',async()=>{
 const {snapshot,exactDefinition,operation}=await import('./configuration-api');
 expect(receipt(r).configuration).toBeNull();
 const body='bounded source bytes',digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(body)))).map(b=>b.toString(16).padStart(2,'0')).join('');
 const d={digest,body,name:'fixture',source:'recorded',owner:'Deck',kind:'managed_policy',roles:['lead'],modes:['team'],required_resources:[]};
 expect((await exactDefinition(d,digest)).body).toBe(body);
 expect(exactDefinition({...d,body:'different'},digest)).rejects.toThrow();
 const admitted={revision:1,codex_executable:null,definitions:[digest],investigator:null,exclusions:[],delivery_observed:false};
 expect(snapshot(admitted)?.revision).toBe(1);
 for(const change of [{revision:-1},{definitions:['path/to/file']},{delivery_observed:'loaded'},{investigator:{model:'anything'}}])expect(()=>snapshot({...admitted,...change})).toThrow();
 for(const invalid of [{id:'op',plan:'p',allow:true,phase:'running',revision:1},{id:'op',plan:'p',allow:'yes',phase:'applied',revision:1}])expect(()=>operation(invalid)).toThrow();
});

// Protects untyped image references: altered/malformed metadata cannot enter
// a persisted draft or masquerade as a server-owned image identity.
test('image metadata is bounded and receipt image identities survive projection',async()=>{
 const {imageAttachment}=await import('./api');
 const image={id:'11111111-1111-4111-8111-111111111111',digest:'a'.repeat(64),mime:'image/png',size:123,width:100,height:50};
 expect(receipt({...r,attachments:[image]}).attachments).toEqual([image]);
 for(const change of [{id:'../../private'},{digest:'bad'},{mime:'image/svg+xml'},{size:0},{size:5*1024*1024+1},{width:16385},{width:10000,height:10000}])expect(()=>imageAttachment({...image,...change})).toThrow();
 expect(()=>receipt({...r,attachments:'bytes'})).toThrow();
});

// PROJECT73-Q02: malformed per-project availability must fail closed at the
// untyped host boundary; null means available, never the startup fallback.
test('project availability preserves independent owner states and rejects malformed reasons',()=>{
 const mapped=workspace({...w,availability:'startup runner absent',project_availability:{a:'runner absent',b:null},project_team_availability:{a:null,b:'unprepared'}});
 expect(mapped.project_availability?.b).toBeNull();
 expect(mapped.project_availability?.a).toBe('runner absent');
 for(const value of [false,[],{b:false},{b:{ready:true}}])expect(()=>workspace({...w,project_availability:value})).toThrow();
});

// Protects host-wide settings from the selected project's automatic URL scope.
// Oracle: decision 11; project requests keep their target, host RTK never acquires it.
test('host settings requests do not inherit active project context',async()=>{
 const {request,setProjectContext}=await import('./api');
 const original=globalThis.fetch;const urls:string[]=[];
 globalThis.fetch=(async(input:RequestInfo|URL)=>{urls.push(String(input));return new Response('{}',{status:200});}) as typeof fetch;
 try{setProjectContext('another-project');await request('GET','/api/configuration',undefined,undefined,'host');await request('GET','/api/configuration');expect(urls).toEqual(['/api/configuration','/api/configuration?projectId=another-project']);}
 finally{globalThis.fetch=original;setProjectContext('');}
});
