// Immutable browser admissions, using the same per-operation storage pattern as
// configuration/graph operations. A tab can only remove the exact entry it read.
import type {Mode,Receipt} from './api';
import type {DecisionSelection} from './decisions';
export interface PendingCommand {
 id:string;session:string;prompt:string;mode:Mode;fresh:boolean;attachments:string[];
 target:DecisionSelection|null|undefined;queue:boolean;
}
const fields=['pending','pending-prompt','pending-mode','pending-fresh','pending-images','pending-target'];
const prefix=(scope:string)=>'deck2.'+scope+'.';
const key=(scope:string,id:string)=>prefix(scope)+'pending-command.'+id;
const modes=['read_only','reviewed_edit','team','developer','ordinary_read_only_v1','ordinary_reviewed_v1','session_v1'];
function parse(raw:string,session:string,legacy=false):PendingCommand {
 const p=JSON.parse(raw) as PendingCommand,t=p.target;
 if(!p||typeof p.id!=='string'||!p.id||typeof p.prompt!=='string'||p.session!==session||!modes.includes(p.mode)||typeof p.fresh!=='boolean'||typeof p.queue!=='boolean'||!Array.isArray(p.attachments)||p.attachments.some(id=>typeof id!=='string')||(!legacy&&t===undefined))throw Error('Unreadable pending input. Saved identity preserved.');
 if(t!==null&&t!==undefined&&(t.sessionId!==session||typeof t.decisionId!=='string'||!t.decisionId||typeof t.question!=='string'||!Number.isSafeInteger(t.revision)||t.revision<1||!Number.isSafeInteger(t.questionRevision)||t.questionRevision<1||t.questionRevision>t.revision))throw Error('Invalid saved reply target. Identity preserved.');
 return p;
}
function legacyCommand(storage:Storage,scope:string,session:string):PendingCommand|undefined {
 const read=(k:string)=>storage.getItem(prefix(scope)+k)||'',id=read('pending');if(!id)return;
 // The old global pending-target cannot be attributed to any session. Never
 // infer a target (including null) from it. Such records can reconcile a receipt,
 // but cannot safely be dispatched again until that receipt exists.
 return parse(JSON.stringify({id,session,prompt:read('pending-prompt'),mode:read('pending-mode')||'read_only',fresh:read('pending-fresh')==='true',attachments:JSON.parse(read('pending-images')||'[]'),...(read('pending-target')?{target:JSON.parse(read('pending-target'))}:{}),queue:false}),session,true);
}
export function pendingCommands(storage:Storage,scope:string,session:string):PendingCommand[] {
 const entries:PendingCommand[]=[],base=prefix(scope)+'pending-command.';
 for(let i=0;i<storage.length;i++){
  const k=storage.key(i);if(!k?.startsWith(base))continue;
  const p=parse(storage.getItem(k)||'',session);
  if(k!==key(scope,p.id))throw Error('Pending input key mismatch. Identity preserved.');
  entries.push(p);
 }
 const legacy=legacyCommand(storage,scope,session);
 if(legacy){if(entries.some(p=>p.id===legacy.id))throw Error('Duplicate saved input identity. Saved entries preserved.');entries.unshift(legacy);}
 return entries;
}
export function retainCommand(storage:Storage,scope:string,p:PendingCommand){
 const raw=JSON.stringify(parse(JSON.stringify(p),p.session)),k=key(scope,p.id),old=storage.getItem(k);
 if(old!==null&&old!==raw)throw Error('Pending input identity conflicts. Original preserved.');
 storage.setItem(k,raw);if(storage.getItem(k)!==raw)throw Error('Input identity could not be saved. Nothing dispatched.');
}
export function forgetCommand(storage:Storage,scope:string,p:PendingCommand){
 const k=key(scope,p.id),raw=storage.getItem(k);
 if(raw!==null){if(raw!==JSON.stringify(p))throw Error('Different pending input retained. Cannot clear.');storage.removeItem(k);}
 const old=legacyCommand(storage,scope,p.session);
 if(old&&JSON.stringify(old)===JSON.stringify(p))for(const field of fields)storage.removeItem(prefix(scope)+field);
}
export function matchesCommand(p:PendingCommand,r:Receipt){
 return r.id===p.id&&r.session===p.session&&r.prompt===p.prompt&&r.mode===p.mode&&r.fresh===p.fresh&&JSON.stringify(r.attachments.map(a=>a.id))===JSON.stringify(p.attachments);
}
