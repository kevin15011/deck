import {API,HttpError} from './api';
import {plan,type Plan} from './configuration-api';
export interface PendingOperation {plan:Plan;id:string;allow:boolean}
const identity=(s:unknown):s is string=>typeof s==='string'&&/^[a-zA-Z0-9-]{8,80}$/.test(s);
export const pendingKey=(host:string)=>`deck2.host.${host}.configuration-operation`;
function parse(raw:string,host:string,project?:string):PendingOperation {
 const v=JSON.parse(raw),p=plan(v.plan);
 if(!identity(v.id)||typeof v.allow!=='boolean'||p.before.host_id!==host||project!==undefined&&p.before.project!==project)throw Error('Invalid saved management identity');
 return {plan:p,id:v.id,allow:v.allow};
}
const same=(a:PendingOperation,b:PendingOperation)=>a.id===b.id&&a.allow===b.allow&&JSON.stringify(a.plan)===JSON.stringify(b.plan);
const unavailable=()=>Error('Browser storage unavailable. Restore local storage before sending; no new management operation was dispatched.');
// One immutable entry per host/operation: concurrent tabs never rewrite a collection.
export function retainOperation(storage:Storage,host:string,project:string,p:PendingOperation){
 try{
  const key=pendingKey(host)+'.'+p.id,raw=JSON.stringify(parse(JSON.stringify(p),host,project)),old=storage.getItem(key);
  if(old!==null&&!same(parse(old,host,project),p))throw Error('Saved management identity conflicts; retained bytes were preserved.');
  storage.setItem(key,raw);
  if(storage.getItem(key)!==raw)throw unavailable();
 }catch(e){if(e instanceof Error&&e.message.includes('conflicts'))throw e;throw unavailable();}
}
export function pendingOperations(storage:Storage,host:string,project:string):{entries:PendingOperation[];issues:string[]} {
 const base=pendingKey(host),issues:string[]=[],entries:PendingOperation[]=[];
 try{
  const legacy=storage.getItem(base);
  if(legacy){try{
   const p=parse(legacy,host);retainOperation(storage,host,p.plan.before.project,p);
   // Copy and verify first. Failure leaves the legacy record available for retry.
   if(storage.getItem(base)===legacy)storage.removeItem(base);
  }catch{issues.push('A legacy management identity could not be recovered. Its saved bytes are preserved. Restore storage or inspect the retained record before making another change.');}}
  const keys=Array.from({length:storage.length},(_,i)=>storage.key(i)).filter((k):k is string=>!!k&&k.startsWith(base+'.')).sort();
  for(const key of keys){const raw=storage.getItem(key);if(raw===null)continue;try{
   const p=parse(raw,host);if(key!==base+'.'+p.id)throw Error('Key mismatch');if(p.plan.before.project===project)entries.push(p);
  }catch{issues.push(`Saved management identity ${key.slice(base.length+1)} is unreadable or belongs to another project. Its bytes are preserved; inspect it before making another change.`);}}
 }catch{issues.push('Browser storage cannot be read. Restore local storage to recover pending operations before making another change.');}
 return {entries,issues};
}
// Only call after a matching receipt or exact authoritative non-application proof.
export function forgetOperation(storage:Storage,host:string,project:string,p:PendingOperation){
 try{
  for(const key of [pendingKey(host)+'.'+p.id,pendingKey(host)]){
   const raw=storage.getItem(key);if(!raw)continue;
   let saved:PendingOperation;try{saved=parse(raw,host,project);}catch{continue;}
   if(same(saved,p))storage.removeItem(key);
  }
 }catch{throw Error('The outcome was received, but browser storage could not be cleared. Retrieve this same operation again after restoring storage.');}
}
export function managementNotApplied(e:unknown,p:PendingOperation):boolean {
 if(!(e instanceof HttpError)||e.status!==409||typeof e.problem!=='object'||!e.problem)return false;
 const proof=e.problem as Record<string,unknown>;
 return proof.api===API&&proof.code==='management_not_applied'&&proof.plan===p.plan.id&&proof.operation_id===p.id;
}
