import {receiptPresentation,decisionPresentation,type ReceiptPresentation,type DecisionPresentation} from './presentation';
import {readDraft,writeDraft} from './draft-storage';
import {snapshot,type Snapshot} from './configuration-api';
// Public, unprivileged projection of crates/shared. Validate every network value.
export const API = 7;
export const phases = ['queued','accepted','preparing','dispatching','running','cancelling','completed','cancelled','failed','uncertain'] as const;
export type Phase = typeof phases[number];
export interface Receipt {
 presentation?:ReceiptPresentation;
 context?:unknown;
 recalled_ms?:number;
 cancel_requested?:boolean;
 reasoning?:{model:string;effort:string;source:string};
 continuation?:{task:string;attempt:string;source_seq:number;origin:string};
 attachments:ImageAttachment[];
 configuration:Snapshot|null;
 attempt?:string; session:string; fresh:boolean;
 mode:Mode; decisions:Decision[]; id:string; prompt:string; phase:Phase; text:string; detail:string; native_pid:number|null;
 requested_model:string|null; model:string|null; local_tool_calls:number; thread:string|null; turn:string|null;
 accepted_ms:number; acknowledgment_ms:number|null; handshake_ms:number|null; dispatch_ms:number|null; first_output_ms:number|null;
 revision:number; policy:string; runner:string; delivery:string;
}
export interface MemberAssignment {runnerId:string;modelId:string;thinking?:string}
export interface SessionContract {version:number;revision:number;members:Record<string,MemberAssignment>;approvals:string;generation:number;leadTask:string}
export interface ProjectBinding {id:string;root:string;identity:string|null}
export interface Session {project?:ProjectBinding;original?:{fingerprint:string;task:string;attempt:number;thread:string;model:string};contract?:SessionContract;id:string;title:string;native:{thread:string;mode:Mode}|null}
export interface Workspace {process_active?:boolean;session_availability?:Record<string,string|null>;project_availability?:Record<string,string|null>;project_team_availability?:Record<string,string|null>;initial_project?:string;projects?:ProjectBinding[];project_trust?:Record<string,boolean>;host_id:string;sessions:Session[];queue_paused:boolean;steering_unavailable:string;trusted:boolean; api:number; session:string; project:string; runner:string; availability:string|null; receipts:Receipt[];tasks:Task[];team_availability:string|null}
const object=(v:unknown):v is Record<string,unknown>=>typeof v==='object' && v!==null && !Array.isArray(v);
const integer=(v:unknown)=>typeof v==='number' && Number.isSafeInteger(v) && v>=0;
export function receipt(v:unknown):Receipt {
 if(!object(v) || typeof v.fresh!=='boolean' || !['id','session','prompt','text','detail','policy','runner','delivery'].every(k=>typeof v[k]==='string') || !phases.includes(v.phase as Phase)
 || !['model','thread','turn'].every(k=>v[k]===null || typeof v[k]==='string')
 || !['native_pid','handshake_ms','dispatch_ms','first_output_ms'].every(k=>v[k]===null || integer(v[k]))
 || !['accepted_ms','revision','local_tool_calls'].every(k=>integer(v[k]))) throw new Error('Incompatible host receipt. Reload a compatible Deck client; draft retained.');
 if(v.cancel_requested!==undefined&&typeof v.cancel_requested!=='boolean')throw Error('Invalid cancellation state');
 if(v.recalled_ms!==undefined&&(!integer(v.recalled_ms)||v.dispatch_ms!==null||v.cancel_requested!==true))throw Error('Invalid recalled input timestamp');

 if(v.requested_model!==undefined&&v.requested_model!==null&&typeof v.requested_model!=='string')throw new Error('Invalid requested model policy');
 if(v.acknowledgment_ms!==undefined&&v.acknowledgment_ms!==null&&!integer(v.acknowledgment_ms))throw new Error('Invalid native acknowledgment time');
 if(v.continuation!==undefined&&(!object(v.continuation)||!['task','attempt','origin'].every(k=>typeof (v.continuation as Record<string,unknown>)[k]==='string')||!integer(v.continuation.source_seq)))throw Error('Invalid task outcome continuation');
 if(v.attempt!==undefined&&typeof v.attempt!=='string')throw Error('Invalid attempt identity');
 const mode=v.mode??'read_only';
 if(!['read_only','reviewed_edit','team','developer','ordinary_read_only_v1','ordinary_reviewed_v1','session_v1'].includes(mode as string)||!(v.decisions===undefined||Array.isArray(v.decisions)))throw new Error('Incompatible edit projection');
 const admitted=snapshot(v.configuration);
 if((mode==='session_v1')!==!!admitted?.session_contract)throw Error('Session contract differs from receipt authority');
 if(Array.isArray(v.decisions)&&v.decisions.some(d=>object(d)&&d.native!==undefined&&mode!=='session_v1'))throw Error('Legacy receipt cannot expose connected native permissions');
 if(Array.isArray(v.decisions)&&v.decisions.some(d=>!object(d)||d.session!==v.session||d.command!==v.id))throw new Error('Decision conversation ownership mismatch');
 if(v.attachments!==undefined&&(!Array.isArray(v.attachments)||v.attachments.length>8))throw new Error('Invalid image projection');
 return {...v,presentation:receiptPresentation(v.presentation,v.model),attachments:(v.attachments as unknown[]|undefined)?.map(imageAttachment)??[],requested_model:v.requested_model??null,configuration:snapshot(v.configuration),acknowledgment_ms:v.acknowledgment_ms??null,mode,decisions:(v.decisions as unknown[]|undefined)?.map(decision)??[]} as unknown as Receipt;
}
export function workspace(v:unknown):Workspace {
 if(!object(v) || v.api!==API || !['session','project','runner'].every(k=>typeof v[k]==='string') || !(v.availability===null || typeof v.availability==='string') || !Array.isArray(v.receipts)) throw new Error('Incompatible API or host response. Reload a compatible Deck client; draft retained.');
 if(v.process_active!==undefined&&typeof v.process_active!=='boolean')throw Error('Invalid process ownership projection');
 for(const key of ['project_availability','project_team_availability','session_availability'])if(v[key]!==undefined&&(!object(v[key])||Object.values(v[key]).some(reason=>reason!==null&&typeof reason!=='string')))throw Error('Invalid project availability');
 if(typeof v.host_id!=='string'||typeof v.queue_paused!=='boolean'||typeof v.steering_unavailable!=='string'||!Array.isArray(v.sessions)||v.sessions.some(s=>!object(s)||typeof s.id!=='string'||typeof s.title!=='string'||!(s.native===null||(object(s.native)&&typeof s.native.thread==='string'&&['read_only','reviewed_edit','team','developer','ordinary_read_only_v1','ordinary_reviewed_v1','session_v1'].includes(s.native.mode as string)))))throw new Error('Incompatible conversation projection');
 if(v.trusted!==undefined&&typeof v.trusted!=='boolean')throw new Error('Incompatible project trust');
 if(!Array.isArray(v.tasks)||!(v.team_availability===null||typeof v.team_availability==='string'))throw new Error('Incompatible team projection');
 const receipts=v.receipts.map(receipt);
 const roots=new Map(receipts.map(r=>[r.id,r.session]));
 const parentAttempts=new Map<string,Set<string>>();
 for(const r of receipts){
  if(r.mode!=='session_v1'||!r.attempt)continue;
  const attempts=parentAttempts.get(r.session)??new Set<string>();
  attempts.add(r.attempt);
  parentAttempts.set(r.session,attempts);
 }
 const noAttempts=new Set<string>();
 const tasks=v.tasks.map(t=>task(t,object(t)&&typeof t.session==='string'?(parentAttempts.get(t.session)??noAttempts):noAttempts));
 if(tasks.some(t=>roots.get(t.root)!==t.session)||new Set(tasks.map(t=>t.id)).size!==tasks.length)throw new Error('Task root ownership mismatch');
 if(receipts.some(r=>!(v.sessions as Session[]).some(s=>s.id===r.session))||new Set((v.sessions as Session[]).map(s=>s.id)).size!==v.sessions.length)throw new Error('Conversation ownership mismatch');
 if(receipts.some(r=>{const owner=(v.sessions as Session[]).find(s=>s.id===r.session)?.project;const admitted=r.configuration?.project;return owner&&admitted&&(owner.id!==admitted.id||owner.root!==admitted.root||owner.identity!==admitted.identity);}))throw Error('Admission project differs from conversation');
 if(new Set(receipts.map(r=>r.id)).size!==receipts.length) throw new Error('Host returned duplicate receipt identities; dispatch blocked.');
 for(const s of v.sessions)if(object(s)){sessionContract(s.contract);if(s.project!==undefined&&(!object(s.project)||typeof s.project.id!=='string'||typeof s.project.root!=='string'||!(s.project.identity===null||typeof s.project.identity==='string')))throw Error('Invalid session project');}
 if(v.projects!==undefined&&(!Array.isArray(v.projects)||v.projects.some(p=>!object(p)||typeof p.id!=='string'||typeof p.root!=='string')))throw Error('Invalid project catalog');
 return {...v,trusted:v.trusted??false,receipts,tasks} as unknown as Workspace;
}
export class HttpError extends Error {constructor(public status:number,message:string,public problem:unknown=undefined){super(message)}}
let projectContext='';
export function setProjectContext(id:string){projectContext=id;}
export async function request(method:string,path:string,body?:unknown,signal?:AbortSignal,scope:'project'|'host'='project',observeResponse?:(response:Response)=>void):Promise<unknown>{
 if(scope==='project'&&projectContext&&!path.includes('projectId=')&&/^\/api\/(configuration|models|runners|cbm|helpers)(?:[/?]|$)/.test(path))path+=(path.includes('?')?'&':'?')+'projectId='+encodeURIComponent(projectContext);
 let response:Response;
 try {response=await fetch(path,{method,signal,headers:body===undefined?undefined:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});}
 catch(e){if(signal?.aborted)throw e;throw new Error('Connection lost. Host may still be running. Reconnect to inspect the existing command; it will not be submitted automatically.');}
 observeResponse?.(response);
 const text=await response.text();
 if(!response.ok){let detail=`Host returned HTTP ${response.status}. Reopen Deck; draft retained.`;
 try {const p:unknown=JSON.parse(text);if(object(p)&&typeof p.message==='string') detail=p.message+(typeof p.correlation==='string'?` · Reference ${p.correlation}`:'');}catch{}
 let problem:unknown;try{problem=JSON.parse(text);}catch{}
 throw new HttpError(response.status,`HTTP ${response.status}: ${detail}`,problem);}
 try{return JSON.parse(text);}catch{throw new Error('Incompatible host response; draft retained.');}
}
// Host-wide settings must not inherit the currently selected conversation's project.
export const hostRequest=(method:string,path:string,body?:unknown,signal?:AbortSignal)=>request(method,path,body,signal,'host');
export const active=(r:Receipt)=>['accepted','preparing','dispatching','running','cancelling'].includes(r.phase);
export const phase=(r:Receipt)=>r.phase==='dispatching'?'Dispatch uncertain':r.phase[0].toUpperCase()+r.phase.slice(1);
export const load=(key:string)=>{try{return key.endsWith('.draft')?readDraft(localStorage,'deck2.'+key):localStorage.getItem('deck2.'+key)||'';}catch{return '';}};
export const save=(key:string,value:string)=>{try{if(key.endsWith('.draft'))writeDraft(localStorage,'deck2.'+key,value);else localStorage.setItem('deck2.'+key,value);}catch{throw new Error('Browser storage unavailable. Enable local storage before sending so unresolved command identities can be retained.');}};

export type Mode='read_only'|'reviewed_edit'|'team'|'developer'|'ordinary_read_only_v1'|'ordinary_reviewed_v1'|'session_v1';
export type DecisionResponse={type:'allow_once'|'allow_session'|'allow_always'|'deny'}|{type:'answers';answers:Record<string,string[]>};
export interface Resolve {scope_option_id?:string;api:number;command_id:string;expected_revision:number;response:DecisionResponse}
export interface Question {multiple?:boolean;id:string;header:string;question:string;options:{label:string;description:string}[]}
export interface Decision {presentation?:DecisionPresentation;notificationSeq?:number;task?:string;native?:{method:string;parameters:string;summary:string;identity:string|null;always_note:string|null};id:string;session:string;command:string;attempt:string;generation:string;thread:string;turn:string;item:string;request:string;revision:number;state:'pending'|'responded'|'dispatching'|'delivered'|'settled'|'invalidated'|'uncertain';file:{path:string;diff:string;before:string;after:string|null;native_status:string|null;snapshot_error?:string|null}|null;questions:Question[];resolution:Resolve|null;dispatch_ms:number|null;delivered_ms:number|null;grant_consumed:boolean;detail:string}
export function decision(v:unknown):Decision {
 if(!object(v)||!['id','session','command','attempt','generation','thread','turn','item','request','detail'].every(k=>typeof v[k]==='string')||!integer(v.revision)||!['pending','responded','dispatching','delivered','settled','invalidated','uncertain'].includes(v.state as string)||typeof v.grant_consumed!=='boolean'||!['dispatch_ms','delivered_ms'].every(k=>v[k]===null||integer(v[k]))||!Array.isArray(v.questions))throw new Error('Incompatible decision; response blocked');
 if(v.notificationSeq!==undefined&&!integer(v.notificationSeq))throw Error('Invalid attention sequence');
 if(v.task!==undefined&&typeof v.task!=='string')throw Error('Invalid member decision owner');
 if(v.native!==undefined&&(!object(v.native)||!['method','parameters','summary'].every(k=>typeof (v.native as Record<string,unknown>)[k]==='string')||!['identity','always_note'].every(k=>(v.native as Record<string,unknown>)[k]===null||typeof (v.native as Record<string,unknown>)[k]==='string')))throw Error('Incomplete native approval; response blocked');
 if(v.file!==null&&(!object(v.file)||!['path','diff','before'].every(k=>typeof (v.file as Record<string,unknown>)[k]==='string')||!['after','native_status'].every(k=>(v.file as Record<string,unknown>)[k]===null||typeof (v.file as Record<string,unknown>)[k]==='string')))throw new Error('Incomplete file effect; response blocked');
 if(object(v.file)&&v.file.snapshot_error!==undefined&&v.file.snapshot_error!==null&&typeof v.file.snapshot_error!=='string')throw new Error('Invalid snapshot availability');
 for(const q of v.questions){if(!object(q)||!['id','header','question'].every(k=>typeof q[k]==='string')||!Array.isArray(q.options)||q.options.some(o=>!object(o)||typeof o.label!=='string'||typeof o.description!=='string'))throw new Error('Incomplete question; response blocked');}
 if(v.resolution!==null&&(!object(v.resolution)||![1,2,6,API].includes(v.resolution.api as number)||typeof v.resolution.command_id!=='string'||!integer(v.resolution.expected_revision)||!object(v.resolution.response)||!['allow_once','allow_session','allow_always','deny','answers'].includes(v.resolution.response.type as string)))throw new Error('Invalid decision response receipt');
 return {...v,presentation:decisionPresentation(v.presentation)} as unknown as Decision;
}

// A generic HTTP failure cannot prove that a response was never accepted.
export function answersNotAccepted(e:unknown,id:string,body:Resolve):boolean {
 if(!(e instanceof HttpError)||e.status!==409||!object(e.problem))return false;
 const p=e.problem;
 return p.api===API&&p.code==='answers_not_accepted'&&p.decision_id===id&&p.command_id===body.command_id&&p.expected_revision===body.expected_revision;
}
// This proof is emitted only after the host durably retires the exact UUID.
// Ordinary conflicts, Pending projections and connection failures prove nothing.
export function permissionResponseNotAccepted(e:unknown,id:string,body:Resolve):boolean {
 if(body.response.type!=='allow_session'||typeof body.scope_option_id!=='string'||!body.scope_option_id)return false;
 if(!(e instanceof HttpError)||e.status!==409||!object(e.problem))return false;
 const p=e.problem;
 if(p.api!==API||p.code!=='permission_response_not_accepted'||p.decision_id!==id||p.terminal!==true||p.accepted_response!==null)return false;
 // Full structural equality binds every payload field, including opaque scope.
 // Comparing object keys also rejects added fields and preserves absent vs null.
 function equal(a:unknown,b:unknown):boolean {
  if(a===b)return true;
  if(Array.isArray(a)||Array.isArray(b))return Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((v,i)=>equal(v,b[i]));
  if(!object(a)||!object(b))return false;
  const keys=Object.keys(a);return keys.length===Object.keys(b).length&&keys.every(k=>Object.hasOwn(b,k)&&equal(a[k],b[k]));
 }
 return equal(p.submission,body);
}
export function boundedAnswers(response:DecisionResponse):boolean {
 return response.type!=='answers'||Object.values(response.answers).every(a=>a.length>0&&a.length<=12&&a.every(s=>s.trim().length>0&&new TextEncoder().encode(s).length<=4096));
}

export function commandNotAccepted(e:unknown,id:string,session:string):boolean {
 return e instanceof HttpError&&e.status===409&&object(e.problem)&&e.problem.api===API&&e.problem.code==='command_not_accepted'&&e.problem.id===id&&e.problem.session===session;
}

export interface Provenance {runner:string;integration:string;executable:string;storage:string;content:string}
export interface FailureDismissal {command_id:string;at_ms:number;revision:number}
export interface TaskAttempt {failure_dismissal?:FailureDismissal;number?:number;context?:unknown;preparation_ms:number|null;tool_connection_ms:number|null;id:string;prompt:string;source_report:string|null;phase:Phase;detail:string;requested_model:string;observed_model:string|null;provenance:Provenance;native_session:string|null;native_message:string|null;generation:string;accepted_ms:number;dispatch_ms:number|null;acknowledgment_ms:number|null;first_output_ms:number|null;settled_ms:number|null;cancel_requested:boolean;report:{attempt:string;digest:string;text:string}|null;treatments:{report:string;lead_attempt:string;disposition:string;reason:string}[]}
export interface Task {original?:{display_id:string;task_id:string;fingerprint:string;maximum:number};id:string;session:string;root:string;parent_attempt:string;owner:string;scope:string[];acceptance:string;revision:number;attempts:TaskAttempt[]}
export function task(v:unknown,leadAttempts?:Set<string>):Task {
 if(!object(v)||!['id','session','root','parent_attempt','owner','acceptance'].every(k=>typeof v[k]==='string')||!integer(v.revision)||!Array.isArray(v.scope)||!v.scope.every(s=>typeof s==='string')||!Array.isArray(v.attempts))throw new Error('Invalid task projection');
 if(v.original!==undefined&&(!object(v.original)||typeof v.original.task_id!=='string'||typeof v.original.display_id!=='string'||typeof v.original.fingerprint!=='string'||!/^[a-f0-9]{64}$/.test(v.original.fingerprint)||!integer(v.original.maximum)||(v.original.maximum as number)<1))throw new Error('Invalid original task binding');
 for(const a of v.attempts){
  if(!object(a)||!['id','prompt','detail','requested_model','generation'].every(k=>typeof a[k]==='string')||!phases.includes(a.phase as Phase)||!['source_report','observed_model','native_session','native_message'].every(k=>a[k]===null||typeof a[k]==='string')||!integer(a.accepted_ms)||!['preparation_ms','tool_connection_ms','dispatch_ms','acknowledgment_ms','first_output_ms','settled_ms'].every(k=>a[k]===null||integer(a[k]))||typeof a.cancel_requested!=='boolean'||!object(a.provenance)||!['runner','integration','executable','storage','content'].every(k=>typeof (a.provenance as Record<string,unknown>)[k]==='string')||!Array.isArray(a.treatments))throw new Error('Invalid task attempt');
  if(a.failure_dismissal!==undefined&&(!object(a.failure_dismissal)||typeof a.failure_dismissal.command_id!=='string'||(!integer(a.failure_dismissal.at_ms)||Number(a.failure_dismissal.at_ms)>8640000000000000)||!integer(a.failure_dismissal.revision)||Number(a.failure_dismissal.revision)>Number(v.revision)||a.phase!=='failed'))throw Error('Invalid failure dismissal');
  if(a.number!==undefined&&(!integer(a.number)||(a.number as number)<0))throw new Error('Invalid logical attempt number');
  if(a.report!==null&&(!object(a.report)||a.report.attempt!==a.id||typeof a.report.text!=='string'||typeof a.report.digest!=='string'||!/^[a-f0-9]{64}$/.test(a.report.digest)))throw new Error('Report attempt mismatch');
  for(const t of a.treatments){if(!object(t)||!object(a.report)||t.report!==a.report.digest||(t.lead_attempt!==v.parent_attempt&&!(object(a.configuration)&&sessionContract(a.configuration.session_contract)&&typeof t.lead_attempt==='string'&&leadAttempts?.has(t.lead_attempt)))||typeof t.reason!=='string'||!['adopted','rejected','followup_required'].includes(t.disposition as string))throw new Error('Treatment provenance mismatch');}
 }
 if(new Set(v.attempts.map(a=>(a as TaskAttempt).id)).size!==v.attempts.length)throw new Error('Duplicate attempt identity');
 return v as unknown as Task;
}

export interface ImageAttachment {id:string;digest:string;mime:string;size:number;width:number;height:number}
export function imageAttachment(v:unknown):ImageAttachment {
 if(!object(v)||typeof v.id!=='string'||!/^[a-f0-9-]{36}$/.test(v.id)||typeof v.digest!=='string'||!/^[a-f0-9]{64}$/.test(v.digest)||!['image/png','image/jpeg','image/webp'].includes(v.mime as string)||!['size','width','height'].every(k=>integer(v[k])&&(v[k] as number)>0)||(v.size as number)>5*1024*1024||(v.width as number)>16384||(v.height as number)>16384||(v.width as number)*(v.height as number)>40_000_000)throw new Error('Invalid image identity or metadata');
 return v as unknown as ImageAttachment;
}

export function sessionContract(v:unknown):SessionContract|undefined {
 if(v===undefined||v===null)return undefined;
 if(!object(v)||v.version!==1||!integer(v.revision)||(v.revision as number)<1||!integer(v.generation)||(v.generation as number)<1||!['relay','yolo'].includes(v.approvals as string)||typeof v.leadTask!=='string'||!v.leadTask||!object(v.members)||!object(v.members.lead))throw Error('Invalid session authority');
 for(const [id,a] of Object.entries(v.members)){if(!['lead','investigate','architect','apply-fast','apply-deep','quality','setup'].includes(id)||!object(a)||typeof a.runnerId!=='string'||!a.runnerId||a.runnerId.length>64||typeof a.modelId!=='string'||!a.modelId||(a.thinking!==undefined&&typeof a.thinking!=='string'))throw Error('Invalid member assignment');}
 return v as unknown as SessionContract;
}
