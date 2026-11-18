import {API,HttpError} from './api';
export interface GraphPending {id:string;plan:string;allow:boolean;host:string;project:string}
const prefix='deck2-cbm-operation-v1:';
export function pendingKey(p:GraphPending){return prefix+encodeURIComponent(p.host)+':'+encodeURIComponent(p.id);}
export function parsePending(v:unknown):GraphPending {
 if(!v||typeof v!=='object'||Array.isArray(v))throw Error('Unreadable graph operation retained');
 const p=v as Record<string,unknown>;
 if(!['id','plan','host','project'].every(k=>typeof p[k]==='string'&&(p[k] as string).length>0)||typeof p.allow!=='boolean')throw Error('Malformed graph operation retained; restore its saved identity before continuing');
 return p as unknown as GraphPending;
}
export function retainGraph(storage:Storage,p:GraphPending){const key=pendingKey(p),body=JSON.stringify(p),old=storage.getItem(key);if(old!==null&&old!==body)throw Error('Graph operation identity conflicts; original retained');storage.setItem(key,body);if(storage.getItem(key)!==body)throw Error('Graph identity could not be saved; nothing dispatched');}
export function discoverGraph(storage:Storage,host:string,project:string){const entries:GraphPending[]=[],issues:string[]=[];for(let i=0;i<storage.length;i++){const key=storage.key(i);if(!key?.startsWith(prefix+encodeURIComponent(host)+':'))continue;try{const p=parsePending(JSON.parse(storage.getItem(key)||''));if(key!==pendingKey(p)||p.host!==host)throw Error('Graph operation scope mismatch; saved entry retained');if(p.project===project)entries.push(p);}catch(e){issues.push(String(e));}}return {entries,issues};}
export function forgetGraph(storage:Storage,p:GraphPending){const key=pendingKey(p),old=storage.getItem(key);if(old===null)return;const exact=parsePending(JSON.parse(old));if(JSON.stringify(exact)!==JSON.stringify(p))throw Error('Different graph identity retained; cannot clear');storage.removeItem(key);if(storage.getItem(key)!==null)throw Error('Graph identity could not be cleared');}

export function graphNotApplied(e:unknown,p:GraphPending){if(!(e instanceof HttpError)||e.status!==409||!e.problem||typeof e.problem!=='object')return false;const v=e.problem as Record<string,unknown>;return v.api===API&&v.code==='cbm_not_applied'&&v.operation_id===p.id&&v.plan===p.plan&&v.allow===p.allow;}
