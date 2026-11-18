import {API,receipt,request,type Receipt} from './api';
import {retainCommand,matchesCommand,type PendingCommand} from './command-pending';
export type CommandTransport=(method:string,path:string,body?:unknown)=>Promise<unknown>;
/** Persist the immutable admission before any effect; failed/lost replies keep it. */
export async function admitCommand(storage:Storage,owner:string,p:PendingCommand,transport:CommandTransport=request):Promise<Receipt>{
 if(p.target===undefined)throw Error('This older pending input has no attributable reply target. Reconnect to reconcile its receipt.');
 retainCommand(storage,owner,p);
 const target=p.target;
 const accepted=receipt(await transport('POST','/api/commands'+(target?'?decisionId='+encodeURIComponent(target.decisionId)+'&revision='+target.revision:''),{api:API,id:p.id,prompt:p.prompt,attachments:p.attachments,mode:p.mode,session:p.session,queue:p.queue,fresh:p.fresh}));
 if(!matchesCommand(p,accepted))throw Error('Host receipt does not match this command. Identity retained; reconnect to inspect.');
 return accepted;
}
/** Undefined means keep the editable draft, including changes from another tab. */
export function acknowledgedDraft(p:PendingCommand,current:string,saved:string):''|undefined{
 return current===p.prompt&&saved===p.prompt?'':undefined;
}
