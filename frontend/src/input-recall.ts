import {imageAttachment,type Receipt} from './api';
import {recoverDraft} from './draft-storage';
export function escapeInput(receipts:Receipt[]):{kind:'recall'|'interrupt';input:Receipt}|undefined {
 receipts=receipts.filter(r=>r.recalled_ms===undefined);
 const queued=receipts.filter(r=>r.phase==='queued'&&!r.continuation).at(-1);
 if(queued)return {kind:'recall',input:queued};
 const unread=receipts.find(r=>(r.phase==='accepted'||r.phase==='preparing')&&r.dispatch_ms===null&&!r.continuation);
 if(unread)return {kind:'recall',input:unread};
 const running=receipts.find(r=>['dispatching','running','cancelling'].includes(r.phase));
 if(running)return {kind:'interrupt',input:running};
}
type RecoveryInput=Pick<Receipt,'id'|'session'|'attempt'|'prompt'|'attachments'>;
interface Recovery {input:RecoveryInput;confirmed:boolean}
const identity=(input:RecoveryInput)=>JSON.stringify([input.session,input.id,input.attempt??null]);
const recoveryKey=(owner:string,input:RecoveryInput)=>'deck2.'+owner+'.recall.'+encodeURIComponent(identity(input));
export function retainRecall(storage:Storage,owner:string,input:RecoveryInput){
 const key=recoveryKey(owner,input),old=storage.getItem(key);
 if(old!==null){const prior=JSON.parse(old) as Recovery;if(identity(prior.input)!==identity(input)||prior.input.prompt!==input.prompt||JSON.stringify(prior.input.attachments)!==JSON.stringify(input.attachments))throw Error('Saved recall conflicts with input. Original preserved.');return;}
 const record:Recovery={input:{id:input.id,session:input.session,attempt:input.attempt,prompt:input.prompt,attachments:input.attachments},confirmed:false};
 storage.setItem(key,JSON.stringify(record));
}
function records(storage:Storage,owner:string,session:string){
 const entries:Array<{key:string;record:Recovery}>=[],base='deck2.'+owner+'.recall.';
 for(let i=0;i<storage.length;i++){
  const key=storage.key(i);if(!key?.startsWith(base))continue;
  const record=JSON.parse(storage.getItem(key)||'') as Recovery,input=record?.input;
  if(!input||input.session!==session||typeof input.id!=='string'||typeof input.prompt!=='string'||(input.attempt!==undefined&&typeof input.attempt!=='string')||!Array.isArray(input.attachments)||typeof record.confirmed!=='boolean'||key!==recoveryKey(owner,input))throw Error('Saved recall identity is invalid. Browser storage preserved.');
  input.attachments.forEach(imageAttachment);entries.push({key,record});
 }
 return entries;
}
function finishRecall(storage:Storage,owner:string,key:string,record:Recovery,publish:(text:string)=>void,images:(input:RecoveryInput)=>void){
 const text=recoverDraft(storage,'deck2.'+owner+'.draft',identity(record.input),record.input.prompt);
 publish(text);images(record.input);
 // Text has an atomic applied marker; images merge by attachment identity.
 // A failure at any point leaves the intent available for another reconciliation.
 storage.removeItem(key);
}
export function reconcileRecalls(storage:Storage,owner:string,session:string,receipts:Receipt[],publish:(text:string)=>void,images:(input:RecoveryInput)=>void){
 for(const {key,record} of records(storage,owner,session)){
  const input=receipts.find(r=>identity(r)===identity(record.input));
  if(!record.confirmed&&input?.recalled_ms===undefined)continue;
  if(input&&(input.prompt!==record.input.prompt||JSON.stringify(input.attachments)!==JSON.stringify(record.input.attachments)))throw Error('Recall receipt differs from saved input. Browser storage preserved.');
  finishRecall(storage,owner,key,record,publish,images);
 }
}
/** Save intent before the network effect; only exact acknowledgement or durable projection restores it. */
export async function restoreInput(storage:Storage,owner:string,input:Receipt,cancel:()=>Promise<unknown>,publish:(text:string)=>void,images:(input:RecoveryInput)=>void):Promise<boolean>{
 retainRecall(storage,owner,input);
 const reply=await cancel();
 if(!reply||typeof reply!=='object'||!('id' in reply)||reply.id!==input.id||!('session' in reply)||reply.session!==input.session||!('attempt' in reply)||reply.attempt!==input.attempt||!('state' in reply)||reply.state!=='cancelled')return false;
 const key=recoveryKey(owner,input),raw=storage.getItem(key);
 // Polling may already have completed recovery while the response was in flight.
 if(raw===null)return true;
 const record=JSON.parse(raw) as Recovery;record.confirmed=true;
 storage.setItem(key,JSON.stringify(record));
 finishRecall(storage,owner,key,record,publish,images);return true;
}
