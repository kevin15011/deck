/** Structured Lead claims. Absence inherits; acceptance/sourceTasks replace; findings merge by default. */
export type Acceptance = {items:{id:string;text:string}[];refs?:{path:string;anchor?:string}[]};
export type SourceTask = {taskId:string;attempt:number};
export type Finding = {id:string;state:'open'|'blocker'|'resolved'|'wontfix';severity?:'blocker'|'major'|'minor'|'info';text:string;resolution?:string;evidenceSeqs?:number[];source?:SourceTask&{findingId?:string}};
export type FindingsUpdate = {mode?:'merge'|'replace';items:Finding[]};
export type StructuredTaskState = {acceptance?:Acceptance;findings?:Finding[];sourceTasks?:SourceTask[];findingStates?:Record<string,{state:Finding['state'];seq:number}>};
export type StructuredTaskUpdate = {acceptance?:Acceptance;findings?:FindingsUpdate;sourceTasks?:SourceTask[]};
export type FindingResolution = {taskId:string;findingId:string;state:'resolved'|'wontfix'|'open'|'blocker';reason:string;evidenceSeqs:number[]};
export const utf8Bytes=(text:string)=>new TextEncoder().encode(text).byteLength;
const obj=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const keys=(v:Record<string,unknown>,allowed:string[])=>Object.keys(v).every(k=>allowed.includes(k));
const txt=(v:unknown,max:number):v is string=>typeof v==='string'&&!!v.trim()&&v.length<=max;
const seqs=(v:unknown):v is number[]=>Array.isArray(v)&&v.length>0&&v.length<=16&&new Set(v).size===v.length&&v.every(n=>Number.isSafeInteger(n)&&n>0);
const id=(v:unknown)=>txt(v,64)&&/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(v);
export const projectRelativePath=(v:unknown):v is string=>txt(v,512)&&!v.startsWith('/')&&!v.includes('\\')&&!v.split('/').some(p=>!p||p==='.'||p==='..')&&!/[\x00-\x1f\x7f]/.test(v)&&!v.includes(':');
const source=(v:unknown):v is Record<string,unknown>&SourceTask=>obj(v)&&txt(v.taskId,128)&&Number.isSafeInteger(v.attempt)&&Number(v.attempt)>0;
const active=(f:Finding)=>f.state==='open'||f.state==='blocker';
export function validateFindingResolutions(v:unknown):v is FindingResolution[] {
 return Array.isArray(v)&&v.length<=64&&new Set(v.map(x=>obj(x)?JSON.stringify([x.taskId,x.findingId]):null)).size===v.length&&v.every(x=>obj(x)&&keys(x,['taskId','findingId','state','reason','evidenceSeqs'])&&txt(x.taskId,128)&&id(x.findingId)&&['resolved','wontfix','open','blocker'].includes(String(x.state))&&txt(x.reason,512)&&seqs(x.evidenceSeqs));
}
export function mergeStructuredTask(prior:StructuredTaskState, update:unknown, validateRef:(ref:SourceTask|number)=>boolean=()=>true):StructuredTaskState {
 if(!obj(update))throw new Error('structured-task-invalid');
 const next:StructuredTaskState=structuredClone(Object.fromEntries(['acceptance','findings','sourceTasks','findingStates'].filter(k=>Object.hasOwn(prior,k)).map(k=>[k,prior[k as keyof StructuredTaskState]])));
 if(update.acceptance!==undefined){
  const a=update.acceptance;
  if(!obj(a)||!keys(a,['items','refs'])||!Array.isArray(a.items)||a.items.length>32||new Set(a.items.map(i=>obj(i)?i.id:null)).size!==a.items.length||!a.items.every(i=>obj(i)&&keys(i,['id','text'])&&id(i.id)&&txt(i.text,1024))||utf8Bytes(JSON.stringify(a))>8192)throw new Error('acceptance-invalid-or-overflow');
  if(a.refs!==undefined&&(!Array.isArray(a.refs)||a.refs.length>16||!a.refs.every(r=>obj(r)&&keys(r,['path','anchor'])&&projectRelativePath(r.path)&&(r.anchor===undefined||txt(r.anchor,128)))))throw new Error('acceptance-reference-invalid');
  next.acceptance=structuredClone(a) as Acceptance;
 }
 if(update.sourceTasks!==undefined){
  const s=update.sourceTasks;
  if(!Array.isArray(s)||s.length>8||new Set(s.map(r=>JSON.stringify(r))).size!==s.length||!s.every(r=>source(r)&&keys(r,['taskId','attempt'])&&validateRef(r as SourceTask)))throw new Error('source-tasks-invalid');
  next.sourceTasks=structuredClone(s) as SourceTask[];
 }
 if(update.findings!==undefined){
  const f=update.findings;
  if(!obj(f)||!keys(f,['mode','items'])||f.mode!==undefined&&!['merge','replace'].includes(String(f.mode))||!Array.isArray(f.items)||f.items.length>128||new Set(f.items.map(i=>obj(i)?i.id:null)).size!==f.items.length)throw new Error('findings-invalid');
  if(f.mode!=='replace' && f.items.length===0)return next;
  const existing=new Map((prior.findings??[]).map(x=>[x.id,x]));
  if(f.mode==='replace'&&[...existing.keys()].some(k=>!(f.items as Finding[]).some(i=>i.id===k)))throw new Error('findings-replace-would-drop-open');
  for(const v of f.items){
   if(!obj(v)||!keys(v,['id','state','severity','text','resolution','evidenceSeqs','source'])||!id(v.id)||!['open','blocker','resolved','wontfix'].includes(String(v.state))||!txt(v.text,1024)||v.severity!==undefined&&!['blocker','major','minor','info'].includes(String(v.severity))||v.resolution!==undefined&&!txt(v.resolution,512)||v.evidenceSeqs!==undefined&&(!seqs(v.evidenceSeqs)||!v.evidenceSeqs.every(validateRef))||v.source!==undefined&&(!source(v.source)||!keys(v.source,['taskId','attempt','findingId'])||v.source.findingId!==undefined&&!id(v.source.findingId)||!validateRef(v.source as SourceTask)))throw new Error('finding-invalid');
   const item=v as Finding, old=prior.findingStates?.[item.id];
   const reopening=old&&(old.state==='resolved'||old.state==='wontfix')&&active(item);
   if((!active(item)||reopening)&&(!txt(item.resolution,512)||!seqs(item.evidenceSeqs)))throw new Error('finding-transition-evidence-required');
   if(active(item))existing.set(item.id,structuredClone(item));else existing.delete(item.id);
   (next.findingStates??={})[item.id]={state:item.state,seq:0};
  }
  next.findings=[...existing.values()];
  if(next.findings.length>64||utf8Bytes(JSON.stringify(next.findings))>8192||Object.keys(next.findingStates??{}).length>1024)throw new Error('findings-merged-state-overflow');
 }
 return next;
}
const ID_SCHEMA={type:'string',minLength:1,maxLength:64,pattern:'^[A-Za-z0-9][A-Za-z0-9._:-]*$'};
const SEQS_SCHEMA={type:'array',minItems:1,maxItems:16,uniqueItems:true,items:{type:'integer',minimum:1,maximum:Number.MAX_SAFE_INTEGER}};
const SOURCE_SCHEMA={type:'object',additionalProperties:false,required:['taskId','attempt'],properties:{taskId:{type:'string',minLength:1,maxLength:128},attempt:{type:'integer',minimum:1},findingId:ID_SCHEMA}};
export const FINDING_RESOLUTIONS_SCHEMA={type:'array',maxItems:64,items:{type:'object',additionalProperties:false,required:['taskId','findingId','state','reason','evidenceSeqs'],properties:{taskId:{type:'string'},findingId:ID_SCHEMA,state:{enum:['resolved','wontfix','open','blocker']},reason:{type:'string',minLength:1,maxLength:512},evidenceSeqs:SEQS_SCHEMA}}};
export const DELEGATED_CONTINUITY_PROPERTIES={
 continuity:{enum:['auto','fresh','native']},continuityJustification:{type:'string',minLength:1,maxLength:512},
 acceptance:{type:'object',additionalProperties:false,required:['items'],properties:{items:{type:'array',maxItems:32,items:{type:'object',additionalProperties:false,required:['id','text'],properties:{id:ID_SCHEMA,text:{type:'string',minLength:1,maxLength:1024}}}},refs:{type:'array',maxItems:16,items:{type:'object',additionalProperties:false,required:['path'],properties:{path:{type:'string',maxLength:512},anchor:{type:'string',maxLength:128}}}}}},
 findings:{type:'object',additionalProperties:false,required:['items'],properties:{mode:{enum:['merge','replace']},items:{type:'array',maxItems:128,items:{type:'object',additionalProperties:false,required:['id','state','text'],properties:{id:ID_SCHEMA,state:{enum:['open','blocker','resolved','wontfix']},severity:{enum:['blocker','major','minor','info']},text:{type:'string',minLength:1,maxLength:1024},resolution:{type:'string',minLength:1,maxLength:512},evidenceSeqs:SEQS_SCHEMA,source:SOURCE_SCHEMA}}}}},
 sourceTasks:{type:'array',maxItems:8,items:{...SOURCE_SCHEMA,properties:{taskId:{type:'string',minLength:1,maxLength:128},attempt:{type:'integer',minimum:1}}}},
} as const;
