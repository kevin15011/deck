import {API,request,type Receipt} from './api';
import type {CommandTransport} from './command-admission';
// Workspace receipts are in authoritative arrival order, including clock rollback.
export function sessionQueue(receipts:Receipt[],session:string):Receipt[]{
 return receipts.filter(r=>r.session===session&&r.phase==='queued'&&!r.continuation&&r.recalled_ms===undefined);
}
/** Undispatched-only cancellation; a start race must refuse, never interrupt. */
export async function cancelQueuedInput(input:Receipt,transport:CommandTransport=request):Promise<void>{
 if(input.phase!=='queued'||input.dispatch_ms!==null||!input.attempt)throw Error('Queued input identity unavailable or already started. Refresh before cancelling.');
 const value=await transport('POST',`/api/commands/${encodeURIComponent(input.id)}/recall`,{api:API,session:input.session,attempt:input.attempt});
 const v=value as Record<string,unknown>|null;
 if(!v||v.id!==input.id||v.session!==input.session||v.attempt!==input.attempt||v.state!=='cancelled')throw Error('Queue cancellation could not be confirmed. Refresh to inspect this input before retrying.');
}
