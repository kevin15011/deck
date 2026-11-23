import {redactText} from './redaction';
// Validated display capabilities only. Exact current-attempt response APIs retain authority.
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const integer=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
const text=(v:unknown)=>typeof v==='string'&&v.length>0&&v.length<=256&&!/[\x00-\x1f\x7f]/.test(v);
export interface ReceiptPresentation {version:1;recorded_runner:string|null;integration_available:boolean;retained_runtime_supported:boolean;reasoning:{model:string;effort:string;validated:true;basis:'native_acknowledgement'}|null}
export function receiptPresentation(v:unknown,model:unknown):ReceiptPresentation|undefined {
 if(v===undefined)return undefined;
 if(!object(v)||v.version!==1||!(v.recorded_runner===null||text(v.recorded_runner))||typeof v.integration_available!=='boolean'||typeof v.retained_runtime_supported!=='boolean')throw Error('Invalid execution presentation');
 if(v.reasoning!==null&&(!object(v.reasoning)||!text(v.reasoning.model)||v.reasoning.model!==model||!text(v.reasoning.effort)||v.reasoning.validated!==true||v.reasoning.basis!=='native_acknowledgement'||!v.integration_available))throw Error('Invalid acknowledged reasoning presentation');
 return v as unknown as ReceiptPresentation;
}
export interface PersistentGrant {kind:'command_prefix';validated:true;prefix:string[];persistence:'across_sessions';revocation:'outside_deck'}
// Unknown or incomplete metadata withholds only persistent consent. Never infer
// scope from displayed command/details or native wire parameters.
export function persistentGrant(v:unknown):PersistentGrant|undefined {
 if(!object(v)||v.kind!=='command_prefix'||v.validated!==true||v.persistence!=='across_sessions'||v.revocation!=='outside_deck'||!Array.isArray(v.prefix)||v.prefix.length===0||v.prefix.length>128||v.prefix.some(p=>typeof p!=='string'||p.length===0||/[\x00-\x1f\x7f]/.test(p)))return undefined;
 const prefix=JSON.stringify(v.prefix);
 // A redacted/truncated prefix cannot support exact informed consent.
 if(prefix.length>8192||redactText(prefix,65536)!==prefix)return undefined;
 return v as unknown as PersistentGrant;
}
export interface SessionGrant {kind:'delegation_role';role:string;assignment_revision:number;lifetime:'session_generation';survives_host_restart:true;revocation:'deck_session';description:string}
// Absence means the legacy exact-action contract. Present but invalid metadata
// remains null so decoding cannot silently widen a legacy consent control.
export function sessionGrant(v:unknown):SessionGrant|undefined {
 if(!object(v)||v.kind!=='delegation_role'||typeof v.role!=='string'||!/^[-a-z0-9]{1,64}$/.test(v.role)||v.role==='lead'||!integer(v.assignment_revision)||v.assignment_revision===0||v.lifetime!=='session_generation'||v.survives_host_restart!==true||v.revocation!=='deck_session'||typeof v.description!=='string'||!v.description.trim()||v.description.length>4096||/[\x00-\x1f\x7f-\x9f]/.test(v.description))return undefined;
 if(redactText(v.role,65536)!==v.role||redactText(v.description,65536)!==v.description)return undefined;
 return v as unknown as SessionGrant;
}
export type PermissionProvenance={kind:'user'}|{kind:'intrinsic'}|{kind:'reused_grant';source_decision:string};
export function permissionProvenance(v:unknown):PermissionProvenance|undefined {
 if(!object(v))return undefined;
 if(v.kind==='user'||v.kind==='intrinsic')return {kind:v.kind};
 if(v.kind==='reused_grant'&&text(v.source_decision))return {kind:'reused_grant',source_decision:v.source_decision as string};
 return undefined;
}
export interface PermissionOption {id:string;kind:'exact'|'file_set'|'folder'|'capability_subset'|'argv_prefix'|'workspace_grep'|'workspace_read'|'bash_command'|'bash_prefix';category:string;label:string;description:string;actor:string;lifetime:'canonical_session';survives_host_restart:true;revocation:'deck_session'}
export interface PermissionPolicy {version:1;options:PermissionOption[];selected_option_id:string|null;provenance:PermissionProvenance|null;unsupported:string[]}
const scopeText=(v:unknown,max=4096):v is string=>typeof v==='string'&&v.trim().length>0&&v.length<=max&&!/[\x00-\x1f\x7f-\x9f]/.test(v)&&redactText(v,65536)===v;
// Validate the complete host disclosure; never shorten or derive bounds locally.
export function permissionPolicy(v:unknown):PermissionPolicy|undefined {
 if(!object(v)||Object.keys(v).some(k=>!['version','options','selected_option_id','provenance','unsupported'].includes(k))||v.version!==1||!Array.isArray(v.options)||v.options.length<1||v.options.length>16||!Array.isArray(v.unsupported)||v.unsupported.length>16||v.unsupported.some(x=>!scopeText(x))||!(v.provenance===null||permissionProvenance(v.provenance)))return undefined;
 const ids=new Set<string>();let actor:unknown;
 for(const o of v.options){
  if(!object(o)||Object.keys(o).some(k=>!['id','kind','category','label','description','actor','lifetime','survives_host_restart','revocation'].includes(k))||!scopeText(o.id,512)||ids.has(o.id)||!scopeText(o.label,256)||!scopeText(o.description)||!scopeText(o.actor,64)||!/^[-a-z0-9]+$/.test(o.actor)||o.lifetime!=='canonical_session'||o.survives_host_restart!==true||o.revocation!=='deck_session')return undefined;
  const categories:Record<string,string[]>= {exact:['command','files','permissions','mcp','relay','claude_workspace_read','historical_delegation_role'],file_set:['files'],folder:['files'],capability_subset:['permissions'],argv_prefix:['command'],workspace_grep:['claude_workspace_read'],workspace_read:['claude_workspace_read'],bash_command:['relay'],bash_prefix:['relay']};
  if(typeof o.kind!=='string'||!Object.hasOwn(categories,o.kind)||!categories[o.kind].includes(o.category as string))return undefined;
  if(actor!==undefined&&actor!==o.actor||v.options[0].category!==o.category)return undefined;
  actor=o.actor;ids.add(o.id);
 }
 if(v.options.filter(o=>o.kind==='exact').length!==1||v.options[0].kind!=='exact'||!(v.selected_option_id===undefined||v.selected_option_id===null||typeof v.selected_option_id==='string'&&ids.has(v.selected_option_id)))return undefined;
 return {...v,selected_option_id:v.selected_option_id??null} as unknown as PermissionPolicy;
}
export interface DecisionPresentation {permission_policy?:PermissionPolicy|null;resolution_provenance?:PermissionProvenance;session_grant?:SessionGrant|null;persistent_grant?:PersistentGrant;version:1;kind:string;validated:boolean;details:unknown;responses?:('answers'|'dismiss'|'deny'|'allow_once'|'allow_session'|'allow_always')[]}
export function decisionPresentation(v:unknown):DecisionPresentation|undefined {
 if(v===undefined)return undefined;
 if(!object(v)||v.version!==1||!text(v.kind)||typeof v.validated!=='boolean'||!Object.hasOwn(v,'details')||JSON.stringify(v.details).length>65536||v.responses!==undefined&&(!Array.isArray(v.responses)||v.responses.some(r=>!['answers','dismiss','deny','allow_once','allow_session','allow_always'].includes(r))))throw Error('Invalid decision presentation; response blocked');
 if(v.kind==='unavailable'&&v.validated)throw Error('Unavailable action cannot expose validated capabilities');
 if(!v.validated&&(v.kind!=='unavailable'||v.details!==null||v.responses!==undefined))throw Error('Unvalidated action capabilities; response blocked');
 return {...v,...(Object.hasOwn(v,'permission_policy')?{permission_policy:permissionPolicy(v.permission_policy)??null}:{}),resolution_provenance:permissionProvenance(v.resolution_provenance),...(Object.hasOwn(v,'session_grant')?{session_grant:sessionGrant(v.session_grant)??null}:{}),persistent_grant:persistentGrant(v.persistent_grant)} as unknown as DecisionPresentation;
}
export interface RuntimeState {api:number;session:string;epoch:number;state:'unsupported'|'not_started'|'loaded'|'restart_required';capabilities:{retained_runtime:boolean;target_restart:boolean;simultaneous_retained_turns:boolean};resources:{state:'loading'|'leased'|'idle'|'retiring'|'uncertain'|null;threads:number;processes:number;thread_limit:number;process_limit:number}|null;catalog_policy:'unavailable'|'per_attempt'|'retained_lead';catalog_verified:boolean;catalog_scoped?:boolean;catalog_observed_ms?:number|null;catalog:{name:string;status?:string;tools?:string[]}[];idle_timeout_seconds:number;message:string}
export function runtimeState(v:unknown,session:string):RuntimeState {
 if(!object(v)||v.api!==7||v.session!==session||!integer(v.epoch)||v.epoch===0||!['unsupported','not_started','loaded','restart_required'].includes(v.state as string)||!object(v.capabilities)||!['retained_runtime','target_restart','simultaneous_retained_turns'].every(k=>typeof (v.capabilities as Record<string,unknown>)[k]==='boolean')||!['unavailable','per_attempt','retained_lead'].includes(v.catalog_policy as string)||typeof v.catalog_verified!=='boolean'||(v.catalog_scoped!==undefined&&typeof v.catalog_scoped!=='boolean')||typeof v.message!=='string'||!integer(v.idle_timeout_seconds)||!Array.isArray(v.catalog)||v.catalog.some(s=>!object(s)||typeof s.name!=='string'||s.status!==undefined&&typeof s.status!=='string'||s.tools!==undefined&&(!Array.isArray(s.tools)||s.tools.some(t=>typeof t!=='string'))))throw Error('Invalid session runtime state. Reopen Session to try again.');
 if(v.catalog_observed_ms!==undefined&&v.catalog_observed_ms!==null&&(!integer(v.catalog_observed_ms)||(v.catalog_observed_ms as number)>8640000000000000))throw Error('Invalid runtime observation time');
 if(v.resources!==null&&(!object(v.resources)||!(v.resources.state===null||['loading','leased','idle','retiring','uncertain'].includes(v.resources.state as string))||!['threads','processes','thread_limit','process_limit'].every(k=>integer((v.resources as Record<string,unknown>)[k]))))throw Error('Invalid retained resource projection');
 if(!v.capabilities.retained_runtime&&(v.state!=='unsupported'||v.resources!==null||v.capabilities.target_restart||v.capabilities.simultaneous_retained_turns)||v.capabilities.retained_runtime&&(v.state==='unsupported'||v.resources===null))throw Error('Inconsistent retained runtime capabilities');
 return v as unknown as RuntimeState;
}
